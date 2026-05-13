"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Search,
  Loader2,
  TrendingUp,
  Download,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Event Explorer estilo GA4 Exploration — pedido do Renan pra ter no
 * painel a mesma flexibilidade do GA4 nativo.
 *
 * Permite:
 *   - Escolher 1 dimensão (eventName, country, deviceCategory, etc)
 *   - Escolher 1-2 métricas (eventCount, totalUsers, sessions, eventValue, etc)
 *   - Filtrar por substring (quando dimensão é eventName)
 *   - Ver tabela ranqueada + gráfico de linhas por dia
 *   - Exportar CSV
 */

type ExplorerRow = {
  dimension: string;
  metric: number;
  metric2: number | null;
};

type ExplorerData = {
  propertyId?: string;
  query: {
    dimension: string;
    metric: string;
    metric2: string | null;
    days: number;
    dateRange: { startDate: string; endDate: string };
    eventFilter: string;
  };
  rows: ExplorerRow[];
  timeline: { date: string; value: number }[];
  totals: { metric: number; metric2: number | null };
  meta: { rowCount: number; timelineDays: number };
};

const DIMENSIONS = [
  { id: "eventName", label: "Nome do evento" },
  { id: "sessionDefaultChannelGroup", label: "Canal de aquisição" },
  { id: "deviceCategory", label: "Tipo de dispositivo" },
  { id: "country", label: "País" },
  { id: "city", label: "Cidade" },
  { id: "operatingSystem", label: "Sistema operacional" },
  { id: "browser", label: "Navegador" },
  { id: "sessionSource", label: "Fonte (source)" },
  { id: "sessionMedium", label: "Meio (medium)" },
  { id: "sessionCampaignName", label: "Campanha" },
  { id: "pagePath", label: "Caminho da página" },
  { id: "hostName", label: "Host (subdomínio)" },
  { id: "newVsReturning", label: "Novo vs Recorrente" },
];

const METRICS = [
  { id: "eventCount", label: "Eventos disparados" },
  { id: "totalUsers", label: "Usuários totais" },
  { id: "activeUsers", label: "Usuários ativos" },
  { id: "sessions", label: "Sessões" },
  { id: "engagedSessions", label: "Sessões engajadas" },
  { id: "eventValue", label: "Valor do evento (R$)" },
  { id: "screenPageViews", label: "Pageviews" },
  { id: "averageSessionDuration", label: "Tempo médio (s)" },
  { id: "bounceRate", label: "Taxa de rejeição" },
  { id: "userEngagementDuration", label: "Tempo de engajamento (s)" },
];

function formatMetricValue(value: number, metricId: string): string {
  if (metricId === "bounceRate") return `${(value * 100).toFixed(1)}%`;
  if (metricId === "averageSessionDuration" || metricId === "userEngagementDuration") {
    if (value >= 60) return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
    return `${value.toFixed(0)}s`;
  }
  if (metricId === "eventValue") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }
  return formatNumber(value);
}

