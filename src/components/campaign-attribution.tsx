"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Target,
  ShoppingCart,
  Users,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Sparkles,
  Rocket,
  PauseCircle,
  Search,
  Wrench,
  ArrowUpDown,
  Calendar,
  Database,
} from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";
import { downloadReport, type ReportSheet } from "@/lib/export-utils";
import { Dialog } from "@/components/dialog";
import { ArrowUpRight, ExternalLink } from "lucide-react";

/**
 * CampaignAttribution — análise de origem/canal/campanha pra orientar
 * concentração de investimento de mídia.
 *
 * Responde: "Onde devo concentrar meu budget pra maximizar leads/vendas?"
 *
 * RESPEITA RIGOROSAMENTE:
 *  - Property selecionada no header (selectedId)
 *  - Range de data (customRange) ou period (days)
 *  - Re-fetch automático quando QUALQUER um muda
 *  - Anti race-condition: valida que propertyId do response bate com request
 *  - Loading state visível
 *  - Banner com property + period em destaque (transparência total)
 */

type AggregateRow = {
  sessions: number;
  users: number;
  engagedSessions: number;
  bounceRate?: number;
  leads: number;
  purchases: number;
  revenue: number;
  leadConvRate: number;
  purchaseConvRate: number;
  avgTicket: number;
  engagementRate: number;
  revenuePerSession: number;
};

type ChannelRow = AggregateRow & { channel: string };
type SourceMediumRow = AggregateRow & { source: string; medium: string };
type CampaignRow = AggregateRow & { campaign: string; source: string; medium: string };
type CampaignPageRow = {
  campaign: string;
  sourceMedium: string;
  conversionPage: string;
  leads: number;
  purchases: number;
  revenue: number;
};

// Row no formato IDÊNTICO ao GA4 export: campanha + origem/mídia + keyEvents + receita
type CampaignSourceMediumRow = {
  campaign: string;
  sourceMedium: string;
  keyEvents: number;
  revenue: number;
  sessions: number;
  keyEventsShare: number;
  revenueShare: number;
};

type Recommendation = {
  type: "scale" | "optimize" | "pause" | "explore";
  target: string;
  reason: string;
  evidence: string;
  metric: { name: string; value: number; unit: string };
};

type AttributionResponse = {
  propertyId: string;
  range: { startDate: string; endDate: string };
  days: number;
  byChannel: ChannelRow[];
  bySourceMedium: SourceMediumRow[];
  byCampaign: CampaignRow[];
  byCampaignXPage: CampaignPageRow[];
  byCampaignXSourceMedium: CampaignSourceMediumRow[];
  totalKeyEvents: number;
  totalRevenueKeyEvents: number;
  recommendations: Recommendation[];
  totals: {
    sessions: number;
    users: number;
    leads: number;
    purchases: number;
    revenue: number;
    avgLeadConvRate: number;
    avgPurchaseConvRate: number;
  };
};

