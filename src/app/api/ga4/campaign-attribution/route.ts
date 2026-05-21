import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/campaign-attribution
 *
 * Análise de origem/canal/campanha pra orientar concentração de investimento.
 *
 * Responde a 1 pergunta: "Onde devo concentrar meu orçamento de mídia
 * pra maximizar leads e vendas?"
 *
 * Retorna 3 visões cruzadas, todas dentro do mesmo range + propriedade:
 *  1) byChannel — agrupado por sessionDefaultChannelGroup (visão alto nível)
 *  2) bySourceMedium — agrupado por sessionSource + sessionMedium
 *  3) byCampaign — agrupado por sessionCampaignName + sessionSource + sessionMedium
 *
 * Cada linha vem com: sessões, usuários, leads (generate_lead),
 * vendas (purchase + revenue), conversão de lead %, conversão de venda %,
 * ticket médio, e um "investment score" calculado.
 *
 * Investment score = (volume × eficiência) / desvio_padrão
 *   Premia canais que entregam alto volume COM alta conversão,
 *   penaliza variabilidade alta (pontas frias).
 *
 * Query params obrigatórios:
 *   propertyId
 * Opcionais:
 *   days (default 30)
 *   startDate + endDate (sobrescreve days se ambos válidos)
 *
 * O endpoint SEMPRE retorna o propertyId que respondeu — frontend valida
 * pra evitar race-condition ao trocar propriedade ou data.
 */

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const daysRaw = Number(req.nextUrl.searchParams.get("days") || 30);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 730 ? Math.floor(daysRaw) : 30;
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");

  // Range custom tem precedência. Senão, calcula a partir de days (até ontem).
  let dateRange: { startDate: string; endDate: string };
  if (
    startDateParam &&
    endDateParam &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
  ) {
    dateRange = { startDate: startDateParam, endDate: endDateParam };
  } else {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    dateRange = { startDate: isoDate(start), endDate: isoDate(end) };
  }

  // ========================================================
  // 6 queries em paralelo cruzando todas as dimensões úteis
  // ========================================================
  const eventFilter = {
    filter: {
      fieldName: "eventName",
      inListFilter: { values: ["generate_lead", "purchase", "purchase_success"] },
    },
  };

  const [
    channelSessRes,
    channelEventsRes,
    sourceMediumSessRes,
    sourceMediumEventsRes,
    campaignSessRes,
    campaignEventsRes,
    campaignPageConvRes,
    campaignSourceMediumKeyEventsRes,
  ] = await Promise.all([
    // Channel — sessões + usuários
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "engagedSessions" },
        { name: "bounceRate" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
    }),
    // Channel — eventos
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: eventFilter,
      limit: 200,
    }),
    // Source/Medium — sessões + usuários
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "engagedSessions" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 100,
    }),
    // Source/Medium — eventos
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [
        { name: "sessionSource" },
        { name: "sessionMedium" },
        { name: "eventName" },
      ],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: eventFilter,
      limit: 500,
    }),
    // Campaign — sessões + usuários
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 200,
    }),
    // Campaign — eventos
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
        { name: "eventName" },
      ],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: eventFilter,
      limit: 2000,
    }),
    // Campaign × LP de conversão — formato relatório GA4 exportado
    // Cruza qual campanha trouxe o usuário com qual página ele converteu
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSourceMedium" },
        { name: "pagePath" }, // página onde o evento aconteceu (LP de conversão)
        { name: "eventName" },
      ],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: eventFilter,
      limit: 5000,
    }),
    // Campaign × Source/Medium com keyEvents (Todas as conversões) —
    // formato IDÊNTICO ao GA4 export que o Renan compartilhou.
    // Usa a métrica `keyEvents` nativa do GA4 (não filtra event_name)
    // pra somar TODAS as conversões marcadas como key event na property.
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSourceMedium" },
      ],
      metrics: [
        { name: "keyEvents" },
        { name: "totalRevenue" },
        { name: "purchaseRevenue" },
        { name: "sessions" },
      ],
      orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
      limit: 500,
    }),
  ]);

  // ========================================================
  // Helpers de agregação
  // ========================================================

  type Aggregate = {
    sessions: number;
    users: number;
    engagedSessions: number;
    bounceRate?: number;
    leads: number;
    purchases: number;
    revenue: number;
  };

  function emptyAggregate(): Aggregate {
    return { sessions: 0, users: 0, engagedSessions: 0, leads: 0, purchases: 0, revenue: 0 };
  }

  function withDerived<T extends Aggregate>(agg: T) {
    const leadConvRate = agg.sessions > 0 ? (agg.leads / agg.sessions) * 100 : 0;
    const purchaseConvRate = agg.sessions > 0 ? (agg.purchases / agg.sessions) * 100 : 0;
    const avgTicket = agg.purchases > 0 ? agg.revenue / agg.purchases : 0;
    const engagementRate = agg.sessions > 0 ? (agg.engagedSessions / agg.sessions) * 100 : 0;
    const revenuePerSession = agg.sessions > 0 ? agg.revenue / agg.sessions : 0;
    return {
      ...agg,
      leadConvRate: Number(leadConvRate.toFixed(2)),
      purchaseConvRate: Number(purchaseConvRate.toFixed(2)),
      avgTicket: Number(avgTicket.toFixed(2)),
      engagementRate: Number(engagementRate.toFixed(1)),
      revenuePerSession: Number(revenuePerSession.toFixed(2)),
    };
  }

  // ========================================================
  // 1) Channel
  // ========================================================
  const channelMap = new Map<string, Aggregate>();
  for (const r of channelSessRes.data?.rows || []) {
    const channel = r.dimensionValues?.[0]?.value || "(direct)";
    const sessions = Number(r.metricValues?.[0]?.value || 0);
    const users = Number(r.metricValues?.[1]?.value || 0);
    const engaged = Number(r.metricValues?.[2]?.value || 0);
    const bounce = Number(r.metricValues?.[3]?.value || 0);
    channelMap.set(channel, {
      ...emptyAggregate(),
      sessions,
      users,
      engagedSessions: engaged,
      bounceRate: Number((bounce * 100).toFixed(1)),
    });
  }
  for (const r of channelEventsRes.data?.rows || []) {
    const channel = r.dimensionValues?.[0]?.value || "(direct)";
    const eventName = r.dimensionValues?.[1]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const entry = channelMap.get(channel) || emptyAggregate();
    if (eventName === "generate_lead") entry.leads += count;
    else if (eventName === "purchase" || eventName === "purchase_success") {
      entry.purchases += count;
      entry.revenue += value;
    }
    channelMap.set(channel, entry);
  }
  const byChannel = [...channelMap.entries()]
    .map(([channel, agg]) => ({ channel, ...withDerived(agg) }))
    .filter((c) => c.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);

  // ========================================================
  // 2) Source/Medium
  // ========================================================
  const smMap = new Map<string, Aggregate & { source: string; medium: string }>();
  for (const r of sourceMediumSessRes.data?.rows || []) {
    const source = r.dimensionValues?.[0]?.value || "(direct)";
    const medium = r.dimensionValues?.[1]?.value || "(none)";
    const key = `${source}|${medium}`;
    smMap.set(key, {
      ...emptyAggregate(),
      source,
      medium,
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      engagedSessions: Number(r.metricValues?.[2]?.value || 0),
    });
  }
  for (const r of sourceMediumEventsRes.data?.rows || []) {
    const source = r.dimensionValues?.[0]?.value || "(direct)";
    const medium = r.dimensionValues?.[1]?.value || "(none)";
    const eventName = r.dimensionValues?.[2]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const key = `${source}|${medium}`;
    const entry =
      smMap.get(key) || { ...emptyAggregate(), source, medium };
    if (eventName === "generate_lead") entry.leads += count;
    else if (eventName === "purchase" || eventName === "purchase_success") {
      entry.purchases += count;
      entry.revenue += value;
    }
    smMap.set(key, entry);
  }
  const bySourceMedium = [...smMap.values()]
    .map((agg) => ({ ...withDerived(agg) }))
    .filter((s) => s.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);

  // ========================================================
  // 3) Campaign
  // ========================================================
  const campMap = new Map<
    string,
    Aggregate & { campaign: string; source: string; medium: string }
  >();
  for (const r of campaignSessRes.data?.rows || []) {
    const campaign = r.dimensionValues?.[0]?.value || "(not set)";
    const source = r.dimensionValues?.[1]?.value || "(direct)";
    const medium = r.dimensionValues?.[2]?.value || "(none)";
    const key = `${campaign}|${source}|${medium}`;
    campMap.set(key, {
      ...emptyAggregate(),
      campaign,
      source,
      medium,
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      engagedSessions: Number(r.metricValues?.[2]?.value || 0),
    });
  }
  for (const r of campaignEventsRes.data?.rows || []) {
    const campaign = r.dimensionValues?.[0]?.value || "(not set)";
    const source = r.dimensionValues?.[1]?.value || "(direct)";
    const medium = r.dimensionValues?.[2]?.value || "(none)";
    const eventName = r.dimensionValues?.[3]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const key = `${campaign}|${source}|${medium}`;
    const entry =
      campMap.get(key) || { ...emptyAggregate(), campaign, source, medium };
    if (eventName === "generate_lead") entry.leads += count;
    else if (eventName === "purchase" || eventName === "purchase_success") {
      entry.purchases += count;
      entry.revenue += value;
    }
    campMap.set(key, entry);
  }
  const byCampaign = [...campMap.values()]
    .map((agg) => ({ ...withDerived(agg) }))
    // remove ruído de cauda longa: precisa ter pelo menos 30 sessões OU pelo menos 1 conversão
    .filter((c) => c.sessions >= 30 || c.leads > 0 || c.purchases > 0)
    .sort((a, b) => b.sessions - a.sessions);

  // ========================================================
  // 4) Campaign × LP de conversão — formato GA4 export
  // Mostra qual CAMPANHA trouxe o usuário + qual PÁGINA ele converteu
  // (lead) + qual página ele comprou (purchase). É o cruzamento mais
  // útil pra entender o caminho real de aquisição → conversão.
  // ========================================================
  type CampaignPageRow = {
    campaign: string;
    sourceMedium: string;
    conversionPage: string;
    leads: number;
    purchases: number;
    revenue: number;
  };
  const cpMap = new Map<string, CampaignPageRow>();
  for (const r of campaignPageConvRes.data?.rows || []) {
    const campaign = r.dimensionValues?.[0]?.value || "(not set)";
    const sourceMedium = r.dimensionValues?.[1]?.value || "(direct)/(none)";
    const conversionPage = r.dimensionValues?.[2]?.value || "/";
    const eventName = r.dimensionValues?.[3]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    if (count === 0) continue;

    const key = `${campaign}|${sourceMedium}|${conversionPage}`;
    let entry = cpMap.get(key);
    if (!entry) {
      entry = { campaign, sourceMedium, conversionPage, leads: 0, purchases: 0, revenue: 0 };
      cpMap.set(key, entry);
    }
    if (eventName === "generate_lead") entry.leads += count;
    else if (eventName === "purchase" || eventName === "purchase_success") {
      entry.purchases += count;
      entry.revenue += value;
    }
  }
  const byCampaignXPage = [...cpMap.values()]
    .filter((r) => r.leads > 0 || r.purchases > 0)
    .sort((a, b) => {
      const aTotal = a.leads + a.purchases * 5; // pondera vendas 5x leads no sort
      const bTotal = b.leads + b.purchases * 5;
      return bTotal - aTotal;
    });

  // ========================================================
  // 5) Campaign × Source/Medium com keyEvents — FORMATO GA4 EXPORT
  // Réplica fiel do relatório que o Renan compartilhou: campanha +
  // origem/mídia + total de conversões (sum de TODOS os key events
  // marcados na property) + receita total.
  // ========================================================
  type CampaignSourceMediumRow = {
    campaign: string;
    sourceMedium: string;
    keyEvents: number;
    revenue: number;
    sessions: number;
    keyEventsShare: number; // % das conversões totais
    revenueShare: number;   // % da receita total
  };

  type RawCSM = {
    campaign: string;
    sourceMedium: string;
    keyEvents: number;
    revenue: number;
    sessions: number;
  };
  const csmRows: RawCSM[] = [];
  let totalKeyEvents = 0;
  let totalRevenueAll = 0;
  for (const r of campaignSourceMediumKeyEventsRes.data?.rows || []) {
    const campaign = r.dimensionValues?.[0]?.value || "(not set)";
    const sourceMedium = r.dimensionValues?.[1]?.value || "(direct)/(none)";
    const keyEvents = Number(r.metricValues?.[0]?.value || 0);
    const totalRevenue = Number(r.metricValues?.[1]?.value || 0);
    const purchaseRevenue = Number(r.metricValues?.[2]?.value || 0);
    const sessions = Number(r.metricValues?.[3]?.value || 0);
    // Receita: prefere purchaseRevenue (ecommerce-native), cai pra totalRevenue
    const revenue = purchaseRevenue > 0 ? purchaseRevenue : totalRevenue;
    if (keyEvents === 0 && revenue === 0) continue;
    csmRows.push({ campaign, sourceMedium, keyEvents, revenue, sessions });
    totalKeyEvents += keyEvents;
    totalRevenueAll += revenue;
  }
  const byCampaignXSourceMedium: CampaignSourceMediumRow[] = csmRows.map((r) => ({
    ...r,
    keyEventsShare: totalKeyEvents > 0 ? Number(((r.keyEvents / totalKeyEvents) * 100).toFixed(2)) : 0,
    revenueShare: totalRevenueAll > 0 ? Number(((r.revenue / totalRevenueAll) * 100).toFixed(2)) : 0,
  }));

  // ========================================================
  // RECOMENDAÇÕES — "Onde investir" insights
  // Critério: combina volume + eficiência. Premia canais que JÁ entregam
  // bem e têm capacidade (volume) de escalar.
  // ========================================================

  type Recommendation = {
    type: "scale" | "optimize" | "pause" | "explore";
    target: string; // canal/source/campanha
    reason: string;
    evidence: string;
    metric: { name: string; value: number; unit: string };
  };

  const recommendations: Recommendation[] = [];

  // Critério "ESCALAR": canal com conversão de lead >2x média global E volume relevante (>5% do total)
  const totalSessions = byChannel.reduce((s, c) => s + c.sessions, 0);
  const avgLeadConvGlobal =
    totalSessions > 0
      ? (byChannel.reduce((s, c) => s + c.leads, 0) / totalSessions) * 100
      : 0;
  const avgPurchaseConvGlobal =
    totalSessions > 0
      ? (byChannel.reduce((s, c) => s + c.purchases, 0) / totalSessions) * 100
      : 0;

  for (const ch of byChannel) {
    const share = totalSessions > 0 ? (ch.sessions / totalSessions) * 100 : 0;

    // SCALE — eficiência alta + volume razoável + tem espaço pra crescer
    if (
      ch.leadConvRate > avgLeadConvGlobal * 1.5 &&
      ch.sessions > 100 &&
      share < 20 // não passa de 20% do total — há espaço pra crescer
    ) {
      recommendations.push({
        type: "scale",
        target: ch.channel,
        reason: "Eficiência acima da média + capacidade de escalar",
        evidence: `Conversão de lead ${ch.leadConvRate.toFixed(2)}% (${(ch.leadConvRate / avgLeadConvGlobal).toFixed(1)}x média de ${avgLeadConvGlobal.toFixed(2)}%). Hoje representa ${share.toFixed(1)}% do tráfego — há espaço pra crescer.`,
        metric: { name: "Lead Conv %", value: ch.leadConvRate, unit: "%" },
      });
    }

    // PAUSE — alto volume + conversão muito baixa (queima orçamento)
    if (
      share > 10 &&
      ch.leadConvRate < avgLeadConvGlobal * 0.3 &&
      ch.purchaseConvRate < avgPurchaseConvGlobal * 0.3 &&
      avgLeadConvGlobal > 0
    ) {
      recommendations.push({
        type: "pause",
        target: ch.channel,
        reason: "Volume alto + conversão muito abaixo da média",
        evidence: `Consome ${share.toFixed(1)}% das sessões mas converte só ${ch.leadConvRate.toFixed(2)}% em lead (média ${avgLeadConvGlobal.toFixed(2)}%). Investigar UTM ou qualidade do tráfego.`,
        metric: { name: "Share tráfego", value: share, unit: "%" },
      });
    }
  }

  // EXPLORE — canal com conversão excepcional mas volume baixo (oportunidade de teste)
  for (const ch of byChannel) {
    const share = totalSessions > 0 ? (ch.sessions / totalSessions) * 100 : 0;
    if (
      ch.leadConvRate > avgLeadConvGlobal * 3 &&
      share < 2 &&
      ch.sessions >= 30
    ) {
      recommendations.push({
        type: "explore",
        target: ch.channel,
        reason: "Conversão excepcional em volume baixo — teste com mais budget",
        evidence: `${ch.leadConvRate.toFixed(2)}% de conversão em apenas ${ch.sessions} sessões. Vale subir investimento gradual pra ver se mantém a eficiência.`,
        metric: { name: "Lead Conv %", value: ch.leadConvRate, unit: "%" },
      });
    }
  }

  // OPTIMIZE — top campanha com gap entre lead conv e purchase conv (perde no funnel)
  for (const camp of byCampaign.slice(0, 10)) {
    if (camp.leadConvRate > 3 && camp.purchaseConvRate < camp.leadConvRate * 0.05) {
      recommendations.push({
        type: "optimize",
        target: `${camp.campaign} (${camp.source}/${camp.medium})`,
        reason: "Gera leads bem mas converte poucos em venda",
        evidence: `Lead conv ${camp.leadConvRate.toFixed(2)}% vs purchase conv ${camp.purchaseConvRate.toFixed(2)}%. Funil quebra entre lead e venda. Investigar nurturing/onboarding.`,
        metric: { name: "Drop lead→venda", value: Number((camp.leadConvRate - camp.purchaseConvRate).toFixed(2)), unit: "pp" },
      });
    }
  }

  return NextResponse.json(
    {
      propertyId, // ⚠ devolvido pro client validar (anti-race)
      range: dateRange,
      days,
      byChannel,
      bySourceMedium,
      byCampaign,
      byCampaignXPage, // campanha × LP de conversão
      byCampaignXSourceMedium, // campanha × origem-mídia (FORMATO IDÊNTICO ao GA4 export)
      totalKeyEvents,
      totalRevenueKeyEvents: totalRevenueAll,
      recommendations: recommendations.slice(0, 8),
      totals: {
        sessions: totalSessions,
        users: byChannel.reduce((s, c) => s + c.users, 0),
        leads: byChannel.reduce((s, c) => s + c.leads, 0),
        purchases: byChannel.reduce((s, c) => s + c.purchases, 0),
        revenue: byChannel.reduce((s, c) => s + c.revenue, 0),
        avgLeadConvRate: Number(avgLeadConvGlobal.toFixed(2)),
        avgPurchaseConvRate: Number(avgPurchaseConvGlobal.toFixed(2)),
      },
      meta: {
        channelsCount: byChannel.length,
        sourceMediumCount: bySourceMedium.length,
        campaignsCount: byCampaign.length,
        campaignXPageCount: byCampaignXPage.length,
        campaignXSourceMediumCount: byCampaignXSourceMedium.length,
        recommendationsCount: recommendations.length,
        errors: {
          channelSess: channelSessRes.error,
          channelEvents: channelEventsRes.error,
          sourceMediumSess: sourceMediumSessRes.error,
          sourceMediumEvents: sourceMediumEventsRes.error,
          campaignSess: campaignSessRes.error,
          campaignEvents: campaignEventsRes.error,
          campaignPageConv: campaignPageConvRes.error,
          campaignSourceMediumKeyEvents: campaignSourceMediumKeyEventsRes.error,
        },
      },
    },
    {
      headers: {
        // no-store pra garantir que cada mudança de property/range refaça a query
        "Cache-Control": "no-store, must-revalidate",
      },
    }
  );
}
