import { auth } from "@/auth";

const GA4_DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const GA4_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";

type GA4Response<T> = { data: T | null; error: string | null };

// Cache em memória do access_token gerado via refresh_token (cron context).
// Access tokens duram 1h — cacheamos por 50 min pra evitar refresh constante.
let __cachedCronToken: { token: string; expiresAt: number } | null = null;

async function refreshAccessTokenFromCronRefreshToken(): Promise<string | null> {
  const refreshToken = process.env.BRIEFING_REFRESH_TOKEN;
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;

  // Cache valid?
  if (__cachedCronToken && Date.now() < __cachedCronToken.expiresAt) {
    return __cachedCronToken.token;
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !data.access_token) return null;
    __cachedCronToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 600 * 1000, // -10min de margem
    };
    return data.access_token;
  } catch {
    return null;
  }
}

async function getTokenAndError(): Promise<{ token: string | null; authError: string | null }> {
  const session = (await auth()) as { accessToken?: string; authError?: string } | null;
  // Caminho normal: usa sessão do usuário logado
  if (session?.accessToken) {
    return { token: session.accessToken, authError: session?.authError ?? null };
  }
  // Caminho cron: sem sessão (chamada de script externo) — usa refresh_token do env
  const cronToken = await refreshAccessTokenFromCronRefreshToken();
  if (cronToken) {
    return { token: cronToken, authError: null };
  }
  return { token: null, authError: session?.authError ?? "no_session" };
}

async function ga4Fetch<T>(url: string, body?: unknown): Promise<GA4Response<T>> {
  const { token, authError } = await getTokenAndError();
  if (authError) return { data: null, error: `auth_${authError}` };
  if (!token) return { data: null, error: "no_session" };

  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        return { data: null, error: "token_expired (relogue com Google para renovar o acesso)" };
      }
      if (res.status === 403) {
        return {
          data: null,
          error: "sem_permissao (verifique se o scope analytics.readonly foi aceito e se a conta tem acesso ao GA4)",
        };
      }
      return { data: null, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "unknown" };
  }
}

export type GA4Property = {
  id: string;
  name: string;
  displayName: string;
  account: string;
  createTime?: string;
};

type AdminAccountSummary = {
  name: string;
  displayName: string;
  propertySummaries?: { property: string; displayName: string }[];
};

export async function listProperties(): Promise<GA4Response<GA4Property[]>> {
  const res = await ga4Fetch<{ accountSummaries: AdminAccountSummary[] }>(
    `${GA4_ADMIN_BASE}/accountSummaries?pageSize=50`
  );
  if (res.error || !res.data) return { data: null, error: res.error };

  const properties: GA4Property[] = [];
  for (const acc of res.data.accountSummaries || []) {
    for (const p of acc.propertySummaries || []) {
      properties.push({
        id: p.property.replace("properties/", ""),
        name: p.property,
        displayName: p.displayName,
        account: acc.displayName,
      });
    }
  }
  return { data: properties, error: null };
}

type RunReportBody = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics?: { name: string }[];
  metricAggregations?: ("TOTAL" | "MINIMUM" | "MAXIMUM" | "COUNT")[];
  orderBys?: {
    metric?: { metricName: string };
    dimension?: { dimensionName: string; orderType?: "ALPHANUMERIC" | "CASE_INSENSITIVE_ALPHANUMERIC" | "NUMERIC" };
    desc?: boolean;
  }[];
  limit?: number;
  dimensionFilter?: {
    filter?: {
      fieldName: string;
      stringFilter?: { value: string; matchType?: "EXACT" | "BEGINS_WITH" | "ENDS_WITH" | "CONTAINS" | "FULL_REGEXP" | "PARTIAL_REGEXP"; caseSensitive?: boolean };
      inListFilter?: { values: string[]; caseSensitive?: boolean };
      numericFilter?: { operation: "EQUAL" | "LESS_THAN" | "LESS_THAN_OR_EQUAL" | "GREATER_THAN" | "GREATER_THAN_OR_EQUAL"; value: { int64Value?: string; doubleValue?: number } };
    };
    andGroup?: { expressions: unknown[] };
    orGroup?: { expressions: unknown[] };
    notExpression?: unknown;
  };
};

type GA4ReportResponse = {
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  totals?: { metricValues?: { value: string }[] }[];
};

export async function runReport(propertyId: string, body: RunReportBody) {
  return ga4Fetch<GA4ReportResponse>(
    `${GA4_DATA_BASE}/properties/${propertyId}:runReport`,
    body
  );
}

export async function runRealtimeReport(propertyId: string, body: Omit<RunReportBody, "dateRanges">) {
  return ga4Fetch<GA4ReportResponse>(
    `${GA4_DATA_BASE}/properties/${propertyId}:runRealtimeReport`,
    body
  );
}

// Período alinhado com a UI do GA4 (KPIs / trend / pages / events principais).
// endDate = "yesterday" para bater com o painel GA4 (que, por padrão, considera até ontem).
// Retornamos também o intervalo em ISO pra a UI mostrar "2024-03-21 → 2024-04-19".
function buildDateRange(days: number, customStart?: string | null, customEnd?: string | null) {
  // Se o caller passou um range customizado válido, honra ele.
  if (customStart && customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customStart) && /^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
    return {
      startDate: customStart,
      endDate: customEnd,
      ga4Range: { startDate: customStart, endDate: customEnd },
    };
  }
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // ontem
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startDate: iso(start),
    endDate: iso(end),
    ga4Range: { startDate: iso(start), endDate: iso(end) },
  };
}

// Variante que INCLUI hoje (usada por eventos, conversões, funil e LPs,
// que historicamente usavam `${days}daysAgo`/`today`). Respeita range custom.
// Se não tem custom range, devolve o formato relativo do GA4 pra não mexer em nada.
function buildDateRangeIncludingToday(
  days: number,
  customStart?: string | null,
  customEnd?: string | null
) {
  if (
    customStart &&
    customEnd &&
    /^\d{4}-\d{2}-\d{2}$/.test(customStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(customEnd)
  ) {
    return {
      startDate: customStart,
      endDate: customEnd,
      ga4Range: { startDate: customStart, endDate: customEnd },
    };
  }
  // Mantém o comportamento original (inclui hoje) — NÃO quebra eventos recém-disparados
  return {
    startDate: `${days}daysAgo`,
    endDate: "today",
    ga4Range: { startDate: `${days}daysAgo`, endDate: "today" },
  };
}

// High-level helpers (compose raw API into shape the UI consumes)
export async function getKpis(propertyId: string, days = 30, startDate?: string | null, endDate?: string | null) {
  const range = buildDateRange(days, startDate, endDate);

  // Tentativa 1: tudo (keyEvents + engagedSessions + bounceRate) — GA4 moderno
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "keyEvents" },
      { name: "engagedSessions" },
      { name: "bounceRate" },
    ],
  });
  if (!res.error && res.data?.totals?.[0]?.metricValues) {
    const v = res.data.totals[0].metricValues.map((m) => Number(m.value || 0));
    return {
      data: {
        activeUsers: v[0],
        sessions: v[1],
        pageviews: v[2],
        conversions: v[3],
        engagedSessions: v[4] || 0,
        bounceRate: Number(((v[5] || 0) * 100).toFixed(1)),
        range,
        metricNames: { users: "totalUsers", conversions: "keyEvents" },
      },
      error: null,
    };
  }

  // Tentativa 2: troca keyEvents por conversions (properties mais antigas)
  const fallback = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "conversions" },
      { name: "engagedSessions" },
      { name: "bounceRate" },
    ],
  });
  if (!fallback.error && fallback.data?.totals?.[0]?.metricValues) {
    const v = fallback.data.totals[0].metricValues.map((m) => Number(m.value || 0));
    return {
      data: {
        activeUsers: v[0],
        sessions: v[1],
        pageviews: v[2],
        conversions: v[3],
        engagedSessions: v[4] || 0,
        bounceRate: Number(((v[5] || 0) * 100).toFixed(1)),
        range,
        metricNames: { users: "totalUsers", conversions: "conversions" },
      },
      error: null,
    };
  }

  // Tentativa 3 (SEMPRE FUNCIONA): só métricas básicas, sem engagedSessions nem
  // bounceRate. Algumas properties B2B / regulamentadas restringem essas métricas.
  // Aqui derivamos engagedSessions/bounceRate de uma segunda chamada — se falhar,
  // ainda retornamos os 4 KPIs core para o chat não quebrar.
  const minimal = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "keyEvents" },
    ],
  });
  let v: number[] | null = null;
  let convLabel: string = "keyEvents";
  if (!minimal.error && minimal.data?.totals?.[0]?.metricValues) {
    v = minimal.data.totals[0].metricValues.map((m) => Number(m.value || 0));
  } else {
    // Última tentativa: troca keyEvents por conversions
    const minimalAlt = await runReport(propertyId, {
      dateRanges: [range.ga4Range],
      metrics: [
        { name: "totalUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "conversions" },
      ],
    });
    if (!minimalAlt.error && minimalAlt.data?.totals?.[0]?.metricValues) {
      v = minimalAlt.data.totals[0].metricValues.map((m) => Number(m.value || 0));
      convLabel = "conversions";
    }
  }

  if (!v) {
    return { data: null, error: minimal.error || fallback.error || res.error };
  }

  // Tenta puxar engagedSessions e bounceRate em chamada SEPARADA — se falhar, ok,
  // o chat tem fallback estimando 65% de engajamento e 35% de rejeição.
  let engagedSessions = 0;
  let bounceRate = 0;
  try {
    const engageRes = await runReport(propertyId, {
      dateRanges: [range.ga4Range],
      metrics: [{ name: "engagedSessions" }, { name: "bounceRate" }],
    });
    if (!engageRes.error && engageRes.data?.totals?.[0]?.metricValues) {
      const ev = engageRes.data.totals[0].metricValues.map((m) => Number(m.value || 0));
      engagedSessions = ev[0] || 0;
      bounceRate = Number(((ev[1] || 0) * 100).toFixed(1));
    }
  } catch {
    // ignora — usa estimativa heurística
  }
  if (engagedSessions === 0 && v[1] > 0) {
    engagedSessions = Math.round(v[1] * 0.65);
  }
  if (bounceRate === 0 && v[1] > 0) {
    bounceRate = Number((100 - (engagedSessions / v[1]) * 100).toFixed(1));
  }

  return {
    data: {
      activeUsers: v[0],
      sessions: v[1],
      pageviews: v[2],
      conversions: v[3],
      engagedSessions,
      bounceRate,
      range,
      metricNames: { users: "totalUsers", conversions: convLabel },
    },
    error: null,
  };
}

