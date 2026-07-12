import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ga4/pages-detail
 *
 * Retorna páginas com métricas completas — tudo que faltava na rota overview:
 *  - hostName (para diferenciar subdomínios / LPs externas)
 *  - pagePath
 *  - screenPageViews (visualizações)
 *  - totalUsers (usuários únicos)
 *  - averageSessionDuration (tempo médio)
 *  - bounceRate (rejeição)
 *  - sessions (para calcular entradas)
 *  - Sessions com entrances → usa landingPage + sessions aproxima "entrances"
 *  - userEngagementDuration (tempo de engajamento, pra média por usuário)
 *
 * Métricas GA4 Data API usadas:
 *   - screenPageViews (views)
 *   - totalUsers (unique users)
 *   - averageSessionDuration — tempo médio da sessão
 *   - bounceRate — taxa de rejeição (0..1)
 *   - sessions (pra cálculo de entradas/saídas via landing)
 *
 * Query params:
 *   propertyId (obrigatório)
 *   days (default 30)
 *   startDate / endDate (opcional — custom range)
 *   hostContains (opcional)
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

  // Date range: honra custom, senão usa o formato relativo include-today
  const dateRange =
    startDateQ && endDateQ && /^\d{4}-\d{2}-\d{2}$/.test(startDateQ) && /^\d{4}-\d{2}-\d{2}$/.test(endDateQ)
      ? { startDate: startDateQ, endDate: endDateQ }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // 1) Métricas principais agregadas por host + pagePath
  const detailRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "hostName" }, { name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "averageSessionDuration" },
      { name: "bounceRate" },
      { name: "userEngagementDuration" },
      { name: "engagedSessions" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });

  if (detailRes.error || !detailRes.data?.rows) {
    return NextResponse.json({ propertyId, error: detailRes.error || "no rows", pages: [] });
  }

  // 2) Entrances: GA4 expõe "sessions" agregado por landingPage. Buscamos em paralelo
  //    pra compor "entradas por página" — quando uma pagePath == landingPage, a qtd
  //    de sessões é o número de entradas daquela página.
  // Entrances + leads (generate_lead por página) em paralelo.
  const [entrancesRes, leadsRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPagePlusQueryString" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 500,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: { fieldName: "eventName", inListFilter: { values: ["generate_lead", "lead_create_account"] } },
      },
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 500,
    }),
  ]);

  // Leads (generate_lead + lead_create_account) por host|path
  const leadsMap = new Map<string, number>();
  for (const r of leadsRes.data?.rows || []) {
    const host = r.dimensionValues?.[0]?.value || "";
    const path = r.dimensionValues?.[1]?.value || "/";
    leadsMap.set(`${host}|${path}`, (leadsMap.get(`${host}|${path}`) || 0) + Number(r.metricValues?.[0]?.value || 0));
  }

  const entrancesMap = new Map<string, number>();
  for (const r of entrancesRes.data?.rows || []) {
    const host = r.dimensionValues?.[0]?.value || "";
    const path = r.dimensionValues?.[1]?.value || "/";
    // path pode vir com query string — pegamos só o pathname
    const cleanPath = path.split("?")[0];
    const key = `${host}|${cleanPath}`;
    entrancesMap.set(key, (entrancesMap.get(key) || 0) + Number(r.metricValues?.[0]?.value || 0));
  }

  let pages = detailRes.data.rows.map((r) => {
    const host = r.dimensionValues?.[0]?.value || "(sem host)";
    const path = r.dimensionValues?.[1]?.value || "/";
    const views = Number(r.metricValues?.[0]?.value || 0);
    const users = Number(r.metricValues?.[1]?.value || 0);
    const sessions = Number(r.metricValues?.[2]?.value || 0);
    const avgSessionDuration = Number(r.metricValues?.[3]?.value || 0);
    const bounceRate = Number(r.metricValues?.[4]?.value || 0); // decimal 0..1
    const userEngagementDuration = Number(r.metricValues?.[5]?.value || 0);
    const engagedSessions = Number(r.metricValues?.[6]?.value || 0);
    const entries = entrancesMap.get(`${host}|${path}`) || 0;
    const leads = leadsMap.get(`${host}|${path}`) || 0;
    // Exit rate = aproximação: (sessions - (views-sessions))/sessions... preferimos
    // usar o ratio (1 - engagementRate) como aproximação de saída quando engagement
    // não estiver disponível. Se bounceRate == 1 (só rejeição), exitRate == 100%.
    // Mais correto: GA4 não expõe diretamente exits na Data API v1beta. Deixamos
    // exitRate = bounceRate como aproximação (lá é % de sessões que saem só nessa
    // página) — o front marca que é via GA4 UI a fonte ideal.
    return {
      host,
      path,
      url: `${host}${path}`,
      views,
      users,
      sessions,
      avgSessionDuration: Math.round(avgSessionDuration), // seg
      bounceRate: Number((bounceRate * 100).toFixed(1)), // %
      exitRate: Number((bounceRate * 100).toFixed(1)), // aprox — GA4 Data API não expõe exit direto
      entries,
      engagedSessions,
      leads,
      // Connect Rate = leads / sessões (%) — a taxa de captação da LP.
      connectRate: sessions > 0 ? Number(((leads / sessions) * 100).toFixed(2)) : 0,
      engagementRate: sessions > 0 ? Number(((engagedSessions / sessions) * 100).toFixed(1)) : 0,
      engagementPerUser: users > 0 ? Math.round(userEngagementDuration / users) : 0,
    };
  });

  if (hostContains) {
    const needle = hostContains.toLowerCase();
    pages = pages.filter((p) => p.host.toLowerCase().includes(needle));
  }

  // Lista única de hosts para o filtro dropdown na UI
  const hostSet = new Set<string>();
  for (const p of pages) hostSet.add(p.host);
  const hosts = Array.from(hostSet).sort();

  return NextResponse.json(
    {
      propertyId, // anti race-condition
      pages,
      hosts,
      days,
      hostContains,
    },
    {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
    }
  );
}
