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
import { clarityLinksFor, clarityProtocol, type CroKind } from "./clarity";
import { montarBriefing, descricaoCurta, semTravessao } from "./cro-briefing";
import {
  avaliarGate,
  rotuloTrilha,
  escopoDaPagina,
  foraDoEscopoDeConversao,
  gateForaDeEscopo,
  scoreDeExecucao,
  type CroGate,
} from "./cro-gates";

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

  // Métricas ATUAIS da página (contexto do card) — preenchidas centralmente.
  metrics?: {
    users: number;
    sessions: number;
    engagedSessions: number;
    engagementRate: number; // %
    bounceRate: number; // %
    leads: number; // generate_lead + lead_create_account
    connectRate: number; // % leads / sessões (só relevante em LP de captação)
    isCapture: boolean; // LP de captação (mostra Connect Rate + Leads)
  };
  // Dimensionamento do experimento (calculado do tráfego real)
  sampleSizePerVariant?: number;
  estimatedTestDays?: number;

  // ===== A/B TEST 2.0 =====
  /** Tipo do problema — dirige o protocolo Clarity e o desenho das variantes. */
  kind?: CroKind;
  /** Passos de validação qualitativa no Clarity (2ª frente obrigatória). */
  clarityProtocol?: string[];
  /** Travas de medicao, poder e composicao. Decide a trilha da hipotese. */
  gate?: CroGate;
  /**
   * Uma linha em linguagem de execucao, para o corpo do card. Substitui a
   * hipotese, que era escrita para analista e nao para quem executa.
   */
  briefing?: string;
  /** Links diretos pro Clarity da property (heatmap/gravações). */
  clarityLinks?: { heatmaps: string | null; recordings: string | null; filterHint: string };
  /** Especificação VISUAL das variantes — a UI renderiza o wireframe A vs B. */
  variants?: {
    a: { label: string; note: string; blocks: VariantBlock[] };
    b: { label: string; note: string; blocks: VariantBlock[] };
    primaryMetric: string;
    guardrails: string[];
  };
};

/** Bloco de wireframe pra preview visual da variante. */
export type VariantBlock = {
  type: "headline" | "sub" | "cta" | "form" | "social" | "text" | "image" | "badge";
  label: string;
  /** true = elemento que MUDA na variante B (destacado no preview) */
  changed?: boolean;
  /** tamanho relativo do bloco no wireframe (1-3) */
  size?: 1 | 2 | 3;
};

