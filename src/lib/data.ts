import type { Attribution } from "./chat-context";

export const kpisLastClick = [
  { label: "Usuários Ativos", value: 470860, delta: 12.4, color: "#7c5cff" },
  { label: "Sessões", value: 825746, delta: 8.7, color: "#10b981" },
  { label: "Pageviews", value: 1680670, delta: 15.2, color: "#3b82f6" },
  { label: "Conversões", value: 3611, delta: -2.1, color: "#f59e0b" },
];

export const kpisAssisted = [
  { label: "Usuários Ativos", value: 470860, delta: 12.4, color: "#7c5cff" },
  { label: "Sessões Influenciadas", value: 1247892, delta: 18.3, color: "#10b981" },
  { label: "Touchpoints Totais", value: 4382150, delta: 22.7, color: "#3b82f6" },
  { label: "Conversões Assistidas", value: 8247, delta: 14.6, color: "#f59e0b" },
];

export const trendDataLastClick = [
  { date: "01/04", sessoes: 24500, usuarios: 18200 },
  { date: "03/04", sessoes: 26800, usuarios: 19500 },
  { date: "05/04", sessoes: 28100, usuarios: 21000 },
  { date: "07/04", sessoes: 31200, usuarios: 23400 },
  { date: "09/04", sessoes: 29800, usuarios: 22100 },
  { date: "11/04", sessoes: 33500, usuarios: 25000 },
  { date: "13/04", sessoes: 35200, usuarios: 26800 },
  { date: "15/04", sessoes: 34100, usuarios: 25900 },
  { date: "17/04", sessoes: 37800, usuarios: 28400 },
  { date: "19/04", sessoes: 39200, usuarios: 29800 },
  { date: "21/04", sessoes: 38500, usuarios: 29100 },
  { date: "23/04", sessoes: 41200, usuarios: 31000 },
  { date: "25/04", sessoes: 43800, usuarios: 33200 },
  { date: "27/04", sessoes: 42500, usuarios: 32400 },
  { date: "29/04", sessoes: 45100, usuarios: 34500 },
];

export const trendDataAssisted = [
  { date: "01/04", sessoes: 38200, usuarios: 27500 },
  { date: "03/04", sessoes: 41800, usuarios: 30100 },
  { date: "05/04", sessoes: 44200, usuarios: 32800 },
  { date: "07/04", sessoes: 49100, usuarios: 36500 },
  { date: "09/04", sessoes: 47200, usuarios: 35200 },
  { date: "11/04", sessoes: 53800, usuarios: 39800 },
  { date: "13/04", sessoes: 56500, usuarios: 42100 },
  { date: "15/04", sessoes: 54900, usuarios: 41200 },
  { date: "17/04", sessoes: 60800, usuarios: 45100 },
  { date: "19/04", sessoes: 63100, usuarios: 47200 },
  { date: "21/04", sessoes: 62000, usuarios: 46500 },
  { date: "23/04", sessoes: 66300, usuarios: 49500 },
  { date: "25/04", sessoes: 70500, usuarios: 52800 },
  { date: "27/04", sessoes: 68400, usuarios: 51500 },
  { date: "29/04", sessoes: 72600, usuarios: 54800 },
];

export const topPagesLastClick = [
  { name: "/checkout", value: 132975, color: "#7c5cff" },
  { name: "/carteiras", value: 119498, color: "#10b981" },
  { name: "/asset/fundos/snel11", value: 87817, color: "#3b82f6" },
  { name: "/relatorios", value: 48238, color: "#f59e0b" },
  { name: "/lp/premium-30", value: 43517, color: "#ef4444" },
];

export const topPagesAssisted = [
  { name: "/blog/como-investir", value: 248920, color: "#7c5cff" },
  { name: "/asset/fundos/snel11", value: 215680, color: "#10b981" },
  { name: "/home", value: 187450, color: "#3b82f6" },
  { name: "/carteiras/dividendos", value: 156320, color: "#f59e0b" },
  { name: "/relatorios", value: 124800, color: "#ef4444" },
];

export const topEvents = [
  { name: "scroll_depth", value: 2158796 },
  { name: "page_view", value: 1680670 },
  { name: "session_start", value: 825746 },
  { name: "user_engagement", value: 494758 },
  { name: "first_visit", value: 470860 },
  { name: "user_login", value: 183225 },
  { name: "begin_checkout", value: 15298 },
  { name: "purchase", value: 3611 },
];

// Jornada real do usuário Suno
export const sunoJourney = [
  {
    stage: "Visita ao Site",
    event: "page_view / session_start",
    value: 470860,
    pct: 100,
    dropPct: 0,
    color: "#7c5cff",
    phase: "descoberta",
  },
  {
    stage: "Lead Capturado",
    event: "generate_lead (via LP)",
    value: 94172,
    pct: 20,
    dropPct: 80,
    color: "#8b5cff",
    phase: "descoberta",
  },
  {
    stage: "Conta Criada",
    event: "sign_up",
    value: 42378,
    pct: 9,
    dropPct: 55,
    color: "#a78bfa",
    phase: "ativação",
  },
  {
    stage: "Início Checkout",
    event: "begin_checkout",
    value: 15298,
    pct: 3.25,
    dropPct: 63.9,
    color: "#f59e0b",
    phase: "compra",
  },
  {
    stage: "Dados de Pagamento",
    event: "add_payment_info",
    value: 8742,
    pct: 1.86,
    dropPct: 42.9,
    color: "#f97316",
    phase: "compra",
  },
  {
    stage: "Compra Concluída",
    event: "purchase",
    value: 3611,
    pct: 0.77,
    dropPct: 58.7,
    color: "#10b981",
    phase: "compra",
  },
  {
    stage: "Área do Investidor",
    event: "user_login",
    value: 183225,
    pct: 0, // recorrente, não deriva direto do funil
    dropPct: 0,
    color: "#3b82f6",
    phase: "retenção",
    recurring: true,
  },
  {
    stage: "Up-sell / Cross-sell",
    event: "purchase (recorrente)",
    value: 1247,
    pct: 0,
    dropPct: 0,
    color: "#ec4899",
    phase: "expansão",
    recurring: true,
  },
];