export async function getTrend(propertyId: string, days = 30, startDate?: string | null, endDate?: string | null) {
  const range = buildDateRange(days, startDate, endDate);
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
  });
  if (res.error || !res.data?.rows) return { data: null, error: res.error };
  const rows = res.data.rows.map((r) => ({
    date: r.dimensionValues?.[0]?.value || "",
    sessoes: Number(r.metricValues?.[0]?.value || 0),
    usuarios: Number(r.metricValues?.[1]?.value || 0),
  }));
  return { data: rows, error: null };
}

/**
 * Compara várias landing pages × dimensão escolhida (canal, fonte/meio,
 * campanha, etc.). Métricas: users, sessões, sessões engajadas, bounce
 * rate, conversões.
 *
 * Faz UMA query agregada (eficiente) e filtra por URL no servidor.
 * Aceita URLs absolutas (https://...) ou paths puros (/cl/webinario-...).
 *
 * Sobre filtragem por audiência custom (ex.: "SUNO"):
 * a Data API v1 do GA4 NÃO suporta filtrar por nome de audiência custom
 * em queries normais — precisa de Audience Export (admin GA4) OU
 * Custom Dimension de usuário. Veja: getLPChannelsByAudienceExport().
 */
export type LPBreakdownDimension =
  | "channel" // sessionDefaultChannelGroup
  | "sourceMedium" // sessionSource / sessionMedium
  | "source" // sessionSource
  | "medium" // sessionMedium
  | "campaign" // sessionCampaignName
  | "deviceCategory" // deviceCategory
  | "country"; // country

const DIMENSION_API_NAME: Record<LPBreakdownDimension, string | string[]> = {
  channel: "sessionDefaultChannelGroup",
  sourceMedium: ["sessionSource", "sessionMedium"], // 2 dims, junta "source / medium"
  source: "sessionSource",
  medium: "sessionMedium",
  campaign: "sessionCampaignName",
  deviceCategory: "deviceCategory",
  country: "country",
};

export type LPBreakdownRow = {
  label: string; // valor da dimensão (canal, fonte, etc.)
  users: number;
  sessions: number;
  engagedSessions: number;
  bounceRate: number; // %
  conversions: number;
};
export type LPChannelResult = {
  url: string;
  matched: boolean;
  totalUsers: number;
  totalSessions: number;
  totalEngagedSessions: number;
  avgBounceRate: number; // % ponderada por sessões
  totalConversions: number;
  byChannel: LPBreakdownRow[]; // mantido `byChannel` por compat retroativa, mas é "byBreakdown"
};

function parseUrl(input: string): { host: string | null; path: string } {
  try {
    const u = new URL(input);
    return { host: u.hostname, path: u.pathname.replace(/\/+$/, "") || "/" };
  } catch {
    // Não é URL absoluta — assume que já é path
    return { host: null, path: input.replace(/\/+$/, "") || "/" };
  }
}