// ============================================================
// DESENHO VISUAL DAS VARIANTES A/B por tipo de problema.
// Cada spec descreve o wireframe de A (controle) e B (teste), marcando o que
// MUDA. A UI renderiza isso como preview visual - o time vê o teste, não lê.
// ============================================================
function variantSpec(kind: CroKind, pagePath: string): NonNullable<CROInsight["variants"]> {
  const base = (): VariantBlock[] => [
    { type: "headline", label: "Headline atual", size: 2 },
    { type: "sub", label: "Subtítulo", size: 1 },
    { type: "image", label: "Imagem/vídeo do hero", size: 3 },
    { type: "text", label: "Bloco de conteúdo", size: 2 },
    { type: "cta", label: "CTA (posição atual)", size: 1 },
  ];

  switch (kind) {
    case "bounce":
      return {
        primaryMetric: "Taxa de rejeição",
        guardrails: ["Conversão", "Tempo médio"],
        a: { label: "A · Controle", note: "Hero atual, CTA abaixo do conteúdo", blocks: base() },
        b: {
          label: "B · Message match + CTA no 1º viewport",
          note: "Headline repete a promessa do canal de maior volume, CTA e prova social sobem pro primeiro viewport",
          blocks: [
            { type: "headline", label: "Headline = promessa do anúncio", changed: true, size: 2 },
            { type: "sub", label: "Subtítulo com benefício direto", changed: true, size: 1 },
            { type: "cta", label: "CTA acima do fold", changed: true, size: 1 },
            { type: "social", label: "Prova social (logos de imprensa)", changed: true, size: 1 },
            { type: "image", label: "Imagem/vídeo do hero", size: 3 },
            { type: "text", label: "Bloco de conteúdo", size: 2 },
          ],
        },
      };
    case "connect_rate":
      return {
        primaryMetric: "Connect Rate (lead / sessão)",
        guardrails: ["Qualidade do lead (MQL/lead)", "CPL"],
        a: {
          label: "A · Controle",
          note: "Formulário atual (muitos campos), sem prova social no topo",
          blocks: [
            { type: "headline", label: "Headline atual", size: 2 },
            { type: "image", label: "Imagem do hero", size: 2 },
            { type: "form", label: "Form atual (5+ campos)", size: 3 },
            { type: "cta", label: "Botão enviar", size: 1 },
          ],
        },
        b: {
          label: "B · Form enxuto + prova social",
          note: "Form no mínimo viável (nome, email, telefone) na primeira dobra + barra de credibilidade",
          blocks: [
            { type: "headline", label: "Headline com promessa clara", changed: true, size: 2 },
            { type: "social", label: "Barra de prova social (imprensa)", changed: true, size: 1 },
            { type: "form", label: "Form 3 campos", changed: true, size: 2 },
            { type: "cta", label: "Botão enviar (contraste alto)", changed: true, size: 1 },
            { type: "image", label: "Imagem do hero", size: 2 },
          ],
        },
      };
    case "retencao":
      return {
        primaryMetric: "Tempo médio na página",
        guardrails: ["Bounce", "Conversão"],
        a: { label: "A · Controle", note: "Primeira dobra atual", blocks: base() },
        b: {
          label: "B · Primeira dobra reescrita (JTBD)",
          note: "Responde em 1 frase o que o usuário veio buscar; prova social sobe; CTA visível sem scroll",
          blocks: [
            { type: "headline", label: "Resposta direta ao JTBD", changed: true, size: 2 },
            { type: "sub", label: "1 frase de contexto", changed: true, size: 1 },
            { type: "social", label: "Prova social above-the-fold", changed: true, size: 1 },
            { type: "cta", label: "CTA sem scroll", changed: true, size: 1 },
            { type: "text", label: "Conteúdo (mantido)", size: 3 },
          ],
        },
      };
    case "oportunidade":
      return {
        primaryMetric: "Leads captados na página",
        guardrails: ["Tempo médio (não cair >10%)", "Bounce"],
        a: { label: "A · Controle", note: "Conteúdo sem captura contextual", blocks: base() },
        b: {
          label: "B · CTA contextual (lazy reveal)",
          note: "Bloco de captura aparece após 30s / no ponto de maior dwell time, sem cortar a leitura",
          blocks: [
            { type: "headline", label: "Headline atual", size: 2 },
            { type: "text", label: "Conteúdo (1ª parte)", size: 2 },
            { type: "badge", label: "CTA contextual — lazy reveal", changed: true, size: 1 },
            { type: "form", label: "Captura inline (email)", changed: true, size: 1 },
            { type: "text", label: "Conteúdo (continuação)", size: 2 },
          ],
        },
      };
    case "conv_drop":
      return {
        primaryMetric: "Taxa de conversão da página",
        guardrails: ["Receita/sessão", "Bounce"],
        a: { label: "A · Estado atual (pós-queda)", note: "Versão que está no ar depois da mudança que derrubou a conversão", blocks: base() },
        b: {
          label: "B · Reverter o elemento suspeito",
          note: "Volta o elemento alterado na semana da queda (form, CTA, oferta) e compara com o estado atual",
          blocks: [
            { type: "headline", label: "Headline anterior à queda", changed: true, size: 2 },
            { type: "form", label: "Form/CTA no formato anterior", changed: true, size: 2 },
            { type: "image", label: "Hero (mantido)", size: 3 },
            { type: "cta", label: "CTA (posição anterior)", changed: true, size: 1 },
          ],
        },
      };
    case "funil":
    default:
      return {
        primaryMetric: "Taxa de avanço da etapa",
        guardrails: ["Aprovação de pagamento", "Receita por checkout"],
        a: { label: "A · Fluxo atual", note: `Etapa como está hoje em ${pagePath}`, blocks: base() },
        b: {
          label: "B · Etapa simplificada",
          note: "Menos campos obrigatórios, meio de pagamento primário em destaque, barra de progresso",
          blocks: [
            { type: "badge", label: "Barra de progresso", changed: true, size: 1 },
            { type: "form", label: "Campos reduzidos ao essencial", changed: true, size: 2 },
            { type: "cta", label: "Pagamento primário destacado", changed: true, size: 1 },
            { type: "social", label: "Selo de segurança", changed: true, size: 1 },
          ],
        },
      };
  }
}