export const funnelLastClick = [
  { stage: "Visitantes", value: 470860, pct: 100 },
  { stage: "Lead (LP)", value: 94172, pct: 20 },
  { stage: "Sign Up", value: 42378, pct: 9 },
  { stage: "Checkout", value: 15298, pct: 3.25 },
  { stage: "Compra", value: 3611, pct: 0.77 },
];

export const funnelAssisted = [
  { stage: "Touchpoint Inicial", value: 1247892, pct: 100 },
  { stage: "Engajamento", value: 524180, pct: 42 },
  { stage: "Lead Assistido", value: 198450, pct: 15.9 },
  { stage: "Checkout Influenciado", value: 52380, pct: 4.2 },
  { stage: "Conversão Atribuída", value: 8247, pct: 0.66 },
];

export function getKpis(attr: Attribution) {
  return attr === "last-click" ? kpisLastClick : kpisAssisted;
}
export function getTrendData(attr: Attribution) {
  return attr === "last-click" ? trendDataLastClick : trendDataAssisted;
}
export function getTopPages(attr: Attribution) {
  return attr === "last-click" ? topPagesLastClick : topPagesAssisted;
}
export function getFunnel(attr: Attribution) {
  return attr === "last-click" ? funnelLastClick : funnelAssisted;
}

// Dados realtime simulados (serão trocados pela Realtime API GA4)
export const realtimeActiveByMinute = Array.from({ length: 30 }, (_, i) => ({
  minute: `-${29 - i}m`,
  users: Math.floor(180 + Math.random() * 120 + Math.sin(i / 3) * 40),
}));

export const realtimeTopPages = [
  { path: "/asset/fundos/snel11", users: 87, trend: "up" as const },
  { path: "/carteiras/dividendos", users: 64, trend: "up" as const },
  { path: "/relatorios/semanal", users: 52, trend: "stable" as const },
  { path: "/home", users: 41, trend: "down" as const },
  { path: "/blog/como-investir-fiis", users: 38, trend: "up" as const },
  { path: "/checkout", users: 29, trend: "up" as const },
  { path: "/lp/premium-30", users: 22, trend: "stable" as const },
];

export const realtimeByDevice = [
  { name: "Mobile", value: 68, color: "#7c5cff" },
  { name: "Desktop", value: 28, color: "#10b981" },
  { name: "Tablet", value: 4, color: "#f59e0b" },
];

export const realtimeBySource = [
  { source: "Google Organic", users: 142 },
  { source: "Direct", users: 78 },
  { source: "Instagram", users: 45 },
  { source: "Google Ads", users: 38 },
  { source: "YouTube", users: 24 },
  { source: "Referral", users: 18 },
];

export const realtimeTopEvents = [
  { event: "page_view", count: 1842 },
  { event: "scroll_depth", count: 1254 },
  { event: "user_engagement", count: 687 },
  { event: "user_login", count: 124 },
  { event: "begin_checkout", count: 18 },
  { event: "purchase", count: 4 },
];

export const realtimeByCountry = [
  { country: "Brasil", users: 312, flag: "🇧🇷" },
  { country: "Portugal", users: 18, flag: "🇵🇹" },
  { country: "EUA", users: 9, flag: "🇺🇸" },
  { country: "Japão", users: 4, flag: "🇯🇵" },
  { country: "Argentina", users: 2, flag: "🇦🇷" },
];

// Relatórios tabulares
export type ReportRow = {
  dimension: string;
  sessions: number;
  users: number;
  pageviews: number;
  bounceRate: number;
  avgDuration: number;
  conversions: number;
  convRate: number;
  revenue: number;
  // Métricas novas alinhadas ao GA4 (Dimensão personalizada "sessão canais Suno rev. 08.2024")
  engagedSessions: number; // sessões engajadas (absoluto)
  sessionConvRate: number; // taxa de conversão por sessão (%)
  source?: string; // origem da sessão (sessionSource)
  medium?: string; // meio da sessão (sessionMedium)
};

// Canais personalizados da Suno — dimensão custom "sessão canais Suno rev. 08.2024"
// Os valores refletem o agrupamento customizado que o Renan configurou no GA4.
export const reportBySunoChannel: ReportRow[] = [
  { dimension: "SEO Conteúdo", source: "google", medium: "organic", sessions: 412180, users: 248240, pageviews: 842120, bounceRate: 36.8, avgDuration: 228, engagedSessions: 272840, conversions: 1512, convRate: 0.37, sessionConvRate: 0.37, revenue: 212480 },
  { dimension: "SEO Institucional", source: "google", medium: "organic", sessions: 100181, users: 58420, pageviews: 200060, bounceRate: 40.2, avgDuration: 198, engagedSessions: 59880, conversions: 330, convRate: 0.33, sessionConvRate: 0.33, revenue: 42500 },
  { dimension: "Direto", source: "(direct)", medium: "(none)", sessions: 158204, users: 92180, pageviews: 321850, bounceRate: 42.1, avgDuration: 195, engagedSessions: 91640, conversions: 784, convRate: 0.50, sessionConvRate: 0.50, revenue: 108760 },
  { dimension: "Paid Search Brand", source: "google", medium: "cpc", sessions: 48120, users: 33240, pageviews: 98480, bounceRate: 31.2, avgDuration: 186, engagedSessions: 33124, conversions: 348, convRate: 0.72, sessionConvRate: 0.72, revenue: 48920 },
  { dimension: "Paid Search Non-Brand", source: "google", medium: "cpc", sessions: 36000, users: 25000, pageviews: 74000, bounceRate: 58.4, avgDuration: 98, engagedSessions: 14976, conversions: 164, convRate: 0.46, sessionConvRate: 0.46, revenue: 23530 },
  { dimension: "Meta Ads Aquisição", source: "meta", medium: "paid-social", sessions: 29840, users: 22640, pageviews: 56820, bounceRate: 62.4, avgDuration: 84, engagedSessions: 11212, conversions: 112, convRate: 0.38, sessionConvRate: 0.38, revenue: 16820 },
  { dimension: "Meta Ads Retarget", source: "meta", medium: "paid-social", sessions: 13010, users: 8780, pageviews: 21800, bounceRate: 36.8, avgDuration: 198, engagedSessions: 8224, conversions: 216, convRate: 1.66, sessionConvRate: 1.66, revenue: 48200 },
  { dimension: "Email CRM", source: "suno", medium: "email", sessions: 18240, users: 14820, pageviews: 48720, bounceRate: 28.4, avgDuration: 312, engagedSessions: 13060, conversions: 248, convRate: 1.36, sessionConvRate: 1.36, revenue: 42180 },
  { dimension: "Referral Parceiros", source: "parceiro", medium: "referral", sessions: 9971, users: 7850, pageviews: 16820, bounceRate: 48.2, avgDuration: 168, engagedSessions: 5164, conversions: 97, convRate: 0.97, sessionConvRate: 0.97, revenue: 14820 },
  { dimension: "YouTube Orgânico", source: "youtube", medium: "organic-video", sessions: 8420, users: 7210, pageviews: 13820, bounceRate: 52.4, avgDuration: 142, engagedSessions: 4008, conversions: 24, convRate: 0.28, sessionConvRate: 0.28, revenue: 3480 },
  { dimension: "TikTok Ads", source: "tiktok", medium: "paid-social", sessions: 18420, users: 16420, pageviews: 24820, bounceRate: 72.1, avgDuration: 58, engagedSessions: 5132, conversions: 18, convRate: 0.10, sessionConvRate: 0.10, revenue: 2480 },
  { dimension: "LinkedIn Ads", source: "linkedin", medium: "paid-social", sessions: 3420, users: 2980, pageviews: 7420, bounceRate: 38.4, avgDuration: 284, engagedSessions: 2106, conversions: 48, convRate: 1.40, sessionConvRate: 1.40, revenue: 18420 },
  { dimension: "Podcast Suno", source: "podcast", medium: "audio", sessions: 6420, users: 5842, pageviews: 10820, bounceRate: 42.8, avgDuration: 312, engagedSessions: 3671, conversions: 64, convRate: 1.00, sessionConvRate: 1.00, revenue: 12400 },
  { dimension: "App Push", source: "app", medium: "push", sessions: 4820, users: 4240, pageviews: 12420, bounceRate: 24.8, avgDuration: 284, engagedSessions: 3625, conversions: 92, convRate: 1.91, sessionConvRate: 1.91, revenue: 18240 },
  { dimension: "Outros / Não classificado", source: "(not set)", medium: "(not set)", sessions: 2840, users: 2120, pageviews: 4820, bounceRate: 68.2, avgDuration: 42, engagedSessions: 903, conversions: 4, convRate: 0.14, sessionConvRate: 0.14, revenue: 520 },
];

