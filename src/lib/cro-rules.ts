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
import {
  avaliarGate,
  escopoDaPagina,
  foraDoEscopoDeConversao,
  type CroGate,
} from "./cro-gates";

// ------------ Helpers ------------

/** Gera proposal_key estável baseado em LP url + rule id */
function makeKey(lp: LPData, ruleId: string): string {
  const hash = createHash("sha256")
    .update(lp.url)
    .digest("hex")
    .slice(0, 8);
  return `${hash}:${ruleId}`;
}

/** Formata percentual com 1 casa decimal, no padrao brasileiro. */
function pct(v: number): string {
  return (v * 100).toFixed(1).replace(".", ",") + "%";
}

/** Formata número com separador BR */
function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}


/**
 * Metrica primaria da LP.
 *
 * LP de venda converte em cta_click, LP de captacao converte em generate_lead.
 * Nunca a soma das duas. Quando as duas existem, vale a de maior volume, que e
 * a que descreve o objetivo real da pagina.
 *
 * Sem isso o motor julgava toda LP por generate_lead e produzia card falso.
 * Caso real em 13/08/2026: /consultoria/pv-suno-invest-2026/ apareceu como
 * "conversao 0,1%, metade da mediana do host", quando a pagina converte 29% em
 * cta_click, que e o evento dela. Certo na aritmetica e errado no denominador,
 * o que e pior que errado, porque parece confiavel.
 */
export function metricaPrimariaLp(lp: LPData): {
  evento: "cta_click" | "generate_lead";
  taxa: number;
  count: number;
} {
  return lp.ctaCount > lp.leadCount
    ? { evento: "cta_click", taxa: lp.ctaConvRate, count: lp.ctaCount }
    : { evento: "generate_lead", taxa: lp.leadConvRate, count: lp.leadCount };
}

/** Pagina institucional nao entra em regra de conversao. */
function temObjetivoDeConversao(lp: LPData): boolean {
  return !foraDoEscopoDeConversao(escopoDaPagina(lp.host, lp.path));
}

/** Trilha e poder estatistico da LP, calculados do trafego real. */
function gateDaLp(lp: LPData, ctx: RuleContext): CroGate {
  const m = metricaPrimariaLp(lp);
  return avaliarGate({
    sessoes: lp.sessions,
    diasJanela: ctx.rangeDays || 30,
    baseline: m.taxa,
    conversoes: m.count,
    temObjetivoDeConversao: true,
    metricaPrimaria: m.evento,
  });
}

/** Bloco de decisao pronto para o card, em linguagem de execucao. */
function comoDecide(gate: CroGate): string {
  if (!gate.medicaoOk) {
    return "NAO E TESTE AINDA. " + gate.bloqueio + " Resolver isso antes de desenhar variante.";
  }
  if (gate.trilha === "A") {
    return (
      "COMO DECIDE: teste A/B 50/50, metrica que decide " + gate.metricaPrimaria + ". Amostra de " +
      gate.nPorVariante.toLocaleString("pt-BR") + " sessoes por versao, leitura em " +
      gate.diasParaAlvo + " dias. Nao olhar antes disso."
    );
  }
  if (gate.trilha === "B") {
    return (
      "COMO DECIDE: nao monte A/B, o trafego nao sustenta. " + gate.bloqueio +
      " Rode antes e depois, com uma LP parecida como comparacao no mesmo periodo. Metrica que decide: " +
      gate.metricaPrimaria + "."
    );
  }
  return (
    "COMO DECIDE: aqui nao decide receita. " + gate.bloqueio +
    " Use gravacao de tela e conversa com usuario para levantar hipotese."
  );
}

/** QA que vale para qualquer variante que suba. */
const QA_PADRAO =
  "ANTES DE SUBIR: abre no celular e no desktop sem quebrar, o botao de acao aparece sem rolar a " +
  "tela, o formulario chega no CRM, o evento dispara uma vez por sessao, e o carregamento nao piora.";

