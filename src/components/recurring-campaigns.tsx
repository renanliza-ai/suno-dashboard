"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Loader2,
  Target,
  Users,
  ShoppingCart,
  CircleDollarSign,
  Activity,
  Trophy,
  AlertCircle,
  X,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";
import { Dialog } from "@/components/dialog";

/**
 * RecurringCampaigns — bloco que detecta automaticamente campanhas
 * recorrentes (Black Friday, Aniversário Suno, etc.) e mostra:
 *  - Calendário com próximas edições
 *  - Comparativo cross-year (KPIs lado-a-lado)
 *  - Curva diária sobreposta
 *  - Baseline preditivo pra próxima edição
 *
 * Consome /api/ga4/recurring-campaigns (detecção) e
 * /api/ga4/campaign-comparison (comparativo detalhado ao abrir uma campanha).
 */

type Edition = {
  year: number;
  startDate: string;
  endDate: string;
  durationDays: number;
  sessions: number;
  users: number;
  leads: number;
  purchases: number;
  revenue: number;
  peakDate: string;
  peakSessions: number;
  matchedUtms: string[];
};

type DetectedCampaign = {
  id: string;
  displayName: string;
  icon: string;
  typicalMonth?: number;
  typicalDurationDays?: number;
  editions: Edition[];
  nextExpected: {
    startDate: string;
    endDate: string;
    daysUntilStart: number;
    status: "running" | "upcoming" | "past";
  } | null;
  baseline: {
    avgSessions: number;
    avgLeads: number;
    avgPurchases: number;
    avgRevenue: number;
    yoyGrowth: number | null;
  } | null;
};

type RecurringResponse = {
  propertyId: string;
  campaigns: DetectedCampaign[];
  meta: {
    totalDetected: number;
    patternsScanned: number;
    utmsTotal: number;
  };
};

type DailyPoint = {
  dayOffset: number;
  date: string;
  sessions: number;
  users: number;
  leads: number;
  purchases: number;
  revenue: number;
};

type EditionResult = {
  year: number;
  startDate: string;
  endDate: string;
  durationDays: number;
  totals: {
    sessions: number;
    users: number;
    leads: number;
    purchases: number;
    revenue: number;
    avgTicket: number;
    leadConversion: number;
    purchaseConversion: number;
  };
  daily: DailyPoint[];
  topPages: { path: string; sessions: number; leads: number }[];
  topChannels: { channel: string; sessions: number; leads: number; purchases: number; revenue: number }[];
};

type ComparisonResponse = {
  propertyId: string;
  campaignId: string;
  editions: EditionResult[];
  dailyPivot: Record<string, number>[];
  baseline: {
    avgSessions: { value: number; min: number; max: number };
    avgLeads: { value: number; min: number; max: number };
    avgPurchases: { value: number; min: number; max: number };
    avgRevenue: { value: number; min: number; max: number };
    leadConversion: number;
    purchaseConversion: number;
    yoyGrowth: number | null;
    projection: {
      sessions: number;
      leads: number;
      purchases: number;
      revenue: number;
      note: string;
    } | null;
  } | null;
};

