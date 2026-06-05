// src/lib/cro-rules.ts

/**
 * Motor de heurísticas CRO — 11 regras data-driven (v1).
 *
 * Cada regra é uma função pura que recebe LP + contexto e decide se
 * deve gerar uma proposta. Sem efeitos colaterais, sem chamadas externas.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (4.2)
 *
 * Categorias:
 *  - CRITICAL_RULES: tracking, conv-vs-median, bounce, time (4 regras)
 *  - ATTENTION_RULES: conv-below-median, bounce-high, time-short,
 *                     engagement-low, regression-week (5 regras)
 *  - OPTIMIZATION_RULES: replicate-winner, channel-mismatch (2 regras)
 *
 * v2 backlog: dead-clicks-high (depende de integração Clarity API)
 */

import { createHash } from "crypto";
import {
  CRORule,
  LPData,
  Proposal,
  RuleContext,
} from "./cro-types";
import {
  impactoFechaGapMediana,
  impactoQualitativo,
} from "./cro-impact";

// ------------ Helpers ------------

/** Gera proposal_key estável baseado em LP url + rule id */
function makeKey(lp: LPData, ruleId: string): string {
  const hash = createHash("sha256")
    .update(lp.url)
    .digest("hex")
    .slice(0, 8);
  return `${hash}:${ruleId}`;
}

/** Formata percentual com 1 casa decimal */
function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Formata número com separador BR */
function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

// ===================================================================
// REGRAS CRÍTICAS
// ===================================================================

const ruleTrackingBroken: CRORule = {
  id: "tracking-broken",
  priority: "critico",
  category: "tracking",
  trigger: (lp) => lp.sessions >= 500 && lp.leadCount === 0 && lp.ctaCount === 0,
  generate: (lp): Proposal => ({
    rule_id: "tracking-broken",
    proposal_key: makeKey(lp, "tracking-broken"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "critico",
    category: "tracking",
    titulo: "LP sem nenhum evento de conversão",
    hipotese: `LP \`${lp.path}\` recebeu **${fmt(lp.sessions)} sessões** sem disparar nenhum \`generate_lead\` nem \`cta_click\`. Provável bug de tracking ou formulário/CTA quebrado.`,
    acaoSugerida: `Abrir a LP em janela anônima, completar formulário/clicar CTA, verificar no GA4 Realtime se evento dispara. Se não disparar, conferir GTM. Se evento existe mas com outro nome, ajustar regra.`,
    effort: "baixo",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      `${fmt(lp.sessions)} sessões no período`,
      `0 eventos generate_lead disparados`,
      `0 eventos cta_click disparados`,
      `Bounce rate: ${pct(lp.bounceRate)}`,
    ],
    benchmarks: [
      "Esperado: pelo menos 1% das sessões disparam generate_lead ou cta_click",
    ],
  }),
};

