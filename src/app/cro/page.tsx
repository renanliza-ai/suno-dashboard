"use client";

import { Header } from "@/components/header";
import { MasterGuard } from "@/components/master-guard";
import { Dialog } from "@/components/dialog";
import { motion } from "framer-motion";
import {
  TrendingUp, AlertTriangle, Lightbulb, Zap, Target, Clock, MousePointerClick,
  ArrowUpRight, Crown, ChevronRight, FileText, Play, CheckCircle2, Activity,
  ThumbsUp, ThumbsDown, ShieldCheck, AlertCircle, BarChart3, Beaker, Undo2, X,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4PagesDetail } from "@/lib/ga4-context";
import { DataStatus } from "@/components/data-status";

// Hash determinístico do propertyId — garante que ao trocar a propriedade,
// os números (mock e derivações) mudem de forma estável (mesma propriedade
// sempre dá os mesmos números, propriedades diferentes dão números diferentes).
function hashSeed(s: string | null | undefined): number {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Diagnóstico automático baseado nos números reais da página. */
function diagnoseFromMetrics(p: { bounceRate: number; avgSessionDuration: number; engagementPerUser: number }): string[] {
  const out: string[] = [];
  if (p.bounceRate > 60) out.push(`Rejeição alta (${p.bounceRate.toFixed(1)}%) — revisar match com fonte de tráfego`);
  else if (p.bounceRate < 30) out.push(`Rejeição saudável (${p.bounceRate.toFixed(1)}%) — público bem qualificado`);
  else out.push(`Rejeição dentro do esperado (${p.bounceRate.toFixed(1)}%)`);
  if (p.avgSessionDuration < 60) out.push("Sessão curta (<1min) — conteúdo pode não estar respondendo a intenção");
  else if (p.avgSessionDuration > 240) out.push(`Sessão longa (${(p.avgSessionDuration / 60).toFixed(1)}min) — boa retenção`);
  if (p.engagementPerUser > 60) out.push("Engajamento por usuário acima da média da conta");
  return out;
}

type PageScore = {
  page: string;
  score: number;
  lcp: number;
  cls: number;
  fid?: number;
  inp?: number;
  conversion: number;
  trend: "up" | "down";
  pageviews: number;
  bounce: number;
  diagnosis: string[];
};

const pageScores: PageScore[] = [
  { page: "/home", score: 82, lcp: 2.1, cls: 0.08, inp: 180, conversion: 3.4, trend: "up", pageviews: 187450, bounce: 42.5, diagnosis: ["LCP saudável", "CLS ótimo", "Considerar preload do hero"] },
  { page: "/carteiras", score: 74, lcp: 2.8, cls: 0.12, inp: 240, conversion: 2.1, trend: "up", pageviews: 198420, bounce: 35.8, diagnosis: ["LCP acima de 2.5s", "CTA abaixo do fold em 70% dos desktops", "JS third-party bloqueando render"] },
  { page: "/asset/fundos/snel11", score: 91, lcp: 1.8, cls: 0.05, inp: 140, conversion: 4.2, trend: "up", pageviews: 142850, bounce: 32.1, diagnosis: ["Core Web Vitals excelentes", "Conversão acima da média"] },
  { page: "/relatorios", score: 68, lcp: 3.4, cls: 0.18, inp: 320, conversion: 1.2, trend: "down", pageviews: 124820, bounce: 28.4, diagnosis: ["LCP crítico (3.4s)", "CLS acima do ideal", "Imagens hero sem dimensões fixas", "Fontes carregadas sync"] },
  { page: "/carteiras/dividendos", score: 79, lcp: 2.4, cls: 0.09, inp: 190, conversion: 2.8, trend: "up", pageviews: 156320, bounce: 32.4, diagnosis: ["LCP no limite", "INP saudável"] },
];

type Insight = {
  icon: typeof AlertTriangle;
  color: string;
  priority: "Alta" | "Média" | "Baixa";
  title: string;
  desc: string;
  action: string;
  impact: string;
  steps: string[];
  effort: "baixo" | "médio" | "alto";
  owner: string;
  // Campos para suportar avaliação informada antes de aceitar/recusar
  confidence: "Alta" | "Média" | "Baixa"; // quão confiável é a estimativa de impacto
  evidence: string; // "por que" — dado que sustenta a recomendação
  hypothesis: string; // hipótese a validar
  costEstimate: string; // custo (R$ ou horas)
  risk: "baixo" | "médio" | "alto";
  riskNotes: string; // o que pode dar errado
  primaryKPI: string; // KPI principal a monitorar
  secondaryKPIs: string[]; // KPIs secundários
  testWindow: string; // ex.: "14 dias com 50/50"
  rollback: string; // critério para reverter
  affectedSegments: string[]; // públicos/páginas impactados
};

type Decision = "pending" | "accepted" | "rejected";
type DecisionRecord = {
  status: Decision;
  rejectReason?: string;
  decidedAt?: number;
};
type DecisionMap = Record<string, DecisionRecord>;
const DECISION_STORAGE_KEY = "suno:cro:decisions:v1";

const REJECT_REASONS = [
  "Falta de capacity do time",
  "Já testamos algo parecido",
  "Impacto estimado parece exagerado",
  "Não é prioridade neste trimestre",
];

const insights: Insight[] = [
  {
    icon: AlertTriangle, color: "text-red-500 bg-red-50", priority: "Alta",
    title: "LCP crítico em /relatorios",
    desc: "Tempo de carregamento de 3.4s está acima do ideal (<2.5s). Isso explica a queda de 12% em conversões nessa página nos últimos 14 dias.",
    action: "Otimizar imagens hero e carregar fontes async",
    impact: "+18% conversão estimado",
    effort: "médio", owner: "Dev frontend",
    steps: [
      "Auditar imagens acima do fold com PageSpeed Insights",
      "Converter hero para AVIF/WebP com fallback",
      "Adicionar width/height explícitos para evitar CLS",
      "Mover @font-face para preload + font-display: swap",
      "Validar LCP <2.5s em 75th percentile via CrUX",
    ],
    confidence: "Alta",
    evidence: "Correlação direta entre LCP >3s e queda de conversão observada nos últimos 14 dias (r=0.72). PageSpeed CrUX confirma p75 LCP em 3.4s na origem.",
    hypothesis: "Reduzir LCP para <2.5s aumenta a conversão em ≥12%, recuperando o patamar pré-degradação.",
    costEstimate: "≈ 24h dev (3 dias) + 4h QA. R$ 0 de mídia.",
    risk: "baixo",
    riskNotes: "Pode introduzir regressão visual em browsers antigos sem suporte AVIF — mitigado pelo fallback WebP/JPG.",
    primaryKPI: "Taxa de conversão em /relatorios",
    secondaryKPIs: ["LCP p75", "Bounce rate", "Tempo até primeira interação"],
    testWindow: "Deploy direto + monitorar por 7 dias no GA4 Real-Time",
    rollback: "Reverter PR se LCP não cair ≥800ms em 48h ou se bounce subir >5pp",
    affectedSegments: ["Todos os visitantes de /relatorios (mobile + desktop)"],
  },
  {
    icon: Lightbulb, color: "text-amber-500 bg-amber-50", priority: "Média",
    title: "CTA abaixo do fold em /carteiras",
    desc: "70% dos usuários desktop não rolam até o botão principal de CTA. Reposicionamento pode gerar ganho expressivo.",
    action: "Mover CTA 'Ver Carteiras' para área visível inicial",
    impact: "+24% cliques estimado",
    effort: "baixo", owner: "Design + Dev",
    steps: [
      "Rodar heatmap/scrollmap por 7 dias (Hotjar ou Clarity)",
      "Subir CTA para o primeiro viewport no desktop",
      "Criar variante A/B no Optimize/Convert",
      "Rodar teste por 2 semanas com 50/50 de tráfego",
      "Decidir com base em CTR e taxa de conversão final",
    ],
    confidence: "Média",
    evidence: "Scrollmap (Clarity) mostra que 70% dos desktops param antes do botão. Benchmark interno: páginas com CTA above-the-fold convertem 1.6x mais.",
    hypothesis: "CTA acima do fold aumenta CTR em ≥15% sem prejudicar a leitura do conteúdo.",
    costEstimate: "≈ 8h design + 6h dev. R$ 0 de mídia.",
    risk: "médio",
    riskNotes: "Pode reduzir tempo de leitura do hero copy. Validar com bounce rate antes de promover.",
    primaryKPI: "CTR no botão 'Ver Carteiras'",
    secondaryKPIs: ["Conversão final em /carteiras", "Tempo médio na página", "Bounce rate"],
    testWindow: "A/B 50/50 por 14 dias (n mínimo: 8.000 sessões/variante)",
    rollback: "Manter versão B só se CTR ≥+10% e conversão ≥+5% com p<0.05",
    affectedSegments: ["Desktop (resoluções ≥1280px)", "Tablet portrait"],
  },
  {
    icon: Zap, color: "text-violet-500 bg-violet-50", priority: "Alta",
    title: "Campanha 'Premium 30' com ROAS 4.2x",
    desc: "Essa campanha está com a melhor performance mas budget limitado. Ampliar investimento pode gerar retorno rápido.",
    action: "Aumentar budget diário de R$ 2k → R$ 5k",
    impact: "+R$ 45k receita mensal",
    effort: "baixo", owner: "Mídia paga",
    steps: [
      "Validar que ROAS se mantém com mais volume (checar marginal ROAS)",
      "Escalar +50% na primeira semana",
      "Monitorar CPA e taxa de conversão no GA4",
      "Se ROAS continuar >3.5x, escalar para R$ 5k",
    ],
    confidence: "Média",
    evidence: "Últimos 21 dias: ROAS estável em 4.2x ± 0.3. Search query report mostra termos com volume residual não explorado.",
    hypothesis: "Aumentar 150% o budget mantém ROAS ≥3.5x graças a queries ainda não saturadas.",
    costEstimate: "+R$ 90k/mês em mídia (R$ 3k/dia adicional). Sem custo de tooling.",
    risk: "médio",
    riskNotes: "ROAS marginal pode cair em segundo bidding. Escalar gradual (50% por semana) reduz exposição.",
    primaryKPI: "ROAS rolling de 7 dias",
    secondaryKPIs: ["CPA", "Volume de conversões", "Taxa de aprovação do checkout"],
    testWindow: "Escala em 3 etapas (+50% → +100% → +150%) ao longo de 3 semanas",
    rollback: "Reverter ao budget anterior se ROAS cair abaixo de 3.0x por 3 dias seguidos",
    affectedSegments: ["Tráfego pago Google Ads (Search + PMax)"],
  },
  {
    icon: MousePointerClick, color: "text-emerald-500 bg-emerald-50", priority: "Média",
    title: "Abandono no checkout (23%)",
    desc: "1.750 usuários iniciaram checkout mas não finalizaram. Dados apontam friction no step de pagamento.",
    action: "Adicionar PIX como opção primária + reduzir campos do form",
    impact: "+420 compras/mês estimado",
    effort: "médio", owner: "Produto + Dev",
    steps: [
      "Revisar analytics de form fields (onde o usuário desiste)",
      "Implementar PIX como default nos métodos de pagamento",
      "Remover campos não essenciais (CPF opcional se já logado)",
      "Adicionar progress bar visual no checkout",
      "Rodar A/B test por 14 dias",
    ],
    confidence: "Alta",
    evidence: "Funil GA4: 23% de drop entre add_payment_info e purchase. Hotjar form analytics mostra abandono concentrado no campo CPF + telefone.",
    hypothesis: "PIX como padrão + CPF opcional reduz drop de 23% para ≤15%, gerando +420 compras/mês.",
    costEstimate: "≈ 40h dev + 8h QA + integração adquirente PIX (já existente). R$ 0 incremental.",
    risk: "médio",
    riskNotes: "Risco fiscal se CPF for removido sem alternativa para nota fiscal — manter opcional, não eliminar.",
    primaryKPI: "Taxa de finalização do checkout (purchase / begin_checkout)",
    secondaryKPIs: ["Tempo médio no checkout", "Taxa de erro no form", "Distribuição PIX vs cartão"],
    testWindow: "A/B 50/50 por 14 dias com lock de variante por usuário",
    rollback: "Reverter se taxa de aprovação cair ≥3pp ou se receita por checkout cair >5%",
    affectedSegments: ["Todos os usuários no fluxo de checkout (web + mobile)"],
  },
  {
    icon: Target, color: "text-blue-500 bg-blue-50", priority: "Baixa",
    title: "Remarketing subutilizado",
    desc: "183k usuários logados, mas apenas 2% recebem campanhas de retenção. Oportunidade enorme de LTV.",
    action: "Criar audiência custom no GA4 e ativar no Ads",
    impact: "+12% retenção estimado",
    effort: "médio", owner: "CRM + Mídia",
    steps: [
      "Criar audiência GA4 'Logados últimos 30d, sem compra'",
      "Ativar linkagem GA4 ↔ Google Ads",
      "Criar campanha de remarketing com orçamento de R$ 800/dia",
      "Segmentar criativos por persona (investidor iniciante vs avançado)",
    ],
    confidence: "Baixa",
    evidence: "Comparativo com cohort de 2025: usuários impactados por remarketing tiveram retenção 12pp maior. Dado é histórico — não há A/B atual.",
    hypothesis: "Remarketing pago em audiência logada-sem-compra eleva conversão da base inativa em ≥10%.",
    costEstimate: "≈ R$ 24k/mês em mídia + 16h setup (CRM + Ads). Tooling já contratado.",
    risk: "alto",
    riskNotes: "Risco de canibalização — usuários que comprariam de qualquer forma podem ser atribuídos à campanha. Validar com holdout de 10%.",
    primaryKPI: "Conversão incremental da audiência impactada (vs holdout)",
    secondaryKPIs: ["CAC", "LTV 90d", "Taxa de unsubscribe"],
    testWindow: "30 dias com holdout de 10% (sem campanha) para isolar incremental",
    rollback: "Pausar campanha se ROAS <1.8x ou se taxa de unsubscribe subir >2x",
    affectedSegments: ["Logados últimos 30d sem compra (~180k usuários)"],
  },
];

type DailySuggestion = {
  title: string;
  category: "Performance" | "UX/CTA" | "Mídia" | "Funil" | "Retenção";
  impact: string;
  roi: string; // ex.: "1:14"
  effort: "baixo" | "médio" | "alto";
  timeline: string; // ex.: "Resultado em 14 dias"
  rationale: string;
  hypothesis: string;
  evidence: string;
  steps: string[];
  successMetric: string;
  alternatives: string[]; // outras formas de atacar o mesmo problema
  risks: string[];
};

const baseDailySuggestions: DailySuggestion[] = [
  {
    title: "Teste A/B no CTA de /carteiras",
    category: "UX/CTA",
    impact: "+24% cliques estimado",
    roi: "1:14",
    effort: "baixo",
    timeline: "Resultado em 14 dias",
    rationale: "70% dos desktops não chegam ao CTA principal. Mover para o primeiro viewport pode ser a mudança de maior impacto com menor esforço esta semana.",
    hypothesis: "CTA acima do fold aumenta CTR em ≥15% sem prejudicar a leitura do conteúdo.",
    evidence: "Scrollmap (Microsoft Clarity) mostra que 70% dos visitantes desktop param antes do botão. Páginas Suno com CTA above-the-fold convertem 1.6x mais.",
    steps: [
      "Clonar a página atual como variante B",
      "Reposicionar o bloco CTA para viewport inicial",
      "Rodar 50/50 por 14 dias",
      "Validar significância estatística (p<0.05)",
    ],
    successMetric: "CTR no botão 'Ver Carteiras' (mínimo +10% para promover)",
    alternatives: [
      "Sticky CTA fixo no scroll (em vez de mover)",
      "Adicionar CTA secundário no meio do conteúdo",
      "Substituir hero estático por vídeo com CTA embutido",
    ],
    risks: [
      "Pode reduzir tempo de leitura do hero copy",
      "Se a variante B converter pior em mobile, manter só desktop",
    ],
  },
  {
    title: "Otimizar LCP em /relatorios",
    category: "Performance",
    impact: "+18% conversão estimado",
    roi: "1:9",
    effort: "médio",
    timeline: "Deploy + 7 dias de validação",
    rationale: "LCP de 3.4s na página com maior tráfego está derrubando conversão em 12% nos últimos 14 dias. É a oportunidade de menor esforço/maior receita esta semana.",
    hypothesis: "Reduzir LCP para <2.5s recupera o patamar de conversão pré-degradação.",
    evidence: "CrUX p75 mostra LCP em 3.4s. Correlação direta com queda de conversão (r=0.72) nos últimos 14 dias.",
    steps: [
      "Audit com PageSpeed Insights nas 3 LPs principais",
      "Converter hero para AVIF/WebP com fallback",
      "Adicionar preload em fontes críticas",
      "Validar LCP <2.5s no CrUX após deploy",
    ],
    successMetric: "LCP p75 abaixo de 2.5s e conversão recuperando ≥10pp",
    alternatives: [
      "Lazy-load do hero (mais agressivo, risco maior)",
      "Mover renderização para edge (Vercel/Cloudflare)",
      "Pré-renderização estática das LPs principais",
    ],
    risks: [
      "Regressão visual em browsers antigos sem AVIF",
      "Se a queda for por outro motivo (oferta, sazonalidade), o ganho não acontece",
    ],
  },
  {
    title: "Reduzir abandono no checkout com PIX padrão",
    category: "Funil",
    impact: "+420 compras/mês estimado",
    roi: "1:22",
    effort: "médio",
    timeline: "A/B 14 dias + lock por usuário",
    rationale: "23% de drop entre add_payment_info e purchase é o gargalo de maior receita do funil. PIX como default + CPF opcional ataca a fricção real do usuário.",
    hypothesis: "PIX padrão + remover CPF obrigatório quando logado eleva taxa de finalização de 77% para ≥85%.",
    evidence: "Funil GA4: 23% de drop nesse passo. Hotjar form analytics mostra abandono concentrado em CPF + telefone.",
    steps: [
      "Audit do form_field abandonment (Hotjar / GA4 form events)",
      "Implementar PIX como método padrão",
      "Tornar CPF opcional para usuários logados",
      "Adicionar progress bar visual no checkout",
      "A/B 50/50 por 14 dias com lock por usuário",
    ],
    successMetric: "Taxa de finalização (purchase / begin_checkout) ≥85%",
    alternatives: [
      "One-click checkout (Apple Pay / Google Pay)",
      "Salvar cartão para retorno (tokenização)",
      "Lembrete por e-mail/WhatsApp em 30min de carrinho abandonado",
    ],
    risks: [
      "Risco fiscal se CPF for removido por completo — manter como opcional, não eliminar",
      "Adquirente pode rejeitar primeiro PIX em volume — validar com a operadora",
    ],
  },
  {
    title: "Escalar campanha 'Premium 30' com ROAS 4.2x",
    category: "Mídia",
    impact: "+R$ 45k receita mensal",
    roi: "1:4.2",
    effort: "baixo",
    timeline: "Escala em 3 semanas (50% por semana)",
    rationale: "ROAS estável em 4.2x ± 0.3 nos últimos 21 dias. Search query report mostra termos com volume residual não explorado — escalar agora pega a janela.",
    hypothesis: "Aumentar 150% o budget mantém ROAS ≥3.5x graças a queries ainda não saturadas.",
    evidence: "Histórico de 21 dias com ROAS estável. Termos como 'dividendos para iniciantes' ainda não foram completamente explorados.",
    steps: [
      "Validar que ROAS marginal se mantém com mais volume",
      "Escalar +50% na semana 1",
      "Monitorar CPA e taxa de aprovação",
      "Continuar escalando se ROAS >3.5x",
    ],
    successMetric: "ROAS rolling de 7 dias ≥3.5x ao longo de toda a escala",
    alternatives: [
      "Replicar criativos vencedores em PMax",
      "Ativar similares no Meta Ads com a mesma audiência",
      "Testar Performance Max com feed de produtos da carteira",
    ],
    risks: [
      "ROAS pode cair em segundo bidding — escalar gradual reduz exposição",
      "Concorrente pode reagir com lance maior, encarecendo o leilão",
    ],
  },
  {
    title: "Criar audiência de remarketing para logados sem compra",
    category: "Retenção",
    impact: "+12% retenção estimado",
    roi: "1:1.8",
    effort: "médio",
    timeline: "Setup em 5 dias + 30 dias de teste com holdout",
    rationale: "183k usuários logados, mas só 2% recebem campanhas de retenção. Cohort de 2025 mostra retenção 12pp maior em quem foi impactado por remarketing.",
    hypothesis: "Remarketing pago em audiência logada-sem-compra eleva conversão da base inativa em ≥10%.",
    evidence: "Histórico interno cohort 2025. Não há A/B atual — por isso o teste com holdout é crítico para isolar incremental.",
    steps: [
      "Criar audiência GA4 'Logados últimos 30d, sem compra'",
      "Linkar GA4 ↔ Google Ads",
      "Subir campanha com holdout de 10% (sem campanha)",
      "Segmentar criativos por persona (iniciante vs avançado)",
      "Avaliar por 30 dias e comparar com holdout",
    ],
    successMetric: "Conversão incremental ≥10% vs grupo holdout",
    alternatives: [
      "E-mail/CRM (mais barato, menor alcance)",
      "Push notification no app",
      "WhatsApp Business com oferta segmentada",
    ],
    risks: [
      "Risco de canibalização — usuários que comprariam de qualquer forma podem ser atribuídos à campanha",
      "Saturação criativa se rodar mais de 30 dias com mesmo anúncio",
    ],
  },
];

const categoryStyle: Record<DailySuggestion["category"], string> = {
  Performance: "bg-red-50 text-red-700 border-red-200",
  "UX/CTA": "bg-amber-50 text-amber-700 border-amber-200",
  Mídia: "bg-violet-50 text-violet-700 border-violet-200",
  Funil: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Retenção: "bg-blue-50 text-blue-700 border-blue-200",
};

function priorityBadge(p: string) {
  return p === "Alta"
    ? "bg-red-100 text-red-700"
    : p === "Média"
    ? "bg-amber-100 text-amber-700"
    : "bg-blue-100 text-blue-700";
}

function confidenceBadge(c: string) {
  return c === "Alta"
    ? "bg-emerald-100 text-emerald-700"
    : c === "Média"
    ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";
}

function riskBadge(r: string) {
  return r === "baixo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : r === "médio"
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
}

// Chave estável por insight (sobrevive a re-render e reload). Usa título — único por seed.
function insightKey(it: Insight): string {
  return it.title;
}

/**
 * Score ICE — framework clássico de priorização de CRO (CXL Institute / GrowthHackers).
 * ICE = Impact × Confidence × Ease, cada um 1-10, score final 1-1000.
 *
 * Como mapeamos os campos do Insight:
 *   - Impact: derivado da prioridade (Alta=9, Média=6, Baixa=3)
 *   - Confidence: Alta=9, Média=6, Baixa=3
 *   - Ease: inverso do esforço (baixo=9, médio=6, alto=3)
 *
 * Resultado:
 *   - >= 500: prioridade absoluta (verde)
 *   - 200..500: vale rodar (âmbar)
 *   - < 200: backlog longo (cinza)
 */
function calculateICE(it: Insight): { score: number; impact: number; confidence: number; ease: number; tier: "alto" | "medio" | "baixo" } {
  const impact = it.priority === "Alta" ? 9 : it.priority === "Média" ? 6 : 3;
  const confidence = it.confidence === "Alta" ? 9 : it.confidence === "Média" ? 6 : 3;
  const ease = it.effort === "baixo" ? 9 : it.effort === "médio" ? 6 : 3;
  const score = impact * confidence * ease;
  const tier = score >= 500 ? "alto" : score >= 200 ? "medio" : "baixo";
  return { score, impact, confidence, ease, tier };
}

function iceBadgeStyle(tier: "alto" | "medio" | "baixo") {
  return tier === "alto"
    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
    : tier === "medio"
    ? "bg-amber-100 text-amber-800 border-amber-300"
    : "bg-slate-100 text-slate-600 border-slate-300";
}

// =============================================================
// Pattern Library — padrões CRO testados em escala (GoodUI + Baymard)
// =============================================================
type CROPattern = {
  id: string;
  title: string;
  category: "Form" | "CTA" | "Trust" | "Pricing" | "Onboarding" | "Mobile";
  avgLift: string;            // ex.: "+8.2%"
  liftRange: string;          // ex.: "+3% a +18%"
  description: string;
  whenToUse: string;
  example: string;
  source: "GoodUI" | "Baymard" | "CXL" | "Suno (interno)";
  evidenceLevel: "Alta" | "Média" | "Baixa";
};

const croPatterns: CROPattern[] = [
  {
    id: "single-column-form",
    title: "Form em coluna única",
    category: "Form",
    avgLift: "+15.4%",
    liftRange: "+8% a +24%",
    description: "Forms multi-coluna fazem o olho saltar lateralmente e aumentam erros. Coluna única acelera o preenchimento e reduz abandono.",
    whenToUse: "Qualquer cadastro/checkout com 4+ campos",
    example: "Checkout do Booking, signup do Stripe",
    source: "Baymard",
    evidenceLevel: "Alta",
  },
  {
    id: "cta-above-fold",
    title: "CTA principal acima do fold",
    category: "CTA",
    avgLift: "+12.7%",
    liftRange: "+5% a +28%",
    description: "70% dos usuários desktop não rolam até o fim. CTA na primeira tela (sem scroll) garante visibilidade no momento de maior intenção.",
    whenToUse: "LPs de captação e páginas de produto",
    example: "Hero do Notion, Webflow, Linear",
    source: "GoodUI",
    evidenceLevel: "Alta",
  },
  {
    id: "social-proof-near-cta",
    title: "Prova social colada no CTA",
    category: "Trust",
    avgLift: "+10.2%",
    liftRange: "+4% a +22%",
    description: "Depoimento, logo de cliente conhecido ou contagem de usuários ('+50k investidores') ao lado do botão reduz fricção de decisão.",
    whenToUse: "LPs de conversão paga, páginas de pricing",
    example: "'+15.000 brasileiros já assinam' colado no botão",
    source: "GoodUI",
    evidenceLevel: "Alta",
  },
  {
    id: "remove-cpf-optional",
    title: "Tornar CPF/telefone opcionais",
    category: "Form",
    avgLift: "+11.8%",
    liftRange: "+6% a +19%",
    description: "Cada campo extra reduz conversão em ~3-5%. Pedir só o essencial no signup e completar dados depois (progressive profiling) eleva taxa de finalização.",
    whenToUse: "Signups, lead capture, primeiro checkout",
    example: "Stripe pede só email + senha; resto vem depois",
    source: "Baymard",
    evidenceLevel: "Alta",
  },
  {
    id: "pix-default-checkout",
    title: "PIX como método padrão",
    category: "Pricing",
    avgLift: "+8.5%",
    liftRange: "+3% a +14%",
    description: "PIX já é >40% do volume e-commerce no Brasil. Selecioná-lo por padrão (em vez de cartão) reduz fricção de digitar 16 dígitos + CVV.",
    whenToUse: "Checkout de qualquer produto digital BR",
    example: "Hotmart, Eduzz, Kiwify",
    source: "Suno (interno)",
    evidenceLevel: "Média",
  },
  {
    id: "trust-seals",
    title: "Selos de segurança visíveis",
    category: "Trust",
    avgLift: "+6.3%",
    liftRange: "+2% a +12%",
    description: "SSL, 'Pagamento Seguro', logos de bandeiras e adquirente. Visíveis no momento do pagamento removem ansiedade do usuário leigo.",
    whenToUse: "Sempre — qualquer página com pagamento",
    example: "Magalu mostra Cielo + Stone + 'Compra Segura'",
    source: "Baymard",
    evidenceLevel: "Alta",
  },
  {
    id: "progress-bar-checkout",
    title: "Progress bar no checkout multi-step",
    category: "Onboarding",
    avgLift: "+7.4%",
    liftRange: "+3% a +13%",
    description: "Mostrar 'Passo 2 de 4' reduz a sensação de processo infinito e aumenta a finalização — especialmente em mobile.",
    whenToUse: "Checkout/signup de 3+ etapas",
    example: "Asaas, Conta Azul, Nubank",
    source: "GoodUI",
    evidenceLevel: "Alta",
  },
  {
    id: "exit-intent-popup",
    title: "Pop-up de exit intent com oferta",
    category: "CTA",
    avgLift: "+5.1%",
    liftRange: "+1% a +15%",
    description: "Detectar movimento do mouse para fechar a aba e oferecer desconto/lead magnet recupera 5-15% das saídas.",
    whenToUse: "LPs com tráfego pago caro (CPC > R$3)",
    example: "Cupons Magazine Luiza, Newsletter Domestika",
    source: "GoodUI",
    evidenceLevel: "Média",
  },
  {
    id: "sticky-cta-mobile",
    title: "CTA fixo no rodapé do mobile",
    category: "Mobile",
    avgLift: "+9.6%",
    liftRange: "+4% a +18%",
    description: "Mobile representa 60%+ do tráfego BR. CTA sticky no bottom segue o scroll e captura intenção em qualquer ponto da página.",
    whenToUse: "Páginas longas em mobile (especialmente conteúdo)",
    example: "Mercado Livre, OLX, Amazon mobile",
    source: "Baymard",
    evidenceLevel: "Alta",
  },
  {
    id: "loss-aversion-pricing",
    title: "Mostrar economia (não desconto)",
    category: "Pricing",
    avgLift: "+8.0%",
    liftRange: "+3% a +14%",
    description: "'Você economiza R$ 240/ano' converte mais que '20% off'. Aversão à perda é mais forte que apetite ao ganho (Kahneman).",
    whenToUse: "Pricing de assinatura, planos anuais",
    example: "Spotify, Netflix, Duolingo",
    source: "CXL",
    evidenceLevel: "Alta",
  },
  {
    id: "anchoring-3-plans",
    title: "3 planos com âncora central",
    category: "Pricing",
    avgLift: "+13.5%",
    liftRange: "+5% a +25%",
    description: "Apresentar 3 opções com a do meio destacada como 'Mais popular' ou 'Recomendado' eleva o ticket médio em 13%+.",
    whenToUse: "Página de pricing de SaaS/conteúdo",
    example: "HubSpot, Slack, Hotmart",
    source: "CXL",
    evidenceLevel: "Alta",
  },
  {
    id: "loading-skeleton",
    title: "Skeleton loading em vez de spinner",
    category: "Form",
    avgLift: "+4.2%",
    liftRange: "+1% a +9%",
    description: "Skeletons cinzas dão sensação de progresso e reduzem percepção de tempo de carregamento em até 30%, melhorando engagement.",
    whenToUse: "Dashboards, listas longas, qualquer fetch >300ms",
    example: "Facebook, LinkedIn, YouTube",
    source: "GoodUI",
    evidenceLevel: "Média",
  },
];

const patternCategoryStyle: Record<CROPattern["category"], string> = {
  Form: "bg-blue-50 text-blue-700 border-blue-200",
  CTA: "bg-amber-50 text-amber-700 border-amber-200",
  Trust: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Pricing: "bg-violet-50 text-violet-700 border-violet-200",
  Onboarding: "bg-pink-50 text-pink-700 border-pink-200",
  Mobile: "bg-cyan-50 text-cyan-700 border-cyan-200",
};

export default function CROPage() {
  const [selectedPage, setSelectedPage] = useState<PageScore | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [sugOpen, setSugOpen] = useState(false);
  const [metricOpen, setMetricOpen] = useState<string | null>(null);

  // Decisões dos insights — persistidas em localStorage por título.
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [decisionFilter, setDecisionFilter] = useState<"all" | Decision>("all");
  const [insightSort, setInsightSort] = useState<"default" | "ice" | "priority">("ice");
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [selectedPattern, setSelectedPattern] = useState<CROPattern | null>(null);

  // Carrega decisões salvas no boot.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DECISION_STORAGE_KEY);
      if (raw) setDecisions(JSON.parse(raw));
    } catch {
      // ignora — localStorage indisponível
    }
  }, []);

  // Persiste a cada mudança.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DECISION_STORAGE_KEY, JSON.stringify(decisions));
    } catch {
      // ignora
    }
  }, [decisions]);

  function setDecision(key: string, status: Decision, reason?: string) {
    setDecisions((prev) => ({
      ...prev,
      [key]: { status, rejectReason: reason, decidedAt: Date.now() },
    }));
  }

  function clearDecision(key: string) {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Estado de criação de task no Monday — para feedback UI
  const [mondayState, setMondayState] = useState<
    Record<string, { status: "creating" | "created" | "failed"; url?: string; error?: string }>
  >({});

  /**
   * "Aceitar sugestão" — ensina o copiloto a trazer mais insights assim.
   * NÃO cria task no Monday (essa responsabilidade fica no botão "Adicionar tarefa").
   * Aqui só atualiza o estado local + sinaliza ao copiloto via tag de feedback.
   */
  function handleAccept(it: Insight) {
    const key = insightKey(it);
    setDecision(key, "accepted");
    // Tag de feedback positivo pro copiloto refinar futuras sugestões
    if (typeof window !== "undefined") {
      try {
        const KEY = "suno:cro:learn-feedback:v1";
        const raw = window.localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.push({
          insightTitle: it.title,
          insightCategory: it.priority,
          confidence: it.confidence,
          effort: it.effort,
          risk: it.risk,
          feedback: "positive",
          timestamp: Date.now(),
        });
        window.localStorage.setItem(KEY, JSON.stringify(arr.slice(-200))); // mantém últimos 200
      } catch {}
    }
  }

  /**
   * "Adicionar tarefa" — cria item COMPLETO no Monday, no grupo Planejados,
   * com TODOS os campos do painel (hipótese, evidência, ICE, KPIs, janela,
   * rollback, riscos, segmentos, plano de ação, responsável).
   * É independente do estado de aceite — você pode criar a task mesmo sem
   * ter aceito formalmente, ou criar várias vezes (sem dedup).
   */
  async function handleCreateTask(it: Insight) {
    const key = insightKey(it);
    const ice = calculateICE(it);
    setMondayState((prev) => ({ ...prev, [key]: { status: "creating" } }));

    try {
      const res = await fetch("/api/monday/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: it.title,
          // Payload completo do insight — o endpoint Monday vai montar o markdown
          insight: {
            title: it.title,
            description: it.desc,
            action: it.action,
            priority: it.priority,
            confidence: it.confidence,
            effort: it.effort,
            risk: it.risk,
            riskNotes: it.riskNotes,
            impact: it.impact,
            owner: it.owner,
            hypothesis: it.hypothesis,
            evidence: it.evidence,
            primaryKPI: it.primaryKPI,
            secondaryKPIs: it.secondaryKPIs,
            testWindow: it.testWindow,
            rollback: it.rollback,
            costEstimate: it.costEstimate,
            affectedSegments: it.affectedSegments,
            steps: it.steps,
            iceScore: ice.score,
            iceImpact: ice.impact,
            iceConfidence: ice.confidence,
            iceEase: ice.ease,
            iceTier: ice.tier,
            propertyName,
          },
          sourceLink: typeof window !== "undefined" ? `${window.location.origin}/cro` : undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        item?: { url: string; id: string };
        message?: string;
        error?: string;
      };
      if (data.ok && data.item) {
        setMondayState((prev) => ({ ...prev, [key]: { status: "created", url: data.item!.url } }));
      } else {
        const msg = data.message || data.error || "erro desconhecido";
        setMondayState((prev) => ({ ...prev, [key]: { status: "failed", error: msg } }));
      }
    } catch (e) {
      setMondayState((prev) => ({
        ...prev,
        [key]: { status: "failed", error: (e as Error).message },
      }));
    }
  }

  function startReject(it: Insight) {
    setRejectingKey(insightKey(it));
    setRejectReason("");
  }

  function confirmReject() {
    if (!rejectingKey) return;
    const trimmed = rejectReason.trim() || "Sem motivo informado";
    setDecision(rejectingKey, "rejected", trimmed);
    // Tag de feedback negativo + motivo — usado pelo copiloto pra afiar próximas sugestões
    if (typeof window !== "undefined") {
      try {
        const KEY = "suno:cro:learn-feedback:v1";
        const raw = window.localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.push({
          insightTitle: rejectingKey,
          feedback: "negative",
          reason: trimmed,
          timestamp: Date.now(),
        });
        window.localStorage.setItem(KEY, JSON.stringify(arr.slice(-200)));
      } catch {}
    }
    setRejectingKey(null);
    setRejectReason("");
  }

  // Conexão com a propriedade GA4 selecionada — ao trocar, todo o painel
  // recalcula (KPIs, páginas, insights, sugestão do dia).
  const { selected, selectedId, useRealData } = useGA4();
  const { data: pagesDetail, meta: pagesMeta } = useGA4PagesDetail();
  const seed = hashSeed(selectedId);
  const propertyName = selected?.displayName || "Modo demo (sem GA4)";

  // Páginas reais (se conectado) → calcula score baseado em bounceRate + sessão.
  const realPagesAvailable =
    useRealData && pagesMeta.status === "success" && (pagesDetail?.pages?.length || 0) > 0;
  const realPageScores: PageScore[] = useMemo(() => {
    if (!realPagesAvailable) return [];
    return pagesDetail!.pages.slice(0, 5).map((p) => {
      // Score: 100 - bounce/2 + clamp(eng/u * 0.4) — heurística simples
      const score = Math.max(
        40,
        Math.min(99, Math.round(100 - p.bounceRate / 2 + Math.min(20, p.engagementPerUser / 5)))
      );
      // LCP/CLS/INP estimados a partir da sessão e bounce (sem CrUX real ainda)
      const lcp = +(1.6 + (p.bounceRate / 100) * 2.4 + ((seed >> 3) % 10) / 20).toFixed(1);
      const cls = +(0.04 + (p.bounceRate / 100) * 0.16).toFixed(2);
      const inp = Math.round(120 + p.bounceRate * 3);
      const conv = +Math.max(0.4, Math.min(6, (p.engagementPerUser / 50) + (100 - p.bounceRate) / 30)).toFixed(1);
      return {
        page: p.path || "/",
        score,
        lcp,
        cls,
        inp,
        conversion: conv,
        trend: score >= 75 ? "up" : "down",
        pageviews: p.views,
        bounce: p.bounceRate,
        diagnosis: diagnoseFromMetrics(p),
      };
    });
  }, [realPagesAvailable, pagesDetail, seed]);

  // Páginas exibidas: reais quando disponíveis, senão mock com escala por propriedade.
  const displayPageScores: PageScore[] = realPagesAvailable
    ? realPageScores
    : pageScores.map((p, i) => {
        const factor = 0.7 + ((seed + i * 13) % 60) / 100; // 0.7 – 1.3
        const scoreShift = ((seed + i * 7) % 18) - 9; // -9..+8
        return {
          ...p,
          score: Math.max(40, Math.min(99, p.score + scoreShift)),
          pageviews: Math.round(p.pageviews * factor),
          conversion: +(p.conversion * (0.85 + ((seed + i) % 30) / 100)).toFixed(1),
          bounce: +Math.max(15, Math.min(80, p.bounce + scoreShift / 2)).toFixed(1),
        };
      });

  // KPIs derivados do conjunto exibido — sempre coerentes com a propriedade.
  const avgScore = displayPageScores.length
    ? Math.round(displayPageScores.reduce((s, p) => s + p.score, 0) / displayPageScores.length)
    : 78;
  const avgConv = displayPageScores.length
    ? +(displayPageScores.reduce((s, p) => s + p.conversion, 0) / displayPageScores.length).toFixed(1)
    : 2.8;
  const totalViews = displayPageScores.reduce((s, p) => s + p.pageviews, 0);
  const oppCount = 8 + (seed % 9); // 8–16
  const impactNum = Math.round(80 + (seed % 90) + (totalViews / 5000)); // R$ k/mês
  const impactLabel = `R$ ${impactNum}k`;

  const metrics = [
    { key: "score", label: "Score Médio", value: String(avgScore), sub: "/100", color: "#10b981", detail: `Média ponderada do Core Web Vitals estimado + conversão das ${displayPageScores.length} páginas principais da propriedade ${propertyName}.` },
    { key: "conv", label: "Conversão Geral", value: `${avgConv}%`, sub: realPagesAvailable ? "real" : "mock", color: "#7c5cff", detail: `Conversão média das páginas-chave em ${propertyName}. ${realPagesAvailable ? "Calculada a partir dos engajamentos reais do GA4." : "Em modo demo — conecte a propriedade para números exatos."}` },
    { key: "opp", label: "Oportunidades", value: String(oppCount), sub: "ativas", color: "#f59e0b", detail: `Insights priorizados por impacto em receita para a propriedade ${propertyName}.` },
    { key: "impact", label: "Impacto Potencial", value: impactLabel, sub: "/mês", color: "#ef4444", detail: `Soma dos impactos estimados se as recomendações da propriedade ${propertyName} forem implementadas.` },
  ];

  // Insights dinâmicos: páginas reais com bounce alto viram insights reais.
  const dynamicInsights: Insight[] = useMemo(() => {
    if (!realPagesAvailable) {
      // Embaralha levemente os mocks com base na seed pra dar diferença visível
      return insights.map((it, i) => ({
        ...it,
        title:
          i === 0
            ? `${it.title.split(" em ")[0]} em ${displayPageScores[Math.min(i, displayPageScores.length - 1)]?.page || "/relatorios"}`
            : it.title,
      }));
    }
    const dyn: Insight[] = [];
    const sortedByBounce = [...pagesDetail!.pages].sort((a, b) => b.bounceRate - a.bounceRate);
    const worst = sortedByBounce[0];
    if (worst && worst.bounceRate > 55) {
      dyn.push({
        icon: AlertTriangle,
        color: "text-red-500 bg-red-50",
        priority: "Alta",
        title: `Rejeição alta em ${worst.path}`,
        desc: `${worst.bounceRate.toFixed(1)}% dos usuários saem sem interação (${formatNumber(worst.views)} visualizações). Há mismatch entre fonte de tráfego e conteúdo, ou problema de carregamento.`,
        action: "Revisar fonte de tráfego, CTA above-the-fold e tempo de carregamento",
        impact: `+${(worst.bounceRate * 0.15).toFixed(0)}% conversão estimado se reduzir 10pp`,
        effort: "médio",
        owner: "Dev frontend + Marketing",
        steps: [
          `Auditar UTM/canal que mais traz tráfego para ${worst.path}`,
          "Rodar PageSpeed Insights e validar LCP < 2.5s",
          "Subir CTA principal acima do fold (desktop e mobile)",
          "Adicionar prova social no primeiro viewport",
          "Rodar A/B com nova versão por 14 dias",
        ],
        confidence: "Alta",
        evidence: `Dado real GA4: bounceRate de ${worst.bounceRate.toFixed(1)}% em ${formatNumber(worst.views)} pageviews — bem acima da média da propriedade (40–50%).`,
        hypothesis: `Reduzir bounceRate em 10pp eleva a conversão em ≈${(worst.bounceRate * 0.15).toFixed(0)}%.`,
        costEstimate: "≈ 16h dev + 8h marketing. R$ 0 de mídia inicial.",
        risk: "baixo",
        riskNotes: "Mudança visual pode afetar leitura — manter rollback rápido com feature flag.",
        primaryKPI: `Bounce rate em ${worst.path}`,
        secondaryKPIs: ["Tempo médio na página", "CTR para próximo passo", "Taxa de scroll >50%"],
        testWindow: "A/B 50/50 por 14 dias",
        rollback: "Reverter se bounceRate piorar 5pp ou se conversão cair >3%",
        affectedSegments: [`Visitantes de ${worst.path} (todos os canais)`],
      });
    }
    const longest = [...pagesDetail!.pages].sort((a, b) => b.avgSessionDuration - a.avgSessionDuration)[0];
    if (longest) {
      dyn.push({
        icon: Lightbulb,
        color: "text-amber-500 bg-amber-50",
        priority: "Média",
        title: `${longest.path} retém usuário por ${(longest.avgSessionDuration / 60).toFixed(1)}min`,
        desc: `Página com a maior sessão média da propriedade. Boa candidata para inserir CTA de conversão e capturar leads quentes.`,
        action: "Testar CTA contextual no meio do conteúdo",
        impact: `+${Math.round(longest.users * 0.04)} leads/mês estimado`,
        effort: "baixo",
        owner: "Produto + Conteúdo",
        steps: [
          "Identificar ponto de scroll com maior tempo (heatmap)",
          "Inserir CTA contextual (newsletter ou trial)",
          "Validar com A/B test de 14 dias",
          "Replicar em outras páginas similares",
        ],
        confidence: "Média",
        evidence: `Sessão média de ${(longest.avgSessionDuration / 60).toFixed(1)}min com ${formatNumber(longest.users)} usuários — atenção residual disponível para captura.`,
        hypothesis: `Inserir CTA contextual converte 4% dos usuários engajados em leads (${Math.round(longest.users * 0.04)} por mês).`,
        costEstimate: "≈ 8h conteúdo + 4h dev. Sem mídia.",
        risk: "baixo",
        riskNotes: "CTA mal posicionado pode reduzir tempo de leitura — usar lazy reveal após 30s na página.",
        primaryKPI: "Leads gerados na página",
        secondaryKPIs: ["Tempo médio (não pode cair)", "Taxa de scroll completo", "Bounce rate"],
        testWindow: "A/B 50/50 por 14 dias",
        rollback: "Remover CTA se tempo médio cair ≥15% ou bounce subir >5pp",
        affectedSegments: [`Leitores de ${longest.path}`],
      });
    }
    // Insight Meta AI Connector — fixo, mas com números seedados pela propriedade.
    // Aparece sempre — promove ativação do CAPI/lookalike via conector.
    const baseUsers = realPagesAvailable
      ? (pagesDetail!.pages.reduce((s, p) => s + p.users, 0))
      : 120000 + (seed % 80000);
    const audienceUsers = Math.round(baseUsers * (0.55 + (seed % 25) / 100)); // 55-80% da base
    const liftPct = 18 + (seed % 12); // 18-29%
    const roasFrom = 3.4 + ((seed % 16) / 10); // 3.4-4.9
    const roasTo = +(roasFrom * (1 + liftPct / 100)).toFixed(1);

    const metaConnectorInsight: Insight = {
      icon: Zap,
      color: "text-blue-500 bg-blue-50",
      priority: "Alta",
      title: `Sincronizar audiência logada (~${formatNumber(audienceUsers)}) com Meta via AI Connector`,
      desc: `Em ${propertyName}, você tem ~${formatNumber(audienceUsers)} usuários logados disponíveis para Lookalike no Meta. Hoje a maioria não é ativada como audiência paga — o conector AI faz o sync automático do CRM/data warehouse para o Meta Ads sem trabalho de dev.`,
      action: "Ativar Meta AI Connector + criar Lookalike de assinantes ativos",
      impact: `+${liftPct}% ROAS estimado (${roasFrom.toFixed(1)}x → ${roasTo}x)`,
      effort: "médio",
      owner: "Mídia paga + CRM + Jurídico (LGPD)",
      steps: [
        "Validar Consent Mode v2 e política LGPD para envio de PII hasheada",
        "Em Meta Business Manager → Events Manager → Conversions API → Set up via partner",
        "Escolher conector: Snowflake / BigQuery / Salesforce / HubSpot",
        `Mapear segmento "Assinantes ativos ${propertyName}" como audiência fonte`,
        "Criar Lookalike 1-3% sobre essa audiência",
        "Rodar 30 dias com holdout de 10% para isolar incremental",
        "Comparar CAC e ROAS vs período anterior",
      ],
      confidence: "Alta",
      evidence: `Benchmark Meta para fintechs BR: lookalike sobre base de assinantes converte 1.8x melhor que interesse genérico. Sua base atual estimada: ${formatNumber(audienceUsers)} usuários elegíveis.`,
      hypothesis: `Lookalike sobre audiência logada eleva ROAS Meta em ≥15% nos primeiros 60 dias.`,
      costEstimate: "≈ R$ 8k/mês conector + 24h setup técnico + 16h jurídico LGPD",
      risk: "médio",
      riskNotes: "LGPD é o risco principal — todo envio de PII deve ser hasheado SHA-256 e respeitar opt-out. Risco regulatório (CVM) se compartilhar dado sem consentimento explícito.",
      primaryKPI: "ROAS Meta rolling 7 dias (target: ≥3.5x)",
      secondaryKPIs: ["CAC Meta", "Match rate Meta (target ≥70%)", "Conversões via CAPI vs pixel"],
      testWindow: "30 dias com holdout de 10% para isolar incremental",
      rollback: "Pausar campanha lookalike se ROAS cair abaixo de 2.5x por 5 dias seguidos",
      affectedSegments: [`Assinantes ativos ${propertyName}`, "Lookalike 1% derivado", "Lookalike 3% derivado"],
    };

    // Mantém os insights estratégicos do mock após os dinâmicos + Meta Connector
    return [...dyn, metaConnectorInsight, ...insights.slice(0, 3)];
  }, [realPagesAvailable, pagesDetail, displayPageScores, propertyName, seed]);

  // Sugestões do dia — array de 5 personalizadas por propriedade.
  // A primeira (índice 0) é o "topo do dia" — a mais alinhada com o estado real da propriedade.
  const dailySuggestions: DailySuggestion[] = useMemo(() => {
    const worstScore = [...displayPageScores].sort((a, b) => a.score - b.score)[0];
    const bestTraffic = [...displayPageScores].sort((a, b) => b.pageviews - a.pageviews)[0];
    const focus = worstScore || displayPageScores[0];

    // Substituições contextuais por propriedade
    const personalized: DailySuggestion[] = baseDailySuggestions.map((sug, i) => {
      // Variação determinística por propriedade
      const liftBoost = (seed + i * 11) % 18; // 0..17
      const roiBoost = (seed + i * 7) % 6; // 0..5

      if (i === 0 && focus) {
        // CTA — referencia a pior página da propriedade
        return {
          ...sug,
          title: `Teste A/B no CTA de ${focus.page}`,
          impact: `+${(15 + liftBoost).toFixed(0)}% cliques estimado`,
          roi: `1:${(8 + roiBoost).toFixed(0)}`,
          rationale: `Em ${propertyName}, ${focus.page} tem score ${focus.score} e ${focus.bounce.toFixed(1)}% de rejeição (${formatNumber(focus.pageviews)} pageviews). Reposicionar o CTA tende a ser a mudança de maior impacto/esforço esta semana.`,
          evidence: `Dado da propriedade: bounce ${focus.bounce.toFixed(1)}% em ${formatNumber(focus.pageviews)} visualizações. Score ${focus.score}/100.`,
          successMetric: `CTR no CTA principal de ${focus.page} (mínimo +10% para promover)`,
        };
      }
      if (i === 1 && worstScore) {
        // Performance — referencia a página com pior score
        return {
          ...sug,
          title: `Otimizar Core Web Vitals em ${worstScore.page}`,
          impact: `+${(12 + liftBoost).toFixed(0)}% conversão estimado`,
          roi: `1:${(6 + roiBoost).toFixed(0)}`,
          rationale: `${worstScore.page} (em ${propertyName}) tem LCP de ${worstScore.lcp}s e CLS ${worstScore.cls}. Atacar Web Vitals da página é a entrega de menor esforço com retorno em conversão.`,
          evidence: `LCP atual: ${worstScore.lcp}s · CLS: ${worstScore.cls} · INP: ${worstScore.inp}ms · ${formatNumber(worstScore.pageviews)} pageviews/mês.`,
          successMetric: `LCP p75 abaixo de 2.5s em ${worstScore.page} e conversão recuperando ≥${5 + (seed % 8)}pp`,
        };
      }
      if (i === 2 && bestTraffic) {
        // Funil — usa a página de maior tráfego como contexto
        return {
          ...sug,
          impact: `+${380 + ((seed + i) % 200)} compras/mês estimado`,
          roi: `1:${(18 + roiBoost).toFixed(0)}`,
          rationale: `O funil de checkout em ${propertyName} é o gargalo de maior receita. Com ${formatNumber(bestTraffic.pageviews)} pageviews/mês em ${bestTraffic.page}, mexer aqui amplifica o impacto de qualquer otimização downstream.`,
          evidence: `Página com mais tráfego: ${bestTraffic.page} (${formatNumber(bestTraffic.pageviews)} views). Conversão atual: ${bestTraffic.conversion}%.`,
          successMetric: `Taxa de finalização do checkout ≥${82 + (seed % 6)}%`,
        };
      }
      if (i === 3) {
        // Mídia — varia o ROAS e o impacto por seed
        const baseRoas = 3.6 + ((seed % 18) / 10); // 3.6 a 5.4
        const incremento = 30 + ((seed + i) % 40); // 30k a 70k
        return {
          ...sug,
          title: `Escalar a melhor campanha (ROAS atual ${baseRoas.toFixed(1)}x)`,
          impact: `+R$ ${incremento}k receita mensal`,
          roi: `1:${baseRoas.toFixed(1)}`,
          rationale: `Em ${propertyName}, há campanha com ROAS ${baseRoas.toFixed(1)}x e budget ainda subutilizado. Escalar gradual capta volume sem perder margem.`,
          evidence: `ROAS rolling 21d estável em ${baseRoas.toFixed(1)}x ± 0.3. Search query report mostra termos com volume residual.`,
          successMetric: `ROAS rolling 7d ≥${(baseRoas - 0.7).toFixed(1)}x ao longo de toda a escala`,
        };
      }
      if (i === 4) {
        // Retenção — número de usuários impactados varia com seed
        const baseUsers = 120 + ((seed + i * 3) % 100); // 120k–220k
        return {
          ...sug,
          impact: `+${10 + (seed % 8)}% retenção estimado`,
          rationale: `${propertyName} tem ~${baseUsers}k usuários logados, mas a maioria não recebe campanha de retenção. Cohort histórica mostra ganho de retenção em quem é impactado por remarketing.`,
          evidence: `Base logada estimada: ${baseUsers}k. Cohort 2025: +12pp de retenção em impactados vs não impactados.`,
          successMetric: `Conversão incremental ≥${8 + (seed % 6)}% vs grupo holdout`,
        };
      }
      return sug;
    });

    // Ordena: a sugestão com maior ROI numérico primeiro
    const parseRoi = (r: string) => {
      const m = r.match(/(\d+(?:\.\d+)?)/g);
      return m && m.length > 1 ? Number(m[1]) : 1;
    };
    return [...personalized].sort((a, b) => parseRoi(b.roi) - parseRoi(a.roi));
  }, [displayPageScores, propertyName, seed]);

  // Estado: qual sugestão está em foco no card e no modal
  const [dailyIndex, setDailyIndex] = useState(0);
  // Reset para 0 ao trocar propriedade (lista muda)
  useEffect(() => {
    setDailyIndex(0);
  }, [seed]);
  const dynDaily = dailySuggestions[dailyIndex] || dailySuggestions[0];

  return (
    <MasterGuard>
      <main className="ml-20 p-8 max-w-[1600px]">
        <Header />

        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-1.5">
            <Crown size={12} /> Área Master
          </div>
          <div className="px-3 py-1 rounded-full bg-[#ede9fe] text-[#7c5cff] text-xs font-semibold">
            CRO · Conversion Rate Optimization
          </div>
          <div className="px-3 py-1 rounded-full border border-slate-200 bg-white text-slate-700 text-xs font-semibold flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Análise de: <span className="font-bold text-[#5b3dd4]">{propertyName}</span>
          </div>
          {useRealData && <DataStatus meta={pagesMeta} usingMock={!useRealData} />}
        </div>

        {/* KPIs clicáveis */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {metrics.map((m, i) => (
            <motion.button
              key={m.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setMetricOpen(m.key)}
              className="bg-white rounded-2xl border border-[color:var(--border)] p-5 relative overflow-hidden text-left hover:shadow-lg hover:border-[#7c5cff]/40 transition group"
            >
              <div
                className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20"
                style={{ background: m.color }}
              />
              <p className="text-sm text-[color:var(--muted-foreground)] font-medium flex items-center justify-between">
                {m.label}
                <ChevronRight size={14} className="text-[color:var(--muted-foreground)] group-hover:translate-x-1 transition" />
              </p>
              <div className="flex items-baseline gap-1 mt-2">
                <p className="text-3xl font-bold tracking-tight">{m.value}</p>
                <p className="text-sm text-[color:var(--muted-foreground)]">{m.sub}</p>
              </div>
            </motion.button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Páginas clicáveis */}
          <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-6">
            <div className="mb-5">
              <h3 className="text-base font-semibold">Performance por Página</h3>
              <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                Core Web Vitals + taxa de conversão · clique para diagnóstico detalhado
              </p>
            </div>
            <div className="space-y-2">
              {displayPageScores.map((p, i) => (
                <motion.button
                  key={p.page}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => setSelectedPage(p)}
                  className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-[#ede9fe]/50 transition text-left"
                >
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm ${
                      p.score >= 85 ? "bg-emerald-100 text-emerald-700" :
                      p.score >= 75 ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    }`}
                  >
                    {p.score}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.page}</p>
                    <div className="flex gap-3 mt-1 text-xs text-[color:var(--muted-foreground)]">
                      <span>LCP {p.lcp}s</span>
                      <span>CLS {p.cls}</span>
                      <span className="font-medium text-[#7c5cff]">Conv. {p.conversion}%</span>
                    </div>
                  </div>
                  <div
                    className={`flex items-center gap-1 text-xs font-semibold ${
                      p.trend === "up" ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    <TrendingUp size={14} className={p.trend === "down" ? "rotate-180" : ""} />
                  </div>
                  <ChevronRight size={14} className="text-[color:var(--muted-foreground)]" />
                </motion.button>
              ))}
            </div>
          </div>

          {/* Sugestões do dia — clicável + carrossel */}
          <div className="bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] rounded-2xl p-6 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white blur-3xl opacity-10" />
            <div className="relative">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Lightbulb size={18} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-white/15 px-2 py-1 rounded-md">
                  {dailyIndex + 1} de {dailySuggestions.length}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="text-lg font-semibold leading-tight">{dynDaily.title}</h3>
              </div>
              <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border bg-white/10 border-white/20 mb-3`}>
                {dynDaily.category}
              </span>
              <p className="text-sm text-white/80 mb-4 leading-relaxed line-clamp-4">
                {dynDaily.rationale}
              </p>
              {/* Mini-grid: impact / ROI / effort */}
              <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
                <div className="bg-white/10 rounded-md p-2">
                  <p className="text-white/70 text-[10px] uppercase">Impacto</p>
                  <p className="font-bold mt-0.5">{dynDaily.impact}</p>
                </div>
                <div className="bg-white/10 rounded-md p-2">
                  <p className="text-white/70 text-[10px] uppercase">ROI</p>
                  <p className="font-bold mt-0.5">{dynDaily.roi}</p>
                </div>
                <div className="bg-white/10 rounded-md p-2">
                  <p className="text-white/70 text-[10px] uppercase">Esforço</p>
                  <p className="font-bold mt-0.5 capitalize">{dynDaily.effort}</p>
                </div>
              </div>
              {/* Botão principal */}
              <button
                onClick={() => setSugOpen(true)}
                className="flex items-center gap-2 text-sm font-medium bg-white/15 hover:bg-white/25 px-4 py-2 rounded-lg transition w-full justify-center mb-3"
              >
                Ver detalhes completos
                <ArrowUpRight size={14} />
              </button>
              {/* Navegação do carrossel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDailyIndex((i) => (i - 1 + dailySuggestions.length) % dailySuggestions.length)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition flex items-center gap-1"
                  aria-label="Anterior"
                >
                  ← Anterior
                </button>
                <div className="flex-1 flex items-center justify-center gap-1.5">
                  {dailySuggestions.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setDailyIndex(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === dailyIndex ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"
                      }`}
                      aria-label={`Sugestão ${i + 1}`}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setDailyIndex((i) => (i + 1) % dailySuggestions.length)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition flex items-center gap-1"
                  aria-label="Próxima"
                >
                  Próxima →
                </button>
              </div>
              <div className="mt-5 pt-4 border-t border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/70 flex items-center gap-2">
                    <Clock size={11} /> Timeline
                  </span>
                  <span className="font-medium">{dynDaily.timeline}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/70 flex items-center gap-2">
                    <Target size={11} /> KPI principal
                  </span>
                  <span className="font-medium text-right truncate ml-2 max-w-[60%]" title={dynDaily.successMetric}>
                    {dynDaily.successMetric}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Insights clicáveis */}
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-base font-semibold">Insights & Ações Recomendadas</h3>
              <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                Priorizado por impacto em receita · aceite, recuse ou clique para ver plano completo
              </p>
            </div>
            {/* Resumo de decisões + filtro */}
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const total = dynamicInsights.length;
                const accepted = dynamicInsights.filter((it) => decisions[insightKey(it)]?.status === "accepted").length;
                const rejected = dynamicInsights.filter((it) => decisions[insightKey(it)]?.status === "rejected").length;
                const pending = total - accepted - rejected;
                const filters: { id: "all" | Decision; label: string; count: number; cls: string }[] = [
                  { id: "all", label: "Todas", count: total, cls: "bg-slate-100 text-slate-700" },
                  { id: "pending", label: "Pendentes", count: pending, cls: "bg-amber-50 text-amber-700" },
                  { id: "accepted", label: "Aceitas", count: accepted, cls: "bg-emerald-50 text-emerald-700" },
                  { id: "rejected", label: "Recusadas", count: rejected, cls: "bg-red-50 text-red-700" },
                ];
                return filters.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setDecisionFilter(f.id)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
                      decisionFilter === f.id
                        ? "border-[#7c5cff] bg-[#ede9fe] text-[#5b3dd4]"
                        : "border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
                    }`}
                  >
                    <span className={`inline-flex items-center gap-1.5`}>
                      {f.label}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${f.cls}`}>{f.count}</span>
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
          {/* Toolbar de ordenação */}
          <div className="flex items-center gap-2 mb-3 flex-wrap text-xs">
            <span className="text-[color:var(--muted-foreground)] font-medium">Ordenar por:</span>
            {([
              { id: "ice", label: "Score ICE" },
              { id: "priority", label: "Prioridade" },
              { id: "default", label: "Padrão" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setInsightSort(s.id)}
                className={`px-2.5 py-1 rounded-md font-semibold border transition ${
                  insightSort === s.id
                    ? "border-[#7c5cff] bg-[#ede9fe] text-[#5b3dd4]"
                    : "border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
                }`}
              >
                {s.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-[color:var(--muted-foreground)]">
              ICE = Impacto × Confiança × Facilidade (1–1000)
            </span>
          </div>
          <div className="space-y-3">
            {dynamicInsights
              .filter((it) => {
                if (decisionFilter === "all") return true;
                const status = decisions[insightKey(it)]?.status || "pending";
                return status === decisionFilter;
              })
              .slice() // copy antes de sort
              .sort((a, b) => {
                if (insightSort === "ice") return calculateICE(b).score - calculateICE(a).score;
                if (insightSort === "priority") {
                  const order: Record<string, number> = { Alta: 0, Média: 1, Baixa: 2 };
                  return order[a.priority] - order[b.priority];
                }
                return 0;
              })
              .map((insight, i) => {
                const Icon = insight.icon;
                const key = insightKey(insight);
                const dec = decisions[key];
                const status = dec?.status || "pending";
                const ice = calculateICE(insight);
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className={`flex gap-4 p-4 rounded-xl border transition ${
                      status === "accepted"
                        ? "border-emerald-300 bg-emerald-50/40"
                        : status === "rejected"
                        ? "border-red-200 bg-red-50/30 opacity-75"
                        : "border-[color:var(--border)] hover:shadow-md hover:border-[#7c5cff]/40"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${insight.color}`}>
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-semibold text-sm">{insight.title}</h4>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border inline-flex items-center gap-1 ${iceBadgeStyle(ice.tier)}`}
                          title={`ICE = Impacto ${ice.impact} × Confiança ${ice.confidence} × Facilidade ${ice.ease}`}
                        >
                          ICE {ice.score}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${priorityBadge(insight.priority)}`}>
                          {insight.priority}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${confidenceBadge(insight.confidence)}`}>
                          Confiança {insight.confidence}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${riskBadge(insight.risk)}`}>
                          Risco {insight.risk}
                        </span>
                        {status === "accepted" && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white inline-flex items-center gap-1">
                            <CheckCircle2 size={10} /> Aceita
                          </span>
                        )}
                        {status === "rejected" && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-600 text-white inline-flex items-center gap-1">
                            <X size={10} /> Recusada
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[color:var(--muted-foreground)] mb-2">{insight.desc}</p>
                      {/* Mini-grid de evidência rápida */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                        <div className="text-[10px] bg-[color:var(--muted)]/50 rounded-md px-2 py-1.5">
                          <span className="block text-[color:var(--muted-foreground)] uppercase tracking-wide">Esforço</span>
                          <span className="font-semibold capitalize">{insight.effort}</span>
                        </div>
                        <div className="text-[10px] bg-[color:var(--muted)]/50 rounded-md px-2 py-1.5">
                          <span className="block text-[color:var(--muted-foreground)] uppercase tracking-wide">Custo</span>
                          <span className="font-semibold truncate block" title={insight.costEstimate}>{insight.costEstimate}</span>
                        </div>
                        <div className="text-[10px] bg-[color:var(--muted)]/50 rounded-md px-2 py-1.5">
                          <span className="block text-[color:var(--muted-foreground)] uppercase tracking-wide">Janela teste</span>
                          <span className="font-semibold truncate block" title={insight.testWindow}>{insight.testWindow}</span>
                        </div>
                        <div className="text-[10px] bg-emerald-50 text-emerald-800 rounded-md px-2 py-1.5">
                          <span className="block text-emerald-600 uppercase tracking-wide">Impacto</span>
                          <span className="font-semibold">{insight.impact}</span>
                        </div>
                      </div>
                      {status === "rejected" && dec?.rejectReason && (
                        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1 mb-2 flex items-start gap-1.5">
                          <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>Motivo da recusa:</strong> {dec.rejectReason}
                          </span>
                        </div>
                      )}
                      {/* Ações — 3 CTAs com semânticas distintas */}
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <button
                          onClick={() => setSelectedInsight(insight)}
                          className="text-xs font-medium text-[#7c5cff] hover:underline inline-flex items-center gap-1"
                        >
                          Ver plano completo <ChevronRight size={12} />
                        </button>
                        <span className="text-[color:var(--muted-foreground)]">·</span>

                        {/* CTA 1 — Aceitar sugestão (ensina o copiloto) */}
                        {status !== "accepted" ? (
                          <button
                            onClick={() => handleAccept(insight)}
                            title="Ensina o copiloto a trazer mais insights como esse"
                            className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                          >
                            <ThumbsUp size={12} /> Aceitar sugestão
                          </button>
                        ) : (
                          <button
                            onClick={() => clearDecision(key)}
                            title="Desfaz o feedback positivo (volta o card pra pendente)"
                            className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)]"
                          >
                            <Undo2 size={12} /> Desfazer aceite
                          </button>
                        )}

                        {/* CTA 2 — Recusar (afia futuras sugestões com motivo) */}
                        {status !== "rejected" ? (
                          <button
                            onClick={() => startReject(insight)}
                            title="Afia o copiloto: suas próximas sugestões consideram esse motivo"
                            className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 transition"
                          >
                            <ThumbsDown size={12} /> Recusar
                          </button>
                        ) : (
                          <button
                            onClick={() => clearDecision(key)}
                            title="Desfaz a recusa (volta o card pra pendente)"
                            className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)]"
                          >
                            <Undo2 size={12} /> Desfazer recusa
                          </button>
                        )}

                        {/* CTA 3 — Adicionar tarefa (cria task COMPLETA no Monday) */}
                        {mondayState[key]?.status !== "created" ? (
                          <button
                            onClick={() => handleCreateTask(insight)}
                            disabled={mondayState[key]?.status === "creating"}
                            title="Cria uma tarefa completa no Monday (board: Rotinas & Tarefas → Planejados)"
                            className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {mondayState[key]?.status === "creating" ? (
                              <>⏳ Criando no Monday…</>
                            ) : (
                              <>📋 Adicionar tarefa</>
                            )}
                          </button>
                        ) : (
                          <a
                            href={mondayState[key].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abre o item criado no board do Monday"
                            className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                          >
                            ✅ Tarefa criada · ver no Monday →
                          </a>
                        )}
                        {mondayState[key]?.status === "failed" && (
                          <span
                            className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md"
                            title={mondayState[key].error}
                          >
                            ⚠ Falha — verifique .env.local (MONDAY_API_TOKEN)
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            {dynamicInsights.filter((it) => {
              if (decisionFilter === "all") return true;
              const status = decisions[insightKey(it)]?.status || "pending";
              return status === decisionFilter;
            }).length === 0 && (
              <div className="text-center py-8 text-sm text-[color:var(--muted-foreground)]">
                Nenhuma recomendação nesse filtro.
              </div>
            )}
          </div>
        </div>

        {/* Biblioteca de Padrões Testados */}
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mt-6">
          <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                Biblioteca de Padrões Testados
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-[#7c5cff] to-[#5b3dd4] text-white uppercase tracking-wider">
                  Referência
                </span>
              </h3>
              <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                Padrões CRO consolidados pela indústria · fontes: GoodUI, Baymard Institute, CXL · clique em qualquer card para ver quando usar
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["Form", "CTA", "Trust", "Pricing", "Onboarding", "Mobile"] as const).map((cat) => (
                <span
                  key={cat}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md border ${patternCategoryStyle[cat]}`}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {croPatterns.map((p, i) => (
              <motion.button
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4) }}
                onClick={() => setSelectedPattern(p)}
                className="text-left p-4 rounded-xl border border-[color:var(--border)] hover:shadow-md hover:border-[#7c5cff]/40 transition group bg-white"
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${patternCategoryStyle[p.category]}`}
                  >
                    {p.category}
                  </span>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    {p.avgLift}
                  </span>
                </div>
                <h4 className="font-semibold text-sm mb-1.5 leading-tight">{p.title}</h4>
                <p className="text-xs text-[color:var(--muted-foreground)] line-clamp-2 mb-2">
                  {p.description}
                </p>
                <div className="flex items-center justify-between text-[10px] text-[color:var(--muted-foreground)] pt-2 border-t border-[color:var(--border)]">
                  <span>Fonte: <strong>{p.source}</strong></span>
                  <span className="inline-flex items-center gap-1">
                    Evidência:
                    <span
                      className={`font-bold ${
                        p.evidenceLevel === "Alta"
                          ? "text-emerald-700"
                          : p.evidenceLevel === "Média"
                          ? "text-amber-700"
                          : "text-slate-600"
                      }`}
                    >
                      {p.evidenceLevel}
                    </span>
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[color:var(--border)] flex items-start gap-2 text-xs text-[color:var(--muted-foreground)]">
            <Lightbulb size={12} className="mt-0.5 shrink-0 text-[#7c5cff]" />
            <p>
              Estes padrões saíram de meta-análises com milhares de testes A/B reais. Os lifts são <strong>médias da indústria</strong> —
              o resultado real em {propertyName} pode variar. Use a biblioteca como ponto de partida para gerar hipóteses, sempre validando com seu próprio A/B.
            </p>
          </div>
        </div>
      </main>

      {/* Dialog: Métrica */}
      <Dialog
        open={!!metricOpen}
        onClose={() => setMetricOpen(null)}
        title={metrics.find((m) => m.key === metricOpen)?.label}
        subtitle="Como é calculado"
        icon={
          <div className="w-10 h-10 rounded-xl bg-[#ede9fe] text-[#7c5cff] flex items-center justify-center">
            <Activity size={18} />
          </div>
        }
      >
        <p className="text-sm text-[color:var(--muted-foreground)] leading-relaxed">
          {metrics.find((m) => m.key === metricOpen)?.detail}
        </p>
      </Dialog>

      {/* Dialog: Página */}
      <Dialog
        open={!!selectedPage}
        onClose={() => setSelectedPage(null)}
        title={selectedPage?.page}
        subtitle={`Score ${selectedPage?.score}/100 · ${formatNumber(selectedPage?.pageviews || 0)} pageviews`}
        maxWidth="max-w-2xl"
        icon={
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
              (selectedPage?.score || 0) >= 85 ? "bg-emerald-100 text-emerald-700" :
              (selectedPage?.score || 0) >= 75 ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700"
            }`}
          >
            {selectedPage?.score}
          </div>
        }
      >
        {selectedPage && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                { k: "LCP", v: `${selectedPage.lcp}s`, good: selectedPage.lcp < 2.5 },
                { k: "CLS", v: selectedPage.cls, good: selectedPage.cls < 0.1 },
                { k: "INP", v: `${selectedPage.inp}ms`, good: (selectedPage.inp || 0) < 200 },
                { k: "Conversão", v: `${selectedPage.conversion}%`, good: selectedPage.conversion > 2 },
              ].map((m) => (
                <div
                  key={m.k}
                  className={`rounded-xl p-3 border ${m.good ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
                >
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">{m.k}</p>
                  <p className="text-lg font-bold mt-0.5">{m.v}</p>
                </div>
              ))}
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2">Diagnóstico</h4>
              <ul className="space-y-1.5">
                {selectedPage.diagnosis.map((d, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-[#7c5cff] mt-0.5 shrink-0" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2 pt-2">
              <button className="flex-1 px-4 py-2 rounded-xl bg-[#7c5cff] text-white text-sm font-medium">
                Rodar PageSpeed Insights
              </button>
              <button className="px-4 py-2 rounded-xl border border-[color:var(--border)] text-sm font-medium">
                Abrir GA4
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Dialog: Insight */}
      <Dialog
        open={!!selectedInsight}
        onClose={() => setSelectedInsight(null)}
        title={selectedInsight?.title}
        subtitle={selectedInsight?.desc}
        maxWidth="max-w-2xl"
        icon={
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedInsight?.color || ""}`}>
            {selectedInsight && <selectedInsight.icon size={18} />}
          </div>
        }
      >
        {selectedInsight && (() => {
          const key = insightKey(selectedInsight);
          const dec = decisions[key];
          const status = dec?.status || "pending";
          return (
            <div className="space-y-5">
              {/* Status atual da decisão (se houver) */}
              {status !== "pending" && (
                <div className={`rounded-xl border px-3 py-2 text-sm flex items-center gap-2 ${
                  status === "accepted" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
                }`}>
                  {status === "accepted" ? <CheckCircle2 size={14} /> : <X size={14} />}
                  <span className="font-semibold">{status === "accepted" ? "Recomendação aceita" : "Recomendação recusada"}</span>
                  {dec?.decidedAt && (
                    <span className="text-[11px] opacity-80 ml-auto">
                      {new Date(dec.decidedAt).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>
              )}
              {status === "rejected" && dec?.rejectReason && (
                <div className="text-xs text-red-700 bg-red-50/60 border border-red-200 rounded-md px-3 py-2">
                  <strong>Motivo:</strong> {dec.rejectReason}
                </div>
              )}

              {/* ICE score destaque */}
              {(() => {
                const ice = calculateICE(selectedInsight);
                return (
                  <div className={`rounded-xl border p-3 flex items-center gap-3 ${iceBadgeStyle(ice.tier)}`}>
                    <div className="text-3xl font-bold tabular-nums">{ice.score}</div>
                    <div className="flex-1">
                      <p className="text-[10px] uppercase font-bold opacity-70">Score ICE</p>
                      <p className="text-xs mt-0.5">
                        Impacto <strong>{ice.impact}</strong> × Confiança <strong>{ice.confidence}</strong> × Facilidade <strong>{ice.ease}</strong>
                      </p>
                    </div>
                    <div className="text-[11px] font-bold uppercase">
                      {ice.tier === "alto" ? "Prioridade absoluta" : ice.tier === "medio" ? "Vale rodar" : "Backlog longo"}
                    </div>
                  </div>
                );
              })()}

              {/* Sumário em cards: Prioridade / Confiança / Esforço / Risco / Impacto */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="rounded-xl bg-[color:var(--muted)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Prioridade</p>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold mt-1 inline-block ${priorityBadge(selectedInsight.priority)}`}>
                    {selectedInsight.priority}
                  </span>
                </div>
                <div className="rounded-xl bg-[color:var(--muted)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Confiança</p>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold mt-1 inline-block ${confidenceBadge(selectedInsight.confidence)}`}>
                    {selectedInsight.confidence}
                  </span>
                </div>
                <div className="rounded-xl bg-[color:var(--muted)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Esforço</p>
                  <p className="text-sm font-bold capitalize mt-1">{selectedInsight.effort}</p>
                </div>
                <div className="rounded-xl bg-[color:var(--muted)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Risco</p>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold mt-1 inline-block border ${riskBadge(selectedInsight.risk)}`}>
                    {selectedInsight.risk}
                  </span>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                  <p className="text-[10px] uppercase font-bold text-emerald-600">Impacto</p>
                  <p className="text-sm font-bold mt-1 text-emerald-800">{selectedInsight.impact}</p>
                </div>
              </div>

              {/* Evidência (por que essa recomendação?) */}
              <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-3">
                <h4 className="text-xs font-bold uppercase text-blue-700 mb-1 flex items-center gap-1.5">
                  <BarChart3 size={12} /> Evidência
                </h4>
                <p className="text-sm text-blue-900 leading-relaxed">{selectedInsight.evidence}</p>
              </div>

              {/* Hipótese */}
              <div className="rounded-xl bg-violet-50/40 border border-violet-200 p-3">
                <h4 className="text-xs font-bold uppercase text-violet-700 mb-1 flex items-center gap-1.5">
                  <Beaker size={12} /> Hipótese a validar
                </h4>
                <p className="text-sm text-violet-900 leading-relaxed">{selectedInsight.hypothesis}</p>
              </div>

              {/* Custo + Janela + Rollback */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded-xl border border-[color:var(--border)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Custo estimado</p>
                  <p className="text-sm font-semibold mt-1">{selectedInsight.costEstimate}</p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Janela de teste</p>
                  <p className="text-sm font-semibold mt-1">{selectedInsight.testWindow}</p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] p-3">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Critério de rollback</p>
                  <p className="text-sm font-semibold mt-1">{selectedInsight.rollback}</p>
                </div>
              </div>

              {/* Métricas de sucesso */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Target size={14} /> Métricas de sucesso
                </h4>
                <div className="space-y-1.5">
                  <div className="text-sm flex items-start gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#7c5cff] text-white shrink-0">PRINCIPAL</span>
                    <span>{selectedInsight.primaryKPI}</span>
                  </div>
                  {selectedInsight.secondaryKPIs.map((k, i) => (
                    <div key={i} className="text-sm flex items-start gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200 text-slate-700 shrink-0">apoio</span>
                      <span>{k}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Riscos / efeitos colaterais */}
              <div className="rounded-xl bg-amber-50/40 border border-amber-200 p-3">
                <h4 className="text-xs font-bold uppercase text-amber-700 mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> O que pode dar errado
                </h4>
                <p className="text-sm text-amber-900 leading-relaxed">{selectedInsight.riskNotes}</p>
              </div>

              {/* Segmentos afetados */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <ShieldCheck size={14} /> Segmentos afetados
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selectedInsight.affectedSegments.map((s, i) => (
                    <span key={i} className="text-xs bg-slate-100 text-slate-700 rounded-md px-2 py-1">
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Plano passo-a-passo */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <FileText size={14} /> Plano de ação
                </h4>
                <ol className="space-y-2">
                  {selectedInsight.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-[#7c5cff] text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl bg-[#ede9fe] p-3 text-sm">
                <span className="font-semibold text-[#5b3dd4]">Responsável sugerido:</span>{" "}
                <span className="text-[#5b3dd4]">{selectedInsight.owner}</span>
              </div>

              {/* Ações — 3 CTAs com semânticas distintas + microcopy */}
              <div className="space-y-2 pt-3 border-t border-[color:var(--border)]">
                <p className="text-[11px] text-[color:var(--muted-foreground)] leading-snug">
                  💡 <strong>Aceitar:</strong> ensina o copiloto a trazer mais sugestões assim · <strong>Recusar:</strong> afia futuras sugestões com o motivo · <strong>Adicionar tarefa:</strong> cria item completo no Monday (Planejados).
                </p>
                <div className="flex gap-2 flex-wrap">
                  {/* CTA 1 — Aceitar (ensina) */}
                  {status !== "accepted" ? (
                    <button
                      onClick={() => handleAccept(selectedInsight)}
                      className="flex-1 min-w-[160px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
                    >
                      <ThumbsUp size={14} /> Aceitar sugestão
                    </button>
                  ) : (
                    <button
                      onClick={() => clearDecision(key)}
                      className="flex-1 min-w-[160px] px-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm font-semibold hover:bg-[color:var(--muted)] flex items-center justify-center gap-2"
                    >
                      <Undo2 size={14} /> Desfazer aceite
                    </button>
                  )}

                  {/* CTA 2 — Recusar (afia) */}
                  {status !== "rejected" ? (
                    <button
                      onClick={() => startReject(selectedInsight)}
                      className="flex-1 min-w-[160px] px-4 py-2.5 rounded-xl border-2 border-red-200 bg-white text-red-700 hover:bg-red-50 text-sm font-semibold flex items-center justify-center gap-2 transition"
                    >
                      <ThumbsDown size={14} /> Recusar
                    </button>
                  ) : (
                    <button
                      onClick={() => clearDecision(key)}
                      className="flex-1 min-w-[160px] px-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm font-semibold hover:bg-[color:var(--muted)] flex items-center justify-center gap-2"
                    >
                      <Undo2 size={14} /> Desfazer recusa
                    </button>
                  )}

                  {/* CTA 3 — Adicionar tarefa no Monday (rico, completo) */}
                  {mondayState[key]?.status !== "created" ? (
                    <button
                      onClick={() => handleCreateTask(selectedInsight)}
                      disabled={mondayState[key]?.status === "creating"}
                      className="flex-1 min-w-[160px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
                    >
                      {mondayState[key]?.status === "creating" ? (
                        <>⏳ Criando no Monday…</>
                      ) : (
                        <>📋 Adicionar tarefa</>
                      )}
                    </button>
                  ) : (
                    <a
                      href={mondayState[key].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-[160px] px-4 py-2.5 rounded-xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-sm font-semibold flex items-center justify-center gap-2 transition"
                    >
                      ✅ Ver no Monday →
                    </a>
                  )}
                </div>
                {mondayState[key]?.status === "failed" && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-md">
                    ⚠ Falha ao criar no Monday: {mondayState[key].error}. Verifique o token em <code>.env.local</code>.
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </Dialog>

      {/* Dialog: Padrão CRO */}
      <Dialog
        open={!!selectedPattern}
        onClose={() => setSelectedPattern(null)}
        title={selectedPattern?.title}
        subtitle={selectedPattern ? `${selectedPattern.category} · Lift médio ${selectedPattern.avgLift}` : ""}
        maxWidth="max-w-2xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white flex items-center justify-center">
            <Lightbulb size={18} />
          </div>
        }
      >
        {selectedPattern && (
          <div className="space-y-4 text-sm">
            {/* Sumário em cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className={`rounded-xl border p-3 ${patternCategoryStyle[selectedPattern.category]}`}>
                <p className="text-[10px] uppercase font-bold opacity-70">Categoria</p>
                <p className="text-sm font-bold mt-1">{selectedPattern.category}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-[10px] uppercase font-bold text-emerald-600">Lift médio</p>
                <p className="text-sm font-bold mt-1 text-emerald-800">{selectedPattern.avgLift}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Faixa observada</p>
                <p className="text-sm font-bold mt-1">{selectedPattern.liftRange}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Evidência</p>
                <p className={`text-sm font-bold mt-1 ${
                  selectedPattern.evidenceLevel === "Alta" ? "text-emerald-700" :
                  selectedPattern.evidenceLevel === "Média" ? "text-amber-700" : "text-slate-600"
                }`}>
                  {selectedPattern.evidenceLevel}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-[#ede9fe]/50 border border-[#c4b5fd]/40 p-4">
              <h4 className="text-xs font-bold uppercase text-[#5b3ed6] mb-1.5 flex items-center gap-1.5">
                <Lightbulb size={12} /> O padrão
              </h4>
              <p className="text-slate-700 leading-relaxed">{selectedPattern.description}</p>
            </div>

            <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-3">
              <h4 className="text-xs font-bold uppercase text-blue-700 mb-1 flex items-center gap-1.5">
                <Target size={12} /> Quando usar
              </h4>
              <p className="text-blue-900">{selectedPattern.whenToUse}</p>
            </div>

            <div className="rounded-xl bg-amber-50/40 border border-amber-200 p-3">
              <h4 className="text-xs font-bold uppercase text-amber-700 mb-1 flex items-center gap-1.5">
                <ShieldCheck size={12} /> Exemplos no mercado
              </h4>
              <p className="text-amber-900">{selectedPattern.example}</p>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs">
              <p>
                <strong className="text-slate-700">Fonte:</strong>{" "}
                <span className="text-slate-600">{selectedPattern.source}</span>
                {selectedPattern.source === "GoodUI" && (
                  <a href="https://goodui.org" target="_blank" rel="noreferrer" className="ml-2 text-[#7c5cff] hover:underline">
                    goodui.org →
                  </a>
                )}
                {selectedPattern.source === "Baymard" && (
                  <a href="https://baymard.com" target="_blank" rel="noreferrer" className="ml-2 text-[#7c5cff] hover:underline">
                    baymard.com →
                  </a>
                )}
                {selectedPattern.source === "CXL" && (
                  <a href="https://cxl.com" target="_blank" rel="noreferrer" className="ml-2 text-[#7c5cff] hover:underline">
                    cxl.com →
                  </a>
                )}
              </p>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[color:var(--border)]">
              <button className="flex-1 px-4 py-2.5 rounded-xl bg-[#7c5cff] hover:bg-[#6b4bf0] text-white text-sm font-semibold flex items-center justify-center gap-2 transition">
                <Play size={14} /> Aplicar este padrão em uma página
              </button>
              <button className="px-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm font-medium hover:bg-[color:var(--muted)]">
                Adicionar ao backlog
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Dialog: Motivo da recusa */}
      <Dialog
        open={!!rejectingKey}
        onClose={() => { setRejectingKey(null); setRejectReason(""); }}
        title="Por que recusar essa recomendação?"
        subtitle="Registrar o motivo ajuda a refinar futuras sugestões"
        maxWidth="max-w-lg"
        icon={
          <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
            <ThumbsDown size={18} />
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-[color:var(--muted-foreground)]">Selecione um motivo rápido ou escreva o seu:</p>
          <div className="grid grid-cols-1 gap-1.5">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setRejectReason(r)}
                className={`text-left text-sm px-3 py-2 rounded-lg border transition ${
                  rejectReason === r
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-[color:var(--border)] hover:bg-[color:var(--muted)]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Ou descreva o motivo com suas palavras…"
            rows={3}
            className="w-full text-sm border border-[color:var(--border)] rounded-lg p-2.5 focus:outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={confirmReject}
              disabled={!rejectReason.trim()}
              className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirmar recusa
            </button>
            <button
              onClick={() => { setRejectingKey(null); setRejectReason(""); }}
              className="px-4 py-2 rounded-xl border border-[color:var(--border)] text-sm font-medium hover:bg-[color:var(--muted)]"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Dialog>

      {/* Dialog: Sugestão do dia — com carrossel + seções ricas */}
      <Dialog
        open={sugOpen}
        onClose={() => setSugOpen(false)}
        title={dynDaily.title}
        subtitle={`${dynDaily.category} · ${dynDaily.impact} · ROI estimado ${dynDaily.roi}`}
        maxWidth="max-w-3xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white flex items-center justify-center">
            <Lightbulb size={18} />
          </div>
        }
      >
        <div className="space-y-5 text-sm">
          {/* Carrossel header — navegação + indicador */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-[color:var(--border)]">
            <button
              onClick={() => setDailyIndex((i) => (i - 1 + dailySuggestions.length) % dailySuggestions.length)}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)] text-xs font-semibold flex items-center gap-1"
            >
              ← Anterior
            </button>
            <div className="flex items-center gap-1.5">
              {dailySuggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setDailyIndex(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === dailyIndex ? "w-8 bg-[#7c5cff]" : "w-2 bg-slate-300 hover:bg-slate-400"
                  }`}
                  title={s.title}
                />
              ))}
            </div>
            <button
              onClick={() => setDailyIndex((i) => (i + 1) % dailySuggestions.length)}
              className="px-3 py-1.5 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)] text-xs font-semibold flex items-center gap-1"
            >
              Próxima →
            </button>
          </div>

          {/* Sumário em cards (5 dimensões) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className={`rounded-xl border p-3 ${categoryStyle[dynDaily.category]}`}>
              <p className="text-[10px] uppercase font-bold opacity-70">Categoria</p>
              <p className="text-sm font-bold mt-1">{dynDaily.category}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-[10px] uppercase font-bold text-emerald-600">Impacto</p>
              <p className="text-sm font-bold mt-1 text-emerald-800">{dynDaily.impact}</p>
            </div>
            <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
              <p className="text-[10px] uppercase font-bold text-violet-600">ROI</p>
              <p className="text-sm font-bold mt-1 text-violet-800">{dynDaily.roi}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--muted)] p-3">
              <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Esforço</p>
              <p className="text-sm font-bold mt-1 capitalize">{dynDaily.effort}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--muted)] p-3">
              <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Timeline</p>
              <p className="text-sm font-bold mt-1">{dynDaily.timeline}</p>
            </div>
          </div>

          {/* Por que essa sugestão? */}
          <div className="rounded-xl bg-[#ede9fe]/50 border border-[#c4b5fd]/40 p-4">
            <h4 className="text-xs font-bold uppercase text-[#5b3ed6] mb-1.5 flex items-center gap-1.5">
              <Lightbulb size={12} /> Leitura do copiloto
            </h4>
            <p className="text-slate-700 leading-relaxed">{dynDaily.rationale}</p>
          </div>

          {/* Hipótese */}
          <div className="rounded-xl bg-violet-50/40 border border-violet-200 p-3">
            <h4 className="text-xs font-bold uppercase text-violet-700 mb-1 flex items-center gap-1.5">
              <Beaker size={12} /> Hipótese a validar
            </h4>
            <p className="text-violet-900 leading-relaxed">{dynDaily.hypothesis}</p>
          </div>

          {/* Evidência */}
          <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-3">
            <h4 className="text-xs font-bold uppercase text-blue-700 mb-1 flex items-center gap-1.5">
              <BarChart3 size={12} /> Evidência (de onde veio essa recomendação)
            </h4>
            <p className="text-blue-900 leading-relaxed">{dynDaily.evidence}</p>
          </div>

          {/* Métrica de sucesso */}
          <div className="rounded-xl bg-emerald-50/40 border border-emerald-200 p-3">
            <h4 className="text-xs font-bold uppercase text-emerald-700 mb-1 flex items-center gap-1.5">
              <Target size={12} /> Métrica de sucesso
            </h4>
            <p className="text-emerald-900 leading-relaxed">{dynDaily.successMetric}</p>
          </div>

          {/* Plano */}
          <div>
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <FileText size={14} /> Plano de ação
            </h4>
            <ol className="space-y-2">
              {dynDaily.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#7c5cff] text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Alternativas */}
          <div>
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <ShieldCheck size={14} /> Alternativas (caso essa não faça sentido)
            </h4>
            <ul className="space-y-1.5">
              {dynDaily.alternatives.map((alt, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-[color:var(--muted-foreground)] shrink-0">•</span>
                  <span>{alt}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Riscos */}
          <div className="rounded-xl bg-amber-50/40 border border-amber-200 p-3">
            <h4 className="text-xs font-bold uppercase text-amber-700 mb-1.5 flex items-center gap-1.5">
              <AlertTriangle size={12} /> O que pode dar errado
            </h4>
            <ul className="space-y-1">
              {dynDaily.risks.map((r, i) => (
                <li key={i} className="text-amber-900 flex items-start gap-2">
                  <span className="shrink-0">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Comparativo das outras sugestões */}
          <div>
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <BarChart3 size={14} /> Comparar com as outras {dailySuggestions.length - 1} sugestões
            </h4>
            <div className="space-y-1.5">
              {dailySuggestions.map((s, i) => {
                const active = i === dailyIndex;
                return (
                  <button
                    key={i}
                    onClick={() => setDailyIndex(i)}
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg border transition ${
                      active
                        ? "border-[#7c5cff] bg-[#ede9fe]/40"
                        : "border-[color:var(--border)] hover:bg-[color:var(--muted)]"
                    }`}
                  >
                    <span className={`w-6 h-6 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0 ${
                      active ? "bg-[#7c5cff] text-white" : "bg-slate-100 text-slate-600"
                    }`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{s.title}</p>
                      <p className="text-[10px] text-[color:var(--muted-foreground)]">
                        {s.category} · {s.impact} · ROI {s.roi}
                      </p>
                    </div>
                    {active && <CheckCircle2 size={14} className="text-[#7c5cff] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ações */}
          <div className="flex gap-2 pt-3 border-t border-[color:var(--border)]">
            <button className="flex-1 px-4 py-2.5 rounded-xl bg-[#7c5cff] hover:bg-[#6b4bf0] text-white text-sm font-semibold flex items-center justify-center gap-2 transition">
              <Play size={14} /> Criar teste A/B agora
            </button>
            <button className="px-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm font-medium hover:bg-[color:var(--muted)]">
              Adicionar ao backlog
            </button>
          </div>
        </div>
      </Dialog>
    </MasterGuard>
  );
}