export async function getLPChannels(
  propertyId: string,
  urls: string[],
  days = 30,
  startDate?: string | null,
  endDate?: string | null,
  breakdownDimension: LPBreakdownDimension = "channel"
): Promise<{ data: LPChannelResult[] | null; error: string | null }> {
  if (urls.length === 0) return { data: [], error: null };

  const range = buildDateRange(days, startDate, endDate);
  const parsed = urls.map((u) => ({ original: u, ...parseUrl(u) }));

  // Resolve dimensões da API a partir do enum
  const dimMap = DIMENSION_API_NAME[breakdownDimension];
  const breakdownDims = Array.isArray(dimMap)
    ? dimMap.map((name) => ({ name }))
    : [{ name: dimMap }];

  // GA4 cobra cada dimensão extra. Padrão: hostName + pagePath + breakdown.
  // Métricas: totalUsers, sessions, engagedSessions, bounceRate, keyEvents (conversões).
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [
      { name: "hostName" },
      { name: "pagePath" },
      ...breakdownDims,
    ],
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "bounceRate" },
      { name: "keyEvents" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10000,
  });

  if (res.error || !res.data?.rows) {
    // Tentativa de fallback sem `keyEvents` (properties antigas usam `conversions`)
    const fb = await runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [
        { name: "hostName" },
        { name: "pagePath" },
        ...breakdownDims,
      ],
      metrics: [
        { name: "totalUsers" },
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "bounceRate" },
        { name: "conversions" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10000,
    });
    if (fb.error || !fb.data?.rows) {
      return { data: null, error: fb.error || res.error || "no_rows" };
    }
    res.data = fb.data;
  }

  // Indexa rows
  type Row = {
    host: string;
    path: string;
    label: string;
    users: number;
    sessions: number;
    engagedSessions: number;
    bounceRate: number; // 0..1 do GA4
    conversions: number;
  };
  const breakdownDimCount = Array.isArray(dimMap) ? dimMap.length : 1;
  const rows: Row[] = (res.data?.rows || []).map((r) => {
    // hostName e pagePath são as 2 primeiras dimensões
    const host = r.dimensionValues?.[0]?.value || "";
    const path = (r.dimensionValues?.[1]?.value || "/").replace(/\/+$/, "") || "/";
    // Dimensões de breakdown vêm a partir do índice 2
    let label = "(not set)";
    if (breakdownDimCount === 1) {
      label = r.dimensionValues?.[2]?.value || "(not set)";
    } else {
      // Junta source / medium (ou similar)
      const parts: string[] = [];
      for (let i = 0; i < breakdownDimCount; i++) {
        parts.push(r.dimensionValues?.[2 + i]?.value || "(not set)");
      }
      label = parts.join(" / ");
    }
    return {
      host,
      path,
      label,
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
      engagedSessions: Number(r.metricValues?.[2]?.value || 0),
      bounceRate: Number(r.metricValues?.[3]?.value || 0), // 0..1
      conversions: Number(r.metricValues?.[4]?.value || 0),
    };
  });

  // Pra cada URL pedida, filtra rows que casam (host opcional, path obrigatório)
  const results: LPChannelResult[] = parsed.map((p) => {
    const matching = rows.filter((r) => {
      const pathMatches = r.path === p.path;
      const hostMatches = p.host ? r.host === p.host : true;
      return pathMatches && hostMatches;
    });

    const byChannelMap = new Map<string, LPBreakdownRow>();
    for (const m of matching) {
      const cur = byChannelMap.get(m.label) || {
        label: m.label,
        users: 0,
        sessions: 0,
        engagedSessions: 0,
        bounceRate: 0,
        conversions: 0,
      };
      cur.users += m.users;
      cur.sessions += m.sessions;
      cur.engagedSessions += m.engagedSessions;
      // bounceRate por linha é % daquela combinação; pra agregar fazemos média ponderada
      cur.bounceRate += m.bounceRate * m.sessions; // soma temporária, divide depois
      cur.conversions += m.conversions;
      byChannelMap.set(m.label, cur);
    }
    // Finaliza bounce rate (média ponderada)
    const byChannel = Array.from(byChannelMap.values())
      .map((c) => ({
        ...c,
        bounceRate: c.sessions > 0 ? Number(((c.bounceRate / c.sessions) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.users - a.users);

    const totalUsers = byChannel.reduce((s, c) => s + c.users, 0);
    const totalSessions = byChannel.reduce((s, c) => s + c.sessions, 0);
    const totalEngagedSessions = byChannel.reduce((s, c) => s + c.engagedSessions, 0);
    const totalConversions = byChannel.reduce((s, c) => s + c.conversions, 0);
    // Bounce rate global ponderado pelas sessões totais
    const totalBounceWeighted = byChannel.reduce((s, c) => s + (c.bounceRate / 100) * c.sessions, 0);
    const avgBounceRate = totalSessions > 0
      ? Number(((totalBounceWeighted / totalSessions) * 100).toFixed(1))
      : 0;

    return {
      url: p.original,
      matched: matching.length > 0,
      totalUsers,
      totalSessions,
      totalEngagedSessions,
      avgBounceRate,
      totalConversions,
      byChannel,
    };
  });

  return { data: results, error: null };
}

// ============================================================
// ANOMALIAS — comparativo D-1 vs baseline (mediana 14d)
// ============================================================
// Detecta variações significativas em 5 métricas-chave (users, sessions,
// engagedSessions, generate_lead, purchase) em 3 níveis: macro, canal, campanha.
//
// Estratégia: 1 query agregada por nível × tipo de métrica (sessões / eventos),
// no formato "1 linha por (data × dimensão)". A partir disso, monta time-series,
// calcula mediana dos últimos 14 dias e compara com o último dia.
//
// Severidade:
//   |delta| < 10%  → normal
//   10-25%         → attention
//   > 25%          → critical
// Filtro de baixo volume: ignora segmentos com baseline < 50.
// ============================================================

export type AnomalySeverity = "normal" | "attention" | "critical" | "low_volume";
export type AnomalyDirection = "up" | "down" | "stable";
export type AnomalyMetric = "users" | "sessions" | "engagedSessions" | "leads" | "purchases" | "revenue";
export type AnomalyLevel = "macro" | "channel" | "campaign";

export type Anomaly = {
  metric: AnomalyMetric;
  metricLabel: string;
  level: AnomalyLevel;
  segment: string; // "all" pro macro, nome do canal/campanha pros outros
  current: number;
  baseline: number; // mediana das últimas N exibitions
  delta: number; // % (positivo = subiu, negativo = caiu)
  severity: AnomalySeverity;
  direction: AnomalyDirection;
};

export type AnomaliesResponse = {
  propertyId: string;
  date: string; // D-1 (ontem)
  baselineRange: { startDate: string; endDate: string };
  baselineDays: number;
  dayOfWeekAware: boolean; // se a baseline foi filtrada pra mesmo DoW
  macro: Anomaly[];
  byChannel: Anomaly[];
  byCampaign: Anomaly[];
  briefing: string[]; // insights em linguagem natural
  rawCounts: { sessionRows: number; eventRows: number };
};

// Mediana ignora extremos — mais robusta que média
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyAnomaly(current: number, baseline: number): {
  delta: number;
  severity: AnomalySeverity;
  direction: AnomalyDirection;
} {
  // Volume baixo — evita falso positivo (1 → 3 = "+200%")
  if (baseline < 50 && current < 50) {
    return { delta: 0, severity: "low_volume", direction: "stable" };
  }
  if (baseline === 0) {
    return {
      delta: current > 0 ? 100 : 0,
      severity: current > 50 ? "critical" : "low_volume",
      direction: current > 0 ? "up" : "stable",
    };
  }
  const delta = ((current - baseline) / baseline) * 100;
  const abs = Math.abs(delta);
  let severity: AnomalySeverity = "normal";
  if (abs > 25) severity = "critical";
  else if (abs > 10) severity = "attention";
  const direction: AnomalyDirection = delta > 1 ? "up" : delta < -1 ? "down" : "stable";
  return { delta: Number(delta.toFixed(1)), severity, direction };
}

const METRIC_LABELS: Record<AnomalyMetric, string> = {
  users: "Usuários únicos",
  sessions: "Sessões",
  engagedSessions: "Sessões engajadas",
  leads: "Leads (generate_lead)",
  purchases: "Vendas (purchase)",
  revenue: "Receita (R$)",
};

/**
 * Day-of-week aware: pega só os dias da baseline com o MESMO dia da semana
 * que D-1 (ex.: se ontem foi quinta, compara só com últimas 4 quintas).
 *
 * Isso evita falsos positivos em padrões semanais — ex.: domingo sempre tem
 * tráfego menor; comparar domingo com a média da semana acende alarme falso.
 *
 * Se não houver pelo menos 2 dias do mesmo DoW na baseline, cai no comparativo
 * tradicional (mediana de TODOS os dias).
 */
function filterByDayOfWeek<T extends { date: string }>(
  series: T[],
  yesterdayDate: string
): T[] {
  // Parse YYYYMMDD pra Date
  const ymdToDate = (ymd: string): Date => {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(4, 6)) - 1;
    const d = Number(ymd.slice(6, 8));
    return new Date(y, m, d);
  };
  const targetDow = ymdToDate(yesterdayDate).getDay();
  const filtered = series.filter((s) => ymdToDate(s.date).getDay() === targetDow);
  // Se temos pelo menos 2 do mesmo DoW, usa filtrado. Senão, mantém todos.
  return filtered.length >= 2 ? filtered : series;
}

/**
 * Computa anomalias para uma propriedade.
 * @param propertyId  GA4 property id
 * @param baselineDays  Número de dias da baseline (default 14)
 */
export async function getAnomalies(
  propertyId: string,
  baselineDays = 14,
  options: { dayOfWeekAware?: boolean } = { dayOfWeekAware: true }
): Promise<{ data: AnomaliesResponse | null; error: string | null }> {
  // Janela: ontem (D-1) + N dias anteriores pra baseline
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startDate = new Date(yesterday);
  startDate.setDate(startDate.getDate() - baselineDays);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const range = { startDate: fmt(startDate), endDate: fmt(yesterday) };
  const dowAware = options.dayOfWeekAware !== false;

  // 1) Sessões por dia × canal × campanha (3 dimensões + métricas de sessão)
  // Alguns properties podem reclamar de 4 dimensões juntas, então fazemos 3 queries:
  // (a) por dia macro, (b) por dia × canal, (c) por dia × campanha
  const [sessMacro, sessChannel, sessCampaign, evMacro, evChannel, evCampaign] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [range],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "engagedSessions" }],
      orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
    }),
    runReport(propertyId, {
      dateRanges: [range],
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "engagedSessions" }],
      limit: 5000,
    }),
    runReport(propertyId, {
      dateRanges: [range],
      dimensions: [{ name: "date" }, { name: "sessionCampaignName" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "engagedSessions" }],
      limit: 5000,
    }),
    runReport(propertyId, {
      dateRanges: [range],
      dimensions: [{ name: "date" }, { name: "eventName" }],
      // eventCount + eventValue (receita pra purchase)
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["generate_lead", "purchase", "lead_create_account", "sign_up"] },
        },
      },
      limit: 5000,
    }),
    runReport(propertyId, {
      dateRanges: [range],
      dimensions: [
        { name: "date" },
        { name: "eventName" },
        { name: "sessionDefaultChannelGroup" },
      ],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["generate_lead", "purchase", "lead_create_account", "sign_up"] },
        },
      },
      limit: 10000,
    }),
    runReport(propertyId, {
      dateRanges: [range],
      dimensions: [
        { name: "date" },
        { name: "eventName" },
        { name: "sessionCampaignName" },
      ],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["generate_lead", "purchase", "lead_create_account", "sign_up"] },
        },
      },
      limit: 10000,
    }),
  ]);

  if (sessMacro.error) return { data: null, error: `sessMacro: ${sessMacro.error}` };

  const sessRows = sessMacro.data?.rows || [];
  const eventRows = evMacro.data?.rows || [];

  // ===== MACRO =====
  // Agrega por dia (D-1 vs baseline 14d)
  type DailyAgg = { date: string; users: number; sessions: number; engaged: number };
  const dailyAggMap = new Map<string, DailyAgg>();
  for (const r of sessRows) {
    const date = r.dimensionValues?.[0]?.value || "";
    dailyAggMap.set(date, {
      date,
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
      engaged: Number(r.metricValues?.[2]?.value || 0),
    });
  }
  const dailyArr = Array.from(dailyAggMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const yesterdayDate = fmt(yesterday).replace(/-/g, "");
  const yesterdayAgg = dailyArr.find((d) => d.date === yesterdayDate);
  const baselineDayList = dailyArr.filter((d) => d.date !== yesterdayDate);

  // Eventos macro (lead + purchase) — agregar por dia, com receita
  type DailyEvent = { date: string; leads: number; purchases: number; revenue: number };
  const eventMap = new Map<string, DailyEvent>();
  for (const r of eventRows) {
    const date = r.dimensionValues?.[0]?.value || "";
    const ev = (r.dimensionValues?.[1]?.value || "").toLowerCase();
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const cur = eventMap.get(date) || { date, leads: 0, purchases: 0, revenue: 0 };
    if (ev.includes("lead") || ev.includes("sign_up")) cur.leads += count;
    if (ev.includes("purchase")) {
      cur.purchases += count;
      cur.revenue += value; // só consideramos receita do evento purchase
    }
    eventMap.set(date, cur);
  }
  const eventArr = Array.from(eventMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const yesterdayEvent = eventArr.find((d) => d.date === yesterdayDate);
  const baselineEventDays = eventArr.filter((d) => d.date !== yesterdayDate);

  // Helper: filtra séries por DoW se aplicável
  const filterSession = dowAware ? filterByDayOfWeek(baselineDayList, yesterdayDate) : baselineDayList;
  const filterEvent = dowAware ? filterByDayOfWeek(baselineEventDays, yesterdayDate) : baselineEventDays;

  const macro: Anomaly[] = [];
  const metricsCfg: { key: AnomalyMetric; current: number; series: number[] }[] = [
    {
      key: "users",
      current: yesterdayAgg?.users || 0,
      series: filterSession.map((d) => d.users),
    },
    {
      key: "sessions",
      current: yesterdayAgg?.sessions || 0,
      series: filterSession.map((d) => d.sessions),
    },
    {
      key: "engagedSessions",
      current: yesterdayAgg?.engaged || 0,
      series: filterSession.map((d) => d.engaged),
    },
    {
      key: "leads",
      current: yesterdayEvent?.leads || 0,
      series: filterEvent.map((d) => d.leads),
    },
    {
      key: "purchases",
      current: yesterdayEvent?.purchases || 0,
      series: filterEvent.map((d) => d.purchases),
    },
    {
      key: "revenue",
      current: yesterdayEvent?.revenue || 0,
      series: filterEvent.map((d) => d.revenue),
    },
  ];
  for (const cfg of metricsCfg) {
    const baseline = median(cfg.series);
    const cls = classifyAnomaly(cfg.current, baseline);
    macro.push({
      metric: cfg.key,
      metricLabel: METRIC_LABELS[cfg.key],
      level: "macro",
      segment: "all",
      current: Math.round(cfg.current),
      baseline: Math.round(baseline),
      ...cls,
    });
  }

  // ===== POR CANAL =====
  // Agrega: (canal × dia) → série por canal
  type ChannelDay = { channel: string; date: string; users: number; sessions: number; engaged: number };
  const channelDayList: ChannelDay[] = (sessChannel.data?.rows || []).map((r) => ({
    date: r.dimensionValues?.[0]?.value || "",
    channel: r.dimensionValues?.[1]?.value || "(not set)",
    users: Number(r.metricValues?.[0]?.value || 0),
    sessions: Number(r.metricValues?.[1]?.value || 0),
    engaged: Number(r.metricValues?.[2]?.value || 0),
  }));

  // Eventos por canal × dia × evento
  type EventChannelDay = { channel: string; date: string; leads: number; purchases: number; revenue: number };
  const eventChannelMap = new Map<string, EventChannelDay>();
  for (const r of evChannel.data?.rows || []) {
    const date = r.dimensionValues?.[0]?.value || "";
    const ev = (r.dimensionValues?.[1]?.value || "").toLowerCase();
    const channel = r.dimensionValues?.[2]?.value || "(not set)";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const key = `${channel}|${date}`;
    const cur = eventChannelMap.get(key) || { channel, date, leads: 0, purchases: 0, revenue: 0 };
    if (ev.includes("lead") || ev.includes("sign_up")) cur.leads += count;
    if (ev.includes("purchase")) {
      cur.purchases += count;
      cur.revenue += value;
    }
    eventChannelMap.set(key, cur);
  }

  const byChannel = computeAnomaliesPerSegment(
    "channel",
    channelDayList,
    Array.from(eventChannelMap.values()),
    yesterdayDate,
    dowAware
  );

  // ===== POR CAMPANHA =====
  type CampaignDay = { campaign: string; date: string; users: number; sessions: number; engaged: number };
  const campaignDayList: CampaignDay[] = (sessCampaign.data?.rows || []).map((r) => ({
    date: r.dimensionValues?.[0]?.value || "",
    campaign: r.dimensionValues?.[1]?.value || "(not set)",
    users: Number(r.metricValues?.[0]?.value || 0),
    sessions: Number(r.metricValues?.[1]?.value || 0),
    engaged: Number(r.metricValues?.[2]?.value || 0),
  }));
  const eventCampaignMap = new Map<string, EventChannelDay>();
  for (const r of evCampaign.data?.rows || []) {
    const date = r.dimensionValues?.[0]?.value || "";
    const ev = (r.dimensionValues?.[1]?.value || "").toLowerCase();
    const campaign = r.dimensionValues?.[2]?.value || "(not set)";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const key = `${campaign}|${date}`;
    const cur = eventCampaignMap.get(key) || { channel: campaign, date, leads: 0, purchases: 0, revenue: 0 };
    if (ev.includes("lead") || ev.includes("sign_up")) cur.leads += count;
    if (ev.includes("purchase")) {
      cur.purchases += count;
      cur.revenue += value;
    }
    eventCampaignMap.set(key, cur);
  }
  // Reusa o helper trocando channel→campaign no shape
  const byCampaign = computeAnomaliesPerSegment(
    "campaign",
    campaignDayList.map((c) => ({ channel: c.campaign, date: c.date, users: c.users, sessions: c.sessions, engaged: c.engaged })),
    Array.from(eventCampaignMap.values()),
    yesterdayDate,
    dowAware
  );

  // ===== BRIEFING (linguagem natural) =====
  const briefing = buildBriefing(macro, byChannel, byCampaign);

  return {
    data: {
      propertyId,
      date: fmt(yesterday),
      baselineRange: range,
      baselineDays,
      dayOfWeekAware: dowAware,
      macro,
      byChannel,
      byCampaign,
      briefing,
      rawCounts: {
        sessionRows: sessRows.length,
        eventRows: eventRows.length,
      },
    },
    error: null,
  };
}

// Helper: pra cada segmento (canal/campanha), monta série temporal e classifica.
// Quando `dowAware=true`, filtra a baseline de cada segmento pra incluir só os
// dias da mesma DoW que ontem (ex.: ontem foi quinta → compara com últimas quintas).
function computeAnomaliesPerSegment(
  level: AnomalyLevel,
  sessRows: { channel: string; date: string; users: number; sessions: number; engaged: number }[],
  eventRows: { channel: string; date: string; leads: number; purchases: number; revenue: number }[],
  yesterdayDate: string,
  dowAware: boolean = true
): Anomaly[] {
  // Agrupa por segmento — armazena dia + valor pra cada métrica (preserva data
  // pra filtragem por DoW depois)
  type Series = { date: string; value: number };
  const segMap = new Map<
    string,
    {
      users: Series[]; sessions: Series[]; engaged: Series[];
      leads: Series[]; purchases: Series[]; revenue: Series[];
      currentUsers: number; currentSessions: number; currentEngaged: number;
      currentLeads: number; currentPurchases: number; currentRevenue: number;
    }
  >();

  function ensure(seg: string) {
    if (!segMap.has(seg)) {
      segMap.set(seg, {
        users: [], sessions: [], engaged: [], leads: [], purchases: [], revenue: [],
        currentUsers: 0, currentSessions: 0, currentEngaged: 0,
        currentLeads: 0, currentPurchases: 0, currentRevenue: 0,
      });
    }
    return segMap.get(seg)!;
  }

  for (const r of sessRows) {
    const cur = ensure(r.channel);
    if (r.date === yesterdayDate) {
      cur.currentUsers = r.users;
      cur.currentSessions = r.sessions;
      cur.currentEngaged = r.engaged;
    } else {
      cur.users.push({ date: r.date, value: r.users });
      cur.sessions.push({ date: r.date, value: r.sessions });
      cur.engaged.push({ date: r.date, value: r.engaged });
    }
  }
  for (const r of eventRows) {
    const cur = ensure(r.channel);
    if (r.date === yesterdayDate) {
      cur.currentLeads = r.leads;
      cur.currentPurchases = r.purchases;
      cur.currentRevenue = r.revenue;
    } else {
      cur.leads.push({ date: r.date, value: r.leads });
      cur.purchases.push({ date: r.date, value: r.purchases });
      cur.revenue.push({ date: r.date, value: r.revenue });
    }
  }

  // Helper: extrai array de valores filtrado por DoW se aplicável
  function extractValues(series: Series[]): number[] {
    const filtered = dowAware ? filterByDayOfWeek(series, yesterdayDate) : series;
    return filtered.map((s) => s.value);
  }

  const out: Anomaly[] = [];
  for (const [seg, agg] of segMap.entries()) {
    const metricsList: { key: AnomalyMetric; current: number; series: number[] }[] = [
      { key: "users", current: agg.currentUsers, series: extractValues(agg.users) },
      { key: "sessions", current: agg.currentSessions, series: extractValues(agg.sessions) },
      { key: "engagedSessions", current: agg.currentEngaged, series: extractValues(agg.engaged) },
      { key: "leads", current: agg.currentLeads, series: extractValues(agg.leads) },
      { key: "purchases", current: agg.currentPurchases, series: extractValues(agg.purchases) },
      { key: "revenue", current: Math.round(agg.currentRevenue), series: extractValues(agg.revenue).map(Math.round) },
    ];
    for (const m of metricsList) {
      const baseline = median(m.series);
      // Se o segmento nunca teve dados (baseline 0 e current 0), pula
      if (baseline === 0 && m.current === 0) continue;
      const cls = classifyAnomaly(m.current, baseline);
      out.push({
        metric: m.key,
        metricLabel: METRIC_LABELS[m.key],
        level,
        segment: seg,
        current: Math.round(m.current),
        baseline: Math.round(baseline),
        ...cls,
      });
    }
  }
  // Ordena por severidade (críticos primeiro), depois por |delta| desc
  const severityOrder: Record<AnomalySeverity, number> = {
    critical: 0,
    attention: 1,
    normal: 2,
    low_volume: 3,
  };
  out.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  return out;
}

// Helper: gera o briefing em linguagem natural (3-5 bullets)
function buildBriefing(
  macro: Anomaly[],
  byChannel: Anomaly[],
  byCampaign: Anomaly[]
): string[] {
  const briefing: string[] = [];
  const fmt = (n: number) => {
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(Math.round(n));
  };
  const fmtBRL = (n: number) => `R$ ${fmt(n)}`;
  const isMoney = (m: AnomalyMetric) => m === "revenue";

  // Destaque especial pra revenue, se houver anomalia
  const revenueAnomaly = macro.find((a) => a.metric === "revenue");
  if (revenueAnomaly && (revenueAnomaly.severity === "critical" || revenueAnomaly.severity === "attention")) {
    const arrow = revenueAnomaly.direction === "down" ? "🔻 caiu" : "🚀 subiu";
    const tone = revenueAnomaly.severity === "critical" && revenueAnomaly.direction === "down" ? "🔴" : revenueAnomaly.direction === "down" ? "🟡" : "🟢";
    briefing.push(
      `${tone} **Receita ${arrow} ${Math.abs(revenueAnomaly.delta).toFixed(0)}%** vs baseline (esperado: ${fmtBRL(revenueAnomaly.baseline)} · atual: ${fmtBRL(revenueAnomaly.current)}).`
    );
  }

  // 1) Pega a anomalia macro mais crítica
  const criticalMacro = macro.filter((a) => a.severity === "critical");
  if (criticalMacro.length > 0) {
    const a = criticalMacro[0];
    const arrow = a.direction === "down" ? "🔻 caíram" : "🔺 subiram";
    const tone = a.direction === "down" ? "🔴" : "🟢";
    briefing.push(
      `${tone} **${a.metricLabel} ${arrow} ${Math.abs(a.delta).toFixed(0)}%** vs baseline (esperado: ${fmt(a.baseline)} · atual: ${fmt(a.current)}).`
    );
  } else {
    const attention = macro.filter((a) => a.severity === "attention");
    if (attention.length > 0) {
      const a = attention[0];
      briefing.push(
        `🟡 **Atenção:** ${a.metricLabel} variou ${a.delta > 0 ? "+" : ""}${a.delta.toFixed(0)}% (esperado: ${fmt(a.baseline)} · atual: ${fmt(a.current)}).`
      );
    } else {
      briefing.push(`🟢 **KPIs macro estáveis** — todas as 5 métricas dentro de ±10% da baseline.`);
    }
  }

  // 2) Maior driver no nível canal (anomalia mais crítica)
  const criticalChannels = byChannel.filter((a) => a.severity === "critical").slice(0, 2);
  for (const a of criticalChannels) {
    const arrow = a.direction === "down" ? "🔻" : "🔺";
    briefing.push(
      `${arrow} **${a.segment}** (${a.metricLabel}): ${a.delta > 0 ? "+" : ""}${a.delta.toFixed(0)}% — investigue.`
    );
  }

  // 3) Maior driver no nível campanha
  const criticalCampaigns = byCampaign
    .filter((a) => a.severity === "critical" && a.segment !== "(not set)")
    .slice(0, 2);
  for (const a of criticalCampaigns) {
    const arrow = a.direction === "down" ? "🔻" : "🔺";
    briefing.push(
      `${arrow} Campanha **${a.segment}** (${a.metricLabel}): ${a.delta > 0 ? "+" : ""}${a.delta.toFixed(0)}%.`
    );
  }

  // 4) Destaque positivo
  const goodMacro = macro
    .filter((a) => a.severity !== "low_volume" && a.delta > 15)
    .sort((a, b) => b.delta - a.delta)[0];
  if (goodMacro && criticalMacro.length === 0) {
    briefing.push(
      `🚀 **Destaque positivo:** ${goodMacro.metricLabel} subiu ${goodMacro.delta.toFixed(0)}% (+${fmt(goodMacro.current - goodMacro.baseline)}).`
    );
  }

  return briefing.length > 0 ? briefing : ["✅ Nenhuma anomalia significativa detectada — tudo dentro do esperado."];
}

export async function getTopPages(propertyId: string, limit = 10, days = 30, startDate?: string | null, endDate?: string | null) {
  const range = buildDateRange(days, startDate, endDate);
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  if (res.error || !res.data?.rows) return { data: null, error: res.error };
  const rows = res.data.rows.map((r) => ({
    name: r.dimensionValues?.[0]?.value || "",
    value: Number(r.metricValues?.[0]?.value || 0),
    users: Number(r.metricValues?.[1]?.value || 0),
  }));
  return { data: rows, error: null };
}

export async function getTopEvents(propertyId: string, limit = 10, days = 30, startDate?: string | null, endDate?: string | null) {
  // Eventos usam include-today: usuário precisa enxergar disparos recentes,
  // inclusive de hoje (senão eventos novos "somem" do dashboard até o dia seguinte).
  const range = buildDateRangeIncludingToday(days, startDate, endDate);
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit,
  });
  if (res.error || !res.data?.rows) return { data: null, error: res.error };
  const rows = res.data.rows.map((r) => ({
    name: r.dimensionValues?.[0]?.value || "",
    value: Number(r.metricValues?.[0]?.value || 0),
  }));
  return { data: rows, error: null };
}

