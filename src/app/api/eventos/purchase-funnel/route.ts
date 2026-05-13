import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/eventos/purchase-funnel
 *
 * Retorna a contagem EXATA dos 6 eventos do funil de compra, mesmo
 * que algum tenha volume baixo (não cortado por limit/top-N).
 *
 * Antes usávamos o overview.events (top 50) — se um evento como
 * add_payment_info ficasse fora do top, aparecia como "ausente" no
 * funil mesmo disparando normalmente. Esse endpoint corrige isso
 * usando inListFilter no eventName.
 */

const FUNNEL_EVENTS = [
  "page_view",
  "pageview",
  "view_item",
  "view_cart",
  "add_to_cart",
  "begin_checkout",
  "add_payment_info",
  "purchase",
];

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");

  // Date range — honra custom range ou usa relativo
  const dateRange =
    startDateParam && endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
      ? { startDate: startDateParam, endDate: endDateParam }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // Query 1 única que retorna TODOS os 6 eventos com inListFilter
  // — garante que mesmo eventos com volume baixo apareçam
  const res = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: FUNNEL_EVENTS },
      },
    },
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 50,
  });

  if (res.error) {
    return NextResponse.json(
      { propertyId, error: res.error, events: {} },
      { status: 200 }
    );
  }

  // Constrói mapa eventName → { count, users }
  const events: Record<string, { count: number; users: number }> = {};
  for (const row of res.data?.rows || []) {
    const name = row.dimensionValues?.[0]?.value || "";
    events[name] = {
      count: Number(row.metricValues?.[0]?.value || 0),
      users: Number(row.metricValues?.[1]?.value || 0),
    };
  }

  return NextResponse.json(
    {
      propertyId,
      query: { dateRange, days },
      events,
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
