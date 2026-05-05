"use client";

import { motion } from "framer-motion";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Target, TrendingUp, TrendingDown, Clock, Route, DollarSign, Percent, Zap,
  ShieldCheck, AlertTriangle, ShoppingCart, Eye, UserPlus, CreditCard, Truck,
  CheckCircle2, XCircle, RefreshCw,
} from "lucide-react";
import { useState } from "react";
import {
  conversionGoals,
  conversionPaths,
  timeToConvert,
  conversionsByEventTrend,
  abandonedCheckoutRule,
} from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { Header } from "@/components/header";
import { Dialog } from "@/components/dialog";
import { useGA4, useGA4Conversions } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock, DataErrorCard } from "@/components/data-status";
import {
  AttributionIllustration,
  TopAssistedCampaigns,
} from "@/components/attribution-illustration";
import { AttributionToggle } from "@/components/attribution-toggle";
import { AssistedTimeToPurchase } from "@/components/assisted-time-to-purchase";

const eventIcon: Record<string, typeof Target> = {
  view_item: Eye,
  generate_lead: UserPlus,
  "sign_up / lead_create_account": UserPlus,
  begin_checkout: ShoppingCart,
  add_payment_info: CreditCard,
  add_shipping_info: Truck,
  purchase: CreditCard,
  abandoned_checkout: XCircle,
};

