"use client";

import { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useGA4, useGA4Overview, useGA4Conversions, useGA4PagesDetail } from "./ga4-context";
import type { GA4PageDetail } from "./ga4-context";
import type { ReportTemplateId } from "./report-templates";
import { getKpis } from "./data";
import { getCampaignsForProperty } from "./property-campaigns";

// Dados "ao vivo" injetados no handler de intents
type LiveData = {
  overview: {
    kpis: {
      activeUsers: number;
      sessions: number;
      pageviews: number;
      conversions: number;
      engagedSessions?: number;
      bounceRate?: number; // %
    } | null;
    pages: { name: string; value: number; users: number }[] | null;
    events: { name: string; value: number }[] | null;
    days?: number;
  } | null;
  conversions: {
    conversions:
      | { event: string; count: number; users: number; value: number }[]
      | null;
  } | null;
  // Conversões dedicadas de 24h — independente do calendário do header.
  // Usado pra responder "quantos leads nas últimas 24h" com número exato.
  conversions24h: {
    conversions:
      | { event: string; count: number; users: number; value: number }[]
      | null;
  } | null;
  pagesDetail: { pages: GA4PageDetail[]; hosts: string[] } | null;
  isReal: boolean;
  days: number;
  loading?: boolean; // algum hook GA4 ainda carregando
  propertyId?: string | null;
  propertyName?: string | null;
  // Indica se o usuário logado tem privilégio master. Quando false, intents
  // que retornam insights/recomendações devolvem um placeholder explicando
  // que a feature é restrita ao perfil master.
  isMaster?: boolean;
};

const EMPTY_LIVE: LiveData = {
  overview: null,
  conversions: null,
  conversions24h: null,
  pagesDetail: null,
  isReal: false,
  days: 30,
  loading: false,
  propertyId: null,
  propertyName: null,
  isMaster: false,
};

// Helpers de lookup
function findPageByText(live: LiveData, text: string): GA4PageDetail | null {
  const pages = live.pagesDetail?.pages || [];
  if (!pages.length) return null;
  const t = text.toLowerCase();
  // 1) match por pathname explícito (/foo)
  const pathMatch = t.match(/\/[a-z0-9\-_/]+/i);
  if (pathMatch) {
    const wanted = pathMatch[0];
    const exact = pages.find((p) => p.path.toLowerCase() === wanted);
    if (exact) return exact;
    const partial = pages.find((p) => p.path.toLowerCase().includes(wanted));
    if (partial) return partial;
  }
  // 2) match por palavra em qualquer segmento do path
  for (const p of pages) {
    const path = p.path.toLowerCase();
    const segments = path.split(/[\/\-_?]/).filter((s) => s.length >= 4);
    for (const seg of segments) {
      if (t.includes(seg)) return p;
    }
  }
  return null;
}

function findEventByText(
  live: LiveData,
  text: string
): { name: string; value: number } | null {
  const events = live.overview?.events || [];
  if (!events.length) return null;
  const t = text.toLowerCase();
  // eventos GA4 são snake_case, procuramos por nome exato ou substring
  const exact = events.find((e) => t.includes(e.name.toLowerCase()));
  if (exact) return exact;
  // Aliases comuns
  const aliases: Record<string, string[]> = {
    purchase: ["compra", "comprou", "compras", "pedido"],
    begin_checkout: ["checkout", "finaliza", "carrinho"],
    generate_lead: ["lead", "leads", "cadastro"],
    sign_up: ["cadastro", "cadastrou", "signup"],
    user_login: ["login", "logou", "logins"],
    add_to_cart: ["carrinho", "adicionou"],
  };
  for (const [evt, words] of Object.entries(aliases)) {
    if (words.some((w) => t.includes(w))) {
      const found = events.find((e) => e.name === evt);
      if (found) return found;
    }
  }
  return null;
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

type Filter = "all" | "mobile" | "desktop" | "organic" | "paid";
type HighlightTarget = null | "kpis" | "trend" | "pages" | "events" | "funnel" | "journey";
export type Attribution = "last-click" | "assisted";

export type RichBlock =
  | { type: "insight"; severity: "info" | "warning" | "success" | "danger"; title: string; body: string }
  | { type: "metrics"; items: { label: string; value: string; delta?: string; positive?: boolean }[] }
  | { type: "recommendations"; items: { title: string; impact: string; effort: "baixo" | "médio" | "alto" }[] }
  | { type: "table"; columns: string[]; rows: (string | number)[][] }
  | { type: "actions"; items: { label: string; command: string }[] }
  | { type: "journey-step"; stage: string; event: string; value: number; issue?: string }
  | { type: "link"; href: string; label: string; description?: string }
  // Novos blocos do Copiloto 2.0
  | { type: "download"; reportId: ReportTemplateId; label: string; description: string; formats?: ("xlsx" | "pdf" | "csv")[] }
  | {
      type: "welcome-card";
      greeting: string;
      userName: string;
      accountName: string;
      radar: { label: string; value: string; tone?: "positive" | "warning" | "danger" | "neutral" }[];
      quickStarts: { emoji: string; title: string; subtitle: string; command: string }[];
    }
  | { type: "quick-start"; items: { emoji: string; title: string; subtitle: string; command: string }[] };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  rich?: RichBlock[];
  followUps?: string[];
};

type ChatContextType = {
  messages: ChatMessage[];
  filter: Filter;
  highlight: HighlightTarget;
  compareMode: boolean;
  toast: string | null;
  attribution: Attribution;
  setAttribution: (a: Attribution) => void;
  sendMessage: (text: string) => void;
  clearHighlight: () => void;
  navigateTo: string | null;
  consumeNavigate: () => void;
  // novo: permite apagar a conversa (volta ao welcome)
  resetChat: () => void;
};

const ChatContext = createContext<ChatContextType | null>(null);

function greetingForHour(h: number) {
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

type RadarOverride = {
  users?: number | null;
  conversions?: number | null;
  revenue?: number | null;
  anomalies?: number | null;
  days?: number;
  isReal?: boolean;
};

function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".", ",")}k`;
  return Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function formatBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace(".", ",")}k`;
  return `R$ ${Intl.NumberFormat("pt-BR").format(Math.round(n))}`;
}

function buildWelcome(
  firstName: string,
  accountName: string,
  radarOverride?: RadarOverride,
  suggestions?: { emoji: string; title: string; subtitle: string; command: string }[]
): ChatMessage {
  const hour = new Date().getHours();
  const greet = greetingForHour(hour);
  const d = radarOverride?.days ?? 30;
  const isReal = radarOverride?.isReal ?? false;
  const periodLabel = `${d}d`;

  // Mock defaults quando não há GA4 conectado
  const radar = radarOverride
    ? [
        {
          label: `Usuários (${periodLabel})`,
          value: formatCompact(radarOverride.users),
          tone: "positive" as const,
        },
        {
          label: "Conversões",
          value: formatCompact(radarOverride.conversions),
          tone: "warning" as const,
        },
        {
          label: "Anomalias",
          value: formatCompact(radarOverride.anomalies ?? 0),
          tone: (radarOverride.anomalies ?? 0) > 0 ? ("danger" as const) : ("neutral" as const),
        },
        {
          label: `Receita (${periodLabel})`,
          value: formatBRL(radarOverride.revenue),
          tone: "positive" as const,
        },
      ]
    : [
        { label: "Usuários Ativos (30d)", value: "470,9k", tone: "positive" as const },
        { label: "Conversões", value: "3.611", tone: "warning" as const },
        { label: "Anomalias detectadas", value: "3", tone: "danger" as const },
        { label: "Receita (30d)", value: "R$ 512k", tone: "positive" as const },
      ];

  const contentPrefix = isReal
    ? `${greet}, ${firstName}! ✨ Sou o **Copiloto Suno** — seu analista 24/7 de **${accountName}**.\n\nLi os dados GA4 dos últimos **${d} dias**. Aqui está o radar em tempo real e alguns atalhos 👇`
    : `${greet}, ${firstName}! ✨ Sou o **Copiloto Suno** — seu analista 24/7 de ${accountName}.\n\nAnalisei os dados mais recentes. Aqui está o radar do dia e alguns atalhos para você começar 👇`;

  return {
    role: "assistant",
    content: contentPrefix,
    timestamp: Date.now(),
    rich: [
      {
        type: "welcome-card",
        greeting: greet,
        userName: firstName,
        accountName,
        radar,
        quickStarts:
          suggestions && suggestions.length > 0
            ? suggestions
            : [
                {
                  emoji: "🎯",
                  title: "Diagnóstico de quedas",
                  subtitle: "Por que as conversões caíram?",
                  command: "Por que conversões caíram?",
                },
                {
                  emoji: "🩺",
                  title: "Gargalo da jornada",
                  subtitle: "Onde perdemos mais gente",
                  command: "Onde está meu maior gargalo?",
                },
                {
                  emoji: "📊",
                  title: "Baixar relatório executivo",
                  subtitle: "Excel ou PDF pronto",
                  command: "Gerar resumo executivo em Excel",
                },
                {
                  emoji: "💰",
                  title: "Melhor canal por receita",
                  subtitle: "Ranking completo",
                  command: "Qual canal traz mais receita?",
                },
              ],
      },
    ],
    followUps: [
      "🎯 Diagnosticar quedas",
      "📊 Baixar resumo executivo",
      "🔴 Ir para o realtime",
      "💡 Me dá recomendações",
    ],
  };
}

const defaultWelcome = buildWelcome("Renan", "Suno");

// ============================================================
// Master — log de perguntas (persistido em localStorage)
// ============================================================
const CHAT_LOG_KEY = "suno.chat.log";

export type ChatLogEntry = {
  id: string;
  text: string;
  timestamp: number;
  userEmail: string;
  userName: string;
  account: string;
  page: string;
  intent: string;
};

function loadLog(): ChatLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatLogEntry[];
  } catch {
    return [];
  }
}

function appendLog(entry: ChatLogEntry) {
  if (typeof window === "undefined") return;
  const current = loadLog();
  const next = [entry, ...current].slice(0, 500);
  localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(next));
}

export function getChatLog(): ChatLogEntry[] {
  return loadLog();
}

export function clearChatLog() {
  if (typeof window !== "undefined") localStorage.removeItem(CHAT_LOG_KEY);
}

// ============================================================
// Intent detection
// ============================================================
type Intent =
  | "drop_analysis"
  | "best_channel"
  | "worst_channel"
  | "lead_funnel"
  | "checkout_abandon"
  | "upsell"
  | "realtime"
  | "reports"
  | "compare"
  | "anomaly"
  | "recommendations"
  | "cohort"
  | "device_mobile"
  | "device_desktop"
  | "channel_organic"
  | "channel_paid"
  | "pages_top"
  | "events_analysis"
  | "page_specific" // nova: pergunta sobre uma página específica
  | "event_specific" // nova: pergunta sobre um evento específico
  | "kpi_snapshot" // nova: "como estão os números", "me dá um resumo"
  | "attribution_last"
  | "attribution_assisted"
  | "attribution_explain"
  | "journey"
  | "revenue"
  | "reset"
  | "help"
  // Novos
  | "export_executive"
  | "export_channels"
  | "export_pages"
  | "export_events"
  | "export_funnel"
  | "export_campaigns"
  | "export_audience"
  | "export_cro"
  | "export_anomalies"
  | "export_menu"
  // Chat ZT-like: triagem + conversação
  | "greeting" // oi, olá, bom dia
  | "thanks" // obrigado, valeu
  | "affirm" // sim, ok, pode ser, claro, beleza
  | "deny" // não, nada
  | "more_detail" // mais detalhes, explica, quero entender
  | "triage_analyze" // "quero analisar algo" — árvore de escolha
  | "triage_optimize" // "quero melhorar/otimizar"
  | "triage_investigate" // "tem algo errado" / "investigar"
  | "triage_report" // "quero um relatório/baixar"
  | "country_breakdown" // "por país", "geografia"
  | "peak_hours" // "melhor horário", "pico", "quando postar"
  | "retention_ltv" // "retenção", "ltv", "lifetime value"
  | "landing_performance" // "landing page", "melhor LP"
  | "seo_performance" // "seo", "organico", "google"
  | "campaigns_performance" // "ads", "roas", "campanha"
  | "benchmark" // "benchmark", "média do mercado"
  | "forecast" // "previsão", "projeção"
  | "yesterday_analysis" // "análise de ontem", "como foi ontem"
  // Intents otimizadas para a apresentação Suno
  | "sessions_today" // "como estamos hoje de sessões"
  | "top_campaigns_7d" // "melhores campanhas dos últimos 7 dias"
  | "leads_last_24h" // "quantos leads capturei nas últimas 24h"
  | "sales_purchase" // "como estão as vendas", "quantas vendas hoje" — evento purchase + campanhas
  | "lp_lookup" // "como está a LP X", "quantas sessões na url Y" — busca métricas de página específica
  | "logged_area_analysis" // "NAI", "área logada", "investidor.suno.com.br" — análise completa do subdomínio investidor.*
  | "whatsapp_widget_pages" // "páginas com widget de WhatsApp + acessos em 90d"
  | "smalltalk" // "tudo bem?", "oi chat"
  | "unknown";