const ruleConvVsHostMedian: CRORule = {
  id: "conv-vs-host-median",
  priority: "critico",
  category: "conversion",
  trigger: (lp, ctx) => {
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 && lp.leadConvRate < median * 0.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const topLP = ctx.hostTopLP[lp.host];
    return {
      rule_id: "conv-vs-host-median",
      proposal_key: makeKey(lp, "conv-vs-host-median"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "critico",
      category: "conversion",
      titulo: "Conversão metade da mediana do host",
      hipotese: `LP \`${lp.path}\` converte **${pct(lp.leadConvRate)}** vs mediana de **${pct(median)}** do host \`${lp.host}\`. Top LP do host (\`${topLP?.path || "n/a"}\`) faz **${pct(topLP?.leadConvRate || 0)}**.`,
      acaoSugerida: `Comparar formulário, copy do CTA e proposta de valor com a top LP do host. Testar versão A/B replicando elementos vencedores.`,
      effort: "medio",
      impactoEstimado: impactoFechaGapMediana(lp, median, ctx.rangeDays),
      sinaisDetalhados: [
        `Conv. lead atual: ${pct(lp.leadConvRate)}`,
        `Mediana do host: ${pct(median)}`,
        `Top LP do host: ${pct(topLP?.leadConvRate || 0)} (${topLP?.path || "n/a"})`,
        `Sessões: ${fmt(lp.sessions)}`,
      ],
      benchmarks: [
        `Mediana host \`${lp.host}\`: ${pct(median)}`,
        topLP ? `Top LP: ${topLP.path} → ${pct(topLP.leadConvRate)}` : "",
      ].filter(Boolean),
    };
  },
};

const ruleBounceCritical: CRORule = {
  id: "bounce-critical",
  priority: "critico",
  category: "engagement",
  trigger: (lp) => lp.sessions >= 200 && lp.bounceRate > 0.7,
  generate: (lp): Proposal => ({
    rule_id: "bounce-critical",
    proposal_key: makeKey(lp, "bounce-critical"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "critico",
    category: "engagement",
    titulo: "Rejeição crítica acima de 70%",
    hipotese: `LP \`${lp.path}\` tem rejeição de **${pct(lp.bounceRate)}** — usuários chegam mas saem imediatamente. Provavelmente o criativo/anúncio promete algo diferente do que a LP entrega.`,
    acaoSugerida: `Auditar match entre criativos de mídia (Meta + Google) e o hero da LP. Hipótese: ajustar headline + sub-headline pra alinhar com promessa do anúncio.`,
    effort: "medio",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      `Bounce rate: ${pct(lp.bounceRate)} (limite alerta: 70%)`,
      `${fmt(lp.sessions)} sessões impactadas`,
      `Conv. lead: ${pct(lp.leadConvRate)}`,
      `Tempo médio sessão: ${lp.avgSessionDuration.toFixed(0)}s`,
    ],
    benchmarks: [
      "Bounce saudável LP de captura: 30-50%",
      "Bounce crítico: >70%",
    ],
  }),
};

const ruleTimeCritical: CRORule = {
  id: "time-critical",
  priority: "critico",
  category: "engagement",
  trigger: (lp) => lp.sessions >= 200 && lp.avgSessionDuration < 20,
  generate: (lp): Proposal => ({
    rule_id: "time-critical",
    proposal_key: makeKey(lp, "time-critical"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "critico",
    category: "engagement",
    titulo: "Primeira dobra não convence — sessão <20s",
    hipotese: `LP \`${lp.path}\` tem sessão média de apenas **${lp.avgSessionDuration.toFixed(0)}s**. Usuário sai antes mesmo de ler. Headline e prova social inicial não estão convencendo.`,
    acaoSugerida: `Testar variação A/B do hero com: (1) headline mais direta com benefício claro, (2) sub-headline com prova social numérica (ex: "+50 mil investidores"), (3) CTA visível sem scroll.`,
    effort: "baixo",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      `Tempo médio: ${lp.avgSessionDuration.toFixed(0)}s (limite alerta: 20s)`,
      `${fmt(lp.sessions)} sessões impactadas`,
      `Engajamento: ${pct(lp.engagementRate)}`,
      `Bounce: ${pct(lp.bounceRate)}`,
    ],
    benchmarks: [
      "Tempo saudável LP de captura: 60-120s",
      "Tempo crítico: <30s",
    ],
  }),
};

export const CRITICAL_RULES: CRORule[] = [
  ruleTrackingBroken,
  ruleConvVsHostMedian,
  ruleBounceCritical,
  ruleTimeCritical,
];

// ===================================================================
// REGRAS DE ATENÇÃO
// ===================================================================

const ruleConvBelowMedian: CRORule = {
  id: "conv-below-median",
  priority: "atencao",
  category: "conversion",
  trigger: (lp, ctx) => {
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 &&
      lp.leadConvRate < median * 0.75 && lp.leadConvRate >= median * 0.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    return {
      rule_id: "conv-below-median",
      proposal_key: makeKey(lp, "conv-below-median"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "atencao",
      category: "conversion",
      titulo: "Conversão abaixo da mediana do host",
      hipotese: `LP \`${lp.path}\` converte **${pct(lp.leadConvRate)}** vs mediana **${pct(median)}** do host. Gap de ${pct(median - lp.leadConvRate)} no host.`,
      acaoSugerida: `Testar variação A/B do copy do CTA + revisar campos do formulário (reduzir atrito). Trocar 1 campo por vez.`,
      effort: "baixo",
      impactoEstimado: impactoFechaGapMediana(lp, median, ctx.rangeDays),
      sinaisDetalhados: [
        `Conv. lead: ${pct(lp.leadConvRate)}`,
        `Mediana host: ${pct(median)}`,
        `Gap: ${pct(median - lp.leadConvRate)}`,
        `Sessões: ${fmt(lp.sessions)}`,
      ],
      benchmarks: [`Mediana \`${lp.host}\`: ${pct(median)}`],
    };
  },
};

const ruleBounceHigh: CRORule = {
  id: "bounce-high",
  priority: "atencao",
  category: "engagement",
  trigger: (lp) =>
    lp.sessions >= 100 && lp.bounceRate > 0.55 && lp.bounceRate <= 0.7,
  generate: (lp): Proposal => ({
    rule_id: "bounce-high",
    proposal_key: makeKey(lp, "bounce-high"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "atencao",
    category: "engagement",
    titulo: "Rejeição moderada — hero pode estar abaixo da dobra",
    hipotese: `Bounce de **${pct(lp.bounceRate)}** indica usuário sai sem rolar. Possível CTA abaixo da dobra ou hero pouco atrativo.`,
    acaoSugerida: `Testar versão com CTA visível sem scroll + reforçar headline na primeira dobra.`,
    effort: "medio",
    impactoEstimado: impactoQualitativo("moderado"),
    sinaisDetalhados: [
      `Bounce: ${pct(lp.bounceRate)}`,
      `Sessões: ${fmt(lp.sessions)}`,
      `Tempo médio: ${lp.avgSessionDuration.toFixed(0)}s`,
    ],
    benchmarks: ["Bounce saudável LP captura: 30-55%"],
  }),
};

const ruleTimeShort: CRORule = {
  id: "time-short",
  priority: "atencao",
  category: "engagement",
  trigger: (lp) =>
    lp.sessions >= 100 && lp.avgSessionDuration >= 20 && lp.avgSessionDuration < 60,
  generate: (lp): Proposal => ({
    rule_id: "time-short",
    proposal_key: makeKey(lp, "time-short"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "atencao",
    category: "engagement",
    titulo: "Sessão curta — usuário não chega no CTA",
    hipotese: `Tempo médio de **${lp.avgSessionDuration.toFixed(0)}s** sugere que usuário lê parte do conteúdo mas não chega no CTA. CTA pode estar longe demais.`,
    acaoSugerida: `Mover CTA pra mais cedo na página OU repetir CTA ao longo do scroll (após cada bloco de prova social).`,
    effort: "baixo",
    impactoEstimado: impactoQualitativo("moderado"),
    sinaisDetalhados: [
      `Tempo médio: ${lp.avgSessionDuration.toFixed(0)}s`,
      `Sessões: ${fmt(lp.sessions)}`,
      `Engajamento: ${pct(lp.engagementRate)}`,
    ],
    benchmarks: ["Tempo saudável: 60-120s"],
  }),
};

const ruleEngagementLow: CRORule = {
  id: "engagement-low",
  priority: "atencao",
  category: "engagement",
  trigger: (lp) => lp.sessions >= 100 && lp.engagementRate < 0.4,
  generate: (lp): Proposal => ({
    rule_id: "engagement-low",
    proposal_key: makeKey(lp, "engagement-low"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "atencao",
    category: "engagement",
    titulo: "Engajamento baixo — pouca interação",
    hipotese: `Engajamento de **${pct(lp.engagementRate)}** (vs 50%+ esperado) indica usuário não interage com elementos da página. Conteúdo pode ser estático demais.`,
    acaoSugerida: `Adicionar elementos interativos: vídeo curto (15-30s) acima da dobra, prova social com depoimentos visíveis, ou animação leve no CTA.`,
    effort: "medio",
    impactoEstimado: impactoQualitativo("moderado"),
    sinaisDetalhados: [
      `Engagement rate: ${pct(lp.engagementRate)}`,
      `Engaged sessions: ${fmt(lp.engagedSessions)} / ${fmt(lp.sessions)}`,
    ],
    benchmarks: ["Engagement saudável: >50%"],
  }),
};

const ruleRegressionWeek: CRORule = {
  id: "regression-week",
  priority: "atencao",
  category: "conversion",
  trigger: (lp, ctx) => {
    const prev = ctx.previousPeriod[lp.url];
    if (!prev || prev.leadConvRate === 0 || lp.sessions < 100) return false;
    const delta = (prev.leadConvRate - lp.leadConvRate) / prev.leadConvRate;
    return delta > 0.2;
  },
  generate: (lp, ctx): Proposal => {
    const prev = ctx.previousPeriod[lp.url];
    const dropPP = ((prev.leadConvRate - lp.leadConvRate) * 100).toFixed(1);
    return {
      rule_id: "regression-week",
      proposal_key: makeKey(lp, "regression-week"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "atencao",
      category: "conversion",
      titulo: "Regressão vs período anterior",
      hipotese: `Conv. caiu de **${pct(prev.leadConvRate)}** (período anterior) para **${pct(lp.leadConvRate)}** atual — queda de ${dropPP}pp.`,
      acaoSugerida: `Investigar o que mudou no período: novos criativos de mídia, alteração da LP, mudança de tracking. Reverter se for regressão de tracking; se for criativo, ajustar.`,
      effort: "medio",
      impactoEstimado: `Recuperar ${dropPP}pp pra voltar ao patamar anterior`,
      sinaisDetalhados: [
        `Atual: ${pct(lp.leadConvRate)}`,
        `Anterior (mesmo range): ${pct(prev.leadConvRate)}`,
        `Queda: ${dropPP}pp`,
        `Sessões atuais: ${fmt(lp.sessions)} | anteriores: ${fmt(prev.sessions)}`,
      ],
      benchmarks: [`Período anterior: ${pct(prev.leadConvRate)}`],
    };
  },
};

export const ATTENTION_RULES: CRORule[] = [
  ruleConvBelowMedian,
  ruleBounceHigh,
  ruleTimeShort,
  ruleEngagementLow,
  ruleRegressionWeek,
];

// ===================================================================
// REGRAS DE OTIMIZAÇÃO
// ===================================================================

const ruleReplicateWinner: CRORule = {
  id: "replicate-winner",
  priority: "otimizacao",
  category: "conversion",
  trigger: (lp, ctx) => {
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 && lp.leadConvRate > median * 1.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const ratio = (lp.leadConvRate / median).toFixed(1);
    return {
      rule_id: "replicate-winner",
      proposal_key: makeKey(lp, "replicate-winner"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "otimizacao",
      category: "conversion",
      titulo: "LP top do host — replicar elementos vencedores",
      hipotese: `LP \`${lp.path}\` converte **${pct(lp.leadConvRate)}** (${ratio}x a mediana do host \`${lp.host}\`). Identificar e replicar elementos vencedores.`,
      acaoSugerida: `Documentar elementos diferenciados dessa LP: hero, CTA, copy do formulário, ordem de prova social. Propor sprint pra aplicar nas LPs abaixo da mediana.`,
      effort: "alto",
      impactoEstimado: impactoQualitativo("alto"),
      sinaisDetalhados: [
        `Conv. lead: ${pct(lp.leadConvRate)}`,
        `Mediana host: ${pct(median)}`,
        `Ratio: ${ratio}x acima`,
        `Sessões: ${fmt(lp.sessions)}`,
      ],
      benchmarks: [`Mediana host: ${pct(median)}`, `LP top: ${pct(lp.leadConvRate)}`],
    };
  },
};

const ruleChannelMismatch: CRORule = {
  id: "channel-mismatch",
  priority: "otimizacao",
  category: "channel",
  trigger: (lp, ctx) => {
    const lpSources = ctx.sourceBreakdown.filter((s) => s.url === lp.url);
    if (lpSources.length < 2) return false;
    const sorted = [...lpSources].sort((a, b) => b.sessions - a.sessions);
    const top = sorted[0];
    if (top.sessions < 200) return false;
    const otherSessions = sorted.slice(1).reduce((a, b) => a + b.sessions, 0);
    if (otherSessions === 0) return false;
    const topShareSessions = top.sessions / lp.sessions;
    // Dispara se top source domina (>50%) E LP underperforma host
    return topShareSessions > 0.5 && lp.leadConvRate < (ctx.hostMedians[lp.host] || 0) * 0.7;
  },
  generate: (lp, ctx): Proposal => {
    const lpSources = ctx.sourceBreakdown.filter((s) => s.url === lp.url);
    const top = [...lpSources].sort((a, b) => b.sessions - a.sessions)[0];
    return {
      rule_id: "channel-mismatch",
      proposal_key: makeKey(lp, "channel-mismatch"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "otimizacao",
      category: "channel",
      titulo: `LP pode não casar com tráfego ${top.source}/${top.medium}`,
      hipotese: `${pct(top.sessions / lp.sessions)} do tráfego dessa LP vem de \`${top.source}/${top.medium}\`, mas a conv geral está abaixo do esperado. A mensagem do anúncio dessa origem pode estar desalinhada.`,
      acaoSugerida: `Auditar criativos da origem \`${top.source}\` e comparar com hero da LP. Se desalinhado, fazer LP dedicada pra essa origem OU ajustar criativo pra refletir o conteúdo real.`,
      effort: "medio",
      impactoEstimado: impactoQualitativo("moderado"),
      sinaisDetalhados: [
        `Top origem: ${top.source}/${top.medium} (${pct(top.sessions / lp.sessions)} do tráfego)`,
        `Sessões top: ${fmt(top.sessions)} / ${fmt(lp.sessions)}`,
        `Conv. lead LP: ${pct(lp.leadConvRate)}`,
      ],
      benchmarks: [
        `Mediana host: ${pct(ctx.hostMedians[lp.host] || 0)}`,
      ],
    };
  },
};

export const OPTIMIZATION_RULES: CRORule[] = [
  ruleReplicateWinner,
  ruleChannelMismatch,
];

// ===================================================================
// EXPORT CONSOLIDADO + APLICADORES
// ===================================================================

export const ALL_RULES: CRORule[] = [
  ...CRITICAL_RULES,
  ...ATTENTION_RULES,
  ...OPTIMIZATION_RULES,
];

/**
 * Aplica todas as regras em uma LP. Cada regra pode disparar 1 proposta.
 * Retorna array vazio se nenhuma dispara.
 */
export function applyRules(lp: LPData, ctx: RuleContext): Proposal[] {
  return ALL_RULES.filter((r) => r.trigger(lp, ctx)).map((r) => r.generate(lp, ctx));
}

/**
 * Aplica regras em todas as LPs do array. Retorna todas propostas geradas,
 * ordenadas por priority (critico > atencao > otimizacao) e dentro de cada
 * grupo por sessões da LP desc (LPs maiores primeiro).
 */
export function applyRulesAll(lps: LPData[], ctx: RuleContext): Proposal[] {
  const all: Proposal[] = [];
  for (const lp of lps) {
    all.push(...applyRules(lp, ctx));
  }
  const priorityOrder: Record<string, number> = {
    critico: 0,
    atencao: 1,
    otimizacao: 2,
  };
  const sessionByUrl = new Map(lps.map((lp) => [lp.url, lp.sessions]));
  return all.sort((a, b) => {
    const dp = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (dp !== 0) return dp;
    return (sessionByUrl.get(b.lp.url) || 0) - (sessionByUrl.get(a.lp.url) || 0);
  });
}
