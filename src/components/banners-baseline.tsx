"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Image as ImageIcon,
  Eye,
  MousePointerClick,
  TrendingUp,
  Download,
  Loader2,
  AlertCircle,
  Settings,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Baseline de performance dos banners do site.
 *
 * Cruza 2 eventos configuráveis:
 *   banner_view  → impressão (default)
 *   banner_click → clique (default)
 *
 * Customização: se o tracking usa nomes diferentes (view_promotion,
 * promotion_view, etc), há um seletor preset no header. Também
 * permite digitar nomes custom.
 */

type ApiResponse = {
  propertyId?: string;
  query?: {
    dateRange: { startDate: string; endDate: string };
    days: number;
    viewEvent: string;
    clickEvent: string;
  };
  totals: {
    views: number;
    viewsUsers: number;
    clicks: number;
    clicksUsers: number;
    ctr: number;
  };
  daily: { date: string; views: number; clicks: number; ctr: number }[];
  byPage: {
    path: string;
    views: number;
    clicks: number;
    viewUsers: number;
    clickUsers: number;
    ctr: number;
  }[];
  baseline: {
    ctrMedian: number;
    ctrP25: number;
    ctrP75: number;
    ctrMax: number;
    ctrMin: number;
    samplePagesWithSignificantVolume: number;
    note: string;
  };
  error?: string;
};

// Presets de naming comum pra eventos de banner — pra não obrigar o user
// a digitar os nomes manualmente
const EVENT_PRESETS = [
  { id: "banner", label: "banner_view / banner_click", viewEvent: "banner_view", clickEvent: "banner_click" },
  {
    id: "promotion",
    label: "view_promotion / select_promotion (GA4 Enhanced)",
    viewEvent: "view_promotion",
    clickEvent: "select_promotion",
  },
  {
    id: "promotion_alt",
    label: "promotion_view / promotion_click",
    viewEvent: "promotion_view",
    clickEvent: "promotion_click",
  },
  {
    id: "view_banner",
    label: "view_banner / click_banner",
    viewEvent: "view_banner",
    clickEvent: "click_banner",
  },
];

