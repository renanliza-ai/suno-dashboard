import { runReport } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/analises/onboarding-nai
 *
 * 🔒 Master-only.
 *
 * Análise dedicada da página /onboarding na área logada (NAI).
 * Responde 4 perguntas em paralelo:
 *
 *   1. Quantas pessoas chegaram em /onboarding na NAI no período
 *      (com breakdown mensal pra ver evolução)
 *
 *   2. Que eventos foram disparados nessa página
 *      (sign_up, complete_registration, lead, etc — revela onde
 *      cada pessoa caiu no funil de onboarding)
 *
 *   3. Total de purchases no período + breakdown por plano (item_name)
 *      — isso é PARALELO, não cruzado por user (limitação GA4 sem User-ID)
 *
 *   4. Top dispositivos / canais que trouxeram tráfego pra /onboarding
 *
 * Query params:
 *   propertyId (default 263739159 — Suno Research)
 *   startDate (default 2025-11-01)
 *   endDate (default hoje)
 *   pagePath (default /onboarding)
 *   hostname (default investidor.suno.com.br)
 */

export async function GET(req: NextRequest) {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId") || "263739159";
  const startDate = req.nextUrl.searchParams.get("startDate") || "2025-11-01";
  const endDate = req.nextUrl.searchParams.get("endDate") || new Date().toISOString().slice(0, 10);
  const pagePath = req.nextUrl.searchParams.get("pagePath") || "/onboarding";
  const hostname = req.nextUrl.searchParams.get("hostname") || "investidor.suno.com.br";

  const dateRange = { startDate, endDate };

  // Filter combinado: hostname + pagePath EXACT
  const onboardingFilter = {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "hostName",
            stringFilter: { value: hostname, matchType: "EXACT" as const },
          },
        },
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: { value: pagePath, matchType: "EXACT" as const },
          },
        },
      ],
    },
  };

  const [
    onboardingTotalRes,
    onboardingMonthlyRes,
    onboardingEventsRes,
    onboardingDeviceRes,
    onboardingChannelRes,
    purchaseTotalRes,
    purchasePlansRes,
  ] = await Promise.all([
    // 1. Total de usuários + sessões + pageviews em /onboarding
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [
        { name: "totalUsers" },
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      dimensionFilter: onboardingFilter,
      metricAggregations: ["TOTAL"],
    }),

    // 2. Mensal — pra ver evolução do volume
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "yearMonth" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ dimension: { dimensionName: "yearMonth", orderType: "NUMERIC" }, desc: false }],
    }),

    // 3. Eventos disparados em /onboarding — revela funnel interno
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 30,
    }),

    // 4. Por device — desktop vs mobile vs tablet
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    }),

    // 5. Por canal de aquisição
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 15,
    }),

    // 6. Purchases totais no MESMO período (paralelo, não cruzado)
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [{ name: "totalRevenue" }, { name: "purchaseRevenue" }, { name: "transactions" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["purchase", "purchase_success"] },
        },
      },
      metricAggregations: ["TOTAL"],
    }),

    // 7. Breakdown de purchases por plano (item_name) — perfil de assinatura
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "itemName" }, { name: "itemCategory" }],
      metrics: [{ name: "itemsPurchased" }, { name: "itemRevenue" }],
      orderBys: [{ metric: { metricName: "itemsPurchased" }, desc: true }],
      limit: 30,
    }),
  ]);

  // Helpers pra extrair métricas
  const readTotal = (res: { data: { rows?: { metricValues?: { value: string }[] }[]; totals?: { metricValues?: { value: string }[] }[] } | null }, idx: number) => {
    return Number(
      res.data?.rows?.[0]?.metricValues?.[idx]?.value ||
        res.data?.totals?.[0]?.metricValues?.[idx]?.value ||
        0
    );
  };

  // 1. Onboarding totais
  const onboarding = {
    totalUsers: readTotal(onboardingTotalRes, 0),
    activeUsers: readTotal(onboardingTotalRes, 1),
    sessions: readTotal(onboardingTotalRes, 2),
    pageViews: readTotal(onboardingTotalRes, 3),
    avgSessionDuration: Math.round(readTotal(onboardingTotalRes, 4)),
    bounceRate: Number((readTotal(onboardingTotalRes, 5) * 100).toFixed(1)),
    error: onboardingTotalRes.error,
  };

  // 2. Mensal
  const monthly = (onboardingMonthlyRes.data?.rows || []).map((r) => {
    const ym = r.dimensionValues?.[0]?.value || "";
    // GA4 retorna YYYYMM — formata pra pt-BR
    const formatted = ym.length === 6 ? `${ym.slice(4, 6)}/${ym.slice(0, 4)}` : ym;
    return {
      month: ym,
      label: formatted,
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
      pageViews: Number(r.metricValues?.[2]?.value || 0),
    };
  });

  // 3. Eventos
  const events = (onboardingEventsRes.data?.rows || []).map((r) => ({
    event: r.dimensionValues?.[0]?.value || "",
    count: Number(r.metricValues?.[0]?.value || 0),
    users: Number(r.metricValues?.[1]?.value || 0),
  }));

  // 4. Device
  const devices = (onboardingDeviceRes.data?.rows || []).map((r) => ({
    device: r.dimensionValues?.[0]?.value || "",
    users: Number(r.metricValues?.[0]?.value || 0),
    sessions: Number(r.metricValues?.[1]?.value || 0),
  }));

  // 5. Channel
  const channels = (onboardingChannelRes.data?.rows || []).map((r) => ({
    channel: r.dimensionValues?.[0]?.value || "",
    users: Number(r.metricValues?.[0]?.value || 0),
    sessions: Number(r.metricValues?.[1]?.value || 0),
  }));

  // 6. Purchases globais
  const purchases = {
    totalRevenue: readTotal(purchaseTotalRes, 0),
    purchaseRevenue: readTotal(purchaseTotalRes, 1),
    transactions: readTotal(purchaseTotalRes, 2),
  };

  // 7. Breakdown por plano
  const plans = (purchasePlansRes.data?.rows || []).map((r) => ({
    itemName: r.dimensionValues?.[0]?.value || "(sem nome)",
    itemCategory: r.dimensionValues?.[1]?.value || "(sem categoria)",
    quantity: Number(r.metricValues?.[0]?.value || 0),
    revenue: Number(r.metricValues?.[1]?.value || 0),
  }));

  return NextResponse.json(
    {
      query: { propertyId, startDate, endDate, pagePath, hostname },
      onboarding,
      monthly,
      events,
      devices,
      channels,
      purchases,
      plans,
      // Disclaimer pra UI
      caveat:
        "Esta análise mostra (a) acesso à página de onboarding e (b) purchases totais no mesmo período em paralelo. NÃO é possível cruzar 1:1 (esse user passou no onboarding E comprou plano X) sem User-ID configurado no GA4. Pra ter o cruzamento exato, configure user_id parameter na sessão autenticada.",
    },
    { headers: { "Cache-Control": "private, max-age=900" } }
  );
}
