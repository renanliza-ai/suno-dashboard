import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/campaign-comparison
 *
 * Dado uma campanha recorrente + lista de edições (datas), retorna comparativo
 * diário cross-year alinhado pelo "dia 1 da campanha".
 *
 * Query params:
 *   propertyId (obrigatório)
 *   editions (obrigatório) — JSON encoded: [{year, startDate, endDate, utmPatterns}]
 *   campaignId (obrigatório) — pra label
 *
 * Retorna:
 *   - editions[]: dados completos de cada edição
 *   - dailySeries[]: array alinhado por "dia X da campanha" com colunas por ano
 *   - topPages[]: top 5 LPs por edição
 *   - topChannels[]: top 5 canais por edição
 *   - funnel[]: visitor → lead → purchase por edição
 *   - baseline: projeção pra próxima edição
 */

type EditionInput = {
  year: number;
  startDate: string;
  endDate: string;
  utmPatterns?: string[]; // UTMs específicos pra essa edição (opcional)
};

type DailyPoint = {
  dayOffset: number; // dias desde startDate
  date: string; // ISO
  sessions: number;
  users: number;
  leads: number;
  purchases: number;
  revenue: number;
};

type EditionResult = {
  year: number;
  startDate: string;
  endDate: string;
  durationDays: number;
  totals: {
    sessions: number;
    users: number;
    leads: number;
    purchases: number;
    revenue: number;
    avgTicket: number;
    leadConversion: number; // leads / sessions × 100
    purchaseConversion: number; // purchases / sessions × 100
  };
  daily: DailyPoint[];
  topPages: { path: string; sessions: number; leads: number }[];
  topChannels: { channel: string; sessions: number; leads: number; purchases: number; revenue: number }[];
};

function parseGA4Date(s: string): Date {
  if (/^\d{8}$/.test(s)) {
    return new Date(
      Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
    );
  }
  return new Date(s + "T00:00:00Z");
}

function dayOffset(date: Date, base: Date): number {
  return Math.round((date.getTime() - base.getTime()) / 86_400_000);
}

