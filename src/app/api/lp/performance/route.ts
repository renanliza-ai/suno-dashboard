import { runReport } from "@/lib/ga4-server";
import {
  computeLPConversion,
  isJunkHost,
  isThankPage,
  resolveBU,
  type BUProfile,
} from "@/lib/bu";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/lp/performance — DESEMPENHO DE LANDING PAGE, com a regra da B.U. aplicada.
 *
 * Substitui o uso de /api/ga4/pages-detail para landing page. A diferença não é
 * cosmética:
 *
 *   1. Filtra host de LP NO SERVIDOR (`hostsIn`), antes do corte de linhas.
 *      Sem isso a agregação sai truncada: pagePath devolve exatamente 3.000
 *      linhas em Research e Status, e a cauda longa nunca chega.
 *   2. Usa `landingPage`, ou seja, a página de ENTRADA da sessão.
 *      `pagePath` contaria qualquer visualização e infla o denominador.
 *   3. Exclui Thank Page do numerador. O cta_click dispara em /obrigado/ e é
 *      clique pós-conversão.
 *   4. Aplica a regra de conversão da B.U. via src/lib/bu.ts. Na Consultoria o
 *      lead vem da soma dos eventos de qualificação, porque o generate_lead
 *      está duplicado desde 22/07/2026.
 *
 * Query params:
 *   propertyId    (obrigatório)
 *   propertyName  (obrigatório) — usado para resolver a B.U. e, com ela, quais
 *                 hosts são LP e qual evento é conversão. Sem o nome não há
 *                 como saber a regra, e o endpoint recusa em vez de adivinhar.
 *   startDate / endDate (YYYY-MM-DD) ou days (default 30)
 *   pathContains  (opcional) — recorte por caminho, ex. "/asset/" para a B.U. Asset
 *   limit         (default 200)
 *   includeThankPages=true (opcional) — só para depuração
 */

