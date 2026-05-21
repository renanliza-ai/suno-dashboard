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

type ViewMode = "channel" | "sourceMedium" | "campaign";
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
  const [view, setView] = useState<ViewMode>("channel");
  const [sortKey, setSortKey] = useState<SortableKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState("");

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

  // Sorting + filtering
  const rows = useMemo(() => {
    if (!data) return [];
    let source: (ChannelRow | SourceMediumRow | CampaignRow)[] =
      view === "channel" ? data.byChannel : view === "sourceMedium" ? data.bySourceMedium : data.byCampaign;
    const q = search.toLowerCase().trim();
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
      channel: "Canal",
      sourceMedium: "Origem / Mídia",
      campaign: "Campanha",
    };
    const sheet: ReportSheet = {
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
      rows: rows.map((r) => [
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
                {/* Toggle de view */}
                <div className="inline-flex rounded-lg border border-[color:var(--border)] overflow-hidden text-xs">
                  {(["channel", "sourceMedium", "campaign"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 font-semibold transition ${
                        view === v ? "bg-[#7c5cff] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {v === "channel" ? "Por Canal" : v === "sourceMedium" ? "Por Origem/Mídia" : "Por Campanha"}
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
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 border-b border-[color:var(--border)] sticky top-0">
                  <tr>
                    <Th label={view === "channel" ? "Canal" : view === "campaign" ? "Campanha" : "Origem / Mídia"} align="left" />
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
                  {rows.slice(0, 50).map((r, i) => {
                    const isTopConv = r.leadConvRate > (data.totals.avgLeadConvRate || 0) * 1.5;
                    return (
                      <tr
                        key={`${rowLabel(r)}-${rowSub(r) || ""}-${i}`}
                        className="border-b border-slate-100 hover:bg-slate-50/50"
                      >
                        <td className="px-4 py-2.5 max-w-[280px]">
                          <p className="font-semibold text-xs truncate" title={rowLabel(r)}>
                            {rowLabel(r) === "(not set)" ? <span className="text-slate-400 italic">(sem UTM)</span> : rowLabel(r)}
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
                        <td className={`px-4 py-2.5 text-right text-xs tabular-nums font-bold ${
                          isTopConv ? "text-emerald-600" : "text-slate-700"
                        }`}>
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
            </div>
            {rows.length > 50 && (
              <div className="px-5 py-3 text-[11px] text-slate-500 border-t border-[color:var(--border)]">
                Mostrando 50 de {rows.length} linhas. Use a busca acima para filtrar, ou exporte pra ver tudo.
              </div>
            )}
          </div>
        </>
      )}
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