export const reportByChannel: ReportRow[] = [
  { dimension: "Organic Search", source: "google", medium: "organic", sessions: 512361, users: 298420, pageviews: 1042180, bounceRate: 38.2, avgDuration: 218, engagedSessions: 316624, conversions: 1842, convRate: 0.36, sessionConvRate: 0.36, revenue: 254980 },
  { dimension: "Direct", source: "(direct)", medium: "(none)", sessions: 158204, users: 92180, pageviews: 321850, bounceRate: 42.1, avgDuration: 195, engagedSessions: 91640, conversions: 784, convRate: 0.5, sessionConvRate: 0.5, revenue: 108760 },
  { dimension: "Paid Search", source: "google", medium: "cpc", sessions: 84120, users: 58240, pageviews: 172480, bounceRate: 45.8, avgDuration: 142, engagedSessions: 45593, conversions: 512, convRate: 0.61, sessionConvRate: 0.61, revenue: 72450 },
  { dimension: "Social", source: "meta", medium: "paid-social", sessions: 42850, users: 31420, pageviews: 78620, bounceRate: 58.3, avgDuration: 98, engagedSessions: 17868, conversions: 128, convRate: 0.3, sessionConvRate: 0.3, revenue: 18240 },
  { dimension: "Email", source: "suno", medium: "email", sessions: 18240, users: 14820, pageviews: 48720, bounceRate: 28.4, avgDuration: 312, engagedSessions: 13060, conversions: 248, convRate: 1.36, sessionConvRate: 1.36, revenue: 42180 },
  { dimension: "Referral", source: "parceiro", medium: "referral", sessions: 9971, users: 7850, pageviews: 16820, bounceRate: 48.2, avgDuration: 168, engagedSessions: 5164, conversions: 97, convRate: 0.97, sessionConvRate: 0.97, revenue: 14820 },
];

export const reportByPage: ReportRow[] = [
  { dimension: "/asset/fundos/snel11", sessions: 87817, users: 62480, pageviews: 142850, bounceRate: 32.1, avgDuration: 284, engagedSessions: 59627, conversions: 412, convRate: 0.47, sessionConvRate: 0.47, revenue: 58420 },
  { dimension: "/carteiras", sessions: 119498, users: 84520, pageviews: 198420, bounceRate: 35.8, avgDuration: 246, engagedSessions: 76718, conversions: 584, convRate: 0.49, sessionConvRate: 0.49, revenue: 82480 },
  { dimension: "/home", sessions: 87450, users: 72180, pageviews: 124820, bounceRate: 42.5, avgDuration: 148, engagedSessions: 50284, conversions: 148, convRate: 0.17, sessionConvRate: 0.17, revenue: 21480 },
  { dimension: "/blog/como-investir", sessions: 48920, users: 42180, pageviews: 68420, bounceRate: 54.2, avgDuration: 312, engagedSessions: 22405, conversions: 84, convRate: 0.17, sessionConvRate: 0.17, revenue: 11820 },
  { dimension: "/checkout", sessions: 15298, users: 15298, pageviews: 32480, bounceRate: 18.2, avgDuration: 184, engagedSessions: 12514, conversions: 3611, convRate: 23.6, sessionConvRate: 23.6, revenue: 512480 },
  { dimension: "/lp/premium-30", sessions: 43517, users: 38420, pageviews: 48920, bounceRate: 62.4, avgDuration: 124, engagedSessions: 16362, conversions: 842, convRate: 1.93, sessionConvRate: 1.93, revenue: 118420 },
  { dimension: "/relatorios", sessions: 48238, users: 32180, pageviews: 124820, bounceRate: 28.4, avgDuration: 384, engagedSessions: 34538, conversions: 128, convRate: 0.27, sessionConvRate: 0.27, revenue: 18240 },
];

