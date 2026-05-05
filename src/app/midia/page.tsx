"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  ArrowUpDown,
  Download,
  Filter as FilterIcon,
  LayoutGrid,
  TableIcon,
  TrendingUp,
  Search,
  Crown,
  Sparkles,
  Info,
} from "lucide-react";
import {
  reportBySunoChannel,
  reportByChannel,
  reportByPage,
  reportByDevice,
  reportByCampaign,
  trendDataLastClick,
  ReportRow,
} from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { CampaignPerformance } from "@/components/campaign-performance";
import { Dialog } from "@/components/dialog";
import { useGA4, useGA4Reports } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock, DataErrorCard } from "@/components/data-status";

type Dimension = "sunoChannel" | "channel" | "page" | "device" | "campaign";
type ViewMode = "table" | "chart";
type ChartType = "line" | "area" | "bar";

// Ordem das abas: Campanhas primeiro (visão de abertura), resto na sequência.
const dimensionLabels: Record<Dimension, string> = {
  campaign: "Campanha",
  sunoChannel: "Canais Suno (custom)",
  channel: "Canal padrão GA4",
  page: "Página",
  device: "Dispositivo",
};

const dimensionData: Record<Dimension, ReportRow[]> = {
  sunoChannel: reportBySunoChannel,
  channel: reportByChannel,
  page: reportByPage,
  device: reportByDevice,
  campaign: reportByCampaign,
};

type MetricKey =
  | "users"
  | "sessions"
  | "engagedSessions"
  | "conversions"
  | "sessionConvRate"
  | "revenue";

const metrics: {
  key: MetricKey;
  label: string;
  short: string;
  format: "number" | "percent" | "currency";
  hint: string;
}[] = [
  { key: "users", label: "Usuários", short: "Usuários", format: "number", hint: "totalUsers" },
  { key: "sessions", label: "Sessões", short: "Sessões", format: "number", hint: "sessions" },
  { key: "engagedSessions", label: "Sessões Engajadas", short: "Sessões eng.", format: "number", hint: "engagedSessions" },
  { key: "conversions", label: "Conversões", short: "Conversões", format: "number", hint: "conversions" },
  { key: "sessionConvRate", label: "Tx Conversão", short: "Tx Conv.", format: "percent", hint: "sessionConversionRate" },
  { key: "revenue", label: "Receita", short: "Receita", format: "currency", hint: "totalRevenue" },
];

function formatCell(value: number, fmt: string) {
  if (fmt === "percent") return `${value.toFixed(2)}%`;
  if (fmt === "currency") return `R$ ${formatNumber(value)}`;
  return formatNumber(value);
}

const periods = ["7D", "30D", "90D", "YTD", "1A"];

