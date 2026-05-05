import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ga4/landing-pages
 *
 * Retorna landing pages (primeira página da sessão) com métricas de engajamento,
 * dimensão de hostName pra distinguir LPs em subdomínios (ex: GreatPages) do
 * domínio principal. Também trás sessionSource/Medium pra permitir filtro na UI.
 *
 * Query params:
 *   propertyId (obrigatório)
 *   days (default 30)
 *   hostContains (opcional) — filtra hostName por substring (ex: "greatpages")
 *   limit (default 100)
 */
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateQ = req.nextUrl.searchParams.get("startDate");
  const endDateQ = req.nextUrl.searchParams.get("endDate");
  const hostContains = req.nextUrl.searchParams.get("hostContains") || "";
  const limit = Number(req.nextUrl.searchParams.get("limit") || 100);

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  // Calcula o date range — honra custom start/end quando passados, senão usa o
  // formato relativo `${days}daysAgo`/`today` (preserva comportamento original
  // que inclui o dia atual; evita regressão de eventos/sessões recentes sumirem).
  const dateRange =
    startDateQ && endDateQ && /^\d{4}-\d{2}-\d{2}$/.test(startDateQ) && /^\d{4}-\d{2}-\d{2}$/.test(endDateQ)
      ? { startDate: startDateQ, endDate: endDateQ }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // 1. Landing pages agregadas por hostName + landingPage (sem breakdown de source,
  // pra ter uma linha por LP). Isso é a tabela principal.
  const pagesRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "hostName" }, { name: "landingPagePlusQueryString" }],
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "averageSessionDuration" },
      { name: "bounceRate" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });

  if (pagesRes.error || !pagesRes.data?.rows) {
    return NextResponse.json({ error: pagesRes.error || "no rows", rows: [] });
  }

  let pages = pagesRes.data.rows.map((r) => {
    const host = r.dimensionValues?.[0]?.value || "(sem host)";
    const path = r.dimensionValues?.[1]?.value || "/";
    const sessions = Number(r.metricValues?.[1]?.value || 0);
    const engagedSessions = Number(r.metricValues?.[2]?.value || 0);
    return {
      host,
      path,
      url: `${host}${path}`,
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions,
      engagedSessions,
      engagementRate: sessions > 0 ? engagedSessions / sessions : 0,
      avgSessionDuration: Number(r.metricValues?.[3]?.value || 0),
      bounceRate: Number(r.metricValues?.[4]?.value || 0),
    };
  });

  if (hostContains) {
    const needle = hostContains.toLowerCase();
    pages = pages.filter((p) => p.host.toLowerCase().includes(needle));
  }

  // 2. Breakdown de source/medium → landingPage (para o filtro "origens/mídias que
  // mais levam acesso para essas LPs"). Respeita hostContains via aggregation client-side.
  const sourcesRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [
      { name: "hostName" },
      { name: "landingPagePlusQueryString" },
      { name: "sessionSource" },
      { name: "sessionMedium" },
    ],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 500,
  });

  const sourceRows =
    sourcesRes.data?.rows?.map((r) => {
      const host = r.dimensionValues?.[0]?.value || "";
      const path = r.dimensionValues?.[1]?.value || "/";
      return {
        host,
        path,
        url: `${host}${path}`,
        source: r.dimensionValues?.[2]?.value || "(direct)",
        medium: r.dimensionValues?.[3]?.value || "(none)",
        sessions: Number(r.metricValues?.[0]?.value || 0),
        users: Number(r.metricValues?.[1]?.value || 0),
      };
    }) || [];

  const filteredSourceRows = hostContains
    ? sourceRows.filter((r) => r.host.toLowerCase().includes(hostContains.toLowerCase()))
    : sourceRows;

  // Top origens/mídias agregadas (para o filtro global)
  const sourceAgg = new Map<string, { source: string; medium: string; sessions: number; users: number }>();
  for (const r of filteredSourceRows) {
    const key = `${r.source}|${r.medium}`;
    const existing = sourceAgg.get(key);
    if (existing) {
      existing.sessions += r.sessions;
      existing.users += r.users;
    } else {
      sourceAgg.set(key, { source: r.source, medium: r.medium, sessions: r.sessions, users: r.users });
    }
  }
  const topSources = Array.from(sourceAgg.values())
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20);

  return NextResponse.json(
    {
      pages,
      sourceBreakdown: filteredSourceRows,
      topSources,
      days,
      hostContains,
    },
    {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" },
    }
  );
}