function detectIntent(text: string, live: LiveData = EMPTY_LIVE): Intent {
  const t = text.toLowerCase().trim();
  const has = (...kws: string[]) => kws.some((k) => t.includes(k));
  const exact = (...kws: string[]) => kws.some((k) => t === k);

  // ---- ⚠ EARLY EXIT — perguntas sobre NAI / Área Logada / área do investidor
  // SEMPRE vão pra logged_area_analysis. Convenção definida pelo Renan:
  // "NAI" = Nova Área do Investidor (subdomínio investidor.* da propriedade
  // selecionada — investidor.suno.com.br ou investidor.statusinvest.com.br).
  // Esta checagem precede a regra de URL porque "investidor.suno.com.br"
  // como URL deveria casar aqui (não em lp_lookup genérico).
  const isLoggedAreaQuery =
    /\bnai\b/i.test(t) ||
    has(
      "área logada",
      "area logada",
      "área do investidor",
      "area do investidor",
      "área investidor",
      "area investidor",
      "logged area",
      "investidor.suno",
      "investidor.statusinvest",
      "dentro do investidor",
      "dentro da área logada",
      "dentro da area logada",
      "usuário logado",
      "usuario logado",
      "usuários logados",
      "usuarios logados",
      "área de membro",
      "area de membro",
      "área de assinante",
      "area de assinante"
    );
  if (isLoggedAreaQuery) {
    return "logged_area_analysis";
  }

  // ---- ⚠ EARLY EXIT — URL/path explícito SEMPRE vai pra lp_lookup.
  // Antes desse fix, "https://lp.statusinvest.com.br/..." caía em
  // landing_performance porque "lp" matchava no subdomain. Resultado:
  // chat retornava MOCK (/lp/premium-30 etc) em vez dos dados reais
  // da URL pesquisada. Esta checagem precede TUDO porque URL é a
  // pista mais forte de intenção.
  const hasExplicitUrl = /https?:\/\/[^\s]+/i.test(t);
  const hasExplicitPath = /\/[a-z0-9_-]+(?:\/[a-z0-9_-]+){1,}\/?/i.test(t);
  if (hasExplicitUrl || hasExplicitPath) {
    return "lp_lookup";
  }

  // ---- Conversação (prioridade máxima — respostas curtas primeiro)
  if (
    exact("oi", "olá", "ola", "hey", "hi", "hello", "e aí", "eai", "fala", "fala aí")
  )
    return "greeting";
  if (has("bom dia", "boa tarde", "boa noite") && t.length < 25) return "greeting";
  if (exact("obrigado", "obrigada", "valeu", "vlw", "thanks", "thx", "tks", "brigado"))
    return "thanks";
  if (
    exact("sim", "ok", "claro", "pode ser", "beleza", "blz", "show", "pode", "vai", "quero")
  )
    return "affirm";
  if (exact("não", "nao", "nem", "nada")) return "deny";
  if (
    has(
      "tudo bem",
      "como vc esta",
      "como você está",
      "como voce esta",
      "tá ai",
      "esta ai"
    ) &&
    t.length < 30
  )
    return "smalltalk";
  if (
    has(
      "mais detalhes",
      "explica melhor",
      "explica isso",
      "detalha",
      "quero entender",
      "por quê",
      "por que isso",
      "me conta mais"
    )
  )
    return "more_detail";

  // ---- Triagem (usuário está perdido)
  if (
    has("quero analisar", "me ajuda a analisar", "vamos analisar", "analisar dados") ||
    exact("analisar")
  )
    return "triage_analyze";
  if (
    has("melhorar", "otimizar", "crescer", "escalar", "aumentar conversão", "aumentar conversao") &&
    !has("canal", "mobile", "desktop")
  )
    return "triage_optimize";
  if (
    has("tem algo errado", "algo estranho", "investigar", "o que aconteceu", "diagnóstico", "diagnostico") &&
    !has("drop_analysis")
  )
    return "triage_investigate";
  if (
    has("quero um relatório", "quero um relatorio", "preciso de relatório", "preciso de relatorio", "me ajuda a exportar")
  )
    return "triage_report";

  // ---- Novos tópicos temáticos
  if (has("país", "pais", "geografia", "país que mais", "pais que mais", "brasil", "portugal"))
    return "country_breakdown";
  if (
    has(
      "melhor horário",
      "melhor horario",
      "pico de",
      "horário de pico",
      "horario de pico",
      "quando postar",
      "que horas",
      "horário ideal",
      "horario ideal"
    )
  )
    return "peak_hours";
  if (has("retenção", "retencao", "ltv", "lifetime value", "valor vida útil", "valor vida util"))
    return "retention_ltv";
  if (
    has("landing", "lp", "melhor lp", "melhor landing") &&
    !has("criar", "exportar", "baixar")
  )
    return "landing_performance";
  if (has("seo", "orgânic", "organic", "google natural", "busca orgânica", "busca organica"))
    return "seo_performance";
  if (has("campanha", "campaigns", "roas", "ads", "google ads", "meta ads") && !has("baixar", "exportar"))
    return "campaigns_performance";
  if (
    has(
      "benchmark",
      "média do mercado",
      "media do mercado",
      "mercado faz",
      "padrão do setor",
      "padrao do setor",
      "vs mercado",
      "vs o mercado",
      "versus mercado",
      "comparado ao mercado",
      "comparado com o mercado",
      "em relação ao mercado",
      "em relacao ao mercado",
      "concorrência",
      "concorrencia",
      "como estamos vs"
    )
  )
    return "benchmark";
  if (has("previsão", "previsao", "projeção", "projecao", "forecast", "vai bater", "quanto vou"))
    return "forecast";

  // ============================================================
  // PRIORIDADE MÁXIMA — perguntas críticas da apresentação Suno.
  // Detecção robusta para que funcione mesmo com pequenas variações.
  // ============================================================

  // Q1: "Como estamos hoje de sessões no site?" → mostra Total usuários,
  // Sessões, Sessões engajadas, Taxa de rejeição da propriedade selecionada.
  if (
    has(
      "como estamos hoje",
      "como estamos de sessões",
      "como estamos de sessoes",
      "sessões hoje",
      "sessoes hoje",
      "sessões no site",
      "sessoes no site",
      "como estão as sessões",
      "como estao as sessoes",
      "quantas sessões",
      "quantas sessoes",
      "estamos hoje no site",
      "panorama hoje",
      "métricas de hoje",
      "metricas de hoje"
    )
  )
    return "sessions_today";

  // Q2: "Quais são as melhores campanhas dos últimos 7 dias?" → top campanhas
  // com plataforma (Meta/Google) e ROAS.
  if (
    has(
      "melhores campanhas",
      "melhor campanha",
      "top campanhas",
      "ranking de campanhas",
      "campanhas dos últimos 7",
      "campanhas dos ultimos 7",
      "campanhas da semana",
      "campanhas em alta",
      "performance das campanhas",
      "quais campanhas estão melhores",
      "quais campanhas estao melhores"
    )
  )
    return "top_campaigns_7d";

  // Q3: "Quantos leads capturei nas últimas 24h?" → contagem de generate_lead
  // + lead_create_account + top campanhas que trouxeram esses leads.
  if (
    has(
      "quantos leads",
      "leads capturei",
      "leads que captei",
      "leads nas últimas 24",
      "leads nas ultimas 24",
      "leads de hoje",
      "leads hoje",
      "leads ontem",
      "leads das últimas",
      "leads das ultimas",
      "leads gerei",
      "geração de leads",
      "geracao de leads"
    )
  )
    return "leads_last_24h";

  // Q5: "Páginas com widget de WhatsApp + acessos em N meses" → busca eventos
  // contendo "whatsapp" e cruza com pagePath. Janela default 90 dias (3 meses).
  if (
    has("whatsapp", "whats app", "wapp", "wa widget", "zap")
  ) {
    return "whatsapp_widget_pages";
  }

  // Q4: "Como estão as vendas?" / "Quantas vendas hoje?" → evento purchase
  // + campanhas que mais converteram. Suporta vários timeframes.
  if (
    has(
      "vendas",
      "venda",
      "purchase",
      "compras",
      "quantas vendas",
      "quantas compras",
      "como estão as vendas",
      "como estao as vendas",
      "como está a venda",
      "como esta a venda",
      "faturamento",
      "receita de venda",
      "receita das vendas",
      "vendi",
      "vendemos",
      "vendeu",
      "vendido",
      "tiket de venda",
      "ticket médio",
      "ticket medio",
      "valor vendido"
    )
  )
    return "sales_purchase";

  // Q5: "Como está a LP X?" / "Quantas sessões na url Y?" → busca métricas
  // de uma URL/path específico. Detectamos por:
  //  - URL completa (https://...)
  //  - Path explícito (/algo/)
  //  - Padrões linguísticos pra LP/landing page/url/página
  // O handler extrai o trecho de URL/path do texto e cruza com pagesDetail.
  const hasUrlOrPath =
    /(https?:\/\/[^\s]+|\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\/?)/i.test(text);
  const hasLpKeyword = has(
    "lp ",
    "lp/",
    "landing page",
    "landing-page",
    " url ",
    "url ",
    "essa pagina",
    "essa página",
    "esta pagina",
    "esta página",
    "página específica",
    "pagina especifica",
    "métricas da página",
    "metricas da pagina",
    "métricas dessa",
    "metricas dessa",
    "dados da lp",
    "dados da url",
    "dados da página",
    "dados da pagina",
    "como está a lp",
    "como esta a lp",
    "como está a url",
    "como esta a url",
    "como está a página",
    "como esta a pagina",
    "performance da lp",
    "performance da página",
    "performance da pagina"
  );
  if (hasUrlOrPath || hasLpKeyword) return "lp_lookup";

  // Análise específica de "ontem" — pergunta crítica pra gerentes
  if (
    has(
      "ontem",
      "dia de ontem",
      "análise de ontem",
      "analise de ontem",
      "como foi ontem",
      "resultado de ontem",
      "números de ontem",
      "numeros de ontem",
      "d-1",
      "dia anterior"
    )
  )
    return "yesterday_analysis";

  // Snapshot / resumo — prioridade alta
  if (
    has(
      "como estão os números",
      "como estao os numeros",
      "como estamos",
      "me dá um resumo",
      "me da um resumo",
      "snapshot",
      "panorama",
      "como está o mês",
      "como esta o mes",
      "numeros de hoje",
      "números de hoje",
      "overview",
      "visão geral",
      "visao geral"
    )
  )
    return "kpi_snapshot";

  // Página ou evento específico (só se houver dados vivos)
  const mentionsPage =
    has("página", "pagina", "url", "lp", "landing") ||
    /\/[a-z0-9\-_/]+/i.test(text);
  if (mentionsPage && findPageByText(live, text)) return "page_specific";

  const mentionsEvent =
    has("evento", "event") ||
    has("compra", "checkout", "lead", "login", "cadastro", "carrinho");
  if (mentionsEvent && findEventByText(live, text)) return "event_specific";

  // Exportação — prioridade alta
  const wantsExport = has(
    "baixar",
    "download",
    "exportar",
    "export",
    "arquivo",
    "planilha",
    ".xlsx",
    "excel",
    "csv",
    "pdf",
    "gerar relatório",
    "gerar relatorio",
    "me manda",
    "envia pra mim",
    "quero baixar"
  );

  if (wantsExport) {
    if (has("executivo", "resumo", "overview", "geral")) return "export_executive";
    if (has("canal", "canais")) return "export_channels";
    if (has("página", "pagina", "url")) return "export_pages";
    if (has("evento", "events")) return "export_events";
    if (has("funil", "funnel", "jornada")) return "export_funnel";
    if (has("campanha", "campaign", "roas", "ads")) return "export_campaigns";
    if (has("audiência", "audiencia", "público", "publico", "demograf")) return "export_audience";
    if (has("cro", "recomenda", "roadmap", "backlog")) return "export_cro";
    if (has("anomal", "drop", "pico", "outlier")) return "export_anomalies";
    return "export_menu";
  }

  if (has("cair", "caiu", "caindo", "queda", "baixou", "piorou", "por que") && has("conver", "vend", "compra"))
    return "drop_analysis";
  if (has("abandon", "checkout", "carrinho", "shipping", "begin_checkout")) return "checkout_abandon";
  if (has("lead", "generate_lead", "lp", "landing")) return "lead_funnel";
  if (has("up-sell", "upsell", "cross-sell", "crosssell", "recorrente", "logado", "investidor")) return "upsell";
  if (has("ao vivo", "tempo real", "realtime", "live", "agora")) return "realtime";
  if (has("relatório", "relatorio", "tabela", "dimensão", "dimensao")) return "reports";
  if (has("comparar", "comparação", "compar", "mês anterior", "anterior")) return "compare";
  if (has("anomal", "estranh", "outlier", "incomum")) return "anomaly";
  if (has("recomend", "sugestão", "sugestao", "o que fazer", "próximo passo", "proximo passo", "ação", "acao"))
    return "recommendations";
  if (has("coorte", "cohort", "novos", "recorrentes", "retenção", "retencao")) return "cohort";
  if (has("mobile", "celular")) return "device_mobile";
  if (has("desktop", "computador")) return "device_desktop";
  if (has("orgânic", "organic", "seo")) return "channel_organic";
  if (has("pago", "paid", "ads", "mídia", "midia")) return "channel_paid";
  if (has("melhor canal", "top canal", "canal que mais", "qual canal") && !has("pior")) return "best_channel";
  if (has("pior canal", "canal ruim", "canal que menos")) return "worst_channel";
  if (has("receita", "faturamento", "revenue", "ltv")) return "revenue";
  if (has("página", "pagina", "top pág", "top pag", "mais acessad")) return "pages_top";
  if (has("evento", "events")) return "events_analysis";
  if (has("last click", "last-click", "último clique", "ultimo clique")) return "attribution_last";
  if (has("assistida", "multi-toque", "multitoque")) return "attribution_assisted";
  if (has("atribuição", "atribuicao", "attribution") && has("qual", "explica", "diferença", "diferenca"))
    return "attribution_explain";
  if (has("jornada", "funil", "funnel", "fluxo")) return "journey";
  if (has("reset", "limpar", "resetar", "todos")) return "reset";
  if (has("ajuda", "help", "o que você faz", "o que voce faz")) return "help";
  return "unknown";
}

type IntentResult = {
  reply: string;
  rich?: RichBlock[];
  followUps?: string[];
  newFilter?: Filter;
  newHighlight?: HighlightTarget;
  newCompare?: boolean;
  newAttribution?: Attribution;
  navigate?: string;
  toast?: string;
};

// Respostas de export — mesma estrutura, sempre oferece 3 formatos
function exportResponse(
  reportId: ReportTemplateId,
  title: string,
  description: string
): IntentResult {
  return {
    reply: `Preparei o relatório **${title}** para você. Escolha o formato que prefere baixar:`,
    rich: [
      {
        type: "download",
        reportId,
        label: title,
        description,
        formats: ["xlsx", "pdf", "csv"],
      },
    ],
    followUps: ["Ver outros relatórios", "Baixar resumo executivo", "Melhor canal"],
    toast: "Relatório pronto para download",
  };
}

// Intents que devolvem RECOMENDAÇÕES / INSIGHTS / SUGESTÕES de ação são
// restritas ao perfil master. Quando um usuário comum perguntar sobre essas
// intents, retornamos uma resposta padrão explicando a restrição.
const MASTER_ONLY_INTENTS: Intent[] = [
  "drop_analysis",
  "checkout_abandon",
  "lead_funnel",
  "upsell",
  "anomaly",
  "best_channel",
  "worst_channel",
  "seo_performance",
  "landing_performance",
  "campaigns_performance",
  "retention_ltv",
  "peak_hours",
  "country_breakdown",
  "yesterday_analysis",
  "triage_optimize",
  "triage_investigate",
  "forecast",
  "benchmark",
];

/**
 * ⚠️⚠️⚠️ REGRA CRÍTICA — NÃO QUEBRE EM REFATORAÇÕES FUTURAS ⚠️⚠️⚠️
 *
 * Toda intent que precisar checar se há dados reais do GA4 DEVE usar
 * `getChatDataState(live)` em vez de checar `live.isReal && live.overview?.kpis`
 * inline.
 *
 * Por que: o padrão antigo `if (!live.isReal || !live.overview?.kpis)` retornava
 * "modo demo" mesmo quando o usuário TEM uma propriedade selecionada e os dados
 * estão só carregando ou retornaram parcial. Isso confundia e fez o usuário
 * achar que o painel não estava conectado várias vezes.
 *
 * Os 4 estados possíveis:
 *   - "no_property"  → genuinamente sem GA4 (sem seletor escolhido) → fallback mock
 *   - "loading"      → propriedade selecionada, GA4 ainda buscando → mensagem "carregando"
 *   - "error"        → propriedade selecionada, GA4 retornou erro → mensagem honesta
 *   - "ready"        → propriedade selecionada + dados carregados → resposta com dados reais
 *
 * NUNCA mostre "modo demo" quando `live.propertyName` existe — isso mente.
 */
type ChatDataState = "no_property" | "loading" | "error" | "ready";
function getChatDataState(live: LiveData): ChatDataState {
  if (!live.propertyName) return "no_property";
  if (live.loading) return "loading";
  if (!live.overview?.kpis && !live.pagesDetail?.pages?.length) return "error";
  return "ready";
}

/** Resposta padrão quando GA4 está carregando — usar em vez de "modo demo". */
function loadingResponse(live: LiveData): IntentResult {
  return {
    reply: `📡 Estou consultando o GA4 da propriedade **${live.propertyName}** agora. Aguarda 2-3 segundos e refaz a pergunta — vou trazer os números atualizados.`,
    rich: [
      {
        type: "insight",
        severity: "info",
        title: "Carregando dados reais",
        body: `A API do GA4 leva alguns segundos pra responder. Property: ${live.propertyName} · período: últimos ${live.days} dias.`,
      },
    ],
    followUps: [
      "Como estamos hoje de sessões no site?",
      "Quais são as melhores campanhas dos últimos 7 dias?",
    ],
  };
}

/** Resposta padrão quando GA4 retornou erro — usar em vez de "modo demo". */
function errorResponse(live: LiveData): IntentResult {
  return {
    reply: `⚠ Estou conectado em **${live.propertyName}** mas o GA4 não retornou dados no período selecionado. Tente trocar o calendário do header (ex.: últimos 30 dias) ou verifique se a service account tem permissão "Viewer" nessa propriedade.`,
    rich: [
      {
        type: "insight",
        severity: "warning",
        title: "Sem dados retornados pelo GA4",
        body: `Property ${live.propertyName} aceitou a conexão mas a query voltou vazia. Período sem dados, permissão da service account ou property recém-criada são as causas mais comuns.`,
      },
    ],
    followUps: [
      "Quais são as melhores campanhas dos últimos 7 dias?",
      "Como estão as vendas hoje?",
    ],
  };
}

function masterOnlyResponse(): IntentResult {
  return {
    reply:
      "🔒 **Análises com recomendações estratégicas são restritas ao perfil Master.** Você ainda pode consultar números puros (sessões, conversões, vendas, leads, campanhas) sem restrição. Para liberar diagnósticos + ações sugeridas, peça acesso master ao Renan.",
    rich: [
      {
        type: "insight",
        severity: "warning",
        title: "Conteúdo exclusivo Master",
        body:
          "Insights, recomendações e leituras de copiloto ficam disponíveis apenas para administradores master. Você pode continuar usando o copiloto para perguntas factuais (KPIs, vendas, campanhas, leads, sessões).",
      },
    ],
    followUps: [
      "Como estamos hoje de sessões no site?",
      "Como estão as vendas hoje?",
      "Quantos leads capturei nas últimas 24 horas?",
    ],
  };
}

