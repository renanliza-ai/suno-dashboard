"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

export type GA4Property = {
  id: string;
  name: string;
  displayName: string;
  account: string;
};

// Data em YYYY-MM-DD
export type DateRangeCustom = { startDate: string; endDate: string };

type GA4ContextType = {
  properties: GA4Property[];
  selectedId: string | null;
  selected: GA4Property | null;
  loading: boolean;
  error: string | null;
  useRealData: boolean;
  setSelectedId: (id: string) => void;
  refetch: () => void;
  // Período compartilhado entre todas as páginas.
  // Modo preset: days (7/30/90/365) + customRange=null
  // Modo custom: customRange = {startDate, endDate} (days fica derivado do diff)
  days: number;
  setDays: (d: number) => void;
  customRange: DateRangeCustom | null;
  setCustomRange: (r: DateRangeCustom | null) => void;
  // Helper: label amigável do período ativo
  periodLabel: string;
};

const GA4Context = createContext<GA4ContextType | null>(null);
const STORAGE_KEY = "suno.ga4.propertyId";
const DAYS_STORAGE_KEY = "suno.ga4.days";
const CUSTOM_RANGE_KEY = "suno.ga4.customRange";

function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

function formatPeriodLabel(days: number, range: DateRangeCustom | null): string {
  if (range) {
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split("-");
      return `${d}/${m}/${y.slice(2)}`;
    };
    return `${fmt(range.startDate)} → ${fmt(range.endDate)}`;
  }
  if (days === 7) return "Últimos 7 dias";
  if (days === 30) return "Últimos 30 dias";
  if (days === 90) return "Últimos 90 dias";
  if (days === 365) return "Último ano";
  return `Últimos ${days} dias`;
}