export const reportByDevice: ReportRow[] = [
  { dimension: "Mobile", sessions: 561507, users: 320185, pageviews: 1142850, bounceRate: 44.2, avgDuration: 168, engagedSessions: 313320, conversions: 1842, convRate: 0.33, sessionConvRate: 0.33, revenue: 248520 },
  { dimension: "Desktop", sessions: 231207, users: 118420, pageviews: 462180, bounceRate: 32.1, avgDuration: 298, engagedSessions: 156989, conversions: 1524, convRate: 0.66, sessionConvRate: 0.66, revenue: 218480 },
  { dimension: "Tablet", sessions: 33030, users: 32255, pageviews: 75640, bounceRate: 48.5, avgDuration: 142, engagedSessions: 17010, conversions: 245, convRate: 0.74, sessionConvRate: 0.74, revenue: 45420 },
];

export const reportByCampaign: ReportRow[] = [
  { dimension: "premium-30-search", source: "google", medium: "cpc", sessions: 32480, users: 24820, pageviews: 68420, bounceRate: 32.1, avgDuration: 218, engagedSessions: 22054, conversions: 484, convRate: 1.49, sessionConvRate: 1.49, revenue: 68480 },
  { dimension: "brand-google", source: "google", medium: "cpc", sessions: 24820, users: 18420, pageviews: 42180, bounceRate: 28.4, avgDuration: 246, engagedSessions: 17771, conversions: 312, convRate: 1.26, sessionConvRate: 1.26, revenue: 45820 },
  { dimension: "snel11-display", source: "google", medium: "display", sessions: 14820, users: 12480, pageviews: 24820, bounceRate: 54.2, avgDuration: 124, engagedSessions: 6787, conversions: 84, convRate: 0.57, sessionConvRate: 0.57, revenue: 12480 },
  { dimension: "retargeting-carteira", source: "meta", medium: "paid-social", sessions: 8420, users: 6420, pageviews: 18420, bounceRate: 42.1, avgDuration: 198, engagedSessions: 4875, conversions: 124, convRate: 1.47, sessionConvRate: 1.47, revenue: 18240 },
  { dimension: "youtube-educacao", source: "youtube", medium: "paid-video", sessions: 6240, users: 5420, pageviews: 9820, bounceRate: 68.4, avgDuration: 98, engagedSessions: 1972, conversions: 24, convRate: 0.38, sessionConvRate: 0.38, revenue: 3480 },
  { dimension: "meta-carteira-dividendos", source: "meta", medium: "paid-social", sessions: 11820, users: 9840, pageviews: 22480, bounceRate: 48.2, avgDuration: 142, engagedSessions: 6123, conversions: 148, convRate: 1.25, sessionConvRate: 1.25, revenue: 21480 },
  { dimension: "linkedin-b2b-asset", source: "linkedin", medium: "paid-social", sessions: 3420, users: 2980, pageviews: 7420, bounceRate: 38.4, avgDuration: 284, engagedSessions: 2106, conversions: 48, convRate: 1.4, sessionConvRate: 1.4, revenue: 18420 },
  { dimension: "tiktok-educacao-fiis", source: "tiktok", medium: "paid-social", sessions: 18420, users: 16420, pageviews: 24820, bounceRate: 72.1, avgDuration: 58, engagedSessions: 5132, conversions: 18, convRate: 0.1, sessionConvRate: 0.1, revenue: 2480 },
];

// Dados de mídia paga (Google Ads + Meta + LinkedIn + TikTok + YouTube)
export type CampaignMediaRow = {
  campaign: string;
  platform: "Google Ads" | "Meta Ads" | "LinkedIn Ads" | "TikTok Ads" | "YouTube Ads";
  type: "Search" | "Display" | "Social" | "Video" | "Retargeting";
  status: "ativa" | "pausada" | "encerrada";
  impressions: number;
  clicks: number;
  ctr: number; // %
  spend: number; // R$
  cpc: number; // R$
  sessions: number;
  conversions: number;
  convRate: number; // %
  cpa: number; // R$
  revenue: number; // R$
  roas: number; // x
};

export const campaignMediaData: CampaignMediaRow[] = [
  {
    campaign: "premium-30-search", platform: "Google Ads", type: "Search", status: "ativa",
    impressions: 842180, clicks: 32480, ctr: 3.86, spend: 16240, cpc: 0.50,
    sessions: 32480, conversions: 484, convRate: 1.49, cpa: 33.55, revenue: 68480, roas: 4.22,
  },
  {
    campaign: "brand-google", platform: "Google Ads", type: "Search", status: "ativa",
    impressions: 124820, clicks: 24820, ctr: 19.88, spend: 8420, cpc: 0.34,
    sessions: 24820, conversions: 312, convRate: 1.26, cpa: 27.0, revenue: 45820, roas: 5.44,
  },
  {
    campaign: "retargeting-carteira", platform: "Meta Ads", type: "Retargeting", status: "ativa",
    impressions: 284180, clicks: 8420, ctr: 2.96, spend: 3840, cpc: 0.46,
    sessions: 8420, conversions: 124, convRate: 1.47, cpa: 30.97, revenue: 18240, roas: 4.75,
  },
  {
    campaign: "meta-carteira-dividendos", platform: "Meta Ads", type: "Social", status: "ativa",
    impressions: 684200, clicks: 11820, ctr: 1.73, spend: 5920, cpc: 0.50,
    sessions: 11820, conversions: 148, convRate: 1.25, cpa: 40.0, revenue: 21480, roas: 3.63,
  },
  {
    campaign: "snel11-display", platform: "Google Ads", type: "Display", status: "ativa",
    impressions: 1284820, clicks: 14820, ctr: 1.15, spend: 4820, cpc: 0.33,
    sessions: 14820, conversions: 84, convRate: 0.57, cpa: 57.38, revenue: 12480, roas: 2.59,
  },
  {
    campaign: "youtube-educacao", platform: "YouTube Ads", type: "Video", status: "ativa",
    impressions: 542180, clicks: 6240, ctr: 1.15, spend: 2480, cpc: 0.40,
    sessions: 6240, conversions: 24, convRate: 0.38, cpa: 103.33, revenue: 3480, roas: 1.40,
  },
  {
    campaign: "linkedin-b2b-asset", platform: "LinkedIn Ads", type: "Social", status: "ativa",
    impressions: 84200, clicks: 3420, ctr: 4.06, spend: 4820, cpc: 1.41,
    sessions: 3420, conversions: 48, convRate: 1.40, cpa: 100.42, revenue: 18420, roas: 3.82,
  },
  {
    campaign: "tiktok-educacao-fiis", platform: "TikTok Ads", type: "Social", status: "pausada",
    impressions: 984200, clicks: 18420, ctr: 1.87, spend: 3240, cpc: 0.18,
    sessions: 18420, conversions: 18, convRate: 0.10, cpa: 180.0, revenue: 2480, roas: 0.77,
  },
];

