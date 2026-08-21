import { runReport, getAnomalies, getCheckoutFunnel, getJourneyFunnel } from "@/lib/ga4-server";
import { analisarComposicao, type LinhaOrigem } from "@/lib/cro-composicao";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/cro/recommendations — MOTOR 2.0
 *
 * 🔒 Master-only. 100% data-driven (GA4 real).
 *
 * Diferenças vs v1 (pedido do Renan, jul/2026):
 *  1. DEDUPE POR PÁGINA — antes a mesma LP disparava bounce + tempo + retenção
 *     em 3 cards. Agora é 1 card por página combinando os sinais.
 *  2. COMPARAÇÃO SEMANAL (WoW) — cada sinal compara a semana atual (7d) com a
 *     anterior (7d antes). Prioriza o que está PIORANDO (early warning diário).
 *  3. DESENHO DE EXPERIMENTO DE VERDADE — cada recomendação carrega variante
 *     A/B concreta + tamanho de amostra e duração CALCULADOS do tráfego real +
 *     métrica primária e guardrails. Nada de "rodar A/B genérico".
 */

type Trend = "piorando" | "melhorando" | "novo" | "estavel";

type Experiment = {
  variantA: string;
  variantB: string;
  primaryMetric: string;
  guardrails: string[];
  mde: string;
  sampleSizePerVariant: number;
  estimatedDays: number;
};

