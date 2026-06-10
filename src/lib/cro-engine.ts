/**
 * Motor de insights CRO data-driven.
 *
 * Em vez de hardcoded recommendations, esse engine:
 *  1) Roda PATTERN DETECTION sobre dados reais do GA4 (pagesDetail)
 *  2) Mapeia cada padrão a hipóteses CRO específicas
 *  3) Calcula ICE Score (Impact × Confidence × Ease) — framework Sean Ellis
 *  4) Adiciona PXL criteria onde aplicável (ConversionXL)
 *  5) Diagnostica via LIFT Model (WiderFunnel) onde apropriado
 *  6) Retorna ranking dinâmico — muda conforme o comportamento da audiência muda
 *
 * Cada insight referencia A PÁGINA ESPECÍFICA que disparou a hipótese e o
 * valor exato da métrica que sustenta a recomendação. Não há texto genérico.
 *
 * Referências:
 *   - ICE Scoring: https://growth.design/case-studies/ice-score
 *   - PXL Framework: https://conversionxl.com/blog/pxl-prioritize-tests/
 *   - LIFT Model: https://www.widerfunnel.com/lift-model/
 *   - MECLABS Heuristic: C = 4m + 3v + 2(i-f) - 2a
 */

import type { GA4PageDetail } from "./ga4-context";

// ============================================================
// Tipos
// ============================================================

export type CROFramework = "ICE" | "PXL" | "LIFT" | "MECLABS";

export type CROInsight = {
  id: string;
  title: string;
  category: "Performance" | "UX/CTA" | "Funil" | "Mensagem" | "Conteúdo" | "Mobile" | "Retenção";
  priority: "Alta" | "Média" | "Baixa";

  // Página/dado real que disparou a hipótese
  page: string;
  pageUrl: string; // URL completa clicável (https://host/path) — abre a página real
  detectedFrom: string; // ex: "bounce 78% (limite 60%) com 45.2k pageviews"
  metric: { name: string; value: number; threshold: number; unit: string };

  // Hipótese e diagnóstico via framework
  hypothesis: string;
  diagnosis: string;        // diagnóstico via LIFT/MECLABS
  framework: CROFramework;  // framework primário usado
  frameworkNote: string;    // explicação curta de por que esse framework

  // Plano de ação
  action: string;
  steps: string[];
  testDesign: string;      // ex: "A/B 50/50, 14 dias, n mínimo 5k sessões/var"

  // ICE Score (todos 1-10)
  ice: {
    impact: number;       // ganho esperado se hipótese verdadeira
    confidence: number;   // confiança que a hipótese é correta
    ease: number;         // facilidade de execução (10 = trivial, 1 = projeto enorme)
    total: number;        // average × 10 (0-100 score)
  };

  // PXL flags (opcionais)
  pxl?: {
    aboveFold: boolean;
    addsValue: boolean;
    runsOnHighTraffic: boolean;
    isPainPoint: boolean;
    isQuickWin: boolean;
    score: number; // soma dos true
  };

  // KPIs a monitorar
  primaryKPI: string;
  secondaryKPIs: string[];
  rollbackCriteria: string;

  // Estimativa de impacto (calculada, não hardcoded)
  estimatedImpact: string;  // ex: "+R$ 12k/mês recuperados" ou "+~120 leads/mês"
};

// ============================================================
// Benchmarks Suno (calibrados pra mercado financeiro BR)
// ============================================================

const BENCHMARKS = {
  bounceRate: { excellent: 35, good: 45, warning: 60, critical: 75 },
  avgSessionSec: { excellent: 240, good: 120, poor: 60 },
  conversionRate: { lpExcellent: 5, lpGood: 3, lpPoor: 1.5, ecommGood: 2, ecommPoor: 0.8 },
  engagementPerUser: { good: 60, poor: 25 },
  exitRate: { warning: 70, critical: 85 },
};

// ============================================================
// Detecta tipo de página (pra ajustar benchmark/hipótese)
// ============================================================