export const platformColors: Record<string, string> = {
  "Google Ads": "#4285f4",
  "Meta Ads": "#1877f2",
  "LinkedIn Ads": "#0a66c2",
  "TikTok Ads": "#ff0050",
  "YouTube Ads": "#ff0000",
};

// Conversões — detalhe por evento de conversão
export type ConversionGoal = {
  name: string;
  event: string;
  count: number;
  value: number;
  avgValue: number;
  delta: number;
  rate: number;
};

// Eventos Suno — conjunto oficial do funil
//  view_item        → visualizou item/produto na LP
//  generate_lead    → Lead capturado
//  sign_up          → Conta criada (também mapeia lead_create_account → sign_up)
//  begin_checkout   → iniciou checkout
//  add_shipping_info → preencheu dados de pagamento/entrega
//  purchase         → compra concluída (inclui todas: nova + recorrente)
//  abandoned_checkout → begin_checkout sem purchase em 24h (custom event)
export const conversionGoals: ConversionGoal[] = [
  { name: "Visualizou Item (LP)", event: "view_item", count: 287420, value: 0, avgValue: 0, delta: 14.2, rate: 61.0 },
  { name: "Lead", event: "generate_lead", count: 94172, value: 0, avgValue: 0, delta: 8.4, rate: 20.0 },
  { name: "Conta Criada", event: "sign_up / lead_create_account", count: 42378, value: 0, avgValue: 0, delta: 5.2, rate: 9.0 },
  { name: "Início Checkout", event: "begin_checkout", count: 15298, value: 0, avgValue: 0, delta: -4.8, rate: 3.25 },
  { name: "Dados de Pagamento", event: "add_shipping_info", count: 8742, value: 0, avgValue: 0, delta: -2.1, rate: 1.86 },
  { name: "Compras (total)", event: "purchase", count: 4858, value: 747960, avgValue: 154, delta: 2.8, rate: 1.03 },
  { name: "Checkout Abandonado", event: "abandoned_checkout", count: 10440, value: 0, avgValue: 0, delta: -6.2, rate: 68.2 },
];

// ============================================================
// Regra de abandoned_checkout (validação)
// ============================================================
// Evento custom disparado via GTM trigger que monitora sessões com
// begin_checkout mas SEM purchase dentro da janela de 24h.
// begin_checkout (15298) - purchase_attributable (4858) = 10440 abandonos
export const abandonedCheckoutRule = {
  trigger: "begin_checkout_fired == true AND purchase_fired == false",
  window: "24h após o begin_checkout",
  exclusions: [
    "Sessões de bot (detecção via user_agent + ga4_internal_user)",
    "Sessões com add_to_cart mas sem begin_checkout real (guard-rail)",
    "Usuários internos/staff (via custom dimension 'user_type')",
  ],
  lastValidation: {
    timestamp: "2026-04-18 09:14",
    beginCheckoutCount: 15298,
    purchaseInWindow: 4858,
    abandonedExpected: 10440,
    abandonedActual: 10440,
    matchRate: 100,
    status: "ok" as "ok" | "warning" | "error",
    notes: "Regra valida 1:1 — taxa de abandono 68.2%, dentro do benchmark do setor (65-75%).",
  },
  recovery: {
    emailRecoveryOpen: 42.5, // % abertura
    emailRecoveryClick: 12.8,
    recoveredPurchases: 842, // % do abandono recuperado
    recoveryRate: 8.1,
  },
};

// ============================================================
// Conversões — tendência por evento (últimos 30 dias)
// ============================================================
export const conversionsByEventTrend = Array.from({ length: 30 }, (_, i) => ({
  day: `${String(i + 1).padStart(2, "0")}/04`,
  view_item: Math.floor(8500 + Math.random() * 2000 + Math.sin(i / 3) * 800),
  generate_lead: Math.floor(2800 + Math.random() * 800),
  sign_up: Math.floor(1200 + Math.random() * 400),
  begin_checkout: Math.floor(450 + Math.random() * 180),
  add_shipping_info: Math.floor(240 + Math.random() * 120),
  purchase: Math.floor(140 + Math.random() * 80 + Math.sin(i / 3) * 20),
  abandoned_checkout: Math.floor(300 + Math.random() * 120),
}));

// Caminhos de conversão (top paths)
export const conversionPaths = [
  { path: "Organic Search → /carteiras → /checkout → Compra", count: 1248, value: 178420, days: 1 },
  { path: "Direct → /home → /asset/snel11 → /checkout → Compra", count: 847, value: 120480, days: 3 },
  { path: "Paid Search → /lp/premium-30 → /checkout → Compra", count: 684, value: 98420, days: 1 },
  { path: "Organic → /blog → Email → /checkout → Compra", count: 421, value: 58420, days: 14 },
  { path: "Social → /blog → Organic → /checkout → Compra", count: 248, value: 34820, days: 28 },
];

// Tempo até conversão
export const timeToConvert = [
  { bucket: "Mesmo dia", count: 1842, pct: 51 },
  { bucket: "1-3 dias", count: 724, pct: 20 },
  { bucket: "4-7 dias", count: 421, pct: 11.7 },
  { bucket: "8-14 dias", count: 312, pct: 8.6 },
  { bucket: "15-30 dias", count: 218, pct: 6 },
  { bucket: "+30 dias", count: 94, pct: 2.6 },
];

// Conversões por dia (últimos 30)
export const conversionsByDay = Array.from({ length: 30 }, (_, i) => ({
  day: `${String(i + 1).padStart(2, "0")}/04`,
  purchases: Math.floor(80 + Math.random() * 80 + Math.sin(i / 3) * 20),
  leads: Math.floor(2800 + Math.random() * 1200),
  revenue: Math.floor(10000 + Math.random() * 15000),
}));

// Audiência — demografia
export const audienceByAge = [
  { range: "18-24", users: 38420, pct: 8.2 },
  { range: "25-34", users: 142580, pct: 30.3 },
  { range: "35-44", users: 156240, pct: 33.2 },
  { range: "45-54", users: 84120, pct: 17.9 },
  { range: "55-64", users: 34280, pct: 7.3 },
  { range: "65+", users: 15220, pct: 3.2 },
];

