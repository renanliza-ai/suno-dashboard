"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  Target,
  UserPlus,
  UserCheck,
  Lock,
  Eye,
  ShoppingBag,
  ShoppingCart,
  ClipboardList,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ArrowDownRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * <DualJourneys /> — 2 jornadas paralelas no dashboard.
 *
 * Pedido do Renan: separar a jornada do site (orgânico/direto → cadastro)
 * da jornada das landing pages (campanha → lead → compra). Antes era um
 * funil único que misturava os dois fluxos e dava leitura confusa.
 *
 * Layout: 2 cards lado a lado em desktop, empilhados em mobile. Cada
 * card tem seu storytelling visual:
 *   - SITE: gradiente roxo, foco em criação de conta
 *   - LP: gradiente laranja → verde, foco em compra
 */

type Step = {
  event: string;
  matchedAlias: string | null;
  label: string;
  description: string;
  phase: string;
  count: number;
  pctOfTop: number;
  dropFromPrev: number;
  dropAbsoluteFromPrev: number;
};

type JourneyData = {
  title: string;
  description: string;
  hostFilter: string;
  steps: Step[];
  totalPageViews: number;
  error: string | null;
};

type ApiResponse = {
  propertyId?: string;
  query: {
    propertyId: string;
    propertyName: string;
    days: number;
    startDate: string;
    endDate: string;
  };
  hosts: { siteHost: string; lpHostPattern: string };
  site: JourneyData;
  landingPages: JourneyData;
  error?: string;
};

// Mapa de ícones por evento
const eventIcons: Record<string, typeof Globe> = {
  page_view: Globe,
  pageview: Globe,
  session_start: Globe,
  lead_create_account: UserPlus,
  sign_up: UserCheck,
  user_login: Lock,
  generate_lead: Target,
  view_item: ShoppingBag,
  view_cart: ShoppingCart,
  add_to_cart: ShoppingCart,
  begin_checkout: ClipboardList,
  add_payment_info: CreditCard,
  purchase: CheckCircle2,
};

