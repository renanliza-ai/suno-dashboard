"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  UserPlus,
  Users,
  Activity,
  Smartphone,
  Megaphone,
  CreditCard,
  Loader2,
  AlertCircle,
  TrendingUp,
  RefreshCw,
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
import { MasterOnly } from "@/components/master-only";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

type OnboardingAnalysis = {
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
    error?: string | null;
  };
  monthly: { month: string; label: string; users: number; sessions: number; pageViews: number }[];
  events: { event: string; count: number; users: number }[];
  devices: { device: string; users: number; sessions: number }[];
  channels: { channel: string; users: number; sessions: number }[];
  purchases: { totalRevenue: number; purchaseRevenue: number; transactions: number };
  plans: { itemName: string; itemCategory: string; quantity: number; revenue: number }[];
  caveat: string;
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export default function OnboardingNAIPage() {
  return (
    <MasterOnly>
      <Content />
    </MasterOnly>
  );
}

function Content() {
  const { selectedId } = useGA4();
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState("2025-11-01");
  const [endDate, setEndDate] = useState(today);
  const [pagePath, setPagePath] = useState("/onboarding");
  const [hostname, setHostname] = useState("investidor.suno.com.br");
  const [data, setData] = useState<OnboardingAnalysis | null>(null);
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
      });
      const r = await fetch(`/api/analises/onboarding-nai?${params.toString()}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const t = await r.text();
        setError(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return;
      }
      const d = (await r.json()) as OnboardingAnalysis;
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

  return (
    <main className="ml-20 p-8 max-w-[1400px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <UserPlus size={20} className="text-white" />
          </span>
          Análise de Onboarding na NAI
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 uppercase tracking-wider">
            Master
          </span>
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Quantas pessoas chegaram em <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{hostname}{pagePath}</code> e
          qual o perfil de assinatura no período.
        </p>
      </motion.div>

      {/* Filtros */}
      <form
        onSubmit={handleRun}
        className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-6 grid grid-cols-1 md:grid-cols-5 gap-3"
      >
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Hostname
          </label>
          <input
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Path
          </label>
          <input
            type="text"
            value={pagePath}
            onChange={(e) => setPagePath(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Data início
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
            Data fim
          </label>
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

      {/* Disclaimer importante */}
      {data && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 flex items-start gap-2 mb-6">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <strong>Como ler esta análise:</strong> os blocos &quot;Onboarding&quot; e &quot;Compras&quot; são{" "}
            <strong>paralelos</strong>, não cruzados. Pra cruzar 1:1 (esse usuário passou no onboarding E comprou
            plano X) precisaria de User-ID configurado no GA4. Por isso, leia &quot;X pessoas passaram pelo onboarding;
            no mesmo período tivemos Y compras com Z perfil&quot; — não &quot;X compraram plano Y&quot;.
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="bg-white rounded-2xl border p-12 flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={32} className="animate-spin text-emerald-600" />
          <span className="text-sm">Rodando 7 queries paralelas no GA4...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-red-700 text-sm">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-6">
          {/* Onboarding KPIs */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <Users size={14} className="text-emerald-600" />
              Onboarding — quem chegou na página
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard
                label="Usuários únicos"
                value={formatNumber(data.onboarding.totalUsers)}
                color="#7c5cff"
                icon={Users}
              />
              <KpiCard
                label="Sessões"
                value={formatNumber(data.onboarding.sessions)}
                color="#10b981"
                icon={Activity}
              />
              <KpiCard
                label="Pageviews"
                value={formatNumber(data.onboarding.pageViews)}
                color="#3b82f6"
                icon={UserPlus}
              />
              <KpiCard
                label="Tempo médio"
                value={`${data.onboarding.avgSessionDuration}s`}
                color="#f59e0b"
                icon={TrendingUp}
                sub={`Bounce: ${data.onboarding.bounceRate}%`}
              />
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
                        <linearGradient id="oUsers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <YAxis fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} tickFormatter={formatNumber} />
                      <Tooltip
                        contentStyle={{
                          background: "white",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(v) => [formatNumber(Number(v)), "Usuários únicos"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="users"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        fill="url(#oUsers)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {/* Tabela com números absolutos do mensal */}
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

          {/* Eventos disparados */}
          {data.events.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3">
                Eventos disparados na página
              </h2>
              <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Evento</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Disparos</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Usuários únicos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.slice(0, 20).map((e) => (
                      <tr key={e.event} className="border-b border-slate-100 hover:bg-slate-50/40">
                        <td className="px-4 py-2 font-mono text-xs">{e.event}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs font-bold">{formatNumber(e.count)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">{formatNumber(e.users)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Devices + Channels lado a lado */}
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
                            <span className="font-bold">{formatNumber(d.users)} <span className="text-slate-400 font-normal">({pct.toFixed(1)}%)</span></span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
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
                Top canais que trazem pra cá
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
                            <span className="font-bold">{formatNumber(c.users)} <span className="text-slate-400 font-normal">({pct.toFixed(1)}%)</span></span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
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

          {/* Purchases / Perfil de assinatura */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-amber-600" />
              Compras no mesmo período (paralelo, não cruzado)
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <KpiCard
                label="Transações"
                value={formatNumber(data.purchases.transactions)}
                color="#f59e0b"
                icon={CreditCard}
              />
              <KpiCard
                label="Receita total"
                value={formatBRL(data.purchases.totalRevenue || data.purchases.purchaseRevenue)}
                color="#10b981"
                icon={TrendingUp}
              />
              <KpiCard
                label="Ticket médio"
                value={
                  data.purchases.transactions > 0
                    ? formatBRL(
                        (data.purchases.totalRevenue || data.purchases.purchaseRevenue) /
                          data.purchases.transactions
                      )
                    : "—"
                }
                color="#7c5cff"
                icon={Activity}
              />
            </div>

            <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[color:var(--border)] bg-slate-50/40">
                <h3 className="text-sm font-semibold">Perfil de assinatura — breakdown por plano</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Vem do array <code className="bg-slate-100 px-1 rounded">items[]</code> do evento purchase do dataLayer
                </p>
              </div>
              {data.plans.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/30 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Plano (item_name)</th>
                        <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Categoria</th>
                        <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Quantidade</th>
                        <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Receita</th>
                        <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">% receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalRev = data.plans.reduce((s, p) => s + p.revenue, 0);
                        return data.plans.map((p, i) => {
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
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-xs text-slate-500">
                  Nenhuma compra com array <code className="bg-slate-100 px-1 rounded">items</code> populado neste período.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
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