export default function ConversoesPage() {
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<(typeof conversionGoals)[number] | null>(null);

  // GA4 real data — sem daysOverride para respeitar o calendário do header
  const { useRealData, days, customRange } = useGA4();
  const { data: ga4Conv, meta, error: ga4Error } = useGA4Conversions();
  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `últimos ${days} dias`;
  const isReal = Boolean(useRealData && meta.status === "success" && ga4Conv?.conversions);
  const usingMock = !useRealData;
  const isLoading = useRealData && meta.status === "loading";
  const hasError = useRealData && meta.status === "error";

  // Merge: quando temos dados reais, substituímos count/value do mock
  const goals = isReal
    ? conversionGoals.map((g) => {
        const match = ga4Conv!.conversions!.find((c) => {
          if (g.event === "sign_up / lead_create_account") {
            return c.event === "sign_up" || c.event === "lead_create_account";
          }
          return c.event === g.event;
        });
        return match
          ? { ...g, count: match.count, value: match.value || g.value }
          : g;
      })
    : conversionGoals;

  const purchaseRow = goals.find((g) => g.event === "purchase")!;
  const totalRev = purchaseRow.value;
  const totalConv = purchaseRow.count;
  const leadRow = goals.find((g) => g.event === "generate_lead")!;
  const abandonRow = goals.find((g) => g.event === "abandoned_checkout")!;

  return (
    <main className="ml-20 p-8 max-w-[1600px]">
      <Header />

      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Target size={20} className="text-white" />
          </span>
          Conversões
          <DataStatus meta={meta} usingMock={usingMock} />
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Funil completo Suno: view_item → lead → conta → checkout → pagamento → compra · abandono monitorado
        </p>
      </motion.div>

      {hasError && (
        <div className="mb-4">
          <DataErrorCard meta={meta} error={ga4Error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* Toggle + ilustração animada do modelo de atribuição */}
      <div className="mb-4">
        <AttributionToggle />
      </div>
      <div className="mb-6">
        <AttributionIllustration />
      </div>

      {/* Top campanhas assistidas — só aparece no modo assistida */}
      <div className="mb-6">
        <TopAssistedCampaigns />
      </div>

      {/* Tempo até compra por canal — só aparece no modo assistida */}
      <AssistedTimeToPurchase />

      <div className="grid grid-cols-4 gap-4 mb-6">
        {isLoading || hasError ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <SkeletonBlock height={11} className="w-28 mb-3" />
              <SkeletonBlock height={28} className="w-32 mb-2" />
              <SkeletonBlock height={10} className="w-20" />
            </div>
          ))
        ) : (
        [
          { label: "Compras (total)", value: formatNumber(totalConv), delta: "+2.8%", positive: true, icon: CreditCard },
          { label: "Receita Gerada", value: `R$ ${formatNumber(totalRev)}`, delta: "+8.2%", positive: true, icon: DollarSign },
          { label: "Leads", value: formatNumber(leadRow.count), delta: "+8.4%", positive: true, icon: UserPlus },
          { label: "Checkout Abandonado", value: formatNumber(abandonRow.count), delta: "-6.2%", positive: true, icon: XCircle },
        ].map((k, i) => {
          const Icon = k.icon;
          return (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl border border-[color:var(--border)] p-5"
            >
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                <Icon size={11} /> {k.label}
              </div>
              <div className="text-3xl font-bold mt-2 tabular-nums">{k.value}</div>
              <div className={`text-xs font-semibold mt-2 flex items-center gap-1 ${k.positive ? "text-emerald-600" : "text-red-600"}`}>
                {k.positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {k.delta} vs mês anterior
              </div>
            </motion.div>
          );
        })
        )}
      </div>

      {/* Metas de conversão */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold">Metas de Conversão (eventos Suno)</h3>
            <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
              Clique para ver detalhes e amostragem de eventos no GA4
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {goals.map((g, i) => {
            const Icon = eventIcon[g.event] || Target;
            const maxCount = Math.max(...goals.map((x) => x.count));
            const pct = (g.count / maxCount) * 100;
            const isAbandon = g.event === "abandoned_checkout";
            return (
              <motion.button
                key={g.event}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => (isAbandon ? setAbandonOpen(true) : setSelectedGoal(g))}
                className={`w-full grid grid-cols-12 gap-3 items-center py-3 px-3 rounded-xl border border-transparent hover:border-[#7c5cff]/30 hover:bg-[#ede9fe]/40 transition text-left ${
                  isAbandon ? "bg-amber-50/40" : ""
                }`}
              >
                <div className="col-span-4 flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isAbandon ? "bg-amber-100 text-amber-700" : "bg-[#ede9fe] text-[#7c5cff]"
                    }`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{g.name}</div>
                    <div className="text-[11px] font-mono text-[color:var(--muted-foreground)] truncate">
                      {g.event}
                    </div>
                  </div>
                </div>
                <div className="col-span-3">
                  <div className="h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                      className={`h-full rounded-full ${
                        isAbandon ? "bg-gradient-to-r from-amber-400 to-orange-500" : "bg-gradient-to-r from-[#7c5cff] to-[#b297ff]"
                      }`}
                    />
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="text-sm font-bold tabular-nums">{formatNumber(g.count)}</div>
                </div>
                <div className="col-span-2 text-right">
                  <div className="text-sm font-bold tabular-nums">
                    {g.value > 0 ? `R$ ${formatNumber(g.value)}` : "—"}
                  </div>
                  {g.avgValue > 0 && (
                    <div className="text-[10px] text-[color:var(--muted-foreground)]">avg R$ {g.avgValue}</div>
                  )}
                </div>
                <div className="col-span-1 text-right">
                  <div className="text-xs text-[color:var(--muted-foreground)]">{g.rate}%</div>
                </div>
                <div className="col-span-1 text-right">
                  <span
                    className={`text-xs font-semibold flex items-center gap-0.5 justify-end ${
                      isAbandon
                        ? g.delta <= 0
                          ? "text-emerald-600"
                          : "text-red-600"
                        : g.delta >= 0
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    {g.delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {g.delta >= 0 ? "+" : ""}
                    {g.delta}%
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Card dedicado ao abandoned_checkout */}
      <button
        onClick={() => setAbandonOpen(true)}
        className="w-full text-left mb-6 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-5 flex items-center gap-4 hover:shadow-lg transition"
      >
        <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <AlertTriangle size={22} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-amber-900">Regra abandoned_checkout — validada</h3>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <ShieldCheck size={10} /> 100% match
            </span>
          </div>
          <p className="text-sm text-amber-800 mt-1">
            {formatNumber(abandonRow.count)} abandonos detectados · taxa de abandono {abandonedCheckoutRule.lastValidation.matchRate > 0 ? "68.2%" : "—"} · {formatNumber(abandonedCheckoutRule.recovery.recoveredPurchases)} recuperados por email ({abandonedCheckoutRule.recovery.recoveryRate}%)
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase font-semibold text-amber-700">Ver regra completa</p>
          <p className="text-xs font-mono text-amber-900">click →</p>
        </div>
      </button>

      {/* Tendência por evento */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Zap size={14} className="text-[#7c5cff]" />
            Eventos de conversão — {periodLabel}
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={conversionsByEventTrend}>
              <defs>
                <linearGradient id="gradPurch" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c5cff" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#7c5cff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradLead" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradAb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#6b6b80" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b6b80" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Area type="monotone" dataKey="generate_lead" stroke="#10b981" fill="url(#gradLead)" strokeWidth={2} name="Leads" />
              <Area type="monotone" dataKey="abandoned_checkout" stroke="#f59e0b" fill="url(#gradAb)" strokeWidth={2} name="Abandonos" />
              <Area type="monotone" dataKey="purchase" stroke="#7c5cff" fill="url(#gradPurch)" strokeWidth={2.5} name="Compras" />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-xs flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Leads</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Abandonos</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#7c5cff]" /> Compras</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Clock size={14} className="text-[#7c5cff]" />
            Tempo até conversão
          </h3>
          <div className="space-y-3">
            {timeToConvert.map((t, i) => (
              <motion.div
                key={t.bucket}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span className="font-medium">{t.bucket}</span>
                  <span className="font-bold tabular-nums">{t.count}</span>
                </div>
                <div className="h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${t.pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.05 }}
                    className="h-full bg-gradient-to-r from-[#7c5cff] to-[#b297ff] rounded-full"
                  />
                </div>
                <div className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5">{t.pct}%</div>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[color:var(--border)] text-xs">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">Mediana</div>
            <div className="text-xl font-bold text-[#7c5cff] mt-1">1.2 dias</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Route size={14} className="text-[#7c5cff]" />
          Top caminhos até conversão
        </h3>
        <div className="space-y-2">
          {conversionPaths.map((p, i) => (
            <motion.div
              key={p.path}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 p-3 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 transition"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7c5cff] to-[#b297ff] text-white flex items-center justify-center text-xs font-bold shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono truncate">{p.path}</div>
                <div className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5">Duração média: {p.days} dia(s)</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold">{formatNumber(p.count)}</div>
                <div className="text-[10px] text-emerald-600 font-semibold">R$ {formatNumber(p.value)}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Dialog: detalhes do evento */}
      <Dialog
        open={!!selectedGoal}
        onClose={() => setSelectedGoal(null)}
        title={selectedGoal?.name}
        subtitle={selectedGoal?.event}
        maxWidth="max-w-xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-[#ede9fe] text-[#7c5cff] flex items-center justify-center">
            <Target size={18} />
          </div>
        }
      >
        {selectedGoal && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Contagem</p>
                <p className="text-lg font-bold tabular-nums">{formatNumber(selectedGoal.count)}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Taxa</p>
                <p className="text-lg font-bold tabular-nums">{selectedGoal.rate}%</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">vs mês ant.</p>
                <p className={`text-lg font-bold tabular-nums ${selectedGoal.delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {selectedGoal.delta >= 0 ? "+" : ""}{selectedGoal.delta}%
                </p>
              </div>
            </div>
            {selectedGoal.value > 0 && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-emerald-900">Receita atribuída</span>
                <span className="text-lg font-bold text-emerald-900">R$ {formatNumber(selectedGoal.value)}</span>
              </div>
            )}
            <div className="rounded-xl bg-[color:var(--muted)] p-3 text-xs">
              <p className="font-semibold mb-1">Onde este evento é capturado</p>
              <p className="text-[color:var(--muted-foreground)]">
                Disparo via GTM container <code className="bg-white px-1 rounded">GTM-XSN8K3L</code> · coletado no GA4 como conversion event · valida-se contra o dataLayer da página.
              </p>
            </div>
            <button className="w-full px-4 py-2 rounded-xl bg-[#7c5cff] text-white text-sm font-medium">
              Abrir DebugView no GA4
            </button>
          </div>
        )}
      </Dialog>

      {/* Dialog: regra abandoned_checkout */}
      <Dialog
        open={abandonOpen}
        onClose={() => setAbandonOpen(false)}
        title="Regra: abandoned_checkout"
        subtitle="Custom event — validado automaticamente"
        maxWidth="max-w-2xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <AlertTriangle size={18} />
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-xl bg-[color:var(--muted)] p-4">
            <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)] mb-2">Trigger (GTM)</p>
            <code className="text-xs font-mono bg-white px-2 py-1.5 rounded block break-all">
              {abandonedCheckoutRule.trigger}
            </code>
            <p className="text-[11px] text-[color:var(--muted-foreground)] mt-2">
              Janela: <strong>{abandonedCheckoutRule.window}</strong>
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Exclusões aplicadas</p>
            <ul className="space-y-1.5">
              {abandonedCheckoutRule.exclusions.map((e, i) => (
                <li key={i} className="text-xs flex items-start gap-2">
                  <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                  {e}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-emerald-700" />
              <p className="text-sm font-bold text-emerald-900">
                Última validação: {abandonedCheckoutRule.lastValidation.timestamp}
              </p>
              <span className="ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                {abandonedCheckoutRule.lastValidation.matchRate}% match
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <p className="text-[10px] uppercase text-emerald-700 font-semibold">begin_checkout</p>
                <p className="font-bold tabular-nums">
                  {formatNumber(abandonedCheckoutRule.lastValidation.beginCheckoutCount)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-emerald-700 font-semibold">purchases (24h)</p>
                <p className="font-bold tabular-nums">
                  {formatNumber(abandonedCheckoutRule.lastValidation.purchaseInWindow)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-emerald-700 font-semibold">Abandonos esperados</p>
                <p className="font-bold tabular-nums">
                  {formatNumber(abandonedCheckoutRule.lastValidation.abandonedExpected)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-emerald-700 font-semibold">Capturados</p>
                <p className="font-bold tabular-nums">
                  {formatNumber(abandonedCheckoutRule.lastValidation.abandonedActual)}
                </p>
              </div>
            </div>
            <p className="text-xs text-emerald-800 mt-3">
              {abandonedCheckoutRule.lastValidation.notes}
            </p>
          </div>

          <div className="rounded-xl border border-[color:var(--border)] p-4">
            <p className="text-sm font-semibold mb-3 flex items-center gap-2">
              <RefreshCw size={14} className="text-[#7c5cff]" /> Recuperação por e-mail
            </p>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">Abertura</p>
                <p className="font-bold">{abandonedCheckoutRule.recovery.emailRecoveryOpen}%</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">Clique</p>
                <p className="font-bold">{abandonedCheckoutRule.recovery.emailRecoveryClick}%</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">Recuperadas</p>
                <p className="font-bold">{formatNumber(abandonedCheckoutRule.recovery.recoveredPurchases)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">Taxa recup.</p>
                <p className="font-bold text-emerald-600">{abandonedCheckoutRule.recovery.recoveryRate}%</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="flex-1 px-4 py-2 rounded-xl bg-[#7c5cff] text-white text-sm font-medium">
              Re-validar regra agora
            </button>
            <button className="px-4 py-2 rounded-xl border border-[color:var(--border)] text-sm font-medium">
              Exportar CSV
            </button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