export function DualJourneys() {
  const { selectedId, selected, days, customRange } = useGA4();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJourneys = async () => {
    if (!selectedId) return;
    const requestPropertyId = selectedId;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        propertyId: selectedId,
        propertyName: selected?.displayName || "",
        days: String(days),
      });
      if (customRange) {
        params.set("startDate", customRange.startDate);
        params.set("endDate", customRange.endDate);
      }
      const r = await fetch(`/api/dashboard/journeys?${params.toString()}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const t = await r.text();
        setError(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return;
      }
      const d = (await r.json()) as ApiResponse;
      if (d.propertyId && d.propertyId !== requestPropertyId) return;
      if (d.error) {
        setError(d.error);
        return;
      }
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJourneys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected, days, customRange?.startDate, customRange?.endDate]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-10 mb-6 flex items-center justify-center gap-2 text-slate-500">
        <Loader2 size={18} className="animate-spin text-[#7c5cff]" />
        <span className="text-sm">Carregando jornadas do GA4...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 text-red-700 text-sm">
        <strong>Erro ao carregar jornadas:</strong> {error || "sem dados"}
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            Jornadas do Usuário
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-[#7c5cff] to-[#b297ff] text-white uppercase tracking-wider">
              2 funis paralelos
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
              ✓ dado real GA4
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Site (orgânico → cadastro) vs Landing Pages (campanha → compra) — mesma janela,
            funis diferentes
          </p>
        </div>
        <button
          onClick={fetchJourneys}
          disabled={loading}
          className="text-[10px] text-slate-500 hover:text-[#7c5cff] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-slate-50"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <JourneyCard
          variant="site"
          title={data.site.title}
          description={data.site.description}
          hostFilter={data.site.hostFilter}
          steps={data.site.steps}
          error={data.site.error}
        />
        <JourneyCard
          variant="lp"
          title={data.landingPages.title}
          description={data.landingPages.description}
          hostFilter={data.landingPages.hostFilter}
          steps={data.landingPages.steps}
          error={data.landingPages.error}
        />
      </div>
    </div>
  );
}

function JourneyCard({
  variant,
  title,
  description,
  hostFilter,
  steps,
  error,
}: {
  variant: "site" | "lp";
  title: string;
  description: string;
  hostFilter: string;
  steps: Step[];
  error: string | null;
}) {
  // Cores diferentes por variante
  const colors = variant === "site"
    ? {
        gradient: "from-violet-500 to-purple-600",
        accent: "#7c5cff",
        bg: "bg-violet-50",
        border: "border-violet-200",
        text: "text-violet-700",
        icon: Globe,
        emoji: "🌐",
      }
    : {
        gradient: "from-emerald-500 to-teal-600",
        accent: "#10b981",
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        text: "text-emerald-700",
        icon: Target,
        emoji: "🎯",
      };

  const HeaderIcon = colors.icon;

  // Métricas resumo
  const startCount = steps[0]?.count || 0;
  const endCount = steps[steps.length - 1]?.count || 0;
  const conversionPct = startCount > 0 ? (endCount / startCount) * 100 : 0;
  const ausentes = steps.filter((s) => s.count === 0).length;

  // Identifica gargalo (maior drop)
  const biggestDrop = useMemo(() => {
    let max = { idx: 0, dropAbs: 0, dropPct: 0 };
    steps.forEach((s, i) => {
      if (i > 0 && s.dropAbsoluteFromPrev > max.dropAbs) {
        max = { idx: i, dropAbs: s.dropAbsoluteFromPrev, dropPct: s.dropFromPrev };
      }
    });
    return steps[max.idx] && max.idx > 0
      ? {
          stage: steps[max.idx],
          prev: steps[max.idx - 1],
          dropAbs: max.dropAbs,
          dropPct: max.dropPct,
        }
      : null;
  }, [steps]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-2xl border-2 ${colors.border} overflow-hidden`}
    >
      {/* Header colorido */}
      <div
        className={`bg-gradient-to-br ${colors.gradient} p-5 text-white relative overflow-hidden`}
      >
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -translate-y-16 translate-x-16" />
        <div className="relative">
          <div className="flex items-start justify-between mb-2">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <HeaderIcon size={22} className="text-white" strokeWidth={2} />
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 backdrop-blur-sm">
              {variant === "site" ? "Cadastro" : "Compra"}
            </span>
          </div>
          <h4 className="text-lg font-bold flex items-center gap-2">
            <span>{colors.emoji}</span>
            {title}
          </h4>
          <p className="text-xs text-white/80 mt-0.5">{description}</p>
          <div className="mt-3 text-[10px] font-mono opacity-80 bg-black/10 px-2 py-1 rounded inline-block">
            host: {hostFilter}
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="p-5">
        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2 mb-3">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <div>
              <strong>Erro ao buscar:</strong> {error}
            </div>
          </div>
        )}

        {/* Stages em cascata visual */}
        <div className="space-y-1.5">
          {steps.map((step, i) => {
            const Icon = eventIcons[step.event] || Globe;
            const isAusente = step.count === 0;
            const isCritical = i > 0 && step.dropFromPrev > 60;
            const isLast = i === steps.length - 1;

            return (
              <motion.div
                key={step.event}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative"
              >
                <div className="flex items-center gap-2">
                  {/* Ícone + linha conectora */}
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isAusente ? "bg-slate-100" : colors.bg
                      } border ${isAusente ? "border-slate-200" : colors.border}`}
                    >
                      <Icon
                        size={16}
                        className={isAusente ? "text-slate-400" : colors.text}
                      />
                    </div>
                    {!isLast && (
                      <div
                        className={`w-px h-3 mt-0.5 ${
                          isAusente ? "bg-slate-200" : "bg-slate-300"
                        }`}
                      />
                    )}
                  </div>

                  {/* Conteúdo da etapa */}
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {step.label}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {step.description}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-base font-bold tabular-nums ${
                            isAusente ? "text-slate-400" : "text-slate-900"
                          }`}
                        >
                          {isAusente ? "—" : formatNumber(step.count)}
                        </div>
                        {i > 0 && step.dropAbsoluteFromPrev > 0 && (
                          <div
                            className={`text-[10px] flex items-center justify-end gap-0.5 ${
                              isCritical ? "text-red-600 font-bold" : "text-slate-500"
                            }`}
                          >
                            <ArrowDownRight size={9} />
                            −{step.dropFromPrev.toFixed(0)}%
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Barra de progresso proporcional */}
                    {!isAusente && (
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(2, step.pctOfTop)}%` }}
                          transition={{ duration: 0.6, delay: 0.2 + i * 0.04 }}
                          className="h-full rounded-full"
                          style={{ background: colors.accent }}
                        />
                      </div>
                    )}

                    {/* Nome do evento técnico */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <code className="text-[9px] font-mono text-slate-400">
                        {step.matchedAlias || step.event}
                      </code>
                      {step.matchedAlias && step.matchedAlias !== step.event && (
                        <span className="text-[8px] text-blue-600">(alias)</span>
                      )}
                      {isAusente && (
                        <span className="text-[9px] text-amber-600 font-medium">
                          • evento não disparado
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Resumo + insight automático */}
        {startCount > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-lg p-2.5 ${colors.bg}`}>
                <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                  Conversão total
                </div>
                <div className={`text-lg font-bold tabular-nums ${colors.text}`}>
                  {conversionPct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-lg p-2.5 bg-slate-50">
                <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                  {ausentes > 0 ? "Eventos faltando" : "Funil ativo"}
                </div>
                <div
                  className={`text-lg font-bold tabular-nums ${
                    ausentes === 0 ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {ausentes === 0 ? "✓ completo" : `${ausentes} faltam`}
                </div>
              </div>
            </div>

            {biggestDrop && biggestDrop.dropPct > 30 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-900 flex items-start gap-1.5">
                <AlertCircle size={11} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Gargalo:</strong> entre{" "}
                  <em>{biggestDrop.prev.label}</em> e <em>{biggestDrop.stage.label}</em>{" "}
                  perdem-se <strong>{formatNumber(biggestDrop.dropAbs)}</strong> usuários
                  ({biggestDrop.dropPct.toFixed(0)}%).
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