const YEAR_COLORS = ["#94a3b8", "#7c5cff", "#10b981", "#f59e0b", "#ec4899"];

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatDateBR(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function relativeTime(days: number): string {
  if (days === 0) return "hoje";
  if (days < 0) return `${Math.abs(days)} dias atrás`;
  if (days < 30) return `em ${days} dias`;
  if (days < 365) return `em ${Math.round(days / 30)} meses`;
  return `em ${Math.round(days / 365)} anos`;
}

export function RecurringCampaigns() {
  const { selectedId, selected, useRealData } = useGA4();
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<RecurringResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<DetectedCampaign | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  // Lazy load — só busca quando o usuário expande pela primeira vez
  useEffect(() => {
    if (!expanded || data || !useRealData || !selectedId) return;
    setLoading(true);
    setError(null);
    const url = `/api/ga4/recurring-campaigns?propertyId=${selectedId}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: RecurringResponse & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        if (d.propertyId === selectedId) setData(d);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [expanded, data, useRealData, selectedId]);

  // Quando seleciona campanha, busca o comparativo detalhado
  useEffect(() => {
    if (!selectedCampaign || !selectedId) return;
    setComparisonLoading(true);
    setComparison(null);
    const editions = selectedCampaign.editions.map((e) => ({
      year: e.year,
      startDate: e.startDate,
      endDate: e.endDate,
      utmPatterns: e.matchedUtms.slice(0, 3), // os 3 UTMs mais relevantes
    }));
    const params = new URLSearchParams({
      propertyId: selectedId,
      campaignId: selectedCampaign.id,
      editions: JSON.stringify(editions),
    });
    fetch(`/api/ga4/campaign-comparison?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ComparisonResponse) => {
        if (d.propertyId === selectedId) setComparison(d);
      })
      .catch(() => undefined)
      .finally(() => setComparisonLoading(false));
  }, [selectedCampaign, selectedId]);

  const runningCampaigns = data?.campaigns.filter((c) => c.nextExpected?.status === "running") || [];
  const upcomingCampaigns =
    data?.campaigns.filter((c) => c.nextExpected?.status === "upcoming") || [];

  if (!useRealData) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden mb-6"
      >
        {/* Header colapsável */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-6 py-4 hover:bg-slate-50/60 transition text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-sm">
            <Calendar size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
              Campanhas Recorrentes
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">
                Beta · detecção automática
              </span>
              {data && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {data.campaigns.length} detectada{data.campaigns.length !== 1 ? "s" : ""}
                </span>
              )}
              {runningCampaigns.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 animate-pulse">
                  🔴 {runningCampaigns.length} rodando agora
                </span>
              )}
            </h3>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
              Black Friday, Aniversário, Semana do Assinante e outras campanhas anuais — comparativo histórico e baseline preditivo pra próxima edição.
            </p>
          </div>
          <ChevronDown
            size={18}
            className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>

        {/* Corpo expandido */}
        {expanded && (
          <div className="px-6 pb-6 border-t border-[color:var(--border)]">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Escaneando 3 anos de UTMs em busca de padrões...
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div>
                  <strong>Erro ao detectar campanhas:</strong> {error}
                </div>
              </div>
            )}

            {data && !loading && data.campaigns.length === 0 && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900">
                <strong className="text-sm">Nenhuma campanha recorrente detectada</strong>
                <p className="mt-1">
                  Escaneamos {data.meta.utmsTotal.toLocaleString("pt-BR")} UTMs dos últimos 3 anos em{" "}
                  {data.meta.patternsScanned} padrões conhecidos (Aniversário, Black Friday, Semana do Assinante,
                  Cyber Monday, Natal, Carnaval, Dia do Cliente, Dia do Consumidor, Mês da Mulher).
                </p>
                <p className="mt-2">
                  Se vocês usam outros nomes de UTM pras campanhas, me avise pra adicionar ao engine de detecção.
                </p>
              </div>
            )}

            {data && !loading && data.campaigns.length > 0 && (
              <>
                {/* Calendário compacto */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.campaigns.map((camp) => {
                    const status = camp.nextExpected?.status || "past";
                    const statusColor =
                      status === "running"
                        ? "from-red-50 to-rose-50 border-red-200 hover:border-red-400"
                        : status === "upcoming"
                          ? "from-blue-50 to-sky-50 border-blue-200 hover:border-blue-400"
                          : "from-slate-50 to-gray-50 border-slate-200 hover:border-slate-400";
                    const statusBadge =
                      status === "running"
                        ? "bg-red-600 text-white"
                        : status === "upcoming"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-400 text-white";
                    const statusLabel =
                      status === "running"
                        ? "🔴 Rodando agora"
                        : status === "upcoming"
                          ? `📅 ${relativeTime(camp.nextExpected?.daysUntilStart || 0)}`
                          : "Encerrada";
                    return (
                      <button
                        key={camp.id}
                        onClick={() => setSelectedCampaign(camp)}
                        className={`bg-gradient-to-br ${statusColor} border rounded-xl p-4 text-left transition group`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="text-2xl">{camp.icon}</div>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${statusBadge}`}>
                            {statusLabel}
                          </span>
                        </div>
                        <h4 className="font-bold text-sm mb-1">{camp.displayName}</h4>
                        <p className="text-[11px] text-slate-600">
                          {camp.editions.length} edição{camp.editions.length !== 1 ? "es" : ""} histórica
                          {camp.editions.length !== 1 ? "s" : ""}
                          {camp.baseline?.yoyGrowth !== null && camp.baseline?.yoyGrowth !== undefined && (
                            <>
                              {" · "}
                              <span
                                className={`font-semibold ${camp.baseline.yoyGrowth >= 0 ? "text-emerald-700" : "text-red-700"}`}
                              >
                                {camp.baseline.yoyGrowth >= 0 ? "+" : ""}
                                {camp.baseline.yoyGrowth}% YoY
                              </span>
                            </>
                          )}
                        </p>
                        {camp.nextExpected && (
                          <p className="text-[10px] text-slate-500 mt-1 font-mono">
                            {formatDateBR(camp.nextExpected.startDate)} → {formatDateBR(camp.nextExpected.endDate)}
                          </p>
                        )}
                        {camp.baseline && (
                          <div className="mt-2 pt-2 border-t border-slate-200/50 grid grid-cols-3 gap-1 text-[10px]">
                            <div>
                              <p className="text-slate-500">Sessões</p>
                              <p className="font-bold">{formatNumber(camp.baseline.avgSessions)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Leads</p>
                              <p className="font-bold">{formatNumber(camp.baseline.avgLeads)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Vendas</p>
                              <p className="font-bold">{formatNumber(camp.baseline.avgPurchases)}</p>
                            </div>
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#7c5cff] group-hover:underline">
                          Ver detalhes <ChevronRight size={10} />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Resumo de "Próximas" no rodapé */}
                {upcomingCampaigns.length > 0 && (
                  <div className="mt-4 rounded-xl bg-blue-50/40 border border-blue-200 p-3 text-xs text-blue-900">
                    <strong className="flex items-center gap-1.5">
                      <Sparkles size={12} /> Próximas {upcomingCampaigns.length} campanha
                      {upcomingCampaigns.length !== 1 ? "s" : ""}:
                    </strong>
                    <p className="mt-1">
                      {upcomingCampaigns
                        .slice(0, 3)
                        .map(
                          (c) =>
                            `${c.icon} ${c.displayName} (${relativeTime(c.nextExpected?.daysUntilStart || 0)})`
                        )
                        .join(" · ")}
                    </p>
                  </div>
                )}

                <p className="mt-3 text-[10px] text-slate-400 italic">
                  Detecção baseada em padrões de UTM (sessionCampaignName). Histórico: 3 anos. Para análises detalhadas, clique em uma campanha.
                </p>
              </>
            )}
          </div>
        )}
      </motion.div>

      {/* MODAL DE COMPARATIVO */}
      {selectedCampaign && (
        <Dialog
          open={!!selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          title={`${selectedCampaign.icon} ${selectedCampaign.displayName} — comparativo histórico`}
          subtitle={`${selectedCampaign.editions.length} edição${selectedCampaign.editions.length !== 1 ? "es" : ""} detectada${selectedCampaign.editions.length !== 1 ? "s" : ""} em ${selected?.displayName || "esta propriedade"}`}
          maxWidth="max-w-5xl"
          icon={
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center text-white text-xl">
              {selectedCampaign.icon}
            </div>
          }
        >
          {comparisonLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Buscando dados detalhados de cada edição...
            </div>
          )}

          {comparison && !comparisonLoading && (
            <CampaignComparisonView comparison={comparison} campaign={selectedCampaign} />
          )}
        </Dialog>
      )}
    </>
  );
}

// ============================================================
// View de comparativo dentro do modal
// ============================================================

function CampaignComparisonView({
  comparison,
  campaign,
}: {
  comparison: ComparisonResponse;
  campaign: DetectedCampaign;
}) {
  const editions = useMemo(
    () => [...comparison.editions].sort((a, b) => a.year - b.year),
    [comparison.editions]
  );

  const [metricView, setMetricView] = useState<"sessions" | "leads" | "purchases">("sessions");

  // Tooltip custom pro chart
  type ChartPoint = { dayOffset: number; [year: string]: number };
  const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs">
        <p className="font-bold mb-1.5">Dia {label !== undefined ? Number(label) + 1 : "—"} da campanha</p>
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-600">{p.name}:</span>
            <span className="font-bold tabular-nums">{formatNumber(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5 text-sm">
      {/* CARDS COMPARATIVOS — uma coluna por edição */}
      <div className={`grid grid-cols-1 md:grid-cols-${Math.min(editions.length, 4)} gap-3`}>
        {editions.map((ed, i) => {
          const color = YEAR_COLORS[i] || "#94a3b8";
          const isLatest = i === editions.length - 1;
          return (
            <div
              key={ed.year}
              className={`rounded-xl border p-4 ${isLatest ? "border-[#7c5cff]/40 bg-gradient-to-br from-violet-50/40 to-white" : "border-slate-200 bg-slate-50/30"}`}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-base font-bold tabular-nums" style={{ color }}>
                  {ed.year}
                </h4>
                {isLatest && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#7c5cff] text-white">
                    última
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-mono mb-3">
                {formatDateBR(ed.startDate)} → {formatDateBR(ed.endDate)}
                <br />
                {ed.durationDays} dias
              </p>
              <div className="space-y-2">
                <KpiRow
                  icon={Users}
                  label="Sessões"
                  value={formatNumber(ed.totals.sessions)}
                  color={color}
                />
                <KpiRow
                  icon={Target}
                  label="Leads"
                  value={formatNumber(ed.totals.leads)}
                  sub={`${ed.totals.leadConversion}% conv.`}
                  color={color}
                />
                <KpiRow
                  icon={ShoppingCart}
                  label="Vendas"
                  value={formatNumber(ed.totals.purchases)}
                  sub={`${ed.totals.purchaseConversion}% conv.`}
                  color={color}
                />
                <KpiRow
                  icon={CircleDollarSign}
                  label="Receita"
                  value={formatBRL(ed.totals.revenue)}
                  sub={ed.totals.avgTicket > 0 ? `Ticket: ${formatBRL(ed.totals.avgTicket)}` : "—"}
                  color={color}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* BASELINE PREDITIVO */}
      {comparison.baseline && comparison.baseline.projection && (
        <div className="rounded-xl border-2 border-dashed border-[#7c5cff]/40 bg-gradient-to-br from-violet-50/60 to-white p-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Trophy size={18} className="text-[#7c5cff]" />
            <h4 className="font-bold">Projeção pra próxima edição</h4>
            {campaign.nextExpected && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-[#7c5cff]/30 text-[#5b3dd4]">
                {formatDateBR(campaign.nextExpected.startDate)} → {formatDateBR(campaign.nextExpected.endDate)}
              </span>
            )}
            {comparison.baseline.yoyGrowth !== null && (
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                  comparison.baseline.yoyGrowth >= 0
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {comparison.baseline.yoyGrowth >= 0 ? <TrendingUp size={11} className="inline" /> : <TrendingDown size={11} className="inline" />}{" "}
                {comparison.baseline.yoyGrowth >= 0 ? "+" : ""}
                {comparison.baseline.yoyGrowth}% YoY
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ProjectionBox
              label="Sessões esperadas"
              value={formatNumber(comparison.baseline.projection.sessions)}
              range={`${formatNumber(comparison.baseline.avgSessions.min)} - ${formatNumber(comparison.baseline.avgSessions.max)}`}
              icon={Users}
            />
            <ProjectionBox
              label="Leads esperados"
              value={formatNumber(comparison.baseline.projection.leads)}
              range={`${formatNumber(comparison.baseline.avgLeads.min)} - ${formatNumber(comparison.baseline.avgLeads.max)}`}
              icon={Target}
            />
            <ProjectionBox
              label="Vendas esperadas"
              value={formatNumber(comparison.baseline.projection.purchases)}
              range={`${formatNumber(comparison.baseline.avgPurchases.min)} - ${formatNumber(comparison.baseline.avgPurchases.max)}`}
              icon={ShoppingCart}
            />
            <ProjectionBox
              label="Receita esperada"
              value={formatBRL(comparison.baseline.projection.revenue)}
              range={`${formatBRL(comparison.baseline.avgRevenue.min)} - ${formatBRL(comparison.baseline.avgRevenue.max)}`}
              icon={CircleDollarSign}
            />
          </div>
          <p className="text-[11px] text-slate-600 mt-3 italic">{comparison.baseline.projection.note}</p>
        </div>
      )}

      {/* CURVA DIÁRIA SOBREPOSTA */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h4 className="font-semibold flex items-center gap-2">
            <Activity size={14} className="text-[#7c5cff]" /> Curva diária sobreposta
          </h4>
          <div className="flex gap-1.5 text-xs">
            {(["sessions", "leads", "purchases"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetricView(m)}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  metricView === m
                    ? "bg-[#7c5cff] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {m === "sessions" ? "Sessões" : m === "leads" ? "Leads" : "Vendas"}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={comparison.dailyPivot as ChartPoint[]} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" />
            <XAxis
              dataKey="dayOffset"
              tick={{ fontSize: 10, fill: "#6b6b80" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `D${v + 1}`}
            />
            <YAxis tick={{ fontSize: 10, fill: "#6b6b80" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatNumber(v)} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {editions.map((ed, i) => (
              <Line
                key={ed.year}
                type="monotone"
                dataKey={`${metricView}_${ed.year}`}
                name={String(ed.year)}
                stroke={YEAR_COLORS[i] || "#94a3b8"}
                strokeWidth={i === editions.length - 1 ? 3 : 2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-500 mt-2 text-center italic">
          Linhas alinhadas pelo "Dia 1" da campanha — facilita ver se a edição atual está performando melhor/pior que históricas.
        </p>
      </div>

      {/* TOP PÁGINAS + TOP CANAIS (da edição mais recente) */}
      {editions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Top 5 LPs (última edição {editions[editions.length - 1].year})
            </h4>
            <div className="space-y-1.5 text-xs">
              {editions[editions.length - 1].topPages.slice(0, 5).map((p) => (
                <div key={p.path} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-0">
                  <span className="font-mono text-[11px] truncate flex-1" title={p.path}>
                    {p.path}
                  </span>
                  <div className="flex gap-3 text-[10px] tabular-nums shrink-0">
                    <span className="text-slate-500">
                      <strong className="text-slate-800">{formatNumber(p.sessions)}</strong> sess
                    </span>
                    <span className="text-emerald-700 font-semibold">{formatNumber(p.leads)} leads</span>
                  </div>
                </div>
              ))}
              {editions[editions.length - 1].topPages.length === 0 && (
                <p className="text-slate-400 text-xs italic">Nenhuma página com tráfego no período.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Top 5 Canais (última edição {editions[editions.length - 1].year})
            </h4>
            <div className="space-y-1.5 text-xs">
              {editions[editions.length - 1].topChannels.slice(0, 5).map((c) => (
                <div key={c.channel} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-0">
                  <span className="font-medium">{c.channel}</span>
                  <div className="flex gap-3 text-[10px] tabular-nums shrink-0">
                    <span className="text-slate-500">
                      <strong className="text-slate-800">{formatNumber(c.sessions)}</strong> sess
                    </span>
                    <span className="text-emerald-700 font-semibold">{formatNumber(c.leads)} leads</span>
                    <span className="text-violet-700 font-semibold">{formatBRL(c.revenue)}</span>
                  </div>
                </div>
              ))}
              {editions[editions.length - 1].topChannels.length === 0 && (
                <p className="text-slate-400 text-xs italic">Nenhum canal com tráfego no período.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiRow({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
        <Icon size={10} style={{ color }} />
        {label}
      </div>
      <div className="text-right">
        <p className="text-sm font-bold tabular-nums">{value}</p>
        {sub && <p className="text-[9px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function ProjectionBox({
  label,
  value,
  range,
  icon: Icon,
}: {
  label: string;
  value: string;
  range: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#7c5cff]/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#7c5cff] font-bold mb-1">
        <Icon size={10} className="text-[#7c5cff]" />
        {label}
      </div>
      <p className="text-xl font-bold text-[#5b3dd4]">{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">Min-Max histórico: {range}</p>
    </div>
  );
}