export const audienceByGender = [
  { name: "Masculino", value: 68, color: "#7c5cff" },
  { name: "Feminino", value: 30, color: "#ec4899" },
  { name: "Não informado", value: 2, color: "#94a3b8" },
];

export const audienceByState = [
  { state: "SP", users: 178420, pct: 37.9 },
  { state: "RJ", users: 84280, pct: 17.9 },
  { state: "MG", users: 52180, pct: 11.1 },
  { state: "RS", users: 34820, pct: 7.4 },
  { state: "PR", users: 28420, pct: 6.0 },
  { state: "SC", users: 24180, pct: 5.1 },
  { state: "BA", users: 18240, pct: 3.9 },
  { state: "DF", users: 16420, pct: 3.5 },
  { state: "PE", users: 12420, pct: 2.6 },
  { state: "CE", users: 9820, pct: 2.1 },
  { state: "Outros", users: 11680, pct: 2.5 },
];

export const audienceInterests = [
  { category: "Investimentos em FIIs", affinity: 94 },
  { category: "Renda Fixa", affinity: 78 },
  { category: "Ações e Bolsa", affinity: 72 },
  { category: "Educação Financeira", affinity: 68 },
  { category: "Dividendos", affinity: 84 },
  { category: "Planejamento Financeiro", affinity: 62 },
  { category: "Criptomoedas", affinity: 28 },
  { category: "Imóveis", affinity: 54 },
];

export const audienceCohorts = [
  { cohort: "Mar/26", size: 42380, w1: 100, w2: 68, w3: 52, w4: 42, w8: 34, w12: 28 },
  { cohort: "Fev/26", size: 38420, w1: 100, w2: 72, w3: 54, w4: 44, w8: 36, w12: 30 },
  { cohort: "Jan/26", size: 36180, w1: 100, w2: 70, w3: 55, w4: 45, w8: 37, w12: 31 },
  { cohort: "Dez/25", size: 32420, w1: 100, w2: 65, w3: 48, w4: 38, w8: 30, w12: 24 },
];

export const audienceByTech = {
  browser: [
    { name: "Chrome", pct: 64 },
    { name: "Safari", pct: 22 },
    { name: "Edge", pct: 8 },
    { name: "Firefox", pct: 4 },
    { name: "Outros", pct: 2 },
  ],
  os: [
    { name: "Android", pct: 42 },
    { name: "iOS", pct: 28 },
    { name: "Windows", pct: 22 },
    { name: "macOS", pct: 7 },
    { name: "Linux", pct: 1 },
  ],
};

export const activeUsersStats = {
  dau: 48240,
  wau: 184820,
  mau: 470860,
  stickiness: 25.6, // DAU/MAU
  avgSessions: 1.75,
  avgDuration: 218,
  engagedSessions: 62.4,
};

// Páginas — lista completa
export const allPages = [
  { path: "/home", views: 187450, users: 124820, avgTime: 148, bounceRate: 42.5, exitRate: 28.4, entry: 84120 },
  { path: "/carteiras", views: 198420, users: 84520, avgTime: 246, bounceRate: 35.8, exitRate: 18.2, entry: 12480 },
  { path: "/asset/fundos/snel11", views: 142850, users: 62480, avgTime: 284, bounceRate: 32.1, exitRate: 24.8, entry: 38420 },
  { path: "/relatorios", views: 124820, users: 32180, avgTime: 384, bounceRate: 28.4, exitRate: 14.2, entry: 8420 },
  { path: "/blog/como-investir", views: 68420, users: 42180, avgTime: 312, bounceRate: 54.2, exitRate: 58.4, entry: 32480 },
  { path: "/lp/premium-30", views: 48920, users: 38420, avgTime: 124, bounceRate: 62.4, exitRate: 42.1, entry: 38420 },
  { path: "/checkout", views: 32480, users: 15298, avgTime: 184, bounceRate: 18.2, exitRate: 48.2, entry: 420 },
  { path: "/login", views: 248920, users: 183225, avgTime: 42, bounceRate: 12.4, exitRate: 8.2, entry: 18420 },
  { path: "/dashboard", views: 184280, users: 128420, avgTime: 412, bounceRate: 18.4, exitRate: 22.1, entry: 0 },
  { path: "/carteiras/dividendos", views: 156320, users: 84520, avgTime: 298, bounceRate: 32.4, exitRate: 20.1, entry: 14820 },
];

// Eventos — catálogo completo
export const allEvents = [
  { name: "page_view", count: 1680670, users: 470860, status: "ok", critical: false },
  { name: "scroll_depth", count: 2158796, users: 412480, status: "ok", critical: false },
  { name: "session_start", count: 825746, users: 470860, status: "ok", critical: false },
  { name: "user_engagement", count: 494758, users: 380420, status: "ok", critical: false },
  { name: "first_visit", count: 470860, users: 470860, status: "ok", critical: false },
  { name: "user_login", count: 183225, users: 128420, status: "ok", critical: true },
  { name: "generate_lead", count: 94172, users: 94172, status: "ok", critical: true },
  { name: "sign_up", count: 42378, users: 42378, status: "ok", critical: true },
  { name: "begin_checkout", count: 15298, users: 15298, status: "ok", critical: true },
  { name: "add_shipping_info", count: 8742, users: 8742, status: "warning", critical: true },
  { name: "purchase", count: 3611, users: 3611, status: "ok", critical: true },
  { name: "purchase_recurring", count: 1247, users: 984, status: "ok", critical: true },
  { name: "file_download", count: 8420, users: 6420, status: "ok", critical: false },
  { name: "video_play", count: 24820, users: 18420, status: "ok", critical: false },
  { name: "search", count: 42180, users: 28420, status: "ok", critical: false },
  { name: "add_to_wishlist", count: 12480, users: 8420, status: "missing", critical: false },
];

// ============================================================
// TRACKING — páginas completas (URL inteira) + colunas extras
// ============================================================
export type TrackingStatus = "ok" | "warning" | "error" | "missing";