function buildCampaignFilter(utmPatterns?: string[]) {
  // Se a edição passou patterns específicos, usa-os; caso contrário,
  // o caller já deve ter filtrado dimensionFilter externamente.
  if (!utmPatterns || utmPatterns.length === 0) return undefined;
  // Match exato + matches por contains. GA4 suporta lista exata via inListFilter,
  // mas contains não. Usamos orGroup com 1 expression por pattern.
  return {
    orGroup: {
      expressions: utmPatterns.map((p) => ({
        filter: {
          fieldName: "sessionCampaignName",
          stringFilter: { matchType: "CONTAINS", value: p, caseSensitive: false },
        },
      })),
    },
  };
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const editionsRaw = req.nextUrl.searchParams.get("editions");
  const campaignId = req.nextUrl.searchParams.get("campaignId");

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!editionsRaw) return NextResponse.json({ error: "editions required (JSON)" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  let editions: EditionInput[] = [];
  try {
    editions = JSON.parse(editionsRaw);
  } catch {
    return NextResponse.json({ error: "editions must be valid JSON" }, { status: 400 });
  }
  if (editions.length === 0) {
    return NextResponse.json({ error: "at least 1 edition required" }, { status: 400 });
  }

  // Pra cada edição, roda 4 queries em paralelo (sessions+leads+purchases por dia,
  // top pages, top channels)
  const editionResults: EditionResult[] = [];

  for (const ed of editions) {
    const range = { startDate: ed.startDate, endDate: ed.endDate };
    const startDate = parseGA4Date(ed.startDate.replace(/-/g, ""));
    const endDate = parseGA4Date(ed.endDate.replace(/-/g, ""));
    const duration =
      Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

    const campaignFilter = buildCampaignFilter(ed.utmPatterns);

    // Query 1: sessões e usuários diários
    // Query 2: eventos (lead + purchase) diários com receita
    // Query 3: top páginas
    // Query 4: top canais (sessionDefaultChannelGroup)
    const [sessRes, eventsRes, pagesRes, channelsRes] = await Promise.all([
      runReport(propertyId, {
        dateRanges: [range],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        dimensionFilter: campaignFilter,
        orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
        limit: 100,
      }),
      runReport(propertyId, {
        dateRanges: [range],
        dimensions: [{ name: "date" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "eventValue" }],
        dimensionFilter: campaignFilter
          ? {
              andGroup: {
                expressions: [
                  campaignFilter,
                  {
                    filter: {
                      fieldName: "eventName",
                      inListFilter: { values: ["generate_lead", "purchase", "purchase_success"] },
                    },
                  },
                ],
              },
            }
          : {
              filter: {
                fieldName: "eventName",
                inListFilter: { values: ["generate_lead", "purchase", "purchase_success"] },
              },
            },
        limit: 1000,
      }),
      runReport(propertyId, {
        dateRanges: [range],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "sessions" }],
        dimensionFilter: campaignFilter,
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      runReport(propertyId, {
        dateRanges: [range],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        dimensionFilter: campaignFilter,
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
    ]);

    // Compõe daily series alinhada por dayOffset
    const dailyMap = new Map<number, DailyPoint>();
    // Inicializa todos os offsets pra não dar furo no gráfico
    for (let i = 0; i < duration; i++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      dailyMap.set(i, {
        dayOffset: i,
        date: d.toISOString().slice(0, 10),
        sessions: 0,
        users: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
      });
    }

    for (const r of sessRes.data?.rows || []) {
      const dateStr = r.dimensionValues?.[0]?.value || "";
      const date = parseGA4Date(dateStr);
      const offset = dayOffset(date, startDate);
      const point = dailyMap.get(offset);
      if (point) {
        point.sessions = Number(r.metricValues?.[0]?.value || 0);
        point.users = Number(r.metricValues?.[1]?.value || 0);
      }
    }

    for (const r of eventsRes.data?.rows || []) {
      const dateStr = r.dimensionValues?.[0]?.value || "";
      const eventName = r.dimensionValues?.[1]?.value || "";
      const count = Number(r.metricValues?.[0]?.value || 0);
      const value = Number(r.metricValues?.[1]?.value || 0);
      const date = parseGA4Date(dateStr);
      const offset = dayOffset(date, startDate);
      const point = dailyMap.get(offset);
      if (!point) continue;
      if (eventName === "generate_lead") {
        point.leads += count;
      } else if (eventName === "purchase" || eventName === "purchase_success") {
        point.purchases += count;
        point.revenue += value;
      }
    }

    const daily = [...dailyMap.values()].sort((a, b) => a.dayOffset - b.dayOffset);
    const totals = daily.reduce(
      (acc, d) => ({
        sessions: acc.sessions + d.sessions,
        users: acc.users + d.users,
        leads: acc.leads + d.leads,
        purchases: acc.purchases + d.purchases,
        revenue: acc.revenue + d.revenue,
      }),
      { sessions: 0, users: 0, leads: 0, purchases: 0, revenue: 0 }
    );

    // Top pages — agrega leads por path cross-referencing eventsRes não dá granularidade,
    // então deixamos só sessions e estimamos leads proporcionalmente
    const topPages = (pagesRes.data?.rows || []).map((r) => {
      const path = r.dimensionValues?.[0]?.value || "/";
      const pageSessions = Number(r.metricValues?.[0]?.value || 0);
      const estLeads =
        totals.sessions > 0
          ? Math.round((pageSessions / totals.sessions) * totals.leads)
          : 0;
      return { path, sessions: pageSessions, leads: estLeads };
    });

    // Top channels — sessions reais; leads e purchases estimados pelos pesos
    const topChannels = (channelsRes.data?.rows || []).map((r) => {
      const channel = r.dimensionValues?.[0]?.value || "(direct)";
      const chSessions = Number(r.metricValues?.[0]?.value || 0);
      const weight = totals.sessions > 0 ? chSessions / totals.sessions : 0;
      return {
        channel,
        sessions: chSessions,
        leads: Math.round(weight * totals.leads),
        purchases: Math.round(weight * totals.purchases),
        revenue: Math.round(weight * totals.revenue),
      };
    });

    editionResults.push({
      year: ed.year,
      startDate: ed.startDate,
      endDate: ed.endDate,
      durationDays: duration,
      totals: {
        ...totals,
        avgTicket: totals.purchases > 0 ? Number((totals.revenue / totals.purchases).toFixed(2)) : 0,
        leadConversion:
          totals.sessions > 0 ? Number(((totals.leads / totals.sessions) * 100).toFixed(2)) : 0,
        purchaseConversion:
          totals.sessions > 0 ? Number(((totals.purchases / totals.sessions) * 100).toFixed(2)) : 0,
      },
      daily,
      topPages,
      topChannels,
    });
  }

  // ============================================================
  // Baseline preditivo pra PRÓXIMA edição
  // ============================================================
  // Média + intervalo de confiança (min/max histórico) + tendência YoY
  type Baseline = {
    avgSessions: { value: number; min: number; max: number };
    avgLeads: { value: number; min: number; max: number };
    avgPurchases: { value: number; min: number; max: number };
    avgRevenue: { value: number; min: number; max: number };
    leadConversion: number;
    purchaseConversion: number;
    yoyGrowth: number | null;
    projection: {
      sessions: number;
      leads: number;
      purchases: number;
      revenue: number;
      note: string;
    } | null;
  };

  const sortedByYear = [...editionResults].sort((a, b) => a.year - b.year);
  const n = sortedByYear.length;
  let baseline: Baseline | null = null;

  if (n > 0) {
    const sessions = sortedByYear.map((e) => e.totals.sessions);
    const leads = sortedByYear.map((e) => e.totals.leads);
    const purchases = sortedByYear.map((e) => e.totals.purchases);
    const revenue = sortedByYear.map((e) => e.totals.revenue);

    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const range = (arr: number[]) => ({ min: Math.min(...arr), max: Math.max(...arr) });

    const avgSess = avg(sessions);
    const avgLeads = avg(leads);
    const avgPurch = avg(purchases);
    const avgRev = avg(revenue);

    let yoyGrowth: number | null = null;
    if (n >= 2) {
      const last = sortedByYear[n - 1].totals.sessions;
      const prev = sortedByYear[n - 2].totals.sessions;
      if (prev > 0) yoyGrowth = ((last - prev) / prev) * 100;
    }

    // Projeção: aplica tendência YoY ao último valor; se só temos 1 edição,
    // usamos o valor dela mesma como projeção
    let projection: Baseline["projection"] = null;
    const last = sortedByYear[n - 1];
    if (last) {
      const growthFactor = yoyGrowth !== null ? 1 + yoyGrowth / 100 : 1;
      projection = {
        sessions: Math.round(last.totals.sessions * growthFactor),
        leads: Math.round(last.totals.leads * growthFactor),
        purchases: Math.round(last.totals.purchases * growthFactor),
        revenue: Math.round(last.totals.revenue * growthFactor),
        note:
          yoyGrowth !== null
            ? `Projeção baseada em tendência YoY de ${yoyGrowth.toFixed(1)}% (última edição × growth)`
            : "Projeção igual à única edição histórica (sem tendência calculável)",
      };
    }

    baseline = {
      avgSessions: { value: Math.round(avgSess), ...range(sessions) },
      avgLeads: { value: Math.round(avgLeads), ...range(leads) },
      avgPurchases: { value: Math.round(avgPurch), ...range(purchases) },
      avgRevenue: { value: Math.round(avgRev), ...range(revenue) },
      leadConversion:
        avgSess > 0 ? Number(((avgLeads / avgSess) * 100).toFixed(2)) : 0,
      purchaseConversion:
        avgSess > 0 ? Number(((avgPurch / avgSess) * 100).toFixed(2)) : 0,
      yoyGrowth: yoyGrowth !== null ? Number(yoyGrowth.toFixed(1)) : null,
      projection,
    };
  }

  // ============================================================
  // Daily series alinhada por dayOffset — formato pivot pro chart sobreposto
  // ============================================================
  const maxDuration = Math.max(...editionResults.map((e) => e.durationDays));
  type PivotPoint = { dayOffset: number; [year: string]: number };
  const dailyPivot: PivotPoint[] = [];
  for (let i = 0; i < maxDuration; i++) {
    const point: PivotPoint = { dayOffset: i };
    for (const ed of editionResults) {
      const d = ed.daily.find((p) => p.dayOffset === i);
      point[`sessions_${ed.year}`] = d?.sessions || 0;
      point[`leads_${ed.year}`] = d?.leads || 0;
      point[`purchases_${ed.year}`] = d?.purchases || 0;
    }
    dailyPivot.push(point);
  }

  return NextResponse.json(
    {
      propertyId,
      campaignId,
      editions: editionResults,
      dailyPivot,
      baseline,
      meta: {
        totalEditions: editionResults.length,
        maxDuration,
      },
    },
    { headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=1800" } }
  );
}
