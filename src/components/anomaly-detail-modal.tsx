"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import {
  X,
  TrendingUp,
  TrendingDown,
  Loader2,
  Activity,
  ExternalLink,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Anomaly } from "@/lib/ga4-context";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

type DrillDown = {
  title: string;
  columns: string[];
  rows: { label: string; values: (string | number)[] }[];
};

type AnomalyDetailResponse = {
  propertyId?: string;
  level: string;
  segment: string;
  metric: string;
  baselineDays: number;
  dateRange: { startDate: string; endDate: string };
  series: { date: string; value: number }[];
  lastValue: number;
  baselineMedian: number;
  drilldowns: DrillDown[];
  error?: string;
};

export function AnomalyDetailModal({
  anomaly,
  baselineDays,
  onClose,
}: {
  anomaly: Anomaly | null;
  baselineDays: number;
  onClose: () => void;
}) {
  const { selectedId, selected } = useGA4();
  const [data, setData] = useState<AnomalyDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!anomaly || !selectedId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    // ⚠ Captura o propertyId no momento de abrir o modal — se o user trocar
    // de property enquanto o modal está aberto, a resposta da property antiga
    // será descartada
    const requestPropertyId = selectedId;
    const params = new URLSearchParams({
      propertyId: requestPropertyId,
      level: anomaly.level,
      segment: anomaly.segment,
      metric: anomaly.metric,
      baselineDays: String(baselineDays),
    });
    fetch(`/api/ga4/anomaly-detail?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: AnomalyDetailResponse) => {
        if (cancelled) return;
        // Anti race-condition: descarta se property mudou
        if (d.propertyId && d.propertyId !== requestPropertyId) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [anomaly, selectedId, baselineDays]);

  if (!anomaly) return null;

  const isCritical = anomaly.severity === "critical";
  const accent = isCritical ? "#dc2626" : anomaly.severity === "attention" ? "#f59e0b" : "#10b981";

  // Formato pt-BR pro tick (DD/MM)
  const chartData = (data?.series || []).map((d) => {
    const [, mm, dd] = d.date.split("-");
    return { label: `${dd}/${mm}`, value: d.value, dateRaw: d.date };
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        >
          {/* Header */}
          <div
            className="p-6 text-white relative"
            style={{
              background: `linear-gradient(135deg, ${accent} 0%, ${accent}dd 100%)`,
            }}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <AlertTriangle size={12} />
              {anomaly.level === "macro"
                ? "Anomalia Macro"
                : anomaly.level === "channel"
                  ? "Anomalia por Canal"
                  : "Anomalia por Campanha"}
              · {anomaly.metricLabel}
            </div>
            <h2 className="text-2xl font-bold break-words pr-10">
              {anomaly.segment === "all" ? "Visão Geral" : anomaly.segment}
            </h2>
            <div className="flex items-baseline gap-4 mt-3 flex-wrap">
              <div>
                <div className="text-xs opacity-80">Atual (D-1)</div>
                <div className="text-3xl font-bold tabular-nums">
                  {formatNumber(anomaly.current)}
                </div>
              </div>
              <div>
                <div className="text-xs opacity-80">Baseline (mediana {baselineDays}d)</div>
                <div className="text-2xl font-semibold tabular-nums opacity-90">
                  {formatNumber(anomaly.baseline)}
                </div>
              </div>
              <div>
                <div className="text-xs opacity-80">Variação</div>
                <div className="text-2xl font-bold tabular-nums flex items-center gap-1">
                  {anomaly.direction === "up" ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                  {anomaly.delta > 0 ? "+" : ""}
                  {anomaly.delta.toFixed(1)}%
                </div>
              </div>
              <div className="text-xs opacity-80 ml-auto">
                {selected?.displayName}
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {loading && (
              <div className="flex items-center justify-center py-8 gap-2 text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Buscando detalhamento no GA4...</span>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                <strong>Erro:</strong> {error}
              </div>
            )}

            {data && !loading && (
              <>
                {/* Trend chart */}
                <div className="rounded-xl border border-[color:var(--border)] p-5 bg-slate-50/30">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Activity size={14} style={{ color: accent }} />
                      Série diária — últimos {baselineDays + 1} dias
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                      mediana baseline = {formatNumber(data.baselineMedian)}
                    </span>
                  </div>
                  {chartData.length > 0 ? (
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id={`adm${accent}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                              <stop offset="100%" stopColor={accent} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#f1f5f9" vertical={false} />
                          <XAxis
                            dataKey="label"
                            fontSize={11}
                            stroke="#94a3b8"
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            fontSize={11}
                            stroke="#94a3b8"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => formatNumber(v)}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "white",
                              border: "1px solid #e2e8f0",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            formatter={(v) => [formatNumber(Number(v)), anomaly.metricLabel]}
                          />
                          <ReferenceLine
                            y={data.baselineMedian}
                            stroke="#94a3b8"
                            strokeDasharray="4 4"
                            label={{
                              value: "mediana",
                              fill: "#94a3b8",
                              fontSize: 10,
                              position: "right",
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke={accent}
                            strokeWidth={2.5}
                            fill={`url(#adm${accent})`}
                            dot={{ r: 3, fill: accent }}
                            activeDot={{ r: 5 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 py-8 text-center">
                      Sem dados pra mostrar série temporal.
                    </p>
                  )}
                </div>

                {/* Drilldowns */}
                {data.drilldowns.map((dd, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[color:var(--border)] overflow-hidden"
                  >
                    <div className="px-4 py-2.5 bg-slate-50/70 border-b border-[color:var(--border)] flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{dd.title}</h3>
                      <span className="text-[10px] text-slate-500">
                        {dd.rows.length} item{dd.rows.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {dd.rows.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-slate-500">
                        Sem dados nessa janela.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50/40 border-b border-[color:var(--border)]">
                            <tr>
                              {dd.columns.map((c, j) => (
                                <th
                                  key={j}
                                  className={`px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold ${
                                    j === 0 ? "text-left" : "text-right"
                                  }`}
                                >
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dd.rows.map((row, k) => (
                              <tr key={k} className="border-b border-slate-100 hover:bg-slate-50/40">
                                <td
                                  className="px-4 py-2 font-mono text-xs max-w-[280px] truncate"
                                  title={row.label}
                                >
                                  {row.label === "(not set)" ? (
                                    <span className="text-slate-400 italic">(sem UTM)</span>
                                  ) : (
                                    row.label
                                  )}
                                </td>
                                {row.values.map((v, j) => (
                                  <td
                                    key={j}
                                    className="px-4 py-2 text-right tabular-nums text-xs"
                                  >
                                    {typeof v === "number" ? formatNumber(v) : v}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}

                {/* Hint */}
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 flex items-start gap-2">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  <div>
                    Os números acima são consultados em tempo real do GA4 para o segmento
                    selecionado. Use os drill-downs pra entender <strong>onde</strong> a anomalia
                    ocorreu (campanha específica, página de aterrissagem) e tomar ação.
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