type Recommendation = {
  id: string;
  iconName: "AlertTriangle" | "Lightbulb" | "Zap" | "MousePointerClick" | "Target" | "TrendingUp";
  colorClass: string;
  priority: "Alta" | "Média" | "Baixa";
  category: "Performance" | "UX/CTA" | "Mídia" | "Funil" | "Retenção" | "Conteúdo";
  title: string;
  desc: string;
  action: string;
  impact: string;
  effort: "baixo" | "médio" | "alto";
  owner: string;
  steps: string[];
  confidence: "Alta" | "Média" | "Baixa";
  evidence: string;
  hypothesis: string;
  costEstimate: string;
  risk: "baixo" | "médio" | "alto";
  riskNotes: string;
  primaryKPI: string;
  secondaryKPIs: string[];
  testWindow: string;
  rollback: string;
  affectedSegments: string[];
  pageRef?: string;
  /** Veredicto de composicao: o problema e da pagina, da midia ou do dado. */
  composicao?: { tipo: "pagina" | "midia" | "dado"; texto: string };
  pageUrl?: string;
  // Motor 2.0
  trend?: Trend;
  wowNote?: string;
  experiment?: Experiment;
  _iceScore: number;
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function formatNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}
function pct(v: number, d = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

// Datas: janelas de 7 dias terminando ontem (semana atual vs anterior).
function isoDaysAgo(base: Date, n: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Tamanho de amostra por variante para teste de proporção (conversão/bounce),
 * ~80% de poder, 95% de confiança, teste bicaudal. Retorna nº de SESSÕES.
 * n = 15.7 * p(1-p) / mde²  (mde absoluto = baseline × relMde)
 */
function sampleSizePerVariant(baselineRate: number, relMde = 0.15): number {
  const p = Math.min(0.95, Math.max(0.002, baselineRate)); // proporção 0..1
  const mde = p * relMde;
  if (mde <= 0) return 0;
  return Math.ceil((15.7 * p * (1 - p)) / (mde * mde));
}

function trendFrom(deltaPct: number): Trend {
  if (deltaPct <= -8) return "piorando";
  if (deltaPct >= 8) return "melhorando";
  return "estavel";
}

export async function GET(req: NextRequest) {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const propertyName = req.nextUrl.searchParams.get("propertyName") || "esta property";
  const days = Number(req.nextUrl.searchParams.get("days") || 30);

  // Janelas: analysis (volume/baseline), semana atual (7d) e anterior (7d antes).
  const base = new Date();
  base.setUTCDate(base.getUTCDate() - 1); // ontem = fim
  const analysisRange = { startDate: isoDaysAgo(base, days - 1), endDate: base.toISOString().slice(0, 10) };
  const curWeek = { startDate: isoDaysAgo(base, 6), endDate: base.toISOString().slice(0, 10) };
  const prevWeek = { startDate: isoDaysAgo(base, 13), endDate: isoDaysAgo(base, 7) };

  const pageMetrics = [
    { name: "screenPageViews" },
    { name: "totalUsers" },
    { name: "sessions" },
    { name: "averageSessionDuration" },
    { name: "bounceRate" },
    { name: "keyEvents" },
  ];
  const pageDims = [{ name: "hostName" }, { name: "pagePath" }];
  const pageOrder = [{ metric: { metricName: "sessions" }, desc: true }];

  const campMetrics = [
    { name: "sessions" },
    { name: "totalUsers" },
    { name: "keyEvents" },
    { name: "totalRevenue" },
    { name: "purchaseRevenue" },
  ];

  const [
    pagesCurRes, pagesPrevRes,
    campCurRes, campPrevRes,
    anomaliesResult, checkoutResult, journeyResult, revenueRes, mqlRes,
    origemRes,
  ] = await Promise.all([
    runReport(propertyId, { dateRanges: [curWeek], dimensions: pageDims, metrics: pageMetrics, orderBys: pageOrder, limit: 60 }),
    runReport(propertyId, { dateRanges: [prevWeek], dimensions: pageDims, metrics: pageMetrics, orderBys: pageOrder, limit: 60 }),
    runReport(propertyId, { dateRanges: [curWeek], dimensions: [{ name: "sessionCampaignName" }], metrics: campMetrics, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 40 }),
    runReport(propertyId, { dateRanges: [prevWeek], dimensions: [{ name: "sessionCampaignName" }], metrics: campMetrics, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 40 }),
    getAnomalies(propertyId, 14).catch((e) => ({ data: null, error: (e as Error).message })),
    getCheckoutFunnel(propertyId, days).catch((e) => ({ data: null, error: (e as Error).message })),
    getJourneyFunnel(propertyId, days).catch((e) => ({ data: null, error: (e as Error).message })),
    runReport(propertyId, { dateRanges: [analysisRange], metrics: [{ name: "totalRevenue" }, { name: "transactions" }, { name: "purchaseRevenue" }], metricAggregations: ["TOTAL"] }),
    runReport(propertyId, {
      dateRanges: [analysisRange],
      dimensions: [{ name: "pagePath" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: { expressions: [
          { filter: { fieldName: "eventName", inListFilter: { values: ["generate_lead", "LeadQualificadoConsultoria"] } } },
          { orGroup: { expressions: [
            { filter: { fieldName: "hostName", stringFilter: { matchType: "CONTAINS", value: "sunoconsultoria" } } },
            { filter: { fieldName: "pagePath", stringFilter: { matchType: "CONTAINS", value: "consultoria" } } },
          ] } },
        ] },
      },
      limit: 200,
    }).catch((e) => ({ data: null, error: (e as Error).message })),
    // Composicao de origem por pagina. Existe para separar problema de pagina
    // de problema de midia antes de propor teste. Sem isso o painel sugere
    // teste de CRO para trafego sem intencao, e o time gasta duas semanas de
    // trafego para descobrir. keyEvents e a conversao configurada na property,
    // entao o veredicto depende de quais eventos estao marcados como principais
    // no GA4, e isso esta declarado no texto do card.
    runReport(propertyId, {
      dateRanges: [analysisRange],
      dimensions: [{ name: "pagePath" }, { name: "sessionSourceMedium" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 1000,
    }).catch((e) => ({ data: null, error: (e as Error).message })),
  ]);

  // Mapa pagePath -> linhas de origem, para o veredicto de composicao.
  const origemPorPagina = new Map<string, LinhaOrigem[]>();
  for (const r of origemRes.data?.rows || []) {
    const path = r.dimensionValues?.[0]?.value || "/";
    const label = r.dimensionValues?.[1]?.value || "(not set)";
    const linha: LinhaOrigem = {
      label,
      sessions: Number(r.metricValues?.[0]?.value || 0),
      leads: Number(r.metricValues?.[1]?.value || 0),
    };
    const atual = origemPorPagina.get(path) || [];
    atual.push(linha);
    origemPorPagina.set(path, atual);
  }

  const recs: Recommendation[] = [];

  // Contexto de receita
  const totalRevenue = Number(revenueRes.data?.rows?.[0]?.metricValues?.[2]?.value || revenueRes.data?.totals?.[0]?.metricValues?.[2]?.value || 0);
  const totalTransactions = Number(revenueRes.data?.rows?.[0]?.metricValues?.[1]?.value || revenueRes.data?.totals?.[0]?.metricValues?.[1]?.value || 0);
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // ============================================================
  // Sinais por PÁGINA (semana atual) + WoW vs semana anterior → 1 rec/página
  // ============================================================
  type PageSig = {
    host: string; path: string; key: string;
    views: number; users: number; sessions: number; avgDuration: number; bounceRate: number; conversions: number;
    convRate: number; dailySessions: number;
    prevSessions: number; prevConvRate: number; prevBounce: number;
    sessionsDeltaPct: number; convDeltaPct: number; bounceDeltaPp: number;
  };

  const parsePage = (r: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }) => ({
    host: r.dimensionValues?.[0]?.value || "",
    path: r.dimensionValues?.[1]?.value || "/",
    views: Number(r.metricValues?.[0]?.value || 0),
    users: Number(r.metricValues?.[1]?.value || 0),
    sessions: Number(r.metricValues?.[2]?.value || 0),
    avgDuration: Number(r.metricValues?.[3]?.value || 0),
    bounceRate: Number(r.metricValues?.[4]?.value || 0) * 100,
    conversions: Number(r.metricValues?.[5]?.value || 0),
  });

  const prevByKey = new Map<string, ReturnType<typeof parsePage>>();
  for (const r of pagesPrevRes.data?.rows || []) {
    const p = parsePage(r);
    prevByKey.set(`${p.host}${p.path}`, p);
  }

  const pageSigs: PageSig[] = (pagesCurRes.data?.rows || []).map((r) => {
    const c = parsePage(r);
    const key = `${c.host}${c.path}`;
    const prev = prevByKey.get(key);
    const convRate = c.sessions > 0 ? (c.conversions / c.sessions) * 100 : 0;
    const prevConvRate = prev && prev.sessions > 0 ? (prev.conversions / prev.sessions) * 100 : 0;
    const prevSessions = prev?.sessions || 0;
    const prevBounce = prev?.bounceRate || 0;
    return {
      ...c, key, convRate, dailySessions: c.sessions / 7,
      prevSessions, prevConvRate, prevBounce,
      sessionsDeltaPct: prevSessions > 0 ? ((c.sessions - prevSessions) / prevSessions) * 100 : 0,
      convDeltaPct: prevConvRate > 0 ? ((convRate - prevConvRate) / prevConvRate) * 100 : (convRate > 0 ? 100 : 0),
      bounceDeltaPp: c.bounceRate - prevBounce,
    };
  });

  const sortedBySessions = [...pageSigs].sort((a, b) => b.sessions - a.sessions);
  const medianSessions = sortedBySessions[Math.floor(sortedBySessions.length / 2)]?.sessions || 0;
  const minVolume = Math.max(50, medianSessions * 0.4);

  const eligible = pageSigs.filter((p) => p.sessions >= minVolume);

  // Para cada página elegível, decide O ÚNICO problema dominante (dedupe real)
  for (const p of eligible) {
    const signals: string[] = [];
    if (p.bounceRate > 60) signals.push(`bounce ${p.bounceRate.toFixed(0)}%`);
    if (p.avgDuration < 30) signals.push(`tempo ${p.avgDuration.toFixed(0)}s`);
    if (p.convRate > 0 && p.convDeltaPct <= -15) signals.push(`conversão ${pct(p.convDeltaPct)} WoW`);
    if (p.sessionsDeltaPct <= -20) signals.push(`tráfego ${pct(p.sessionsDeltaPct)} WoW`);

    // Classificação do problema dominante
    let kind: "conv_drop" | "bounce" | "retencao" | "oportunidade" | null = null;
    if (p.convRate > 0 && p.convDeltaPct <= -15 && p.conversions >= 3) kind = "conv_drop";
    else if (p.bounceRate > 62) kind = "bounce";
    else if (p.avgDuration < 30 && p.bounceRate > 50) kind = "retencao";
    else if (p.avgDuration > 180 && p.convRate < 2) kind = "oportunidade";
    if (!kind) continue;

    const url = `https://${p.host}${p.path}`;
    const trend: Trend = p.prevSessions === 0 ? "novo" : trendFrom(kind === "oportunidade" ? p.convDeltaPct : -Math.abs(kind === "bounce" ? p.bounceDeltaPp * 2 : p.convDeltaPct));
    const wowNote = p.prevSessions === 0
      ? "Sem base na semana anterior (página nova ou sem tráfego)."
      : `WoW: sessões ${pct(p.sessionsDeltaPct)}, conversão ${pct(p.convDeltaPct)}, bounce ${p.bounceDeltaPp >= 0 ? "+" : ""}${p.bounceDeltaPp.toFixed(1)}pp.`;

    // Experimento: baseline = conversão (ou 1-bounce pra teste de bounce)
    const baseRate = kind === "bounce" ? Math.max(0.02, 1 - p.bounceRate / 100) : Math.max(0.005, p.convRate / 100);
    const nPer = sampleSizePerVariant(baseRate, 0.15);
    const estDays = Math.max(7, Math.ceil((2 * nPer) / Math.max(1, p.dailySessions)));

    let rec: Recommendation;
    if (kind === "conv_drop") {
      const lostConv = Math.round((p.prevConvRate / 100 - p.convRate / 100) * p.sessions);
      rec = {
        id: `page-conv-${p.key}`,
        iconName: "AlertTriangle", colorClass: "text-red-500 bg-red-50",
        priority: "Alta", category: "Funil",
        title: `Conversão de ${p.path} caiu ${pct(p.convDeltaPct)} na semana`,
        desc: `${formatNum(p.sessions)} sessões/7d, conversão de ${p.prevConvRate.toFixed(2)}% → ${p.convRate.toFixed(2)}% (${pct(p.convDeltaPct)} WoW). ${lostConv > 0 ? `≈ ${formatNum(lostConv)} conversões perdidas na semana.` : ""} ${signals.length > 1 ? `Sinais somados: ${signals.join(", ")}.` : ""}`,
        action: "Diagnosticar o que mudou na semana (tráfego, form, checkout, criativo) e reverter/testar",
        impact: avgTicket > 0 ? `Recuperar a conversão anterior ≈ ${formatBRL(lostConv * avgTicket * 0.4)}/semana` : `Recuperar ≈ ${formatNum(lostConv)} conversões/semana`,
        effort: "médio", owner: "CRO + Dev",
        steps: [], confidence: p.sessions > 3000 ? "Alta" : "Média",
        evidence: `GA4 WoW: conversão ${p.prevConvRate.toFixed(2)}%→${p.convRate.toFixed(2)}% em ${formatNum(p.sessions)} sessões. ${wowNote}`,
        hypothesis: `A queda tem causa identificável na semana (mudança de tráfego/UX/tracking). Corrigir recupera a conversão pra ≥ ${p.prevConvRate.toFixed(2)}%.`,
        costEstimate: "Diagnóstico 4-8h + correção conforme causa", risk: "baixo",
        riskNotes: "Diagnóstico não altera o painel. Se a causa for tracking, cuidado ao mexer no GTM.",
        primaryKPI: `Conversão em ${p.path}`, secondaryKPIs: ["Tráfego por canal", "Bounce", "Tempo médio"],
        testWindow: "", rollback: "Reverter mudança recente se conversão não voltar em 7 dias",
        affectedSegments: [`Visitantes de ${p.path}`], pageRef: p.path, pageUrl: url,
        trend, wowNote,
        _iceScore: Math.abs(p.convDeltaPct) * (p.sessions / 100) + (lostConv * avgTicket) / 200,
      };
    } else if (kind === "bounce") {
      const lostUsers = Math.round(p.sessions * (p.bounceRate / 100));
      rec = {
        id: `page-bounce-${p.key}`,
        iconName: "AlertTriangle", colorClass: "text-red-500 bg-red-50",
        priority: p.bounceDeltaPp > 3 ? "Alta" : "Média", category: "UX/CTA",
        title: `Bounce ${p.bounceRate.toFixed(0)}% em ${p.path}${p.bounceDeltaPp > 3 ? ` (${p.bounceDeltaPp >= 0 ? "+" : ""}${p.bounceDeltaPp.toFixed(0)}pp WoW)` : ""}`,
        desc: `${formatNum(p.sessions)} sessões/7d, ${formatNum(lostUsers)} saem sem interagir. ${signals.length > 1 ? `Sinais: ${signals.join(", ")}.` : ""}`,
        action: "Alinhar promessa do hero à intenção do canal + CTA above-the-fold + prova social",
        impact: `Reduzir bounce 15pp recupera ≈ ${formatNum(lostUsers * 0.25)} sessões engajadas/semana`,
        effort: "médio", owner: "Design + Conteúdo",
        steps: [], confidence: p.sessions > 3000 ? "Alta" : "Média",
        evidence: `GA4: bounce ${p.bounceRate.toFixed(1)}% em ${formatNum(p.sessions)} sessões/7d. ${wowNote}`,
        hypothesis: `Hero alinhado à intenção do canal + CTA visível reduz bounce em ≥15pp.`,
        costEstimate: "≈ 16h design/conteúdo + 8h dev", risk: "baixo",
        riskNotes: "Manter URL e meta description se for página orgânica (SEO).",
        primaryKPI: `Bounce rate em ${p.path}`, secondaryKPIs: ["Tempo médio", "Scroll >50%", "CTR próximo passo"],
        testWindow: "", rollback: "Reverter se bounce piorar 5pp ou conversão cair >3%",
        affectedSegments: [`Visitantes de ${p.path}`], pageRef: p.path, pageUrl: url,
        trend, wowNote,
        _iceScore: p.sessions * (p.bounceRate / 100) * 0.05 + Math.max(0, p.bounceDeltaPp) * 20,
      };
    } else if (kind === "retencao") {
      rec = {
        id: `page-ret-${p.key}`,
        iconName: "AlertTriangle", colorClass: "text-orange-500 bg-orange-50",
        priority: "Média", category: "Conteúdo",
        title: `${p.path} não retém — ${p.avgDuration.toFixed(0)}s médios`,
        desc: `${formatNum(p.sessions)} sessões/7d mas tempo médio de ${p.avgDuration.toFixed(0)}s e bounce ${p.bounceRate.toFixed(0)}%. Conteúdo não responde à intenção. ${wowNote}`,
        action: "Refazer hero + primeira dobra com foco na intenção do canal de origem",
        impact: `Recuperar ≈ ${formatNum(p.sessions * 0.3)} sessões engajadas/semana`,
        effort: "médio", owner: "Conteúdo + Design",
        steps: [], confidence: p.sessions > 3000 ? "Alta" : "Média",
        evidence: `GA4: tempo ${p.avgDuration.toFixed(0)}s + bounce ${p.bounceRate.toFixed(0)}% em ${formatNum(p.sessions)} sessões/7d. ${wowNote}`,
        hypothesis: "Hero alinhado à intenção eleva tempo médio para >60s e reduz bounce 15pp.",
        costEstimate: "≈ 16h conteúdo + 8h design + 8h dev", risk: "médio",
        riskNotes: "Mudança grande de copy pode afetar SEO — manter URL/meta.",
        primaryKPI: "Tempo médio na página", secondaryKPIs: ["Bounce", "Scroll depth", "Conversão"],
        testWindow: "", rollback: "Reverter se tempo médio não subir >50%",
        affectedSegments: [`Tráfego de ${p.path}`], pageRef: p.path, pageUrl: url,
        trend, wowNote,
        _iceScore: p.sessions * 0.04,
      };
    } else {
      const leadsEstimate = Math.round(p.users * 0.04);
      rec = {
        id: `page-opp-${p.key}`,
        iconName: "Lightbulb", colorClass: "text-amber-500 bg-amber-50",
        priority: "Média", category: "Conteúdo",
        title: `${p.path} retém ${(p.avgDuration / 60).toFixed(1)}min — capturar lead`,
        desc: `Alto tempo de leitura (${formatNum(p.users)} usuários/7d) com conversão baixa (${p.convRate.toFixed(2)}%). Atenção residual pra capturar lead sem prejudicar UX. ${wowNote}`,
        action: "CTA contextual (newsletter/e-book/trial) após 30s de scroll",
        impact: `+${leadsEstimate} leads/semana estimado`,
        effort: "baixo", owner: "Produto + Conteúdo",
        steps: [], confidence: p.sessions > 3000 ? "Alta" : "Média",
        evidence: `GA4: sessão média ${(p.avgDuration / 60).toFixed(1)}min, conversão ${p.convRate.toFixed(2)}% em ${formatNum(p.users)} usuários/7d.`,
        hypothesis: `CTA contextual converte ~4% dos engajados em lead sem reduzir tempo de leitura.`,
        costEstimate: "≈ 8h conteúdo + 6h dev", risk: "baixo",
        riskNotes: "Lazy reveal pra não cortar leitura.",
        primaryKPI: "Leads gerados na página", secondaryKPIs: ["Tempo médio (não cair >10%)", "Scroll completo", "Bounce"],
        testWindow: "", rollback: "Remover CTA se tempo médio cair ≥15%",
        affectedSegments: [`Leitores de ${p.path}`], pageRef: p.path, pageUrl: url,
        trend, wowNote,
        _iceScore: leadsEstimate * 2,
      };
    }

    // Desenho de experimento (comum a todas) — variante + amostra + duração reais
    const primaryMetric = kind === "bounce" ? "bounce rate" : kind === "retencao" ? "tempo médio + bounce" : "taxa de conversão";
    const variantB =
      kind === "conv_drop" ? "Reverter/ajustar o elemento que mudou na semana (form, CTA, oferta) e comparar com o estado anterior"
      : kind === "bounce" ? "Novo hero alinhado ao canal de maior tráfego + CTA above-the-fold + 2 provas sociais no 1º viewport"
      : kind === "retencao" ? "Primeira dobra reescrita com promessa do canal de origem + CTA visível sem scroll"
      : "CTA contextual (lazy reveal após 30s) no ponto de maior dwell time";
    const exp: Experiment = {
      variantA: "Versão atual da página (controle)",
      variantB,
      primaryMetric,
      guardrails: kind === "oportunidade" ? ["Tempo médio", "Bounce rate"] : ["Receita/sessão", "Bounce rate"],
      mde: "15% relativo (detecção mínima)",
      sampleSizePerVariant: nPer,
      estimatedDays: estDays,
    };
    rec.experiment = exp;
    rec.testWindow = `A/B 50/50 · ~${formatNum(nPer)} sessões/variante · ≈ ${estDays} dias no tráfego atual (${formatNum(Math.round(p.dailySessions))}/dia)`;
    rec.steps = [
      `Hipótese: ${rec.hypothesis}`,
      `Variante A (controle): ${exp.variantA}`,
      `Variante B (teste): ${exp.variantB}`,
      `Métrica primária: ${exp.primaryMetric} · guardrails: ${exp.guardrails.join(", ")}`,
      `Amostra: ~${formatNum(nPer)} sessões/variante (MDE ${exp.mde}) → ≈ ${estDays} dias com ${formatNum(Math.round(p.dailySessions))} sessões/dia`,
      `Decisão: manter B se ganhar a métrica primária sem violar guardrail; senão manter A`,
    ];
    recs.push(rec);
  }

  // ============================================================
  // Campanhas — WoW em revenue/sessão (escalar o que sobe, auditar o que cai)
  // ============================================================
  const parseCamp = (r: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }) => {
    const revenue = Number(r.metricValues?.[3]?.value || 0) || Number(r.metricValues?.[4]?.value || 0);
    const sessions = Number(r.metricValues?.[0]?.value || 0);
    return {
      campaign: r.dimensionValues?.[0]?.value || "(not set)",
      sessions, conversions: Number(r.metricValues?.[2]?.value || 0), revenue,
      revPerSession: sessions > 0 ? revenue / sessions : 0,
    };
  };
  const prevCampByName = new Map<string, ReturnType<typeof parseCamp>>();
  for (const r of campPrevRes.data?.rows || []) { const c = parseCamp(r); prevCampByName.set(c.campaign, c); }
  const campaigns = (campCurRes.data?.rows || []).map(parseCamp)
    .filter((c) => !["(not set)", "(organic)", "(direct)", "(referral)"].includes(c.campaign) && c.sessions > 100 && c.conversions > 3);

  const campWithWow = campaigns.map((c) => {
    const prev = prevCampByName.get(c.campaign);
    const rpsDeltaPct = prev && prev.revPerSession > 0 ? ((c.revPerSession - prev.revPerSession) / prev.revPerSession) * 100 : 0;
    return { ...c, rpsDeltaPct, isNew: !prev };
  });

  // Escalar: melhor revenue/sessão E subindo (ou estável) WoW
  const scale = [...campWithWow].filter((c) => c.revenue > 1000 && c.rpsDeltaPct > -10).sort((a, b) => b.revPerSession - a.revPerSession)[0];
  if (scale) {
    recs.push({
      id: `scale-${scale.campaign}`, iconName: "Zap", colorClass: "text-violet-500 bg-violet-50",
      priority: "Alta", category: "Mídia",
      title: `Escalar "${scale.campaign.slice(0, 40)}"${scale.isNew ? " (nova)" : ` (${pct(scale.rpsDeltaPct)} WoW)`}`,
      desc: `Melhor receita/sessão da carteira: ${formatBRL(scale.revPerSession)}. ${scale.isNew ? "Campanha nova." : `Tendência ${pct(scale.rpsDeltaPct)} WoW.`} ${formatNum(scale.conversions)} conv em ${formatNum(scale.sessions)} sessões/7d.`,
      action: "Aumentar budget gradualmente enquanto a eficiência WoW se mantém",
      impact: `Se dobrar volume mantendo eficiência: +${formatBRL(scale.revenue)}/semana`,
      effort: "baixo", owner: "Mídia paga",
      steps: [
        "Validar saturação (search terms / audience) no Ads antes de escalar",
        "Semana 1: +30% budget · monitorar revenue/sessão diário",
        "Semana 2: +30% se a eficiência WoW não cair >15%",
        "Guardrail: pausar escala se revenue/sessão cair >20% vs esta semana",
      ],
      confidence: scale.sessions > 1000 ? "Alta" : "Média",
      evidence: `GA4 7d: ${formatBRL(scale.revPerSession)}/sessão, ${formatNum(scale.conversions)} conv. ${scale.isNew ? "Sem base WoW ainda." : `WoW ${pct(scale.rpsDeltaPct)}.`}`,
      hypothesis: "Inventory não saturado permite +100% budget mantendo ≥80% da eficiência.",
      costEstimate: `+${formatBRL(scale.revenue * 0.5)}/semana em mídia`, risk: "médio",
      riskNotes: "Escala gradual reduz exposição a queda de ROAS marginal.",
      primaryKPI: "Revenue/sessão da campanha", secondaryKPIs: ["CPA", "Conv rate", "Volume"],
      testWindow: "Escala em 3 etapas (+30/+60/+100%) ao longo de 3 semanas",
      rollback: "Voltar ao budget anterior se revenue/sessão < 80% do baseline por 3 dias",
      affectedSegments: [`Campanha "${scale.campaign}"`],
      trend: scale.isNew ? "novo" : trendFrom(scale.rpsDeltaPct), wowNote: scale.isNew ? "Campanha nova." : `Revenue/sessão ${pct(scale.rpsDeltaPct)} WoW.`,
      _iceScore: scale.revenue / 80 + Math.max(0, scale.rpsDeltaPct) * 10,
    });
  }
  // Auditar: caindo forte WoW com volume
  const declining = [...campWithWow].filter((c) => c.sessions > 300 && c.rpsDeltaPct < -25 && !c.isNew).sort((a, b) => a.rpsDeltaPct - b.rpsDeltaPct)[0];
  if (declining && (!scale || declining.campaign !== scale.campaign)) {
    recs.push({
      id: `audit-camp-${declining.campaign}`, iconName: "AlertTriangle", colorClass: "text-amber-500 bg-amber-50",
      priority: "Alta", category: "Mídia",
      title: `Auditar "${declining.campaign.slice(0, 40)}" — caiu ${pct(declining.rpsDeltaPct)} WoW`,
      desc: `Receita/sessão despencou ${pct(declining.rpsDeltaPct)} na semana (${formatBRL(declining.revPerSession)}). ${formatNum(declining.sessions)} sessões/7d ainda consumindo budget.`,
      action: "Investigar a queda (criativo fadigado, concorrência, LP) antes que contamine a semana",
      impact: "Evitar desperdício de budget e realocar pra campanha em alta",
      effort: "baixo", owner: "Mídia paga",
      steps: [
        "Comparar criativo/CPC/CTR desta semana vs anterior no Ads",
        "Checar se a LP de destino teve queda de conversão (ver recs de página)",
        "Se for fadiga de criativo: renovar. Se for LP: pausar até corrigir",
        "Realocar budget pra campanha em alta (ver rec de escala)",
      ],
      confidence: declining.sessions > 1000 ? "Alta" : "Média",
      evidence: `GA4 WoW: revenue/sessão ${pct(declining.rpsDeltaPct)} em ${formatNum(declining.sessions)} sessões.`,
      hypothesis: "A queda tem causa (criativo/LP/leilão) identificável e reversível em 1 semana.",
      costEstimate: "Diagnóstico 3-4h mídia", risk: "baixo",
      riskNotes: "Verificar efeito assistido antes de pausar.",
      primaryKPI: "Revenue/sessão da campanha", secondaryKPIs: ["CTR", "CPC", "Conversão da LP"],
      testWindow: "Diagnóstico em 48h + monitorar 7 dias",
      rollback: "Reativar budget se a causa for externa e temporária",
      affectedSegments: [`Campanha "${declining.campaign}"`],
      trend: "piorando", wowNote: `Revenue/sessão ${pct(declining.rpsDeltaPct)} WoW.`,
      _iceScore: Math.abs(declining.rpsDeltaPct) * (declining.sessions / 100),
    });
  }

  // ============================================================
  // Checkout funnel — pior drop (1 rec)
  // ============================================================
  const checkout = checkoutResult.data;
  if (checkout && checkout.steps) {
    const worst = [...checkout.steps].filter((s, i) => i > 0 && s.dropFromPrev > 50 && s.dropAbsoluteFromPrev > 100).sort((a, b) => b.dropAbsoluteFromPrev - a.dropAbsoluteFromPrev)[0];
    if (worst) {
      const lostRevenue = Math.round(worst.dropAbsoluteFromPrev * (checkout.summary.avg_ticket || 0) * 0.4);
      recs.push({
        id: `funnel-${worst.stage}`, iconName: "MousePointerClick", colorClass: "text-emerald-500 bg-emerald-50",
        priority: "Alta", category: "Funil",
        title: `${worst.dropFromPrev}% abandonam em ${worst.label || worst.stage}`,
        desc: `Maior drop do checkout: ${formatNum(worst.dropAbsoluteFromPrev)} pessoas perdidas em ${worst.label || worst.stage} (${days}d).`,
        action: "Mapear friction (Clarity + form analytics) e simplificar a etapa",
        impact: lostRevenue > 1000 ? `Recuperar até ${formatBRL(lostRevenue)}/mês` : `Recuperar até ${formatNum(worst.dropAbsoluteFromPrev * 0.4)} compras/mês`,
        effort: "médio", owner: "Produto + Dev",
        steps: [
          `Hipótese: simplificar "${worst.label || worst.stage}" reduz o drop de ${worst.dropFromPrev}% para ≤${Math.max(20, worst.dropFromPrev - 25)}%`,
          "Variante A: fluxo atual · Variante B: etapa simplificada (menos campos, PIX primary, progress bar)",
          "Métrica primária: taxa de avanço da etapa · guardrail: aprovação de pagamento, receita/checkout",
          "Rodar A/B 50/50 com lock por usuário por 14 dias",
        ],
        confidence: "Alta",
        evidence: `Funil GA4: drop ${worst.dropFromPrev}% em ${worst.label || worst.stage}, ${formatNum(worst.dropAbsoluteFromPrev)} perdidos (${days}d).`,
        hypothesis: `Simplificar a etapa recupera ${formatNum(worst.dropAbsoluteFromPrev * 0.4)} compras.`,
        costEstimate: "≈ 32-40h dev + 8h QA", risk: "médio",
        riskNotes: "Não remover campos obrigatórios (CPF/NF) — manter opcional.",
        primaryKPI: `Avanço em ${worst.label || worst.stage}`, secondaryKPIs: ["Tempo na etapa", "Erro no form", "Receita/checkout"],
        testWindow: "A/B 50/50 por 14 dias com lock por usuário",
        rollback: "Reverter se aprovação cair ≥3pp ou receita/checkout cair >5%",
        affectedSegments: ["Usuários no checkout"],
        _iceScore: (lostRevenue / 100) || worst.dropAbsoluteFromPrev * 0.5,
      });
    }
  }

  // ============================================================
  // Consultoria — qualificação Lead → MQL (1 rec)
  // ============================================================
  const mqlByPage = new Map<string, { leads: number; mqls: number }>();
  for (const r of mqlRes.data?.rows || []) {
    const path = r.dimensionValues?.[0]?.value || "/";
    const ev = r.dimensionValues?.[1]?.value || "";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const cur = mqlByPage.get(path) || { leads: 0, mqls: 0 };
    if (ev === "generate_lead") cur.leads += count; else if (ev === "LeadQualificadoConsultoria") cur.mqls += count;
    mqlByPage.set(path, cur);
  }
  const mqlCandidates = Array.from(mqlByPage.entries())
    .map(([path, v]) => ({ path, leads: v.leads, mqls: v.mqls, qualRate: v.leads > 0 ? (v.mqls / v.leads) * 100 : 0 }))
    .filter((p) => p.leads >= 15);
  const worstQual = mqlCandidates.filter((p) => p.qualRate < 30).sort((a, b) => b.leads * (30 - b.qualRate) - a.leads * (30 - a.qualRate))[0];
  if (worstQual) {
    recs.push({
      id: `mql-${worstQual.path}`, iconName: "Target", colorClass: "text-sky-500 bg-sky-50",
      priority: "Alta", category: "Funil",
      title: `Consultoria: só ${worstQual.qualRate.toFixed(0)}% dos leads de ${worstQual.path} qualificam`,
      desc: `${formatNum(worstQual.leads)} leads → ${formatNum(worstQual.mqls)} MQLs (${days}d). Qualificação ${worstQual.qualRate.toFixed(0)}% indica público fora do ICP (patrimônio/aporte). Sucesso da Consultoria é MQL, não lead.`,
      action: "Pré-qualificar na LP + refinar segmentação de mídia pro ICP",
      impact: `Elevar pra 40% geraria +${formatNum(Math.max(0, worstQual.leads * 0.4 - worstQual.mqls))} MQLs/mês sem gastar mais`,
      effort: "médio", owner: "Marketing + CRO",
      steps: [
        "Hipótese: copy pré-qualificadora + segmentação elevam a taxa MQL/lead em ≥10pp",
        "Variante A: LP atual · Variante B: copy que deixa claro o perfil (patrimônio/aporte) + campo de qualificação cedo no form",
        "Métrica primária: MQL/lead · guardrail: volume absoluto de MQL não cair",
        "Cruzar origem (UTM) dos que NÃO qualificam e excluir públicos de baixo ticket na mídia",
        "Medir MQL, não volume de lead, por 14 dias",
      ],
      confidence: worstQual.leads > 100 ? "Alta" : "Média",
      evidence: `GA4 (${days}d): ${formatNum(worstQual.leads)} generate_lead × ${formatNum(worstQual.mqls)} LeadQualificadoConsultoria em ${worstQual.path}. Qualificação ${worstQual.qualRate.toFixed(1)}%.`,
      hypothesis: "Pré-qualificação eleva a taxa MQL/lead em ≥10pp sem reduzir o volume absoluto de MQL.",
      costEstimate: "≈ 8h copy + 6h form + ajuste de mídia", risk: "baixo",
      riskNotes: "Reduzir lead bruto é esperado e desejável — medir MQL.",
      primaryKPI: "Taxa de qualificação (MQL/lead)", secondaryKPIs: ["Volume de MQL", "CPL qualificado", "MQL→cliente"],
      testWindow: "A/B 50/50 por 14 dias",
      rollback: "Reverter se volume absoluto de MQL cair >10%",
      affectedSegments: [`Leads de ${worstQual.path} (Consultoria)`],
      pageRef: worstQual.path, pageUrl: worstQual.path.startsWith("http") ? worstQual.path : `https://lp.suno.com.br${worstQual.path}`,
      _iceScore: worstQual.leads * (30 - worstQual.qualRate) * 0.5,
    });
  }

  // ============================================================
  // Anomalia crítica (1 rec, complementa as de página)
  // ============================================================
  const anomalies = anomaliesResult.data;
  if (anomalies?.macro || anomalies?.byChannel) {
    const crit = [...(anomalies.macro || []), ...(anomalies.byChannel || []).slice(0, 5)]
      .filter((a) => a.severity === "critical" && a.direction === "down")
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (crit) {
      recs.push({
        id: `anomaly-${crit.level}-${crit.segment}-${crit.metric}`, iconName: "AlertTriangle", colorClass: "text-red-500 bg-red-50",
        priority: "Alta", category: "Mídia",
        title: `Queda crítica em ${crit.metricLabel} (${crit.segment === "all" ? "macro" : crit.segment})`,
        desc: `D-1 ${crit.delta.toFixed(1)}% vs mediana 14d. Atual ${formatNum(crit.current)}, baseline ${formatNum(crit.baseline)}. Investigar em 24h.`,
        action: "Diagnosticar causa (tracking, spend, conteúdo) antes de contaminar a semana",
        impact: avgTicket > 0 && crit.metric === "purchases" ? `Cada dia parado ≈ ${formatBRL((crit.baseline - crit.current) * avgTicket)}` : "Risco de propagação semanal",
        effort: "baixo", owner: "Analytics + Mídia",
        steps: [
          `Abrir /anomalias → ${crit.segment === "all" ? "Macro" : crit.segment} → ${crit.metricLabel}`,
          "Cruzar com /auditoria-utm pra descartar tracking quebrado",
          "Se real: checar spend, sazonalidade, mudança de produto",
        ],
        confidence: "Alta",
        evidence: `Detector DoW-aware: ${crit.delta.toFixed(1)}% em D-1 vs baseline 14d (severity crítica).`,
        hypothesis: "Causa identificável em 24h, reversível na semana.",
        costEstimate: "2-4h analytics", risk: "baixo",
        riskNotes: "Diagnóstico não muda o painel.",
        primaryKPI: crit.metricLabel, secondaryKPIs: ["Δ vs baseline", "Trend 3 dias", "Distribuição por canal"],
        testWindow: "Monitorar 72h", rollback: "Reverter mudança recente do GTM se for tracking",
        affectedSegments: [crit.segment === "all" ? "Toda a property" : crit.segment],
        trend: "piorando", wowNote: `D-1 ${crit.delta.toFixed(1)}% vs baseline.`,
        _iceScore: Math.abs(crit.delta) * 6,
      });
    }
  }

  // ============================================================
  // Dedupe final por pageRef + ordena por urgência (ICE + WoW)
  // ============================================================
  const seenPage = new Set<string>();
  const deduped: Recommendation[] = [];
  for (const r of recs.sort((a, b) => b._iceScore - a._iceScore)) {
    const k = r.pageRef ? `${r.category}:${r.pageRef}` : r.id;
    if (seenPage.has(k)) continue;
    seenPage.add(k);
    deduped.push(r);
  }
  const top = deduped.slice(0, 12);

  // ============================================================
  // Veredicto de composicao. Roda so no top, para nao gastar CPU em card que
  // ninguem vai ver. Quando o veredicto nao e "pagina", a recomendacao segue
  // aparecendo, mas carregando o aviso de que atacar a pagina nao e o caminho
  // mais curto. O time decide com o numero na frente, nao com opiniao.
  // ============================================================
  for (const r of top) {
    if (!r.pageRef) continue;
    const linhas = origemPorPagina.get(r.pageRef);
    if (!linhas || linhas.length < 2) continue;
    const v = analisarComposicao(linhas, "leads");
    if (v.tipo === "pagina") continue;
    r.composicao = { tipo: v.tipo, texto: v.texto };
    const prefixo = v.tipo === "dado" ? "[DADO QUEBRADO]" : "[COMPOSICAO DE MIDIA]";
    r.evidence = `${prefixo} ${v.texto} | Evidencia original: ${r.evidence}`;
    r.steps = [`${prefixo} ${v.texto}`, ...r.steps];
    if (v.tipo === "dado") r.confidence = "Baixa";
  }

  const worsening = top.filter((r) => r.trend === "piorando").length;
  const impactTotal = top.reduce((sum, r) => {
    const m = r.impact.match(/R\$\s*([\d.,]+)/);
    if (m) { const val = parseFloat(m[1].replace(/\./g, "").replace(",", ".")); return sum + (isFinite(val) ? val : 0); }
    return sum;
  }, 0);

  return NextResponse.json(
    {
      propertyId, propertyName, generatedAt: new Date().toISOString(), days,
      dataDriven: true,
      recommendations: top,
      weeklyComparison: { curWeek, prevWeek, worseningCount: worsening },
      meta: {
        totalCandidates: recs.length, returnedTop: top.length,
        oppCount: top.length, impactTotal, avgTicket, worseningCount: worsening,
        sources: {
          pagesCur: pageSigs.length, pagesEligible: eligible.length,
          campaigns: campaigns.length,
          anomaliesAvailable: !!anomaliesResult.data,
          checkoutFunnelAvailable: !!checkoutResult.data,
          journeyFunnelAvailable: !!journeyResult.data,
          consultoriaMqlPages: mqlCandidates.length,
          composicaoPaginasAnalisadas: origemPorPagina.size,
          composicaoAvisos: top.filter((r) => r.composicao).length,
        },
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" } }
  );
}