// Deriva o tipo do problema a partir do id da regra que gerou o insight.
function kindFromId(id: string): CroKind {
  if (id.startsWith("lp-connect-rate") || id.startsWith("lp-conversion")) return "connect_rate";
  if (id.startsWith("bounce-critical") || id.startsWith("asset-bounce")) return "bounce";
  if (id.startsWith("short-session") || id.startsWith("content-deadend") || id.startsWith("home-low-engagement")) return "retencao";
  if (id.startsWith("engaged-no-action") || id.startsWith("scale-winner") || id.startsWith("conversion-winner")) {
    return "oportunidade";
  }
  return "funil";
}

// Tamanho de amostra por variante (teste de proporção, ~80% poder, 95% conf).
function sampleSizePerVariant(baselineRate: number, relMde = 0.15): number {
  const p = Math.min(0.95, Math.max(0.003, baselineRate));
  const mde = p * relMde;
  if (mde <= 0) return 0;
  return Math.ceil((15.7 * p * (1 - p)) / (mde * mde));
}

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

/**
 * Taxa de conversao da pagina, em fracao, pela metrica primaria do objetivo.
 * LP de venda converte em cta_click, captacao em generate_lead. Nunca soma as
 * duas. Quando as duas existem, vale a de maior volume.
 */
function taxaConversao(page: GA4PageDetail): number {
  if (page.sessions <= 0) return 0;
  const leads = page.leads || 0;
  const cta = page.ctaClicks || 0;
  return Math.max(leads, cta) / page.sessions;
}

// ============================================================
// Regras de detecção — cada uma vira 0+ insights
// ============================================================

