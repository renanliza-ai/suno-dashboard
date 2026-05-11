import { runReport } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ga4/anomaly-detail
 *
 * 🔒 Master-only.
 *
 * Drill-down de uma anomalia específica detectada em /anomalias.
 * Retorna:
 *   - Série diária (14d) da métrica filtrada pelo segmento (canal ou campanha)
 *   - Top campanhas DENTRO do segmento (quando level=channel)
 *   - Top fonte/meio + páginas (quando level=campaign)
 *   - Top eventos quando aplicável (leads, purchases)
 *
 * Query params:
 *   propertyId   (obrigatório)
 *   level        macro | channel | campaign
 *   segment      nome do canal/campanha (ou "all" pra macro)
 *   metric       users | sessions | engagedSessions | leads | purchases | revenue
 *   baselineDays default 14
 */
type AnomalyMetric = "users" | "sessions" | "engagedSessions" | "leads" | "purchases" | "revenue";
type AnomalyLevel = "macro" | "channel" | "campaign";

const SESSION_METRICS: Partial<Record<AnomalyMetric, string>> = {
  users: "totalUsers",
  sessions: "sessions",
  engagedSessions: "engagedSessions",
};

const EVENT_NAMES: Partial<Record<AnomalyMetric, string[]>> = {
  leads: ["generate_lead", "lead", "form_submit_lead", "lead_submit"],
  purchases: ["purchase", "purchase_success"],
  revenue: ["purchase", "purchase_success"],
};

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  // Gate master
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const level = req.nextUrl.searchParams.get("level") as AnomalyLevel | null;
  const segment = req.nextUrl.searchParams.get("segment");
  const metric = req.nextUrl.searchParams.get("metric") as AnomalyMetric | null;
  const baselineDays = Number(req.nextUrl.searchParams.get("baselineDays") || 14);

  if (!propertyId || !level || !segment || !metric) {
    return NextResponse.json(
      { error: "propertyId, level, segment, metric são obrigatórios" },
      { status: 400 }
    );
  }

  const startDate = daysAgoISO(baselineDays + 1); // +1 pra incluir D-1 + baseline
  const endDate = daysAgoISO(1);
  const dateRange = { startDate, endDate };

  // Constrói o dimensionFilter conforme o level
  type Filter = {
    filter?: {
      fieldName: string;
      stringFilter?: { value: string; matchType: "EXACT" };
    };
  };
  const buildFilter = (): Filter | undefined => {
    if (level === "macro") return undefined;
    if (level === "channel") {
      return {
        filter: {
          fieldName: "sessionDefaultChannelGroup",
          stringFilter: { value: segment, matchType: "EXACT" },
        },
      };
    }
    if (level === "campaign") {
      return {
        filter: {
          fieldName: "sessionCampaignName",
          stringFilter: { value: segment, matchType: "EXACT" },
        },
      };
    }
    return undefined;
  };
  const segmentFilter = buildFilter();

  const isEventMetric = !!EVENT_NAMES[metric];
  const isRevenueMetric = metric === "revenue";

  // ============================================================
  // 1) SÉRIE DIÁRIA DA MÉTRICA NO SEGMENTO
  // ============================================================
  type DailyPoint = { date: string; value: number };
  let dailySeries: DailyPoint[] = [];

  if (isEventMetric) {
    const eventNames = EVENT_NAMES[metric] || [];
    // Combina filter de evento + segmento
    type DimFilter = NonNullable<typeof segmentFilter>;
    type AndGroup = { andGroup: { expressions: unknown[] } };
    const eventFilter: DimFilter = {
      filter: {
        fieldName: "eventName",
        stringFilter: { value: eventNames[0], matchType: "EXACT" },
      },
    };
    // Pra suportar múltiplos aliases (purchase OR purchase_success), usaremos
    // inListFilter no campo eventName via filtro composto. Simples por agora:
    // pegamos só o primeiro alias.
    const combinedFilter: DimFilter | AndGroup = segmentFilter
      ? { andGroup: { expressions: [eventFilter, segmentFilter] } }
      : eventFilter;

    const res = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }],
      metrics: isRevenueMetric
        ? [{ name: "eventValue" }]
        : [{ name: "eventCount" }],
      dimensionFilter: combinedFilter,
      orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
    });
    dailySeries = (res.data?.rows || []).map((r) => {
      const raw = r.dimensionValues?.[0]?.value || "";
      // GA4 retorna YYYYMMDD — formata pra YYYY-MM-DD
      const formatted = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      return {
        date: formatted,
        value: Number(r.metricValues?.[0]?.value || 0),
      };
    });
  } else {
    const ga4Metric = SESSION_METRICS[metric];
    if (!ga4Metric) {
      return NextResponse.json({ error: `metric ${metric} não suportada` }, { status: 400 });
    }
    const res = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }],
      metrics: [{ name: ga4Metric }],
      dimensionFilter: segmentFilter,
      orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
    });
    dailySeries = (res.data?.rows || []).map((r) => {
      const raw = r.dimensionValues?.[0]?.value || "";
      const formatted = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      return {
        date: formatted,
        value: Number(r.metricValues?.[0]?.value || 0),
      };
    });
  }

  // ============================================================
  // 2) DRILL-DOWN — depende do level
  // ============================================================
  type DrillDown = {
    title: string;
    columns: string[];
    rows: { label: string; values: (string | number)[] }[];
  };
  const drilldowns: DrillDown[] = [];

  // Pra macro: top canais pela métrica (yesterday)
  if (level === "macro") {
    const yesterdayRange = { startDate: endDate, endDate };
    if (isEventMetric) {
      const eventNames = EVENT_NAMES[metric] || [];
      const res = await runReport(propertyId, {
        dateRanges: [yesterdayRange],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: isRevenueMetric
          ? [{ name: "eventValue" }, { name: "eventCount" }]
          : [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            stringFilter: { value: eventNames[0], matchType: "EXACT" },
          },
        },
        orderBys: [
          {
            metric: {
              metricName: isRevenueMetric ? "eventValue" : "eventCount",
            },
            desc: true,
          },
        ],
        limit: 10,
      });
      drilldowns.push({
        title: `Top canais por ${metric} ontem (${endDate})`,
        columns: isRevenueMetric ? ["Canal", "Receita", "Compras"] : ["Canal", metric],
        rows: (res.data?.rows || []).map((r) => ({
          label: r.dimensionValues?.[0]?.value || "(not set)",
          values: isRevenueMetric
            ? [
                Number(r.metricValues?.[0]?.value || 0),
                Number(r.metricValues?.[1]?.value || 0),
              ]
            : [Number(r.metricValues?.[0]?.value || 0)],
        })),
      });
    } else {
      const ga4Metric = SESSION_METRICS[metric]!;
      const res = await runReport(propertyId, {
        dateRanges: [yesterdayRange],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: ga4Metric }],
        orderBys: [{ metric: { metricName: ga4Metric }, desc: true }],
        limit: 10,
      });
      drilldowns.push({
        title: `Top canais por ${metric} ontem (${endDate})`,
        columns: ["Canal", metric],
        rows: (res.data?.rows || []).map((r) => ({
          label: r.dimensionValues?.[0]?.value || "(not set)",
          values: [Number(r.metricValues?.[0]?.value || 0)],
        })),
      });
    }
  }

  // Pra channel: top campanhas dentro do canal + top páginas
  if (level === "channel") {
    const yesterdayRange = { startDate: endDate, endDate };
    // Top campanhas
    const campaignsRes = await runReport(propertyId, {
      dateRanges: [yesterdayRange],
      dimensions: [{ name: "sessionCampaignName" }, { name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }],
      dimensionFilter: segmentFilter,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    });
    drilldowns.push({
      title: `Top campanhas no canal "${segment}" (D-1)`,
      columns: ["Campanha", "Source / Medium", "Sessões", "Usuários", "Conversões"],
      rows: (campaignsRes.data?.rows || []).map((r) => ({
        label: r.dimensionValues?.[0]?.value || "(not set)",
        values: [
          `${r.dimensionValues?.[1]?.value || ""} / ${r.dimensionValues?.[2]?.value || ""}`,
          Number(r.metricValues?.[0]?.value || 0),
          Number(r.metricValues?.[1]?.value || 0),
          Number(r.metricValues?.[2]?.value || 0),
        ],
      })),
    });

    // Top landing pages
    const pagesRes = await runReport(propertyId, {
      dateRanges: [yesterdayRange],
      dimensions: [{ name: "landingPage" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      dimensionFilter: segmentFilter,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    });
    drilldowns.push({
      title: `Top landing pages no canal "${segment}" (D-1)`,
      columns: ["Página", "Sessões", "Conversões"],
      rows: (pagesRes.data?.rows || []).map((r) => ({
        label: r.dimensionValues?.[0]?.value || "/",
        values: [
          Number(r.metricValues?.[0]?.value || 0),
          Number(r.metricValues?.[1]?.value || 0),
        ],
      })),
    });
  }

  // Pra campaign: source/medium + páginas + top eventos
  if (level === "campaign") {
    const yesterdayRange = { startDate: endDate, endDate };
    // Source/medium da campanha
    const smRes = await runReport(propertyId, {
      dateRanges: [yesterdayRange],
      dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }],
      dimensionFilter: segmentFilter,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    });
    drilldowns.push({
      title: `Source / Medium da campanha "${segment}"`,
      columns: ["Source", "Medium", "Sessões", "Usuários", "Conversões"],
      rows: (smRes.data?.rows || []).map((r) => ({
        label: r.dimensionValues?.[0]?.value || "(not set)",
        values: [
          r.dimensionValues?.[1]?.value || "(not set)",
          Number(r.metricValues?.[0]?.value || 0),
          Number(r.metricValues?.[1]?.value || 0),
          Number(r.metricValues?.[2]?.value || 0),
        ],
      })),
    });

    // Top landing pages
    const pagesRes = await runReport(propertyId, {
      dateRanges: [yesterdayRange],
      dimensions: [{ name: "landingPage" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      dimensionFilter: segmentFilter,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    });
    drilldowns.push({
      title: `Top landing pages da campanha "${segment}" (D-1)`,
      columns: ["Página", "Sessões", "Conversões"],
      rows: (pagesRes.data?.rows || []).map((r) => ({
        label: r.dimensionValues?.[0]?.value || "/",
        values: [
          Number(r.metricValues?.[0]?.value || 0),
          Number(r.metricValues?.[1]?.value || 0),
        ],
      })),
    });
  }

  // ============================================================
  // 3) Cálculo de baseline pra trend chart
  // ============================================================
  const sortedSeries = [...dailySeries].sort((a, b) => a.date.localeCompare(b.date));
  const lastValue = sortedSeries[sortedSeries.length - 1]?.value || 0;
  const baselineValues = sortedSeries.slice(0, -1).map((d) => d.value);
  const sortedBaseline = [...baselineValues].sort((a, b) => a - b);
  const median =
    sortedBaseline.length === 0
      ? 0
      : sortedBaseline.length % 2 === 1
        ? sortedBaseline[Math.floor(sortedBaseline.length / 2)]
        : (sortedBaseline[sortedBaseline.length / 2 - 1] + sortedBaseline[sortedBaseline.length / 2]) / 2;

  return NextResponse.json(
    {
      propertyId, // ⚠ anti race-condition: cliente valida que resposta é da property atual
      level,
      segment,
      metric,
      baselineDays,
      dateRange: { startDate, endDate },
      series: sortedSeries,
      lastValue,
      baselineMedian: Math.round(median * 100) / 100,
      drilldowns,
    },
    {
      // Cache reduzido pra evitar mostrar drill-down da property antiga
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
    }
  );
}
