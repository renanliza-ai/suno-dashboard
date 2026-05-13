"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Crown,
  Activity,
  Users,
  Search,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { allEvents } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Overview, useGA4Conversions } from "@/lib/ga4-context";
import { MasterOnly } from "@/components/master-only";
import {
  DataStatus,
  PeriodBadge,
  SkeletonBlock,
  DataErrorCard,
} from "@/components/data-status";
import { PurchaseFunnelDiscovery } from "@/components/purchase-funnel-discovery";
import { EventExplorer } from "@/components/event-explorer";

const statusConfig = {
  ok: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", label: "OK" },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", label: "Atenção" },
  missing: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", label: "Ausente" },
};

// Taxonomia: classifica eventos em categorias para cores/agrupamento
const EVENT_CATEGORIES: Record<string, { label: string; color: string }> = {
  purchase: { label: "Conversão", color: "#10b981" },
  purchase_recurring: { label: "Conversão", color: "#10b981" },
  begin_checkout: { label: "Conversão", color: "#10b981" },
  add_payment_info: { label: "Conversão", color: "#10b981" },
  add_shipping_info: { label: "Conversão", color: "#10b981" },
  generate_lead: { label: "Lead", color: "#7c5cff" },
  sign_up: { label: "Lead", color: "#7c5cff" },
  user_login: { label: "Autenticação", color: "#3b82f6" },
  session_start: { label: "Sessão", color: "#f59e0b" },
  first_visit: { label: "Sessão", color: "#f59e0b" },
  page_view: { label: "Navegação", color: "#64748b" },
  scroll_depth: { label: "Engajamento", color: "#06b6d4" },
  user_engagement: { label: "Engajamento", color: "#06b6d4" },
};

const CRITICAL_EVENTS = new Set([
  "purchase",
  "purchase_recurring",
  "begin_checkout",
  "add_payment_info",
  "generate_lead",
  "sign_up",
  "user_login",
]);

type EventRow = {
  name: string;
  count: number;
  users: number;
  status: "ok" | "warning" | "missing";
  critical: boolean;
  category: string;
  color: string;
};