/** Verificacao que evita atacar a pagina quando o problema e a midia. */
const CONFERIR_ORIGEM =
  "CONFERIR ANTES: cruzar a conversao desta pagina por origem e por campanha. Se a diferenca entre " +
  "origens for maior que o ganho esperado do teste, o problema e mix de midia e nao a pagina.";

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
    titulo: "LP sem nenhum evento de conversao",
    hipotese:
      "O QUE ACONTECE: " + lp.path + " recebeu " + fmt(lp.sessions) + " sessoes no periodo e nao " +
      "disparou nenhum generate_lead nem cta_click. POR QUE IMPORTA: isso e ausencia de medicao, nao " +
      "conversao zero. Sao diagnosticos opostos, e sem evento nao existe metrica para decidir teste nenhum.",
    acaoSugerida:
      "NAO E TESTE. O QUE FAZER: abrir a LP em janela anonima, preencher o formulario ou clicar no CTA, " +
      "e olhar o GA4 em tempo real. Se o evento nao aparece, o problema esta no GTM ou no formulario. " +
      "Se aparece com outro nome, corrigir para o padrao da casa: generate_lead em captacao, cta_click " +
      "em venda. NAO FAZER: mexer em layout, texto ou botao antes disso. Sem metrica nao da para saber " +
      "se melhorou.",
    effort: "baixo",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      fmt(lp.sessions) + " sessoes no periodo",
      "0 eventos generate_lead",
      "0 eventos cta_click",
      "Rejeicao: " + pct(lp.bounceRate),
    ],
    benchmarks: ["Esperado: pelo menos 1% das sessoes disparam generate_lead ou cta_click"],
  }),
};