type RuleCtx = {
  page: GA4PageDetail;
  totalViews: number;
  rank: number; // posição da página por views (0 = top)
  /**
   * Melhor e pior LP com volume, por taxa de conversao. A comparacao que
   * interessa para extrair padrao e melhor contra pior, nao contra mediana.
   * Primeira versao usava 3 vezes a mediana como limiar, e com mediana de 23%
   * isso exigia 69%, patamar que nenhuma pagina da casa atinge. Resultado: a
   * regra nunca disparava. Medido na Research em 30 dias: melhor LP converte
   * 53,5% e pior converte 2,9%, 18,6 vezes de diferenca.
   */
  lpBenchmark: {
    melhorPath: string;
    melhorTaxa: number;
    piorPath: string;
    piorTaxa: number;
  } | null;
  /** Escopo da pagina. Regra de conversao nao roda em pagina institucional. */
  escopo: ReturnType<typeof escopoDaPagina>;
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

  // ------------------------------------------------------------
  // R9: LP de CAPTAÇÃO com CONNECT RATE baixo (o KPI real da LP de lead)
  // Avalia a LP pelo que ela existe pra fazer: converter sessão em lead.
  // ------------------------------------------------------------
  ({ page }) => {
    const isCapture = classifyPage(page.path) === "lp" || (page.leads || 0) > 0;
    if (!isCapture) return null;
    if (page.sessions < 300) return null; // amostra mínima
    // LP de VENDA nao converte em lead, converte em cta_click. Chamar de
    // "connect rate baixo" uma pagina cuja metrica primaria e cta_click produz
    // titulo falso: a LP da 5a emissao aparecia como 0,92% quando converte
    // 9,4% no evento que importa.
    if ((page.ctaClicks || 0) > (page.leads || 0)) return null;
    const cr = page.connectRate || 0;
    // Benchmark Suno: LP de captação saudável conecta >= 3% (lead/sessão).
    if (cr >= 3) return null;
    const potentialLeads = Math.round(page.sessions * ((3 - cr) / 100)); // leads a recuperar até 3%
    return {
      id: `lp-connect-rate-${page.path}`,
      title: `Connect Rate baixo (${cr.toFixed(2)}%) em ${page.path}`,
      category: "Funil",
      priority: cr < 1.5 ? "Alta" : "Média",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `connect rate ${cr.toFixed(2)}% (${(page.leads || 0).toLocaleString("pt-BR")} leads / ${page.sessions.toLocaleString("pt-BR")} sessões) — benchmark LP de lead Suno: ≥3%`,
      metric: { name: "connectRate", value: cr, threshold: 3, unit: "%" },
      hypothesis: `LP de captação convertendo ${cr.toFixed(2)}% (abaixo dos 3% de referência). As alavancas de maior efeito em LP de lead, em ordem: (1) reduzir campos do formulário ao mínimo viável, (2) prova social above-the-fold, (3) match de mensagem com o canal de maior volume, (4) form na primeira dobra. Atacar 1+2 primeiro (maior efeito por esforço).`,
      diagnosis: "LIFT — Distraction (campos demais) + Anxiety (sem prova social) reduzindo a conversão. São as duas alavancas de maior elasticidade em LP de lead.",
      framework: "LIFT",
      frameworkNote: "Connect Rate é o KPI-fim da LP de captação. Avaliar por ele (não por bounce/tempo) é o corte sênior.",
      action: "Enxugar formulário + prova social above-the-fold + message match do canal",
      steps: [
        `Baseline: connect rate ${cr.toFixed(2)}% (${(page.leads || 0).toLocaleString("pt-BR")} leads / ${page.sessions.toLocaleString("pt-BR")} sessões)`,
        `Variante B: form reduzido ao mínimo (nome, email, telefone) + barra de prova social (logos de imprensa) na primeira dobra`,
        `Métrica primária: connect rate (lead/sessão) · guardrails: qualidade do lead (MQL/lead) e CPL`,
        `Segmentar por canal de origem: aplicar o message match do canal de maior volume`,
        `Meta: connect rate ≥ 3% (recuperaria ≈ ${potentialLeads.toLocaleString("pt-BR")} leads no período com o tráfego atual)`,
      ],
      testDesign: "A/B 50/50, lock por usuário",
      ice: ice(9, 8, 7),
      pxl: pxl({ aboveFold: true, addsValue: false, runsOnHighTraffic: page.sessions > 3000, isPainPoint: true, isQuickWin: true }),
      primaryKPI: `Connect Rate (lead/sessão) em ${page.path}`,
      secondaryKPIs: ["Leads absolutos", "Qualidade do lead (MQL/lead)", "Form starts vs completes", "CPL"],
      rollbackCriteria: "Reverter se a qualidade do lead (MQL/lead) cair, mesmo com connect rate subindo",
      estimatedImpact: `≈ ${potentialLeads.toLocaleString("pt-BR")} leads adicionais no período se atingir 3% de connect rate`,
    };
  },

  // ------------------------------------------------------------
  // R9: Página VENCEDORA POR CONVERSÃO — extrair o padrão e replicar
  //
  // A R8 já detecta vencedora, mas por rejeição e tempo de sessão, e só entre
  // as 3 primeiras por volume. Isso deixa de fora exatamente as páginas que
  // mais convertem da casa. Medido na Research em 30 dias: /pv/premium-webinar/
  // converte 55,83% de cta_click com 3.344 sessões, e nunca acionaria a R8.
  // Enquanto isso /asset/snel11/ converte 2,88%. São 19 vezes de diferença na
  // mesma property, no mesmo mês, e o padrão que explica isso vale mais que
  // qualquer variante desenhada no escuro.
  // ------------------------------------------------------------
  ({ page, lpBenchmark, escopo }) => {
    if (escopo !== "lp" || !lpBenchmark) return null;
    // Dispara somente na melhor LP da property, e so quando a distancia ate a
    // pior for grande o suficiente para existir padrao a extrair.
    if (page.path !== lpBenchmark.melhorPath) return null;
    if (lpBenchmark.piorTaxa <= 0) return null;
    const taxa = lpBenchmark.melhorTaxa;
    if (taxa < lpBenchmark.piorTaxa * 3) return null;
    const taxaPct = (taxa * 100).toFixed(1);
    const medianaPct = (lpBenchmark.piorTaxa * 100).toFixed(1);
    const vezes = (taxa / lpBenchmark.piorTaxa).toFixed(1);
    const receptora = lpBenchmark.piorPath;
    const limiar = lpBenchmark.piorTaxa * 3;
    return {
      id: `conversion-winner-${page.path}`,
      title: `${page.path} converte ${taxaPct}% — extrair o padrão e replicar`,
      category: "Mensagem",
      priority: "Alta",
      page: page.path,
      pageUrl: fullPageUrl(page),
      detectedFrom: `conversão de ${taxaPct}% contra ${medianaPct}% de ${receptora}, ${vezes} vezes acima, em ${page.sessions.toLocaleString("pt-BR")} sessões`,
      metric: { name: "taxaConversao", value: Number(taxaPct), threshold: Number((limiar * 100).toFixed(1)), unit: "%" },
      hypothesis: `Esta página resolve algo que as outras LPs não resolvem. Descobrir o que é rende mais que otimizar página ruim no escuro, porque o padrão vale para todas as LPs da casa e não só para uma.`,
      diagnosis: "Não é problema, é ativo. O motor existia só para achar defeito e por isso não te mostrava o que já funciona.",
      framework: "ICE",
      frameworkNote: "Replicar padrão comprovado tem confiança maior que hipótese nova, e esforço menor.",
      action: "Análise comparativa elemento a elemento contra a LP de menor conversão com volume, e transplante do padrão",
      steps: [
        `Inspecionar ${page.path} elemento a elemento: primeira dobra, quantidade de campos, prova social, presença de preço, tipo e rótulo de CTA`,
        `Comparar com ${receptora}, que converte ${medianaPct}% e é a LP de menor conversão com volume, registrando cada diferença`,
        `Confirmar composição de origem das duas antes de atribuir o efeito à página, e não ao tráfego`,
        `Transplantar as duas ou três diferenças de maior efeito para a página receptora`,
        `Medir na página receptora, não nesta. Esta é o controle`,
      ],
      testDesign: "Transplante de padrão, medido na página receptora",
      ice: ice(9, 8, 6),
      pxl: pxl({ aboveFold: true, addsValue: true, runsOnHighTraffic: page.sessions > 3000, isPainPoint: false, isQuickWin: false }),
      primaryKPI: `Conversão de ${receptora}, pela métrica primária dela`,
      secondaryKPIs: ["Conversão desta página, que não deve cair", "Qualidade do lead na receptora"],
      rollbackCriteria: "Reverter na receptora se a conversão cair, e nunca alterar esta página no processo",
      estimatedImpact: `Padrão aplicável às demais LPs da property. Referência: esta página converte ${vezes} vezes a mediana`,
    };
  },
];

