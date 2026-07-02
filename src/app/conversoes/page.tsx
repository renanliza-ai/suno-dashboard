"use client";

import { motion } from "framer-motion";
import {
  Target, DollarSign,
  ShieldCheck, AlertTriangle, ShoppingCart, Eye, UserPlus, CreditCard, Truck,
  CheckCircle2, XCircle,
} from "lucide-react";
import { useState } from "react";
import { abandonedCheckoutRule } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { Header } from "@/components/header";
import { Dialog } from "@/components/dialog";
import { useGA4, useGA4Conversions, useGA4CheckoutFunnel } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock, DataErrorCard } from "@/components/data-status";
import {
  AttributionIllustration,
  TopAssistedCampaigns,
} from "@/components/attribution-illustration";
import { CheckoutMonitor } from "@/components/checkout-monitor";

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

// Catalogo dos eventos-meta do funil Suno: SO estrutura (nome + evento GA4).
// Counts/valores vem SEMPRE do GA4 real. Politica zero mock (30/06).
type ConversionGoalView = {
  name: string;
  event: string;
  count: number;
  value: number;
  avgValue: number;
};
const GOAL_CATALOG: { name: string; event: string }[] = [
  { name: "Visualizou Item (LP)", event: "view_item" },
  { name: "Lead", event: "generate_lead" },
  { name: "Conta Criada", event: "sign_up / lead_create_account" },
  { name: "Início Checkout", event: "begin_checkout" },
  { name: "Dados de Pagamento", event: "add_shipping_info" },
  { name: "Compras (total)", event: "purchase" },
  { name: "Checkout Abandonado", event: "abandoned_checkout" },
];

