"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Lock,
  Users,
  Activity,
  Smartphone,
  Megaphone,
  CreditCard,
  Loader2,
  AlertCircle,
  TrendingUp,
  RefreshCw,
  MapPin,
  Sparkles,
  Heart,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

type AreaLogadaAnalysis = {
  query: {
    propertyId: string;
    startDate: string;
    endDate: string;
    pagePath: string;
    hostname: string;
  };
  onboarding: {
    totalUsers: number;
    activeUsers: number;
    sessions: number;
    pageViews: number;
    avgSessionDuration: number;
    bounceRate: number;
  };
  monthly: { month: string; label: string; users: number; sessions: number; pageViews: number }[];
  devices: { device: string; users: number; sessions: number }[];
  channels: { channel: string; users: number; sessions: number }[];
  purchases: { totalRevenue: number; purchaseRevenue: number; transactions: number };
  plans: { itemName: string; itemCategory: string; quantity: number; revenue: number }[];
  demographics: {
    ageByPlan: { ageBracket: string; itemName: string; quantity: number; revenue: number }[];
    genderByPlan: { gender: string; itemName: string; quantity: number; revenue: number }[];
    coverageNote: string;
  };
  geo: {
    geoByPlan: {
      country: string;
      region: string;
      itemName: string;
      quantity: number;
      revenue: number;
    }[];
  };
  affinity: { interest: string; users: number; engagedSessions: number }[];
  audienceMix: { type: string; users: number; engagedSessions: number }[];
  subscriptionStatus: {
    available: boolean;
    error: string | null;
    scope: string | null;
    dimName: string;
    errors: { scope: string; error: string | null }[];
    rowsGlobal: { status: string; users: number }[];
    rowsFiltered: { status: string; users: number }[];
  };
  userLogin?: {
    totalEvents: number;
    totalUsers: number;
    byPlan: { plan: string; events: number; users: number }[];
    byStatus: { status: string; events: number; users: number }[];
    expiring: {
      in30d: { events: number; users: number };
      in60d: { events: number; users: number };
      in90d: { events: number; users: number };
      expired: { events: number; users: number };
    };
    usedDims: {
      total: string | null;
      plan: string | null;
      status: string | null;
      endDate: string | null;
    };
    errors: {
      total: string | null;
      plan: string | null;
      status: string | null;
      endDate: string | null;
    };
    notes: {
      planDimRequested: string;
      statusDimRequested: string;
      endDateDimRequested: string;
      hint: string;
    };
  };
  caveat: string;
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

const PLAN_COLORS = ["#7c5cff", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#8b5cf6", "#14b8a6"];
const AGE_ORDER = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

/**
 * Mapeia o nome da property pro hostname da NAI correspondente.
 * Renan reportou: hostname ficava fixo em investidor.suno.com.br mesmo
 * trocando para Statusinvest, que tem sua própria área logada.
 */
function getNAIHostForProperty(displayName: string | null | undefined): string {
  const name = (displayName || "").toLowerCase();
  if (name.includes("statusinvest")) return "investidor.statusinvest.com.br";
  // Suno Research, Suno Advisory, Suno Asset etc compartilham
  return "investidor.suno.com.br";
}

/**
 * Mapeia o nome da property pro nome da custom dim de subscription.
 * Renan confirmou no dataLayer:
 *  - Statusinvest usa membership_status
 *  - Suno Research/Advisory usa subscription_status
 */
function getSubscriptionDimForProperty(displayName: string | null | undefined): string {
  const name = (displayName || "").toLowerCase();
  if (name.includes("statusinvest")) return "membership_status";
  return "subscription_status";
}

export default function AreaLogadaPage() {
  const { selectedId, selected } = useGA4();
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState("2025-11-01");
  const [endDate, setEndDate] = useState(today);
  const [pagePath, setPagePath] = useState("/onboarding");
  // Hostname e dim agora são auto-derivados do nome da property, mas
  // o user pode editar manualmente se quiser sobrescrever
  const [hostname, setHostname] = useState(() => getNAIHostForProperty(selected?.displayName));
  const [subscriptionDim, setSubscriptionDim] = useState(() =>
    getSubscriptionDimForProperty(selected?.displayName)
  );
  // Quando a property muda, atualiza hostname e subscriptionDim automaticamente
  // (mas só se o user não tiver editado manualmente — usamos flag pra detectar)
  const [hostnameTouched, setHostnameTouched] = useState(false);
  const [subDimTouched, setSubDimTouched] = useState(false);

  useEffect(() => {
    if (!hostnameTouched) {
      setHostname(getNAIHostForProperty(selected?.displayName));
    }
    if (!subDimTouched) {
      setSubscriptionDim(getSubscriptionDimForProperty(selected?.displayName));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.displayName]);
  const [data, setData] = useState<AreaLogadaAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        propertyId: selectedId || "263739159",
        startDate,
        endDate,
        pagePath,
        hostname,
        subscriptionDim,
      });
      const r = await fetch(`/api/area-logada?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) {
        const t = await r.text();
        setError(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return;
      }
      const d = (await r.json()) as AreaLogadaAnalysis;
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAnalysis();
  };

  // Top planos pro pivot — baseado na quantidade total
  const topPlans = useMemo(() => {
    if (!data) return [];
    return [...data.plans]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
      .map((p) => p.itemName);
  }, [data]);

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1400px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <Lock size={20} className="text-white" />
          </span>
          Área Logada
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Análise de quem chega na NAI em{" "}
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            {hostname}
            {pagePath}
          </code>{" "}
          e qual o perfil de assinatura, demografia, região e interesses.
        </p>
      </motion.div>

      {/* Filtros */}
      <form
        onSubmit={handleRun}
        className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-6 grid grid-cols-1 md:grid-cols-5 gap-3"
      >
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Hostname</label>
          <input
            type="text"
            value={hostname}
            onChange={(e) => {
              setHostname(e.target.value);
              setHostnameTouched(true);
            }}
            className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Path</label>
          <input
            type="text"
            value={pagePath}
            onChange={(e) => setPagePath(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Data início</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Data fim</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {loading ? "Analisando..." : "Rodar análise"}
          </button>
        </div>
      </form>

      {/* Disclaimer */}
      {data && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 flex items-start gap-2 mb-6">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <strong>Como ler:</strong> blocos &quot;Quem chega&quot; e &quot;Quem comprou&quot; são{" "}
            <strong>paralelos</strong> (mesmo período mas não cruzados 1:1 — limitação GA4 sem User-ID).
            Demographics e Afinidades vêm de Google Signals e cobrem ~30-60% dos users (não 100%).
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="bg-white rounded-2xl border p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={32} className="animate-spin text-emerald-600" />
          <span className="text-sm">Rodando 12 queries paralelas no GA4...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-red-700 text-sm">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-6">
          {/* ============================================================
              STORYTELLING DO TOPO — 4 KPIs baseados no evento user_login
              dispatched via dataLayer. Pedido do Renan pra contar a
              história "quem está logando" antes da análise de onboarding.
              ============================================================ */}
          {data.userLogin && (
            <UserLoginStorytelling
              data={data.userLogin}
              propertyName={data.query.hostname.includes("statusinvest") ? "Statusinvest" : "Suno"}
            />
          )}

          {/* Onboarding KPIs */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <Users size={14} className="text-emerald-600" />
              Quem chega na página
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Usuários únicos" value={formatNumber(data.onboarding.totalUsers)} color="#7c5cff" icon={Users} />
              <KpiCard label="Sessões" value={formatNumber(data.onboarding.sessions)} color="#10b981" icon={Activity} />
              <KpiCard label="Pageviews" value={formatNumber(data.onboarding.pageViews)} color="#3b82f6" icon={Lock} />
              <KpiCard label="Tempo médio" value={`${data.onboarding.avgSessionDuration}s`} sub={`Bounce: ${data.onboarding.bounceRate}%`} color="#f59e0b" icon={TrendingUp} />
            </div>
          </section>

          {/* Mensal */}
          {data.monthly.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3">
                Evolução mensal
              </h2>
              <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.monthly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="alUsers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <YAxis fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} tickFormatter={formatNumber} />
                      <Tooltip
                        contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                        formatter={(v) => [formatNumber(Number(v)), "Usuários únicos"]}
                      />
                      <Area type="monotone" dataKey="users" stroke="#10b981" strokeWidth={2.5} fill="url(#alUsers)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200">
                      <tr>
                        <th className="text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold py-2">Mês</th>
                        <th className="text-right text-[10px] uppercase tracking-wider text-slate-500 font-semibold py-2">Usuários</th>
                        <th className="text-right text-[10px] uppercase tracking-wider text-slate-500 font-semibold py-2">Sessões</th>
                        <th className="text-right text-[10px] uppercase tracking-wider text-slate-500 font-semibold py-2">Pageviews</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.monthly.map((m) => (
                        <tr key={m.month} className="border-b border-slate-100">
                          <td className="py-2 font-mono text-xs">{m.label}</td>
                          <td className="py-2 text-right tabular-nums text-xs font-bold">{formatNumber(m.users)}</td>
                          <td className="py-2 text-right tabular-nums text-xs">{formatNumber(m.sessions)}</td>
                          <td className="py-2 text-right tabular-nums text-xs">{formatNumber(m.pageViews)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* Device + Channel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                <Smartphone size={14} className="text-blue-600" />
                Por device
              </h2>
              <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
                {data.devices.length > 0 ? (
                  <div className="space-y-2">
                    {data.devices.map((d, i) => {
                      const total = data.devices.reduce((s, x) => s + x.users, 0);
                      const pct = total > 0 ? (d.users / total) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-mono">{d.device}</span>
                            <span className="font-bold">
                              {formatNumber(d.users)}{" "}
                              <span className="text-slate-400 font-normal">({pct.toFixed(1)}%)</span>
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-4 text-center">Sem dados</p>
                )}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                <Megaphone size={14} className="text-purple-600" />
                Top canais que trazem
              </h2>
              <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
                {data.channels.length > 0 ? (
                  <div className="space-y-2">
                    {data.channels.slice(0, 8).map((c, i) => {
                      const total = data.channels.reduce((s, x) => s + x.users, 0);
                      const pct = total > 0 ? (c.users / total) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-mono">{c.channel || "(direct)"}</span>
                            <span className="font-bold">
                              {formatNumber(c.users)}{" "}
                              <span className="text-slate-400 font-normal">({pct.toFixed(1)}%)</span>
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-4 text-center">Sem dados</p>
                )}
              </div>
            </section>
          </div>

          {/* Compras */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-amber-600" />
              Compras no mesmo período (paralelo, não cruzado)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <KpiCard label="Transações" value={formatNumber(data.purchases.transactions)} color="#f59e0b" icon={CreditCard} />
              <KpiCard label="Receita total" value={formatBRL(data.purchases.totalRevenue || data.purchases.purchaseRevenue)} color="#10b981" icon={TrendingUp} />
              <KpiCard
                label="Ticket médio"
                value={
                  data.purchases.transactions > 0
                    ? formatBRL((data.purchases.totalRevenue || data.purchases.purchaseRevenue) / data.purchases.transactions)
                    : "—"
                }
                color="#7c5cff"
                icon={Activity}
              />
            </div>
            <PlansTable plans={data.plans} />
          </section>

          {/* Faixa Etária × Plano */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <Users size={14} className="text-pink-600" />
              Faixa etária dos compradores por plano
            </h2>
            <DemographicsByPlan ageByPlan={data.demographics.ageByPlan} topPlans={topPlans} note={data.demographics.coverageNote} />
          </section>

          {/* Gênero × Plano */}
          {data.demographics.genderByPlan.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                <Heart size={14} className="text-pink-600" />
                Gênero dos compradores por plano
              </h2>
              <GenderByPlan genderByPlan={data.demographics.genderByPlan} />
            </section>
          )}

          {/* Geo × Plano */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <MapPin size={14} className="text-blue-600" />
              Região por plano
            </h2>
            <GeoByPlan geoByPlan={data.geo.geoByPlan} />
          </section>

          {/* Status do Plano */}
          <section>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-600" />
                Status do plano (ativo / pendente / cancelado)
              </h2>
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Custom dim:
                </label>
                <input
                  type="text"
                  value={subscriptionDim}
                  onChange={(e) => {
                    setSubscriptionDim(e.target.value);
                    setSubDimTouched(true);
                  }}
                  onBlur={fetchAnalysis}
                  className="px-2 py-1 text-xs font-mono rounded-md border border-[color:var(--border)] focus:outline-none focus:border-emerald-500 w-[180px]"
                  placeholder="subscription_status"
                />
              </div>
            </div>
            <SubscriptionStatusBlock status={data.subscriptionStatus} pagePath={pagePath} />
          </section>

          {/* ICP / Afinidades */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <Sparkles size={14} className="text-purple-600" />
              ICP — afinidades e perfil dessa galera
            </h2>
            <ICPBlock affinity={data.affinity} audienceMix={data.audienceMix} />
          </section>
        </div>
      )}
    </main>
  );
}

/**
 * Bloco de storytelling no TOPO da área logada — 4 cards baseados no
 * evento user_login disparado via dataLayer:
 *   1. Logins totais (eventos + users únicos)
 *   2. Por plano (membership_name no Suno, plan_id no Statusinvest)
 *   3. Por status (subscription_status no Suno, membership_status no Statusinvest)
 *   4. Perto do vencimento (membership_end_date dentro de 30/60/90d)
 */
type UserLoginData = NonNullable<AreaLogadaAnalysis["userLogin"]>;

function UserLoginStorytelling({
  data,
  propertyName,
}: {
  data: UserLoginData;
  propertyName: string;
}) {
  // Determina health geral do bloco — se total funcionou, mostra; se não, alert
  const hasTotalData = data.totalEvents > 0;
  const hasPlanData = data.byPlan.length > 0;
  const hasStatusData = data.byStatus.length > 0;
  const hasExpiringData =
    data.expiring.in30d.users +
      data.expiring.in60d.users +
      data.expiring.in90d.users +
      data.expiring.expired.users >
    0;

  if (!hasTotalData) {
    return (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
          <Lock size={14} className="text-emerald-600" />
          Quem está logando — evento <code className="text-xs bg-slate-100 px-1 rounded">user_login</code>
        </h2>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Evento user_login não encontrado no GA4 dessa property.</strong>
            <p className="text-xs mt-1">
              Esperado: dataLayer.push({"{"}event: &apos;user_login&apos;, ...{"}"}) dispatched no momento do login.
              Verifique no GTM se a tag GA4 Event está mapeando esse evento corretamente.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Cores semânticas por status conhecido
  const statusColor: Record<string, string> = {
    active: "#10b981",
    ativo: "#10b981",
    suno_one: "#10b981",
    "suno one": "#10b981",
    pending: "#f59e0b",
    pendente: "#f59e0b",
    trial: "#3b82f6",
    canceled: "#dc2626",
    cancelled: "#dc2626",
    cancelado: "#dc2626",
    expired: "#64748b",
    expirado: "#64748b",
    free: "#94a3b8",
    none: "#94a3b8",
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-2">
          <Lock size={14} className="text-emerald-600" />
          Quem está logando — evento <code className="text-xs bg-slate-100 px-1 rounded normal-case">user_login</code>
        </h2>
        <span className="text-[10px] text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
          ✓ {propertyName} · dataLayer ativo
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* CARD 1 — Logins totais */}
        <div className="bg-white rounded-2xl border-2 border-emerald-200 p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-100 rounded-full -translate-y-12 translate-x-12 opacity-50" />
          <div className="relative">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">
                Logins no período
              </div>
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Lock size={14} className="text-emerald-700" />
              </div>
            </div>
            <div className="text-3xl font-bold tabular-nums text-emerald-700">
              {formatNumber(data.totalUsers)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">usuários únicos</div>
            <div className="mt-2 pt-2 border-t border-emerald-100 text-[10px] text-slate-600">
              <strong>{formatNumber(data.totalEvents)}</strong> eventos disparados
              {data.totalEvents > data.totalUsers && (
                <span className="text-slate-400 ml-1">
                  (~{(data.totalEvents / data.totalUsers).toFixed(1)}x/user)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* CARD 2 — Por plano */}
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Perfil de assinatura
            </div>
            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
              <Sparkles size={14} className="text-violet-700" />
            </div>
          </div>
          {hasPlanData ? (
            <div className="space-y-1.5 mt-2">
              {data.byPlan.slice(0, 4).map((p, i) => {
                const totalUsers = data.byPlan.reduce((s, x) => s + x.users, 0);
                const pct = totalUsers > 0 ? (p.users / totalUsers) * 100 : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="font-mono truncate" title={p.plan}>
                        {p.plan.length > 18 ? p.plan.slice(0, 17) + "…" : p.plan}
                      </span>
                      <span className="font-bold tabular-nums">{formatNumber(p.users)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="text-[9px] text-slate-400 font-mono mt-1">
                via dim {data.usedDims.plan || data.notes.planDimRequested}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 mt-2">
              Custom dim <code className="bg-slate-100 px-1 rounded">{data.notes.planDimRequested}</code> não
              encontrada. Registre no GA4 Admin.
            </div>
          )}
        </div>

        {/* CARD 3 — Por status */}
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Situação do plano
            </div>
            <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
              <CheckCircle2 size={14} className="text-amber-700" />
            </div>
          </div>
          {hasStatusData ? (
            <div className="space-y-1.5 mt-2">
              {data.byStatus.slice(0, 4).map((s, i) => {
                const totalUsers = data.byStatus.reduce((sum, x) => sum + x.users, 0);
                const pct = totalUsers > 0 ? (s.users / totalUsers) * 100 : 0;
                const color = statusColor[s.status.toLowerCase()] || "#64748b";
                return (
                  <div key={i}>
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="font-mono truncate flex items-center gap-1.5" title={s.status}>
                        <span
                          className="w-1.5 h-1.5 rounded-full inline-block"
                          style={{ background: color }}
                        />
                        {s.status.length > 16 ? s.status.slice(0, 15) + "…" : s.status}
                      </span>
                      <span className="font-bold tabular-nums">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="text-[9px] text-slate-400 font-mono mt-1">
                via dim {data.usedDims.status || data.notes.statusDimRequested}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 mt-2">
              Custom dim <code className="bg-slate-100 px-1 rounded">{data.notes.statusDimRequested}</code> não
              encontrada. Registre no GA4 Admin.
            </div>
          )}
        </div>

        {/* CARD 4 — Perto do vencimento */}
        <div
          className={`bg-white rounded-2xl border-2 p-5 ${
            data.expiring.in30d.users > 0 ? "border-red-200" : "border-[color:var(--border)]"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Risco de churn
            </div>
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                data.expiring.in30d.users > 0 ? "bg-red-100" : "bg-slate-100"
              }`}
            >
              <Clock
                size={14}
                className={data.expiring.in30d.users > 0 ? "text-red-700" : "text-slate-500"}
              />
            </div>
          </div>
          {hasExpiringData ? (
            <div className="space-y-1 mt-2 text-[11px]">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Vence em 30d:</span>
                <span className="font-bold text-red-700 tabular-nums">
                  {formatNumber(data.expiring.in30d.users)} users
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">31-60d:</span>
                <span className="font-bold text-amber-700 tabular-nums">
                  {formatNumber(Math.max(0, data.expiring.in60d.users - data.expiring.in30d.users))} users
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">61-90d:</span>
                <span className="font-bold text-amber-600 tabular-nums">
                  {formatNumber(Math.max(0, data.expiring.in90d.users - data.expiring.in60d.users))} users
                </span>
              </div>
              {data.expiring.expired.users > 0 && (
                <div className="flex justify-between items-center pt-1 mt-1 border-t border-slate-100">
                  <span className="text-slate-500">Já expirado:</span>
                  <span className="font-bold text-slate-500 tabular-nums">
                    {formatNumber(data.expiring.expired.users)} users
                  </span>
                </div>
              )}
              <div className="text-[9px] text-slate-400 font-mono mt-1.5">
                via dim {data.usedDims.endDate || data.notes.endDateDimRequested}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 mt-2">
              Sem datas válidas de vencimento (ou dim{" "}
              <code className="bg-slate-100 px-1 rounded">{data.notes.endDateDimRequested}</code> não
              encontrada/vazia). Statusinvest costuma passar 0001-01-01 — verifique se{" "}
              <code className="bg-slate-100 px-1 rounded">membership_end_date</code> está sendo populada
              com data real.
            </div>
          )}
        </div>
      </div>

      {/* Diagnóstico rápido — quando alguma dim falhou */}
      {(!hasPlanData || !hasStatusData || !hasExpiringData) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-900 flex items-start gap-2">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <div>
            <strong>Dimensões esperadas no dataLayer:</strong>{" "}
            <code className="bg-blue-100 px-1 rounded">{data.notes.planDimRequested}</code>{" "}
            (plano),{" "}
            <code className="bg-blue-100 px-1 rounded">{data.notes.statusDimRequested}</code>{" "}
            (status),{" "}
            <code className="bg-blue-100 px-1 rounded">{data.notes.endDateDimRequested}</code>{" "}
            (vencimento). Pra cada uma faltante, registre no GA4 Admin → Custom definitions com escopo
            User. Aguarda 24-48h pra começar a aparecer dado.
          </div>
        </div>
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
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
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

function PlansTable({ plans }: { plans: { itemName: string; itemCategory: string; quantity: number; revenue: number }[] }) {
  const totalRev = plans.reduce((s, p) => s + p.revenue, 0);
  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--border)] bg-slate-50/40">
        <h3 className="text-sm font-semibold">Perfil de assinatura — breakdown por plano</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Vem do array <code className="bg-slate-100 px-1 rounded">items[]</code> do evento purchase
        </p>
      </div>
      {plans.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/30 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Plano</th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Categoria</th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Qtd</th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Receita</th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">% receita</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p, i) => {
                const pct = totalRev > 0 ? (p.revenue / totalRev) * 100 : 0;
                return (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/40">
                    <td className="px-4 py-2 font-mono text-xs max-w-[280px] truncate" title={p.itemName}>
                      {p.itemName}
                    </td>
                    <td className="px-4 py-2 text-xs">{p.itemCategory}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs font-bold">{formatNumber(p.quantity)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs">{formatBRL(p.revenue)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">{pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-xs text-slate-500">
          Nenhuma compra com array <code className="bg-slate-100 px-1 rounded">items</code> populado neste período.
        </div>
      )}
    </div>
  );
}

function DemographicsByPlan({
  ageByPlan,
  topPlans,
  note,
}: {
  ageByPlan: { ageBracket: string; itemName: string; quantity: number; revenue: number }[];
  topPlans: string[];
  note: string;
}) {
  if (ageByPlan.length === 0) {
    return <NoDataBlock note={note} />;
  }

  // Pivot por faixa etária (linhas) × plano (colunas)
  const ageBrackets = AGE_ORDER.filter((a) => ageByPlan.some((r) => r.ageBracket === a));
  const pivotData = ageBrackets.map((age) => {
    const row: Record<string, number | string> = { age };
    let total = 0;
    for (const plan of topPlans) {
      const found = ageByPlan.find((r) => r.ageBracket === age && r.itemName === plan);
      const q = found?.quantity || 0;
      row[plan] = q;
      total += q;
    }
    row["__total__"] = total;
    return row;
  });

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
      <p className="text-[11px] text-amber-700 mb-3 italic flex items-start gap-1.5">
        <AlertCircle size={11} className="mt-0.5 shrink-0" />
        {note}
      </p>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pivotData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="age" fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} />
            <YAxis fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} tickFormatter={formatNumber} />
            <Tooltip
              contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
              formatter={(v, name) => [formatNumber(Number(v)), String(name)]}
            />
            {topPlans.map((plan, i) => (
              <Bar
                key={plan}
                dataKey={plan}
                stackId="a"
                fill={PLAN_COLORS[i % PLAN_COLORS.length]}
                radius={i === topPlans.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-2 mt-3 justify-center">
        {topPlans.map((plan, i) => (
          <div key={plan} className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} />
            {plan}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenderByPlan({
  genderByPlan,
}: {
  genderByPlan: { gender: string; itemName: string; quantity: number; revenue: number }[];
}) {
  // Agrega por gênero
  const byGender = new Map<string, { quantity: number; revenue: number }>();
  for (const r of genderByPlan) {
    const existing = byGender.get(r.gender) || { quantity: 0, revenue: 0 };
    byGender.set(r.gender, {
      quantity: existing.quantity + r.quantity,
      revenue: existing.revenue + r.revenue,
    });
  }
  const total = Array.from(byGender.values()).reduce((s, v) => s + v.quantity, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {Array.from(byGender.entries())
        .sort((a, b) => b[1].quantity - a[1].quantity)
        .map(([gender, v]) => {
          const pct = total > 0 ? (v.quantity / total) * 100 : 0;
          const color = gender === "female" ? "#ec4899" : gender === "male" ? "#3b82f6" : "#94a3b8";
          return (
            <div key={gender} className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 mb-1">
                {gender === "female" ? "Feminino" : gender === "male" ? "Masculino" : gender}
              </div>
              <div className="text-2xl font-bold tabular-nums" style={{ color }}>
                {pct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(v.quantity)} compras · {formatBRL(v.revenue)}
              </div>
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

function GeoByPlan({
  geoByPlan,
}: {
  geoByPlan: { country: string; region: string; itemName: string; quantity: number; revenue: number }[];
}) {
  if (geoByPlan.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-12 text-center text-xs text-slate-500">
        Sem dados de geografia + plano no período.
      </div>
    );
  }
  // Agrega por região (estado)
  const byRegion = new Map<string, { country: string; quantity: number; revenue: number; topPlans: Map<string, number> }>();
  for (const r of geoByPlan) {
    const key = `${r.country} · ${r.region}`;
    const existing = byRegion.get(key) || { country: r.country, quantity: 0, revenue: 0, topPlans: new Map() };
    existing.quantity += r.quantity;
    existing.revenue += r.revenue;
    existing.topPlans.set(r.itemName, (existing.topPlans.get(r.itemName) || 0) + r.quantity);
    byRegion.set(key, existing);
  }
  const sorted = Array.from(byRegion.entries())
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 15);
  const totalQ = sorted.reduce((s, [, v]) => s + v.quantity, 0);

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/30 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Região</th>
            <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Plano top</th>
            <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Compras</th>
            <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Receita</th>
            <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">%</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(([key, v]) => {
            const topPlan = Array.from(v.topPlans.entries()).sort((a, b) => b[1] - a[1])[0];
            const pct = totalQ > 0 ? (v.quantity / totalQ) * 100 : 0;
            return (
              <tr key={key} className="border-b border-slate-100 hover:bg-slate-50/40">
                <td className="px-4 py-2 text-xs font-mono">{key}</td>
                <td className="px-4 py-2 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">{topPlan?.[0] || "—"}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-xs font-bold">{formatNumber(v.quantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-xs">{formatBRL(v.revenue)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">{pct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionStatusBlock({
  status,
  pagePath,
}: {
  status: {
    available: boolean;
    error: string | null;
    scope: string | null;
    dimName: string;
    errors: { scope: string; error: string | null }[];
    rowsGlobal: { status: string; users: number }[];
    rowsFiltered: { status: string; users: number }[];
  };
  pagePath: string;
}) {
  const colorMap: Record<string, { bg: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    active: { bg: "bg-emerald-100", color: "#10b981", icon: CheckCircle2 },
    ativo: { bg: "bg-emerald-100", color: "#10b981", icon: CheckCircle2 },
    pending: { bg: "bg-amber-100", color: "#f59e0b", icon: Clock },
    pendente: { bg: "bg-amber-100", color: "#f59e0b", icon: Clock },
    canceled: { bg: "bg-red-100", color: "#dc2626", icon: XCircle },
    cancelled: { bg: "bg-red-100", color: "#dc2626", icon: XCircle },
    cancelado: { bg: "bg-red-100", color: "#dc2626", icon: XCircle },
    trial: { bg: "bg-blue-100", color: "#3b82f6", icon: Sparkles },
    expired: { bg: "bg-slate-100", color: "#64748b", icon: XCircle },
    expirado: { bg: "bg-slate-100", color: "#64748b", icon: XCircle },
  };

  const renderCards = (rows: { status: string; users: number }[], total: number) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {rows.map((r) => {
        const cfg = colorMap[r.status.toLowerCase()] || { bg: "bg-slate-100", color: "#64748b", icon: Activity };
        const Icon = cfg.icon;
        const pct = total > 0 ? (r.users / total) * 100 : 0;
        return (
          <div key={r.status} className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-500">{r.status}</div>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cfg.bg}`}>
                <Icon size={14} className="" />
              </div>
            </div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: cfg.color }}>
              {formatNumber(r.users)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{pct.toFixed(1)}% do total</div>
          </div>
        );
      })}
    </div>
  );

  // Caso 1: encontrou dado (pelo menos no global)
  if (status.available && (status.rowsGlobal.length > 0 || status.rowsFiltered.length > 0)) {
    const totalGlobal = status.rowsGlobal.reduce((s, r) => s + r.users, 0);
    const totalFiltered = status.rowsFiltered.reduce((s, r) => s + r.users, 0);

    return (
      <div className="space-y-5">
        <div className="text-[11px] text-emerald-700 flex items-center gap-1.5 font-mono">
          <CheckCircle2 size={11} />
          Encontrei dim <strong>{status.dimName}</strong> escopo{" "}
          <strong>{status.scope === "user" ? "User-scoped" : status.scope === "event" ? "Event-scoped" : status.scope}</strong>
        </div>

        {/* PANORAMA 1: GLOBAL — toda property no período */}
        {status.rowsGlobal.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                🌐 Global da property — {formatNumber(totalGlobal)} users
              </h3>
              <span className="text-[10px] text-slate-500 font-mono">
                todos os usuários da property no período
              </span>
            </div>
            {renderCards(status.rowsGlobal, totalGlobal)}
          </div>
        )}

        {/* PANORAMA 2: FILTRADO — só quem passou em /onboarding */}
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              🎯 Quem passou em <code className="bg-slate-100 px-1 rounded">{pagePath}</code> — {formatNumber(totalFiltered)} users
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">
              só os que visitaram a página
            </span>
          </div>
          {status.rowsFiltered.length > 0 ? (
            renderCards(status.rowsFiltered, totalFiltered)
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
              <strong>Nenhum user com subscription_status passou em {pagePath} no período.</strong>{" "}
              Possíveis causas: (a) /onboarding é página de pré-login (user ainda não tem status atribuído ali);
              (b) tracking de subscription_status só dispara depois do login na NAI; (c) volume baixo no recorte.
              Use o panorama global acima pra ver a base total.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Continua pro caso de erro abaixo
  // (intencional — fallthrough)
  // Marker pra limpar warning de unused vars; o bloco abaixo ainda renderiza.
  // void(0);

  // Caso 2: falhou — diagnóstico detalhado mostrando o que tentou
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="text-amber-700 mt-0.5 shrink-0" />
        <div className="space-y-3 text-sm text-amber-900 flex-1">
          <p>
            <strong>Não consegui ler a custom dimension &quot;{status.dimName}&quot;.</strong> Tentei os 3 escopos
            possíveis em paralelo:
          </p>

          {status.errors && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-amber-300">
                  <th className="text-left py-1 font-semibold">Escopo testado</th>
                  <th className="text-left py-1 font-semibold">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {status.errors.map((e) => (
                  <tr key={e.scope} className="border-b border-amber-200">
                    <td className="py-1.5 font-mono text-[10px]">
                      {e.scope === "user" ? `customUser:${status.dimName}` :
                       e.scope === "event" ? `customEvent:${status.dimName}` :
                       status.dimName}
                    </td>
                    <td className="py-1.5 text-[10px]">
                      {e.error ? (
                        <span className="text-red-700">❌ {e.error.slice(0, 100)}</span>
                      ) : (
                        <span className="text-amber-700">⚠ existe mas retornou 0 rows</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="text-xs space-y-2 mt-3 border-t border-amber-300 pt-3">
            <p className="font-semibold">Possíveis causas:</p>
            <ol className="list-decimal ml-5 space-y-1">
              <li>
                <strong>Custom dimension não foi registrada no GA4 Admin.</strong> Mesmo que você passe via
                dataLayer, ela só aparece em queries depois de cadastrada em{" "}
                <code className="bg-amber-100 px-1 rounded">Admin → Custom definitions → Create custom
                dimensions</code>.
              </li>
              <li>
                <strong>Nome diferente.</strong> Pode estar registrada como{" "}
                <code className="bg-amber-100 px-1 rounded">subscriptionStatus</code> (camelCase) ou{" "}
                <code className="bg-amber-100 px-1 rounded">user_subscription_status</code>. Edite o campo &quot;Custom
                dim&quot; acima e teste outras grafias.
              </li>
              <li>
                <strong>Escopo do dataLayer não bate com o registro.</strong> Se cadastrou como User-scoped,
                precisa popular via{" "}
                <code className="bg-amber-100 px-1 rounded">gtag(&apos;set&apos;, &apos;user_properties&apos;, ...)</code>. Se
                cadastrou como Event-scoped, popula via parâmetro do evento direto:{" "}
                <code className="bg-amber-100 px-1 rounded">dataLayer.push(&#123; event: &apos;X&apos;, subscription_status: &apos;active&apos; &#125;)</code>.
              </li>
              <li>
                <strong>Sem dados ainda no período.</strong> GA4 leva 24-48h pra processar custom dimensions
                novas. Se cadastrou recentemente, pode aparecer só amanhã.
              </li>
            </ol>
          </div>

          <p className="text-xs">
            <strong>Como verificar no GA4:</strong> Admin → Custom definitions → procura
            &quot;subscription&quot; na lista. Vai mostrar o nome exato + escopo (User ou Event).
          </p>
        </div>
      </div>
    </div>
  );
}

function ICPBlock({
  affinity,
  audienceMix,
}: {
  affinity: { interest: string; users: number; engagedSessions: number }[];
  audienceMix: { type: string; users: number; engagedSessions: number }[];
}) {
  if (affinity.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900">
        <strong>Sem dados de afinidade no período.</strong> Os interesses (Affinity Categories) só populam
        quando o GA4 tem <strong>Google Signals ON</strong> e o user está logado em uma conta Google.
        Pra ativar: GA4 Admin → Data Settings → Data Collection → Google Signals.
      </div>
    );
  }

  const totalAudienceUsers = audienceMix.reduce((s, x) => s + x.users, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Top interesses */}
      <div className="md:col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-5">
        <h3 className="text-sm font-semibold mb-3">Top interesses (Affinity Categories)</h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Categorias de interesse identificadas pelo Google nos visitantes da página
        </p>
        <div className="space-y-1.5">
          {affinity.slice(0, 12).map((a, i) => {
            const max = affinity[0].users;
            const pct = max > 0 ? (a.users / max) * 100 : 0;
            return (
              <div key={i}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="font-mono truncate max-w-[300px]" title={a.interest}>
                    {a.interest}
                  </span>
                  <span className="font-bold tabular-nums">{formatNumber(a.users)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New vs Returning + Sessões engajadas */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
        <h3 className="text-sm font-semibold mb-3">Novos vs Recorrentes</h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Engajamento de quem chega na página
        </p>
        {audienceMix.length > 0 ? (
          <div className="space-y-3">
            {audienceMix.map((a, i) => {
              const pct = totalAudienceUsers > 0 ? (a.users / totalAudienceUsers) * 100 : 0;
              const engRate =
                a.users > 0 ? Number(((a.engagedSessions / a.users) * 100).toFixed(0)) : 0;
              const color = a.type === "new" ? "#10b981" : "#7c5cff";
              return (
                <div key={i}>
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 mb-0.5">
                    {a.type === "new" ? "Novos" : a.type === "returning" ? "Recorrentes" : a.type}
                  </div>
                  <div className="text-xl font-bold tabular-nums" style={{ color }}>
                    {pct.toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {formatNumber(a.users)} users · {engRate}% engaj.
                  </div>
                  <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-4 text-center">Sem dados</p>
        )}
      </div>
    </div>
  );
}

function NoDataBlock({ note }: { note: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900 flex items-start gap-2">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div>
        <strong>Sem dados de demografia neste período.</strong>
        <p className="text-xs mt-1">{note}</p>
      </div>
    </div>
  );
}