// Relatórios — tenta primeiro a dimensão custom "sessão canais Suno rev. 08.2024";
// se falhar, cai para sessionDefaultChannelGroup. Sempre devolve também origem e meio.
// Configure o ID do custom via env GA4_CUSTOM_CHANNEL_DIM (ex.: "customEvent:session_canais_suno_rev_08_2024").
export type ReportByChannelRow = {
  dimension: string;
  source: string;
  medium: string;
  users: number;
  sessions: number;
  engagedSessions: number;
  conversions: number;
  sessionConvRate: number;
  revenue: number;
};

export async function getReportsByChannel(
  propertyId: string,
  days = 30,
  startDate?: string | null,
  endDate?: string | null
): Promise<GA4Response<{ rows: ReportByChannelRow[]; usedCustomDim: boolean }>> {
  const metricNames = [
    { name: "totalUsers" },
    { name: "sessions" },
    { name: "engagedSessions" },
    { name: "conversions" },
    { name: "sessionConversionRate" },
    { name: "totalRevenue" },
  ];
  const range = buildDateRangeIncludingToday(days, startDate, endDate);
  const dateRanges = [range.ga4Range];
  const customDim = process.env.GA4_CUSTOM_CHANNEL_DIM;

  // Tentativa 1: custom dim
  if (customDim) {
    const res = await runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: customDim }, { name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: metricNames,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
    });
    if (!res.error && res.data?.rows) {
      return {
        data: { rows: parseChannelRows(res.data.rows), usedCustomDim: true },
        error: null,
      };
    }
  }

  // Fallback: agrupamento padrão do GA4
  const res = await runReport(propertyId, {
    dateRanges,
    dimensions: [
      { name: "sessionDefaultChannelGroup" },
      { name: "sessionSource" },
      { name: "sessionMedium" },
    ],
    metrics: metricNames,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 50,
  });
  if (res.error || !res.data?.rows) return { data: null, error: res.error };
  return {
    data: { rows: parseChannelRows(res.data.rows), usedCustomDim: false },
    error: null,
  };
}

