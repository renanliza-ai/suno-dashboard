"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import {
  ShoppingCart,
  CreditCard,
  CheckCircle2,
  Eye,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  PackageOpen,
  ArrowDownRight,
  Loader2,
  Info,
} from "lucide-react";
import { useGA4, useGA4CheckoutFunnel } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

const STEP_ICONS: Record<string, typeof ShoppingCart> = {
  view_item: Eye,
  add_to_cart: PackageOpen,
  begin_checkout: ShoppingCart,
  add_payment_info: CreditCard,
  purchase: CheckCircle2,
};

const STEP_COLORS = ["#7c5cff", "#8b6dff", "#9a7eff", "#a98fff", "#10b981"];

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

/**
 * Monitor de Checkout — funil 5-step + análise de abandono + CTR de campanhas.
 *
 * Funcionalidades:
 *  1. Funil visual (view_item → add_to_cart → begin_checkout →
 *     add_payment_info → purchase) com drop % entre etapas
 *  2. Card de "Receita perdida por abandono" com valor estimado
 *  3. Tabela ranqueada de campanhas com:
 *     - CTR-to-checkout: begin_checkout / sessions
 *     - Taxa de abandono: (begin_checkout - purchase) / begin_checkout
 *     - Conversion rate, ticket médio, receita
 *  4. Diagnóstico automático: identifica em qual etapa está o maior drop
 *     e aponta provável causa (UX, gateway, validação)
 */