export type TrackingPage = {
  url: string; // URL completa
  shortPath: string;
  gtm: TrackingStatus;
  events: TrackingStatus;
  lead: TrackingStatus; // generate_lead
  purchase: TrackingStatus;
  lastCheck: string;
  status: TrackingStatus;
  // extra detail for modal
  pageviews30d: number;
  leadCount30d: number;
  purchaseCount30d: number;
  gtmContainer?: string;
  issues: string[];
  lastPurchaseAt?: string;
  lastLeadAt?: string;
};

export const trackingPages: TrackingPage[] = [
  {
    url: "https://www.suno.com.br/",
    shortPath: "/",
    gtm: "ok", events: "ok", lead: "ok", purchase: "ok",
    lastCheck: "2min", status: "ok",
    pageviews30d: 187450, leadCount30d: 12480, purchaseCount30d: 284,
    gtmContainer: "GTM-XSN8K3L",
    issues: [],
    lastPurchaseAt: "há 4min", lastLeadAt: "há 1min",
  },
  {
    url: "https://www.suno.com.br/carteiras",
    shortPath: "/carteiras",
    gtm: "ok", events: "ok", lead: "ok", purchase: "ok",
    lastCheck: "5min", status: "ok",
    pageviews30d: 198420, leadCount30d: 18420, purchaseCount30d: 584,
    gtmContainer: "GTM-XSN8K3L",
    issues: [],
    lastPurchaseAt: "há 2min", lastLeadAt: "agora",
  },
  {
    url: "https://www.suno.com.br/asset/fundos/snel11?utm_source=google&utm_medium=cpc&utm_campaign=snel11-display",
    shortPath: "/asset/fundos/snel11",
    gtm: "ok", events: "ok", lead: "ok", purchase: "warning",
    lastCheck: "3min", status: "warning",
    pageviews30d: 142850, leadCount30d: 4820, purchaseCount30d: 412,
    gtmContainer: "GTM-XSN8K3L",
    issues: ["Purchase sem value em 14% dos disparos", "eventCallback opcional ausente"],
    lastPurchaseAt: "há 18min", lastLeadAt: "há 3min",
  },
  {
    url: "https://www.suno.com.br/lp/premium-30?utm_source=google&utm_medium=cpc&utm_campaign=premium-30-search&utm_content=headline-a",
    shortPath: "/lp/premium-30",
    gtm: "error", events: "error", lead: "error", purchase: "error",
    lastCheck: "12min", status: "error",
    pageviews30d: 43517, leadCount30d: 0, purchaseCount30d: 0,
    issues: [
      "Container GTM não detectado no HTML (deploy 10:42)",
      "generate_lead não disparou nas últimas 24h",
      "dataLayer não inicializado",
    ],
    lastPurchaseAt: "—", lastLeadAt: "há 14h",
  },
  {
    url: "https://www.suno.com.br/lp/black-friday-2026?utm_source=email&utm_medium=crm&utm_campaign=BlackFriday2026&utm_content=hero",
    shortPath: "/lp/black-friday-2026",
    gtm: "ok", events: "warning", lead: "ok", purchase: "ok",
    lastCheck: "8min", status: "warning",
    pageviews30d: 68420, leadCount30d: 9840, purchaseCount30d: 184,
    gtmContainer: "GTM-XSN8K3L",
    issues: ["Evento scroll_depth duplicado em 18% das sessões"],
    lastPurchaseAt: "há 1h", lastLeadAt: "há 4min",
  },
  {
    url: "https://www.suno.com.br/relatorios",
    shortPath: "/relatorios",
    gtm: "ok", events: "ok", lead: "missing", purchase: "ok",
    lastCheck: "4min", status: "warning",
    pageviews30d: 124820, leadCount30d: 0, purchaseCount30d: 148,
    gtmContainer: "GTM-XSN8K3L",
    issues: ["generate_lead não implementado (página tem CTA de newsletter)"],
    lastPurchaseAt: "há 8min", lastLeadAt: "—",
  },
  {
    url: "https://www.suno.com.br/carteiras/dividendos",
    shortPath: "/carteiras/dividendos",
    gtm: "ok", events: "ok", lead: "ok", purchase: "ok",
    lastCheck: "6min", status: "ok",
    pageviews30d: 156320, leadCount30d: 8240, purchaseCount30d: 372,
    gtmContainer: "GTM-XSN8K3L",
    issues: [],
    lastPurchaseAt: "há 3min", lastLeadAt: "há 2min",
  },
  {
    url: "https://www.suno.com.br/lp/consultoria-vip?utm_source=linkedin&utm_medium=social&utm_campaign=vip_q2",
    shortPath: "/lp/consultoria-vip",
    gtm: "error", events: "error", lead: "error", purchase: "error",
    lastCheck: "1h", status: "error",
    pageviews30d: 18240, leadCount30d: 0, purchaseCount30d: 0,
    issues: ["Container GTM-XSN8K3L removido do HTML", "UTM com underscore (padrão usa hífen)"],
    lastPurchaseAt: "—", lastLeadAt: "—",
  },
  {
    url: "https://www.suno.com.br/blog/como-investir-em-fiis?utm_source=organic",
    shortPath: "/blog/como-investir-em-fiis",
    gtm: "ok", events: "warning", lead: "ok", purchase: "ok",
    lastCheck: "15min", status: "warning",
    pageviews30d: 68420, leadCount30d: 2420, purchaseCount30d: 48,
    gtmContainer: "GTM-XSN8K3L",
    issues: ["UTM incompleto: medium e campaign ausentes"],
    lastPurchaseAt: "há 2h", lastLeadAt: "há 12min",
  },
  {
    url: "https://www.suno.com.br/app/download",
    shortPath: "/app/download",
    gtm: "ok", events: "ok", lead: "ok", purchase: "ok",
    lastCheck: "7min", status: "ok",
    pageviews30d: 42180, leadCount30d: 8420, purchaseCount30d: 0,
    gtmContainer: "GTM-XSN8K3L",
    issues: [],
    lastPurchaseAt: "n/a", lastLeadAt: "há 6min",
  },
];

// ============================================================
// TRACKING — UTM Audit
// ============================================================
export type UTMIssue = "ok" | "missing" | "case-mismatch" | "separator" | "invalid" | "empty";

export type UTMRow = {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
  sessions: number;
  conversions: number;
  issues: { field: string; type: UTMIssue; message: string }[];
};