type ViewMode = "campaignXSourceMedium" | "campaignXPage" | "channel" | "sourceMedium" | "campaign";
type SortableKey = "sessions" | "leads" | "purchases" | "revenue" | "leadConvRate" | "purchaseConvRate" | "avgTicket";

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatDateBR(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function CampaignAttribution() {
  const { selected, selectedId, useRealData, days, customRange } = useGA4();
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default: visão idêntica ao GA4 export (Campanha × Origem/Mídia + keyEvents)
  const [view, setView] = useState<ViewMode>("campaignXSourceMedium");
  const [sortKey, setSortKey] = useState<SortableKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState("");
  // Modal de detalhes ao clicar numa linha
  const [selectedRow, setSelectedRow] = useState<
    ChannelRow | SourceMediumRow | CampaignRow | CampaignPageRow | CampaignSourceMediumRow | null
  >(null);

  // ========================================================
  // Fetch — RE-EXECUTA em qualquer mudança de:
  // - propertyId
  // - customRange (start/end)
  // - days (preset)
  // ========================================================
  useEffect(() => {
    if (!useRealData || !selectedId) {
      setData(null);
      setError(null);
      return;
    }
    // ⚠ Captura o propertyId desta execução pra validar a resposta depois
    const requestPropertyId = selectedId;
    const requestStart = customRange?.startDate;
    const requestEnd = customRange?.endDate;
    const requestDays = days;

    setLoading(true);
    setError(null);
    setData(null); // limpa imediatamente pra UI não exibir dado antigo

    const params = new URLSearchParams({ propertyId: selectedId });
    if (customRange) {
      params.set("startDate", customRange.startDate);
      params.set("endDate", customRange.endDate);
    } else {
      params.set("days", String(days));
    }

    const controller = new AbortController();
    fetch(`/api/ga4/campaign-attribution?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: AttributionResponse & { error?: string }) => {
        // ⚠ Anti race-condition: descarta se mudou property/range no meio
        if (d.propertyId !== requestPropertyId) return;
        if (customRange?.startDate !== requestStart || customRange?.endDate !== requestEnd) return;
        if (!customRange && days !== requestDays) return;

        if (d.error) {
          setError(d.error);
          setData(null);
        } else {
          setData(d);
        }
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [selectedId, useRealData, days, customRange?.startDate, customRange?.endDate]);

  // Sorting + filtering — diferenciado pela view escolhida
  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();

    // VIEW PADRÃO (formato GA4 export): Campanha × Origem/Mídia + keyEvents
    if (view === "campaignXSourceMedium") {
      let source = data.byCampaignXSourceMedium;
      if (q) {
        source = source.filter(
          (r) => r.campaign.toLowerCase().includes(q) || r.sourceMedium.toLowerCase().includes(q)
        );
      }
      const sortBy: (r: CampaignSourceMediumRow) => number = (r) => {
        if (sortKey === "revenue") return r.revenue;
        if (sortKey === "sessions") return r.sessions;
        // qualquer outro key → ordena por keyEvents (default GA4)
        return r.keyEvents;
      };
      const sorted = [...source].sort((a, b) => (sortDesc ? sortBy(b) - sortBy(a) : sortBy(a) - sortBy(b)));
      return sorted as (ChannelRow | SourceMediumRow | CampaignRow | CampaignPageRow | CampaignSourceMediumRow)[];
    }

    if (view === "campaignXPage") {
      let source = data.byCampaignXPage;
      if (q) {
        source = source.filter(
          (r) =>
            r.campaign.toLowerCase().includes(q) ||
            r.sourceMedium.toLowerCase().includes(q) ||
            r.conversionPage.toLowerCase().includes(q)
        );
      }
      // Sort específico pra essa view (leads + purchases × 5)
      const sortBy: (r: CampaignPageRow) => number = (r) => {
        if (sortKey === "purchases" || sortKey === "revenue" || sortKey === "avgTicket") return r[sortKey === "avgTicket" ? "purchases" : sortKey] || 0;
        if (sortKey === "leads") return r.leads;
        return r.leads + r.purchases * 5;
      };
      const sorted = [...source].sort((a, b) => (sortDesc ? sortBy(b) - sortBy(a) : sortBy(a) - sortBy(b)));
      return sorted as (ChannelRow | SourceMediumRow | CampaignRow | CampaignPageRow)[];
    }

    let source: (ChannelRow | SourceMediumRow | CampaignRow)[] =
      view === "channel" ? data.byChannel : view === "sourceMedium" ? data.bySourceMedium : data.byCampaign;
    if (q) {
      source = source.filter((r) => {
        if ("channel" in r) return r.channel.toLowerCase().includes(q);
        if ("campaign" in r) {
          return (
            r.campaign.toLowerCase().includes(q) ||
            r.source.toLowerCase().includes(q) ||
            r.medium.toLowerCase().includes(q)
          );
        }
        return r.source.toLowerCase().includes(q) || r.medium.toLowerCase().includes(q);
      });
    }
    const sorted = [...source].sort((a, b) => {
      const diff = (b[sortKey] as number) - (a[sortKey] as number);
      return sortDesc ? diff : -diff;
    });
    return sorted;
  }, [data, view, sortKey, sortDesc, search]);

  function toggleSort(k: SortableKey) {
    if (sortKey === k) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  }

  function rowLabel(r: ChannelRow | SourceMediumRow | CampaignRow): string {
    if ("channel" in r) return r.channel;
    if ("campaign" in r) return `${r.campaign}`;
    return `${r.source} / ${r.medium}`;
  }

  function rowSub(r: ChannelRow | SourceMediumRow | CampaignRow): string | null {
    if ("campaign" in r) return `${r.source} / ${r.medium}`;
    return null;
  }

  // ========================================================
  // Export
  // ========================================================
  function handleExport(format: "xlsx" | "pdf" | "csv") {
    if (!data) return;
    const labels: Record<ViewMode, string> = {
      campaignXSourceMedium: "Campanha × Origem (GA4)",
      campaignXPage: "Campanha × LP",
      channel: "Canal",
      sourceMedium: "Origem / Mídia",
      campaign: "Campanha",
    };

    let sheet: ReportSheet;
    if (view === "campaignXSourceMedium") {
      sheet = {
        name: "Campanha x Origem (GA4)",
        columns: [
          "Campanha",
          "Origem / Mídia",
          "Todas as conversões",
          "% Conversões",
          "Receita total (R$)",
          "% Receita",
          "Sessões",
        ],
        rows: (rows as CampaignSourceMediumRow[]).map((r) => [
          r.campaign,
          r.sourceMedium,
          r.keyEvents,
          r.keyEventsShare,
          r.revenue,
          r.revenueShare,
          r.sessions,
        ]),
      };
    } else if (view === "campaignXPage") {
      sheet = {
        name: "Campanha x LP",
        columns: ["Campanha (origem)", "Origem / Mídia", "LP de conversão", "Leads", "Vendas", "Receita (R$)"],
        rows: (rows as CampaignPageRow[]).map((r) => [
          r.campaign,
          r.sourceMedium,
          r.conversionPage,
          r.leads,
          r.purchases,
          r.revenue,
        ]),
      };
    } else {
      const stdRows = rows as (ChannelRow | SourceMediumRow | CampaignRow)[];
      sheet = {
        name: `Atribuição por ${labels[view]}`,
        columns: [
          labels[view],
          "Sessões",
          "Usuários",
          "Leads",
          "Vendas",
          "Receita (R$)",
          "Conv. Lead %",
          "Conv. Venda %",
          "Ticket Médio (R$)",
          "Receita / Sessão (R$)",
        ],
        rows: stdRows.map((r) => [
          rowLabel(r) + (rowSub(r) ? ` (${rowSub(r)})` : ""),
          r.sessions,
          r.users,
          r.leads,
          r.purchases,
          r.revenue,
          r.leadConvRate,
          r.purchaseConvRate,
          r.avgTicket,
          r.revenuePerSession,
        ]),
      };
    }
    downloadReport(
      format,
      {
        title: `Atribuição de Conversão — ${labels[view]}`,
        subtitle: `Onde concentrar investimento de mídia`,
        accountName: selected?.displayName,
        period: `${data.range.startDate} → ${data.range.endDate}`,
        generatedBy: "Suno Dashboard",
      },
      [sheet]
    );
  }

  // ========================================================
  // Render guards
  // ========================================================
  if (!useRealData) {
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
          <Target size={16} className="text-[#7c5cff]" />
          Onde concentrar investimento
        </h3>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          Selecione uma propriedade GA4 real no header pra ver análise de atribuição por canal/origem/campanha.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      {/* ============================================================
          BANNER — sempre mostra qual propriedade + período está sendo
          analisado. É a 1ª coisa que o usuário vê pra confirmar que
          os dados batem com o filtro selecionado.
         ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-[#7c5cff] via-[#6b4fe0] to-[#5b3dd4] rounded-2xl text-white p-5 mb-4 shadow-lg shadow-purple-500/20"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Target size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 flex-wrap">
                Onde concentrar investimento
                <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded">v1</span>
              </h2>
              <p className="text-xs opacity-90 mt-0.5">
                Análise de origem/canal/campanha — descubra quais canais convertem melhor e onde direcionar budget.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="bg-white/15 backdrop-blur-sm rounded-md px-2 py-1 inline-flex items-center gap-1.5 font-semibold">
                  <Database size={11} />
                  Propriedade: {selected?.displayName || "—"}
                </span>
                {data?.range && (
                  <span className="bg-white/15 backdrop-blur-sm rounded-md px-2 py-1 inline-flex items-center gap-1.5 font-mono">
                    <Calendar size={11} />
                    {formatDateBR(data.range.startDate)} → {formatDateBR(data.range.endDate)}
                  </span>
                )}
                {loading && (
                  <span className="bg-amber-400/20 backdrop-blur-sm rounded-md px-2 py-1 inline-flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" />
                    Recalculando…
                  </span>
                )}
              </div>
            </div>
          </div>
          {data && !loading && (
            <div className="text-right text-[11px] opacity-90">
              <p className="text-2xl font-bold tabular-nums">{formatNumber(data.totals.sessions)}</p>
              <p>sessões totais</p>
            </div>
          )}
        </div>
      </motion.div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-4 flex items-start gap-2 text-sm text-red-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            <strong>Erro ao carregar atribuição:</strong> {error}
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={32} className="animate-spin text-[#7c5cff]" />
          <p className="text-sm">Buscando dados de atribuição para {selected?.displayName}…</p>
          <p className="text-xs">6 queries paralelas ao GA4 — pode levar até 30s</p>
        </div>
      )}

      {data && !loading && (
        <>
          {/* RECOMENDAÇÕES — onde investir / pausar / explorar */}
          {data.recommendations.length > 0 && (
            <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5 mb-4">
              <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-[#7c5cff]" />
                Recomendações de investimento
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">
                  {data.recommendations.length} {data.recommendations.length === 1 ? "insight" : "insights"}
                </span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.recommendations.map((rec, i) => {
                  const config = {
                    scale: {
                      label: "Escalar",
                      icon: Rocket,
                      bg: "from-emerald-50 to-green-50 border-emerald-200",
                      iconBg: "bg-emerald-100 text-emerald-700",
                    },
                    optimize: {
                      label: "Otimizar",
                      icon: Wrench,
                      bg: "from-amber-50 to-orange-50 border-amber-200",
                      iconBg: "bg-amber-100 text-amber-700",
                    },
                    pause: {
                      label: "Revisar/Pausar",
                      icon: PauseCircle,
                      bg: "from-red-50 to-rose-50 border-red-200",
                      iconBg: "bg-red-100 text-red-700",
                    },
                    explore: {
                      label: "Testar",
                      icon: Search,
                      bg: "from-blue-50 to-sky-50 border-blue-200",
                      iconBg: "bg-blue-100 text-blue-700",
                    },
                  }[rec.type];
                  const Icon = config.icon;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`bg-gradient-to-br ${config.bg} border rounded-xl p-3`}
                    >
                      <div className="flex items-start gap-2 mb-1.5">
                        <div className={`w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center shrink-0`}>
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] uppercase font-bold tracking-wider opacity-70">
                            {config.label}
                          </p>
                          <p className="font-bold text-sm truncate" title={rec.target}>
                            {rec.target}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs font-semibold mt-1.5">{rec.reason}</p>
                      <p className="text-[11px] text-slate-700 mt-1 leading-relaxed">{rec.evidence}</p>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TABELA — escolher dimensão + sort + search + export */}
          <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[color:var(--border)] flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <TrendingUp size={16} className="text-[#7c5cff]" />
                  Tabela detalhada
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {rows.length} linha{rows.length !== 1 ? "s" : ""} · ordenado por <strong>{sortKey}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Toggle de view — formato GA4 export é o default */}
                <div className="inline-flex rounded-lg border border-[color:var(--border)] overflow-hidden text-xs flex-wrap">
                  {(["campaignXSourceMedium", "campaignXPage", "channel", "sourceMedium", "campaign"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 font-semibold transition ${
                        view === v ? "bg-[#7c5cff] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                      title={
                        v === "campaignXSourceMedium"
                          ? "Idêntico ao seu GA4 export: campanha + origem/mídia + total de conversões (keyEvents) + receita"
                          : v === "campaignXPage"
                            ? "Cruzamento extra: campanha que trouxe + página onde converteu"
                            : v === "channel"
                              ? "Visão agregada por canal (Organic, Paid Search, etc)"
                              : v === "sourceMedium"
                                ? "Origem + mídia detalhada (google/cpc, facebook/social, etc)"
                                : "Cada UTM campaign individualmente"
                      }
                    >
                      {v === "campaignXSourceMedium"
                        ? "📋 Campanha × Origem (GA4)"
                        : v === "campaignXPage"
                          ? "🎯 Campanha × LP"
                          : v === "channel"
                            ? "Por Canal"
                            : v === "sourceMedium"
                              ? "Por Origem/Mídia"
                              : "Por Campanha"}
                    </button>
                  ))}
                </div>
                {/* Search */}
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrar..."
                  className="px-2.5 py-1.5 text-xs rounded-md border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff] w-32"
                />
                {/* Export */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleExport("xlsx")}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                    title="Baixar XLSX"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() => handleExport("pdf")}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition"
                    title="Baixar PDF"
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => handleExport("csv")}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition"
                    title="Baixar CSV"
                  >
                    CSV
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {view === "campaignXSourceMedium" ? (
                // ========================================================
                // VIEW PADRÃO: Formato IDÊNTICO ao GA4 export
                // Campanha | Origem/Mídia | Todas conversões (keyEvents) | Receita
                // ========================================================
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/50 border-b border-[color:var(--border)] sticky top-0">
                    <tr>
                      <Th label="Campanha" align="left" />
                      <Th label="Origem / Mídia" align="left" />
                      <ThSortable label="Todas as conversões" sortKey="leads" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Receita total" sortKey="revenue" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Sessões" sortKey="sessions" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Linha de total — espelha o GA4 */}
                    <tr className="bg-slate-50 border-b-2 border-slate-200 font-bold">
                      <td className="px-4 py-2.5 text-xs">Total</td>
                      <td className="px-4 py-2.5 text-xs">—</td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                        {formatNumber(data.totalKeyEvents)}{" "}
                        <span className="text-[10px] font-normal text-slate-500">(100%)</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                        {data.totalRevenueKeyEvents > 0 ? formatBRL(data.totalRevenueKeyEvents) : "—"}{" "}
                        <span className="text-[10px] font-normal text-slate-500">(100%)</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                        {formatNumber(data.totals.sessions)}
                      </td>
                    </tr>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-xs italic">
                          Nenhuma conversão atribuída no período. Verifique se há eventos marcados como Key Events no GA4 dessa propriedade.
                        </td>
                      </tr>
                    )}
                    {(rows as CampaignSourceMediumRow[]).slice(0, 100).map((r, i) => (
                      <tr
                        key={`${r.campaign}-${r.sourceMedium}-${i}`}
                        onClick={() => setSelectedRow(r)}
                        className="border-b border-slate-100 hover:bg-violet-50/50 cursor-pointer transition"
                      >
                        <td className="px-4 py-2.5 max-w-[280px]">
                          <p className="text-xs truncate font-medium" title={r.campaign}>
                            {r.campaign === "(not set)" ? (
                              <span className="text-slate-400 italic">(sem UTM)</span>
                            ) : (
                              r.campaign
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px]">
                          <p className="text-[11px] font-mono text-slate-700 truncate" title={r.sourceMedium}>
                            {r.sourceMedium}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                          <span className="font-bold">{formatNumber(r.keyEvents)}</span>{" "}
                          {r.keyEventsShare > 0 && (
                            <span className="text-[10px] text-slate-500">({r.keyEventsShare}%)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                          {r.revenue > 0 ? (
                            <>
                              <span className="font-bold">{formatBRL(r.revenue)}</span>{" "}
                              <span className="text-[10px] text-slate-500">({r.revenueShare}%)</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums text-slate-500">
                          {formatNumber(r.sessions)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : view === "campaignXPage" ? (
                // ========================================================
                // VIEW: Campanha × LP — cruza com página de conversão
                // ========================================================
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/50 border-b border-[color:var(--border)] sticky top-0">
                    <tr>
                      <Th label="Campanha (origem)" align="left" />
                      <Th label="Origem / Mídia" align="left" />
                      <Th label="LP de conversão" align="left" />
                      <ThSortable label="Leads" sortKey="leads" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Vendas" sortKey="purchases" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Receita" sortKey="revenue" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-xs italic">
                          Nenhuma conversão (lead ou venda) atribuída a campanha+LP no período selecionado.
                        </td>
                      </tr>
                    )}
                    {(rows as CampaignPageRow[]).slice(0, 100).map((r, i) => (
                      <tr
                        key={`${r.campaign}-${r.sourceMedium}-${r.conversionPage}-${i}`}
                        onClick={() => setSelectedRow(r)}
                        className="border-b border-slate-100 hover:bg-violet-50/50 cursor-pointer transition"
                      >
                        <td className="px-4 py-2.5 max-w-[240px]">
                          <p className="font-semibold text-xs truncate" title={r.campaign}>
                            {r.campaign === "(not set)" ? (
                              <span className="text-slate-400 italic">(sem UTM)</span>
                            ) : (
                              r.campaign
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 max-w-[180px]">
                          <p className="text-[11px] font-mono text-slate-700 truncate" title={r.sourceMedium}>
                            {r.sourceMedium}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 max-w-[260px]">
                          <p
                            className="text-[11px] font-mono text-blue-700 truncate"
                            title={r.conversionPage}
                          >
                            {r.conversionPage}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold text-emerald-700">
                          {formatNumber(r.leads)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold text-violet-700">
                          {formatNumber(r.purchases)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                          {r.revenue > 0 ? formatBRL(r.revenue) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                // ========================================================
                // VIEWS PADRÃO: channel / sourceMedium / campaign
                // ========================================================
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/50 border-b border-[color:var(--border)] sticky top-0">
                    <tr>
                      <Th
                        label={view === "channel" ? "Canal" : view === "campaign" ? "Campanha" : "Origem / Mídia"}
                        align="left"
                      />
                      <ThSortable label="Sessões" sortKey="sessions" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Leads" sortKey="leads" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Vendas" sortKey="purchases" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Receita" sortKey="revenue" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Conv. Lead %" sortKey="leadConvRate" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Conv. Venda %" sortKey="purchaseConvRate" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                      <ThSortable label="Ticket" sortKey="avgTicket" currentSort={sortKey} desc={sortDesc} onClick={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-xs italic">
                          Nenhum dado retornado nesta combinação de propriedade + período.
                        </td>
                      </tr>
                    )}
                    {(rows as (ChannelRow | SourceMediumRow | CampaignRow)[]).slice(0, 50).map((r, i) => {
                      const isTopConv = r.leadConvRate > (data.totals.avgLeadConvRate || 0) * 1.5;
                      return (
                        <tr
                          key={`${rowLabel(r)}-${rowSub(r) || ""}-${i}`}
                          onClick={() => setSelectedRow(r)}
                          className="border-b border-slate-100 hover:bg-violet-50/50 cursor-pointer transition"
                        >
                          <td className="px-4 py-2.5 max-w-[280px]">
                            <p className="font-semibold text-xs truncate" title={rowLabel(r)}>
                              {rowLabel(r) === "(not set)" ? (
                                <span className="text-slate-400 italic">(sem UTM)</span>
                              ) : (
                                rowLabel(r)
                              )}
                            </p>
                            {rowSub(r) && (
                              <p className="text-[10px] font-mono text-slate-500 truncate">{rowSub(r)}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums">{formatNumber(r.sessions)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums font-semibold text-emerald-700">
                            {formatNumber(r.leads)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums font-semibold text-violet-700">
                            {formatNumber(r.purchases)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                            {r.revenue > 0 ? formatBRL(r.revenue) : "—"}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right text-xs tabular-nums font-bold ${
                              isTopConv ? "text-emerald-600" : "text-slate-700"
                            }`}
                          >
                            {r.leadConvRate}%
                            {isTopConv && <span className="ml-1 text-[9px]">🔥</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums">{r.purchaseConvRate}%</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums text-slate-500">
                            {r.avgTicket > 0 ? formatBRL(r.avgTicket) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {rows.length > (view === "campaignXPage" ? 100 : 50) && (
              <div className="px-5 py-3 text-[11px] text-slate-500 border-t border-[color:var(--border)]">
                Mostrando {view === "campaignXPage" ? 100 : 50} de {rows.length} linhas. Use a busca acima para filtrar, ou exporte pra ver tudo.
              </div>
            )}
          </div>
        </>
      )}

      {/* MODAL DE DETALHES — abre ao clicar em qualquer linha da tabela */}
      {selectedRow && (
        <Dialog
          open={!!selectedRow}
          onClose={() => setSelectedRow(null)}
          title={
            "keyEvents" in selectedRow
              ? `${selectedRow.campaign === "(not set)" ? "(sem UTM)" : selectedRow.campaign}`
              : "conversionPage" in selectedRow
                ? `${selectedRow.campaign === "(not set)" ? "(sem UTM)" : selectedRow.campaign}`
                : "channel" in selectedRow
                  ? `Detalhes: ${selectedRow.channel}`
                  : "campaign" in selectedRow
                    ? `${selectedRow.campaign === "(not set)" ? "(sem UTM)" : selectedRow.campaign}`
                    : `${selectedRow.source} / ${selectedRow.medium}`
          }
          subtitle={
            "keyEvents" in selectedRow
              ? `${selectedRow.sourceMedium}`
              : "conversionPage" in selectedRow
                ? `${selectedRow.sourceMedium} → ${selectedRow.conversionPage}`
                : "campaign" in selectedRow
                  ? `${selectedRow.source} / ${selectedRow.medium}`
                  : "source" in selectedRow
                    ? "Origem / Mídia"
                    : "Canal default GA4"
          }
          maxWidth="max-w-2xl"
          icon={
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center text-white">
              <Target size={18} />
            </div>
          }
        >
          <RowDetailModal row={selectedRow} totals={data?.totals} />
        </Dialog>
      )}
    </div>
  );
}

// ============================================================
// Modal de detalhes — abre quando user clica numa linha da tabela
// ============================================================

function RowDetailModal({
  row,
  totals,
}: {
  row: ChannelRow | SourceMediumRow | CampaignRow | CampaignPageRow | CampaignSourceMediumRow;
  totals?: AttributionResponse["totals"];
}) {
  const isCampaignSourceMedium = "keyEvents" in row;
  const isCampaignPage = "conversionPage" in row;

  if (isCampaignSourceMedium) {
    return (
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/40">
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Campanha (UTM)</p>
            <p className="font-bold text-slate-800 break-all">
              {row.campaign === "(not set)" ? <em className="text-slate-400">(sem UTM)</em> : row.campaign}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/40">
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Origem / Mídia</p>
            <p className="font-mono text-xs text-slate-800 break-all">{row.sourceMedium}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiBox
            icon={Target}
            label="Todas as conversões"
            value={formatNumber(row.keyEvents)}
            color="#10b981"
          />
          <KpiBox
            icon={TrendingUp}
            label="% das conversões"
            value={`${row.keyEventsShare}%`}
            color="#10b981"
          />
          <KpiBox
            icon={ShoppingCart}
            label="Receita total"
            value={row.revenue > 0 ? formatBRL(row.revenue) : "—"}
            color="#7c5cff"
          />
          <KpiBox
            icon={TrendingUp}
            label="% da receita"
            value={`${row.revenueShare}%`}
            color="#7c5cff"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <KpiBox icon={Users} label="Sessões" value={formatNumber(row.sessions)} color="#3b82f6" />
          <KpiBox
            label="Conversões / sessão"
            value={row.sessions > 0 ? `${((row.keyEvents / row.sessions) * 100).toFixed(2)}%` : "—"}
            color="#f59e0b"
          />
        </div>

        <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-3 text-[11px] text-blue-900 flex gap-2">
          <ArrowUpRight size={14} className="text-blue-700 shrink-0 mt-0.5" />
          <p>
            <strong>Como ler:</strong> a campanha{" "}
            <code className="bg-white px-1 rounded font-mono text-[10px]">{row.campaign}</code> via origem{" "}
            <code className="bg-white px-1 rounded font-mono text-[10px]">{row.sourceMedium}</code> gerou{" "}
            <strong>{formatNumber(row.keyEvents)}</strong> conversões totais (Key Events do GA4) e{" "}
            <strong>{formatBRL(row.revenue)}</strong> de receita —{" "}
            <strong>{row.keyEventsShare}%</strong> do total no período.
          </p>
        </div>
      </div>
    );
  }

  if (isCampaignPage) {
    // View especial pra linha do tipo Campanha × LP
    return (
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/40">
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">
              Campanha (origem)
            </p>
            <p className="font-bold text-slate-800 break-all">
              {row.campaign === "(not set)" ? <em className="text-slate-400">(sem UTM)</em> : row.campaign}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/40">
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">
              Origem / Mídia
            </p>
            <p className="font-mono text-xs text-slate-800 break-all">{row.sourceMedium}</p>
          </div>
          <div className="rounded-xl border border-blue-200 p-4 bg-blue-50/40">
            <p className="text-[10px] uppercase font-bold tracking-wider text-blue-700 mb-1">
              LP de conversão
            </p>
            <a
              href={`https://${window.location.host}${row.conversionPage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-blue-800 break-all hover:underline inline-flex items-start gap-1"
            >
              {row.conversionPage}
              <ExternalLink size={11} className="mt-0.5 shrink-0" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <KpiBox icon={Target} label="Leads gerados" value={formatNumber(row.leads)} color="#10b981" />
          <KpiBox icon={ShoppingCart} label="Vendas concluídas" value={formatNumber(row.purchases)} color="#7c5cff" />
          <KpiBox
            icon={TrendingUp}
            label="Receita total"
            value={row.revenue > 0 ? formatBRL(row.revenue) : "—"}
            color="#f59e0b"
          />
        </div>

        {row.purchases > 0 && row.leads > 0 && (
          <div className="rounded-xl bg-amber-50/40 border border-amber-200 p-4 text-xs text-amber-900">
            <strong>Taxa de venda no funil:</strong>{" "}
            <span className="font-mono">
              {((row.purchases / row.leads) * 100).toFixed(1)}%
            </span>{" "}
            ({row.purchases} venda{row.purchases !== 1 ? "s" : ""} a cada {row.leads} lead
            {row.leads !== 1 ? "s" : ""}).
            {row.purchases > 0 && (
              <>
                {" "}Ticket médio: <strong>{formatBRL(row.revenue / row.purchases)}</strong>.
              </>
            )}
          </div>
        )}

        <div className="rounded-xl bg-blue-50/30 border border-blue-200 p-3 text-[11px] text-blue-900 flex gap-2">
          <ArrowUpRight size={14} className="text-blue-700 shrink-0 mt-0.5" />
          <p>
            <strong>Como ler:</strong> a campanha{" "}
            <code className="bg-white px-1 rounded font-mono text-[10px]">{row.campaign}</code> trouxe o
            usuário via{" "}
            <code className="bg-white px-1 rounded font-mono text-[10px]">{row.sourceMedium}</code>, e ele
            converteu (lead/venda) na página{" "}
            <code className="bg-white px-1 rounded font-mono text-[10px]">{row.conversionPage}</code>.
          </p>
        </div>
      </div>
    );
  }

  // View padrão (channel / source-medium / campaign)
  const standardRow = row as ChannelRow | SourceMediumRow | CampaignRow;
  const share = totals?.sessions ? (standardRow.sessions / totals.sessions) * 100 : 0;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBox icon={Users} label="Sessões" value={formatNumber(standardRow.sessions)} color="#7c5cff" />
        <KpiBox icon={Target} label="Leads" value={formatNumber(standardRow.leads)} color="#10b981" />
        <KpiBox icon={ShoppingCart} label="Vendas" value={formatNumber(standardRow.purchases)} color="#8b5cf6" />
        <KpiBox
          icon={TrendingUp}
          label="Receita"
          value={standardRow.revenue > 0 ? formatBRL(standardRow.revenue) : "—"}
          color="#f59e0b"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiBox label="Conv. Lead" value={`${standardRow.leadConvRate}%`} color="#10b981" />
        <KpiBox label="Conv. Venda" value={`${standardRow.purchaseConvRate}%`} color="#8b5cf6" />
        <KpiBox
          label="Ticket Médio"
          value={standardRow.avgTicket > 0 ? formatBRL(standardRow.avgTicket) : "—"}
          color="#f59e0b"
        />
        <KpiBox label="Engajamento" value={`${standardRow.engagementRate}%`} color="#7c5cff" />
        <KpiBox
          label="Receita / sessão"
          value={standardRow.revenuePerSession > 0 ? formatBRL(standardRow.revenuePerSession) : "—"}
          color="#f97316"
        />
        <KpiBox label="Share do tráfego" value={`${share.toFixed(1)}%`} color="#06b6d4" />
      </div>

      {/* Avaliação automática */}
      <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-3 text-xs text-blue-900">
        <strong>Diagnóstico rápido:</strong>{" "}
        {totals && standardRow.leadConvRate > totals.avgLeadConvRate * 1.5
          ? `Conversão de lead ${(standardRow.leadConvRate / Math.max(totals.avgLeadConvRate, 0.01)).toFixed(1)}x acima da média da propriedade. Forte candidato a escalar.`
          : totals && standardRow.leadConvRate < totals.avgLeadConvRate * 0.5
            ? `Conversão de lead ${(standardRow.leadConvRate / Math.max(totals.avgLeadConvRate, 0.01)).toFixed(1)}x abaixo da média. Investigar qualidade do tráfego ou UX da LP.`
            : "Conversão dentro da média da propriedade."}
      </div>
    </div>
  );
}

function KpiBox({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{ background: `${color}0d`, borderColor: `${color}33` }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon size={11} style={{ color }} />}
        <p className="text-[10px] uppercase font-bold tracking-wider" style={{ color }}>
          {label}
        </p>
      </div>
      <p className="text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Th({ label, align = "right" }: { label: string; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-3 text-${align} text-[10px] font-bold uppercase tracking-wider text-slate-600`}>
      {label}
    </th>
  );
}

function ThSortable({
  label,
  sortKey,
  currentSort,
  desc,
  onClick,
}: {
  label: string;
  sortKey: SortableKey;
  currentSort: SortableKey;
  desc: boolean;
  onClick: (k: SortableKey) => void;
}) {
  const isActive = currentSort === sortKey;
  return (
    <th className="px-4 py-3 text-right">
      <button
        onClick={() => onClick(sortKey)}
        className={`text-[10px] font-bold uppercase tracking-wider transition inline-flex items-center gap-1 ml-auto ${
          isActive ? "text-[#7c5cff]" : "text-slate-600 hover:text-[#7c5cff]"
        }`}
      >
        {label}
        <ArrowUpDown size={9} className={isActive ? "opacity-100" : "opacity-30"} />
        {isActive && <span className="text-[8px]">{desc ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