type GA4Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

function parseChannelRows(rows: GA4Row[]): ReportByChannelRow[] {
  return rows.map((r) => {
    const d = r.dimensionValues || [];
    const m = r.metricValues || [];
    return {
      dimension: d[0]?.value || "(não classificado)",
      source: d[1]?.value || "(direct)",
      medium: d[2]?.value || "(none)",
      users: Number(m[0]?.value || 0),
      sessions: Number(m[1]?.value || 0),
      engagedSessions: Number(m[2]?.value || 0),
      conversions: Number(m[3]?.value || 0),
      sessionConvRate: Number(m[4]?.value || 0) * 100, // GA4 retorna decimal
      revenue: Number(m[5]?.value || 0),
    };
  });
}

// Eventos de conversão — retorna contagem por evento relevante
const CONVERSION_EVENTS = [
  "view_item",
  "generate_lead",
  "sign_up",
  "lead_create_account",
  "begin_checkout",
  "add_payment_info",
  "add_shipping_info",
  "purchase",
];

export async function getConversionEvents(propertyId: string, days = 30, startDate?: string | null, endDate?: string | null) {
  const range = buildDateRangeIncludingToday(days, startDate, endDate);
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }, { name: "eventValue" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 100,
  });
  if (res.error || !res.data?.rows) return { data: null, error: res.error };

  const byEvent = new Map<string, { count: number; users: number; value: number }>();
  for (const r of res.data.rows) {
    const name = r.dimensionValues?.[0]?.value || "";
    byEvent.set(name, {
      count: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      value: Number(r.metricValues?.[2]?.value || 0),
    });
  }

  const data = CONVERSION_EVENTS.map((ev) => ({
    event: ev,
    count: byEvent.get(ev)?.count || 0,
    users: byEvent.get(ev)?.users || 0,
    value: byEvent.get(ev)?.value || 0,
  }));

  // abandoned_checkout = begin_checkout − purchase (mesma regra do mock)
  const beginCheckout = byEvent.get("begin_checkout")?.count || 0;
  const purchase = byEvent.get("purchase")?.count || 0;
  data.push({
    event: "abandoned_checkout",
    count: Math.max(0, beginCheckout - purchase),
    users: 0,
    value: 0,
  });

  return { data, error: null };
}