// Taxonomia padrão Suno: lowercase + hífen (não underscore)
export const utmRows: UTMRow[] = [
  {
    source: "google", medium: "cpc", campaign: "premium-30-search", content: "headline-a",
    sessions: 32480, conversions: 484, issues: [],
  },
  {
    source: "google", medium: "cpc", campaign: "brand-google",
    sessions: 24820, conversions: 312, issues: [],
  },
  {
    source: "Facebook", medium: "CPC", campaign: "retargeting_carteira",
    sessions: 8420, conversions: 124,
    issues: [
      { field: "source", type: "case-mismatch", message: "Use lowercase: 'facebook'" },
      { field: "medium", type: "case-mismatch", message: "Use lowercase: 'cpc'" },
      { field: "campaign", type: "separator", message: "Padrão Suno usa hífen, não underscore: 'retargeting-carteira'" },
    ],
  },
  {
    source: "meta", medium: "social", campaign: "meta-carteira-dividendos",
    sessions: 11820, conversions: 148, issues: [],
  },
  {
    source: "instagram", medium: "", campaign: "organic-reels",
    sessions: 4820, conversions: 32,
    issues: [{ field: "medium", type: "empty", message: "utm_medium vazio — padronize como 'social'" }],
  },
  {
    source: "email", medium: "crm", campaign: "BlackFriday2026", content: "hero",
    sessions: 6240, conversions: 148,
    issues: [{ field: "campaign", type: "case-mismatch", message: "Use kebab-case: 'black-friday-2026'" }],
  },
  {
    source: "linkedin", medium: "social", campaign: "vip_q2",
    sessions: 3420, conversions: 48,
    issues: [{ field: "campaign", type: "separator", message: "Padrão Suno usa hífen: 'vip-q2'" }],
  },
  {
    source: "tiktok", medium: "paid-social", campaign: "tiktok-educacao-fiis",
    sessions: 18420, conversions: 18, issues: [],
  },
  {
    source: "(not set)", medium: "(not set)", campaign: "(not set)",
    sessions: 4820, conversions: 22,
    issues: [
      { field: "source", type: "missing", message: "UTM ausente — tráfego classificado como (not set)" },
      { field: "medium", type: "missing", message: "UTM ausente" },
      { field: "campaign", type: "missing", message: "UTM ausente" },
    ],
  },
  {
    source: "youtube", medium: "video", campaign: "youtube-educacao",
    sessions: 6240, conversions: 24, issues: [],
  },
];

export const utmStandards = {
  pattern: "lowercase + kebab-case (hífens)",
  requiredFields: ["utm_source", "utm_medium", "utm_campaign"],
  optionalFields: ["utm_content", "utm_term"],
  allowedMediums: ["cpc", "social", "email", "crm", "paid-social", "video", "display", "organic", "referral"],
};

// ============================================================
// Jornada Fantasma + Cross-Device
// ============================================================
export type PhantomJourney = {
  userId: string; // hash anônimo
  firstTouch: string;
  lastTouch: string;
  devices: string[];
  sessions: number;
  gapDays: number;
  converted: boolean;
  revenue?: number;
  reason: string;
};

export const phantomJourneys: PhantomJourney[] = [
  {
    userId: "u_a8f2e1",
    firstTouch: "Google Organic · Mobile iOS",
    lastTouch: "Direct · Desktop Windows",
    devices: ["iPhone 14", "Desktop Chrome"],
    sessions: 8,
    gapDays: 12,
    converted: true,
    revenue: 1840,
    reason: "Pesquisou no mobile, comprou no desktop — atribuição last-click vai para Direct",
  },
  {
    userId: "u_c3d9b4",
    firstTouch: "Meta Ads · Mobile Android",
    lastTouch: "Google Organic · Mobile Android",
    devices: ["Galaxy S23"],
    sessions: 5,
    gapDays: 7,
    converted: true,
    revenue: 1240,
    reason: "Anúncio pago converteu via busca de marca — crédito pago subestimado",
  },
  {
    userId: "u_e7a1f3",
    firstTouch: "YouTube Ads · Desktop",
    lastTouch: "Direct · Mobile",
    devices: ["Desktop Mac", "iPhone 13"],
    sessions: 12,
    gapDays: 21,
    converted: false,
    reason: "Alta exposição sem conversão — candidato a retargeting cross-device",
  },
  {
    userId: "u_b2c8d5",
    firstTouch: "Instagram Organic · Mobile",
    lastTouch: "Email CRM · Desktop",
    devices: ["iPhone 12", "Desktop Windows"],
    sessions: 6,
    gapDays: 4,
    converted: true,
    revenue: 980,
    reason: "Jornada social → email → conversão cross-device",
  },
  {
    userId: "u_f4e9a2",
    firstTouch: "Google Organic · Mobile",
    lastTouch: "Google Organic · Desktop",
    devices: ["Pixel 7", "Desktop Linux"],
    sessions: 4,
    gapDays: 9,
    converted: true,
    revenue: 1420,
    reason: "Usuário logado — GA4 User-ID reconciliou a jornada",
  },
];

export const crossDeviceStats = {
  totalUsers: 470860,
  crossDeviceUsers: 84240, // 17.9%
  crossDeviceRate: 17.9,
  avgDevicesPerUser: 1.34,
  identifiedViaUserId: 62180, // logados
  identifiedRate: 73.8, // % dos cross-device identificados via User-ID
  mainPaths: [
    { from: "Mobile", to: "Desktop", users: 42820, convRate: 2.4 },
    { from: "Desktop", to: "Mobile", users: 24180, convRate: 1.8 },
    { from: "Mobile", to: "Tablet", users: 8420, convRate: 0.9 },
    { from: "Desktop", to: "Mobile → Desktop", users: 8820, convRate: 3.1 },
  ],
  recommendations: [
    "Ative Google Signals para unificar jornadas cross-device de usuários logados no Google",
    "User-ID está identificando 73.8% dos cross-device — meta: 85%+",
    "Mobile → Desktop converte 2.4% vs 1.5% single-device — reforce retargeting cross-device",
  ],
};

export const accounts = [
  "Suno Research",
  "Suno Consultoria",
  "Suno Asset",
  "Status Invest",
  "Funds Explorer",
  "Fiis",
  "Agro20",
  "Certifiquei",
  "Eleven Financial",
  "Fiagro",
  "Scanfii",
  "Simpatio",
];