export function EventExplorer() {
  const { selectedId, days, customRange } = useGA4();
  const [dimension, setDimension] = useState("eventName");
  const [metric, setMetric] = useState("eventCount");
  const [metric2, setMetric2] = useState<string>("totalUsers");
  const [eventFilter, setEventFilter] = useState("");
  const [data, setData] = useState<ExplorerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!selectedId) {
      setError("Selecione uma propriedade GA4 no header.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        propertyId: selectedId,
        dimension,
        metric,
        metric2: metric2 || "none",
        days: String(days),
      });
      if (customRange) {
        params.set("startDate", customRange.startDate);
        params.set("endDate", customRange.endDate);
      }
      if (eventFilter.trim()) {
        params.set("eventFilter", eventFilter.trim());
      }
      const r = await fetch(`/api/eventos/explorer?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) {
        const t = await r.text();
        setError(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return;
      }
      const d = (await r.json()) as ExplorerData & { error?: string };
      if (d.error) {
        setError(d.error);
        return;
      }
      if (d.propertyId && d.propertyId !== selectedId) return; // race-condition guard
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, dimension, metric, metric2, days, customRange?.startDate, customRange?.endDate]);

  const chartData = useMemo(() => {
    if (!data?.timeline) return [];
    return data.timeline.map((t) => {
      const [, mm, dd] = t.date.split("-");
      return { label: `${dd}/${mm}`, value: t.value, dateRaw: t.date };
    });
  }, [data?.timeline]);

  const exportCsv = () => {
    if (!data?.rows) return;
    const headers = [
      DIMENSIONS.find((d) => d.id === dimension)?.label || dimension,
      METRICS.find((m) => m.id === metric)?.label || metric,
      ...(metric2 && metric2 !== "none"
        ? [METRICS.find((m) => m.id === metric2)?.label || metric2]
        : []),
    ];
    const escape = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      headers.join(","),
      ...data.rows.map((r) =>
        [
          r.dimension,
          r.metric,
          ...(metric2 && metric2 !== "none" ? [r.metric2 ?? 0] : []),
        ]
          .map(escape)
          .join(",")
      ),
    ];
    const csv = lines.join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `eventos-${dimension}-${metric}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bg-white rounded-2xl border border-[color:var(--border)] p-5 md:p-6 mb-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Activity size={16} className="text-[#7c5cff]" />
            Event Explorer
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
              estilo GA4 Exploration
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Combine dimensão × métricas pra explorar dados livremente — mesmo modelo do GA4 nativo
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!data || data.rows.length === 0}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Download size={11} />
          Exportar CSV ({data?.rows.length || 0})
        </button>
      </div>

      {/* Toolbar — selects de dimensão e métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl">
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Dimensão
          </label>
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-xs rounded-md border border-[color:var(--border)] bg-white focus:outline-none focus:border-[#7c5cff]"
          >
            {DIMENSIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Métrica principal
          </label>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-xs rounded-md border border-[color:var(--border)] bg-white focus:outline-none focus:border-[#7c5cff]"
          >
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Métrica secundária
          </label>
          <select
            value={metric2}
            onChange={(e) => setMetric2(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-xs rounded-md border border-[color:var(--border)] bg-white focus:outline-none focus:border-[#7c5cff]"
          >
            <option value="none">— sem 2ª métrica —</option>
            {METRICS.filter((m) => m.id !== metric).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Filtro {dimension === "eventName" ? "(substring)" : "(ind. disponível)"}
          </label>
          <div className="mt-1 flex">
            <input
              type="text"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchData();
              }}
              placeholder={dimension === "eventName" ? "purchase, lead..." : "só pra eventName"}
              disabled={dimension !== "eventName"}
              className="flex-1 px-2 py-1.5 text-xs rounded-l-md border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff] disabled:bg-slate-100"
            />
            <button
              onClick={fetchData}
              className="px-2 rounded-r-md bg-[#7c5cff] text-white hover:bg-[#6b4bf0] inline-flex items-center"
              title="Aplicar filtro"
            >
              <Search size={11} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-10 gap-2 text-slate-500 text-sm">
          <Loader2 size={16} className="animate-spin text-[#7c5cff]" />
          Carregando dados do GA4...
        </div>
      )}

      {data && (
        <>
          {/* KPIs do total */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-[color:var(--border)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                {METRICS.find((m) => m.id === metric)?.label || metric} (total)
              </div>
              <div className="text-xl font-bold tabular-nums text-[#7c5cff] mt-0.5">
                {formatMetricValue(data.totals.metric, metric)}
              </div>
            </div>
            {metric2 && metric2 !== "none" && data.totals.metric2 !== null && (
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  {METRICS.find((m) => m.id === metric2)?.label || metric2} (total)
                </div>
                <div className="text-xl font-bold tabular-nums text-emerald-600 mt-0.5">
                  {formatMetricValue(data.totals.metric2, metric2)}
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl border border-[color:var(--border)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Valores únicos
              </div>
              <div className="text-xl font-bold tabular-nums mt-0.5">{data.rows.length}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                de {DIMENSIONS.find((d) => d.id === dimension)?.label.toLowerCase()}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[color:var(--border)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Período
              </div>
              <div className="text-xs font-bold tabular-nums mt-1 font-mono">
                {data.query.dateRange.startDate.slice(5)} → {data.query.dateRange.endDate.slice(5)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {data.meta.timelineDays} dias
              </div>
            </div>
          </div>

          {/* Gráfico de linhas */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp size={11} className="text-[#7c5cff]" />
                  Série diária — {METRICS.find((m) => m.id === metric)?.label || metric}
                </h4>
                {loading && <Loader2 size={11} className="animate-spin text-slate-400" />}
              </div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="explorerGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="label"
                      fontSize={10}
                      stroke="#94a3b8"
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={20}
                    />
                    <YAxis
                      fontSize={10}
                      stroke="#94a3b8"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatMetricValue(Number(v), metric)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [
                        formatMetricValue(Number(v), metric),
                        METRICS.find((m) => m.id === metric)?.label || metric,
                      ]}
                      labelFormatter={(l) => `Dia: ${l}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#7c5cff"
                      strokeWidth={2}
                      fill="url(#explorerGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Tabela */}
          <div className="bg-white rounded-xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50/40 border-b border-[color:var(--border)] flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Top 100 por {METRICS.find((m) => m.id === metric)?.label.toLowerCase()}
              </h4>
              <button
                onClick={fetchData}
                disabled={loading}
                className="text-[10px] text-slate-500 hover:text-[#7c5cff] inline-flex items-center gap-1"
                title="Recarregar"
              >
                <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/40 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      {DIMENSIONS.find((d) => d.id === dimension)?.label || dimension}
                    </th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      {METRICS.find((m) => m.id === metric)?.label || metric}
                    </th>
                    {metric2 && metric2 !== "none" && (
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                        {METRICS.find((m) => m.id === metric2)?.label || metric2}
                      </th>
                    )}
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      % do total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={metric2 && metric2 !== "none" ? 4 : 3}
                        className="px-4 py-8 text-center text-xs text-slate-500"
                      >
                        Sem dados pra essa combinação.
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((r, i) => {
                      const pct =
                        data.totals.metric > 0 ? (r.metric / data.totals.metric) * 100 : 0;
                      return (
                        <motion.tr
                          key={`${r.dimension}-${i}`}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i, 20) * 0.015 }}
                          className="border-b border-slate-100 hover:bg-slate-50/40"
                        >
                          <td
                            className="px-4 py-2 font-mono text-xs max-w-[280px] truncate"
                            title={r.dimension}
                          >
                            {r.dimension}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs font-bold text-[#7c5cff]">
                            {formatMetricValue(r.metric, metric)}
                          </td>
                          {metric2 && metric2 !== "none" && (
                            <td className="px-4 py-2 text-right tabular-nums text-xs text-emerald-600 font-semibold">
                              {formatMetricValue(r.metric2 || 0, metric2)}
                            </td>
                          )}
                          <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#7c5cff] rounded-full"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