export function BannersBaseline() {
  const { selectedId, days, customRange } = useGA4();
  const [presetId, setPresetId] = useState("banner");
  const [showSettings, setShowSettings] = useState(false);
  const [customView, setCustomView] = useState("");
  const [customClick, setCustomClick] = useState("");

  const activePreset = EVENT_PRESETS.find((p) => p.id === presetId) || EVENT_PRESETS[0];
  const viewEvent = customView.trim() || activePreset.viewEvent;
  const clickEvent = customClick.trim() || activePreset.clickEvent;

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const requestPropertyId = selectedId;
    setLoading(true);
    setError(null);
    setData(null);
    const params = new URLSearchParams({
      propertyId: selectedId,
      days: String(days),
      viewEvent,
      clickEvent,
    });
    if (customRange) {
      params.set("startDate", customRange.startDate);
      params.set("endDate", customRange.endDate);
    }
    fetch(`/api/eventos/banners?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        if (d.propertyId && d.propertyId !== requestPropertyId) return;
        if (d.error) {
          setError(d.error);
          return;
        }
        setData(d);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedId, days, customRange?.startDate, customRange?.endDate, viewEvent, clickEvent]);

  const chartData = useMemo(() => {
    if (!data?.daily) return [];
    return data.daily.map((d) => {
      const [, mm, dd] = d.date.split("-");
      return { ...d, label: `${dd}/${mm}` };
    });
  }, [data?.daily]);

  const pagesWithClassification = useMemo(() => {
    if (!data?.byPage) return [];
    const { ctrMedian, ctrP25, ctrP75 } = data.baseline;
    return data.byPage.map((p) => {
      let classification: "top" | "good" | "median" | "below" | "low_volume" = "median";
      if (p.views < 100) classification = "low_volume";
      else if (p.ctr >= ctrP75) classification = "top";
      else if (p.ctr >= ctrMedian) classification = "good";
      else if (p.ctr >= ctrP25) classification = "median";
      else classification = "below";
      return { ...p, classification };
    });
  }, [data]);

  const exportCsv = () => {
    if (!data?.byPage) return;
    const headers = ["Página", "Views", "Clicks", "CTR%", "Usuários únicos (view)", "Classificação"];
    const escape = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const classLabels: Record<string, string> = {
      top: "Top 25%",
      good: "Acima da mediana",
      median: "Mediana",
      below: "Abaixo da mediana",
      low_volume: "Volume baixo",
    };
    const lines = [
      headers.join(","),
      ...pagesWithClassification.map((p) =>
        [
          p.path,
          p.views,
          p.clicks,
          `${p.ctr}%`,
          p.viewUsers,
          classLabels[p.classification] || p.classification,
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
    a.download = `banners-baseline-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bg-white rounded-2xl border border-[color:var(--border)] p-5 md:p-6 mb-6">
      <div className="flex items-start justify-between flex-wrap gap-2 mb-5">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ImageIcon size={16} className="text-amber-600" />
            Banners do site — Baseline de CTR
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
              ✓ dado real GA4
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cruzamento <code className="bg-slate-100 px-1 rounded text-[10px]">{viewEvent}</code> ×{" "}
            <code className="bg-slate-100 px-1 rounded text-[10px]">{clickEvent}</code> · últimos{" "}
            {days} dias
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5"
            title="Mudar o nome dos eventos rastreados"
          >
            <Settings size={11} />
            {showSettings ? "Fechar config" : "Config eventos"}
          </button>
          <button
            onClick={exportCsv}
            disabled={!data || data.byPage.length === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Download size={11} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Settings de evento — collapsible */}
      {showSettings && (
        <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-3">
          <div>
            <label className="text-[10px] uppercase font-semibold tracking-wider text-slate-500">
              Preset de eventos
            </label>
            <select
              value={presetId}
              onChange={(e) => {
                setPresetId(e.target.value);
                setCustomView("");
                setCustomClick("");
              }}
              className="mt-1 w-full px-2 py-1.5 text-xs rounded-md border border-[color:var(--border)] bg-white focus:outline-none focus:border-amber-500"
            >
              {EVENT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-semibold tracking-wider text-slate-500">
                Custom view (opcional)
              </label>
              <input
                type="text"
                value={customView}
                onChange={(e) => setCustomView(e.target.value)}
                placeholder={activePreset.viewEvent}
                className="mt-1 w-full px-2 py-1.5 text-xs font-mono rounded-md border border-[color:var(--border)] focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-semibold tracking-wider text-slate-500">
                Custom click (opcional)
              </label>
              <input
                type="text"
                value={customClick}
                onChange={(e) => setCustomClick(e.target.value)}
                placeholder={activePreset.clickEvent}
                className="mt-1 w-full px-2 py-1.5 text-xs font-mono rounded-md border border-[color:var(--border)] focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            Eventos ativos:{" "}
            <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">{viewEvent}</code> +{" "}
            <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">{clickEvent}</code>
          </p>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-10 gap-2 text-slate-500 text-sm">
          <Loader2 size={16} className="animate-spin text-amber-600" />
          Carregando dados de banners do GA4...
        </div>
      )}

      {(error || (data && data.totals.views === 0)) && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Nenhum evento detectado pra esse par no período.</strong>
            <p className="text-xs mt-1">
              Tentamos buscar <code className="bg-amber-100 px-1 rounded">{viewEvent}</code> e{" "}
              <code className="bg-amber-100 px-1 rounded">{clickEvent}</code>. Se o seu GTM dispara
              os banners com outro nome, abra <strong>Config eventos</strong> acima e selecione o
              preset correto ou digite o nome custom.
            </p>
            {error && <p className="text-[10px] mt-2 font-mono opacity-70">{error}</p>}
          </div>
        </div>
      )}

      {data && data.totals.views > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <KpiCard
              label="Impressões"
              value={formatNumber(data.totals.views)}
              sub={`${formatNumber(data.totals.viewsUsers)} usuários únicos`}
              color="#3b82f6"
              icon={Eye}
            />
            <KpiCard
              label="Cliques"
              value={formatNumber(data.totals.clicks)}
              sub={`${formatNumber(data.totals.clicksUsers)} usuários únicos`}
              color="#10b981"
              icon={MousePointerClick}
            />
            <KpiCard
              label="CTR Global"
              value={`${data.totals.ctr}%`}
              sub="média ponderada"
              color="#f59e0b"
              icon={TrendingUp}
            />
            <KpiCard
              label="CTR Mediano"
              value={`${data.baseline.ctrMedian}%`}
              sub={`baseline · ${data.baseline.samplePagesWithSignificantVolume} páginas`}
              color="#f97316"
              icon={TrendingUp}
            />
          </div>

          {/* Card de baseline */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-5">
            <h4 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-1.5">
              📊 Baseline de performance (CTR%)
            </h4>
            <p className="text-[11px] text-amber-700 mb-3">{data.baseline.note}</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <BaselineCard label="Mínimo" value={data.baseline.ctrMin} hint="pior performance" />
              <BaselineCard label="P25" value={data.baseline.ctrP25} hint="quartil inferior" />
              <BaselineCard label="Mediana" value={data.baseline.ctrMedian} hint="performance típica" />
              <BaselineCard label="P75" value={data.baseline.ctrP75} hint="quartil superior" />
              <BaselineCard label="Máximo" value={data.baseline.ctrMax} hint="melhor performance" />
            </div>
            <p className="text-[10px] text-amber-800 mt-3 leading-relaxed">
              <strong>Como usar:</strong> CTR ≥ {data.baseline.ctrP75}% é{" "}
              <strong>top quartil</strong> · CTR &lt; {data.baseline.ctrP25}% é{" "}
              <strong>abaixo da média</strong> e deve ser revisado (posição na página, criativo,
              segmentação).
            </p>
          </div>

          {/* Gráfico */}
          {chartData.length > 0 && (
            <div className="bg-slate-50/30 rounded-xl p-4 mb-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                Evolução diária — views, clicks e CTR
              </h4>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="bnViews" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="bnClicks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
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
                      yAxisId="left"
                      fontSize={10}
                      stroke="#94a3b8"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatNumber}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      fontSize={10}
                      stroke="#f59e0b"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value, name) => {
                        if (name === "CTR") return [`${Number(value).toFixed(2)}%`, name];
                        return [formatNumber(Number(value)), name];
                      }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="views"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#bnViews)"
                      name="Views"
                      dot={false}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="clicks"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#bnClicks)"
                      name="Clicks"
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="ctr"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      name="CTR"
                      strokeDasharray="4 4"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> Views (eixo esquerdo)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Clicks (eixo esquerdo)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> CTR % (eixo direito)
                </span>
              </div>
            </div>
          )}

          {/* Tabela por página */}
          <div className="bg-white rounded-xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50/40 border-b border-[color:var(--border)] flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Performance por página · {pagesWithClassification.length} páginas
              </h4>
              <span className="text-[10px] text-slate-500">Ordenado por views</span>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/40 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Página
                    </th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Views
                    </th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Clicks
                    </th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      CTR%
                    </th>
                    <th className="text-center px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Classificação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagesWithClassification.map((p, i) => {
                    const classConfig: Record<string, { label: string; cls: string }> = {
                      top: { label: "🟢 Top 25%", cls: "bg-emerald-100 text-emerald-700" },
                      good: { label: "🟢 Acima da mediana", cls: "bg-emerald-50 text-emerald-700" },
                      median: { label: "⚪ Mediana", cls: "bg-slate-100 text-slate-700" },
                      below: { label: "🔴 Abaixo da mediana", cls: "bg-red-50 text-red-700" },
                      low_volume: { label: "○ Volume baixo", cls: "bg-slate-50 text-slate-500" },
                    };
                    const cfg = classConfig[p.classification];
                    return (
                      <motion.tr
                        key={`${p.path}-${i}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 20) * 0.015 }}
                        className="border-b border-slate-100 hover:bg-slate-50/40"
                      >
                        <td
                          className="px-4 py-2 font-mono text-xs max-w-[300px] truncate"
                          title={p.path}
                        >
                          {p.path}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">
                          {formatNumber(p.views)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">
                          {formatNumber(p.clicks)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs font-bold text-amber-600">
                          {p.ctr}%
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${cfg.cls}`}
                          >
                            {cfg.label}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  return (
    <div className="bg-white rounded-xl border border-[color:var(--border)] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          {label}
        </div>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="text-xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function BaselineCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="bg-white rounded-md p-2 border border-amber-100">
      <div className="text-[9px] uppercase font-semibold tracking-wider text-amber-600">{label}</div>
      <div className="text-base font-bold tabular-nums text-amber-900 mt-0.5">{value}%</div>
      <div className="text-[9px] text-amber-500 mt-0.5">{hint}</div>
    </div>
  );
}