export default function ConversoesPage() {
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<ConversionGoalView | null>(null);

  // GA4 real data — sem daysOverride para respeitar o calendário do header
  const { useRealData, days, customRange } = useGA4();
  const { data: ga4Conv, meta, error: ga4Error } = useGA4Conversions();
  const { data: checkoutFunnel } = useGA4CheckoutFunnel();
  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `últimos ${days} dias`;
  const isReal = Boolean(useRealData && meta.status === "success" && ga4Conv?.conversions);
  const usingMock = !useRealData;
  const isLoading = useRealData && (meta.status === "loading" || meta.status === "idle");
  const hasError = useRealData && meta.status === "error";

  // ZERO MOCK: sem property conectada, a pagina nao mostra nenhum numero.
  if (usingMock) {
    return (
      <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
        <Header />
        <div className="mt-6 bg-white rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
          <div className="text-sm font-semibold">Sem conexão com o GA4</div>
          <div className="text-xs text-[color:var(--muted-foreground)] mt-1">
            Selecione uma property no header para ver as conversões reais. Este painel não
            exibe dados de exemplo.
          </div>
        </div>
      </main>
    );
  }

  // Goals: catalogo estrutural + valores 100% do GA4 real. Evento sem match no
  // periodo = 0 (verdade), nunca numero de exemplo.
  const goals: ConversionGoalView[] = GOAL_CATALOG.map((g) => {
    const match = isReal
      ? ga4Conv!.conversions!.find((c) => {
          if (g.event === "sign_up / lead_create_account") {
            return c.event === "sign_up" || c.event === "lead_create_account";
          }
          return c.event === g.event;
        })
      : undefined;
    const count = match?.count ?? 0;
    const value = match?.value ?? 0;
    return {
      ...g,
      count,
      value,
      avgValue: count > 0 && value > 0 ? Math.round(value / count) : 0,
    };
  });

  const purchaseRow = goals.find((g) => g.event === "purchase")!;
  const totalRev = purchaseRow.value;
  const totalConv = purchaseRow.count;
  const leadRow = goals.find((g) => g.event === "generate_lead")!;
  const abandonRow = goals.find((g) => g.event === "abandoned_checkout")!;

  // Derivação REAL da validação da regra abandoned_checkout — antes era 100% mock.
  // Quando temos checkoutFunnel do GA4, recalcula os 4 KPIs do modal e a taxa
  // de abandono em cima dos dados do período selecionado.
  const realBeginCheckout = checkoutFunnel?.steps?.find((s) => s.stage === "begin_checkout")?.count;
  const realPurchase = checkoutFunnel?.steps?.find((s) => s.stage === "purchase")?.count;
  const hasRealValidation = isReal && typeof realBeginCheckout === "number" && typeof realPurchase === "number" && realBeginCheckout > 0;
  const realAbandonedExpected = hasRealValidation ? Math.max(0, realBeginCheckout! - realPurchase!) : null;
  const realAbandonedActual = isReal ? abandonRow.count : null;
  const realMatchRate = hasRealValidation && realAbandonedExpected! > 0 && realAbandonedActual !== null
    ? Math.min(100, Math.round((realAbandonedActual / realAbandonedExpected!) * 100))
    : null;
  const realAbandonRate = hasRealValidation && realBeginCheckout! > 0
    ? Number(((realAbandonedExpected! / realBeginCheckout!) * 100).toFixed(1))
    : null;
  // Validação ao vivo — usa horário atual do servidor (ou agora se client)
  const liveValidationTs = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const validationView = hasRealValidation
    ? {
        timestamp: liveValidationTs,
        beginCheckoutCount: realBeginCheckout!,
        purchaseInWindow: realPurchase!,
        abandonedExpected: realAbandonedExpected!,
        abandonedActual: realAbandonedActual ?? realAbandonedExpected!,
        matchRate: realMatchRate ?? 0,
        abandonRate: realAbandonRate ?? 0,
        notes:
          realAbandonRate !== null && realAbandonRate >= 65 && realAbandonRate <= 75
            ? `Regra valida - taxa de abandono ${realAbandonRate}%, dentro do benchmark do setor (65-75%).`
            : realAbandonRate !== null && realAbandonRate > 75
              ? `Taxa de abandono elevada (${realAbandonRate}%, benchmark do setor 65-75%) - vale investigar etapas de checkout.`
              : realAbandonRate !== null
                ? `Taxa de abandono saudável (${realAbandonRate}%, abaixo do benchmark do setor 65-75%).`
                : "Validação automática ao vivo.",
        isReal: true,
      }
    : null; // ZERO MOCK: sem dados reais de validacao, o modal mostra indisponivel

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
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

      {/* Ilustração animada do modelo de atribuição */}
      <div className="mb-6">
        <AttributionIllustration />
      </div>

      {/* Top campanhas assistidas — só aparece no modo assistida */}
      <div className="mb-6">
        <TopAssistedCampaigns />
      </div>

      {/* ZERO MOCK (30/06): AssistedTimeToPurchase removido - tempo ate compra
          por canal era 100% derivado de mock; volta quando houver BigQuery. */}

      {/* ============================================================
          MONITOR DE CHECKOUT — adicionado a pedido pra análise de
          CTR de campanhas + abandono de carrinho. Mostra:
          1. Funil 5-step (view_item → add_to_cart → begin_checkout
             → add_payment_info → purchase)
          2. KPIs de receita perdida e taxa de abandono
          3. Tabela de campanhas com CTR-to-checkout, taxa de abandono,
             conversion rate, ticket médio, receita
          4. Diagnóstico automático da etapa com maior drop
         ============================================================ */}
      <CheckoutMonitor />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
          // ZERO MOCK: deltas "+2.8%" etc eram hardcoded - removidos. Se quisermos
          // delta real aqui, plugar comparacao vs periodo anterior do servidor.
          { label: "Compras (total)", value: formatNumber(totalConv), icon: CreditCard },
          { label: "Receita Gerada", value: `R$ ${formatNumber(totalRev)}`, icon: DollarSign },
          { label: "Leads", value: formatNumber(leadRow.count), icon: UserPlus },
          { label: "Checkout Abandonado", value: formatNumber(abandonRow.count), icon: XCircle },
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
              <div className="text-[11px] text-[color:var(--muted-foreground)] mt-2">{periodLabel}</div>
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
                <div className="col-span-2 text-right">
                  <div className="text-sm font-bold tabular-nums">{formatNumber(g.count)}</div>
                </div>
                <div className="col-span-3 text-right">
                  <div className="text-sm font-bold tabular-nums">
                    {g.value > 0 ? `R$ ${formatNumber(g.value)}` : "—"}
                  </div>
                  {g.avgValue > 0 && (
                    <div className="text-[10px] text-[color:var(--muted-foreground)]">avg R$ {g.avgValue}</div>
                  )}
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
            <h3 className="text-base font-bold text-amber-900">Regra abandoned_checkout</h3>
            {realMatchRate !== null && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <ShieldCheck size={10} /> {realMatchRate}% match
              </span>
            )}
          </div>
          <p className="text-sm text-amber-800 mt-1">
            {formatNumber(abandonRow.count)} abandonos detectados
            {realAbandonRate !== null
              ? ` · taxa de abandono ${realAbandonRate}%`
              : " · taxa indisponível no período"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase font-semibold text-amber-700">Ver regra completa</p>
          <p className="text-xs font-mono text-amber-900">click →</p>
        </div>
      </button>

      {/* ZERO MOCK (30/06): as secoes "Eventos de conversao (trend)", "Tempo ate
          conversao" e "Top caminhos ate conversao" foram REMOVIDAS - eram 100%
          fabricadas (Math.random / valores fixos) e nao existe fonte real
          equivalente no GA4 Data API hoje. Time-lag e caminhos reais exigem
          BigQuery (Conversion Paths / Time Lag) - quando plugarmos, as secoes
          voltam com dado verdadeiro. */}

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Contagem no período</p>
                <p className="text-lg font-bold tabular-nums">{formatNumber(selectedGoal.count)}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Evento GA4</p>
                <p className="text-sm font-mono font-bold mt-1 truncate">{selectedGoal.event}</p>
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
                Disparo via GTM da property selecionada · coletado no GA4 como key event · valida-se contra o dataLayer da página.
              </p>
            </div>
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

          {validationView ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <ShieldCheck size={16} className="text-emerald-700" />
                <p className="text-sm font-bold text-emerald-900">
                  Validação ao vivo: {validationView.timestamp}
                </p>
                <span className="text-[10px] font-mono text-emerald-700 bg-white/60 px-1.5 py-0.5 rounded">
                  {periodLabel}
                </span>
                <span className="ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                  {validationView.matchRate}% match
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-[10px] uppercase text-emerald-700 font-semibold">begin_checkout</p>
                  <p className="font-bold tabular-nums">
                    {formatNumber(validationView.beginCheckoutCount)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-emerald-700 font-semibold">purchases (24h)</p>
                  <p className="font-bold tabular-nums">
                    {formatNumber(validationView.purchaseInWindow)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-emerald-700 font-semibold">Abandonos esperados</p>
                  <p className="font-bold tabular-nums">
                    {formatNumber(validationView.abandonedExpected)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-emerald-700 font-semibold">Capturados</p>
                  <p className="font-bold tabular-nums">
                    {formatNumber(validationView.abandonedActual)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-emerald-800 mt-3">{validationView.notes}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-xs text-[color:var(--muted-foreground)]">
              Validação indisponível: sem dados suficientes do funil de checkout nesta
              property/período. Nenhum número de exemplo é exibido.
            </div>
          )}
        </div>
      </Dialog>
    </main>
  );
}