export function CheckoutMonitor() {
  const { selected, useRealData } = useGA4();
  const { data, loading, error } = useGA4CheckoutFunnel();
  const [campSortKey, setCampSortKey] = useState<keyof NonNullable<typeof data>["byCampaign"][number]>("purchases");

  if (!useRealData) {
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <ShoppingCart size={16} className="text-[#7c5cff]" />
          Monitor de Checkout
        </h3>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          Selecione uma propriedade GA4 no header pra acompanhar o funil de checkout.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-12 mb-6 flex flex-col items-center gap-3 text-[color:var(--muted-foreground)]">
        <Loader2 size={32} className="animate-spin text-[#7c5cff]" />
        <span className="text-sm">Carregando funil de checkout do GA4...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 text-red-700 text-sm">
        <strong>Erro ao carregar checkout funnel:</strong> {error || "sem dados"}
      </div>
    );
  }

  const { steps, summary, byCampaign } = data;

  // Diagnóstico de receita — explica de qual métrica GA4 puxamos o número.
  // Se cair em eventValue, é sinal de que o dataLayer não envia currency
  // junto com value no evento purchase (problema comum de implementação).
  const revSource = summary.revenue_source;
  const revDiag = summary.revenue_diagnostics;
  const revenueWarning =
    revSource === "eventValue"
      ? {
          severity: "warning" as const,
          title: "Receita vindo de eventValue (fallback) — recomenda corrigir o dataLayer",
          body: `purchaseRevenue=R$${revDiag?.purchaseRevenue.toFixed(2) || 0}, mas eventValue=R$${revDiag?.eventValueFromPurchase.toFixed(2) || 0}. Provável causa: o evento purchase está disparando 'value' sem 'currency'. O painel GA4 nativo faz fallback automático e mostra o valor; nós replicamos esse comportamento. Para corrigir: adicione currency: 'BRL' no payload do evento purchase no GTM/dataLayer.`,
        }
      : revSource === "none" && (steps.find((s) => s.stage === "purchase")?.count ?? 0) > 0
        ? {
            severity: "error" as const,
            title: "Receita zerada apesar de haver compras — verifique tracking",
            body: `${steps.find((s) => s.stage === "purchase")?.count} compras detectadas, mas nenhuma das 3 métricas de receita (purchaseRevenue, totalRevenue, eventValue) retornou valor. O evento purchase precisa enviar pelo menos 'value' (e idealmente 'currency').`,
          }
        : null;

  // Identifica a etapa com maior drop pra diagnóstico automático
  const stepsWithDrop = steps.filter((s, i) => i > 0 && s.dropAbsoluteFromPrev > 0);
  const biggestDropStep = stepsWithDrop.reduce<typeof stepsWithDrop[number] | null>(
    (max, s) => (max && max.dropAbsoluteFromPrev > s.dropAbsoluteFromPrev ? max : s),
    null
  );

  const diagnosisText = (() => {
    if (!biggestDropStep) return null;
    const stage = biggestDropStep.stage;
    const dropPct = biggestDropStep.dropFromPrev;
    const dropAbs = biggestDropStep.dropAbsoluteFromPrev;
    if (stage === "add_to_cart") {
      return `Maior drop no add_to_cart (${dropPct}%, ${formatNumber(dropAbs)} pessoas). Pode ser problema de página de produto, preço pouco visível ou CTA fraco.`;
    }
    if (stage === "begin_checkout") {
      return `Maior drop em begin_checkout (${dropPct}%, ${formatNumber(dropAbs)} pessoas). Frete, cupom mal aplicado ou complexidade do carrinho.`;
    }
    if (stage === "add_payment_info") {
      return `Maior drop em add_payment_info (${dropPct}%, ${formatNumber(dropAbs)} pessoas). Validação de cartão, integração com gateway, ou erro de UX no formulário.`;
    }
    if (stage === "purchase") {
      return `Maior drop entre add_payment_info e purchase (${dropPct}%, ${formatNumber(dropAbs)} pessoas). Cartão recusado, antifraude ou falha do processador.`;
    }
    return `Maior drop em ${stage} (${dropPct}%, ${formatNumber(dropAbs)} pessoas).`;
  })();

  // Sort campanhas
  const sortedCamps = [...byCampaign].sort((a, b) => {
    const av = a[campSortKey];
    const bv = b[campSortKey];
    if (typeof av === "number" && typeof bv === "number") return bv - av;
    return String(bv).localeCompare(String(av));
  });

  return (
    <div className="space-y-6 mb-6">
      {/* ============================================================
          BLOCO 1 — Funil visual + summary
         ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-[color:var(--border)] p-6"
      >
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart size={16} className="text-[#7c5cff]" />
              Monitor de Checkout — funil de 5 etapas
            </h3>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
              {selected?.displayName} · view_item → add_to_cart → begin_checkout → add_payment_info → purchase
            </p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
            ✓ dado real GA4
          </span>
        </div>

        {/* KPIs do funil */}
        <div className="grid grid-cols-4 gap-3 mt-5 mb-5">
          <KpiCard
            label="Receita total"
            value={formatBRL(summary.total_revenue)}
            color="#10b981"
            icon={CheckCircle2}
          />
          <KpiCard
            label="Ticket médio"
            value={formatBRL(summary.avg_ticket)}
            color="#7c5cff"
            icon={CreditCard}
          />
          <KpiCard
            label="Abandono"
            value={`${summary.abandonment_rate}%`}
            sub={`${formatNumber(summary.abandoned_count)} pessoas`}
            color={summary.abandonment_rate > 70 ? "#dc2626" : summary.abandonment_rate > 50 ? "#f59e0b" : "#10b981"}
            icon={AlertTriangle}
          />
          <KpiCard
            label="Receita perdida"
            value={formatBRL(summary.abandoned_revenue_lost)}
            sub="estimado (qtd × ticket médio)"
            color="#dc2626"
            icon={TrendingDown}
          />
        </div>

        {/* Funil horizontal — barras decrescentes */}
        <div className="space-y-2.5">
          {steps.map((step, i) => {
            const Icon = STEP_ICONS[step.stage] || ShoppingCart;
            const color = STEP_COLORS[i] || "#7c5cff";
            const dropPct = step.dropFromPrev;
            const isCritical = i > 0 && dropPct > 60;
            return (
              <div key={step.stage}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: `${color}18` }}
                    >
                      <Icon size={14} style={{ color }} />
                    </span>
                    <span className="text-sm font-medium">{step.label}</span>
                    <span className="text-[10px] font-mono text-[color:var(--muted-foreground)] ml-1">
                      {step.matchedAlias || step.stage}
                    </span>
                    {step.count === 0 && (
                      <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        evento ausente
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-base font-bold tabular-nums">{formatNumber(step.count)}</span>
                    <span className="text-[10px] text-[color:var(--muted-foreground)] tabular-nums">
                      {step.pctOfTop}% do topo
                    </span>
                    {i > 0 && step.dropAbsoluteFromPrev > 0 && (
                      <span
                        className={`text-[10px] font-semibold tabular-nums flex items-center gap-0.5 ${
                          isCritical ? "text-red-600" : dropPct > 30 ? "text-amber-600" : "text-slate-500"
                        }`}
                      >
                        <ArrowDownRight size={10} />
                        −{dropPct}% (−{formatNumber(step.dropAbsoluteFromPrev)})
                      </span>
                    )}
                  </div>
                </div>
                <div className="relative h-7 bg-slate-50 rounded-md overflow-hidden border border-slate-100">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${step.pctOfTop}%` }}
                    transition={{ delay: i * 0.1, duration: 0.7, ease: "easeOut" }}
                    className="h-full rounded-md flex items-center px-2"
                    style={{
                      background: `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)`,
                    }}
                  >
                    <span className="text-[10px] font-bold text-white tabular-nums drop-shadow whitespace-nowrap">
                      {formatNumber(step.count)}
                    </span>
                  </motion.div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Diagnóstico de receita — quando fallback foi usado ou tudo zero */}
        {revenueWarning && (
          <div
            className={`mt-5 p-3 rounded-lg border text-xs flex items-start gap-2 ${
              revenueWarning.severity === "error"
                ? "bg-red-50 border-red-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <AlertTriangle
              size={14}
              className={`mt-0.5 shrink-0 ${
                revenueWarning.severity === "error" ? "text-red-700" : "text-amber-700"
              }`}
            />
            <div>
              <strong
                className={
                  revenueWarning.severity === "error" ? "text-red-900" : "text-amber-900"
                }
              >
                {revenueWarning.title}
              </strong>
              <p
                className={`mt-1 ${
                  revenueWarning.severity === "error" ? "text-red-800" : "text-amber-800"
                }`}
              >
                {revenueWarning.body}
              </p>
            </div>
          </div>
        )}

        {/* Diagnóstico auto do funil (drop) */}
        {diagnosisText && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-700 mt-0.5 shrink-0" />
            <div>
              <strong className="text-amber-900">Diagnóstico do funil:</strong>
              <span className="text-amber-900 ml-1">{diagnosisText}</span>
            </div>
          </div>
        )}
      </motion.div>

      {/* ============================================================
          BLOCO 2 — Tabela de campanhas com CTR + abandono
         ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-[color:var(--border)] flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp size={16} className="text-[#7c5cff]" />
              CTR de campanhas → checkout & taxa de abandono
            </h3>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
              Top {byCampaign.length} campanhas com pelo menos 50 sessões. Ordenado por{" "}
              <strong>{campSortKey}</strong>.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <Info size={11} className="text-slate-400" />
            <span className="text-slate-500">CTR-to-checkout = begin_checkout ÷ sessions</span>
          </div>
        </div>

        {byCampaign.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[color:var(--muted-foreground)]">
            Nenhuma campanha com volume suficiente (≥ 50 sessões) no período.
            <br />
            <span className="text-xs">Pode ser que a propriedade não esteja com tracking de UTM ativo, ou o período seja curto demais.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-[color:var(--border)]">
                <tr>
                  <Th label="Campanha" sortKey="campaign" current={campSortKey} setCurrent={setCampSortKey} align="left" />
                  <Th label="Sessões" sortKey="sessions" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="Begin checkout" sortKey="beginCheckout" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="CTR → checkout" sortKey="ctr_to_checkout" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="Compras" sortKey="purchases" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="Conv. rate" sortKey="conversion_rate" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="Abandono" sortKey="abandonment_rate" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="Receita" sortKey="revenue" current={campSortKey} setCurrent={setCampSortKey} />
                  <Th label="Ticket" sortKey="avg_ticket" current={campSortKey} setCurrent={setCampSortKey} />
                </tr>
              </thead>
              <tbody>
                {sortedCamps.map((c, i) => {
                  const abandonColor =
                    c.abandonment_rate > 80
                      ? "text-red-600"
                      : c.abandonment_rate > 60
                        ? "text-amber-600"
                        : "text-slate-700";
                  const convColor =
                    c.conversion_rate > 5
                      ? "text-emerald-600"
                      : c.conversion_rate > 1
                        ? "text-slate-700"
                        : "text-slate-400";
                  return (
                    <tr key={`${c.campaign}|${i}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 font-mono text-[11px] max-w-[220px] truncate" title={c.campaign}>
                        {c.campaign === "(not set)" ? <span className="text-slate-400 italic">(sem UTM)</span> : c.campaign}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{formatNumber(c.sessions)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{formatNumber(c.beginCheckout)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold text-[#7c5cff]">
                        {c.ctr_to_checkout}%
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold">
                        {formatNumber(c.purchases)}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-semibold ${convColor}`}>
                        {c.conversion_rate}%
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-semibold ${abandonColor}`}>
                        {c.abandonment_rate}%
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        {c.revenue > 0 ? formatBRL(c.revenue) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-500">
                        {c.avg_ticket > 0 ? formatBRL(c.avg_ticket) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
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
    <div className="p-4 rounded-xl border border-[color:var(--border)] bg-slate-50/30">
      <div className="flex items-center justify-between mb-1.5">
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

function Th<T extends string>({
  label,
  sortKey,
  current,
  setCurrent,
  align = "right",
}: {
  label: string;
  sortKey: T;
  current: T;
  setCurrent: (k: T) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th className={`px-4 py-3 text-${align}`}>
      <button
        onClick={() => setCurrent(sortKey)}
        className={`text-[11px] font-semibold uppercase tracking-wider hover:text-[#7c5cff] ${
          active ? "text-[#7c5cff]" : "text-slate-500"
        } ${align === "right" ? "ml-auto block" : ""}`}
      >
        {label}
        {active && " ↓"}
      </button>
    </th>
  );
}
