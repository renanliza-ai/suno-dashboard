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
 *   hostContains (opcional, legacy) — filtra hostName por substring única (ex: "greatpages")
 *   hostsIn (opcional) — lista CSV de hostnames pra filtrar via inListFilter server-side
 *                       (ex: "lp.suno.com.br,lp2.suno.com.br"). Quando presente,
 *                       SOBRESCREVE hostContains. Útil pra LP Analyzer que cruza
 *                       múltiplos hostnames de captação por property.
 *   leadEvent (default "generate_lead") — nome do evento de conversão de lead pra
 *                       calcular leadCount + leadConvRate por LP (LPs de captação
 *                       com formulário).
 *   ctaEvent (default "cta_click") — nome do evento de clique no CTA pra calcular
 *                       ctaCount + ctaConvRate por LP (LPs que levam direto ao
 *                       checkout, sem formulário próprio).
 *   limit (default 100)
 *
 * Resposta inclui AMBAS as métricas por LP: leadCount/leadConvRate +
 * ctaCount/ctaConvRate. O front decide qual é a métrica primária por LP
 * (auto-detecção: o evento que mais disparou define o tipo).
 */
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateQ = req.nextUrl.searchParams.get("startDate");
  const endDateQ = req.nextUrl.searchParams.get("endDate");
  const hostContains = req.nextUrl.searchParams.get("hostContains") || "";
  const hostsInRaw = req.nextUrl.searchParams.get("hostsIn") || "";
  const leadEvent = req.nextUrl.searchParams.get("leadEvent") || "generate_lead";
  const ctaEvent = req.nextUrl.searchParams.get("ctaEvent") || "cta_click";
  const limit = Number(req.nextUrl.searchParams.get("limit") || 100);

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  // Parse hostsIn — lista CSV trim+lower
  const hostsIn = hostsInRaw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  // Calcula o date range — honra custom start/end quando passados, senão usa o
  // formato relativo `${days}daysAgo`/`today` (preserva comportamento original
  // que inclui o dia atual; evita regressão de eventos/sessões recentes sumirem).
  const dateRange =
    startDateQ && endDateQ && /^\d{4}-\d{2}-\d{2}$/.test(startDateQ) && /^\d{4}-\d{2}-\d{2}$/.test(endDateQ)
      ? { startDate: startDateQ, endDate: endDateQ }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // Server-side filter — quando hostsIn presente, aplica inListFilter (OR de hostnames)
  // direto no GA4. Mais eficiente que filtrar client-side (evita corte por `limit`
  // antes do filtro). Caso hostsIn não esteja presente, deixa hostContains como
  // fallback client-side (comportamento legacy).
  const hostFilter =
    hostsIn.length > 0
      ? {
          filter: {
            fieldName: "hostName",
            inListFilter: { values: hostsIn, caseSensitive: false },
          },
        }
      : undefined;

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
    ...(hostFilter ? { dimensionFilter: hostFilter } : {}),
  });

  if (pagesRes.error || !pagesRes.data?.rows) {
    return NextResponse.json({ propertyId, error: pagesRes.error || "no rows", rows: [] });
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
      leadCount: 0, // populado abaixo
      leadConvRate: 0, // populado abaixo
      ctaCount: 0, // populado abaixo
      ctaConvRate: 0, // populado abaixo
    };
  });

  // Fallback legacy: hostContains client-side só se hostsIn vazio
  if (hostsIn.length === 0 && hostContains) {
    const needle = hostContains.toLowerCase();
    pages = pages.filter((p) => p.host.toLowerCase().includes(needle));
  }

  // Helper pra construir filtro de evento + host
  const buildEventFilter = (eventName: string) => ({
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "eventName",
            stringFilter: { matchType: "EXACT" as const, value: eventName },
          },
        },
        ...(hostsIn.length > 0
          ? [
              {
                filter: {
                  fieldName: "hostName",
                  inListFilter: { values: hostsIn, caseSensitive: false },
                },
              },
            ]
          : []),
      ],
    },
  });

  // 2. Lead conversions por landing page — métrica primária de LP de captação
  //    (regra Suno: conv = generate_lead / sessions)
  // 3. CTA conversions por landing page — métrica primária de LP que leva
  //    direto ao checkout (não tem formulário, conv = cta_click / sessions)
  // Rodadas em paralelo pra economizar latência.
  const [leadsRes, ctaRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPagePlusQueryString" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: Math.max(limit, 200),
      dimensionFilter: buildEventFilter(leadEvent),
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPagePlusQueryString" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: Math.max(limit, 200),
      dimensionFilter: buildEventFilter(ctaEvent),
    }),
  ]);

  // Helper genérico pra agregar contagem por (host, path)
  const buildEventMap = (res: typeof leadsRes): Map<string, number> => {
    const map = new Map<string, number>();
    if (res.error || !res.data?.rows) return map;
    for (const r of res.data.rows) {
      const host = r.dimensionValues?.[0]?.value || "";
      const path = r.dimensionValues?.[1]?.value || "/";
      const key = `${host.toLowerCase()}|${path}`;
      const count = Number(r.metricValues?.[0]?.value || 0);
      map.set(key, (map.get(key) || 0) + count);
    }
    return map;
  };

  const leadMap = buildEventMap(leadsRes);
  const ctaMap = buildEventMap(ctaRes);

  pages = pages.map((p) => {
    const key = `${p.host.toLowerCase()}|${p.path}`;
    const leadCount = leadMap.get(key) || 0;
    const ctaCount = ctaMap.get(key) || 0;
    return {
      ...p,
      leadCount,
      leadConvRate: p.sessions > 0 ? leadCount / p.sessions : 0,
      ctaCount,
      ctaConvRate: p.sessions > 0 ? ctaCount / p.sessions : 0,
    };
  });

  // 3. Breakdown de source/medium → landingPage (para o filtro "origens/mídias que
  // mais levam acesso para essas LPs"). Aplica mesmo hostFilter server-side.
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
    ...(hostFilter ? { dimensionFilter: hostFilter } : {}),
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

  // Fallback legacy do hostContains
  const filteredSourceRows =
    hostsIn.length === 0 && hostContains
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
      propertyId, // anti race-condition
      pages,
      sourceBreakdown: filteredSourceRows,
      topSources,
      days,
      hostContains,
      hostsIn,
      leadEvent,
      ctaEvent,
    },
    {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
    }
  );
}
