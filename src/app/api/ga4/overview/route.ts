import { getKpis, getTrend, getTopPages, getTopEvents } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  const daysRaw = Number(req.nextUrl.searchParams.get("days") || 30);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 730 ? Math.floor(daysRaw) : 30;
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");

  // Parallel fetch — all four in one round trip (optimized payload)
  const [kpis, trend, pages, events] = await Promise.all([
    getKpis(propertyId, days, startDate, endDate),
    getTrend(propertyId, days, startDate, endDate),
    getTopPages(propertyId, 5, days, startDate, endDate),
    // limit 50 pra que /eventos e /tracking enxerguem a taxonomia completa
    // de eventos da property — antes era 8, o que "escondia" eventos reais.
    getTopEvents(propertyId, 50, days, startDate, endDate),
  ]);

  return NextResponse.json(
    {
      propertyId, // ⚠ inclui propertyId pra cliente validar (anti race-condition)
      kpis: kpis.data,
      trend: trend.data,
      pages: pages.data,
      events: events.data,
      days,
      range: kpis.data?.range || null,
      errors: {
        kpis: kpis.error,
        trend: trend.error,
        pages: pages.error,
        events: events.error,
      },
    },
    {
      headers: {
        // Cache reduzido — antes era 5min e bloqueava refresh ao trocar property
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      },
    }
  );
}