// Funnel real — usa os mesmos eventos da Jornada Suno
// Cada step pode ter aliases (nomes alternativos de evento) para lidar com
// variações de nomenclatura entre properties Suno (ex.: algumas usam
// `add_payment_info`, outras ainda o legado `add_shipping_info`).
const FUNNEL_STEPS: { event: string; aliases: string[] }[] = [
  { event: "session_start", aliases: ["session_start"] },
  { event: "generate_lead", aliases: ["generate_lead", "lead", "form_submit_lead", "lead_submit"] },
  { event: "sign_up", aliases: ["sign_up", "lead_create_account", "account_created"] },
  { event: "begin_checkout", aliases: ["begin_checkout", "checkout_start"] },
  { event: "add_payment_info", aliases: ["add_payment_info", "add_shipping_info", "payment_info"] },
  { event: "purchase", aliases: ["purchase", "purchase_success"] },
];

export async function getJourneyFunnel(propertyId: string, days = 30, startDate?: string | null, endDate?: string | null) {
  const range = buildDateRangeIncludingToday(days, startDate, endDate);
  const res = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 200,
  });
  if (res.error || !res.data?.rows) return { data: null, error: res.error };

  const counts = new Map<string, number>();
  for (const r of res.data.rows) {
    counts.set(r.dimensionValues?.[0]?.value || "", Number(r.metricValues?.[0]?.value || 0));
  }

  // Top-30 eventos disparados — permite à UI diagnosticar eventos ausentes e
  // sugerir o que está firing quando um stage esperado retorna zero.
  const discoveredEvents = Array.from(counts.entries())
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // Resolve cada step pegando o primeiro alias que tiver contagem > 0;
  // se nenhum alias tem contagem, mantém o evento canônico com valor 0
  // mas devolve a lista de aliases tentados para diagnóstico.
  const resolved = FUNNEL_STEPS.map((step) => {
    let hit: { alias: string; count: number } | null = null;
    for (const alias of step.aliases) {
      const c = counts.get(alias) || 0;
      if (c > 0) {
        hit = { alias, count: c };
        break;
      }
    }
    return {
      event: step.event,
      matchedAlias: hit?.alias || null,
      value: hit?.count || 0,
      aliasesTried: step.aliases,
    };
  });

  const top = resolved[0].value || 0;
  const steps = resolved.map((r, i) => {
    const pct = top > 0 ? Math.round((r.value / top) * 1000) / 10 : 0;
    const prev = i > 0 ? resolved[i - 1].value : r.value;
    const dropPct = prev > 0 && i > 0 ? Math.round((1 - r.value / prev) * 1000) / 10 : 0;
    return {
      event: r.event,
      matchedAlias: r.matchedAlias,
      aliasesTried: r.aliasesTried,
      value: r.value,
      pct,
      dropPct,
    };
  });

  return { data: { steps, top, discoveredEvents }, error: null };
}

/**
 * Checkout funnel detalhado — análise de abandono de carrinho + CTR
 * de campanhas que levam ao checkout.
 *
 * Retorna 4 blocos:
 *   1) steps: funil de eventos view_item → add_to_cart → begin_checkout
 *      → add_payment_info → purchase
 *   2) abandonment: drop absoluto entre cada etapa + valor perdido estimado
 *   3) byCampaign: top campanhas com sessões, begin_checkout, purchase,
 *      conversion rate, ticket médio
 *   4) byLandingPage: top LPs por entrada que levam ao checkout
 */
const CHECKOUT_STEPS: { stage: string; aliases: string[]; label: string }[] = [
  { stage: "view_item", aliases: ["view_item", "view_product"], label: "Viu produto" },
  { stage: "add_to_cart", aliases: ["add_to_cart"], label: "Adicionou ao carrinho" },
  { stage: "begin_checkout", aliases: ["begin_checkout", "checkout_start"], label: "Iniciou checkout" },
  { stage: "add_payment_info", aliases: ["add_payment_info", "add_shipping_info"], label: "Preencheu pagamento" },
  { stage: "purchase", aliases: ["purchase", "purchase_success"], label: "Comprou" },
];

export type CheckoutFunnelStep = {
  stage: string;
  label: string;
  matchedAlias: string | null;
  count: number;
  pctOfTop: number;
  dropFromPrev: number; // % drop vs etapa anterior
  dropAbsoluteFromPrev: number; // valor absoluto perdido
};

export type CheckoutCampaignRow = {
  campaign: string;
  sessions: number;
  beginCheckout: number;
  purchases: number;
  revenue: number;
  ctr_to_checkout: number; // begin_checkout / sessions × 100
  conversion_rate: number; // purchase / sessions × 100
  abandonment_rate: number; // (begin_checkout - purchase) / begin_checkout × 100
  avg_ticket: number;
};