export function GA4Provider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState<GA4Property[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDaysState] = useState<number>(30);
  const [customRange, setCustomRangeState] = useState<DateRangeCustom | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = Number(localStorage.getItem(DAYS_STORAGE_KEY) || 30);
    if (Number.isFinite(saved) && saved > 0 && saved <= 730) setDaysState(saved);
    const rawRange = localStorage.getItem(CUSTOM_RANGE_KEY);
    if (rawRange) {
      try {
        const parsed = JSON.parse(rawRange) as DateRangeCustom;
        if (parsed?.startDate && parsed?.endDate) setCustomRangeState(parsed);
      } catch {}
    }
  }, []);

  const setDays = useCallback((d: number) => {
    setDaysState(d);
    // Ao selecionar preset, limpa o custom range
    setCustomRangeState(null);
    if (typeof window !== "undefined") {
      localStorage.setItem(DAYS_STORAGE_KEY, String(d));
      localStorage.removeItem(CUSTOM_RANGE_KEY);
    }
  }, []);

  const setCustomRange = useCallback((r: DateRangeCustom | null) => {
    setCustomRangeState(r);
    if (typeof window !== "undefined") {
      if (r) {
        localStorage.setItem(CUSTOM_RANGE_KEY, JSON.stringify(r));
        // Também atualiza days pra manter coerência em componentes que só usam days
        setDaysState(daysBetween(r.startDate, r.endDate));
      } else {
        localStorage.removeItem(CUSTOM_RANGE_KEY);
      }
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ga4/properties", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "erro");
      const props: GA4Property[] = json.properties || [];
      setProperties(props);
      const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const initial = saved && props.find((p) => p.id === saved) ? saved : props[0]?.id ?? null;
      setSelectedIdState(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const setSelectedId = useCallback((id: string) => {
    setSelectedIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const selected = properties.find((p) => p.id === selectedId) || null;
  const useRealData = Boolean(selected && !error);

  const periodLabel = formatPeriodLabel(days, customRange);

  return (
    <GA4Context.Provider
      value={{
        properties,
        selectedId,
        selected,
        loading,
        error,
        useRealData,
        setSelectedId,
        refetch: fetchProperties,
        days,
        setDays,
        customRange,
        setCustomRange,
        periodLabel,
      }}
    >
      {children}
    </GA4Context.Provider>
  );
}

export function useGA4() {
  const ctx = useContext(GA4Context);
  if (!ctx) throw new Error("useGA4 must be used inside GA4Provider");
  return ctx;
}

// Monta query string comum pros hooks que consultam /api/ga4/*
function buildDateQS(days: number, customRange: DateRangeCustom | null, extra?: Record<string, string>) {
  const qs = new URLSearchParams();
  qs.set("days", String(days));
  if (customRange) {
    qs.set("startDate", customRange.startDate);
    qs.set("endDate", customRange.endDate);
  }
  if (extra) for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  return qs;
}

// =============================================================
// Cache em memória + deduplicação de inflight por URL.
// Evita refetch e bate na rede só uma vez por janela de TTL.
// =============================================================
type CachedResp = { data: unknown; ts: number };
const __ga4Cache = new Map<string, CachedResp>();
const __ga4Inflight = new Map<string, Promise<Response>>();
const GA4_CACHE_TTL_MS = 180_000; // 3 min

/**
 * Wrapper de fetch que:
 *  1. Devolve resposta clonada do cache se houver e ainda for fresca (3 min).
 *  2. Deduplica chamadas paralelas pra mesma URL.
 *
 * Uso: substitui `fetch(url, opts)` por `cachedFetch(url, opts)`.
 * A interface é IDÊNTICA — devolve um Response.
 */
function cachedFetch(url: string, init?: RequestInit): Promise<Response> {
  // Honra `cache: "no-store"` ou metodologia diferente de GET — pula cache
  if (init?.method && init.method.toUpperCase() !== "GET") return fetch(url, init);

  const now = Date.now();
  const cached = __ga4Cache.get(url);
  if (cached && now - cached.ts < GA4_CACHE_TTL_MS) {
    // Retorna um Response sintético clonável a cada chamada
    return Promise.resolve(
      new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-From-Cache": "1" },
      })
    );
  }
  const inflight = __ga4Inflight.get(url);
  if (inflight) return inflight.then((r) => r.clone());
  const p = fetch(url, init)
    .then(async (resp) => {
      if (resp.ok) {
        try {
          const cloned = resp.clone();
          const data = await cloned.json();
          __ga4Cache.set(url, { data, ts: Date.now() });
        } catch {
          // não-JSON, ignora cache
        }
      }
      __ga4Inflight.delete(url);
      return resp;
    })
    .catch((e) => {
      __ga4Inflight.delete(url);
      throw e;
    });
  __ga4Inflight.set(url, p);
  return p.then((r) => r.clone());
}

// Hook: fetch overview (kpis + trend + pages + events) with cache
type Overview = {
  kpis:
    | {
        activeUsers: number;
        sessions: number;
        pageviews: number;
        conversions: number;
        engagedSessions?: number;
        bounceRate?: number; // %
        range?: { startDate: string; endDate: string };
        metricNames?: { users: string; conversions: string };
      }
    | null;
  trend: { date: string; sessoes: number; usuarios: number }[] | null;
  pages: { name: string; value: number; users: number }[] | null;
  events: { name: string; value: number }[] | null;
  days?: number;
  range?: { startDate: string; endDate: string } | null;
};

export type GA4Status = "idle" | "loading" | "success" | "error" | "partial";
export type GA4Meta = {
  status: GA4Status;
  propertyId: string | null;
  propertyName: string | null;
  fetchedAt: number | null;
  sectionErrors?: Record<string, string | null>;
};

export function useGA4Overview(daysOverride?: number) {
  const { selectedId, selected, useRealData, days: ctxDays, customRange } = useGA4();
  const days = daysOverride ?? ctxDays;
  const [data, setData] = useState<Overview | null>(null);
  const [meta, setMeta] = useState<GA4Meta>({
    status: "idle",
    propertyId: null,
    propertyName: null,
    fetchedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Sempre reseta ao trocar de property — evita mostrar dados da conta anterior
    setData(null);
    setError(null);
    if (!useRealData || !selectedId) {
      setMeta({ status: "idle", propertyId: null, propertyName: null, fetchedAt: null });
      return;
    }
    setMeta({
      status: "loading",
      propertyId: selectedId,
      propertyName: selected?.displayName || null,
      fetchedAt: null,
    });
    const controller = new AbortController();
    const qs = buildDateQS(days, customRange, { propertyId: selectedId });
    cachedFetch(`/api/ga4/overview?${qs.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        const errs = d.errors || {};
        const anyErr = errs.kpis || errs.trend || errs.pages || errs.events;
        const allNull = !d.kpis && !d.trend && !d.pages && !d.events;
        setData(d);
        if (allNull) {
          setError(anyErr || "API GA4 retornou vazio");
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
            sectionErrors: errs,
          });
        } else if (anyErr) {
          setError(anyErr);
          setMeta({
            status: "partial",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
            sectionErrors: errs,
          });
        } else {
          setMeta({
            status: "success",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
            sectionErrors: {},
          });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message || "erro");
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      });
    return () => controller.abort();
  }, [selectedId, selected, useRealData, days, customRange?.startDate, customRange?.endDate]);

  return { data, meta, error, loading: meta.status === "loading" };
}

// Hook: relatórios por canal (dim custom Suno + origem/meio + métricas)
export type GA4ReportRow = {
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

export function useGA4Reports(daysOverride?: number) {
  const { selectedId, selected, useRealData, days: ctxDays, customRange } = useGA4();
  const days = daysOverride ?? ctxDays;
  const [rows, setRows] = useState<GA4ReportRow[] | null>(null);
  const [usedCustomDim, setUsedCustomDim] = useState(false);
  const [meta, setMeta] = useState<GA4Meta>({
    status: "idle",
    propertyId: null,
    propertyName: null,
    fetchedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setUsedCustomDim(false);
    setError(null);
    if (!useRealData || !selectedId) {
      setMeta({ status: "idle", propertyId: null, propertyName: null, fetchedAt: null });
      return;
    }
    setMeta({
      status: "loading",
      propertyId: selectedId,
      propertyName: selected?.displayName || null,
      fetchedAt: null,
    });
    const ctrl = new AbortController();
    const qs = buildDateQS(days, customRange, { propertyId: selectedId });
    cachedFetch(`/api/ga4/reports?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setRows(d.rows || null);
        setUsedCustomDim(Boolean(d.usedCustomDim));
        const hasRows = Array.isArray(d.rows) && d.rows.length > 0;
        setMeta({
          status: d.error ? "error" : hasRows ? "success" : "error",
          propertyId: selectedId,
          propertyName: selected?.displayName || null,
          fetchedAt: Date.now(),
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message || "erro");
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      });
    return () => ctrl.abort();
  }, [selectedId, selected, useRealData, days, customRange?.startDate, customRange?.endDate]);

  return { rows, usedCustomDim, meta, loading: meta.status === "loading", error };
}

// Hook: conversões + funnel da jornada
export type GA4ConversionsData = {
  conversions:
    | { event: string; count: number; users: number; value: number }[]
    | null;
  funnel: {
    steps: {
      event: string;
      matchedAlias?: string | null;
      aliasesTried?: string[];
      value: number;
      pct: number;
      dropPct: number;
    }[];
    top: number;
    discoveredEvents?: { event: string; count: number }[];
  } | null;
};

export function useGA4Conversions(daysOverride?: number) {
  const { selectedId, selected, useRealData, days: ctxDays, customRange } = useGA4();
  const days = daysOverride ?? ctxDays;
  // IMPORTANTE: quando daysOverride é passado explicitamente, a intenção é forçar
  // uma janela específica (ex.: 1 dia para "últimas 24h"), independente do
  // calendário. Por isso ignoramos customRange nesse caso.
  const effectiveCustomRange = daysOverride !== undefined ? null : customRange;
  const [data, setData] = useState<GA4ConversionsData | null>(null);
  const [meta, setMeta] = useState<GA4Meta>({
    status: "idle",
    propertyId: null,
    propertyName: null,
    fetchedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!useRealData || !selectedId) {
      setMeta({ status: "idle", propertyId: null, propertyName: null, fetchedAt: null });
      return;
    }
    setMeta({
      status: "loading",
      propertyId: selectedId,
      propertyName: selected?.displayName || null,
      fetchedAt: null,
    });
    const ctrl = new AbortController();
    const qs = buildDateQS(days, effectiveCustomRange, { propertyId: selectedId });
    cachedFetch(`/api/ga4/conversions?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        const errs = d.errors || {};
        const anyErr = errs.conversions || errs.funnel;
        const allNull = !d.conversions && !d.funnel;
        if (anyErr) setError(anyErr);
        setData(d);
        if (allNull) {
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
            sectionErrors: errs,
          });
        } else if (anyErr) {
          setMeta({
            status: "partial",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
            sectionErrors: errs,
          });
        } else {
          setMeta({
            status: "success",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
            sectionErrors: {},
          });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message || "erro");
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      });
    return () => ctrl.abort();
  }, [
    selectedId,
    selected,
    useRealData,
    days,
    // Só re-fetcha em mudança de customRange quando ele é o que está sendo usado
    effectiveCustomRange?.startDate,
    effectiveCustomRange?.endDate,
  ]);

  return { data, meta, loading: meta.status === "loading", error };
}

// Hook: Landing Pages (inclui LPs externas como GreatPages via hostName)
export type GA4LandingPage = {
  host: string;
  path: string;
  url: string;
  users: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;
  avgSessionDuration: number;
  bounceRate: number;
};

export type GA4SourceBreakdown = {
  host: string;
  path: string;
  url: string;
  source: string;
  medium: string;
  sessions: number;
  users: number;
};

export type GA4LandingPagesData = {
  pages: GA4LandingPage[];
  sourceBreakdown: GA4SourceBreakdown[];
  topSources: { source: string; medium: string; sessions: number; users: number }[];
};

export function useGA4LandingPages(hostContains: string = "", daysOverride?: number) {
  const { selectedId, selected, useRealData, days: ctxDays, customRange } = useGA4();
  const days = daysOverride ?? ctxDays;
  const [data, setData] = useState<GA4LandingPagesData | null>(null);
  const [meta, setMeta] = useState<GA4Meta>({
    status: "idle",
    propertyId: null,
    propertyName: null,
    fetchedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!useRealData || !selectedId) {
      setMeta({ status: "idle", propertyId: null, propertyName: null, fetchedAt: null });
      return;
    }
    setMeta({
      status: "loading",
      propertyId: selectedId,
      propertyName: selected?.displayName || null,
      fetchedAt: null,
    });
    const ctrl = new AbortController();
    const qs = buildDateQS(days, customRange, { propertyId: selectedId });
    if (hostContains) qs.set("hostContains", hostContains);
    cachedFetch(`/api/ga4/landing-pages?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error && !d.pages?.length) {
          setError(d.error);
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        } else {
          setData(d);
          setMeta({
            status: "success",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message || "erro");
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      });
    return () => ctrl.abort();
  }, [selectedId, selected, useRealData, days, hostContains, customRange?.startDate, customRange?.endDate]);

  return { data, meta, loading: meta.status === "loading", error };
}

// Hook: Pages Detail — métricas completas por página (host + path + views + users
// + avgSessionDuration + bounceRate + entries). Consome /api/ga4/pages-detail.
export type GA4PageDetail = {
  host: string;
  path: string;
  url: string;
  views: number;
  users: number;
  sessions: number;
  avgSessionDuration: number; // seg
  bounceRate: number; // %
  exitRate: number; // % (aprox)
  entries: number;
  engagementPerUser: number; // seg por usuário
};

export type GA4PagesDetailData = {
  pages: GA4PageDetail[];
  hosts: string[];
};

// =====================================================================
// Hook: Anomalias (D-1 vs baseline 14d) — só master
// =====================================================================
export type AnomalySeverity = "normal" | "attention" | "critical" | "low_volume";
export type AnomalyDirection = "up" | "down" | "stable";
export type AnomalyMetric = "users" | "sessions" | "engagedSessions" | "leads" | "purchases" | "revenue";
export type AnomalyLevel = "macro" | "channel" | "campaign";
export type Anomaly = {
  metric: AnomalyMetric;
  metricLabel: string;
  level: AnomalyLevel;
  segment: string;
  current: number;
  baseline: number;
  delta: number;
  severity: AnomalySeverity;
  direction: AnomalyDirection;
};
export type AnomaliesData = {
  propertyId: string;
  date: string;
  baselineRange: { startDate: string; endDate: string };
  baselineDays: number;
  macro: Anomaly[];
  byChannel: Anomaly[];
  byCampaign: Anomaly[];
  briefing: string[];
};

export function useGA4Anomalies(baselineDays = 14) {
  const { selectedId, useRealData } = useGA4();
  const [data, setData] = useState<AnomaliesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!useRealData || !selectedId) {
      setData(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(
      `/api/ga4/anomalies?propertyId=${selectedId}&baselineDays=${baselineDays}`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((d: AnomaliesData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          setData(null);
        } else {
          setData(d);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedId, useRealData, baselineDays, tick]);

  return { data, loading, error, refetch };
}

// Hook: comparativo de N landing pages × dimensão escolhida. POST em /api/ga4/lp-channels.
export type LPBreakdownDimension =
  | "channel"
  | "sourceMedium"
  | "source"
  | "medium"
  | "campaign"
  | "deviceCategory"
  | "country";

export type LPChannelsResult = {
  url: string;
  matched: boolean;
  totalUsers: number;
  totalSessions: number;
  totalEngagedSessions: number;
  avgBounceRate: number;
  totalConversions: number;
  byChannel: {
    label: string;
    users: number;
    sessions: number;
    engagedSessions: number;
    bounceRate: number;
    conversions: number;
  }[];
};

export function useGA4LPChannels(
  urls: string[],
  daysOverride?: number,
  breakdownDimension: LPBreakdownDimension = "channel"
): {
  results: LPChannelsResult[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { selectedId, useRealData, days: ctxDays, customRange } = useGA4();
  const days = daysOverride ?? ctxDays;
  const [results, setResults] = useState<LPChannelsResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  // Estabiliza key da lista de URLs pra deps do useEffect
  const urlsKey = urls.join("|");

  useEffect(() => {
    if (!useRealData || !selectedId || urls.length === 0) {
      setResults([]);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/ga4/lp-channels", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: selectedId,
        urls,
        days,
        startDate: customRange?.startDate,
        endDate: customRange?.endDate,
        breakdownDimension,
      }),
    })
      .then((r) => r.json())
      .then((d: { results?: LPChannelsResult[]; error?: string }) => {
        if (d.error) setError(d.error);
        setResults(d.results || []);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedId,
    useRealData,
    days,
    urlsKey,
    customRange?.startDate,
    customRange?.endDate,
    breakdownDimension,
    tick,
  ]);

  return { results, loading, error, refetch };
}

export function useGA4PagesDetail(hostContains: string = "", daysOverride?: number) {
  const { selectedId, selected, useRealData, days: ctxDays, customRange } = useGA4();
  const days = daysOverride ?? ctxDays;
  const [data, setData] = useState<GA4PagesDetailData | null>(null);
  const [meta, setMeta] = useState<GA4Meta>({
    status: "idle",
    propertyId: null,
    propertyName: null,
    fetchedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!useRealData || !selectedId) {
      setMeta({ status: "idle", propertyId: null, propertyName: null, fetchedAt: null });
      return;
    }
    setMeta({
      status: "loading",
      propertyId: selectedId,
      propertyName: selected?.displayName || null,
      fetchedAt: null,
    });
    const ctrl = new AbortController();
    const qs = buildDateQS(days, customRange, { propertyId: selectedId });
    if (hostContains) qs.set("hostContains", hostContains);
    cachedFetch(`/api/ga4/pages-detail?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error && !d.pages?.length) {
          setError(d.error);
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        } else {
          setData(d);
          setMeta({
            status: "success",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message || "erro");
          setMeta({
            status: "error",
            propertyId: selectedId,
            propertyName: selected?.displayName || null,
            fetchedAt: Date.now(),
          });
        }
      });
    return () => ctrl.abort();
  }, [selectedId, selected, useRealData, days, hostContains, customRange?.startDate, customRange?.endDate]);

  return { data, meta, loading: meta.status === "loading", error };
}

// Hook: GA4 Realtime (últimos 30 min) — polling a cada 30s
export type GA4RealtimeData = {
  active: number;
  pages: { path: string; users: number; views?: number }[];
  devices: { name: string; value: number }[];
  countries: { country: string; users: number }[];
  events?: { event: string; count: number }[];
  platforms?: { source: string; users: number }[];
  /** Top 10 localizações (país · estado · cidade) nos últimos 30 min. */
  locations?: { country: string; region: string; city: string; users: number }[];
};

export function useGA4Realtime(pollMs = 30000) {
  const { selectedId, selected, useRealData } = useGA4();
  const [data, setData] = useState<GA4RealtimeData | null>(null);
  const [meta, setMeta] = useState<GA4Meta>({
    status: "idle",
    propertyId: null,
    propertyName: null,
    fetchedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!useRealData || !selectedId) {
      setData(null);
      setMeta({ status: "idle", propertyId: null, propertyName: null, fetchedAt: null });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();

    const run = async (isFirst: boolean) => {
      if (isFirst) {
        setMeta({
          status: "loading",
          propertyId: selectedId,
          propertyName: selected?.displayName || null,
          fetchedAt: null,
        });
      }
      try {
        const r = await fetch(`/api/ga4/realtime?propertyId=${selectedId}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        const d = await r.json();
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        setError(null);
        setMeta({
          status: "success",
          propertyId: selectedId,
          propertyName: selected?.displayName || null,
          fetchedAt: Date.now(),
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const err = e as { name?: string; message?: string };
        if (err.name === "AbortError") return;
        setError(err.message || "erro");
        setMeta({
          status: "error",
          propertyId: selectedId,
          propertyName: selected?.displayName || null,
          fetchedAt: Date.now(),
        });
      }
    };

    run(true);
    const id = setInterval(() => run(false), pollMs);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [selectedId, selected, useRealData, pollMs]);

  return { data, meta, loading: meta.status === "loading", error };
}
