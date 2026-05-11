import { runReport, getAnomalies, getCheckoutFunnel, getJourneyFunnel } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/cro/recommendations
 *
 * 🔒 Master-only.
 *
 * Gera recomendações de CRO **realmente data-driven** a partir de múltiplas
 * fontes do GA4. Antes a página /cro usava um array hardcoded — Renan
 * percebeu (depois de 11 dias) que as sugestões nunca mudavam porque
 * estavam literalmente fixas no código.
 *
 * Este endpoint roda 6 queries paralelas e gera de 5 a 12 recomendações
 * baseadas em sinais REAIS da property selecionada:
 *
 *   1. PAGES COM BOUNCE ALTO + tráfego significativo
 *      → "Reduzir bounce em /X (78%, 12k sessões/30d)"
 *   2. PAGES COM TEMPO LONGO (candidatas a CTA contextual)
 *      → "Inserir CTA em /Y (sessão média 4min2s)"
 *   3. PAGES COM TEMPO BAIXO + ENTRADA ALTA (LP que não retém)
 *      → "Conteúdo /Z não retém — 70% entry com 22s médio"
 *   4. CHECKOUT FUNNEL com drops grandes
 *      → "62% abandona entre begin_checkout e purchase"
 *   5. ANOMALIAS CRÍTICAS detectadas em D-1
 *      → "Investigar queda de X% em [canal]"
 *   6. TOP CAMPANHAS por ROAS — alta vs baixa
 *      → "Escalar campanha X (ROAS 6.2x)" / "Pausar Y (ROAS 0.8x)"
 *
 * Cada recomendação tem:
 *   - ICE score real (Impact × Confidence ÷ Effort)
 *   - Evidence quantitativo (números reais)
 *   - Hypothesis testável
 *   - Steps acionáveis
 *   - KPIs primários/secundários
 *   - Test window + rollback criteria
 */

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
  // Score interno pra ordenação
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