export async function getCheckoutFunnel(
  propertyId: string,
  days = 30,
  startDate?: string | null,
  endDate?: string | null
) {
  const range = buildDateRangeIncludingToday(days, startDate, endDate);

  // Query 1: contagem de cada evento do checkout
  const eventsRes = await runReport(propertyId, {
    dateRanges: [range.ga4Range],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 200,
  });
  if (eventsRes.error) return { data: null, error: eventsRes.error };

  const eventCounts = new Map<string, number>();
  for (const r of eventsRes.data?.rows || []) {
    eventCounts.set(r.dimensionValues?.[0]?.value || "", Number(r.metricValues?.[0]?.value || 0));
  }

  const resolvedSteps = CHECKOUT_STEPS.map((step) => {
    let hit: { alias: string; count: number } | null = null;
    for (const alias of step.aliases) {
      const c = eventCounts.get(alias) || 0;
      if (c > 0 && (!hit || c > hit.count)) {
        hit = { alias, count: c };
      }
    }
    return {
      stage: step.stage,
      label: step.label,
      matchedAlias: hit?.alias || null,
      count: hit?.count || 0,
    };
  });

  // Query 2: receita total — tenta 3 caminhos pra cobrir setups diferentes:
  //   (a) purchaseRevenue: popula só quando o evento purchase tem value + currency
  //   (b) totalRevenue: agrega purchaseRevenue + in_app_purchase + ad_revenue
  //   (c) eventValue filtrado por purchase: fallback quando dataLayer manda
  //       só `value` sem `currency` (caso do Renan — bug comum). É o mesmo
  //       fallback que o painel GA4 nativo faz silenciosamente quando o
  //       cartão "Receita de compra" mostra valor mas purchaseRevenue=0.
  const [revRes, eventValueRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      metrics: [{ name: "totalRevenue" }, { name: "purchaseRevenue" }],
    }),
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      metrics: [{ name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["purchase", "purchase_success"] },
        },
      },
    }),
  ]);
  const purchaseRevenue = Number(revRes.data?.totals?.[0]?.metricValues?.[1]?.value || 0);
  const totalRevenueOfficial = Number(revRes.data?.totals?.[0]?.metricValues?.[0]?.value || 0);
  const eventValueSum = Number(eventValueRes.data?.totals?.[0]?.metricValues?.[0]?.value || 0);

  // Hierarquia: purchaseRevenue > totalRevenue > eventValue (do purchase)
  // Se purchaseRevenue=0 mas eventValue>0 → dataLayer está mandando value sem currency.
  let totalRevenue = purchaseRevenue || totalRevenueOfficial;
  let revenueSource: "purchaseRevenue" | "totalRevenue" | "eventValue" | "none" = purchaseRevenue
    ? "purchaseRevenue"
    : totalRevenueOfficial
      ? "totalRevenue"
      : "none";
  if (totalRevenue === 0 && eventValueSum > 0) {
    totalRevenue = eventValueSum;
    revenueSource = "eventValue";
  }

  // Calcula ticket médio com base nos purchases reais (não no count do funnel)
  const purchaseStep = resolvedSteps.find((s) => s.stage === "purchase");
  const avgTicket = purchaseStep && purchaseStep.count > 0 ? totalRevenue / purchaseStep.count : 0;

  // Constrói os steps com dropFromPrev + dropAbsolute
  const top = resolvedSteps[0]?.count || 0;
  const steps: CheckoutFunnelStep[] = resolvedSteps.map((s, i) => {
    const prev = i > 0 ? resolvedSteps[i - 1].count : s.count;
    const dropAbs = i > 0 ? Math.max(0, prev - s.count) : 0;
    const dropPct = prev > 0 && i > 0 ? Math.round((1 - s.count / prev) * 1000) / 10 : 0;
    const pctOfTop = top > 0 ? Math.round((s.count / top) * 1000) / 10 : 0;
    return { ...s, dropFromPrev: dropPct, dropAbsoluteFromPrev: dropAbs, pctOfTop };
  });

  // Calcula valor abandonado total (entre begin_checkout e purchase)
  const beginCheckoutStep = resolvedSteps.find((s) => s.stage === "begin_checkout");
  const beginCheckoutCount = beginCheckoutStep?.count || 0;
  const purchaseCount = purchaseStep?.count || 0;
  const abandonedCount = Math.max(0, beginCheckoutCount - purchaseCount);
  const abandonedRevenueLost = abandonedCount * avgTicket;

  // Query 3: per-campaign breakdown — sessions + begin_checkout + purchase + revenue
  // Strategy: 3 queries em paralelo cruzando cada métrica com sessionCampaignName
  const [campSessionsRes, campCheckoutRes, campPurchaseRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
    }),
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [{ name: "sessionCampaignName" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["begin_checkout", "checkout_start"] },
        },
      },
      limit: 200,
    }),
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [{ name: "sessionCampaignName" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["purchase", "purchase_success"] },
        },
      },
      limit: 200,
    }),
  ]);

  // Mapeia campaign → sessions
  const campSessions = new Map<string, number>();
  for (const r of campSessionsRes.data?.rows || []) {
    const camp = r.dimensionValues?.[0]?.value || "(not set)";
    campSessions.set(camp, Number(r.metricValues?.[0]?.value || 0));
  }

  // Mapeia campaign → begin_checkout
  const campCheckout = new Map<string, number>();
  for (const r of campCheckoutRes.data?.rows || []) {
    const camp = r.dimensionValues?.[0]?.value || "(not set)";
    campCheckout.set(camp, (campCheckout.get(camp) || 0) + Number(r.metricValues?.[0]?.value || 0));
  }

  // Mapeia campaign → purchase + revenue
  const campPurchase = new Map<string, { count: number; revenue: number }>();
  for (const r of campPurchaseRes.data?.rows || []) {
    const camp = r.dimensionValues?.[0]?.value || "(not set)";
    const count = Number(r.metricValues?.[0]?.value || 0);
    const value = Number(r.metricValues?.[1]?.value || 0);
    const existing = campPurchase.get(camp) || { count: 0, revenue: 0 };
    campPurchase.set(camp, {
      count: existing.count + count,
      revenue: existing.revenue + value,
    });
  }

  // Combina em CheckoutCampaignRow[]
  const allCamps = new Set<string>([
    ...campSessions.keys(),
    ...campCheckout.keys(),
    ...campPurchase.keys(),
  ]);
  const byCampaign: CheckoutCampaignRow[] = Array.from(allCamps)
    .map((camp) => {
      const sessions = campSessions.get(camp) || 0;
      const beginCheckout = campCheckout.get(camp) || 0;
      const purchaseData = campPurchase.get(camp) || { count: 0, revenue: 0 };
      const ctr = sessions > 0 ? (beginCheckout / sessions) * 100 : 0;
      const convRate = sessions > 0 ? (purchaseData.count / sessions) * 100 : 0;
      const abandonRate =
        beginCheckout > 0 ? ((beginCheckout - purchaseData.count) / beginCheckout) * 100 : 0;
      const avgTicketCamp = purchaseData.count > 0 ? purchaseData.revenue / purchaseData.count : 0;
      return {
        campaign: camp,
        sessions,
        beginCheckout,
        purchases: purchaseData.count,
        revenue: purchaseData.revenue,
        ctr_to_checkout: Number(ctr.toFixed(2)),
        conversion_rate: Number(convRate.toFixed(2)),
        abandonment_rate: Number(abandonRate.toFixed(1)),
        avg_ticket: Number(avgTicketCamp.toFixed(2)),
      };
    })
    .filter((c) => c.sessions >= 50) // ruído de cauda longa removido
    .sort((a, b) => b.purchases - a.purchases || b.beginCheckout - a.beginCheckout)
    .slice(0, 20);

  return {
    data: {
      steps,
      summary: {
        total_revenue: totalRevenue,
        avg_ticket: Number(avgTicket.toFixed(2)),
        abandoned_count: abandonedCount,
        abandoned_revenue_lost: Number(abandonedRevenueLost.toFixed(2)),
        abandonment_rate:
          beginCheckoutCount > 0
            ? Number(((abandonedCount / beginCheckoutCount) * 100).toFixed(1))
            : 0,
        revenue_source: revenueSource,
        // Diagnóstico: cada uma das 3 fontes separadamente, pra UI explicar
        // ao gestor por que escolhemos uma e não outra (transparência total).
        revenue_diagnostics: {
          purchaseRevenue,
          totalRevenue: totalRevenueOfficial,
          eventValueFromPurchase: eventValueSum,
        },
      },
      byCampaign,
      range,
      days,
    },
    error: null,
  };
}

/**
 * UTM Discrepancy Audit — investiga divergências entre GA4 e PowerBI/sunocode.
 *
 * Pra uma LP específica, retorna:
 *   1. Top 50 source/medium pairs com sessions, conversions, revenue
 *   2. Top campaigns
 *   3. Pages com query string raw (mostra UTMs como chegaram, antes de normalizar)
 *   4. Detector de "variações do mesmo canal" (ex: status-invest vs statusinvest)
 *   5. % de (direct)/(none) — sintoma de UTM perdida
 */
export type UTMDiscrepancyVariation = {
  canonical: string; // forma canônica (lowercase, sem hífens/espaços)
  variants: { name: string; sessions: number }[];
  totalSessions: number;
  variantCount: number;
};