/**
 * URL completa clicável da página. O GA4 (pages-detail) devolve `url` como
 * `${host}${path}` SEM protocolo — usado como href direto, o browser trata
 * como caminho relativo e quebra (e o link no Monday sai inválido).
 * Este é o único ponto que monta pageUrl, então normaliza https:// pra todos.
 */
function fullPageUrl(page: { url?: string; host?: string; path: string }): string {
  const raw = page.url || `${page.host || ""}${page.path}`;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function classifyPage(path: string): "lp" | "home" | "asset" | "checkout" | "logged" | "content" | "other" {
  const p = path.toLowerCase();
  if (p.startsWith("/lp/") || p.includes("/landing") || p.includes("/oferta") || p.includes("/aplicacao")) return "lp";
  if (p === "/" || p === "/home") return "home";
  if (p.startsWith("/asset/") || p.startsWith("/fundos/") || p.startsWith("/acao/")) return "asset";
  if (p.includes("/checkout") || p.includes("/carrinho")) return "checkout";
  if (p.startsWith("/onboarding") || p.startsWith("/conta") || p.startsWith("/perfil")) return "logged";
  if (p.startsWith("/blog/") || p.startsWith("/relatorios/") || p.startsWith("/conteudo/")) return "content";
  return "other";
}

// ============================================================
// Estimativa monetária baseada em volume + delta esperado
// (não é hardcoded — escala com o tráfego real da página)
// ============================================================

function estimateImpact(views: number, conversionLift: number, ticketAvg = 150): string {
  // converte views → estimativa de leads ou compras adicionais
  const newConversions = Math.round((views * conversionLift) / 100);
  if (newConversions < 10) return `~${newConversions} conversões adicionais no período`;
  if (ticketAvg > 0 && views > 5000) {
    const revenue = Math.round(newConversions * ticketAvg);
    return `~R$ ${(revenue / 1000).toFixed(1)}k de receita estimada (ticket R$${ticketAvg})`;
  }
  return `+${newConversions} conversões adicionais estimadas no período`;
}

// ============================================================
// Calcula ICE Score
// ============================================================

function ice(impact: number, confidence: number, ease: number): CROInsight["ice"] {
  const total = Math.round(((impact + confidence + ease) / 3) * 10);
  return { impact, confidence, ease, total };
}

// ============================================================
// Calcula PXL flags
// ============================================================

function pxl(flags: {
  aboveFold?: boolean;
  addsValue?: boolean;
  runsOnHighTraffic?: boolean;
  isPainPoint?: boolean;
  isQuickWin?: boolean;
}): NonNullable<CROInsight["pxl"]> {
  const f = {
    aboveFold: !!flags.aboveFold,
    addsValue: !!flags.addsValue,
    runsOnHighTraffic: !!flags.runsOnHighTraffic,
    isPainPoint: !!flags.isPainPoint,
    isQuickWin: !!flags.isQuickWin,
  };
  const score = Object.values(f).filter(Boolean).length;
  return { ...f, score };
}

// ============================================================
// Regras de detecção — cada uma vira 0+ insights
// ============================================================

type RuleCtx = {
  page: GA4PageDetail;
  totalViews: number;
  rank: number; // posição da página por views (0 = top)
};

const rules: ((ctx: RuleCtx) => CROInsight | null)[] = [
  // ------------------------------------------------------------
  // R1: Bounce CRÍTICO em página de tráfego alto
  // ------------------------------------------------------------
  ({ page, totalViews, rank }) => {
    if (page.bounceRate < BENCHMARKS.bounceRate.critical) return null;
    if (page.views < totalViews * 0.05) return null; // só top 20% de tráfego
    const lift = 2.5; // conservador — 2.5pp de melhoria em conversion após match
    return {
      id: `bounce-critical-${page.path}`,
      title: `Bounce crítico (${page.bounceRate.toFixed(0)}%) em ${page.path}`,
      category: "Mensagem",
      priority: "Alta",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `bounce ${page.bounceRate.toFixed(1)}% (crítico >75%) com ${page.views.toLocaleString("pt-BR")} pageviews`,
      metric: { name: "bounceRate", value: page.bounceRate, threshold: BENCHMARKS.bounceRate.critical, unit: "%" },
      hypothesis: `Bounce ${page.bounceRate.toFixed(0)}% indica desalinhamento entre origem de tráfego e mensagem da página. Ajustar headline pra prometer exatamente o que o anúncio/canal vendeu deve trazer bounce pra <60%.`,
      diagnosis: "LIFT Model — Relevance + Clarity comprometidas (visitante não reconhece o que prometeu o canal).",
      framework: "LIFT",
      frameworkNote: "LIFT diagnostica friction em 6 eixos. Bounce alto isolado aponta Relevance/Clarity como principais.",
      action: "Auditar message match entre anúncios/canais e copy above-the-fold",
      steps: [
        `Listar top 5 origens de tráfego dessa página no GA4 (sessionSource/Medium)`,
        `Comparar headline da página vs copy do anúncio/post de cada origem`,
        `Reescrever H1 pra repetir EXATAMENTE a promessa do canal de maior volume`,
        `A/B 50/50 entre headline atual e nova, 14 dias`,
        `Validar: bounce cai ≥10pp e session ↑ ≥30s`,
      ],
      testDesign: "A/B 50/50 com lock por usuário, 14 dias, n mínimo 5.000 sessões/variante",
      ice: ice(8, 7, 6),
      pxl: pxl({ aboveFold: true, addsValue: false, runsOnHighTraffic: true, isPainPoint: true, isQuickWin: false }),
      primaryKPI: `Bounce rate em ${page.path}`,
      secondaryKPIs: ["Tempo médio na página", "Sessões engajadas", "Conversão downstream"],
      rollbackCriteria: "Reverter se bounce não cair ≥5pp em 7 dias ou se sessões diminuírem >10%",
      estimatedImpact: estimateImpact(page.views, lift),
    };
  },

  // ------------------------------------------------------------
  // R2: Sessão LONGA mas conversão BAIXA — engajado sem ação
  // ------------------------------------------------------------
  ({ page, totalViews }) => {
    if (page.avgSessionDuration < BENCHMARKS.avgSessionSec.good) return null;
    if (page.engagementPerUser < BENCHMARKS.engagementPerUser.good) return null;
    if (page.views < totalViews * 0.03) return null;
    // proxy de conversão baixa: bounce não-alto mas exit alto OU baixíssima entrada como entry-page
    const looksLikeLowConv = page.exitRate > 60 || (page.entries > 0 && page.entries / page.users < 0.3);
    if (!looksLikeLowConv) return null;
    return {
      id: `engaged-no-action-${page.path}`,
      title: `Visitante engaja mas não converte em ${page.path}`,
      category: "UX/CTA",
      priority: "Alta",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `sessão média ${Math.floor(page.avgSessionDuration / 60)}m${page.avgSessionDuration % 60}s + engajamento/user ${page.engagementPerUser.toFixed(0)}s mas exit ${page.exitRate.toFixed(0)}%`,
      metric: { name: "avgSessionDuration", value: page.avgSessionDuration, threshold: BENCHMARKS.avgSessionSec.good, unit: "s" },
      hypothesis: `Usuário lê o conteúdo (sessão alta) mas não vê CTA forte ou não percebe o próximo passo claro. Reposicionar CTA + adicionar sticky bottom bar deve elevar CTR sem prejudicar engajamento.`,
      diagnosis: "MECLABS — Motivação alta (sessão longa) + valor percebido alto, mas incentivo/clareza do CTA baixos. Equação C = 4m + 3v + 2(i-f) - 2a com (i-f) negativo.",
      framework: "MECLABS",
      frameworkNote: "Heurística MECLABS aponta: quando motivação e valor existem, mexer em incentivo/fricção dá maior retorno.",
      action: "Sticky CTA bottom + reposição da CTA principal acima do fold",
      steps: [
        `Rodar scrollmap em ${page.path} por 7 dias (Hotjar/Clarity)`,
        `Validar profundidade de scroll vs posição do CTA atual`,
        `Implementar sticky CTA bottom no mobile`,
        `Mover CTA principal pra primeiro viewport no desktop`,
        `A/B variant B (com sticky) vs A (atual) por 14 dias`,
      ],
      testDesign: "A/B 50/50, 14 dias, lock por usuário. Sticky aparece após 30% de scroll.",
      ice: ice(7, 8, 7),
      pxl: pxl({ aboveFold: true, addsValue: true, runsOnHighTraffic: true, isPainPoint: true, isQuickWin: true }),
      primaryKPI: `CTR no CTA principal de ${page.path}`,
      secondaryKPIs: ["Conversão final", "Tempo até primeiro clique no CTA", "Profundidade de scroll"],
      rollbackCriteria: "Reverter se sessão média cair >20% ou se taxa de saída piorar",
      estimatedImpact: estimateImpact(page.views, 1.8, page.path.includes("/asset/") ? 200 : 150),
    };
  },

  // ------------------------------------------------------------
  // R3: Sessão CURTA + bounce normal — conteúdo não responde a intenção
  // ------------------------------------------------------------
  ({ page, totalViews }) => {
    if (page.avgSessionDuration > BENCHMARKS.avgSessionSec.poor) return null;
    if (page.bounceRate > BENCHMARKS.bounceRate.warning) return null; // bounce alto cai noutra regra
    if (page.views < totalViews * 0.04) return null;
    return {
      id: `short-session-${page.path}`,
      title: `Sessão curta (<60s) em ${page.path}`,
      category: "Conteúdo",
      priority: "Média",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `sessão média ${page.avgSessionDuration}s com bounce ok (${page.bounceRate.toFixed(0)}%) — usuário chega mas não fica`,
      metric: { name: "avgSessionDuration", value: page.avgSessionDuration, threshold: BENCHMARKS.avgSessionSec.poor, unit: "s" },
      hypothesis: `Conteúdo não está respondendo à intenção do visitante na primeira tela. Falta resposta direta à pergunta que ele veio buscar — value prop pode estar enterrada.`,
      diagnosis: "LIFT — Value Proposition pouco visível. Visitante reconhece o assunto mas não vê a resposta direta.",
      framework: "LIFT",
      frameworkNote: "Quando bounce é ok mas sessão é curta, a hipótese-padrão é Value Proposition fraca.",
      action: "Reescrever primeira tela com Job-to-be-Done explícito",
      steps: [
        `5-second test (UsabilityHub) em ${page.path}`,
        `Identificar qual JTBD do visitante (via heatmap de cliques + scroll)`,
        `Reescrever H1+sub pra responder o JTBD em 1 frase`,
        `Mover prova social pra above-the-fold`,
        `A/B 14 dias`,
      ],
      testDesign: "A/B 50/50, 14 dias",
      ice: ice(6, 6, 7),
      pxl: pxl({ aboveFold: true, addsValue: true, runsOnHighTraffic: true, isPainPoint: false, isQuickWin: true }),
      primaryKPI: "Tempo médio na página",
      secondaryKPIs: ["Sessões engajadas %", "Scroll médio", "Bounce"],
      rollbackCriteria: "Reverter se conversão cair >5% na variante B",
      estimatedImpact: estimateImpact(page.views, 1.2),
    };
  },

  // ------------------------------------------------------------
  // R4: Page de PRODUTO/ASSET com bounce moderado-alto
  // ------------------------------------------------------------
  ({ page, totalViews }) => {
    if (classifyPage(page.path) !== "asset") return null;
    if (page.bounceRate < BENCHMARKS.bounceRate.warning) return null;
    if (page.views < totalViews * 0.02) return null;
    return {
      id: `asset-bounce-${page.path}`,
      title: `Página de ativo ${page.path} com bounce ${page.bounceRate.toFixed(0)}%`,
      category: "UX/CTA",
      priority: "Alta",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `página de ativo com bounce ${page.bounceRate.toFixed(0)}% (>60%) e ${page.views.toLocaleString("pt-BR")} pageviews`,
      metric: { name: "bounceRate", value: page.bounceRate, threshold: BENCHMARKS.bounceRate.warning, unit: "%" },
      hypothesis: `Página de ativo com bounce alto sinaliza que oferta/preço não estão claros above-the-fold. Visitante busca dado rápido (yield, rentabilidade, ticker) e desiste se não acha em 5s.`,
      diagnosis: "MECLABS — fricção alta (informação dispersa) + ansiedade alta (decisão financeira). Reduzir (i-f) e ansiedade tem peso 2× cada.",
      framework: "MECLABS",
      frameworkNote: "Decisões financeiras têm ansiedade intrínseca — clareza compensa.",
      action: "Sumário executivo above-the-fold com 3 KPIs do ativo",
      steps: [
        `Definir 3 KPIs mais procurados (ex.: Dividend Yield, Patrimônio, Cota atual)`,
        `Implementar card sticky no topo com esses 3 KPIs`,
        `Adicionar selo de risco/categoria pra reduzir ansiedade`,
        `Reposicionar CTA de "Invista agora" / "Saiba mais" pra primeiro viewport`,
        `A/B 14 dias com lock por usuário`,
      ],
      testDesign: "A/B 50/50, 14 dias, n mínimo 3.000 sessões/variante",
      ice: ice(7, 7, 6),
      pxl: pxl({ aboveFold: true, addsValue: true, runsOnHighTraffic: true, isPainPoint: true, isQuickWin: false }),
      primaryKPI: "Bounce em páginas de ativo",
      secondaryKPIs: ["Cliques em CTA primário", "Sessões com scroll >50%", "Pageviews/sessão"],
      rollbackCriteria: "Reverter se tempo médio cair >20% (sumário muito enxuto)",
      estimatedImpact: estimateImpact(page.views, 2.0, 200),
    };
  },

  // ------------------------------------------------------------
  // R5: Página de LP com bounce alto — conversão de lead em risco
  // ------------------------------------------------------------
  ({ page, totalViews }) => {
    if (classifyPage(page.path) !== "lp") return null;
    if (page.bounceRate < BENCHMARKS.bounceRate.warning) return null;
    if (page.views < 500) return null; // amostra mínima
    void totalViews;
    return {
      id: `lp-conversion-${page.path}`,
      title: `LP ${page.path} convertendo abaixo do esperado`,
      category: "Funil",
      priority: "Alta",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `bounce ${page.bounceRate.toFixed(0)}% em LP de captação (benchmark Suno: <55% pra LP de lead)`,
      metric: { name: "bounceRate", value: page.bounceRate, threshold: 55, unit: "%" },
      hypothesis: `LP de captação Suno deveria ficar com bounce <55% (gerar generate_lead). Acima disso, geralmente formulário longo demais ou prova social ausente. Reduzir campos do form + adicionar 2 logos de impressa parceiras eleva conversão.`,
      diagnosis: "LIFT — Distraction alta (campos demais) + Anxiety alta (sem prova social). Reduzir ambos.",
      framework: "LIFT",
      frameworkNote: "LPs de lead respondem MUITO a redução de campos e adição de social proof.",
      action: "Reduzir form a 3 campos (nome, email, telefone) + adicionar selo de imprensa",
      steps: [
        `Auditar campos atuais do form — quais são realmente usados depois?`,
        `Eliminar todos os campos não-críticos`,
        `Adicionar barra com "Mencionados em [Valor Econômico, InfoMoney...]"`,
        `Mover form pra above-the-fold no desktop`,
        `A/B 14 dias`,
      ],
      testDesign: "A/B 50/50, 14 dias",
      ice: ice(8, 8, 8),
      pxl: pxl({ aboveFold: true, addsValue: false, runsOnHighTraffic: page.views > 5000, isPainPoint: true, isQuickWin: true }),
      primaryKPI: `Taxa de generate_lead em ${page.path}`,
      secondaryKPIs: ["Form starts", "Form abandono por campo", "Sessões engajadas"],
      rollbackCriteria: "Reverter se qualidade do lead piorar (CPL > qualidade)",
      estimatedImpact: estimateImpact(page.views, 3.0),
    };
  },

  // ------------------------------------------------------------
  // R6: Exit rate alto em página de conteúdo — falta path
  // ------------------------------------------------------------
  ({ page, totalViews }) => {
    if (classifyPage(page.path) !== "content") return null;
    if (page.exitRate < BENCHMARKS.exitRate.warning) return null;
    if (page.views < totalViews * 0.02) return null;
    return {
      id: `content-deadend-${page.path}`,
      title: `Página de conteúdo ${page.path} é beco sem saída`,
      category: "Retenção",
      priority: "Média",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `exit rate ${page.exitRate.toFixed(0)}% (>70%) em conteúdo — visitante sai sem continuar jornada`,
      metric: { name: "exitRate", value: page.exitRate, threshold: BENCHMARKS.exitRate.warning, unit: "%" },
      hypothesis: `Conteúdo entrega valor mas não tem ponte pro próximo passo. Adicionar "Conteúdos relacionados" + 1 CTA contextual reduz exit ≥10pp.`,
      diagnosis: "LIFT — Urgency e Continuity ausentes. Visitante consumiu, mas não viu motivo pra continuar.",
      framework: "LIFT",
      frameworkNote: "Conteúdos como blog/relatório respondem bem a related content + soft CTA contextual.",
      action: "Bloco de 3 conteúdos relacionados + 1 CTA contextual no final",
      steps: [
        `Mapear conteúdos relacionados via tag/cluster`,
        `Adicionar bloco "Próximas leituras" no fim do artigo`,
        `Inserir 1 CTA contextual (ex.: "Quer carteira recomendada? Vire assinante")`,
        `Trackear cliques no related + CTA`,
        `Iterar 14 dias`,
      ],
      testDesign: "A/B 50/50, 14 dias",
      ice: ice(5, 7, 8),
      pxl: pxl({ aboveFold: false, addsValue: true, runsOnHighTraffic: true, isPainPoint: false, isQuickWin: true }),
      primaryKPI: "Exit rate em conteúdo",
      secondaryKPIs: ["Pageviews/sessão", "CTR em related", "CTR em soft CTA"],
      rollbackCriteria: "Reverter se velocidade de leitura cair (sessão muito mais longa pode indicar confusão)",
      estimatedImpact: estimateImpact(page.views, 0.8),
    };
  },

  // ------------------------------------------------------------
  // R7: Página HOME com baixo engajamento — UX broken
  // ------------------------------------------------------------
  ({ page }) => {
    if (classifyPage(page.path) !== "home") return null;
    if (page.engagementPerUser > BENCHMARKS.engagementPerUser.poor) return null;
    if (page.views < 2000) return null;
    return {
      id: `home-low-engagement-${page.path}`,
      title: `Home com engajamento/usuário baixo (${page.engagementPerUser.toFixed(0)}s)`,
      category: "UX/CTA",
      priority: "Alta",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `engajamento/user ${page.engagementPerUser.toFixed(0)}s (<25s) — visitantes não exploram a home`,
      metric: { name: "engagementPerUser", value: page.engagementPerUser, threshold: BENCHMARKS.engagementPerUser.poor, unit: "s" },
      hypothesis: `Home com <25s de engajamento por usuário sinaliza navegação confusa ou IA visual quebrada. Visitante não acha o que procura e desiste.`,
      diagnosis: "LIFT — Clarity e Relevance comprometidas no nível do hero.",
      framework: "LIFT",
      frameworkNote: "Home é a porta — Clarity é o fator #1 dela.",
      action: "Tree test + redesenho da seção hero priorizando 3 entradas principais",
      steps: [
        `Tree test (Optimal Workshop) pra entender mental model do visitante`,
        `Redesenhar hero com 3 CTAs claros baseados em JTBD`,
        `Remover blocos secundários da fold 1`,
        `A/B 14 dias`,
      ],
      testDesign: "A/B 50/50, 14 dias",
      ice: ice(8, 7, 5),
      pxl: pxl({ aboveFold: true, addsValue: true, runsOnHighTraffic: true, isPainPoint: true, isQuickWin: false }),
      primaryKPI: "Engajamento por usuário na home",
      secondaryKPIs: ["CTR em CTAs primários", "Bounce", "Páginas/sessão"],
      rollbackCriteria: "Reverter se entrada em fluxos principais cair >10%",
      estimatedImpact: estimateImpact(page.views, 1.5),
    };
  },

  // ------------------------------------------------------------
  // R8: Página PERFORMANDO BEM — proposta de escalar (raro mas importante)
  // ------------------------------------------------------------
  ({ page, totalViews, rank }) => {
    if (rank > 2) return null; // só top 3
    if (page.bounceRate > BENCHMARKS.bounceRate.good) return null;
    if (page.avgSessionDuration < BENCHMARKS.avgSessionSec.good) return null;
    if (page.views < totalViews * 0.08) return null;
    return {
      id: `scale-winner-${page.path}`,
      title: `${page.path} performando acima da média — escalar tráfego`,
      category: "Mensagem",
      priority: "Média",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `bounce ${page.bounceRate.toFixed(0)}% (saudável) + sessão ${Math.floor(page.avgSessionDuration / 60)}min — página é "winner"`,
      metric: { name: "bounceRate", value: page.bounceRate, threshold: BENCHMARKS.bounceRate.good, unit: "%" },
      hypothesis: `Página já converte/engaja acima da média. Aumentar investimento de mídia direcionando pra ela tem ROI mais previsível que otimizar página problemática.`,
      diagnosis: "ICE prioriza expansão de winners — mais barato que recuperar losers.",
      framework: "ICE",
      frameworkNote: "Princípio do '2nd best decision' — escalar o que funciona costuma ter ROI mais previsível.",
      action: "Aumentar budget de mídia em campanhas que terminam nessa URL em +30%",
      steps: [
        `Identificar campanhas que driveiam pra ${page.path} (sessionCampaignName)`,
        `Validar que ROAS marginal ainda é positivo (não saturado)`,
        `Aumentar budget +30% gradualmente`,
        `Replicar criativos vencedores em PMax/Meta similar`,
        `Monitorar 7 dias`,
      ],
      testDesign: "Escala incremental (10% → 20% → 30%) ao longo de 3 semanas",
      ice: ice(7, 8, 9),
      pxl: pxl({ aboveFold: false, addsValue: true, runsOnHighTraffic: true, isPainPoint: false, isQuickWin: true }),
      primaryKPI: "ROAS das campanhas que apontam pra essa página",
      secondaryKPIs: ["CPA", "Volume de conversões", "Bounce na escala"],
      rollbackCriteria: "Reverter se ROAS marginal cair >20% ou bounce subir >5pp",
      estimatedImpact: estimateImpact(page.views, 1.0, 200),
    };
  },
];

// ============================================================
// Função pública — gera insights data-driven
// ============================================================

export function generateCROInsights(pages: GA4PageDetail[] | undefined | null): CROInsight[] {
  if (!pages || pages.length === 0) return [];

  const totalViews = pages.reduce((s, p) => s + p.views, 0);
  if (totalViews === 0) return [];

  // Roda todas as regras em todas as páginas top-30 (não faz sentido analisar página com 10 views)
  const topPages = [...pages].sort((a, b) => b.views - a.views).slice(0, 30);
  const insights: CROInsight[] = [];

  topPages.forEach((page, rank) => {
    const ctx: RuleCtx = { page, totalViews, rank };
    for (const rule of rules) {
      const insight = rule(ctx);
      if (insight) insights.push(insight);
    }
  });

  // Dedup por id + ranking por ICE Total (decrescente)
  const seen = new Set<string>();
  const deduped = insights.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  return deduped.sort((a, b) => b.ice.total - a.ice.total).slice(0, 10);
}

// ============================================================
// Resumo agregado — pra mostrar no header da seção de insights
// ============================================================

export function summarizeInsights(insights: CROInsight[]) {
  const byPriority = {
    Alta: insights.filter((i) => i.priority === "Alta").length,
    Média: insights.filter((i) => i.priority === "Média").length,
    Baixa: insights.filter((i) => i.priority === "Baixa").length,
  };
  const byCategory = insights.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + 1;
    return acc;
  }, {});
  const topInsight = insights[0] || null;
  const frameworksUsed = Array.from(new Set(insights.map((i) => i.framework)));
  return { byPriority, byCategory, topInsight, frameworksUsed, total: insights.length };
}