export default function EventosPage() {
  const [filter, setFilter] = useState<"all" | "critical" | "warning">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<EventRow | null>(null);

  const { useRealData } = useGA4();
  const { data: overview, meta, error: ga4Error } = useGA4Overview();
  const { data: conversions } = useGA4Conversions();

  const usingMock = !useRealData;
  const isLoading = useRealData && meta.status === "loading";
  const hasError = useRealData && meta.status === "error";
  const showReal =
    useRealData &&
    (meta.status === "success" || meta.status === "partial") &&
    ((overview?.events && overview.events.length > 0) ||
      (conversions?.funnel?.discoveredEvents && conversions.funnel.discoveredEvents.length > 0));

  // Fonte unificada
  const eventRows: EventRow[] = useMemo(() => {
    // Real: combina events do overview + discoveredEvents do conversions
    if (showReal) {
      const byName = new Map<string, { count: number; users: number }>();
      (overview?.events || []).forEach((e) => {
        byName.set(e.name, { count: e.value, users: 0 });
      });
      (conversions?.funnel?.discoveredEvents || []).forEach((e) => {
        if (!byName.has(e.event)) byName.set(e.event, { count: e.count, users: 0 });
      });
      return Array.from(byName.entries()).map(([name, v]) => {
        const cat = EVENT_CATEGORIES[name] || { label: "Outros", color: "#94a3b8" };
        return {
          name,
          count: v.count,
          users: v.users,
          status: v.count === 0 ? ("missing" as const) : ("ok" as const),
          critical: CRITICAL_EVENTS.has(name),
          category: cat.label,
          color: cat.color,
        };
      });
    }
    return allEvents.map((e) => {
      const cat = EVENT_CATEGORIES[e.name] || { label: "Outros", color: "#94a3b8" };
      return {
        ...e,
        status: e.status as "ok" | "warning" | "missing",
        category: cat.label,
        color: cat.color,
      };
    });
  }, [showReal, overview, conversions]);

  const rows = eventRows
    .filter((e) => {
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "critical") return e.critical;
      if (filter === "warning") return e.status === "warning" || e.status === "missing";
      return true;
    })
    .sort((a, b) => b.count - a.count);

  const totalEvents = eventRows.length;
  const critical = eventRows.filter((e) => e.critical).length;
  const issues = eventRows.filter((e) => e.status !== "ok").length;
  const totalFires = eventRows.reduce((s, e) => s + e.count, 0);

  // Top 10 por contagem (para chart)
  const chartData = [...eventRows].sort((a, b) => b.count - a.count).slice(0, 10);

  // Distribuição por categoria (pie)
  const categoryData = useMemo(() => {
    const map = new Map<string, { value: number; color: string }>();
    eventRows.forEach((e) => {
      const curr = map.get(e.category) || { value: 0, color: e.color };
      map.set(e.category, { value: curr.value + e.count, color: e.color });
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, value: v.value, color: v.color }));
  }, [eventRows]);

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Zap size={20} className="text-white" />
          </span>
          Eventos
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Catálogo de eventos GA4 · saúde do tracking · eventos críticos do funil
        </p>
      </motion.div>

      {/* Data trust banner */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <DataStatus meta={meta} usingMock={usingMock} />
        {showReal && overview?.range && <PeriodBadge range={overview.range} days={overview.days} />}
        {showReal && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">
            {eventRows.length} eventos detectados
          </span>
        )}
      </div>

      {hasError && (
        <div className="mb-4">
          <DataErrorCard meta={meta} error={ga4Error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* ============================================================
          STORYTELLING DO FUNIL DE COMPRA — pedido do Renan pra
          simplificar leitura pra quem não conhece GA4.
          Mostra: pageview → view_item → view_cart → begin_checkout
          → add_payment_info → purchase com gradiente antes/durante/depois
         ============================================================ */}
      <PurchaseFunnelDiscovery />

      {/* ============================================================
          EVENT EXPLORER estilo GA4 Exploration — dimensão × métricas
          com tabela + gráfico de linhas + export CSV.
         ============================================================ */}
      <EventExplorer />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading || hasError ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <SkeletonBlock height={12} className="w-24 mb-3" />
              <SkeletonBlock height={32} className="w-32 mb-2" />
              <SkeletonBlock height={10} className="w-20" />
            </div>
          ))
        ) : (
          <>
            <KpiCard
              label="Eventos Totais"
              value={String(totalEvents)}
              icon={Zap}
              color="#7c5cff"
              sub="distintos no período"
            />
            <KpiCard
              label="Críticos"
              value={String(critical)}
              icon={Crown}
              color="#f59e0b"
              sub="do funil de receita"
            />
            <KpiCard
              label="Com Problemas"
              value={String(issues)}
              icon={AlertTriangle}
              color="#ef4444"
              sub={showReal ? "ausentes ou baixo volume" : "warning + missing"}
            />
            <KpiCard
              label="Disparos Totais"
              value={formatNumber(totalFires)}
              icon={Activity}
              color="#10b981"
              sub="soma de contagens"
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <Activity size={16} className="text-[#7c5cff]" />
            Top 10 eventos por volume
          </h3>
          <p className="text-xs text-[color:var(--muted-foreground)] mb-4">
            Coloridos por categoria — conversão (verde), lead (roxo), autenticação (azul)
          </p>
          {isLoading ? (
            <SkeletonBlock height={280} />
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tickFormatter={formatNumber} fontSize={11} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="name" width={140} fontSize={10} stroke="#475569" />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => formatNumber(Number(value))}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {chartData.map((e, i) => (
                      <Cell key={i} fill={e.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-sm font-semibold mb-1">Distribuição por categoria</h3>
          <p className="text-xs text-[color:var(--muted-foreground)] mb-4">Share de cada grupo</p>
          {isLoading ? (
            <SkeletonBlock height={240} />
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {categoryData.map((c, i) => (
                      <Cell key={i} fill={c.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => formatNumber(Number(value))}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-3 space-y-1">
            {categoryData.map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                <span className="flex-1 text-[color:var(--muted-foreground)]">{c.name}</span>
                <span className="font-semibold tabular-nums">{formatNumber(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]"
          />
          <input
            type="text"
            placeholder="Filtrar evento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff] bg-white w-64"
          />
        </div>
        {(["all", "critical", "warning"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              filter === f
                ? "bg-[#7c5cff] text-white"
                : "bg-white border border-[color:var(--border)] text-[color:var(--muted-foreground)]"
            }`}
          >
            {f === "all" ? "Todos" : f === "critical" ? "Críticos" : "Com problemas"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--muted)]/50 border-b border-[color:var(--border)]">
            <tr>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Evento
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Categoria
              </th>
              <th className="text-right px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Contagem
              </th>
              <th className="text-right px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Usuários
              </th>
              <th className="text-center px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Crítico
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-[color:var(--border)]">
                  <td colSpan={6} className="px-4 py-3">
                    <SkeletonBlock height={20} />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-xs text-[color:var(--muted-foreground)]"
                >
                  Nenhum evento corresponde ao filtro.
                </td>
              </tr>
            ) : (
              rows.map((e, i) => {
                const s = statusConfig[e.status];
                const SIcon = s.icon;
                return (
                  <motion.tr
                    key={e.name}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 10) * 0.02 }}
                    onClick={() => setSelected(e)}
                    className="border-b border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold ${s.bg} ${s.color}`}
                      >
                        <SIcon size={10} />
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{e.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold"
                        style={{ background: `${e.color}18`, color: e.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.color }} />
                        {e.category}
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 tabular-nums text-xs font-semibold">
                      {formatNumber(e.count)}
                    </td>
                    <td className="text-right px-4 py-3 tabular-nums text-xs">
                      {e.users ? formatNumber(e.users) : "—"}
                    </td>
                    <td className="text-center px-4 py-3">
                      {e.critical && <Crown size={12} className="text-amber-500 inline" />}
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selected && (
          <EventDetailModal
            event={selected}
            onClose={() => setSelected(null)}
            total={totalFires}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
  sub?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-5"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
          {label}
        </div>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-[color:var(--muted-foreground)] mt-1">{sub}</div>}
    </motion.div>
  );
}

function EventDetailModal({
  event,
  onClose,
  total,
}: {
  event: EventRow;
  onClose: () => void;
  total: number;
}) {
  const share = total > 0 ? ((event.count / total) * 100).toFixed(2) : "0";
  const avgPerUser = event.users ? (event.count / event.users).toFixed(1) : "—";

  const recommendations: string[] = [];
  if (event.status === "missing") {
    recommendations.push("Evento ausente — verifique GTM/dataLayer para garantir que está sendo disparado.");
  }
  if (event.status === "warning") {
    recommendations.push("Volume abaixo do esperado — confira trigger e condições de disparo.");
  }
  if (event.critical) {
    recommendations.push("Evento crítico — deve estar configurado como Key Event no GA4.");
  }
  if (event.name === "add_shipping_info") {
    recommendations.push(
      "Recomendação Suno: migrar para add_payment_info, que reflete melhor o comportamento do funil financeiro."
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("Evento saudável — continue monitorando tendências semanais.");
  }

  return (
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
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
      >
        <div
          className="p-6 text-white rounded-t-2xl relative"
          style={{ background: `linear-gradient(135deg, ${event.color}, ${event.color}dd)` }}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} />
          </button>
          <div className="text-xs uppercase tracking-wider opacity-80 mb-1">
            {event.category} {event.critical && "· Crítico"}
          </div>
          <div className="font-mono text-2xl font-bold pr-10">{event.name}</div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Stat label="Contagem" value={formatNumber(event.count)} />
            <Stat label="Usuários" value={event.users ? formatNumber(event.users) : "—"} />
            <Stat label="Share" value={`${share}%`} />
            <Stat label="Disparos / usuário" value={avgPerUser} />
            <Stat label="Status" value={statusConfig[event.status].label} />
            <Stat label="Crítico" value={event.critical ? "Sim" : "Não"} />
          </div>

          {/* Recomendações — MASTER ONLY */}
          <MasterOnly>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
                Recomendações
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">Master</span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-700">
                {recommendations.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          </MasterOnly>

          <div className="p-3 rounded-lg bg-[#ede9fe] border border-[#ddd6fe] text-xs text-[#5b3dd4]">
            <Users size={12} className="inline mr-1" />
            Ver este evento no funil de jornada em <strong>Conversões</strong>.
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl border border-[color:var(--border)]">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-1">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
