import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/eventos/explorer
 *
 * Explorer estilo GA4 Exploration — permite cruzar uma DIMENSÃO (ex:
 * eventName, country, deviceCategory, sessionSource) com até 2 MÉTRICAS
 * (eventCount, totalUsers, sessions, eventValue) num período.
 *
 * Retorna:
 *   - rows: tabela ordenada por métrica primária (top 100)
 *   - timeline: série diária da métrica primária total (pro line chart)
 *
 * Public (não master-only) — qualquer user pode explorar eventos.
 */

const ALLOWED_DIMENSIONS = [
  "eventName",
  "sessionDefaultChannelGroup",
  "deviceCategory",
  "country",
  "city",
  "operatingSystem",
  "browser",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
  "pagePath",
  "hostName",
  "newVsReturning",
];

const ALLOWED_METRICS = [
  "eventCount",
  "totalUsers",
  "activeUsers",
  "sessions",
  "engagedSessions",
  "eventValue",
  "averageSessionDuration",
  "bounceRate",
  "screenPageViews",
  "userEngagementDuration",
];

function safeDim(d: string | null, fallback: string): string {
  if (d && ALLOWED_DIMENSIONS.includes(d)) return d;
  return fallback;
}

function safeMetric(m: string | null, fallback: string): string {
  if (m && ALLOWED_METRICS.includes(m)) return m;
  return fallback;
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const dimension = safeDim(req.nextUrl.searchParams.get("dimension"), "eventName");
  const metric = safeMetric(req.nextUrl.searchParams.get("metric"), "eventCount");
  const metric2 = req.nextUrl.searchParams.get("metric2");
  const metric2Safe = metric2 && metric2 !== "none" ? safeMetric(metric2, "totalUsers") : null;

  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");
  const eventFilter = req.nextUrl.searchParams.get("eventFilter") || ""; // filtra por nome de evento (substring)

  // Date range — honra custom ou usa relativo
  const dateRange =
    startDateParam && endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
      ? { startDate: startDateParam, endDate: endDateParam }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // Filter (se eventFilter passado e dimension é eventName, aplicamos como CONTAINS)
  const buildFilter = () => {
    if (eventFilter && dimension === "eventName") {
      return {
        filter: {
          fieldName: "eventName",
          stringFilter: { value: eventFilter, matchType: "CONTAINS" as const },
        },
      };
    }
    return undefined;
  };
  const dimensionFilter = buildFilter();

  // ============================================================
  // 2 queries paralelas: tabela (por dimension) + timeline (por date)
  // ============================================================
  const metricsToQuery = metric2Safe ? [{ name: metric }, { name: metric2Safe }] : [{ name: metric }];

  const [tableRes, timelineRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: dimension }],
      metrics: metricsToQuery,
      orderBys: [{ metric: { metricName: metric }, desc: true }],
      limit: 100,
      dimensionFilter,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }],
      metrics: [{ name: metric }],
      orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
      dimensionFilter,
    }),
  ]);

  if (tableRes.error) {
    return NextResponse.json(
      { propertyId, error: tableRes.error, rows: [], timeline: [] },
      { status: 200 }
    );
  }

  const rows = (tableRes.data?.rows || []).map((r) => ({
    dimension: r.dimensionValues?.[0]?.value || "(empty)",
    metric: Number(r.metricValues?.[0]?.value || 0),
    metric2: metric2Safe ? Number(r.metricValues?.[1]?.value || 0) : null,
  }));

  const timeline = (timelineRes.data?.rows || []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value || "";
    // GA4 retorna YYYYMMDD — formata para YYYY-MM-DD
    const date =
      raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    return {
      date,
      value: Number(r.metricValues?.[0]?.value || 0),
    };
  });

  // Totals
  const totalMetric = rows.reduce((s, r) => s + r.metric, 0);
  const totalMetric2 = metric2Safe ? rows.reduce((s, r) => s + (r.metric2 || 0), 0) : null;

  return NextResponse.json(
    {
      propertyId,
      query: { dimension, metric, metric2: metric2Safe, days, dateRange, eventFilter },
      rows,
      timeline,
      totals: { metric: totalMetric, metric2: totalMetric2 },
      meta: {
        rowCount: rows.length,
        timelineDays: timeline.length,
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