export async function getUTMAudit(
  propertyId: string,
  pathContains: string,
  days = 30,
  startDate?: string | null,
  endDate?: string | null
) {
  const range = buildDateRangeIncludingToday(days, startDate, endDate);

  // Filtra por LP path quando passado
  const buildPathFilter = () =>
    pathContains
      ? {
          dimensionFilter: {
            filter: {
              fieldName: "pagePath",
              stringFilter: {
                value: pathContains,
                matchType: "CONTAINS" as const,
              },
            },
          },
        }
      : {};

  const [sourceMediumRes, campaignsRes, pagesRawRes, totalRes] = await Promise.all([
    // 1) Top source/medium na LP
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
      ...buildPathFilter(),
    }),
    // 2) Top campaigns na LP
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [{ name: "sessionCampaignName" }, { name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
      ...buildPathFilter(),
    }),
    // 3) Landing pages com pagePath E query string raw (pegar pageReferrer +
    //    pagePathPlusQueryString pra ver UTMs antes da normalização)
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      dimensions: [{ name: "pagePathPlusQueryString" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 100,
      ...buildPathFilter(),
    }),
    // 4) Total de sessões na LP (pra calcular %)
    runReport(propertyId, {
      dateRanges: [range.ga4Range],
      metrics: [{ name: "sessions" }],
      ...buildPathFilter(),
    }),
  ]);

  const sourceMedium = (sourceMediumRes.data?.rows || []).map((r) => ({
    source: r.dimensionValues?.[0]?.value || "(not set)",
    medium: r.dimensionValues?.[1]?.value || "(not set)",
    sessions: Number(r.metricValues?.[0]?.value || 0),
    users: Number(r.metricValues?.[1]?.value || 0),
    conversions: Number(r.metricValues?.[2]?.value || 0),
  }));

  const campaigns = (campaignsRes.data?.rows || []).map((r) => ({
    campaign: r.dimensionValues?.[0]?.value || "(not set)",
    source: r.dimensionValues?.[1]?.value || "(not set)",
    medium: r.dimensionValues?.[2]?.value || "(not set)",
    sessions: Number(r.metricValues?.[0]?.value || 0),
    conversions: Number(r.metricValues?.[1]?.value || 0),
  }));

  const pagesRaw = (pagesRawRes.data?.rows || []).map((r) => ({
    url: r.dimensionValues?.[0]?.value || "",
    sessions: Number(r.metricValues?.[0]?.value || 0),
  }));

  const totalSessions = Number(totalRes.data?.totals?.[0]?.metricValues?.[0]?.value || 0);

  // Calcula % de (direct)/(none)
  const directNoneSessions = sourceMedium
    .filter((sm) => sm.source === "(direct)" && sm.medium === "(none)")
    .reduce((s, sm) => s + sm.sessions, 0);
  const directNonePct =
    totalSessions > 0 ? Number(((directNoneSessions / totalSessions) * 100).toFixed(1)) : 0;

  // Calcula % de (not set) — UTMs malformadas
  const notSetSessions = sourceMedium
    .filter((sm) => sm.source.includes("(not set)") || sm.medium.includes("(not set)"))
    .reduce((s, sm) => s + sm.sessions, 0);
  const notSetPct =
    totalSessions > 0 ? Number(((notSetSessions / totalSessions) * 100).toFixed(1)) : 0;

  // Detector de variações: agrupa por canonical (lowercase + sem hífen/underline/dot)
  const canonicalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[-_.\s]+/g, "");

  const sourceVariants = new Map<string, { name: string; sessions: number }[]>();
  for (const sm of sourceMedium) {
    if (sm.source === "(not set)" || sm.source === "(direct)") continue;
    const canonical = canonicalize(sm.source);
    const existing = sourceVariants.get(canonical) || [];
    const existingVariant = existing.find((v) => v.name === sm.source);
    if (existingVariant) {
      existingVariant.sessions += sm.sessions;
    } else {
      existing.push({ name: sm.source, sessions: sm.sessions });
    }
    sourceVariants.set(canonical, existing);
  }
  const sourceVariations: UTMDiscrepancyVariation[] = Array.from(sourceVariants.entries())
    .filter(([_, variants]) => variants.length > 1)
    .map(([canonical, variants]) => ({
      canonical,
      variants: variants.sort((a, b) => b.sessions - a.sessions),
      totalSessions: variants.reduce((s, v) => s + v.sessions, 0),
      variantCount: variants.length,
    }))
    .sort((a, b) => b.totalSessions - a.totalSessions);

  // Mesmo pra medium
  const mediumVariants = new Map<string, { name: string; sessions: number }[]>();
  for (const sm of sourceMedium) {
    if (sm.medium === "(not set)" || sm.medium === "(none)") continue;
    const canonical = canonicalize(sm.medium);
    const existing = mediumVariants.get(canonical) || [];
    const existingVariant = existing.find((v) => v.name === sm.medium);
    if (existingVariant) {
      existingVariant.sessions += sm.sessions;
    } else {
      existing.push({ name: sm.medium, sessions: sm.sessions });
    }
    mediumVariants.set(canonical, existing);
  }
  const mediumVariations: UTMDiscrepancyVariation[] = Array.from(mediumVariants.entries())
    .filter(([_, variants]) => variants.length > 1)
    .map(([canonical, variants]) => ({
      canonical,
      variants: variants.sort((a, b) => b.sessions - a.sessions),
      totalSessions: variants.reduce((s, v) => s + v.sessions, 0),
      variantCount: variants.length,
    }))
    .sort((a, b) => b.totalSessions - a.totalSessions);

  // Diagnóstico automático
  const diagnoses: { severity: "info" | "warning" | "error"; message: string }[] = [];
  if (directNonePct > 15) {
    diagnoses.push({
      severity: "error",
      message: `${directNonePct}% das sessões nessa LP estão como (direct)/(none) — UTM perdida em volume crítico. Investigar cross-domain, adblockers ou redirecionamentos que descartam query string.`,
    });
  } else if (directNonePct > 7) {
    diagnoses.push({
      severity: "warning",
      message: `${directNonePct}% de (direct)/(none) — acima do esperado (5-8% é normal). Verificar se há redirects internos que perdem UTMs.`,
    });
  }
  if (notSetPct > 5) {
    diagnoses.push({
      severity: "warning",
      message: `${notSetPct}% de (not set) — UTMs malformadas. Conferir se gerador (sunocode) sempre preenche source+medium.`,
    });
  }
  if (sourceVariations.length > 0) {
    const totalVariantSessions = sourceVariations.reduce((s, v) => s + v.totalSessions, 0);
    diagnoses.push({
      severity: "warning",
      message: `${sourceVariations.length} canais com variações de naming (ex: ${sourceVariations[0].variants.map((v) => v.name).join(" / ")}). Total: ${totalVariantSessions} sessões pulverizadas. PowerBI/sunocode normaliza isso, GA4 não.`,
    });
  }
  if (mediumVariations.length > 0) {
    diagnoses.push({
      severity: "warning",
      message: `${mediumVariations.length} mediums com variações (ex: ${mediumVariations[0].variants.map((v) => v.name).join(" / ")}).`,
    });
  }
  if (diagnoses.length === 0) {
    diagnoses.push({
      severity: "info",
      message: "Nenhuma anomalia óbvia detectada nas UTMs desta LP.",
    });
  }

  return {
    data: {
      filterPath: pathContains,
      totalSessions,
      directNoneSessions,
      directNonePct,
      notSetSessions,
      notSetPct,
      sourceMedium,
      campaigns,
      pagesRaw,
      sourceVariations,
      mediumVariations,
      diagnoses,
      range,
      days,
    },
    error: null,
  };
}

export async function getRealtimeActive(propertyId: string) {
  // O Realtime API às vezes popula `totals` e às vezes `rows[0]` quando consultado sem
  // dimensão. Lemos os dois e, se ambos forem 0, ainda agregamos por país como salvaguarda.
  // Resultado: bate com o card "Usuários ativos nos últimos 30 minutos" do painel GA4.
  const res = await runRealtimeReport(propertyId, {
    metrics: [{ name: "activeUsers" }],
  });
  if (res.error) return { data: null, error: res.error };
  const fromTotals = Number(res.data?.totals?.[0]?.metricValues?.[0]?.value || 0);
  const fromRow = Number(res.data?.rows?.[0]?.metricValues?.[0]?.value || 0);
  let fromCountry = 0;
  if (fromTotals === 0 && fromRow === 0) {
    const byCountry = await runRealtimeReport(propertyId, {
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      limit: 200,
    });
    for (const r of byCountry.data?.rows || []) {
      fromCountry += Number(r.metricValues?.[0]?.value || 0);
    }
  }
  const active = Math.max(fromTotals, fromRow, fromCountry);
  return { data: { active }, error: null };
}