export default function RelatoriosPage() {
  // Campanhas é a visão inicial (mais atrativa como dashboard de abertura).
  const [dimension, setDimension] = useState<Dimension>("campaign");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [period, setPeriod] = useState("30D");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<MetricKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>([
    "users",
    "sessions",
    "engagedSessions",
    "conversions",
    "sessionConvRate",
    "revenue",
  ]);
  const [minConvRate, setMinConvRate] = useState(0);
  const [selectedRow, setSelectedRow] = useState<ReportRow | null>(null);
  const [showCustomDimInfo, setShowCustomDimInfo] = useState(false);

  // Dados reais do GA4 (quando conectado e dim = sunoChannel ou channel)
  const { useRealData } = useGA4();
  const { rows: ga4Rows, usedCustomDim, meta, error: ga4Error } = useGA4Reports(30);
  const usingMock = !useRealData;
  const isLoading = useRealData && meta.status === "loading";
  const hasError = useRealData && meta.status === "error";

  const realRows: ReportRow[] | null =
    ga4Rows && useRealData
      ? ga4Rows.map((r) => ({
          dimension: r.dimension,
          source: r.source,
          medium: r.medium,
          users: r.users,
          sessions: r.sessions,
          engagedSessions: r.engagedSessions,
          conversions: r.conversions,
          sessionConvRate: r.sessionConvRate,
          convRate: r.sessionConvRate,
          revenue: r.revenue,
          pageviews: Math.round(r.sessions * 2.1),
          bounceRate: r.sessions > 0 ? Math.max(0, (1 - r.engagedSessions / r.sessions) * 100) : 0,
          avgDuration: 180,
        }))
      : null;

  const isRealForDimension =
    useRealData && realRows && (dimension === "sunoChannel" || dimension === "channel");
  const data = isRealForDimension ? realRows! : dimensionData[dimension];
  const showSourceMedium = dimension === "sunoChannel" || dimension === "channel" || dimension === "campaign";

  const filtered = useMemo(() => {
    let rows = data.filter(
      (r) =>
        r.dimension.toLowerCase().includes(search.toLowerCase()) &&
        r.sessionConvRate >= minConvRate
    );
    rows = [...rows].sort((a, b) => {
      const diff = (b[sortKey] as number) - (a[sortKey] as number);
      return sortDesc ? diff : -diff;
    });
    return rows;
  }, [data, search, sortKey, sortDesc, minConvRate]);

  const toggleMetric = (k: MetricKey) => {
    setSelectedMetrics((prev) =>
      prev.includes(k) ? prev.filter((m) => m !== k) : [...prev, k]
    );
  };

  const toggleSort = (k: MetricKey) => {
    if (sortKey === k) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        users: acc.users + r.users,
        sessions: acc.sessions + r.sessions,
        engagedSessions: acc.engagedSessions + r.engagedSessions,
        conversions: acc.conversions + r.conversions,
        revenue: acc.revenue + r.revenue,
      }),
      { users: 0, sessions: 0, engagedSessions: 0, conversions: 0, revenue: 0 }
    );
  }, [filtered]);

  const totalConvRate =
    totals.sessions > 0 ? (totals.conversions / totals.sessions) * 100 : 0;
  const engagementRate =
    totals.sessions > 0 ? (totals.engagedSessions / totals.sessions) * 100 : 0;

  const chartData = trendDataLastClick.map((d) => ({
    ...d,
    engagedSessions: Math.floor(d.sessoes * (engagementRate / 100)),
    conversoes: Math.floor(d.sessoes * (totalConvRate / 100)),
  }));

  return (
    <main className="ml-20 p-8 max-w-[1600px]">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
          {dimension === "sunoChannel" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
              <Crown size={10} /> Dimensão custom Suno
            </span>
          )}
          <DataStatus meta={meta} usingMock={usingMock} />
          {isRealForDimension && usedCustomDim && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              <Crown size={10} /> dim custom ativa
            </span>
          )}
        </div>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Explore métricas GA4 com a dimensão personalizada{" "}
          <button
            onClick={() => setShowCustomDimInfo(true)}
            className="underline underline-offset-2 hover:text-[#7c5cff] font-medium"
          >
            sessão canais Suno rev. 08.2024
          </button>
        </p>
      </motion.div>

      {hasError && (
        <div className="mb-4">
          <DataErrorCard meta={meta} error={ga4Error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
          <FilterIcon size={14} />
          Filtros
        </div>

        <div className="flex items-center gap-1 bg-[color:var(--muted)] p-1 rounded-lg">
          {(Object.keys(dimensionLabels) as Dimension[]).map((d) => (
            <button
              key={d}
              onClick={() => setDimension(d)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1 ${
                dimension === d
                  ? d === "sunoChannel"
                    ? "bg-amber-50 text-amber-700 shadow-sm"
                    : "bg-white text-[#7c5cff] shadow-sm"
                  : "text-[color:var(--muted-foreground)]"
              }`}
            >
              {d === "sunoChannel" && <Crown size={10} />}
              {dimensionLabels[d]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[color:var(--muted)] p-1 rounded-lg">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                period === p ? "bg-white text-[#7c5cff] shadow-sm" : "text-[color:var(--muted-foreground)]"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
          <input
            type="text"
            placeholder={`Buscar ${dimensionLabels[dimension].toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff] transition"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label className="text-[color:var(--muted-foreground)]">Conv. mín.:</label>
          <input
            type="range"
            min="0"
            max="5"
            step="0.1"
            value={minConvRate}
            onChange={(e) => setMinConvRate(parseFloat(e.target.value))}
            className="w-24 accent-[#7c5cff]"
          />
          <span className="font-semibold tabular-nums w-10">{minConvRate.toFixed(1)}%</span>
        </div>

        <div className="flex items-center gap-1 bg-[color:var(--muted)] p-1 rounded-lg ml-auto">
          <button
            onClick={() => setViewMode("table")}
            className={`px-2.5 py-1.5 rounded-md transition flex items-center gap-1.5 text-xs font-semibold ${
              viewMode === "table" ? "bg-white text-[#7c5cff] shadow-sm" : "text-[color:var(--muted-foreground)]"
            }`}
          >
            <TableIcon size={13} />
            Tabela
          </button>
          <button
            onClick={() => setViewMode("chart")}
            className={`px-2.5 py-1.5 rounded-md transition flex items-center gap-1.5 text-xs font-semibold ${
              viewMode === "chart" ? "bg-white text-[#7c5cff] shadow-sm" : "text-[color:var(--muted-foreground)]"
            }`}
          >
            <LayoutGrid size={13} />
            Gráfico
          </button>
        </div>

        <button className="px-3 py-1.5 rounded-lg border border-[color:var(--border)] text-xs font-semibold flex items-center gap-1.5 hover:bg-[color:var(--muted)] transition">
          <Download size={13} />
          Exportar
        </button>
      </div>

      {/* Info banner when Suno custom dim is active */}
      {dimension === "sunoChannel" && (
        <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-amber-600" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">
              Usando seu agrupamento personalizado do GA4
            </div>
            <p className="text-xs text-amber-800 mt-0.5">
              Origem e meio da sessão (sessionSource / sessionMedium) seguem a regra custom{" "}
              <strong>sessão canais Suno rev. 08.2024</strong>. Quando a API retornar esse custom
              channel group, substitui automaticamente o canal padrão do GA4.
            </p>
          </div>
          <button
            onClick={() => setShowCustomDimInfo(true)}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 flex items-center gap-1"
          >
            <Info size={12} /> Detalhes
          </button>
        </div>
      )}

      {dimension === "campaign" && <CampaignPerformance />}

      {/* KPI Totals */}
      <div className="grid grid-cols-6 gap-3 mb-4">
        {isLoading || hasError ? (
          [0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-[color:var(--border)] p-4">
              <SkeletonBlock height={10} className="w-20 mb-2" />
              <SkeletonBlock height={24} className="w-24" />
            </div>
          ))
        ) : (
          <>
            <KpiCard label="Usuários" value={formatNumber(totals.users)} />
            <KpiCard label="Sessões" value={formatNumber(totals.sessions)} />
            <KpiCard
              label="Sessões Engajadas"
              value={formatNumber(totals.engagedSessions)}
              sub={`${engagementRate.toFixed(1)}% engajamento`}
            />
            <KpiCard label="Conversões" value={formatNumber(totals.conversions)} />
            <KpiCard label="Tx Conversão" value={`${totalConvRate.toFixed(2)}%`} />
            <KpiCard label="Receita" value={`R$ ${formatNumber(totals.revenue)}`} />
          </>
        )}
      </div>

      {/* Metric toggles */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-2">
          Colunas / Séries visíveis
        </div>
        <div className="flex flex-wrap gap-2">
          {metrics.map((m) => {
            const active = selectedMetrics.includes(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggleMetric(m.key)}
                title={`GA4: ${m.hint}`}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                  active
                    ? "bg-[#ede9fe] border-[#7c5cff] text-[#7c5cff]"
                    : "bg-white border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:border-[#7c5cff]/30"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {viewMode === "table" ? (
        <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[color:var(--muted)]/50 border-b border-[color:var(--border)]">
                <tr>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                    {dimensionLabels[dimension]}
                  </th>
                  {showSourceMedium && (
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                      Origem / Meio
                    </th>
                  )}
                  {metrics
                    .filter((m) => selectedMetrics.includes(m.key))
                    .map((m) => (
                      <th key={m.key} className="text-right px-4 py-3">
                        <button
                          onClick={() => toggleSort(m.key)}
                          className="flex items-center gap-1 ml-auto text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider hover:text-[#7c5cff] transition"
                        >
                          {m.short}
                          <ArrowUpDown size={10} className={sortKey === m.key ? "text-[#7c5cff]" : ""} />
                        </button>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <motion.tr
                    key={row.dimension}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => setSelectedRow(row)}
                    className="border-b border-[color:var(--border)] hover:bg-[#ede9fe]/30 transition cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium">
                      <span className="font-mono text-xs">{row.dimension}</span>
                    </td>
                    {showSourceMedium && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-[11px] font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {row.source ?? "—"}
                          </span>
                          <span className="text-slate-400">/</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {row.medium ?? "—"}
                          </span>
                        </div>
                      </td>
                    )}
                    {metrics
                      .filter((m) => selectedMetrics.includes(m.key))
                      .map((m) => (
                        <td key={m.key} className="text-right px-4 py-3 tabular-nums">
                          {formatCell(row[m.key] as number, m.format)}
                        </td>
                      ))}
                  </motion.tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={selectedMetrics.length + (showSourceMedium ? 2 : 1)}
                      className="text-center py-12 text-sm text-[color:var(--muted-foreground)]"
                    >
                      Nenhum resultado com esses filtros
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] text-[color:var(--muted-foreground)] bg-[color:var(--muted)]/30 flex items-center justify-between">
            <span>{filtered.length} linha(s) · clique para abrir detalhes</span>
            <span>
              Período: {period} · Dimensão: {dimensionLabels[dimension]}
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp size={14} className="text-[#7c5cff]" />
              Evolução temporal · {dimensionLabels[dimension]}
            </h3>
            <div className="flex items-center gap-1 bg-[color:var(--muted)] p-1 rounded-lg">
              {(["line", "area", "bar"] as ChartType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setChartType(t)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    chartType === t ? "bg-white text-[#7c5cff] shadow-sm" : "text-[color:var(--muted-foreground)]"
                  }`}
                >
                  {t === "line" ? "Linha" : t === "area" ? "Área" : "Barra"}
                </button>
              ))}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={360}>
            {chartType === "line" ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b6b80" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6b6b80" }} tickFormatter={(v) => formatNumber(v)} />
                <Tooltip formatter={(v) => formatNumber(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="sessoes" stroke="#7c5cff" strokeWidth={2.5} name="Sessões" />
                <Line type="monotone" dataKey="usuarios" stroke="#10b981" strokeWidth={2.5} name="Usuários" />
                <Line type="monotone" dataKey="engagedSessions" stroke="#3b82f6" strokeWidth={2.5} name="Sessões engajadas" />
                <Line type="monotone" dataKey="conversoes" stroke="#f59e0b" strokeWidth={2.5} name="Conversões" />
              </LineChart>
            ) : chartType === "area" ? (
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rptGradA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c5cff" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#7c5cff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rptGradB" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rptGradC" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b6b80" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6b6b80" }} tickFormatter={(v) => formatNumber(v)} />
                <Tooltip formatter={(v) => formatNumber(Number(v))} />
                <Legend />
                <Area type="monotone" dataKey="sessoes" stroke="#7c5cff" strokeWidth={2.5} fill="url(#rptGradA)" name="Sessões" />
                <Area type="monotone" dataKey="engagedSessions" stroke="#3b82f6" strokeWidth={2.5} fill="url(#rptGradC)" name="Sessões engajadas" />
                <Area type="monotone" dataKey="usuarios" stroke="#10b981" strokeWidth={2.5} fill="url(#rptGradB)" name="Usuários" />
              </AreaChart>
            ) : (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b6b80" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6b6b80" }} tickFormatter={(v) => formatNumber(v)} />
                <Tooltip formatter={(v) => formatNumber(Number(v))} />
                <Legend />
                <Bar dataKey="sessoes" fill="#7c5cff" name="Sessões" radius={[4, 4, 0, 0]} />
                <Bar dataKey="engagedSessions" fill="#3b82f6" name="Sessões engajadas" radius={[4, 4, 0, 0]} />
                <Bar dataKey="conversoes" fill="#f59e0b" name="Conversões" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>

          <div className="mt-4 pt-4 border-t border-[color:var(--border)] grid grid-cols-4 gap-3">
            {filtered.slice(0, 4).map((row) => (
              <button
                key={row.dimension}
                onClick={() => setSelectedRow(row)}
                className="p-3 rounded-lg bg-[color:var(--muted)]/30 text-left hover:bg-[#ede9fe]/50 transition"
              >
                <div className="text-[10px] text-[color:var(--muted-foreground)] uppercase tracking-wider truncate font-mono">
                  {row.dimension}
                </div>
                <div className="text-lg font-bold mt-1">{formatNumber(row.sessions)}</div>
                <div className="text-[11px] text-[color:var(--muted-foreground)]">
                  {formatNumber(row.engagedSessions)} engajadas · {row.sessionConvRate.toFixed(2)}% conv
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Row detail dialog */}
      <Dialog
        open={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={selectedRow?.dimension ?? ""}
        subtitle={
          selectedRow?.source
            ? `origem: ${selectedRow.source} · meio: ${selectedRow.medium}`
            : dimensionLabels[dimension]
        }
        icon={<TrendingUp size={16} className="text-[#7c5cff]" />}
      >
        {selectedRow && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {metrics.map((m) => (
                <div
                  key={m.key}
                  className="p-3 rounded-lg bg-[color:var(--muted)]/40 border border-[color:var(--border)]"
                >
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    {m.label}
                  </div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">
                    {formatCell(selectedRow[m.key] as number, m.format)}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">GA4: {m.hint}</div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-gradient-to-br from-[#ede9fe] to-[#dbeafe] border border-[#c4b5fd]/40">
              <div className="text-xs font-bold text-[#5b3ed6] flex items-center gap-1.5">
                <Sparkles size={12} /> Leitura do copiloto
              </div>
              <p className="text-sm text-slate-700 mt-1">
                {(() => {
                  const engRate = (selectedRow.engagedSessions / selectedRow.sessions) * 100;
                  const revPerSession = selectedRow.revenue / selectedRow.sessions;
                  if (selectedRow.sessionConvRate >= 1) {
                    return `Conversão saudável (${selectedRow.sessionConvRate.toFixed(2)}%). Receita/sessão R$ ${revPerSession.toFixed(2)}. Considere escalar investimento nesse canal.`;
                  }
                  if (engRate < 30) {
                    return `Engajamento baixo (${engRate.toFixed(1)}%) — audiência chega mas não interage. Revise mensagem da campanha ou LP de destino.`;
                  }
                  return `Engajamento ok (${engRate.toFixed(1)}%), mas conversão em ${selectedRow.sessionConvRate.toFixed(2)}%. Teste otimizar checkout ou CTA para extrair mais valor.`;
                })()}
              </p>
            </div>

            {selectedRow.source && (
              <div className="text-[11px] font-mono bg-slate-900 text-slate-100 p-3 rounded-lg">
                <div className="text-slate-400">// Query GA4 equivalente</div>
                <div>dimensionFilter: sessionSource = "{selectedRow.source}"</div>
                <div>                 AND sessionMedium = "{selectedRow.medium}"</div>
                <div className="text-slate-400 mt-1">
                  // Ou pela custom dim: customEvent:session_canais_suno_rev_08_2024 = &quot;{selectedRow.dimension}&quot;
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Custom dim explanation dialog */}
      <Dialog
        open={showCustomDimInfo}
        onClose={() => setShowCustomDimInfo(false)}
        title="sessão canais Suno rev. 08.2024"
        subtitle="Dimensão personalizada do GA4"
        icon={<Crown size={16} className="text-amber-500" />}
      >
        <div className="space-y-4 text-sm">
          <p>
            Esse agrupamento custom que você configurou no GA4 reclassifica as sessões segundo as
            regras da Suno (ex.: separar Paid Search Brand vs Non-Brand, consolidar CRM, separar
            Meta Aquisição vs Retargeting).
          </p>
          <div className="p-3 rounded-lg bg-[color:var(--muted)]/40 border border-[color:var(--border)]">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-1">
              Como o dashboard usa
            </div>
            <ol className="text-xs space-y-1 list-decimal list-inside">
              <li>Requisita o custom channel group via GA4 Data API (quando disponível).</li>
              <li>Se não disponível, cai para <code>sessionDefaultChannelGroup</code> padrão.</li>
              <li>
                Sempre mostra também <strong>origem da sessão</strong> (sessionSource) e{" "}
                <strong>meio da sessão</strong> (sessionMedium) para referência.
              </li>
            </ol>
          </div>
          <div className="p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] font-mono leading-relaxed">
            <div className="text-slate-400">// Exemplo de resposta</div>
            <div>dimensions: [</div>
            <div>  &quot;customEvent:session_canais_suno_rev_08_2024&quot;,</div>
            <div>  &quot;sessionSource&quot;,</div>
            <div>  &quot;sessionMedium&quot;</div>
            <div>]</div>
            <div>metrics: [</div>
            <div>  totalUsers, sessions, engagedSessions,</div>
            <div>  conversions, sessionConversionRate, totalRevenue</div>
            <div>]</div>
          </div>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            💡 Se essa dimensão custom for renomeada no GA4, atualize o ID em{" "}
            <code>src/lib/ga4-server.ts</code>.
          </div>
        </div>
      </Dialog>
    </main>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5">{sub}</div>}
    </div>
  );
}
