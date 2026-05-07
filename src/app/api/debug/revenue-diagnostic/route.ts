import { runReport } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/debug/revenue-diagnostic?propertyId=...&days=30
 *
 * 🔬 ENDPOINT DE DIAGNÓSTICO master-only.
 *
 * Roda 6 queries diferentes contra GA4 pra mostrar EXATAMENTE de onde a
 * receita está vindo (ou não vindo). Útil quando:
 *   - O painel mostra R$ 0 mas o GA4 nativo mostra valor
 *   - Suspeita de dataLayer mal estruturado
 *   - Quer verificar se purchase event tem params populando
 *
 * Retorno:
 *   - 5 métricas de receita lado a lado
 *   - eventCount + eventValue + itemRevenue do evento purchase
 *   - Top 20 eventos disparados (pra confirmar que purchase está chegando)
 *   - Top 5 transactions IDs (pra confirmar que transaction_id chega)
 */
export async function GET(req: NextRequest) {
  // Gate master
  const session = (await auth()) as {
    user?: { isMaster?: boolean; email?: string };
  } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDateObj = new Date(today);
  startDateObj.setDate(startDateObj.getDate() - days);
  const startDate = startDateObj.toISOString().slice(0, 10);
  const dateRange = { startDate, endDate };

  // Roda 6 queries em paralelo
  const [
    revMetricsRes,
    purchaseEventRes,
    itemRevRes,
    topEventsRes,
    transactionsRes,
    purchaseValueRes,
  ] = await Promise.all([
    // 1) Métricas oficiais de receita
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [
        { name: "totalRevenue" },
        { name: "purchaseRevenue" },
        { name: "averagePurchaseRevenue" },
      ],
    }),
    // 2) eventCount + eventValue do evento purchase
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["purchase", "purchase_success"] },
        },
      },
    }),
    // 3) itemRevenue (do array items[] do enhanced ecommerce)
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [{ name: "itemRevenue" }, { name: "itemsPurchased" }],
    }),
    // 4) Top 20 eventos (pra confirmar que purchase está chegando)
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 20,
    }),
    // 5) Top 5 transaction_id (confirma se param chega)
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "transactionId" }],
      metrics: [{ name: "purchaseRevenue" }, { name: "eventValue" }],
      orderBys: [{ metric: { metricName: "eventValue" }, desc: true }],
      limit: 5,
    }),
    // 6) Distribuição de value POR purchase (revela se value está vindo)
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "transactionId" }],
      metrics: [{ name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          stringFilter: { value: "purchase", matchType: "EXACT" },
        },
      },
      orderBys: [{ metric: { metricName: "eventValue" }, desc: true }],
      limit: 10,
    }),
  ]);

  // Extrai os números
  const revMetrics = {
    totalRevenue: Number(revMetricsRes.data?.totals?.[0]?.metricValues?.[0]?.value || 0),
    purchaseRevenue: Number(revMetricsRes.data?.totals?.[0]?.metricValues?.[1]?.value || 0),
    averagePurchaseRevenue: Number(
      revMetricsRes.data?.totals?.[0]?.metricValues?.[2]?.value || 0
    ),
    error: revMetricsRes.error,
  };

  const purchaseEventTotals = purchaseEventRes.data?.rows?.reduce(
    (acc, r) => ({
      count: acc.count + Number(r.metricValues?.[0]?.value || 0),
      value: acc.value + Number(r.metricValues?.[1]?.value || 0),
    }),
    { count: 0, value: 0 }
  ) || { count: 0, value: 0 };

  const itemRev = {
    itemRevenue: Number(itemRevRes.data?.totals?.[0]?.metricValues?.[0]?.value || 0),
    itemsPurchased: Number(itemRevRes.data?.totals?.[0]?.metricValues?.[1]?.value || 0),
    error: itemRevRes.error,
  };

  const topEvents = (topEventsRes.data?.rows || []).map((r) => ({
    event: r.dimensionValues?.[0]?.value || "",
    count: Number(r.metricValues?.[0]?.value || 0),
  }));

  const topTransactions = (transactionsRes.data?.rows || []).map((r) => ({
    transactionId: r.dimensionValues?.[0]?.value || "",
    purchaseRevenue: Number(r.metricValues?.[0]?.value || 0),
    eventValue: Number(r.metricValues?.[1]?.value || 0),
  }));

  const purchaseValueDist = (purchaseValueRes.data?.rows || []).map((r) => ({
    transactionId: r.dimensionValues?.[0]?.value || "",
    value: Number(r.metricValues?.[0]?.value || 0),
  }));

  // Diagnóstico automático
  const diagnoses: string[] = [];
  if (revMetrics.purchaseRevenue === 0 && purchaseEventTotals.value > 0) {
    diagnoses.push(
      "purchaseRevenue=0 mas eventValue do purchase > 0 → o GA4 reconheceu o value mas NÃO reconheceu currency. Provável causa: 'currency' não está sendo enviado em par com 'value' no payload do evento purchase."
    );
  }
  if (revMetrics.purchaseRevenue === 0 && itemRev.itemRevenue > 0) {
    diagnoses.push(
      "purchaseRevenue=0 mas itemRevenue > 0 → existe array items[] populando, mas o evento purchase não tem 'value' no nível raiz. GA4 calcula purchaseRevenue do 'value' raiz do evento, não da soma de items."
    );
  }
  if (purchaseEventTotals.count === 0) {
    const hasPurchaseInTop = topEvents.find((e) => e.event === "purchase" || e.event === "purchase_success");
    if (hasPurchaseInTop) {
      diagnoses.push(
        `Evento '${hasPurchaseInTop.event}' aparece nos top events com ${hasPurchaseInTop.count} disparos, mas a query filtrada retornou 0. Possível bug de naming/tags.`
      );
    } else {
      diagnoses.push(
        "Nenhum evento 'purchase' ou 'purchase_success' detectado. Verificar se o tag GA4 Event no GTM está disparando corretamente."
      );
    }
  }
  if (purchaseEventTotals.count > 0 && purchaseValueDist.every((t) => t.value === 0)) {
    diagnoses.push(
      "Eventos purchase estão chegando mas TODOS com value=0. O 'value' do dataLayer não está sendo lido pelo GTM. Verificar se a tag GA4 Event tem 'value' mapeado corretamente nos Event Parameters."
    );
  }
  if (
    revMetrics.purchaseRevenue > 0 &&
    purchaseEventTotals.value > 0 &&
    Math.abs(revMetrics.purchaseRevenue - purchaseEventTotals.value) /
      Math.max(revMetrics.purchaseRevenue, purchaseEventTotals.value) >
      0.1
  ) {
    diagnoses.push(
      `purchaseRevenue (R$${revMetrics.purchaseRevenue.toFixed(2)}) e eventValue (R$${purchaseEventTotals.value.toFixed(2)}) divergem >10%. Possível: parte das compras tem currency e parte não.`
    );
  }
  if (diagnoses.length === 0) {
    diagnoses.push("Nenhuma anomalia detectada nas métricas de receita.");
  }

  return NextResponse.json(
    {
      property: propertyId,
      period: { startDate, endDate, days },
      revenue_metrics_official: revMetrics,
      purchase_event_aggregated: purchaseEventTotals,
      ecommerce_items: itemRev,
      top_events: topEvents,
      top_transactions: topTransactions,
      purchase_value_distribution_top10: purchaseValueDist,
      diagnoses,
      hint: "Compare 'revenue_metrics_official.purchaseRevenue' (oficial), 'purchase_event_aggregated.value' (eventValue do purchase), 'ecommerce_items.itemRevenue' (soma de items[]). O painel GA4 nativo usa o que estiver populado.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