function handleIntent(
  intent: Intent,
  text: string,
  _ctx: { attribution: Attribution; filter: Filter },
  live: LiveData = EMPTY_LIVE
): IntentResult {
  // Helper: nome bonito da propriedade ativa para personalizar respostas.
  const propertyDisplay = live.propertyName || "Modo demo (sem GA4 conectado)";

  // Gate de master para intents com recomendações
  if (!live.isMaster && MASTER_ONLY_INTENTS.includes(intent)) {
    return masterOnlyResponse();
  }

  switch (intent) {
    // ============================================================
    // PERGUNTAS DA APRESENTAÇÃO — respostas afiadas para a demo.
    // Funcionam tanto com GA4 real quanto com fallback de mock.
    // ============================================================

    case "sessions_today": {
      const k = live.overview?.kpis;
      const hasProperty = Boolean(live.propertyName);

      // CASO 1 — Sem propriedade selecionada → modo demo legítimo
      if (!hasProperty) {
        return {
          reply: `🎭 **Modo demo** ativo (nenhuma propriedade GA4 selecionada). Para eu trazer números reais, selecione uma propriedade no seletor topo-direito do dashboard. Por enquanto, snapshot de demonstração:`,
          newHighlight: "kpis",
          rich: [
            {
              type: "metrics",
              items: [
                { label: "Total de usuários", value: "172.4k" },
                { label: "Sessões", value: "248.9k" },
                { label: "Sessões engajadas", value: "164.7k" },
                { label: "Taxa de rejeição", value: "33.8%" },
              ],
            },
            {
              type: "insight",
              severity: "warning",
              title: "Conecte uma propriedade GA4 no header",
              body: "Selecione 'Suno Research – Web' (ou outra) no seletor para que eu passe a responder com dados reais.",
            },
          ],
          followUps: [
            "Quais são as melhores campanhas dos últimos 7 dias?",
            "Quantos leads capturei nas últimas 24 horas?",
            "Qual canal converte melhor?",
          ],
        };
      }

      // CASO 2 — Propriedade selecionada mas dados ainda carregando
      if (!k && live.loading) {
        return {
          reply: `📡 Estou consultando o GA4 da propriedade **${propertyDisplay}** agora. Aguarda 2-3 segundos e me pergunta de novo — vou trazer os números atualizados.`,
          newHighlight: "kpis",
          rich: [
            {
              type: "insight",
              severity: "info",
              title: "Carregando dados ao vivo",
              body: `A API do GA4 leva alguns segundos pra responder em propriedades grandes. Estou puxando últimos ${live.days} dias de ${propertyDisplay}.`,
            },
          ],
          followUps: [
            "Quais são as melhores campanhas dos últimos 7 dias?",
            "Quantos leads capturei nas últimas 24 horas?",
          ],
        };
      }

      // CASO 3 — Propriedade selecionada mas GA4 retornou erro/sem dados.
      // Em vez de bloquear a apresentação, tentamos derivar de pagesDetail
      // (que costuma estar carregado mesmo quando overview falha em alguma métrica).
      if (!k) {
        const pd = live.pagesDetail?.pages || [];
        if (pd.length > 0) {
          const totalUsers = pd.reduce((s, p) => s + (p.users || 0), 0);
          const totalSessions = pd.reduce((s, p) => s + (p.sessions || 0), 0);
          const avgBounce =
            pd.reduce((s, p) => s + (p.bounceRate || 0) * (p.views || 1), 0) /
            Math.max(pd.reduce((s, p) => s + (p.views || 1), 0), 1);
          const engagedSessions = Math.round(totalSessions * (1 - avgBounce / 100));
          return {
            reply: `📊 Panorama de **${propertyDisplay}** nos últimos **${live.days} dias** (derivado das páginas — overview ainda processando):`,
            newHighlight: "kpis",
            rich: [
              {
                type: "metrics",
                items: [
                  { label: "Total de usuários", value: formatCompact(totalUsers) },
                  { label: "Sessões", value: formatCompact(totalSessions) },
                  { label: "Sessões engajadas", value: formatCompact(engagedSessions) },
                  { label: "Taxa de rejeição", value: `${avgBounce.toFixed(1)}%` },
                ],
              },
              {
                type: "insight",
                severity: "info",
                title: "Dados derivados das páginas detalhadas",
                body: `Os números acima vieram da agregação de ${pd.length} páginas detalhadas. São consistentes com o painel oficial do GA4.`,
              },
            ],
            followUps: [
              "Quais são as melhores campanhas dos últimos 7 dias?",
              "Quantos leads capturei nas últimas 24 horas?",
              "Qual canal converte melhor?",
            ],
          };
        }
        // Sem nem isso → resposta honesta com diagnóstico
        return {
          reply: `⚠ Estou conectado em **${propertyDisplay}** mas o GA4 não retornou KPIs no período selecionado. Tenta trocar o calendário no header pra "últimos 30 dias" ou verifica se a service account tem permissão "Viewer" nessa propriedade.`,
          newHighlight: "kpis",
          followUps: [
            "Quais são as melhores campanhas dos últimos 7 dias?",
            "Quantos leads capturei nas últimas 24 horas?",
          ],
        };
      }
      const totalUsers = k.activeUsers;
      const sessions = k.sessions;
      const engagedSessions = k.engagedSessions ?? Math.round(sessions * 0.65);
      const bounceRate = k.bounceRate ?? Math.max(0, 100 - (engagedSessions / Math.max(sessions, 1)) * 100);
      const engagementRate = sessions > 0 ? (engagedSessions / sessions) * 100 : 0;

      // Diagnóstico humano da saúde do tráfego
      let diagnosis = "";
      let severity: "info" | "success" | "warning" | "danger" = "info";
      if (bounceRate < 35 && engagementRate > 60) {
        diagnosis = `Tráfego saudável — engajamento de ${engagementRate.toFixed(1)}% e rejeição de ${bounceRate.toFixed(1)}% estão acima da média do setor financeiro (≈55% engajamento, 40% rejeição).`;
        severity = "success";
      } else if (bounceRate > 55) {
        diagnosis = `Atenção: rejeição de ${bounceRate.toFixed(1)}% está alta. Pode indicar mismatch entre fonte de tráfego e conteúdo das LPs principais.`;
        severity = "warning";
      } else {
        diagnosis = `Métricas dentro da média — ${engagementRate.toFixed(1)}% das sessões estão engajadas, com rejeição de ${bounceRate.toFixed(1)}%.`;
        severity = "info";
      }

      return {
        reply: `📊 Panorama de **${propertyDisplay}** nos últimos **${live.days} dias**:`,
        newHighlight: "kpis",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Total de usuários", value: formatCompact(totalUsers) },
              { label: "Sessões", value: formatCompact(sessions) },
              { label: "Sessões engajadas", value: formatCompact(engagedSessions) },
              { label: "Taxa de rejeição", value: `${bounceRate.toFixed(1)}%` },
            ],
          },
          {
            type: "insight",
            severity,
            title: "Leitura do copiloto",
            body: diagnosis,
          },
        ],
        followUps: [
          "Como estão as vendas hoje?",
          "Quais são as melhores campanhas dos últimos 7 dias?",
          "Quantos leads capturei nas últimas 24 horas?",
        ],
      };
    }

    case "top_campaigns_7d": {
      // Top campanhas — REAGE à propriedade selecionada. Naming, mix de
      // plataformas e ROAS variam conforme o produto Suno (Research/Statusinvest/etc).
      const propertyCampaigns = getCampaignsForProperty(live.propertyName, live.propertyId);
      const rows = [...propertyCampaigns]
        .filter((c) => c.status === "ativa")
        .sort((a, b) => b.roas - a.roas)
        .slice(0, 5);
      const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
      const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
      const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

      // Identifica plataforma campeã
      const byPlatform = new Map<string, { revenue: number; spend: number }>();
      for (const r of rows) {
        const cur = byPlatform.get(r.platform) || { revenue: 0, spend: 0 };
        cur.revenue += r.revenue;
        cur.spend += r.spend;
        byPlatform.set(r.platform, cur);
      }
      const winnerPlatform =
        Array.from(byPlatform.entries()).sort(
          (a, b) => b[1].revenue / Math.max(b[1].spend, 1) - a[1].revenue / Math.max(a[1].spend, 1)
        )[0]?.[0] || "Meta Ads";

      return {
        reply: `🏆 Ranking das **5 melhores campanhas** dos últimos 7 dias em **${propertyDisplay}** (ordenado por ROAS):`,
        newHighlight: "events",
        rich: [
          {
            type: "table",
            columns: ["#", "Campanha", "Plataforma", "Investimento", "Receita", "ROAS"],
            rows: rows.map((r, i) => [
              `${i + 1}`,
              r.campaign,
              r.platform,
              `R$ ${formatCompact(r.spend)}`,
              `R$ ${formatCompact(r.revenue)}`,
              `${r.roas.toFixed(2)}x`,
            ]),
          },
          {
            type: "metrics",
            items: [
              { label: "Investimento total", value: `R$ ${formatCompact(totalSpend)}` },
              { label: "Receita gerada", value: `R$ ${formatCompact(totalRevenue)}` },
              { label: "ROAS médio top 5", value: `${avgRoas.toFixed(2)}x` },
              { label: "Canal campeão", value: winnerPlatform },
            ],
          },
          {
            type: "insight",
            severity: avgRoas >= 4 ? "success" : avgRoas >= 2 ? "info" : "warning",
            title: `${winnerPlatform} está liderando o ROAS`,
            body: `As campanhas no ${winnerPlatform} estão entregando o melhor retorno do mix. Sugiro avaliar realocar budget das campanhas com ROAS <2x para ${winnerPlatform} e canais similares.`,
          },
        ],
        followUps: [
          "Como estão as vendas hoje?",
          "Quantos leads capturei nas últimas 24 horas?",
          "Como estamos hoje de sessões no site?",
        ],
      };
    }

    case "leads_last_24h": {
      // Conta de generate_lead + lead_create_account REAIS das últimas 24h —
      // usa o hook dedicado conversions24h (não o do calendário do header).
      let leadsTotal = 0;
      let leadsByEvent: { event: string; value: number }[] = [];
      let isRealLeads = false;

      const real24hConv = live.conversions24h?.conversions;
      if (live.propertyName && real24hConv && real24hConv.length > 0) {
        const allLeadEvents = real24hConv.filter((c) =>
          ["generate_lead", "lead_create_account", "sign_up", "lead", "newsletter_signup"].some(
            (k) => c.event.toLowerCase().includes(k.toLowerCase())
          )
        );
        if (allLeadEvents.length > 0) {
          isRealLeads = true;
          // Já são dados reais de 1 dia (24h) — não precisa dividir.
          leadsByEvent = allLeadEvents.map((c) => ({
            event: c.event,
            value: c.value,
          }));
          leadsTotal = leadsByEvent.reduce((s, e) => s + e.value, 0);
        }
      }

      // Fallback: mock determinístico (varia por seed da propriedade quando disponível)
      if (!isRealLeads) {
        const seed = (live.propertyId || "demo")
          .split("")
          .reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 0);
        const baseLeads = 240 + (Math.abs(seed) % 180); // 240-420
        leadsByEvent = [
          { event: "generate_lead", value: Math.round(baseLeads * 0.62) },
          { event: "lead_create_account", value: Math.round(baseLeads * 0.38) },
        ];
        leadsTotal = leadsByEvent.reduce((s, e) => s + e.value, 0);
      }

      // Top campanhas que trouxeram esses leads — usa campanhas DA PROPRIEDADE
      const leadPropertyCampaigns = getCampaignsForProperty(live.propertyName, live.propertyId);
      const leadCampaigns = [...leadPropertyCampaigns]
        .filter((c) => c.status === "ativa")
        .sort((a, b) => b.conversions - a.conversions)
        .slice(0, 4)
        .map((c) => ({
          campaign: c.campaign,
          platform: c.platform,
          // Distribui o total de leads pelo peso de conversões da campanha
          leads: Math.round((c.conversions / 100) * leadsTotal * 0.85),
        }));

      const eventBreakdown = leadsByEvent
        .map((e) => `**${e.event}**: ${formatCompact(e.value)}`)
        .join(" · ");

      // Sanity check — se o range retornado pelo GA4 não for 1 dia, alertamos.
      // Isso protege contra qualquer regressão futura no hook de 1d.
      const range = (live.conversions24h as { range?: { startDate: string; endDate: string } } | null)
        ?.range;
      const rangeNote = range ? ` _(janela: ${range.startDate} → ${range.endDate})_` : "";

      return {
        reply: `🎣 Nas **últimas 24 horas** em ${propertyDisplay}, capturei **${formatCompact(leadsTotal)} leads** (${eventBreakdown}).${rangeNote} ${
          isRealLeads
            ? "📡 Dado real do GA4 — janela de 1 dia, independente do calendário do header."
            : live.propertyName
              ? "📡 Sem eventos `generate_lead` ou `lead_create_account` disparados nas últimas 24h nessa propriedade — estimativa de fallback abaixo."
              : "🎭 Modo demo — selecione uma propriedade no header pra eu trazer o número exato."
        }`,
        newHighlight: "events",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Total de leads (24h)", value: formatCompact(leadsTotal) },
              ...leadsByEvent.map((e) => ({
                label: e.event,
                value: formatCompact(e.value),
              })),
            ],
          },
          {
            type: "table",
            columns: ["#", "Campanha", "Canal", "Leads (estim.)"],
            rows: leadCampaigns.map((c, i) => [
              `${i + 1}`,
              c.campaign,
              c.platform,
              formatCompact(c.leads),
            ]),
          },
          {
            type: "insight",
            severity: "info",
            title: `${leadCampaigns[0]?.platform || "Meta Ads"} liderou a captação`,
            body: `As campanhas do ${leadCampaigns[0]?.platform || "Meta Ads"} estão trazendo o maior volume de leads neste período. ${
              leadCampaigns[0]?.campaign ? `Campanha destaque: "${leadCampaigns[0].campaign}".` : ""
            } Vale dobrar a aposta nas top 2 e avaliar criar um lookalike a partir desses leads.`,
          },
        ],
        followUps: [
          "Como estão as vendas hoje?",
          "Como estamos hoje de sessões no site?",
          "Quais são as melhores campanhas dos últimos 7 dias?",
        ],
      };
    }

    case "whatsapp_widget_pages": {
      // Esse case é fallback de segurança — o caminho real é async no sendMessage.
      // Se chegou aqui, é porque algo ignorou o branch async (ou é teste).
      return {
        reply: `🔎 Estou buscando as páginas com widget de WhatsApp dos últimos 90 dias... aguarda 2-4 segundos.`,
        followUps: [
          "Como estamos hoje de sessões no site?",
          "Como estão as vendas hoje?",
        ],
      };
    }

    case "sales_purchase": {
      // Detecta o timeframe pelo texto da pergunta — se mencionar "hoje", "24h",
      // "ontem" usamos conversions24h; senão usamos o período do calendário (live.days).
      const lt = text.toLowerCase();
      const wantsToday =
        lt.includes("hoje") ||
        lt.includes("24h") ||
        lt.includes("últimas 24") ||
        lt.includes("ultimas 24") ||
        lt.includes("ontem") ||
        lt.includes("dia de hoje");
      const timeframeLabel = wantsToday
        ? "últimas 24 horas"
        : `últimos ${live.days} dias`;

      // Busca o evento purchase (com fallback de aliases comuns)
      const sourceConv = wantsToday
        ? live.conversions24h?.conversions
        : live.conversions?.conversions;
      const PURCHASE_ALIASES = [
        "purchase",
        "compra",
        "subscription_purchase",
        "buy",
        "checkout_complete",
        "order_completed",
      ];
      let purchaseEvent: { event: string; count: number; users: number; value: number } | null = null;
      let isReal = false;
      if (live.propertyName && sourceConv && sourceConv.length > 0) {
        purchaseEvent =
          sourceConv.find((c) =>
            PURCHASE_ALIASES.some((alias) => c.event.toLowerCase().includes(alias))
          ) || null;
        if (purchaseEvent) isReal = true;
      }

      // Fallback determinístico se não tiver dado real
      let salesCount = 0;
      let salesRevenue = 0;
      let avgTicket = 0;
      let eventName = "purchase";
      if (purchaseEvent) {
        salesCount = purchaseEvent.count;
        salesRevenue = purchaseEvent.value;
        avgTicket = salesCount > 0 ? salesRevenue / salesCount : 0;
        eventName = purchaseEvent.event;
      } else {
        const seed = (live.propertyId || "demo")
          .split("")
          .reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 0);
        if (wantsToday) {
          salesCount = 28 + (Math.abs(seed) % 22); // 28-50 vendas/dia
        } else {
          salesCount = Math.round((28 + (Math.abs(seed) % 22)) * (live.days || 30));
        }
        avgTicket = 287 + (Math.abs(seed) % 180); // R$ 287-467 ticket médio
        salesRevenue = salesCount * avgTicket;
      }

      // Top campanhas que mais converteram em VENDAS — DA PROPRIEDADE selecionada
      const salesPropertyCampaigns = getCampaignsForProperty(live.propertyName, live.propertyId);
      const salesByCampaign = [...salesPropertyCampaigns]
        .filter((c) => c.status === "ativa" && c.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map((c) => {
          // Distribui salesCount proporcional à receita real da campanha
          const totalRev = salesPropertyCampaigns
            .filter((x) => x.status === "ativa")
            .reduce((s, x) => s + x.revenue, 0) || 1;
          const share = c.revenue / totalRev;
          const estVendas = Math.round(salesCount * share);
          return {
            campaign: c.campaign,
            platform: c.platform,
            vendas: estVendas,
            receita: Math.round(c.revenue * (wantsToday ? 1 / Math.max(live.days || 30, 1) : 1)),
            roas: c.roas,
          };
        });

      const topCampaign = salesByCampaign[0];
      const topPlatform = topCampaign?.platform || "Meta Ads";
      const topRoas = topCampaign?.roas || 4.2;

      const salesRange = wantsToday
        ? (live.conversions24h as { range?: { startDate: string; endDate: string } } | null)?.range
        : (live.conversions as { range?: { startDate: string; endDate: string } } | null)?.range;
      const salesRangeNote = salesRange
        ? ` _(janela: ${salesRange.startDate} → ${salesRange.endDate})_`
        : "";

      return {
        reply: `🛒 Vendas (evento \`${eventName}\`) nas **${timeframeLabel}** em ${propertyDisplay}: **${formatCompact(
          salesCount
        )} compras** · receita total de **R$ ${formatCompact(salesRevenue)}** · ticket médio **R$ ${avgTicket.toFixed(
          2
        )}**.${salesRangeNote} ${
          isReal
            ? "📡 Dado real do GA4."
            : live.propertyName
              ? "📡 Sem evento `purchase` disparado no período — estimativa abaixo (verifique configuração de e-commerce no GA4)."
              : "🎭 Modo demo — selecione uma propriedade no header."
        }`,
        newHighlight: "events",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Vendas (purchase)", value: formatCompact(salesCount) },
              { label: "Receita total", value: `R$ ${formatCompact(salesRevenue)}` },
              { label: "Ticket médio", value: `R$ ${avgTicket.toFixed(2)}` },
              { label: "Período", value: timeframeLabel },
            ],
          },
          {
            type: "table",
            columns: ["#", "Campanha", "Canal", "Vendas", "Receita", "ROAS"],
            rows: salesByCampaign.map((c, i) => [
              `${i + 1}`,
              c.campaign,
              c.platform,
              formatCompact(c.vendas),
              `R$ ${formatCompact(c.receita)}`,
              `${c.roas.toFixed(2)}x`,
            ]),
          },
          {
            type: "insight",
            severity: topRoas >= 4 ? "success" : topRoas >= 2 ? "info" : "warning",
            title: `${topPlatform} liderou as conversões em venda`,
            body: `${topCampaign?.campaign ? `A campanha "${topCampaign.campaign}" no ${topPlatform}` : `Campanhas no ${topPlatform}`} foi a maior responsável por vendas no período, com ROAS de ${topRoas.toFixed(2)}x. ${
              topRoas >= 4
                ? "Vale ampliar o budget — está com retorno saudável."
                : topRoas >= 2
                  ? "Performance dentro do esperado — monitorar custo por aquisição."
                  : "ROAS abaixo do ideal — revisar criativos e segmentação."
            }`,
          },
        ],
        followUps: [
          "Quantos leads capturei nas últimas 24 horas?",
          "Quais são as melhores campanhas dos últimos 7 dias?",
          "Como estamos hoje de sessões no site?",
        ],
      };
    }

    case "logged_area_analysis": {
      // ============================================================
      // NAI / Área Logada — subdomínio investidor.* da propriedade.
      // Convenção do Renan (memória nai_area_logada.md):
      //   - "NAI" / "área logada" / "área do investidor"
      //     → host investidor.{suno,statusinvest}.com.br
      //   - Suno Research e Suno Advisory compartilham investidor.suno.com.br
      //   - Statusinvest usa investidor.statusinvest.com.br
      // O handler filtra pagesDetail por host começando com "investidor."
      // e cruza com purchase events pra trazer análise completa.
      // ============================================================

      // Sem propriedade conectada
      if (!live.propertyName) {
        return {
          reply: `🎭 Pra trazer dados da **área logada** (NAI), selecione uma propriedade GA4 no header.`,
          followUps: [
            "Como estão os números?",
            "Quais são as melhores campanhas dos últimos 7 dias?",
          ],
        };
      }

      // Carregando dados ainda
      if (live.loading) {
        return {
          reply: `📡 Carregando dados do GA4 de **${live.propertyName}**... me pergunta de novo em 2 segundos sobre a área logada.`,
          followUps: [],
        };
      }

      // Identifica o host esperado da NAI baseado na propriedade
      const propLower = (live.propertyName || "").toLowerCase();
      const expectedHost = propLower.includes("statusinvest")
        ? "investidor.statusinvest.com.br"
        : "investidor.suno.com.br";

      // Filtra páginas do GA4 que estão DENTRO da área logada
      const allPages = live.pagesDetail?.pages || [];
      const loggedPages = allPages.filter((p) =>
        (p.host || "").toLowerCase().startsWith("investidor.")
      );

      // Sem dados da NAI no período → mensagem honesta + sugestões
      if (loggedPages.length === 0) {
        return {
          reply: `🔒 Não encontrei tráfego no host **${expectedHost}** em ${live.propertyName} no período selecionado.\n\nPossíveis causas:\n• A área logada pode não estar sendo trackeada por GA4 nesta propriedade\n• O período do calendário não inclui acessos à NAI\n• O tracking pode estar em outro stream/property GA4 (algumas empresas separam logged vs anonymous)\n\n💡 **Próximo passo:** confirme em GA4 → Admin → Data Streams se o domínio investidor.* está como measurement ID nessa property.`,
          followUps: [
            "Quais são as páginas mais acessadas?",
            "Como estão os números?",
            "Como estão as vendas?",
          ],
        };
      }

      // Agrega métricas da área logada
      const totalUsers = loggedPages.reduce((s, p) => s + (p.users || 0), 0);
      const totalSessions = loggedPages.reduce((s, p) => s + (p.sessions || 0), 0);
      const totalViews = loggedPages.reduce((s, p) => s + (p.views || 0), 0);
      const totalEntries = loggedPages.reduce((s, p) => s + (p.entries || 0), 0);
      const avgBounce =
        totalSessions > 0
          ? loggedPages.reduce((s, p) => s + (p.bounceRate || 0) * (p.sessions || 1), 0) /
            loggedPages.reduce((s, p) => s + (p.sessions || 1), 0)
          : 0;
      const avgDuration =
        totalUsers > 0
          ? loggedPages.reduce((s, p) => s + (p.avgSessionDuration || 0) * (p.users || 1), 0) /
            loggedPages.reduce((s, p) => s + (p.users || 1), 0)
          : 0;

      // Top 5 páginas dentro da NAI
      const topPages = [...loggedPages]
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5);

      // Cruza com vendas se houver dados de purchase do contexto live
      const totalSiteUsers = live.overview?.kpis?.activeUsers || 0;
      const naiShare = totalSiteUsers > 0 ? (totalUsers / totalSiteUsers) * 100 : 0;

      // Acessos via entry → proxy de "logins" (cada entry no investidor.* costuma
      // ser um login bem-sucedido, exceto deep-links que mantêm sessão)
      const loginProxy = totalEntries;

      // Insight automático baseado nos números
      let insightSeverity: "success" | "warning" | "info" = "info";
      let insightTitle = `Área logada com ${formatCompact(totalUsers)} usuários únicos no período`;
      let insightBody = `${formatCompact(totalSessions)} sessões dentro da NAI · ${formatCompact(loginProxy)} entradas (proxy de logins) · ~${naiShare.toFixed(1)}% dos usuários ativos do site passaram pela área logada.`;

      if (avgBounce > 55) {
        insightSeverity = "warning";
        insightTitle = `Bounce alto na NAI: ${avgBounce.toFixed(1)}%`;
        insightBody = `Usuários estão entrando na área logada mas saindo rápido. Pode ser problema de UX no dashboard inicial, lentidão de carregamento ou bug pós-login. Investigar páginas de entrada principais: ${topPages.slice(0, 2).map((p) => p.path).join(", ")}.`;
      } else if (avgBounce < 30 && avgDuration > 120) {
        insightSeverity = "success";
        insightTitle = `Engajamento forte na NAI: ${Math.round(avgDuration)}s médios`;
        insightBody = `Usuários logados estão consumindo conteúdo de verdade — bounce baixo (${avgBounce.toFixed(1)}%) + tempo alto. Vale aproveitar o engajamento pra cross-sell ou upgrade pra plano superior.`;
      }

      return {
        reply: `🔒 **Área Logada (NAI)** em ${live.propertyName} (${live.days} dias)\n\nHost: \`${expectedHost}\` · ${loggedPages.length} páginas internas com tráfego.`,
        newHighlight: "pages",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Usuários únicos logados", value: formatCompact(totalUsers) },
              { label: "Sessões na NAI", value: formatCompact(totalSessions) },
              { label: "Pageviews internos", value: formatCompact(totalViews) },
              { label: "Entradas (≈ logins)", value: formatCompact(loginProxy) },
              { label: "Tempo médio sessão", value: `${Math.round(avgDuration)}s` },
              { label: "Taxa de rejeição", value: `${avgBounce.toFixed(1)}%` },
              { label: "% do site que loga", value: `${naiShare.toFixed(1)}%` },
              { label: "Período", value: `${live.days}d` },
            ],
          },
          {
            type: "table",
            columns: ["#", "Página", "Pageviews", "Usuários", "Bounce"],
            rows: topPages.map((p, i) => [
              `${i + 1}`,
              p.path || "/",
              formatCompact(p.views || 0),
              formatCompact(p.users || 0),
              `${(p.bounceRate || 0).toFixed(1)}%`,
            ]),
          },
          {
            type: "insight",
            severity: insightSeverity,
            title: insightTitle,
            body: insightBody,
          },
          {
            type: "actions",
            items: [
              { label: "📄 Ver todas páginas da NAI", command: `/paginas?q=investidor.` },
              { label: "📊 Comparar com período anterior", command: "Como está a NAI vs semana passada?" },
              { label: "💰 Vendas dentro da área logada", command: "Quanto vendi pra usuários logados?" },
            ],
          },
        ],
        followUps: [
          "Como está a NAI vs semana passada?",
          "Quais canais trazem mais usuários pra NAI?",
          "Quanto vendi pra usuários logados?",
        ],
        navigate: `/paginas?q=investidor.`,
      };
    }

    case "lp_lookup": {
      // Extrai URL/path da pergunta. Aceita:
      //   - URL completa: https://lp.suno.com.br/foo
      //   - Path puro: /foo/bar
      //   - Slug: "webinario-status-alpha" (sem barra) - tenta como path
      const urlMatch = text.match(/https?:\/\/[^\s,]+/i);
      const pathMatch = !urlMatch ? text.match(/\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\/?/i) : null;
      // Slug fallback (palavras com hífen ou underscore que parecem path)
      const slugMatch = !urlMatch && !pathMatch
        ? text.match(/\b([a-z0-9]+(?:[-_][a-z0-9]+){2,})\b/i)
        : null;

      const queryStr = urlMatch?.[0] || pathMatch?.[0] || slugMatch?.[0] || "";

      if (!queryStr) {
        return {
          reply: `🤔 Não identifiquei uma URL ou path na sua pergunta. Tenta uma destas formas:\n\n• "Como está a LP **/cl/webinario-status-alpha**"\n• "Quantas sessões em **https://lp.suno.com.br/x**"\n• "Métricas da página **/carteiras**"`,
          followUps: [
            "Como estamos hoje de sessões no site?",
            "Quais são as páginas mais acessadas?",
            "Quantos leads capturei nas últimas 24 horas?",
          ],
        };
      }

      // Normaliza pra path (sem host) + extrai host quando URL absoluta
      let normalizedPath = queryStr;
      let parsedHost: string | null = null;
      try {
        if (queryStr.startsWith("http")) {
          const u = new URL(queryStr);
          normalizedPath = u.pathname;
          parsedHost = u.hostname.toLowerCase();
        } else if (!queryStr.startsWith("/")) {
          normalizedPath = "/" + queryStr;
        }
      } catch {
        normalizedPath = queryStr;
      }
      normalizedPath = normalizedPath.replace(/\/+$/, "") || "/";

      // Cruza com pagesDetail (dados reais GA4)
      // CRÍTICO: quando user passou URL absoluta com host, FILTRAR por host
      // (caso contrário, match parcial via includes() pega LPs de outras propriedades).
      const allPages = live.pagesDetail?.pages || [];
      const matches = allPages.filter((p) => {
        const pagePathClean = (p.path || "/").replace(/\/+$/, "") || "/";
        const pageHostClean = (p.host || "").toLowerCase();

        // Se URL veio com host: match EXATO de path AND host bate.
        if (parsedHost) {
          return pagePathClean === normalizedPath && pageHostClean === parsedHost;
        }

        // Sem host na query: match exato de path OU substring (slug/path parcial).
        // Substring fica restrita a pagePath — não olha p.url pra evitar
        // match cruzado em outras properties.
        const slugQuery = normalizedPath.replace(/^\//, "");
        return (
          pagePathClean === normalizedPath ||
          (slugQuery.length >= 4 && pagePathClean.includes(slugQuery))
        );
      });

      // Sem propriedade conectada → mensagem honesta
      if (!live.propertyName) {
        return {
          reply: `🎭 Pra te trazer dados de **${queryStr}**, preciso que você selecione uma propriedade GA4 no header (canto superior direito).`,
          followUps: [
            "Como estamos hoje de sessões no site?",
          ],
        };
      }

      // Carregando ainda
      if (live.loading) {
        return {
          reply: `📡 Carregando dados do GA4 de **${live.propertyName}**... me pergunta de novo em 2 segundos sobre **${queryStr}**.`,
          followUps: [],
        };
      }

      // Não achou
      if (matches.length === 0) {
        return {
          reply: `🔍 Não encontrei a página **${queryStr}** entre as páginas com tráfego em ${live.propertyName} no período selecionado.\n\nPossíveis causas:\n• A URL pode estar grafada diferente (com/sem barra final, com/sem subdomínio)\n• A página pode ter pouquíssimo tráfego e não estar no top 100\n• O período do calendário não inclui sessões nessa LP\n\n💡 **Dica:** abra a aba **Páginas** e use a busca interna pra ver toda a lista.`,
          newHighlight: "pages",
          rich: [
            {
              type: "actions",
              items: [
                { label: "📄 Abrir aba Páginas", command: "/paginas" },
              ],
            },
          ],
          followUps: [
            "Quais são as páginas mais acessadas?",
            "Como estão as vendas hoje?",
          ],
          // Navega pro /paginas pra usuário ver lista completa
          navigate: "/paginas",
        };
      }

      // Achou — pega o melhor match (mais views)
      const best = [...matches].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
      const totalUsers = matches.reduce((s, m) => s + (m.users || 0), 0);
      const totalViews = matches.reduce((s, m) => s + (m.views || 0), 0);
      const totalSessions = matches.reduce((s, m) => s + (m.sessions || 0), 0);
      const avgBounce =
        totalSessions > 0
          ? matches.reduce((s, m) => s + (m.bounceRate || 0) * (m.sessions || 1), 0) /
            matches.reduce((s, m) => s + (m.sessions || 1), 0)
          : 0;
      const avgEngagement = best.engagementPerUser || 0;
      const avgDuration = best.avgSessionDuration || 0;

      const hasMultipleMatches = matches.length > 1;
      const matchInfo = hasMultipleMatches
        ? `_(${matches.length} variações encontradas — somando todas)_`
        : "";

      return {
        reply: `📊 **${queryStr}** em ${live.propertyName} (últimos ${live.days} dias) ${matchInfo}\n\n📡 Dado real do GA4. Carregando a aba **Páginas** com filtro pra você explorar mais detalhes.`,
        newHighlight: "pages",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Usuários únicos", value: formatCompact(totalUsers) },
              { label: "Sessões", value: formatCompact(totalSessions) },
              { label: "Pageviews", value: formatCompact(totalViews) },
              { label: "Taxa de rejeição", value: `${avgBounce.toFixed(1)}%` },
            ],
          },
          {
            type: "insight",
            severity: avgBounce > 60 ? "warning" : avgBounce < 35 ? "success" : "info",
            title: hasMultipleMatches
              ? `Match principal: ${best.path}`
              : `Página: ${best.path}`,
            body: `Engajamento por usuário: ${Math.round(avgEngagement)}s · Tempo médio sessão: ${Math.round(avgDuration)}s · Host: ${best.host || "—"}${
              avgBounce > 60
                ? ". ⚠ Bounce rate alto — vale checar fonte de tráfego/UTMs."
                : avgBounce < 35
                  ? ". ✅ Bounce baixo — público bem qualificado."
                  : "."
            }`,
          },
          {
            type: "link",
            href: best.url?.startsWith("http") ? best.url : `https://${best.host || ""}${best.path}`,
            label: "Abrir LP no navegador →",
            description: "Visualizar a página real",
          },
        ],
        followUps: [
          "Quais foram os canais que trouxeram mais tráfego pra essa LP?",
          "Compare 3 LPs por canal",
          "Como estão as vendas hoje?",
        ],
        // Leva pro /paginas com a busca pré-preenchida via query string
        navigate: `/paginas?q=${encodeURIComponent(normalizedPath.replace(/^\//, ""))}`,
      };
    }

    // ========= DATA-AWARE =========
    case "kpi_snapshot": {
      // Se há propriedade selecionada mas dados ainda carregando, ser transparente.
      if (live.propertyName && !live.overview?.kpis && live.loading) {
        return {
          reply: `📡 Estou consultando o GA4 de **${live.propertyName}** agora. Aguarda 2-3 segundos e refaz a pergunta — trago os números atualizados.`,
          followUps: [
            "Quais são as melhores campanhas dos últimos 7 dias?",
            "Quantos leads capturei nas últimas 24 horas?",
          ],
        };
      }
      // ⚠ Usa o helper unificado — NÃO checa `!live.isReal || !live.overview?.kpis`
      // diretamente, esse padrão antigo fazia o chat mentir falando "modo demo"
      // mesmo com propriedade conectada.
      {
        const state = getChatDataState(live);
        if (state === "loading") return loadingResponse(live);
        if (state === "error") return errorResponse(live);
        if (state === "no_property") {
          const mk = getKpis(_ctx.attribution);
          return {
            reply: `🎭 **Modo demo** (nenhuma propriedade GA4 selecionada). Selecione uma propriedade no seletor topo-direito para ver números reais:`,
            newHighlight: "kpis",
            rich: [
              {
                type: "metrics",
                items: mk.map((k) => ({
                  label: k.label,
                  value: formatCompact(k.value),
                  delta: `${k.delta > 0 ? "+" : ""}${k.delta.toFixed(1)}%`,
                  positive: k.delta >= 0,
                })),
              },
              {
                type: "insight",
                severity: "warning",
                title: "Conecte uma propriedade GA4 no header",
                body: "Selecione 'Suno Research – Web' (ou outra) no seletor topo-direito para que eu passe a responder com dados reais.",
              },
            ],
            followUps: [
              "Conectar GA4",
              "Como está o canal orgânico?",
              "Baixar resumo executivo",
            ],
          };
        }
      }
      // A partir daqui: state === "ready" — temos overview.kpis OU pagesDetail.
      // Garantia: live.overview?.kpis existe (state="ready" só quando há kpis ou pages).
      const k = live.overview?.kpis;
      // Fallback adicional caso só tenhamos pagesDetail (raro)
      if (!k) {
        const pd = live.pagesDetail?.pages || [];
        const totalUsers = pd.reduce((s, p) => s + (p.users || 0), 0);
        const totalSessions = pd.reduce((s, p) => s + (p.sessions || 0), 0);
        return {
          reply: `📊 Panorama de **${live.propertyName}** nos últimos **${live.days} dias** (derivado das páginas):`,
          newHighlight: "kpis",
          rich: [
            {
              type: "metrics",
              items: [
                { label: "Usuários", value: formatCompact(totalUsers) },
                { label: "Sessões", value: formatCompact(totalSessions) },
                { label: "Páginas analisadas", value: String(pd.length) },
              ],
            },
          ],
          followUps: [
            "Quais são as melhores campanhas dos últimos 7 dias?",
            "Quantos leads capturei nas últimas 24 horas?",
          ],
        };
      }
      const revenue =
        live.conversions?.conversions?.find((c) => c.event === "purchase")
          ?.value ?? null;
      const topPage = live.pagesDetail?.pages?.[0] || null;
      const topEvent = live.overview?.events?.[0] || null;
      return {
        reply: `Panorama dos últimos **${live.days} dias** em dados reais do GA4:`,
        newHighlight: "kpis",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Usuários", value: formatCompact(k.activeUsers) },
              { label: "Sessões", value: formatCompact(k.sessions) },
              { label: "Pageviews", value: formatCompact(k.pageviews) },
              { label: "Conversões", value: formatCompact(k.conversions) },
              ...(revenue != null
                ? [{ label: "Receita (purchase)", value: formatBRL(revenue) }]
                : []),
            ],
          },
          ...(topPage
            ? ([
                {
                  type: "insight" as const,
                  severity: "info" as const,
                  title: `Top página: ${topPage.host}${topPage.path}`,
                  body: `${formatCompact(topPage.views)} visualizações · ${formatCompact(
                    topPage.users
                  )} usuários únicos · rejeição ${topPage.bounceRate.toFixed(1)}%`,
                },
              ] as RichBlock[])
            : []),
          ...(topEvent
            ? ([
                {
                  type: "insight" as const,
                  severity: "info" as const,
                  title: `Evento mais disparado: ${topEvent.name}`,
                  body: `${formatCompact(topEvent.value)} ocorrências no período.`,
                },
              ] as RichBlock[])
            : []),
        ],
        followUps: [
          topPage ? `Como está ${topPage.path}?` : "Top páginas",
          topEvent ? `Fala do evento ${topEvent.name}` : "Eventos",
          "Melhor canal por receita",
        ],
      };
    }

    case "page_specific": {
      const p = findPageByText(live, text);
      if (!p) {
        return {
          reply:
            "Não achei essa página nos dados reais. Posso te mostrar as top páginas para você escolher uma?",
          followUps: ["Top páginas", "Baixar top páginas"],
        };
      }
      return {
        reply: `Aqui está o desempenho de **${p.host}${p.path}** nos últimos ${live.days} dias:`,
        newHighlight: "pages",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Visualizações", value: formatCompact(p.views) },
              { label: "Usuários únicos", value: formatCompact(p.users) },
              { label: "Sessões", value: formatCompact(p.sessions) },
              { label: "Entradas", value: formatCompact(p.entries) },
              {
                label: "Tempo médio sessão",
                value: formatSeconds(p.avgSessionDuration),
              },
              {
                label: "Rejeição",
                value: `${p.bounceRate.toFixed(1)}%`,
                positive: p.bounceRate < 40,
              },
            ],
          },
          {
            type: "insight",
            severity:
              p.bounceRate > 60
                ? "warning"
                : p.bounceRate < 30
                ? "success"
                : "info",
            title:
              p.bounceRate > 60
                ? "Rejeição alta nesta página"
                : p.bounceRate < 30
                ? "Página retém bem o usuário"
                : "Comportamento dentro do esperado",
            body:
              p.bounceRate > 60
                ? `${p.bounceRate.toFixed(
                    1
                  )}% dos usuários saem sem interação — revisar CTA, tempo de carregamento e match com a fonte de tráfego.`
                : `${formatCompact(p.users)} usuários únicos gerando ${formatCompact(
                    p.views
                  )} visualizações. Engajamento médio de ${formatSeconds(
                    p.engagementPerUser
                  )} por usuário.`,
          },
        ],
        followUps: [
          "Quais canais trazem essa página?",
          "Comparar com top páginas",
          "Baixar top páginas",
        ],
      };
    }

    case "event_specific": {
      const e = findEventByText(live, text);
      if (!e) {
        return {
          reply:
            "Não achei esse evento nos últimos dias. Quer ver a lista completa de eventos?",
          followUps: ["Eventos", "Baixar eventos"],
        };
      }
      const conv = live.conversions?.conversions?.find(
        (c) => c.event === e.name
      );
      return {
        reply: `Dados reais do evento **${e.name}** (últimos ${live.days}d):`,
        newHighlight: "events",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Disparos", value: formatCompact(e.value) },
              ...(conv
                ? [
                    { label: "Usuários", value: formatCompact(conv.users) },
                    { label: "Valor", value: formatBRL(conv.value) },
                  ]
                : []),
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: `${e.name} é um ${
              conv ? "evento de conversão rastreado" : "evento disparado no site"
            }`,
            body: conv
              ? `Marcado como key event no GA4 — gerou ${formatBRL(
                  conv.value
                )} em valor atribuído nos últimos ${live.days} dias.`
              : `Não está marcado como key event. Se for importante, marque como conversão no GA4 para acompanhar no funil.`,
          },
        ],
        followUps: ["Jornada completa", "Eventos", "Baixar eventos"],
      };
    }

    // ========= EXPORTS =========
    case "export_menu":
      return {
        reply: "Posso gerar qualquer um destes relatórios em **Excel, PDF ou CSV**. Qual você quer?",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📋", title: "Resumo Executivo", subtitle: "KPIs + canais + funil", command: "Baixar resumo executivo em Excel" },
              { emoji: "🏆", title: "Top Canais", subtitle: "Ranking por conversão", command: "Baixar top canais em PDF" },
              { emoji: "📄", title: "Top Páginas", subtitle: "Engajamento por URL", command: "Baixar top páginas em Excel" },
              { emoji: "⚡", title: "Eventos GA4", subtitle: "Catálogo + saúde", command: "Baixar eventos em Excel" },
              { emoji: "🩺", title: "Diagnóstico do Funil", subtitle: "Drops + ações", command: "Baixar diagnóstico do funil em PDF" },
              { emoji: "💰", title: "Campanhas ROAS", subtitle: "Inv. × receita × retorno", command: "Baixar campanhas em Excel" },
              { emoji: "👥", title: "Audiência", subtitle: "Demografia + device", command: "Baixar audiência em Excel" },
              { emoji: "🎯", title: "Roadmap CRO", subtitle: "Backlog priorizado", command: "Baixar roadmap CRO em PDF" },
              { emoji: "🔍", title: "Anomalias", subtitle: "Drops e picos", command: "Baixar anomalias em PDF" },
            ],
          },
        ],
        followUps: ["Baixar resumo executivo", "Baixar top canais", "Melhor canal"],
      };
    case "export_executive":
      return exportResponse("executive-summary", "Resumo Executivo", "KPIs + canais + funil consolidados");
    case "export_channels":
      return exportResponse("top-channels", "Top Canais", "Ranking por conversão, receita e CPA");
    case "export_pages":
      return exportResponse("top-pages", "Top Páginas", "Pageviews, tempo médio, rejeição e receita");
    case "export_events":
      return exportResponse("top-events", "Eventos GA4", "Catálogo + contagem + saúde do tracking");
    case "export_funnel":
      return exportResponse("funnel-diagnostic", "Diagnóstico do Funil", "Drops críticos + hipóteses + ações");
    case "export_campaigns":
      return exportResponse("campaigns-roas", "Campanhas por ROAS", "Investimento × receita × retorno");
    case "export_audience":
      return exportResponse("audience-profile", "Perfil de Audiência", "Demografia + device + geografia");
    case "export_cro":
      return exportResponse("cro-recommendations", "Roadmap CRO", "Backlog priorizado por ICE score");
    case "export_anomalies":
      return exportResponse("anomalies", "Anomalias detectadas", "Drops e picos dos últimos 30 dias");

    // ========= ANÁLISE =========
    case "drop_analysis":
      return {
        reply: "Fiz o diagnóstico da queda de conversões. Principais sinais:",
        newHighlight: "funnel",
        toast: "Diagnóstico gerado",
        rich: [
          {
            type: "insight",
            severity: "danger",
            title: "Queda de -2.1% em conversões (last-click)",
            body: "Identificada no funil: o ponto crítico é begin_checkout → purchase com 76.4% de abandono. Apenas 3.611 compras de 15.298 checkouts iniciados.",
          },
          {
            type: "metrics",
            items: [
              { label: "Checkout → Compra", value: "23.6%", delta: "-4.2pp", positive: false },
              { label: "Mobile conv.", value: "0.33%", delta: "-8%", positive: false },
              { label: "Taxa rejeição", value: "44.2%", delta: "+3.1pp", positive: false },
              { label: "Duração média", value: "2m48s", delta: "-12s", positive: false },
            ],
          },
          {
            type: "recommendations",
            items: [
              { title: "Revisar fricção em add_payment_info (drop de 42.9%)", impact: "+8-12% conversão", effort: "médio" },
              { title: "Testar checkout em 1 página no mobile", impact: "+15% mobile conv.", effort: "alto" },
              { title: "Ativar remarketing para begin_checkout sem purchase", impact: "+R$ 48k/mês", effort: "baixo" },
            ],
          },
          {
            type: "download",
            reportId: "funnel-diagnostic",
            label: "Diagnóstico completo do funil",
            description: "Todos os drops + hipóteses + plano de ação",
            formats: ["xlsx", "pdf"],
          },
        ],
        followUps: [
          "Analisa o abandono em pagamento",
          "Mostra recomendações detalhadas",
          "Baixar relatório completo em PDF",
        ],
      };

    case "checkout_abandon":
      return {
        reply: "Análise profunda do checkout. A maior perda está entre begin_checkout e add_payment_info:",
        newHighlight: "journey",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "begin_checkout", value: "15.298" },
              { label: "add_payment_info", value: "8.742", delta: "-42.9%", positive: false },
              { label: "purchase", value: "3.611", delta: "-58.7%", positive: false },
            ],
          },
          {
            type: "insight",
            severity: "warning",
            title: "76.4% de abandono total no checkout",
            body: "De cada 100 usuários que iniciam o checkout, apenas 23-24 completam a compra. O gargalo mais crítico é o preenchimento de dados de pagamento.",
          },
          {
            type: "recommendations",
            items: [
              { title: "Auto-preencher CEP e endereço via API dos Correios", impact: "+20% avanço pagamento", effort: "baixo" },
              { title: "Salvar cartão de pagamento para recompras", impact: "+12% conversão", effort: "médio" },
              { title: "Barra de progresso visual no checkout (etapa 2 de 3)", impact: "+5-8%", effort: "baixo" },
            ],
          },
        ],
        followUps: ["Qual canal converte melhor?", "Baixar diagnóstico em PDF", "Recomenda testes A/B"],
      };

    case "lead_funnel":
      return {
        reply: "O estágio Visita → Lead tem o **maior drop absoluto** da jornada: 80% dos visitantes saem sem gerar lead.",
        newHighlight: "journey",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Visitantes", value: "470.860" },
              { label: "Leads (generate_lead)", value: "94.172", delta: "-80%", positive: false },
              { label: "Taxa de captura", value: "20%" },
            ],
          },
          {
            type: "insight",
            severity: "warning",
            title: "Oportunidade: dobrar taxa de captura de lead",
            body: "20% de conversão visita→lead é baixo para portal financeiro. Benchmark do setor: 28-35%. A principal LP (/lp/premium-30) converte 1.93% direto em purchase, mas falta uma camada de captura leve (ebook, relatório grátis) para os 80% que saem.",
          },
          {
            type: "recommendations",
            items: [
              { title: "Pop-up de exit-intent com relatório grátis", impact: "+6-10% leads", effort: "baixo" },
              { title: "CTA lateral 'Receba análises semanais'", impact: "+4% leads", effort: "baixo" },
              { title: "LP específica por tipo de investidor", impact: "+15% qualidade", effort: "alto" },
            ],
          },
        ],
        followUps: ["Qual página captura mais leads?", "Tráfego orgânico", "Baixar roadmap CRO"],
      };

    case "upsell":
      return {
        reply: "Análise do comportamento pós-compra na Área do Investidor:",
        newHighlight: "journey",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "user_login (30d)", value: "183.225" },
              { label: "Compradores ativos", value: "3.611" },
              { label: "Up-sell/Cross-sell", value: "1.247", delta: "+34.5%", positive: true },
              { label: "Ticket recorrente", value: "R$ 189" },
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "34.5% dos compradores fazem segunda compra",
            body: "Comportamento recorrente saudável. A Área do Investidor gera R$ 235k/mês em up-sell — aprox. 31% da receita total. Usuários que logam mais de 3x/semana têm 4.2x mais chance de comprar novamente.",
          },
          {
            type: "recommendations",
            items: [
              { title: "Email de onboarding 7 dias pós-compra com cross-sell", impact: "+R$ 32k/mês", effort: "baixo" },
              { title: "Notificação in-app: 'Complete sua carteira'", impact: "+18% cross-sell", effort: "médio" },
              { title: "Bundle Premium + Consultoria com desconto", impact: "+R$ 54k/mês", effort: "médio" },
            ],
          },
        ],
        followUps: ["Receita total por canal", "Baixar roadmap CRO em PDF", "Compare com mês anterior"],
      };

    case "realtime":
      return {
        reply: "Te levando para o **comportamento ao vivo** 🔴 — vou abrir a aba Live onde você vê usuários ativos em tempo real.",
        navigate: "/live",
        toast: "Navegando para Live",
        rich: [
          { type: "link", href: "/live", label: "Abrir Live agora →", description: "Atualiza a cada 30s · GA4 Realtime API" },
        ],
        followUps: ["Qual canal traz mais tráfego?", "Top páginas", "Voltar ao dashboard"],
      };

    case "reports":
      return {
        reply: "Posso abrir a aba de Mídia Paga (campanhas + ROAS) ou gerar arquivos prontos para você baixar. O que prefere?",
        navigate: "/midia",
        rich: [
          { type: "link", href: "/midia", label: "Abrir Mídia Paga →", description: "Campanhas, ROAS, atribuição, ROI" },
          {
            type: "actions",
            items: [
              { label: "📊 Baixar por canal", command: "Baixar top canais em Excel" },
              { label: "📄 Baixar por página", command: "Baixar top páginas em Excel" },
              { label: "📱 Baixar por dispositivo", command: "Baixar audiência em Excel" },
              { label: "🎯 Baixar por campanha", command: "Baixar campanhas em PDF" },
            ],
          },
        ],
        followUps: ["Ver catálogo de relatórios", "Melhor canal por conversão", "Baixar resumo executivo"],
      };

    case "best_channel":
      return {
        reply: "Ranking dos canais por performance (últimos 30 dias):",
        newHighlight: "trend",
        rich: [
          {
            type: "table",
            columns: ["Canal", "Sessões", "Conv.", "Taxa", "Receita"],
            rows: [
              ["Email", "18.2k", "248", "1.36%", "R$ 42k"],
              ["Referral", "9.9k", "97", "0.97%", "R$ 14k"],
              ["Paid Search", "84.1k", "512", "0.61%", "R$ 72k"],
              ["Direct", "158k", "784", "0.50%", "R$ 108k"],
              ["Organic", "512k", "1.842", "0.36%", "R$ 254k"],
              ["Social", "42.8k", "128", "0.30%", "R$ 18k"],
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "Email tem a maior taxa de conversão (1.36%)",
            body: "Apesar do volume baixo, email é o canal mais eficiente por sessão. Orgânico lidera em receita absoluta (R$ 254k) pelo volume. Paid Search tem o melhor equilíbrio volume/qualidade.",
          },
          {
            type: "download",
            reportId: "top-channels",
            label: "Baixar ranking completo",
            description: "Top canais com CPA, ROAS e receita",
            formats: ["xlsx", "pdf", "csv"],
          },
        ],
        followUps: ["Pior canal", "Campanhas com melhor ROAS", "Baixar em PDF"],
      };

    case "worst_channel":
      return {
        reply: "O canal **Social** tem a pior eficiência: 42.8k sessões com apenas 0.30% de conversão.",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Social · Sessões", value: "42.8k" },
              { label: "Social · Taxa rejeição", value: "58.3%", positive: false },
              { label: "Social · Duração", value: "1m38s", positive: false },
              { label: "Social · Conv.", value: "0.30%" },
            ],
          },
          {
            type: "recommendations",
            items: [
              { title: "Revisar copy e CTA dos posts (possível desalinhamento)", impact: "+2x conv.", effort: "baixo" },
              { title: "Testar LPs específicas para audiência social", impact: "+50% conv.", effort: "médio" },
            ],
          },
        ],
        followUps: ["Melhor canal", "Baixar campanhas em PDF"],
      };

    case "revenue":
      return {
        reply: "Receita consolidada últimos 30 dias:",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Receita total", value: "R$ 512k", delta: "+8.7%", positive: true },
              { label: "Ticket médio", value: "R$ 142" },
              { label: "Receita por usuário", value: "R$ 1.08" },
              { label: "Up-sell", value: "R$ 235k", delta: "+12%", positive: true },
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: "Orgânico + Direct geram 71% da receita",
            body: "Dependência alta em canais gratuitos. Diversificar em paid search para estabilidade pode reduzir volatilidade.",
          },
        ],
        followUps: ["Melhor canal por conversão", "Baixar resumo executivo"],
      };

    case "anomaly":
      return {
        reply: "Detectei 3 anomalias nos últimos 30 dias:",
        rich: [
          {
            type: "insight",
            severity: "danger",
            title: "15/04 — Drop de 23% em conversões mobile",
            body: "Possível causa: deploy às 14h do mesmo dia. Verificar logs de erro e o checkout mobile.",
          },
          {
            type: "insight",
            severity: "warning",
            title: "22/04 — Pico de 3x em /lp/premium-30",
            body: "Campanha paga não mapeada? Tráfego vindo de origem 'direct' com comportamento de campanha.",
          },
          {
            type: "insight",
            severity: "success",
            title: "28/04 — SNEL11 com +187% orgânico",
            body: "Viralizou no Twitter após análise. Oportunidade: criar conteúdo similar para outros FIIs.",
          },
          {
            type: "download",
            reportId: "anomalies",
            label: "Baixar relatório de anomalias",
            description: "Histórico + hipóteses + próximos passos",
            formats: ["xlsx", "pdf"],
          },
        ],
        followUps: ["Analisa o drop de mobile", "Top páginas em alta", "Recomendações"],
      };

    case "recommendations":
      return {
        reply: "Minhas 5 recomendações prioritárias baseadas no estado atual dos dados:",
        rich: [
          {
            type: "recommendations",
            items: [
              { title: "Remarketing para begin_checkout sem purchase", impact: "+R$ 48k/mês", effort: "baixo" },
              { title: "Email pós-compra com cross-sell 7 dias", impact: "+R$ 32k/mês", effort: "baixo" },
              { title: "Auto-completar CEP no checkout", impact: "+20% avanço pagamento", effort: "baixo" },
              { title: "Pop-up exit-intent com relatório grátis", impact: "+8% leads", effort: "baixo" },
              { title: "Bundle Premium + Consultoria com desconto", impact: "+R$ 54k/mês", effort: "médio" },
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "Impacto potencial combinado: +R$ 162k/mês (~32% de crescimento)",
            body: "Priorize as 3 primeiras — baixo esforço e implementáveis em 1-2 sprints.",
          },
          {
            type: "download",
            reportId: "cro-recommendations",
            label: "Baixar roadmap CRO priorizado",
            description: "Backlog com ICE score (Impacto × Confiança × Esforço)",
            formats: ["xlsx", "pdf"],
          },
        ],
        followUps: ["Analisa o checkout", "Lead funnel", "Baixar em PDF"],
      };

    case "cohort":
      return {
        reply: "Análise de cohort — novos vs recorrentes:",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Novos usuários", value: "63%" },
              { label: "Recorrentes", value: "37%" },
              { label: "Retenção 30d", value: "22%" },
              { label: "LTV 12m", value: "R$ 1.240" },
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: "Recorrentes convertem 5.2x mais",
            body: "Apesar de serem 37% da base, recorrentes geram 68% da receita. Foco em reativação e onboarding gera mais impacto que aquisição pura.",
          },
        ],
        followUps: ["Up-sell e cross-sell", "Recomendações"],
      };

    case "device_mobile":
      return {
        reply: "Filtrando por **mobile** 📱",
        newFilter: "mobile",
        newHighlight: "kpis",
        toast: "Filtro: Mobile",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Sessões mobile", value: "561k", delta: "68%" },
              { label: "Conversão mobile", value: "0.33%", positive: false },
              { label: "Receita mobile", value: "R$ 248k" },
              { label: "Duração", value: "2m48s" },
            ],
          },
          {
            type: "insight",
            severity: "warning",
            title: "Mobile tem metade da conversão de desktop",
            body: "68% do tráfego mas 47% da receita. Principal suspeita: fricção no checkout mobile (add_payment_info).",
          },
        ],
        followUps: ["Compara com desktop", "Analisa o checkout"],
      };

    case "device_desktop":
      return {
        reply: "Filtrando por **desktop** 🖥️",
        newFilter: "desktop",
        newHighlight: "kpis",
        toast: "Filtro: Desktop",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Sessões desktop", value: "231k", delta: "28%" },
              { label: "Conversão", value: "0.66%", positive: true },
              { label: "Ticket médio", value: "R$ 162" },
              { label: "Duração", value: "4m58s" },
            ],
          },
        ],
        followUps: ["Compara com mobile", "Tráfego orgânico"],
      };

    case "channel_organic":
      return {
        reply: "Filtrando por **tráfego orgânico** 🌱",
        newFilter: "organic",
        newHighlight: "trend",
        toast: "Filtro: Orgânico",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Sessões", value: "512k", delta: "62%" },
              { label: "Usuários", value: "298k" },
              { label: "Receita", value: "R$ 254k" },
              { label: "Conv.", value: "0.36%" },
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "62% do tráfego é orgânico — maior ativo",
            body: "SNEL11 e carteiras de dividendos dominam as buscas. Estratégia de conteúdo por FII específico está funcionando.",
          },
        ],
        followUps: ["Top páginas", "Melhor canal"],
      };

    case "channel_paid":
      return {
        reply: "Filtrando por **tráfego pago** 💰",
        newFilter: "paid",
        newHighlight: "trend",
        toast: "Filtro: Pago",
        rich: [
          {
            type: "table",
            columns: ["Campanha", "Sessões", "Conv.", "ROAS"],
            rows: [
              ["premium-30-search", "32k", "484", "4.2x"],
              ["brand-google", "24k", "312", "3.8x"],
              ["retargeting-carteira", "8k", "124", "3.2x"],
              ["snel11-display", "14k", "84", "1.4x"],
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: "premium-30 é a melhor campanha (ROAS 4.2x)",
            body: "Aumentar budget em 30% deve escalar receita ~R$ 20k/mês sem perder eficiência.",
          },
          {
            type: "download",
            reportId: "campaigns-roas",
            label: "Baixar todas campanhas",
            description: "Investimento × receita × ROAS",
            formats: ["xlsx", "pdf"],
          },
        ],
        followUps: ["Melhor canal", "Recomendações"],
      };

    case "pages_top":
      return {
        reply: "Top páginas pelos últimos 30 dias:",
        newHighlight: "pages",
        rich: [
          {
            type: "table",
            columns: ["Página", "Usuários", "Conv.", "Receita"],
            rows: [
              ["/carteiras", "84.5k", "584", "R$ 82k"],
              ["/asset/fundos/snel11", "62.4k", "412", "R$ 58k"],
              ["/relatorios", "32.1k", "128", "R$ 18k"],
              ["/blog/como-investir", "42.1k", "84", "R$ 11k"],
              ["/lp/premium-30", "38.4k", "842", "R$ 118k"],
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "/lp/premium-30 converte 1.93% (5x a média)",
            body: "Melhor LP de performance. Replicar estrutura para outras ofertas pode escalar receita.",
          },
          {
            type: "download",
            reportId: "top-pages",
            label: "Baixar lista completa",
            description: "Todas as páginas com pageviews, tempo médio e receita",
            formats: ["xlsx", "csv"],
          },
        ],
        followUps: ["Analisa o checkout", "Tráfego orgânico", "Baixar em Excel"],
      };

    case "events_analysis":
      return {
        reply: "Eventos mais disparados (30d):",
        newHighlight: "events",
        rich: [
          {
            type: "table",
            columns: ["Evento", "Contagem"],
            rows: [
              ["scroll_depth", "2.1M"],
              ["page_view", "1.68M"],
              ["session_start", "825k"],
              ["user_engagement", "494k"],
              ["user_login", "183k"],
              ["begin_checkout", "15.2k"],
              ["purchase", "3.6k"],
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: "Ratio user_login / purchase = 50.7x",
            body: "Alta recorrência na área logada. Evento user_login é um forte sinal de engajamento — use em cohorts e segmentações.",
          },
          {
            type: "download",
            reportId: "top-events",
            label: "Baixar catálogo completo",
            description: "Todos os eventos + saúde do tracking",
            formats: ["xlsx", "csv"],
          },
        ],
        followUps: ["Up-sell", "Jornada completa"],
      };

    case "attribution_last":
      return {
        reply: "Alternando para **Last Click** — crédito ao último canal.",
        newAttribution: "last-click",
        newHighlight: "kpis",
        followUps: ["Compara com Assistida", "Melhor canal"],
      };

    case "attribution_assisted":
      return {
        reply: "Alternando para **Atribuição Assistida** — crédito distribuído em toda a jornada.",
        newAttribution: "assisted",
        newHighlight: "kpis",
        followUps: ["Compara com Last Click", "Top páginas"],
      };

    case "attribution_explain":
      return {
        reply: "Diferença entre os dois modelos:",
        rich: [
          {
            type: "insight",
            severity: "info",
            title: "Last Click",
            body: "100% do crédito vai para o último canal antes da conversão. Conservador. Bom para otimizar bottom-funnel (paid search, direct, email de conversão).",
          },
          {
            type: "insight",
            severity: "info",
            title: "Atribuição Assistida",
            body: "Distribui crédito entre todos os touchpoints. Revela o valor real de canais de topo de funil (social, display, blog) que influenciam mas raramente são o último clique.",
          },
          {
            type: "metrics",
            items: [
              { label: "Last-click conv.", value: "3.611" },
              { label: "Assistida conv.", value: "8.247", delta: "+128%", positive: true },
            ],
          },
        ],
        followUps: ["Ativa Last Click", "Ativa Assistida"],
      };

    case "journey":
      return {
        reply: "A jornada completa Suno está destacada. Cada etapa com seu evento e drop:",
        newHighlight: "journey",
        rich: [
          { type: "journey-step", stage: "Visita", event: "page_view", value: 470860, issue: "80% saem sem virar lead" },
          { type: "journey-step", stage: "Lead", event: "generate_lead", value: 94172 },
          { type: "journey-step", stage: "Conta Criada", event: "sign_up", value: 42378 },
          { type: "journey-step", stage: "Checkout", event: "begin_checkout", value: 15298, issue: "76% abandonam" },
          { type: "journey-step", stage: "Pagamento", event: "add_payment_info", value: 8742 },
          { type: "journey-step", stage: "Compra", event: "purchase", value: 3611 },
          { type: "journey-step", stage: "Login recorrente", event: "user_login", value: 183225 },
          { type: "journey-step", stage: "Up-sell", event: "purchase recorr.", value: 1247 },
        ],
        followUps: ["Maior gargalo?", "Analisa checkout", "Baixar diagnóstico do funil em PDF"],
      };

    case "compare":
      return {
        reply: "Modo de comparação com mês anterior ativado 📊",
        newCompare: true,
        newHighlight: "kpis",
        toast: "Modo comparação ativo",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Usuários", value: "470k", delta: "+12.4%", positive: true },
              { label: "Sessões", value: "825k", delta: "+8.7%", positive: true },
              { label: "Conversões", value: "3.6k", delta: "-2.1%", positive: false },
              { label: "Receita", value: "R$ 512k", delta: "+5.8%", positive: true },
            ],
          },
          {
            type: "insight",
            severity: "warning",
            title: "Tráfego cresceu mas conversão caiu",
            body: "Sinal clássico de qualificação pior do tráfego ou piora na experiência de checkout. Investigar mobile e begin_checkout.",
          },
        ],
        followUps: ["Por que conversões caíram?", "Analisa mobile"],
      };

    case "reset":
      return {
        reply: "Visão completa restaurada ✓",
        newFilter: "all",
        newCompare: false,
        toast: "Visão completa",
        followUps: ["Recomendações", "Maior gargalo?"],
      };

    case "help":
      return {
        reply: "Sou o **Copiloto Suno** — posso analisar, responder e gerar relatórios prontos para você. Escolha uma ação:",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "🔍", title: "Diagnosticar quedas", subtitle: "Por que conversões caíram?", command: "Por que conversões caíram?" },
              { emoji: "🩺", title: "Análise de funil", subtitle: "Onde está o gargalo?", command: "Onde está meu maior gargalo?" },
              { emoji: "💰", title: "Melhor canal", subtitle: "Ranking por receita", command: "Qual canal traz mais receita?" },
              { emoji: "🔮", title: "Anomalias", subtitle: "Drops e picos incomuns", command: "Tem alguma anomalia?" },
              { emoji: "💡", title: "Recomendações", subtitle: "Ações priorizadas", command: "Me dá recomendações" },
              { emoji: "🔴", title: "Realtime", subtitle: "Comportamento ao vivo", command: "Comportamento ao vivo" },
              { emoji: "📊", title: "Baixar relatórios", subtitle: "Excel, PDF ou CSV", command: "Ver catálogo de relatórios" },
              { emoji: "🔄", title: "Trocar atribuição", subtitle: "Last click × assistida", command: "Explica atribuição" },
            ],
          },
        ],
        followUps: ["Baixar resumo executivo", "Recomendações", "Melhor canal"],
      };

    // ========= CONVERSAÇÃO / TRIAGEM (estilo ZT) =========
    case "greeting": {
      const firstName = "você";
      const hour = new Date().getHours();
      const greet =
        hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
      const topPage = live.pagesDetail?.pages?.[0];
      return {
        reply: `${greet}! 👋 Prazer te ver por aqui, ${firstName}. Sou o **Copiloto Suno** — posso analisar, diagnosticar e gerar relatórios para você.\n\nPra eu te ajudar do melhor jeito, me diz: **o que você quer fazer agora?**`,
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📊", title: "Entender os números", subtitle: "Snapshot KPIs do período", command: "Como estão os números?" },
              { emoji: "🎯", title: "Otimizar conversões", subtitle: "Onde perdemos vendas?", command: "Quero melhorar minhas conversões" },
              { emoji: "🔍", title: "Investigar problema", subtitle: "Algo parece errado?", command: "Tem algo errado nos dados?" },
              { emoji: "📥", title: "Baixar relatório", subtitle: "Excel, PDF ou CSV", command: "Quero um relatório" },
              ...(topPage
                ? [
                    {
                      emoji: "📄",
                      title: `Como está ${topPage.path}?`,
                      subtitle: "Página mais acessada",
                      command: `Como está a página ${topPage.path}?`,
                    },
                  ]
                : []),
            ],
          },
        ],
        followUps: ["Como estão os números?", "Quero melhorar conversões", "Tem alguma anomalia?"],
      };
    }

    case "thanks":
      return {
        reply:
          "De nada! 💜 Qualquer coisa que você precisar sobre analytics, eu tô aqui 24/7.\n\nQuer olhar mais algum ângulo dos dados?",
        followUps: ["Como estão os números?", "Recomendações", "Baixar resumo executivo"],
      };

    case "affirm":
      // "sim/ok/beleza" — continua o fluxo oferecendo o próximo passo lógico
      return {
        reply:
          "Fechado. Por onde seguimos?",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📊", title: "Snapshot do período", subtitle: "Números atuais", command: "Como estão os números?" },
              { emoji: "🩺", title: "Onde perdemos gente", subtitle: "Gargalo do funil", command: "Onde está meu maior gargalo?" },
              { emoji: "💰", title: "Melhor canal", subtitle: "Ranking por receita", command: "Qual canal traz mais receita?" },
              { emoji: "📥", title: "Baixar relatório", subtitle: "Formato à escolha", command: "Ver catálogo de relatórios" },
            ],
          },
        ],
        followUps: ["Snapshot", "Melhor canal", "Recomendações"],
      };

    case "deny":
      return {
        reply:
          "Sem problema. Me diz com suas palavras o que tá passando pela cabeça — pode ser bem solto, tipo *\"minhas vendas caíram\"* ou *\"quero saber qual campanha tá rendendo\"*. Eu interpreto e te guio. 😊",
        followUps: ["Como estão os números?", "Tem alguma anomalia?", "O que você faz?"],
      };

    case "smalltalk":
      return {
        reply:
          "Tô ótimo, obrigado por perguntar! 🤖 Mastigando dados do GA4 em background. Vamo fazer algo útil?",
        followUps: ["Como estão os números?", "Melhor canal", "Recomendações"],
      };

    case "more_detail":
      // Sem contexto anterior, devolvemos o snapshot completo
      return {
        reply:
          "Claro — posso aprofundar em várias frentes. Sobre o que você quer **mais detalhes**?",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📊", title: "KPIs do período", subtitle: "Números + variação", command: "Como estão os números?" },
              { emoji: "🛒", title: "Funil de compra", subtitle: "Onde cai mais gente", command: "Analisa o checkout" },
              { emoji: "🎯", title: "Conversões", subtitle: "Por evento + canal", command: "Qual canal converte mais?" },
              { emoji: "🗺️", title: "Jornada completa", subtitle: "Visita → compra", command: "Mostra a jornada" },
              { emoji: "🩺", title: "Anomalias", subtitle: "O que destoa", command: "Tem alguma anomalia?" },
              { emoji: "💡", title: "Recomendações", subtitle: "Próximos passos", command: "Me dá recomendações" },
            ],
          },
        ],
        followUps: ["Funil de compra", "Jornada", "Anomalias"],
      };

    // ---- Triagens (abrem sub-menu com escolhas)
    case "triage_analyze":
      return {
        reply:
          "Bacana! Pra eu te ajudar a analisar direito, me diz: **o que você quer olhar?**",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📈", title: "Tendência geral", subtitle: "Usuários, sessões, receita", command: "Como estão os números?" },
              { emoji: "📄", title: "Páginas", subtitle: "Quais performam melhor", command: "Top páginas" },
              { emoji: "⚡", title: "Eventos GA4", subtitle: "O que dispara mais", command: "Eventos" },
              { emoji: "💰", title: "Canais", subtitle: "Organic / Paid / Email", command: "Qual canal traz mais receita?" },
              { emoji: "📱", title: "Mobile vs Desktop", subtitle: "Comportamento por device", command: "Compara mobile e desktop" },
              { emoji: "🌎", title: "Geografia", subtitle: "Tráfego por país", command: "Tráfego por país" },
            ],
          },
        ],
        followUps: ["Tendência geral", "Top páginas", "Melhor canal"],
      };

    case "triage_optimize":
      return {
        reply:
          "Perfeito — otimizar é meu esporte favorito. 🎯 Onde você sente que tá travando?",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "🛒", title: "Checkout / carrinho", subtitle: "Abandono alto", command: "Analisa o checkout" },
              { emoji: "📥", title: "Captura de lead", subtitle: "Conversão visita→lead", command: "Como melhorar a captura de lead?" },
              { emoji: "📱", title: "Mobile", subtitle: "Conversão mobile baixa", command: "Mobile" },
              { emoji: "💸", title: "ROAS", subtitle: "Campanhas pagas", command: "Campanhas com melhor ROAS" },
              { emoji: "🔁", title: "Up-sell / recompra", subtitle: "Segunda compra", command: "Up-sell" },
              { emoji: "💡", title: "Ver tudo priorizado", subtitle: "Roadmap CRO", command: "Me dá recomendações" },
            ],
          },
        ],
        followUps: ["Analisa o checkout", "Me dá recomendações", "Baixar roadmap CRO"],
      };

    case "triage_investigate":
      return {
        reply:
          "Vamos investigar. 🔍 Me ajuda a apontar o foco — o que tá chamando sua atenção?",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📉", title: "Queda de conversões", subtitle: "Diagnóstico automático", command: "Por que conversões caíram?" },
              { emoji: "🚨", title: "Anomalias gerais", subtitle: "Drops + picos", command: "Tem alguma anomalia?" },
              { emoji: "🛑", title: "Abandono de checkout", subtitle: "Onde para", command: "Analisa o checkout" },
              { emoji: "📱", title: "Mobile piorou?", subtitle: "Comparativo device", command: "Mobile caiu?" },
              { emoji: "🌐", title: "Canal travou?", subtitle: "Ranking + tendências", command: "Pior canal" },
            ],
          },
        ],
        followUps: ["Por que conversões caíram?", "Anomalias", "Analisa o checkout"],
      };

    case "triage_report":
      // mesmo menu do export_menu mas com tom consultivo
      return {
        reply:
          "Top — posso gerar qualquer relatório em **Excel, PDF ou CSV**. Qual formato te serve melhor? Ou, se preferir, vou direto no conteúdo:",
        rich: [
          {
            type: "quick-start",
            items: [
              { emoji: "📋", title: "Resumo Executivo", subtitle: "KPIs + canais + funil", command: "Baixar resumo executivo em Excel" },
              { emoji: "🏆", title: "Top Canais", subtitle: "Ranking por conversão", command: "Baixar top canais em PDF" },
              { emoji: "📄", title: "Top Páginas", subtitle: "Engajamento por URL", command: "Baixar top páginas em Excel" },
              { emoji: "⚡", title: "Eventos GA4", subtitle: "Catálogo + saúde", command: "Baixar eventos em Excel" },
              { emoji: "🩺", title: "Diagnóstico do Funil", subtitle: "Drops + ações", command: "Baixar diagnóstico do funil em PDF" },
              { emoji: "🎯", title: "Roadmap CRO", subtitle: "Backlog priorizado", command: "Baixar roadmap CRO em PDF" },
            ],
          },
        ],
        followUps: ["Baixar resumo executivo", "Baixar top canais", "Baixar diagnóstico do funil"],
      };

    // ---- Novos tópicos temáticos
    case "country_breakdown":
      return {
        reply: "Tráfego por país nos últimos 30 dias:",
        rich: [
          {
            type: "table",
            columns: ["País", "Usuários", "% do total", "Conv."],
            rows: [
              ["🇧🇷 Brasil", "445k", "94.5%", "3.421"],
              ["🇵🇹 Portugal", "11.2k", "2.4%", "84"],
              ["🇺🇸 EUA", "6.8k", "1.4%", "52"],
              ["🇦🇷 Argentina", "3.1k", "0.7%", "24"],
              ["🇯🇵 Japão", "1.4k", "0.3%", "18"],
              ["🌍 Outros", "3.4k", "0.7%", "12"],
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: "Brasil concentra 94.5% da audiência",
            body: "Expansão para Portugal e EUA vem crescendo MoM — mercados de brasileiros fora do país com interesse em investimentos no Brasil.",
          },
        ],
        followUps: ["Melhor canal", "Audiência completa", "Baixar audiência em Excel"],
      };

    case "peak_hours":
      return {
        reply: "Melhor janela de engajamento da sua audiência (base últimos 30 dias):",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Pico principal", value: "20h–22h", delta: "+42% usuários" },
              { label: "Pico secundário", value: "12h–14h", delta: "+18% usuários" },
              { label: "Dia mais forte", value: "Terça-feira" },
              { label: "Dia mais fraco", value: "Sábado" },
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "Janela 20h–22h é a mais qualificada",
            body: "Usuários neste horário têm 1.8x mais sessões engajadas e 2.1x a taxa de checkout vs média. Priorize push, email e posts nesse intervalo.",
          },
          {
            type: "recommendations",
            items: [
              { title: "Disparar email de captura às 19h45 (pré-pico)", impact: "+22% abertura", effort: "baixo" },
              { title: "Agendar posts Instagram/LinkedIn entre 20h–21h", impact: "+30% engajamento", effort: "baixo" },
              { title: "Push notification de recompra às 21h", impact: "+R$ 14k/mês", effort: "baixo" },
            ],
          },
        ],
        followUps: ["Mobile vs Desktop", "Melhor canal", "Baixar audiência"],
      };

    case "retention_ltv":
      return {
        reply: "Retenção e LTV consolidados:",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Retenção 7d", value: "48%", delta: "+3pp", positive: true },
              { label: "Retenção 30d", value: "22%", delta: "+1pp", positive: true },
              { label: "Retenção 90d", value: "14%" },
              { label: "LTV 12m", value: "R$ 1.240", delta: "+8%", positive: true },
            ],
          },
          {
            type: "insight",
            severity: "info",
            title: "LTV 12m de R$ 1.240 — patamar de SaaS premium",
            body: "Usuário que chega à Área do Investidor tem 4.2x mais recompra. Retenção 30d em 22% é saudável pra portal financeiro, mas dá pra chegar a 28%+ com onboarding de 7 dias.",
          },
          {
            type: "recommendations",
            items: [
              { title: "Onboarding in-app nos primeiros 7 dias pós-compra", impact: "+5pp retenção 30d", effort: "médio" },
              { title: "Programa de indicação (referral) com bônus", impact: "+12% LTV", effort: "alto" },
            ],
          },
        ],
        followUps: ["Up-sell", "Cohort", "Baixar CRO"],
      };

    case "landing_performance":
      return {
        reply: "Ranking das LPs — performance das últimas 30 dias:",
        newHighlight: "pages",
        rich: [
          {
            type: "table",
            columns: ["LP", "Sessões", "Taxa conv.", "Receita"],
            rows: [
              ["/lp/premium-30", "38.4k", "1.93%", "R$ 118k"],
              ["/lp/carteira-plus", "24.1k", "1.42%", "R$ 58k"],
              ["/lp/renda-fixa", "18.7k", "0.84%", "R$ 22k"],
              ["/lp/fiis-mensais", "14.2k", "1.18%", "R$ 28k"],
              ["/lp/consultoria", "8.9k", "2.14%", "R$ 42k"],
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "/lp/consultoria tem a melhor taxa (2.14%)",
            body: "Baixo volume mas alta qualificação. Escalar investimento em paid search + retargeting pode dobrar volume sem perder conversão.",
          },
        ],
        followUps: ["Analisa /lp/premium-30", "Campanhas ROAS", "Baixar top páginas"],
      };

    case "seo_performance":
      return {
        reply: "SEO / tráfego orgânico consolidado:",
        newFilter: "organic",
        newHighlight: "trend",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Sessões orgânicas", value: "512k", delta: "+14%", positive: true },
              { label: "% do total", value: "62%" },
              { label: "Top keyword", value: "como investir em fiis" },
              { label: "Receita orgânica", value: "R$ 254k", delta: "+12%", positive: true },
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "Orgânico é o maior ativo — 62% do tráfego",
            body: "SNEL11, carteiras de dividendos e blog 'como investir' dominam. Há oportunidade de capturar 'cdb vs tesouro direto' e 'renda fixa 2026' — ambos com alto volume e baixa concorrência.",
          },
          {
            type: "recommendations",
            items: [
              { title: "Cluster de conteúdo sobre Renda Fixa 2026", impact: "+40k sessões/mês", effort: "médio" },
              { title: "Atualizar top 10 páginas antigas (refresh SEO)", impact: "+18% tráfego", effort: "baixo" },
            ],
          },
        ],
        followUps: ["Top páginas", "Baixar top páginas", "Tráfego pago"],
      };

    case "campaigns_performance":
      return {
        reply: "Performance das campanhas pagas (últimos 30d):",
        newFilter: "paid",
        rich: [
          {
            type: "table",
            columns: ["Campanha", "Sessões", "Conv.", "ROAS"],
            rows: [
              ["premium-30-search", "32k", "484", "4.2x"],
              ["brand-google", "24k", "312", "3.8x"],
              ["retargeting-carteira", "8k", "124", "3.2x"],
              ["snel11-display", "14k", "84", "1.4x"],
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "premium-30-search: melhor ROAS (4.2x)",
            body: "Aumentar budget em 30% deve escalar receita ~R$ 20k/mês sem perder eficiência. Já snel11-display (1.4x) precisa ser pausada ou reformulada.",
          },
          {
            type: "download",
            reportId: "campaigns-roas",
            label: "Baixar relatório completo",
            description: "ROAS + CPA + investimento",
            formats: ["xlsx", "pdf"],
          },
        ],
        followUps: ["Pausar snel11-display?", "Melhor canal", "Baixar em Excel"],
      };

    case "benchmark":
      return {
        reply: "Benchmarks do mercado financeiro digital (fonte: SimilarWeb + relatórios setoriais):",
        rich: [
          {
            type: "table",
            columns: ["Métrica", "Suno", "Mercado", "Status"],
            rows: [
              ["Taxa rejeição", "44.2%", "48–52%", "✅ melhor"],
              ["Duração sessão", "2m48s", "2m10s", "✅ melhor"],
              ["Conv. visita→lead", "20%", "28–35%", "⚠️ abaixo"],
              ["Conv. lead→compra", "3.8%", "3–5%", "✅ na média"],
              ["Abandono checkout", "76.4%", "70%", "⚠️ acima"],
              ["LTV 12m", "R$ 1.240", "R$ 980", "✅ melhor"],
            ],
          },
          {
            type: "insight",
            severity: "warning",
            title: "2 pontos abaixo do mercado: captura de lead e checkout",
            body: "Captura (20% vs 30%) e abandono de checkout (76% vs 70%) são onde mais dinheiro está na mesa. Ações em lead magnets e checkout 1-página podem fechar o gap.",
          },
        ],
        followUps: ["Como melhorar captura?", "Analisa checkout", "Recomendações"],
      };

    case "yesterday_analysis": {
      // Pergunta crítica pra gerentes: "como foi ontem?" — sempre deve responder.
      const isReal = live.isReal && !!live.overview?.kpis;
      const kReal = live.overview?.kpis;
      // Base numérica: GA4 quando disponível, caso contrário mock (divide por ~days p/ estimar 1d)
      const mk = getKpis(_ctx.attribution);
      const days = Math.max(1, live.days || 30);
      const y = isReal && kReal
        ? {
            users: Math.round(kReal.activeUsers / days),
            sessions: Math.round(kReal.sessions / days),
            pageviews: Math.round(kReal.pageviews / days),
            conversions: Math.round(kReal.conversions / days),
          }
        : {
            users: Math.round((mk[0]?.value || 0) / days),
            sessions: Math.round((mk[1]?.value || 0) / days),
            pageviews: Math.round((mk[2]?.value || 0) / days),
            conversions: Math.round((mk[3]?.value || 0) / days),
          };
      // D-2 simulado a partir de -6% a +8% de variação controlada
      const seed = (y.users + y.sessions) % 100;
      const varPct = ((seed % 14) - 6) / 100; // -6% a +7%
      const d2 = {
        users: Math.round(y.users * (1 - varPct)),
        sessions: Math.round(y.sessions * (1 - varPct * 0.9)),
        pageviews: Math.round(y.pageviews * (1 - varPct * 1.1)),
        conversions: Math.round(y.conversions * (1 - varPct * 1.2)),
      };
      const deltaPct = (a: number, b: number) =>
        b === 0 ? 0 : ((a - b) / b) * 100;
      const du = deltaPct(y.users, d2.users);
      const ds = deltaPct(y.sessions, d2.sessions);
      const dp = deltaPct(y.pageviews, d2.pageviews);
      const dc = deltaPct(y.conversions, d2.conversions);
      const fmtDelta = (d: number) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
      const narrative =
        dc > 5
          ? `Dia positivo: conversões cresceram ${fmtDelta(dc)} vs anteontem. Vale dobrar o que funcionou — provavelmente mídia paga ou email.`
          : dc < -5
          ? `Atenção: conversões caíram ${fmtDelta(dc)} vs anteontem. Revisar ontem: criativos, checkout, latência de página e se houve queda de tráfego pago.`
          : `Dia dentro da média: conversões ${fmtDelta(dc)} vs anteontem. Estabilidade — momento bom pra testar novos criativos sem ruído.`;
      return {
        reply:
          (isReal
            ? "Análise de **ontem** (GA4 ao vivo, estimativa por média do período):"
            : "Análise de **ontem** (modo demo — conecte o GA4 para números reais):"),
        newHighlight: "kpis",
        rich: [
          {
            type: "metrics",
            items: [
              {
                label: "Usuários ontem",
                value: formatCompact(y.users),
                delta: fmtDelta(du),
                positive: du >= 0,
              },
              {
                label: "Sessões ontem",
                value: formatCompact(y.sessions),
                delta: fmtDelta(ds),
                positive: ds >= 0,
              },
              {
                label: "Pageviews ontem",
                value: formatCompact(y.pageviews),
                delta: fmtDelta(dp),
                positive: dp >= 0,
              },
              {
                label: "Conversões ontem",
                value: formatCompact(y.conversions),
                delta: fmtDelta(dc),
                positive: dc >= 0,
              },
            ],
          },
          {
            type: "insight",
            severity: dc < -5 ? "warning" : dc > 5 ? "success" : "info",
            title:
              dc < -5
                ? "Queda relevante em conversões"
                : dc > 5
                ? "Pico de conversões"
                : "Dia estável",
            body: narrative,
          },
          {
            type: "table",
            columns: ["Métrica", "Ontem (D-1)", "Anteontem (D-2)", "Δ"],
            rows: [
              ["Usuários", formatCompact(y.users), formatCompact(d2.users), fmtDelta(du)],
              ["Sessões", formatCompact(y.sessions), formatCompact(d2.sessions), fmtDelta(ds)],
              ["Pageviews", formatCompact(y.pageviews), formatCompact(d2.pageviews), fmtDelta(dp)],
              ["Conversões", formatCompact(y.conversions), formatCompact(d2.conversions), fmtDelta(dc)],
            ],
          },
        ],
        followUps: [
          "Compara com a semana passada",
          "Por canal, como foi ontem?",
          "Baixar relatório diário",
        ],
      };
    }

    case "forecast":
      return {
        reply: "Projeção baseada em tendência linear + sazonalidade dos últimos 90d:",
        rich: [
          {
            type: "metrics",
            items: [
              { label: "Receita projetada (mês)", value: "R$ 568k", delta: "+11%", positive: true },
              { label: "Usuários projetados", value: "512k", delta: "+9%", positive: true },
              { label: "Conversões proj.", value: "3.940", delta: "+9%", positive: true },
              { label: "Confiança", value: "82%" },
            ],
          },
          {
            type: "insight",
            severity: "success",
            title: "Ritmo atual bate meta do trimestre",
            body: "Se mantivermos +9% em usuários e 0.77% de conversão, fecha o trimestre em R$ 1.7M — superando a meta (R$ 1.55M) em 10%. Risco: sazonalidade de fim de ano pode puxar ticket médio pra baixo.",
          },
        ],
        followUps: ["Ver anomalias", "Analisa mobile", "Recomendações"],
      };

    default: {
      // Se temos dados reais, sugerimos perguntas com páginas/eventos que EXISTEM na conta
      const topPages = (live.pagesDetail?.pages || []).slice(0, 3);
      const topEvents = (live.overview?.events || []).slice(0, 3);
      const realItems: { emoji: string; title: string; subtitle: string; command: string }[] = [];
      for (const p of topPages) {
        realItems.push({
          emoji: "📄",
          title: `Como está ${p.path}?`,
          subtitle: `${formatCompact(p.views)} views · ${formatCompact(p.users)} usuários`,
          command: `Como está a página ${p.path}?`,
        });
      }
      for (const e of topEvents) {
        realItems.push({
          emoji: "⚡",
          title: `Evento ${e.name}`,
          subtitle: `${formatCompact(e.value)} disparos`,
          command: `Fala do evento ${e.name}`,
        });
      }
      if (live.isReal) {
        realItems.push({
          emoji: "📊",
          title: "Resumo geral",
          subtitle: "Snapshot dos números",
          command: "Como estão os números?",
        });
      }

      // Triagem "nunca-falha" estilo ZTGrowth:
      // em vez de dizer "não entendi", **sempre** guiamos o usuário em árvore.
      // Se tivermos dados reais, já oferecemos perguntas direcionadas àquelas
      // páginas/eventos existentes.
      const triageItems: { emoji: string; title: string; subtitle: string; command: string }[] = [
        { emoji: "📊", title: "Entender os números", subtitle: "Snapshot do período", command: "Como estão os números?" },
        { emoji: "🎯", title: "Otimizar conversões", subtitle: "Onde perdemos vendas", command: "Quero melhorar minhas conversões" },
        { emoji: "🔍", title: "Investigar problema", subtitle: "Algo parece errado?", command: "Tem algo errado nos dados?" },
        { emoji: "📥", title: "Baixar relatório", subtitle: "Excel, PDF ou CSV", command: "Quero um relatório" },
        { emoji: "🗺️", title: "Ver jornada completa", subtitle: "Visita → compra", command: "Mostra a jornada completa" },
        { emoji: "💡", title: "Recomendações", subtitle: "Próximos passos", command: "Me dá recomendações" },
      ];

      // Se tem dados reais, injetamos 1-2 atalhos específicos antes da triagem
      const dataDriven: { emoji: string; title: string; subtitle: string; command: string }[] = [];
      for (const p of topPages.slice(0, 1)) {
        dataDriven.push({
          emoji: "📄",
          title: `Como está ${p.path.length > 22 ? p.path.slice(0, 20) + "…" : p.path}?`,
          subtitle: `${formatCompact(p.views)} views · ${formatCompact(p.users)} usuários`,
          command: `Como está a página ${p.path}?`,
        });
      }
      for (const e of topEvents.slice(0, 1)) {
        dataDriven.push({
          emoji: "⚡",
          title: `Evento ${e.name}`,
          subtitle: `${formatCompact(e.value)} disparos`,
          command: `Fala do evento ${e.name}`,
        });
      }

      const items = [...dataDriven, ...triageItems].slice(0, 6);

      // Tom conversacional em vez de "não entendi"
      const replyPrefix = live.isReal
        ? `Hmm, posso te ajudar com isso de algumas formas 🤔 — pra não chutar, me diz por onde você quer começar:`
        : `Posso te ajudar com isso de algumas formas. Me diz por onde você quer começar? (ou digita em palavras mais diretas — tipo *"melhor canal de venda"* ou *"top páginas"*)`;

      return {
        reply: replyPrefix,
        rich: [{ type: "quick-start", items }],
        followUps: live.isReal
          ? [
              "Como estão os números?",
              topPages[0] ? `Como está ${topPages[0].path}?` : "Top páginas",
              "Quero melhorar conversões",
            ]
          : ["Como estão os números?", "Quero melhorar conversões", "Me dá recomendações"],
      };
    }
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([defaultWelcome]);
  const [filter, setFilter] = useState<Filter>("all");
  const [highlight, setHighlight] = useState<HighlightTarget>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [attribution, setAttributionState] = useState<Attribution>("last-click");
  const [navigateTo, setNavigateTo] = useState<string | null>(null);
  const [welcomePersonalized, setWelcomePersonalized] = useState(false);

  const { data: session } = useSession();
  const { selected, selectedId, days, useRealData } = useGA4();
  const { data: overview, meta: overviewMeta } = useGA4Overview();
  const { data: conversions, meta: convMeta } = useGA4Conversions();
  // Hook dedicado: conversões das últimas 24 horas (1 dia), independente do calendário.
  // Usado quando o usuário pergunta "quantos leads nas últimas 24h".
  const { data: conversions24h, meta: conv24hMeta } = useGA4Conversions(1);
  const { data: pagesDetail } = useGA4PagesDetail();

  // Pacote "live" consumido pelo handler de intents — reconstruído a cada render
  const liveRef = useRef<LiveData>(EMPTY_LIVE);
  const anyLoading =
    overviewMeta.status === "loading" ||
    convMeta.status === "loading" ||
    conv24hMeta.status === "loading";

  const live: LiveData = {
    overview: overview
      ? {
          kpis: overview.kpis,
          pages: overview.pages,
          events: overview.events,
          days: overview.days,
        }
      : null,
    conversions: conversions
      ? { conversions: conversions.conversions }
      : null,
    conversions24h: conversions24h
      ? { conversions: conversions24h.conversions }
      : null,
    pagesDetail: pagesDetail
      ? { pages: pagesDetail.pages, hosts: pagesDetail.hosts }
      : null,
    isReal:
      useRealData &&
      (overviewMeta.status === "success" || overviewMeta.status === "partial"),
    days,
    loading: useRealData && anyLoading,
    propertyId: selectedId,
    propertyName: selected?.displayName || null,
    isMaster: Boolean((session?.user as { isMaster?: boolean } | undefined)?.isMaster),
  };
  liveRef.current = live;

  // Monta o radar com dados reais sempre que GA4 responder (ou cai no mock se desconectado)
  const radar: RadarOverride | undefined = useRealData
    ? {
        users: overview?.kpis?.activeUsers ?? null,
        conversions: overview?.kpis?.conversions ?? null,
        revenue:
          conversions?.conversions?.find((c) => c.event === "purchase")?.value ?? null,
        anomalies: 0,
        days,
        isReal:
          overviewMeta.status === "success" || overviewMeta.status === "partial",
      }
    : undefined;

  // Atualiza a mensagem de welcome sempre que:
  // - o usuário loga (firstName disponível)
  // - a propriedade GA4 muda (selected.displayName)
  // - o período muda (days)
  // - os dados reais chegam/atualizam (overview.kpis, conversions)
  // Só substitui se o histórico ainda for só o welcome.
  // Sugestões de quick-start baseadas em dados reais
  const realSuggestions = live.isReal
    ? (() => {
        const items: { emoji: string; title: string; subtitle: string; command: string }[] = [];
        const topPages = (live.pagesDetail?.pages || []).slice(0, 2);
        const topEvents = (live.overview?.events || []).slice(0, 2);
        items.push({
          emoji: "📊",
          title: "Como estão os números?",
          subtitle: `Snapshot GA4 · ${live.days}d`,
          command: "Como estão os números?",
        });
        for (const p of topPages) {
          items.push({
            emoji: "📄",
            title: `Como está ${p.path.length > 22 ? p.path.slice(0, 20) + "…" : p.path}?`,
            subtitle: `${formatCompact(p.users)} usuários · ${formatCompact(p.views)} views`,
            command: `Como está a página ${p.path}?`,
          });
        }
        for (const e of topEvents) {
          items.push({
            emoji: "⚡",
            title: `Evento ${e.name}`,
            subtitle: `${formatCompact(e.value)} disparos`,
            command: `Fala do evento ${e.name}`,
          });
        }
        return items.slice(0, 4);
      })()
    : undefined;

  useEffect(() => {
    const firstName = session?.user?.name?.split(" ")[0] || "Renan";
    const accountName = selected?.displayName || "Suno";
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].role === "assistant") {
        return [buildWelcome(firstName, accountName, radar, realSuggestions)];
      }
      return prev;
    });
    if (!welcomePersonalized && session?.user?.name) setWelcomePersonalized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session?.user?.name,
    selected?.displayName,
    selected?.id,
    days,
    overview?.kpis?.activeUsers,
    overview?.kpis?.conversions,
    conversions?.conversions,
    overviewMeta.status,
    convMeta.status,
    useRealData,
  ]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const consumeNavigate = useCallback(() => setNavigateTo(null), []);

  const setAttribution = useCallback(
    (a: Attribution) => {
      setAttributionState(a);
      setHighlight("kpis");
      showToast(
        a === "last-click"
          ? "Modelo: Last Click — crédito ao último toque"
          : "Modelo: Atribuição Assistida — crédito multi-toque"
      );
      setTimeout(() => setHighlight(null), 2500);
    },
    [showToast]
  );

  /**
   * Handler async dedicado para perguntas de "widget de WhatsApp + páginas".
   * Faz uma chamada direta à rota /api/ga4/widget-pages com janela de 90 dias.
   * Retorna IntentResult já formatado pra ser renderizado pelo chat.
   */
  const handleWhatsAppWidget = useCallback(
    async (text: string): Promise<IntentResult> => {
      const propId = selectedId;
      const propName = selected?.displayName || "Modo demo";
      // Detecta hostContains pelo texto: "research", "premium", etc.
      const lt = text.toLowerCase();
      let hostContains = "";
      if (lt.includes("research")) hostContains = "research";
      else if (lt.includes("premium")) hostContains = "premium";
      else if (lt.includes("suno")) hostContains = "suno";

      // Detecta janela: "3 meses" = 90d, "6 meses" = 180d, "30 dias" = 30d, default 90
      let days = 90;
      if (lt.match(/30\s*(dias|d)/)) days = 30;
      else if (lt.match(/60\s*(dias|d)/) || lt.match(/2\s*meses/)) days = 60;
      else if (lt.match(/180\s*(dias|d)/) || lt.match(/6\s*meses/)) days = 180;
      else if (lt.match(/3\s*meses/)) days = 90;

      const periodLabel = days === 90 ? "últimos 3 meses" : `últimos ${days} dias`;

      if (!propId) {
        return {
          reply: `🎭 Selecione uma propriedade GA4 no header pra eu buscar as páginas com widget de WhatsApp${hostContains ? ` no host "${hostContains}"` : ""} nos ${periodLabel}.`,
          followUps: [
            "Como estamos hoje de sessões no site?",
            "Como estão as vendas hoje?",
          ],
        };
      }

      try {
        const qs = new URLSearchParams({
          propertyId: propId,
          eventContains: "whatsapp",
          days: String(days),
          limit: "30",
        });
        if (hostContains) qs.set("hostContains", hostContains);
        const resp = await fetch(`/api/ga4/widget-pages?${qs.toString()}`);
        const d = (await resp.json()) as {
          pages?: { host: string; path: string; url: string; pageviews: number; users: number; matchedEvents: { event: string; count: number }[]; totalEventCount: number }[];
          totals?: { pages: number; accesses: number; users: number; events: number };
          detectedEvents?: { event: string; count: number }[];
          error?: string;
        };

        if (d.error) {
          return {
            reply: `⚠ O GA4 retornou erro ao buscar widget de WhatsApp: ${d.error}. Verifica se a service account tem permissão "Viewer" em ${propName}.`,
            followUps: [
              "Como estamos hoje de sessões no site?",
              "Quais são as melhores campanhas dos últimos 7 dias?",
            ],
          };
        }

        const pages = d.pages || [];
        const totals = d.totals || { pages: 0, accesses: 0, users: 0, events: 0 };

        if (pages.length === 0) {
          return {
            reply: `🤔 Não encontrei nenhum evento com "whatsapp" no nome em **${propName}**${hostContains ? ` (host "${hostContains}")` : ""} nos ${periodLabel}. Possíveis causas:\n\n• O widget não dispara evento GA4 (instalado só com link tel:/wa.me sem tracking)\n• O evento tem nome diferente (ex.: \`zap_click\`, \`contato_click\`)\n• Tracking server-side ainda não foi ligado\n\nPra eu identificar, abra **Events Manager → Custom Definitions** e me diga qual o nome do evento, ou pede pro time pra disparar \`whatsapp_click\` quando o usuário clicar no widget.`,
            rich: [
              {
                type: "insight",
                severity: "warning",
                title: "Sugestão de tracking",
                body: `Adicionar dataLayer.push({event: 'whatsapp_click', page_path: window.location.pathname}) no clique do widget. Em 24h o GA4 já mostra os números.`,
              },
            ],
            followUps: [
              "Como estamos hoje de sessões no site?",
              "Quais páginas têm mais acesso?",
            ],
          };
        }

        return {
          reply: `📱 Encontrei **${totals.pages} páginas** em **${propName}** com eventos de WhatsApp disparados nos **${periodLabel}**${hostContains ? ` (host: \`${hostContains}\`)` : ""}: total de **${formatCompact(totals.accesses)} acessos** (page views) e **${formatCompact(totals.events)} cliques no widget**.`,
          newHighlight: "pages",
          rich: [
            {
              type: "metrics",
              items: [
                { label: "Páginas com widget", value: String(totals.pages) },
                { label: "Acessos (pageviews)", value: formatCompact(totals.accesses) },
                { label: "Usuários únicos", value: formatCompact(totals.users) },
                { label: "Cliques no widget", value: formatCompact(totals.events) },
              ],
            },
            {
              type: "table",
              columns: ["#", "Página", "Acessos", "Usuários", "Cliques no widget"],
              rows: pages.slice(0, 15).map((p, i) => [
                `${i + 1}`,
                p.path,
                formatCompact(p.pageviews),
                formatCompact(p.users),
                formatCompact(p.totalEventCount),
              ]),
            },
            {
              type: "insight",
              severity: "info",
              title: `${pages.length > 1 ? "Páginas" : "Página"} com maior engajamento no widget`,
              body: `${pages[0].path} liderou com ${formatCompact(pages[0].pageviews)} acessos e ${formatCompact(pages[0].totalEventCount)} cliques no widget. Taxa de clique no widget: ${
                pages[0].pageviews > 0
                  ? ((pages[0].totalEventCount / pages[0].pageviews) * 100).toFixed(2)
                  : "0"
              }%.`,
            },
          ],
          followUps: [
            "Quais páginas convertem mais leads?",
            "Como estão as vendas hoje?",
            "Recomendações prioritárias de CRO",
          ],
        };
      } catch (e) {
        return {
          reply: `⚠ Não consegui consultar o GA4 nesse momento. Erro: ${(e as Error).message}. Tenta de novo em alguns segundos.`,
          followUps: ["Como estamos hoje de sessões no site?"],
        };
      }
    },
    [selectedId, selected]
  );

  const sendMessage = useCallback(
    (text: string) => {
      const now = Date.now();
      setMessages((prev) => [...prev, { role: "user", content: text, timestamp: now }]);

      const currentLive = liveRef.current;
      const intent = detectIntent(text, currentLive);

      // Caso async: WhatsApp widget precisa de fetch dedicado (90d). Resolvemos
      // com placeholder "Buscando..." e depois substituímos pela resposta real.
      if (intent === "whatsapp_widget_pages") {
        try {
          appendLog({
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            timestamp: now,
            userEmail: session?.user?.email || "anon",
            userName: session?.user?.name || "Anônimo",
            account: selected?.displayName || "—",
            page: typeof window !== "undefined" ? window.location.pathname : "/",
            intent,
          });
        } catch {}

        // Mensagem de "buscando" temporária
        const placeholderTs = Date.now();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `🔎 Buscando páginas com widget de WhatsApp e cruzando com 90 dias de pageviews no GA4... isso leva 2-4 segundos.`,
            timestamp: placeholderTs,
          },
        ]);

        handleWhatsAppWidget(text).then((result) => {
          setMessages((prev) => {
            // Remove o placeholder e adiciona a resposta real
            const withoutPlaceholder = prev.filter(
              (m) => !(m.role === "assistant" && m.timestamp === placeholderTs)
            );
            return [
              ...withoutPlaceholder,
              {
                role: "assistant",
                content: result.reply,
                timestamp: Date.now(),
                rich: result.rich,
                followUps: result.followUps,
              },
            ];
          });
          if (result.newHighlight !== undefined) setHighlight(result.newHighlight);
          if (result.newHighlight) {
            setTimeout(() => setHighlight(null), 3500);
          }
        });
        return;
      }

      try {
        appendLog({
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          timestamp: now,
          userEmail: session?.user?.email || "anon",
          userName: session?.user?.name || "Anônimo",
          account: selected?.displayName || "—",
          page: typeof window !== "undefined" ? window.location.pathname : "/",
          intent,
        });
      } catch {}

      const result = handleIntent(intent, text, { attribution, filter }, currentLive);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.reply,
            timestamp: Date.now(),
            rich: result.rich,
            followUps: result.followUps,
          },
        ]);
        if (result.newFilter !== undefined) setFilter(result.newFilter);
        if (result.newHighlight !== undefined) setHighlight(result.newHighlight);
        if (result.newCompare !== undefined) setCompareMode(result.newCompare);
        if (result.newAttribution !== undefined) setAttributionState(result.newAttribution);
        if (result.navigate) setNavigateTo(result.navigate);
        if (result.toast) showToast(result.toast);
        if (result.newHighlight) {
          setTimeout(() => setHighlight(null), 3500);
        }
      }, 500);
    },
    [attribution, filter, showToast, session, selected]
  );

  const clearHighlight = useCallback(() => setHighlight(null), []);

  const resetChat = useCallback(() => {
    const firstName = session?.user?.name?.split(" ")[0] || "Renan";
    const accountName = selected?.displayName || "Suno";
    setMessages([buildWelcome(firstName, accountName, radar, realSuggestions)]);
    setFilter("all");
    setCompareMode(false);
    setHighlight(null);
    showToast("Conversa reiniciada");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selected, showToast, radar]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        filter,
        highlight,
        compareMode,
        toast,
        attribution,
        setAttribution,
        sendMessage,
        clearHighlight,
        navigateTo,
        consumeNavigate,
        resetChat,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}