const ruleConvVsHostMedian: CRORule = {
  id: "conv-vs-host-median",
  priority: "critico",
  category: "conversion",
  trigger: (lp, ctx) => {
    if (!temObjetivoDeConversao(lp)) return false;
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 && metricaPrimariaLp(lp).taxa < median * 0.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const topLP = ctx.hostTopLP[lp.host];
    const m = metricaPrimariaLp(lp);
    const mTop = topLP ? metricaPrimariaLp(topLP) : null;
    const gate = gateDaLp(lp, ctx);
    return {
      rule_id: "conv-vs-host-median",
      proposal_key: makeKey(lp, "conv-vs-host-median"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "critico",
      category: "conversion",
      titulo: "Conversao menos da metade da mediana do host",
      hipotese:
        "O QUE VAMOS ATACAR: o caminho de conversao de " + lp.path + ". POR QUE: ela converte " +
        pct(m.taxa) + " em " + m.evento + ", menos da metade da mediana de " + pct(median) +
        " das LPs de " + lp.host +
        (topLP && mTop
          ? ", e a melhor LP do host, " + topLP.path + ", faz " + pct(mTop.taxa) + " em " + mTop.evento + "."
          : ".") +
        " Com diferenca desse tamanho, o que falta costuma ser estrutura de oferta, nao ajuste fino.",
      acaoSugerida:
        (topLP
          ? "O QUE FAZER, PASSO 1: abrir " + lp.path + " e " + topLP.path + " lado a lado e anotar cada " +
            "diferenca. Primeira dobra, quantidade de campos, prova social, se mostra preco, texto e " +
            "posicao do botao. "
          : "O QUE FAZER, PASSO 1: listar o que falta na primeira dobra: chamada de acao visivel, prova " +
            "social e clareza da oferta. ") +
        "PASSO 2: escolher as duas ou tres diferencas de maior efeito e subir so elas, uma versao por vez. " +
        comoDecide(gate) + " " + CONFERIR_ORIGEM + " " + QA_PADRAO,
      effort: "medio",
      impactoEstimado: impactoFechaGapMediana(lp, median, ctx.rangeDays),
      sinaisDetalhados: [
        "Conversao desta LP: " + pct(m.taxa) + " em " + m.evento + ", " + fmt(m.count) + " no periodo",
        "Mediana das LPs do host: " + pct(median),
        topLP && mTop ? "Melhor LP do host: " + pct(mTop.taxa) + " em " + topLP.path : "",
        "Sessoes: " + fmt(lp.sessions),
        "Trilha " + gate.trilha + ": " + gate.resumo,
      ].filter(Boolean),
      benchmarks: [
        "Mediana do host " + lp.host + ": " + pct(median),
        topLP && mTop ? "Melhor LP do host: " + topLP.path + " com " + pct(mTop.taxa) : "",
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
    if (!temObjetivoDeConversao(lp)) return false;
    const median = ctx.hostMedians[lp.host] || 0;
    const taxa = metricaPrimariaLp(lp).taxa;
    return median > 0 && lp.sessions >= 100 && taxa < median * 0.75 && taxa >= median * 0.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const m = metricaPrimariaLp(lp);
    const gate = gateDaLp(lp, ctx);
    return {
      rule_id: "conv-below-median",
      proposal_key: makeKey(lp, "conv-below-median"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "atencao",
      category: "conversion",
      titulo: "Conversao abaixo da mediana do host",
      hipotese:
        "O QUE VAMOS ATACAR: a conversao de " + lp.path + ". POR QUE: ela converte " + pct(m.taxa) +
        " em " + m.evento + " contra mediana de " + pct(median) + " das LPs de " + lp.host +
        ", uma distancia de " + pct(median - m.taxa) + ". A pagina funciona, so entrega menos que as " +
        "irmas dela.",
      acaoSugerida:
        "O QUE VAMOS SUBIR: uma mudanca por vez, comecando pelo texto do botao de acao e pela " +
        "quantidade de campos do formulario, que sao as duas alavancas de maior efeito em LP. Nao " +
        "trocar tudo junto, senao nao da para saber o que fez efeito. " +
        comoDecide(gate) + " " + CONFERIR_ORIGEM + " " + QA_PADRAO,
      effort: "baixo",
      impactoEstimado: impactoFechaGapMediana(lp, median, ctx.rangeDays),
      sinaisDetalhados: [
        "Conversao desta LP: " + pct(m.taxa) + " em " + m.evento + ", " + fmt(m.count) + " no periodo",
        "Mediana das LPs do host: " + pct(median),
        "Distancia ate a mediana: " + pct(median - m.taxa),
        "Sessoes: " + fmt(lp.sessions),
        "Trilha " + gate.trilha + ": " + gate.resumo,
      ],
      benchmarks: ["Mediana do host " + lp.host + ": " + pct(median)],
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
    if (!temObjetivoDeConversao(lp)) return false;
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 && metricaPrimariaLp(lp).taxa > median * 1.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const m = metricaPrimariaLp(lp);
    const ratio = (m.taxa / median).toFixed(1);
    return {
      rule_id: "replicate-winner",
      proposal_key: makeKey(lp, "replicate-winner"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "otimizacao",
      category: "conversion",
      titulo: "LP que mais converte do host, replicar o padrao",
      hipotese:
        "O QUE VAMOS ATACAR: nao e esta pagina. " + lp.path + " e a referencia do host " + lp.host +
        " e nao deve ser alterada. POR QUE: ela converte " + pct(m.taxa) + " em " + m.evento + ", " +
        ratio + " vezes a mediana das LPs do host. Copiar o que ja funciona rende mais que consertar " +
        "pagina ruim no escuro, e o padrao serve para as outras LPs tambem.",
      acaoSugerida:
        "O QUE FAZER, PASSO 1: documentar o que esta pagina tem de diferente. Primeira dobra, texto e " +
        "posicao do botao, quantidade de campos, ordem da prova social, se mostra preco. " +
        "PASSO 2: conferir de onde vem o trafego dela. Se a origem for muito melhor que a das outras, " +
        "parte do resultado e da midia e a copia rende menos do que parece. " +
        "PASSO 3: aplicar as duas ou tres diferencas de maior efeito na LP de menor conversao do host, " +
        "e medir na receptora, nao aqui. Esta pagina e o controle e nao muda.",
      effort: "alto",
      impactoEstimado: impactoQualitativo("alto"),
      sinaisDetalhados: [
        "Conversao desta LP: " + pct(m.taxa) + " em " + m.evento + ", " + fmt(m.count) + " no periodo",
        "Mediana das LPs do host: " + pct(median),
        "Esta LP converte " + ratio + " vezes a mediana",
        "Sessoes: " + fmt(lp.sessions),
      ],
      benchmarks: ["Mediana do host: " + pct(median), "Esta LP: " + pct(m.taxa) + " em " + m.evento],
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