// ============================================================
// Função pública — gera insights data-driven
// ============================================================

export function generateCROInsights(
  pages: GA4PageDetail[] | undefined | null,
  propertyName?: string | null
): CROInsight[] {
  if (!pages || pages.length === 0) return [];

  const totalViews = pages.reduce((s, p) => s + p.views, 0);
  if (totalViews === 0) return [];

  // Roda todas as regras em todas as páginas top-30 (não faz sentido analisar página com 10 views)
  const topPages = [...pages].sort((a, b) => b.views - a.views).slice(0, 30);
  const insights: CROInsight[] = [];

  // Janela do pagesDetail é 30d por padrão — usamos pra estimar dias de teste.
  const PERIOD_DAYS = 30;

  // Melhor e pior LP com volume, por taxa de conversao. Base comparativa da R9.
  const lpsComVolume = topPages
    .filter((p) => escopoDaPagina(p.host, p.path) === "lp" && p.sessions >= 1000)
    .map((p) => ({ path: p.path, taxa: taxaConversao(p) }))
    .filter((x) => x.taxa > 0)
    .sort((a, b) => b.taxa - a.taxa);
  const lpBenchmark =
    lpsComVolume.length >= 2
      ? {
          melhorPath: lpsComVolume[0].path,
          melhorTaxa: lpsComVolume[0].taxa,
          piorPath: lpsComVolume[lpsComVolume.length - 1].path,
          piorTaxa: lpsComVolume[lpsComVolume.length - 1].taxa,
        }
      : null;

  topPages.forEach((page, rank) => {
    const ctx: RuleCtx = {
      page,
      totalViews,
      rank,
      lpBenchmark,
      escopo: escopoDaPagina(page.host, page.path),
    };
    for (const rule of rules) {
      const insight = rule(ctx);
      if (!insight) continue;

      // Métricas atuais da página no card
      // LP de venda nao gera lead, ela gera cta_click. Sem incluir isso, a
      // pagina caia no ramo de "engajamento" e o motor media a coisa errada.
      const isCapture =
        classifyPage(page.path) === "lp" || (page.leads || 0) > 0 || (page.ctaClicks || 0) > 0;
      insight.metrics = {
        users: page.users,
        sessions: page.sessions,
        engagedSessions: page.engagedSessions || 0,
        engagementRate: page.engagementRate || 0,
        bounceRate: page.bounceRate,
        leads: page.leads || 0,
        connectRate: page.connectRate || 0,
        isCapture,
      };

      // Dimensionamento do experimento a partir do tráfego real
      const baseline = isCapture
        ? Math.max(0.005, (page.connectRate || 1) / 100)
        : Math.max(0.02, (page.engagementRate || 10) / 100);
      const nPer = sampleSizePerVariant(baseline);
      const dailySessions = Math.max(1, page.sessions / PERIOD_DAYS);
      const estDays = Math.max(7, Math.ceil((2 * nPer) / dailySessions));
      // ===== TRAVAS: medicao, poder e composicao =====
      // Calcula a trilha real da hipotese a partir do trafego observado, em vez
      // de assumir MDE de 15% para todo mundo. Ver src/lib/cro-gates.ts.
      // Metrica primaria por objetivo da pagina, nunca a soma das duas.
      // Captacao converte em generate_lead, LP de venda converte em cta_click.
      // Quando as duas existem, vale a de maior volume, que e a que descreve o
      // objetivo real da pagina. Medido na LP da 5a emissao SNEL11 em 30 dias:
      // 1.281 generate_lead contra 14.053 cta_click.
      const leadsJanela = page.leads || 0;
      const ctaJanela = page.ctaClicks || 0;
      const usaCta = ctaJanela > leadsJanela;
      const conversoesJanela = isCapture ? (usaCta ? ctaJanela : leadsJanela) : (page.engagedSessions || 0);
      const metricaPrimariaEvento = isCapture
        ? (usaCta ? "cta_click" : "generate_lead")
        : "sessao engajada";
      // ATENCAO: `baseline` acima tem piso (0,5% ou 2%) para nao estourar o
      // calculo de amostra do motor antigo. A trava precisa da taxa REAL, senao
      // pagina com 0,050% de conversao chega aqui como 0,5% e escapa do gate de
      // medicao. Caso real que expos isso: /asset/fundos/snel11/, 18 leads em
      // 35,8 mil sessoes.
      const baselineReal = page.sessions > 0 ? conversoesJanela / page.sessions : 0;
      // Pagina institucional nao e julgada com regua de LP. Ver escopoDaPagina.
      const escopo = escopoDaPagina(page.host, page.path);
      const foraDeEscopo = foraDoEscopoDeConversao(escopo);
      const gate = foraDeEscopo
        ? gateForaDeEscopo(page.host, page.path)
        : avaliarGate({
        sessoes: page.sessions,
        diasJanela: PERIOD_DAYS,
        baseline: baselineReal,
        conversoes: conversoesJanela,
        temObjetivoDeConversao: isCapture,
        metricaPrimaria: metricaPrimariaEvento,
      });
      if (foraDeEscopo) {
        // Nao pode disputar o topo do ranking com hipotese testavel. O sinal
        // continua visivel, mas como decisao de objetivo, nao como experimento.
        insight.priority = "Baixa";
        insight.ice = { ...insight.ice, total: Math.min(insight.ice.total, 40) };
      }
      insight.gate = gate;

      insight.sampleSizePerVariant = nPer;
      insight.estimatedTestDays = estDays;
      const mdeTxt = gate.mdeRelativo !== null ? `${Math.round(gate.mdeRelativo * 100)}% relativo` : "indefinido";
      insight.testDesign = gate.trilha === "A"
        ? `${insight.testDesign} · amostra ~${nPer.toLocaleString("pt-BR")} sessões/variante · MDE detectável ${mdeTxt} → ≈ ${gate.diasParaAlvo ?? estDays} dias com ${Math.round(dailySessions).toLocaleString("pt-BR")} sessões/dia`
        : `${rotuloTrilha(gate.trilha)} · NÃO desenhar como A/B 50/50 · ${gate.bloqueio ?? ""}`;

      // ===== A/B 2.0: tipo, variantes visuais e 2ª frente (Clarity) =====
      const kind = kindFromId(insight.id);
      insight.kind = kind;
      // Card de pagina vencedora nao e experimento nesta pagina. Ela e o
      // controle, e o teste roda na receptora. Anexar desenho de variante aqui
      // fazia o briefing mandar mexer justamente na pagina que funciona, com
      // instrucao de checkout que nada tinha a ver.
      const ehReplicacao = insight.id.startsWith("conversion-winner");
      insight.variants = ehReplicacao ? undefined : variantSpec(kind, page.path);
      insight.clarityProtocol = clarityProtocol(kind, page.path);
      const cl = clarityLinksFor(propertyName, page.path);
      insight.clarityLinks = { heatmaps: cl.heatmaps, recordings: cl.recordings, filterHint: cl.filterHint };

      // Passos do experimento = GA4 (quantitativo) + Clarity (qualitativo).
      // Regra: nenhuma sugestão vai pra execução sem a validação no Clarity.
      // ===== BRIEFING PARA O TIME =====
      // Este texto e o MESMO que vai virar a descricao da tarefa no Monday.
      // Ele responde, nesta ordem: o que atacar, por que, o que subir, como
      // medir e quando decide. Sem nome de framework e sem travessao.
      // Ver src/lib/cro-briefing.ts.
      insight.title = semTravessao(insight.title);
      insight.detectedFrom = semTravessao(insight.detectedFrom);
      insight.hypothesis = semTravessao(insight.hypothesis);
      insight.diagnosis = semTravessao(insight.diagnosis);
      insight.action = semTravessao(insight.action);
      insight.frameworkNote = semTravessao(insight.frameworkNote);
      insight.rollbackCriteria = semTravessao(insight.rollbackCriteria);
      insight.estimatedImpact = semTravessao(insight.estimatedImpact);
      insight.steps = montarBriefing(insight);
      insight.briefing = descricaoCurta(insight);

      insights.push(insight);
    }
  });

  // DEDUP POR PÁGINA — 1 card por página (o de maior ICE). Antes o dedup era
  // só por id, então bounce + tempo + LP-conversion na MESMA página viravam
  // 3 cards. Agora escolhemos o problema dominante de cada página.
  const byPage = new Map<string, CROInsight>();
  for (const i of insights) {
    const ex = byPage.get(i.page);
    if (!ex || i.ice.total > ex.ice.total) byPage.set(i.page, i);
  }
  const deduped = Array.from(byPage.values());

  // Ordena por velocidade de decisao, nao por gravidade do sintoma.
  // Ver scoreDeExecucao em src/lib/cro-gates.ts.
  return deduped
    .sort((a, b) => scoreDeExecucao(b.ice.total, b.gate) - scoreDeExecucao(a.ice.total, a.gate))
    .slice(0, 10);
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