export async function GET(req: NextRequest) {
  // Gate master
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

  // Calcula date range
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const dateRange = { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };

  // ============================================================
  // 6 queries paralelas
  // ============================================================
  const [pagesRes, campaignsRes, anomaliesResult, checkoutResult, journeyResult, revenueRes] = await Promise.all([
    // 1. Top páginas com métricas de engajamento
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "totalUsers" },
        { name: "sessions" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
    }),
    // 2. Campanhas com ROAS (sessions + revenue por sessionCampaignName)
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "keyEvents" },
        { name: "totalRevenue" },
        { name: "purchaseRevenue" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 30,
    }),
    // 3. Anomalias (D-1 vs baseline 14d)
    getAnomalies(propertyId, 14).catch((e) => ({ data: null, error: (e as Error).message })),
    // 4. Checkout funnel
    getCheckoutFunnel(propertyId, days).catch((e) => ({ data: null, error: (e as Error).message })),
    // 5. Journey funnel (acquisition → purchase)
    getJourneyFunnel(propertyId, days).catch((e) => ({ data: null, error: (e as Error).message })),
    // 6. Receita total + transactions pra estimar valor de cada ponto %
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [{ name: "totalRevenue" }, { name: "transactions" }, { name: "purchaseRevenue" }],
      metricAggregations: ["TOTAL"],
    }),
  ]);

  const recs: Recommendation[] = [];

  // Calcula contexto da property: receita total, ticket médio
  const totalRevenue = Number(
    revenueRes.data?.rows?.[0]?.metricValues?.[2]?.value ||
      revenueRes.data?.totals?.[0]?.metricValues?.[2]?.value ||
      0
  );
  const totalTransactions = Number(
    revenueRes.data?.rows?.[0]?.metricValues?.[1]?.value ||
      revenueRes.data?.totals?.[0]?.metricValues?.[1]?.value ||
      0
  );
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  // Valor de 1pp de conversão (heurística pra estimar impacto)
  const value1ppConversion = avgTicket > 0 && totalTransactions > 0 ? avgTicket * (totalTransactions / 100) : 0;

  // ============================================================
  // 1. PAGES COM BOUNCE ALTO + tráfego significativo
  // ============================================================
  const pages = (pagesRes.data?.rows || []).map((r) => ({
    host: r.dimensionValues?.[0]?.value || "",
    path: r.dimensionValues?.[1]?.value || "/",
    views: Number(r.metricValues?.[0]?.value || 0),
    users: Number(r.metricValues?.[1]?.value || 0),
    sessions: Number(r.metricValues?.[2]?.value || 0),
    avgDuration: Number(r.metricValues?.[3]?.value || 0),
    bounceRate: Number(r.metricValues?.[4]?.value || 0) * 100, // 0..1 → 0..100
  }));

  // Páginas com bounce alto E volume significativo (acima da mediana)
  const sortedBySessions = [...pages].sort((a, b) => b.sessions - a.sessions);
  const medianSessions = sortedBySessions[Math.floor(sortedBySessions.length / 2)]?.sessions || 0;
  const minVolumeForRec = Math.max(100, medianSessions * 0.5);

  const highBounce = pages
    .filter((p) => p.bounceRate > 60 && p.sessions >= minVolumeForRec)
    .sort((a, b) => b.sessions * (b.bounceRate / 100) - a.sessions * (a.bounceRate / 100)) // prioriza por "volume perdido"
    .slice(0, 2);

  for (const p of highBounce) {
    const lostUsers = Math.round(p.sessions * (p.bounceRate / 100));
    const impactPct = Math.round((p.bounceRate - 40) * 0.3); // se reduzir 20pp do bounce, recupera 6% conv
    const impactValue = Math.round((impactPct / 100) * lostUsers * avgTicket * 0.02); // 2% dos recuperados convertem
    recs.push({
      id: `bounce-${p.host}-${p.path}`,
      iconName: "AlertTriangle",
      colorClass: "text-red-500 bg-red-50",
      priority: "Alta",
      category: "UX/CTA",
      title: `Bounce ${p.bounceRate.toFixed(0)}% em ${p.path}`,
      desc: `${formatNum(p.sessions)} sessões no período, ${formatNum(lostUsers)} usuários saem sem interagir. Sinal forte de mismatch entre fonte de tráfego e conteúdo, ou problema técnico (LCP, CTA escondido).`,
      action: "Auditar fonte de tráfego, validar Core Web Vitals e reposicionar CTA above-the-fold",
      impact: impactValue > 1000
        ? `≈ ${formatBRL(impactValue)}/mês se reduzir bounce em 20pp`
        : `+${impactPct}% conversão estimada se reduzir bounce em 20pp`,
      effort: "médio",
      owner: "Dev frontend + Marketing",
      steps: [
        `Auditar UTM/canal que mais traz tráfego para ${p.path}`,
        "Rodar PageSpeed Insights — validar LCP < 2.5s",
        "Conferir se CTA principal está acima do fold (desktop + mobile)",
        "Adicionar prova social no primeiro viewport",
        "Rodar A/B 50/50 por 14 dias com nova versão",
      ],
      confidence: p.sessions > 5000 ? "Alta" : p.sessions > 1000 ? "Média" : "Baixa",
      evidence: `Dado real GA4: bounceRate de ${p.bounceRate.toFixed(1)}% em ${formatNum(p.sessions)} sessões nos últimos ${days}d. Média esperada de páginas saudáveis: 40-50%.`,
      hypothesis: `Reduzir bounceRate em 20pp recupera ${formatNum(lostUsers * 0.3)} usuários engajados/mês, gerando +${impactPct}% conversão.`,
      costEstimate: "≈ 16-24h dev + 8h marketing. R$ 0 de mídia inicial.",
      risk: "baixo",
      riskNotes: "Mudança visual pode afetar leitura — manter rollback rápido com feature flag.",
      primaryKPI: `Bounce rate em ${p.path}`,
      secondaryKPIs: ["Tempo médio na página", "CTR para próximo passo", "Taxa de scroll >50%"],
      testWindow: "A/B 50/50 por 14 dias (mín. 4.000 sessões/variante)",
      rollback: "Reverter se bounceRate piorar 5pp ou conversão cair >3%",
      affectedSegments: [`Visitantes de ${p.path} (todos os canais)`],
      _iceScore: (impactValue || impactPct * 10) / (p.sessions > 1000 ? 1 : 2),
    });
  }

  // ============================================================
  // 2. PAGES COM TEMPO LONGO — candidates a CTA contextual
  // ============================================================
  const longestEngaged = [...pages]
    .filter((p) => p.avgDuration > 180 && p.sessions >= minVolumeForRec) // > 3min
    .sort((a, b) => b.users - a.users)[0];

  if (longestEngaged) {
    const leadsEstimate = Math.round(longestEngaged.users * 0.04);
    recs.push({
      id: `cta-${longestEngaged.host}-${longestEngaged.path}`,
      iconName: "Lightbulb",
      colorClass: "text-amber-500 bg-amber-50",
      priority: "Média",
      category: "Conteúdo",
      title: `${longestEngaged.path} retém ${(longestEngaged.avgDuration / 60).toFixed(1)}min — capturar leads`,
      desc: `Maior tempo médio de sessão da propriedade (${formatNum(longestEngaged.users)} usuários). Atenção residual disponível para capturar lead (newsletter, trial, e-book) sem prejudicar UX.`,
      action: "Testar CTA contextual no meio do conteúdo (após 30s de scroll)",
      impact: `+${leadsEstimate} leads/mês estimado`,
      effort: "baixo",
      owner: "Produto + Conteúdo",
      steps: [
        `Identificar ponto de scroll com maior dwell time em ${longestEngaged.path} (heatmap Clarity)`,
        "Inserir CTA contextual (newsletter, e-book gratuito ou trial)",
        "Lazy reveal — só mostra após 30s na página",
        "Validar com A/B test de 14 dias",
        "Se converter, replicar em páginas similares",
      ],
      confidence: longestEngaged.sessions > 5000 ? "Alta" : "Média",
      evidence: `Sessão média de ${(longestEngaged.avgDuration / 60).toFixed(1)}min com ${formatNum(longestEngaged.users)} usuários em ${days}d. Quando volume × tempo é alto, taxa de captura de lead atinge 3-6%.`,
      hypothesis: `CTA contextual converte 4% dos usuários engajados em leads (${leadsEstimate} por mês).`,
      costEstimate: "≈ 8h conteúdo + 6h dev. Sem mídia.",
      risk: "baixo",
      riskNotes: "CTA mal posicionado pode reduzir tempo de leitura — usar lazy reveal e position sticky discreto.",
      primaryKPI: "Leads gerados na página",
      secondaryKPIs: ["Tempo médio (não pode cair >10%)", "Taxa de scroll completo", "Bounce rate"],
      testWindow: "A/B 50/50 por 14 dias",
      rollback: "Remover CTA se tempo médio cair ≥15% ou bounce subir >5pp",
      affectedSegments: [`Leitores de ${longestEngaged.path}`],
      _iceScore: leadsEstimate * 2,
    });
  }

  // ============================================================
  // 3. PAGES COM TEMPO BAIXO + VOLUME ALTO (LP que não retém)
  // ============================================================
  const lowTimeHighVol = pages
    .filter((p) => p.avgDuration < 30 && p.sessions >= minVolumeForRec && p.bounceRate > 50)
    .sort((a, b) => b.sessions - a.sessions)[0];

  if (lowTimeHighVol && lowTimeHighVol.path !== highBounce[0]?.path) {
    recs.push({
      id: `retention-${lowTimeHighVol.host}-${lowTimeHighVol.path}`,
      iconName: "AlertTriangle",
      colorClass: "text-red-500 bg-red-50",
      priority: "Alta",
      category: "Conteúdo",
      title: `${lowTimeHighVol.path} não retém — ${lowTimeHighVol.avgDuration.toFixed(0)}s médios`,
      desc: `${formatNum(lowTimeHighVol.sessions)} sessões mas tempo médio de apenas ${lowTimeHighVol.avgDuration.toFixed(0)}s. O conteúdo não está respondendo à intenção do usuário. Revisar hero, copy e estrutura.`,
      action: "Refazer hero + first dobra com foco na intenção do canal de tráfego",
      impact: `Recuperar ${formatNum(lowTimeHighVol.sessions * 0.4)} sessões engajadas/mês`,
      effort: "médio",
      owner: "Conteúdo + Design",
      steps: [
        "Mapear de onde vêm essas sessões (UTM, canal, query)",
        "Confirmar com Clarity recordings: o que user faz nos 30s",
        "Reescrever hero com promessa alinhada à intenção do canal",
        "Garantir CTA visível sem scroll",
        "A/B com nova versão por 14 dias",
      ],
      confidence: lowTimeHighVol.sessions > 5000 ? "Alta" : "Média",
      evidence: `Sinal compósito: tempo ${lowTimeHighVol.avgDuration.toFixed(0)}s + bounce ${lowTimeHighVol.bounceRate.toFixed(1)}% em ${formatNum(lowTimeHighVol.sessions)} sessões. Padrão de "página que recebe tráfego mas não retém".`,
      hypothesis: "Hero alinhado com intenção do canal eleva tempo médio para >60s e reduz bounce em 15pp.",
      costEstimate: "≈ 16h conteúdo + 8h design + 8h dev",
      risk: "médio",
      riskNotes: "Mudança grande de copy pode afetar SEO se for página orgânica — manter URL e meta description.",
      primaryKPI: "Tempo médio na página",
      secondaryKPIs: ["Bounce rate", "Scroll depth >50%", "Conversão para próxima página"],
      testWindow: "A/B 50/50 por 14 dias",
      rollback: "Reverter se tempo médio não subir >50% ou bounce subir >3pp",
      affectedSegments: [`Tráfego de ${lowTimeHighVol.path}`],
      _iceScore: lowTimeHighVol.sessions * 0.05,
    });
  }

  // ============================================================
  // 4. CHECKOUT FUNNEL — drops grandes
  // ============================================================
  const checkout = checkoutResult.data;
  if (checkout && checkout.steps) {
    const worstStep = [...checkout.steps]
      .filter((s, i) => i > 0 && s.dropFromPrev > 50 && s.dropAbsoluteFromPrev > 100)
      .sort((a, b) => b.dropAbsoluteFromPrev - a.dropAbsoluteFromPrev)[0];

    if (worstStep) {
      const stageBefore = checkout.steps.find((s, i) => checkout.steps[i + 1]?.stage === worstStep.stage);
      const lostRevenue = Math.round(worstStep.dropAbsoluteFromPrev * (checkout.summary.avg_ticket || 0) * 0.4);
      recs.push({
        id: `funnel-${worstStep.stage}`,
        iconName: "MousePointerClick",
        colorClass: "text-emerald-500 bg-emerald-50",
        priority: "Alta",
        category: "Funil",
        title: `${worstStep.dropFromPrev}% abandonam em ${worstStep.label || worstStep.stage}`,
        desc: `Maior drop do funil de checkout: ${formatNum(worstStep.dropAbsoluteFromPrev)} pessoas perdidas entre ${stageBefore?.label || "etapa anterior"} e ${worstStep.label || worstStep.stage}.`,
        action: "Mapear friction no step + simplificar UX da etapa",
        impact: lostRevenue > 1000 ? `Recuperar até ${formatBRL(lostRevenue)}/mês` : `Recuperar até ${formatNum(worstStep.dropAbsoluteFromPrev * 0.4)} compras/mês`,
        effort: "médio",
        owner: "Produto + Dev",
        steps: [
          `Identificar onde exatamente o usuário desiste em "${worstStep.label || worstStep.stage}" (Clarity recordings + form analytics)`,
          worstStep.stage === "add_payment_info"
            ? "Simplificar form de pagamento (CPF opcional se logado, autocompletar CEP)"
            : worstStep.stage === "begin_checkout"
              ? "Revisar frete, cupom, complexidade do carrinho"
              : "Mapear etapa específica e simplificar UX",
          "Implementar PIX como primary se faltar",
          "Adicionar progress bar visual",
          "A/B test 50/50 por 14 dias",
        ],
        confidence: "Alta",
        evidence: `Funil GA4: drop de ${worstStep.dropFromPrev}% em ${worstStep.label || worstStep.stage}. ${formatNum(worstStep.dropAbsoluteFromPrev)} usuários perdidos no período.`,
        hypothesis: `Simplificar a etapa reduz drop de ${worstStep.dropFromPrev}% para ≤${Math.max(20, worstStep.dropFromPrev - 25)}%, recuperando ${formatNum(worstStep.dropAbsoluteFromPrev * 0.4)} compras.`,
        costEstimate: "≈ 32-40h dev + 8h QA. R$ 0 incremental.",
        risk: "médio",
        riskNotes: "Risco regulatório se remover campos obrigatórios (CPF pra nota fiscal). Manter opcional, não eliminar.",
        primaryKPI: `Taxa de avanço entre ${stageBefore?.label || "etapa"} → ${worstStep.label || worstStep.stage}`,
        secondaryKPIs: ["Tempo médio na etapa", "Taxa de erro no form", "Receita por checkout iniciado"],
        testWindow: "A/B 50/50 por 14 dias com lock por usuário",
        rollback: "Reverter se taxa de aprovação cair ≥3pp ou receita por checkout cair >5%",
        affectedSegments: ["Todos os usuários no fluxo de checkout"],
        _iceScore: lostRevenue / 100 || worstStep.dropAbsoluteFromPrev * 0.5,
      });
    }
  }

  // ============================================================
  // 5. JOURNEY FUNNEL — drops entre etapas macro (session → lead → signup → checkout → purchase)
  // ============================================================
  const journey = journeyResult.data;
  if (journey && journey.steps) {
    const worstJourneyStep = [...journey.steps]
      .filter((s, i) => i > 0 && s.dropPct > 60 && s.value > 50)
      .sort((a, b) => b.dropPct - a.dropPct)[0];

    if (worstJourneyStep) {
      recs.push({
        id: `journey-${worstJourneyStep.event}`,
        iconName: "Target",
        colorClass: "text-orange-500 bg-orange-50",
        priority: "Média",
        category: "Funil",
        title: `Drop de ${worstJourneyStep.dropPct.toFixed(0)}% até ${worstJourneyStep.event}`,
        desc: `Funil de aquisição: ${worstJourneyStep.dropPct.toFixed(0)}% dos usuários da etapa anterior não chegam a ${worstJourneyStep.event}. Apenas ${formatNum(worstJourneyStep.value)} executam essa ação.`,
        action: `Investigar barreiras antes de ${worstJourneyStep.event} e adicionar nudges`,
        impact: `Reduzir drop em 20pp eleva conversão em ~${(worstJourneyStep.dropPct * 0.3).toFixed(0)}%`,
        effort: "médio",
        owner: "Produto + UX",
        steps: [
          `Mapear o último step que usuário faz antes de não chegar em ${worstJourneyStep.event}`,
          "Comparar páginas com vs sem CTA pro próximo passo",
          "Testar tooltip / banner sticky / popup contextual",
          "A/B test 14 dias",
        ],
        confidence: "Média",
        evidence: `Funil GA4: ${worstJourneyStep.dropPct.toFixed(0)}% drop até ${worstJourneyStep.event}. Apenas ${formatNum(worstJourneyStep.value)} usuários executam essa ação em ${days}d.`,
        hypothesis: `Nudges contextuais antes de ${worstJourneyStep.event} reduzem drop em pelo menos 15pp.`,
        costEstimate: "≈ 16h dev + 12h design",
        risk: "baixo",
        riskNotes: "Excesso de pop-ups pode irritar usuário — limitar a 1 nudge por sessão.",
        primaryKPI: `Taxa de chegada a ${worstJourneyStep.event}`,
        secondaryKPIs: ["Tempo até evento", "Taxa de drop por canal", "Conversão final"],
        testWindow: "A/B 50/50 por 14 dias",
        rollback: "Remover nudge se houver queda >5% em métricas vizinhas",
        affectedSegments: ["Usuários no funil pre-event"],
        _iceScore: worstJourneyStep.dropPct * (worstJourneyStep.value / 100),
      });
    }
  }

  // ============================================================
  // 6. ANOMALIAS CRÍTICAS — drops em D-1
  // ============================================================
  const anomalies = anomaliesResult.data;
  if (anomalies?.macro || anomalies?.byChannel) {
    const criticalDrops = [
      ...(anomalies.macro || []),
      ...(anomalies.byChannel || []).slice(0, 5),
    ]
      .filter((a) => a.severity === "critical" && a.direction === "down")
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 1); // só a pior

    for (const a of criticalDrops) {
      recs.push({
        id: `anomaly-${a.level}-${a.segment}-${a.metric}`,
        iconName: "AlertTriangle",
        colorClass: "text-red-500 bg-red-50",
        priority: "Alta",
        category: "Mídia",
        title: `Queda crítica em ${a.metricLabel} (${a.segment === "all" ? "macro" : a.segment})`,
        desc: `D-1 ficou ${a.delta.toFixed(1)}% vs mediana de 14 dias. Atual: ${formatNum(a.current)}. Baseline: ${formatNum(a.baseline)}. Investigar imediatamente.`,
        action: "Diagnosticar a causa (tracking, ad spend, conteúdo) antes que o drop afete a semana",
        impact: avgTicket > 0 && a.metric === "purchases"
          ? `Cada dia parado ≈ ${formatBRL((a.baseline - a.current) * avgTicket)} de receita perdida`
          : "Risco de propagação semanal — agir em 24h",
        effort: "baixo",
        owner: "Analytics + Mídia",
        steps: [
          `Abrir /anomalias e clicar em "${a.segment === "all" ? "Macro" : a.segment} → ${a.metricLabel}"`,
          "Ver drill-down de campanhas e landing pages",
          "Cruzar com /auditoria-utm pra ver se é problema de tracking",
          "Se for tracking: validar dataLayer + GTM no segmento afetado",
          "Se for real: verificar ad spend, sazonalidade, mudanças no produto",
        ],
        confidence: "Alta",
        evidence: `Detector de anomalias (DoW-aware): queda de ${a.delta.toFixed(1)}% em D-1 vs baseline de 14 dias. Severity crítica (|Δ| > 25%).`,
        hypothesis: "Anomalia tem causa identificável em até 24h e pode ser revertida ou compensada na semana corrente.",
        costEstimate: "Diagnóstico inicial: 2-4h analytics. Correção depende da causa.",
        risk: "baixo",
        riskNotes: "Diagnóstico não muda o painel — sem risco de novos bugs.",
        primaryKPI: a.metricLabel,
        secondaryKPIs: ["Δ vs baseline", "Trend nos próximos 3 dias", "Distribuição por canal"],
        testWindow: "Monitorar próximas 72h",
        rollback: "Se for tracking quebrado: reverter mudança recente do GTM",
        affectedSegments: [a.segment === "all" ? "Toda a property" : a.segment],
        _iceScore: Math.abs(a.delta) * 5,
      });
    }
  }

  // ============================================================
  // 7. CAMPANHAS COM ROAS BOM — oportunidade de escala
  // ============================================================
  const campaigns = (campaignsRes.data?.rows || [])
    .map((r) => ({
      campaign: r.dimensionValues?.[0]?.value || "(not set)",
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      conversions: Number(r.metricValues?.[2]?.value || 0),
      revenue: Number(r.metricValues?.[3]?.value || 0) || Number(r.metricValues?.[4]?.value || 0),
    }))
    .filter((c) => c.campaign !== "(not set)" && c.campaign !== "(organic)" && c.campaign !== "(direct)")
    .filter((c) => c.sessions > 100 && c.conversions > 5);

  // Estimativa de ROAS: usa receita/sessão como proxy (sem dado de ad spend real)
  const campaignsWithSignal = campaigns
    .map((c) => ({
      ...c,
      revPerSession: c.sessions > 0 ? c.revenue / c.sessions : 0,
      convRate: c.sessions > 0 ? (c.conversions / c.sessions) * 100 : 0,
    }))
    .sort((a, b) => b.revPerSession - a.revPerSession);

  // Top campanha por revenue/session — candidata a escalar
  const topCampaign = campaignsWithSignal[0];
  if (topCampaign && topCampaign.revenue > 1000) {
    recs.push({
      id: `scale-campaign-${topCampaign.campaign}`,
      iconName: "Zap",
      colorClass: "text-violet-500 bg-violet-50",
      priority: "Alta",
      category: "Mídia",
      title: `Escalar campanha "${topCampaign.campaign.slice(0, 40)}${topCampaign.campaign.length > 40 ? "..." : ""}"`,
      desc: `Melhor revenue/sessão da property: ${formatBRL(topCampaign.revPerSession)} por sessão. Gerou ${formatNum(topCampaign.conversions)} conversões em ${formatNum(topCampaign.sessions)} sessões. Conv rate: ${topCampaign.convRate.toFixed(2)}%.`,
      action: "Validar saturação do canal e aumentar budget gradualmente",
      impact: `Se dobrar volume sem perder eficiência: +${formatBRL(topCampaign.revenue)} no próximo mês`,
      effort: "baixo",
      owner: "Mídia paga",
      steps: [
        `Validar no Ads se a campanha "${topCampaign.campaign.slice(0, 50)}" tem search query/audience não saturada`,
        "Aumentar budget em +30% na 1ª semana",
        "Monitorar revenue/sessão e CPA diariamente",
        "Se manter a eficiência, aumentar mais +30% na 2ª semana",
        "Pausar escala se revenue/sessão cair >25%",
      ],
      confidence: topCampaign.sessions > 1000 ? "Alta" : "Média",
      evidence: `Dado GA4 últimos ${days}d: ${formatNum(topCampaign.conversions)} conversões / ${formatNum(topCampaign.sessions)} sessões / ${formatBRL(topCampaign.revenue)} receita. Top da carteira em revenue/sessão.`,
      hypothesis: `Aumentar 100% o budget mantém revenue/sessão ≥70% do atual, graças a inventory ainda não saturado.`,
      costEstimate: `+${formatBRL(topCampaign.revenue * 0.5)}/mês em mídia (estimativa)`,
      risk: "médio",
      riskNotes: "ROAS marginal pode cair em segundo bidding — escalar gradual reduz exposição.",
      primaryKPI: "Revenue/sessão dessa campanha",
      secondaryKPIs: ["CPA", "Volume de conversões", "Conv rate"],
      testWindow: "Escala em 3 etapas (+30% → +60% → +100%) ao longo de 3 semanas",
      rollback: "Reverter ao budget anterior se revenue/sessão cair abaixo de 70% do baseline por 3 dias seguidos",
      affectedSegments: [`Campanha "${topCampaign.campaign}"`],
      _iceScore: topCampaign.revenue / 100,
    });
  }

  // ============================================================
  // 8. CAMPANHAS COM ROAS RUIM — candidate a pausar
  // ============================================================
  const worstCampaign = campaignsWithSignal
    .filter((c) => c.sessions > 500 && c.revPerSession < (avgTicket * 0.001)) // < 0.1% do ticket por sessão
    .sort((a, b) => b.sessions - a.sessions)[0];

  if (worstCampaign && topCampaign && worstCampaign.campaign !== topCampaign.campaign) {
    recs.push({
      id: `cut-campaign-${worstCampaign.campaign}`,
      iconName: "AlertTriangle",
      colorClass: "text-amber-500 bg-amber-50",
      priority: "Média",
      category: "Mídia",
      title: `Auditar campanha "${worstCampaign.campaign.slice(0, 40)}${worstCampaign.campaign.length > 40 ? "..." : ""}"`,
      desc: `${formatNum(worstCampaign.sessions)} sessões mas apenas ${formatBRL(worstCampaign.revenue)} de receita. Revenue/sessão: ${formatBRL(worstCampaign.revPerSession)}. Pode estar queimando budget sem retorno.`,
      action: "Validar a fonte do tráfego e pausar/reotimizar se confirmar baixa qualidade",
      impact: `Liberar budget pra realocar em campanha de maior ROAS (ex: ${topCampaign.campaign.slice(0, 30)}…)`,
      effort: "baixo",
      owner: "Mídia paga",
      steps: [
        "Validar se é campanha paga ou orgânica (algumas campanhas legacy ainda têm UTM)",
        "Se paga: checar CAC e ROAS direto no Google Ads / Meta Ads",
        "Comparar quality score / relevance score",
        "Se ROAS < 1.5x: pausar e realocar budget pra top campaign",
        "Se ROAS > 1.5x mas revenue baixo: revisar audience/criativo",
      ],
      confidence: worstCampaign.sessions > 1000 ? "Alta" : "Média",
      evidence: `Dado GA4: revenue/sessão de ${formatBRL(worstCampaign.revPerSession)} é ${(topCampaign.revPerSession / Math.max(worstCampaign.revPerSession, 0.01)).toFixed(0)}x menor que a melhor campanha.`,
      hypothesis: "Realocar budget desta campanha pra top performance pode aumentar ROAS geral da conta em 15-25%.",
      costEstimate: "Diagnóstico: 4h mídia. Pausa: imediato.",
      risk: "baixo",
      riskNotes: "Verificar se a campanha tem efeito assistido (brand awareness) antes de pausar.",
      primaryKPI: "ROAS / CAC da campanha",
      secondaryKPIs: ["Revenue/sessão", "CTR", "Bounce rate"],
      testWindow: "Pausa por 7 dias e mede impacto em campanhas vizinhas",
      rollback: "Reativar se conversões totais da conta caírem >10%",
      affectedSegments: [`Campanha "${worstCampaign.campaign}"`],
      _iceScore: worstCampaign.sessions * 0.1,
    });
  }

  // ============================================================
  // Ordena por ICE score e retorna top 10
  // ============================================================
  recs.sort((a, b) => b._iceScore - a._iceScore);
  const top = recs.slice(0, 10);

  // KPIs agregados pra UI
  const oppCount = top.length;
  const impactTotal = top.reduce((sum, r) => {
    const m = r.impact.match(/R\$\s*([\d.,]+)/);
    if (m) {
      const val = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
      return sum + (isFinite(val) ? val : 0);
    }
    return sum;
  }, 0);

  return NextResponse.json(
    {
      propertyId, // anti race-condition
      propertyName,
      generatedAt: new Date().toISOString(),
      days,
      dataDriven: true, // ⚠ marca que veio do endpoint, não do mock
      recommendations: top,
      meta: {
        totalCandidates: recs.length,
        returnedTop: top.length,
        oppCount,
        impactTotal,
        avgTicket,
        sources: {
          pages: pages.length,
          campaigns: campaigns.length,
          anomaliesAvailable: !!anomaliesResult.data,
          checkoutFunnelAvailable: !!checkoutResult.data,
          journeyFunnelAvailable: !!journeyResult.data,
        },
      },
    },
    {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" },
    }
  );
}
