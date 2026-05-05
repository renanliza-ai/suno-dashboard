"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

/**
 * Contexto + hooks do Google Search Console.
 *
 * O Search Console tem propriedades separadas do GA4 (pode ter SC pra
 * `https://suno.com.br/` E também pra `https://research.suno.com.br/`).
 * Por isso, o seletor de site GSC é independente do seletor de propriedade GA4.
 *
 * Persistimos a escolha em localStorage para que sobreviva ao reload.
 */

export type GSCSite = {
  siteUrl: string;
  permissionLevel: string;
};

type GSCContextValue = {
  sites: GSCSite[];
  selectedSite: GSCSite | null;
  selectedSiteUrl: string | null;
  setSelectedSiteUrl: (url: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const GSCContext = createContext<GSCContextValue | null>(null);

const STORAGE_KEY = "suno:gsc:selectedSite:v1";

export function GSCProvider({ children }: { children: ReactNode }) {
  const [sites, setSites] = useState<GSCSite[]>([]);
  const [selectedSiteUrl, setSelectedSiteUrlState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/seo/sites");
      const d = (await r.json()) as { sites?: GSCSite[]; error?: string };
      if (d.error) {
        setError(d.error);
        setSites([]);
      } else {
        setSites(d.sites || []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  // Carrega escolha salva
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setSelectedSiteUrlState(saved);
  }, []);

  // Quando lista chega e nada está selecionado, seleciona o primeiro
  useEffect(() => {
    if (!selectedSiteUrl && sites.length > 0) {
      setSelectedSiteUrlState(sites[0].siteUrl);
    }
  }, [sites, selectedSiteUrl]);

  const setSelectedSiteUrl = useCallback((url: string | null) => {
    setSelectedSiteUrlState(url);
    if (typeof window !== "undefined") {
      if (url) window.localStorage.setItem(STORAGE_KEY, url);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const selectedSite = sites.find((s) => s.siteUrl === selectedSiteUrl) || null;

  return (
    <GSCContext.Provider
      value={{
        sites,
        selectedSite,
        selectedSiteUrl,
        setSelectedSiteUrl,
        loading,
        error,
        refresh: fetchSites,
      }}
    >
      {children}
    </GSCContext.Provider>
  );
}

export function useGSC() {
  const ctx = useContext(GSCContext);
  if (!ctx) throw new Error("useGSC deve ser usado dentro de <GSCProvider>");
  return ctx;
}

// ============================================================
// Hooks dedicados para cada endpoint da API
// ============================================================

export type GSCKpis = {
  clicks: number;
  impressions: number;
  ctr: number; // %
  position: number;
};

export type GSCTrendPoint = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export function useGSCOverview(daysOverride?: number) {
  const { selectedSiteUrl } = useGSC();
  const [data, setData] = useState<{ kpis: GSCKpis | null; trend: GSCTrendPoint[]; range?: { startDate: string; endDate: string } } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = daysOverride ?? 30;

  useEffect(() => {
    if (!selectedSiteUrl) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/seo/overview?siteUrl=${encodeURIComponent(selectedSiteUrl)}&days=${days}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d: { kpis?: GSCKpis; trend?: GSCTrendPoint[]; error?: string; range?: { startDate: string; endDate: string } }) => {
        if (d.error) setError(d.error);
        setData({ kpis: d.kpis || null, trend: d.trend || [], range: d.range });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedSiteUrl, days]);

  return { data, loading, error };
}

export type GSCQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topPage: string | null;
  opportunity: "low_ctr" | "part_2_candidate" | null;
};

export function useGSCQueries(daysOverride?: number, limit = 100) {
  const { selectedSiteUrl } = useGSC();
  const [queries, setQueries] = useState<GSCQuery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = daysOverride ?? 30;

  useEffect(() => {
    if (!selectedSiteUrl) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(
      `/api/seo/queries?siteUrl=${encodeURIComponent(selectedSiteUrl)}&days=${days}&limit=${limit}`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((d: { queries?: GSCQuery[]; error?: string }) => {
        if (d.error) setError(d.error);
        setQueries(d.queries || []);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedSiteUrl, days, limit]);

  return { queries, loading, error };
}

export type GSCPage = {
  url: string;
  path: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export function useGSCPages(daysOverride?: number, limit = 50) {
  const { selectedSiteUrl } = useGSC();
  const [pages, setPages] = useState<GSCPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = daysOverride ?? 30;

  useEffect(() => {
    if (!selectedSiteUrl) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(
      `/api/seo/pages?siteUrl=${encodeURIComponent(selectedSiteUrl)}&days=${days}&limit=${limit}`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((d: { pages?: GSCPage[]; error?: string }) => {
        if (d.error) setError(d.error);
        setPages(d.pages || []);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedSiteUrl, days, limit]);

  return { pages, loading, error };
}