type LPRow = {
  host: string;
  path: string;
  url: string;
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  users: number;
  avgSessionDuration: number;
  bounceRate: number;
  leads: number;
  leadsSource: string;
  qualified: number | null;
  disqualified: number | null;
  qualificationRate: number | null;
  ctaClicks: number | null;
  connectRate: number | null;
  ctaRate: number | null;
  isThankPage: boolean;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const propertyName = sp.get("propertyName");
  const days = Number(sp.get("days") || 30);
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const pathContains = (sp.get("pathContains") || "").toLowerCase();
  const limit = Math.min(Number(sp.get("limit") || 200), 1000);
  const includeThankPages = sp.get("includeThankPages") === "true";

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  if (!propertyName) {
    return NextResponse.json(
      {
        error: "propertyName_required",
        detail:
          "A regra de conversão depende da B.U. Sem propertyName não é possível saber qual host é landing page nem qual evento é conversão, e este endpoint não adivinha.",
      },
      { status: 400 }
    );
  }

  const profile: BUProfile = resolveBU(propertyName);

  const dateRange =
    startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? { startDate, endDate }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // B.U. sem dado confiável: devolve o motivo, nunca número.
  // Regra ZERO MOCK: melhor tela vazia explicando a lacuna que gráfico bonito
  // com número que não sustenta.
  if (profile.blocked || profile.lpHosts.length === 0) {
    return NextResponse.json(
      {
        propertyId,
        bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
        blocked:
          profile.blocked ||
          `Não há host de landing page mapeado para ${profile.label}. Sem host não é possível separar LP de portal.`,
        caveats: profile.caveats,
        rows: [],
        totals: null,
        range: dateRange,
      },
      { status: 200, headers: { "Cache-Control": "private, max-age=300" } }
    );
  }

  const hostFilter = {
    filter: {
      fieldName: "hostName",
      inListFilter: { values: profile.lpHosts, caseSensitive: false },
    },
  };

  // Eventos que interessam nesta B.U., em UMA query, quebrados por eventName.
  const events: string[] = [];
  if (profile.leadEvent) events.push(profile.leadEvent);
  if (profile.mqlEvents) events.push(profile.mqlEvents.qualified, profile.mqlEvents.disqualified);
  if (profile.ctaEvent) events.push(profile.ctaEvent);

  const eventFilter =
    events.length > 0
      ? {
          andGroup: {
            expressions: [
              hostFilter,
              { filter: { fieldName: "eventName", inListFilter: { values: events } } },
            ],
          },
        }
      : hostFilter;

  const [sessionsRes, eventsRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPage" }],
      metrics: [
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "totalUsers" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit,
      dimensionFilter: hostFilter,
    }),
    events.length > 0
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [
            { name: "hostName" },
            { name: "landingPage" },
            { name: "eventName" },
          ],
          metrics: [{ name: "eventCount" }],
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
          limit: 2000,
          dimensionFilter: eventFilter,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (sessionsRes.error) {
    return NextResponse.json(
      {
        propertyId,
        bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
        error: sessionsRes.error,
        rows: [],
        totals: null,
        range: dateRange,
      },
      { status: 200 }
    );
  }

  // Mapa (host|path) -> { evento: contagem }
  const evMap = new Map<string, Record<string, number>>();
  for (const r of eventsRes.data?.rows || []) {
    const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const path = r.dimensionValues?.[1]?.value || "/";
    const ev = r.dimensionValues?.[2]?.value || "";
    const n = Number(r.metricValues?.[0]?.value || 0);
    const key = `${host}|${path}`;
    const bucket = evMap.get(key) || {};
    bucket[ev] = (bucket[ev] || 0) + n;
    evMap.set(key, bucket);
  }

  const rows: LPRow[] = [];
  for (const r of sessionsRes.data?.rows || []) {
    const host = r.dimensionValues?.[0]?.value || "(sem host)";
    if (isJunkHost(host)) continue;
    const path = r.dimensionValues?.[1]?.value || "/";
    // "(not set)" aparece quando o GA4 não conseguiu resolver a página de
    // entrada da sessão. Não é uma LP: exibir como linha sugeriria que existe
    // uma página com aquele volume.
    if (path === "(not set)" || path === "(other)") continue;
    if (pathContains && !path.toLowerCase().includes(pathContains)) continue;

    const thank = isThankPage(path);
    if (thank && !includeThankPages) continue;

    const sessions = Number(r.metricValues?.[0]?.value || 0);
    const engagedSessions = Number(r.metricValues?.[1]?.value || 0);
    const bucket = evMap.get(`${host.toLowerCase()}|${path}`) || {};

    const conv = computeLPConversion(profile, {
      sessions,
      leadEventCount: profile.leadEvent ? bucket[profile.leadEvent] || 0 : 0,
      qualified: profile.mqlEvents ? bucket[profile.mqlEvents.qualified] || 0 : 0,
      disqualified: profile.mqlEvents ? bucket[profile.mqlEvents.disqualified] || 0 : 0,
      ctaCount: profile.ctaEvent ? bucket[profile.ctaEvent] || 0 : 0,
    });

    rows.push({
      host,
      path,
      url: `https://${host}${path}`,
      sessions,
      engagedSessions,
      engagementRate: sessions > 0 ? Number(((engagedSessions / sessions) * 100).toFixed(1)) : null,
      users: Number(r.metricValues?.[2]?.value || 0),
      avgSessionDuration: Number(r.metricValues?.[3]?.value || 0),
      bounceRate: Number(Number(r.metricValues?.[4]?.value || 0).toFixed(1)),
      leads: conv.leads,
      leadsSource: conv.leadsSource,
      qualified: conv.qualified,
      disqualified: conv.disqualified,
      qualificationRate: conv.qualificationRate,
      ctaClicks: conv.ctaClicks,
      connectRate: conv.connectRate,
      ctaRate: conv.ctaRate,
      isThankPage: thank,
    });
  }

  // Totais recalculados a partir das linhas, não somando taxa (média de taxa mente).
  const sum = (f: (r: LPRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tSessions = sum((r) => r.sessions);
  const tEngaged = sum((r) => r.engagedSessions);
  const tLeads = sum((r) => r.leads);
  const tQual = profile.mqlEvents ? sum((r) => r.qualified || 0) : null;
  const tDisq = profile.mqlEvents ? sum((r) => r.disqualified || 0) : null;
  const tCta = profile.ctaEvent ? sum((r) => r.ctaClicks || 0) : null;

  const totals = {
    landingPages: rows.length,
    sessions: tSessions,
    engagedSessions: tEngaged,
    engagementRate: tSessions > 0 ? Number(((tEngaged / tSessions) * 100).toFixed(1)) : null,
    leads: tLeads,
    qualified: tQual,
    disqualified: tDisq,
    qualificationRate:
      tQual !== null && tLeads > 0 ? Number(((tQual / tLeads) * 100).toFixed(1)) : null,
    ctaClicks: tCta,
    connectRate: tSessions > 0 ? Number(((tLeads / tSessions) * 100).toFixed(2)) : null,
    ctaRate: tCta !== null && tSessions > 0 ? Number(((tCta / tSessions) * 100).toFixed(2)) : null,
  };

  return NextResponse.json(
    {
      propertyId, // anti race-condition: o cliente descarta resposta de property antiga
      bu: {
        key: profile.key,
        label: profile.label,
        conversionModel: profile.conversionModel,
        leadEvent: profile.leadEvent,
        mqlEvents: profile.mqlEvents,
        ctaEvent: profile.ctaEvent,
        leadDivisor: profile.leadDivisor,
      },
      lpHosts: profile.lpHosts,
      caveats: profile.caveats,
      blocked: null,
      rows,
      totals,
      range: dateRange,
      meta: {
        eventsQueried: events,
        thankPagesExcluded: !includeThankPages,
        rowsReturnedByGa4: sessionsRes.data?.rows?.length || 0,
        truncated: (sessionsRes.data?.rows?.length || 0) >= limit,
      },
    },
    { headers: { "Cache-Control": "private, max-age=180, stale-while-revalidate=600" } }
  );
}
