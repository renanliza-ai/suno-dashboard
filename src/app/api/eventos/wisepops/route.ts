import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/eventos/wisepops
 *
 * Retorna baseline de Wisepops cruzando 2 eventos:
 *   wisepops_view  → impressão do popup
 *   wisepops_click → clique no popup
 *
 * Tabela calculada:
 *   - Totais globais (views, clicks, CTR%)
 *   - Série diária (timeline pra gráfico)
 *   - Breakdown por pagePath (onde cada popup apareceu)
 */

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");

  const dateRange =
    startDateParam && endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
      ? { startDate: startDateParam, endDate: endDateParam }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  const wisepopsFilter = {
    filter: {
      fieldName: "eventName",
      inListFilter: { values: ["wisepops_view", "wisepops_click"] },
    },
  };

  const [totalsRes, dailyRes, byPageRes] = await Promise.all([
    // 1. Totais agregados por evento
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: wisepopsFilter,
    }),
    // 2. Série diária — date × eventName
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: wisepopsFilter,
      orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
      limit: 500,
    }),
    // 3. Breakdown por pagePath (onde o popup apareceu)
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "pagePath" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: wisepopsFilter,
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 500,
    }),
  ]);

  // ============================================================
  // Totais globais + CTR
  // ============================================================
  let totalViews = 0;
  let totalViewsUsers = 0;
  let totalClicks = 0;
  let totalClicksUsers = 0;
  for (const r of totalsRes.data?.rows || []) {
    const name = r.dimensionValues?.[0]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const users = Number(r.metricValues?.[1]?.value || 0);
    if (name === "wisepops_view") {
      totalViews = count;
      totalViewsUsers = users;
    } else if (name === "wisepops_click") {
      totalClicks = count;
      totalClicksUsers = users;
    }
  }
  const globalCTR = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;

  // ============================================================
  // Série diária — pivot por data
  // ============================================================
  const dailyMap = new Map<string, { date: string; views: number; clicks: number }>();
  for (const r of dailyRes.data?.rows || []) {
    const dateRaw = r.dimensionValues?.[0]?.value || "";
    const eventName = r.dimensionValues?.[1]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const dateFormatted =
      dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : dateRaw;
    if (!dailyMap.has(dateFormatted)) {
      dailyMap.set(dateFormatted, { date: dateFormatted, views: 0, clicks: 0 });
    }
    const entry = dailyMap.get(dateFormatted)!;
    if (eventName === "wisepops_view") entry.views += count;
    if (eventName === "wisepops_click") entry.clicks += count;
  }
  const daily = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      ctr: d.views > 0 ? Number(((d.clicks / d.views) * 100).toFixed(2)) : 0,
    }));

  // ============================================================
  // Breakdown por página
  // ============================================================
  const byPageMap = new Map<
    string,
    { path: string; views: number; clicks: number; viewUsers: number; clickUsers: number }
  >();
  for (const r of byPageRes.data?.rows || []) {
    const path = r.dimensionValues?.[0]?.value || "/";
    const eventName = r.dimensionValues?.[1]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const users = Number(r.metricValues?.[1]?.value || 0);
    if (!byPageMap.has(path)) {
      byPageMap.set(path, { path, views: 0, clicks: 0, viewUsers: 0, clickUsers: 0 });
    }
    const entry = byPageMap.get(path)!;
    if (eventName === "wisepops_view") {
      entry.views += count;
      entry.viewUsers += users;
    } else if (eventName === "wisepops_click") {
      entry.clicks += count;
      entry.clickUsers += users;
    }
  }
  const byPage = Array.from(byPageMap.values())
    .filter((p) => p.views > 0 || p.clicks > 0)
    .map((p) => ({
      ...p,
      ctr: p.views > 0 ? Number(((p.clicks / p.views) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.views - a.views);

  // Estatísticas pro baseline (mediana, percentis)
  const ctrs = byPage.filter((p) => p.views >= 100).map((p) => p.ctr).sort((a, b) => a - b);
  const median = ctrs.length > 0 ? ctrs[Math.floor(ctrs.length / 2)] : 0;
  const p25 = ctrs.length > 0 ? ctrs[Math.floor(ctrs.length * 0.25)] : 0;
  const p75 = ctrs.length > 0 ? ctrs[Math.floor(ctrs.length * 0.75)] : 0;
  const maxCTR = ctrs.length > 0 ? ctrs[ctrs.length - 1] : 0;
  const minCTR = ctrs.length > 0 ? ctrs[0] : 0;

  return NextResponse.json(
    {
      propertyId,
      query: { dateRange, days },
      totals: {
        views: totalViews,
        viewsUsers: totalViewsUsers,
        clicks: totalClicks,
        clicksUsers: totalClicksUsers,
        ctr: Number(globalCTR.toFixed(2)),
      },
      daily,
      byPage,
      baseline: {
        ctrMedian: median,
        ctrP25: p25,
        ctrP75: p75,
        ctrMax: maxCTR,
        ctrMin: minCTR,
        samplePagesWithSignificantVolume: ctrs.length,
        note:
          "Baseline calculado em páginas com pelo menos 100 views no período (volume estatisticamente significante).",
      },
      meta: {
        totalDays: daily.length,
        totalPages: byPage.length,
        hasError: !!(totalsRes.error || dailyRes.error || byPageRes.error),
        errors: {
          totals: totalsRes.error,
          daily: dailyRes.error,
          byPage: byPageRes.error,
        },
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
