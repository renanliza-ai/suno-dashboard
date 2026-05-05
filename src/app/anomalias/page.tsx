"use client";

import { Header } from "@/components/header";
import { MasterGuard } from "@/components/master-guard";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Crown,
  Activity,
  Users,
  Target,
  ShoppingCart,
  Zap,
  Loader2,
  RefreshCw,
  Calendar,
  Filter,
  DollarSign,
} from "lucide-react";
import { useState, useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import {
  useGA4,
  useGA4Anomalies,
  type Anomaly,
  type AnomalyMetric,
  type AnomalySeverity,
} from "@/lib/ga4-context";

const METRIC_ICON: Record<AnomalyMetric, typeof Users> = {
  users: Users,
  sessions: Activity,
  engagedSessions: Zap,
  leads: Target,
  purchases: ShoppingCart,
  revenue: DollarSign,
};

const METRIC_COLOR: Record<AnomalyMetric, string> = {
  users: "#7c5cff",
  sessions: "#3b82f6",
  engagedSessions: "#10b981",
  leads: "#f59e0b",
  purchases: "#ef4444",
  revenue: "#059669",
};

function formatMetricValue(metric: AnomalyMetric, value: number): string {
  if (metric === "revenue") {
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(1)}k`;
    return `R$ ${value.toFixed(0)}`;
  }
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

const SEVERITY_STYLE: Record<AnomalySeverity, string> = {
  critical: "bg-red-50 border-red-300 text-red-800",
  attention: "bg-amber-50 border-amber-300 text-amber-800",
  normal: "bg-emerald-50 border-emerald-300 text-emerald-800",
  low_volume: "bg-slate-50 border-slate-200 text-slate-500",
};

const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  critical: "🔴 Crítico",
  attention: "🟡 Atenção",
  normal: "🟢 Normal",
  low_volume: "○ Volume baixo",
};

function deltaColor(direction: string, severity: AnomalySeverity): string {
  if (severity === "critical" && direction === "down") return "text-red-600";
  if (severity === "critical" && direction === "up") return "text-emerald-600";
  if (severity === "attention" && direction === "down") return "text-amber-600";
  if (severity === "attention" && direction === "up") return "text-emerald-600";
  if (direction === "up") return "text-emerald-600";
  if (direction === "down") return "text-red-500";
  return "text-slate-500";
}

export default function AnomaliasPage() {
  const { selected, useRealData } = useGA4();
  const [baselineDays, setBaselineDays] = useState(14);
  const [severityFilter, setSeverityFilter] = useState<"all" | AnomalySeverity>("all");
  const { data, loading, error, refetch } = useGA4Anomalies(baselineDays);

  const macroAnomalies = data?.macro || [];
  const channelAnomalies = data?.byChannel || [];
  const campaignAnomalies = data?.byCampaign || [];

  // Filtros
  const filteredChannels = useMemo(() => {
    if (severityFilter === "all") return channelAnomalies;
    return channelAnomalies.filter((a) => a.severity === severityFilter);
  }, [channelAnomalies, severityFilter]);

  const filteredCampaigns = useMemo(() => {
    if (severityFilter === "all") return campaignAnomalies;
    return campaignAnomalies.filter((a) => a.severity === severityFilter);
  }, [campaignAnomalies, severityFilter]);

  // Conta severidades por nível
  const macroCritical = macroAnomalies.filter((a) => a.severity === "critical").length;
  const channelCritical = channelAnomalies.filter((a) => a.severity === "critical").length;
  const campaignCritical = campaignAnomalies.filter((a) => a.severity === "critical").length;

  return (
    <MasterGuard>
      <main className="ml-20 p-8 max-w-[1600px]">
        <Header />

        {/* Pills + meta */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-1.5">
            <Crown size={12} /> Área Master
          </div>
          <div className="px-3 py-1 rounded-full bg-red-50 text-red-700 text-xs font-semibold flex items-center gap-1.5">
            <AlertTriangle size={12} /> Detector de Anomalias
          </div>
          {data?.date && (
            <div className="px-3 py-1 rounded-full bg-white border border-[color:var(--border)] text-slate-700 text-xs font-semibold flex items-center gap-1.5">
              <Calendar size={12} /> Comparando D-1: {data.date}
            </div>
          )}
        </div>

        {/* Header da página */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Detector de Anomalias</h1>
            <p className="text-[color:var(--muted-foreground)] mt-1">
              Compara <strong>ontem</strong> contra a <strong>mediana dos últimos {baselineDays} dias</strong> em
              5 métricas-chave, em 3 níveis (macro · canal · campanha).
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Janela de baseline */}
            <select
              value={baselineDays}
              onChange={(e) => setBaselineDays(Number(e.target.value))}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[color:var(--border)] bg-white"
            >
              <option value={7}>Baseline 7d</option>
              <option value={14}>Baseline 14d</option>
              <option value={30}>Baseline 30d</option>
            </select>
            {/* Filtro severidade */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[color:var(--border)] bg-white"
            >
              <option value="all">Todas severidades</option>
              <option value="critical">Só críticas</option>
              <option value="attention">Só atenção</option>
              <option value="normal">Só normais</option>
            </select>
            <button
              onClick={refetch}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-[#7c5cff] text-white text-xs font-semibold hover:bg-[#6b4bf0] disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Atualizar
            </button>
          </div>
        </div>

        {/* Estados */}
        {!useRealData && (
          <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center gap-2">
            <AlertTriangle size={16} />
            Selecione uma propriedade GA4 no header pra ver anomalias reais.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 flex items-center gap-2">
            <AlertTriangle size={16} />
            Erro ao calcular anomalias: {error}
          </div>
        )}

        {loading && !data && (
          <div className="mb-4 p-6 rounded-xl bg-slate-50 border border-slate-200 text-center">
            <Loader2 size={20} className="animate-spin inline-block text-[#7c5cff]" />
            <p className="text-sm text-slate-600 mt-2">
              Computando anomalias para <strong>{selected?.displayName}</strong>… (15 dias de dados em 6 queries paralelas)
            </p>
          </div>
        )}

        {data && (
          <>
            {/* BRIEFING — destaque no topo */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-2xl bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-6 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-purple-400 blur-3xl opacity-20" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">📊 Briefing diário</h2>
                    <p className="text-xs text-white/70">
                      {selected?.displayName} · D-1 ({data.date}) vs mediana {data.baselineDays}d
                    </p>
                  </div>
                  <div className="ml-auto flex gap-1.5">
                    {macroCritical > 0 && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-red-500/30 text-red-200 border border-red-400/40">
                        {macroCritical} crítico macro
                      </span>
                    )}
                    {channelCritical > 0 && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-500/30 text-amber-200 border border-amber-400/40">
                        {channelCritical} crítico canal
                      </span>
                    )}
                    {campaignCritical > 0 && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-orange-500/30 text-orange-200 border border-orange-400/40">
                        {campaignCritical} crítico campanha
                      </span>
                    )}
                  </div>
                </div>
                <ul className="space-y-2 mt-4">
                  {data.briefing.map((b, i) => (
                    <li
                      key={i}
                      className="text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: b.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>'),
                      }}
                    />
                  ))}
                </ul>
              </div>
            </motion.div>

            {/* MACRO — 5 cards lado a lado */}
            <div className="mb-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-3 flex items-center gap-2">
                <Filter size={12} /> Macro · Visão Geral
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {macroAnomalies.map((a, i) => {
                  const Icon = METRIC_ICON[a.metric];
                  const isCritical = a.severity === "critical";
                  const isAttention = a.severity === "attention";
                  return (
                    <motion.div
                      key={a.metric}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`bg-white rounded-2xl border-2 p-4 ${
                        isCritical
                          ? "border-red-300 shadow-md shadow-red-500/10"
                          : isAttention
                            ? "border-amber-300"
                            : "border-[color:var(--border)]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: `${METRIC_COLOR[a.metric]}15`, color: METRIC_COLOR[a.metric] }}
                        >
                          <Icon size={16} />
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${SEVERITY_STYLE[a.severity]}`}>
                          {SEVERITY_LABEL[a.severity]}
                        </span>
                      </div>
                      <p className="text-[11px] text-[color:var(--muted-foreground)] font-medium">
                        {a.metricLabel}
                      </p>
                      <p className="text-2xl font-bold tracking-tight mt-1 tabular-nums">
                        {formatMetricValue(a.metric, a.current)}
                      </p>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className={`text-sm font-bold ${deltaColor(a.direction, a.severity)}`}>
                          {a.direction === "up" ? <TrendingUp size={12} className="inline" /> : a.direction === "down" ? <TrendingDown size={12} className="inline" /> : null}
                          {" "}
                          {a.delta > 0 ? "+" : ""}
                          {a.delta.toFixed(1)}%
                        </span>
                        <span className="text-[11px] text-[color:var(--muted-foreground)]">
                          vs {formatMetricValue(a.metric, a.baseline)} (med {baselineDays}d)
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* POR CANAL */}
            <div className="mb-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-3 flex items-center gap-2">
                <Filter size={12} /> Por Canal · {filteredChannels.length} anomalias detectadas
              </h3>
              <AnomalyTable rows={filteredChannels.slice(0, 30)} levelLabel="Canal" />
            </div>

            {/* POR CAMPANHA */}
            <div className="mb-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-3 flex items-center gap-2">
                <Filter size={12} /> Por Campanha · {filteredCampaigns.length} anomalias detectadas
              </h3>
              <AnomalyTable rows={filteredCampaigns.slice(0, 30)} levelLabel="Campanha" />
            </div>

            {/* Rodapé com debug */}
            <div className="mt-6 pt-6 border-t border-[color:var(--border)] text-[11px] text-[color:var(--muted-foreground)] flex items-center gap-3 flex-wrap">
              <span>
                <strong>Algoritmo:</strong> classifica como crítico se |Δ| {">"} 25%, atenção entre 10-25%, normal {"<"} 10%. Volume baixo (baseline {"<"} 50) é ignorado pra evitar falso positivo.
              </span>
              <span>·</span>
              <span>Baseline: {data.baselineRange.startDate} → {data.baselineRange.endDate}</span>
            </div>
          </>
        )}
      </main>
    </MasterGuard>
  );
}

function AnomalyTable({ rows, levelLabel }: { rows: Anomaly[]; levelLabel: string }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
        Nenhuma anomalia nesse filtro. ✅
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--muted)] text-xs text-[color:var(--muted-foreground)]">
            <tr>
              <th className="text-left px-4 py-2 font-medium">{levelLabel}</th>
              <th className="text-left px-3 py-2 font-medium">Métrica</th>
              <th className="text-right px-3 py-2 font-medium">Atual (D-1)</th>
              <th className="text-right px-3 py-2 font-medium">Baseline</th>
              <th className="text-right px-3 py-2 font-medium">Δ %</th>
              <th className="text-center px-3 py-2 font-medium">Severidade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => {
              const Icon = METRIC_ICON[a.metric];
              return (
                <tr
                  key={`${a.segment}-${a.metric}-${i}`}
                  className={`border-t border-[color:var(--border)] ${
                    a.severity === "critical" ? "bg-red-50/30" : a.severity === "attention" ? "bg-amber-50/30" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold truncate max-w-[280px]" title={a.segment}>
                    {a.segment === "(not set)" ? (
                      <span className="text-slate-400 italic">(não definido)</span>
                    ) : (
                      a.segment
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ color: METRIC_COLOR[a.metric] }}
                    >
                      <Icon size={11} /> {a.metricLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {formatMetricValue(a.metric, a.current)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted-foreground)]">
                    {formatMetricValue(a.metric, a.baseline)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${deltaColor(a.direction, a.severity)}`}>
                    {a.direction === "up" ? (
                      <TrendingUp size={11} className="inline" />
                    ) : a.direction === "down" ? (
                      <TrendingDown size={11} className="inline" />
                    ) : null}{" "}
                    {a.delta > 0 ? "+" : ""}
                    {a.delta.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${SEVERITY_STYLE[a.severity]}`}>
                      {SEVERITY_LABEL[a.severity]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
