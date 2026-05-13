"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Eye,
  ShoppingBag,
  ShoppingCart,
  ClipboardList,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  ArrowDownRight,
} from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Funil de compra estilo "discovery" — pedido do Renan pra simplificar a
 * leitura de quem não conhece GA4. Inspirado no layout de jornada do
 * usuário (antes / durante / depois) mas adaptado para o funil de
 * conversão de compra da Suno.
 *
 * 6 etapas em 3 grupos:
 *   ANTES:   pageview, view_item
 *   DURANTE: view_cart, begin_checkout, add_payment_info
 *   DEPOIS:  purchase
 *
 * Cada etapa mostra:
 *   - Ícone grande + nome legível em PT-BR
 *   - Contagem real do evento no período
 *   - % drop vs etapa anterior
 *   - Barra de progresso com cor proporcional ao volume
 *
 * Dados vêm de useGA4Overview (events) + useGA4Conversions (discoveredEvents)
 * que já são puxados em outras partes do painel.
 */

type StageDef = {
  event: string;
  aliases: string[]; // nomes alternativos pra busca
  label: string;
  description: string;
  icon: typeof Eye;
  group: "antes" | "durante" | "depois";
};

// Aliases REVISADOS conforme taxonomia real da Suno (validado pelo Renan):
// - view_cart é o evento próprio "adicionou ao carrinho" (não confundir com
//   add_to_cart se ambos disparam — usamos o canônico view_cart)
// - add_payment_info é APENAS isso (não inclui add_shipping_info que é
//   evento separado e na Suno chega antes em alguns casos)
// - Removemos aliases que cruzavam contagens entre stages diferentes
//   (causava drops invertidos no funil — add_payment > begin_checkout, etc)
const STAGES: StageDef[] = [
  {
    event: "page_view",
    aliases: ["page_view", "pageview"],
    label: "Visita o site",
    description: "Pageview — primeira impressão",
    icon: Eye,
    group: "antes",
  },
  {
    event: "view_item",
    aliases: ["view_item"],
    label: "Vê o produto",
    description: "Acessa página de produto",
    icon: ShoppingBag,
    group: "antes",
  },
  {
    event: "view_cart",
    aliases: ["view_cart", "add_to_cart"],
    label: "Adiciona ao carrinho",
    description: "Demonstra interesse de compra",
    icon: ShoppingCart,
    group: "durante",
  },
  {
    event: "begin_checkout",
    aliases: ["begin_checkout"],
    label: "Inicia o checkout",
    description: "Preenche dados pessoais",
    icon: ClipboardList,
    group: "durante",
  },
  {
    event: "add_payment_info",
    aliases: ["add_payment_info"],
    label: "Preenche pagamento",
    description: "Informa cartão ou Pix",
    icon: CreditCard,
    group: "durante",
  },
  {
    event: "purchase",
    aliases: ["purchase"],
    label: "Compra finalizada",
    description: "Conversão concluída",
    icon: CheckCircle2,
    group: "depois",
  },
];

const GROUP_COLORS = {
  antes: { bg: "from-blue-100 to-blue-200", text: "text-blue-700", bar: "#93c5fd" },
  durante: { bg: "from-blue-400 to-blue-500", text: "text-white", bar: "#3b82f6" },
  depois: { bg: "from-blue-600 to-blue-800", text: "text-white", bar: "#1e40af" },
};

type ScaleMode = "topOfFunnel" | "previousStage";

export function PurchaseFunnelDiscovery() {
  const { selectedId, days, customRange } = useGA4();
  // Modo de visualização:
  //   topOfFunnel: % do topo (default GA4 — barras pequenas porque page_view é gigante)
  //   previousStage: % da etapa anterior (melhor pra ver gargalos)
  const [scaleMode, setScaleMode] = useState<ScaleMode>("previousStage");

  // Eventos do funil — endpoint dedicado garante que TODOS os 6 eventos
  // sejam retornados, mesmo os com volume baixo (inListFilter no eventName)
  const [eventCounts, setEventCounts] = useState<Map<string, number>>(new Map());
  const [loadingFunnel, setLoadingFunnel] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    const requestPropertyId = selectedId;
    setLoadingFunnel(true);
    const params = new URLSearchParams({
      propertyId: selectedId,
      days: String(days),
    });
    if (customRange) {
      params.set("startDate", customRange.startDate);
      params.set("endDate", customRange.endDate);
    }
    fetch(`/api/eventos/purchase-funnel?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { propertyId?: string; events?: Record<string, { count: number }> }) => {
        if (d.propertyId && d.propertyId !== requestPropertyId) return;
        const map = new Map<string, number>();
        for (const [name, v] of Object.entries(d.events || {})) {
          map.set(name, v.count);
        }
        setEventCounts(map);
      })
      .catch(() => {
        // Silently fail — UI mostra "evento ausente"
      })
      .finally(() => setLoadingFunnel(false));
  }, [selectedId, days, customRange?.startDate, customRange?.endDate]);

  // Resolve cada etapa pegando o primeiro alias que tenha contagem > 0
  const resolved = STAGES.map((stage) => {
    let matched: { alias: string; count: number } | null = null;
    for (const alias of stage.aliases) {
      const c = eventCounts.get(alias) || 0;
      if (c > 0 && (!matched || c > matched.count)) {
        matched = { alias, count: c };
      }
    }
    return {
      ...stage,
      matchedAlias: matched?.alias || null,
      count: matched?.count || 0,
    };
  });

  const top = resolved[0]?.count || 0;
  const hasAnyData = resolved.some((s) => s.count > 0);

  // Agrupa por bloco
  const grouped = {
    antes: resolved.filter((s) => s.group === "antes"),
    durante: resolved.filter((s) => s.group === "durante"),
    depois: resolved.filter((s) => s.group === "depois"),
  };

  if (!hasAnyData) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900 mb-6 flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div>
          <strong>Nenhum evento do funil de compra detectado no período.</strong>
          <p className="text-xs mt-1 leading-relaxed">
            Esperado:{" "}
            {STAGES.map((s) => (
              <code key={s.event} className="bg-amber-100 px-1 rounded mr-1 text-[10px]">
                {s.event}
              </code>
            ))}
            . Esses eventos vêm do GTM disparando enhanced ecommerce. Se você ainda não trackeia
            view_item/view_cart, o funil fica incompleto.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-5 md:p-6 mb-6"
    >
      <div className="mb-5 flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            Funil de compra
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
              ✓ dado real GA4
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Da primeira visita até a compra finalizada — eventos do enhanced ecommerce
          </p>
        </div>
        {/* Toggle de escala — page_view é gigante, então 'previousStage' fica
            muito mais legível pra ver os drops reais entre etapas */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setScaleMode("previousStage")}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition ${
              scaleMode === "previousStage"
                ? "bg-white text-[#7c5cff] shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            title="Cada barra mostra o % em relação à etapa anterior — melhor pra ver gargalos"
          >
            % vs etapa anterior
          </button>
          <button
            onClick={() => setScaleMode("topOfFunnel")}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition ${
              scaleMode === "topOfFunnel"
                ? "bg-white text-[#7c5cff] shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            title="Cada barra mostra o % em relação ao topo do funil (page_view) — escala global"
          >
            % do topo
          </button>
        </div>
      </div>

      {/* Header dos grupos: "antes / durante / depois" — estilo do print */}
      <div className="grid grid-cols-6 gap-1 mb-3 bg-slate-900 rounded-xl overflow-hidden text-white">
        <div className="col-span-2 px-3 py-2 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">
          Antes
        </div>
        <div className="col-span-3 px-3 py-2 text-center text-xs font-bold uppercase tracking-wider border-r border-white/10">
          Durante
        </div>
        <div className="col-span-1 px-3 py-2 text-center text-xs font-bold uppercase tracking-wider">
          Depois
        </div>
      </div>

      {/* Ícones + nomes (linha de cima) — grid de 6 colunas pra alinhar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-4">
        {resolved.map((stage, i) => {
          const Icon = stage.icon;
          const color = GROUP_COLORS[stage.group];
          const isAusente = stage.count === 0;

          return (
            <motion.div
              key={stage.event}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex flex-col items-center text-center"
            >
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm mb-2 ${
                  isAusente
                    ? "bg-slate-100"
                    : `bg-gradient-to-br ${color.bg}`
                }`}
              >
                <Icon
                  size={26}
                  className={isAusente ? "text-slate-400" : color.text}
                  strokeWidth={2}
                />
              </div>
              <div className="text-[11px] font-bold text-slate-900 leading-tight">
                {stage.label}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5 leading-tight">
                {stage.description}
              </div>
              <code className="text-[9px] font-mono text-slate-400 mt-1 break-all">
                {stage.event}
              </code>
            </motion.div>
          );
        })}
      </div>

      {/* Barras de progresso conectadas */}
      <div className="space-y-2.5">
        {resolved.map((stage, i) => {
          const pctOfTop = top > 0 ? (stage.count / top) * 100 : 0;
          const prev = i > 0 ? resolved[i - 1] : stage;
          const pctOfPrev = prev.count > 0 && i > 0 ? (stage.count / prev.count) * 100 : 100;
          const dropPct = prev.count > 0 && i > 0 ? (1 - stage.count / prev.count) * 100 : 0;
          const dropAbs = i > 0 ? Math.max(0, prev.count - stage.count) : 0;
          const color = GROUP_COLORS[stage.group];
          const isAusente = stage.count === 0;
          const isCritical = i > 0 && dropPct > 60;

          // Width da barra depende do modo:
          //   previousStage: % da etapa anterior (default — legível, mostra gargalos)
          //   topOfFunnel: % do topo (escala global, mas pode ficar < 1%)
          const barWidth =
            scaleMode === "previousStage"
              ? Math.max(2, pctOfPrev) // min 2% pra não sumir
              : Math.max(2, pctOfTop);

          return (
            <motion.div
              key={`bar-${stage.event}-${scaleMode}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.06 }}
              className="flex items-center gap-3"
            >
              {/* Label à esquerda */}
              <div className="w-32 sm:w-40 shrink-0 text-right">
                <div className="text-xs font-semibold text-slate-700 truncate">{stage.label}</div>
                <div className="text-[10px] font-mono text-slate-400 truncate">
                  {stage.matchedAlias || stage.event}
                </div>
              </div>

              {/* Barra com label inteligente — UM texto só, dentro OU fora
                  da barra conforme o tamanho. Threshold: 25% (cabe texto). */}
              <div className="flex-1 relative h-9 bg-slate-100 rounded-md overflow-hidden">
                {isAusente ? (
                  <div className="absolute inset-0 flex items-center px-3">
                    <span className="text-xs font-semibold text-amber-700">
                      Evento ausente — verificar tracking
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Barra colorida */}
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidth}%` }}
                      transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 + i * 0.06 }}
                      className="h-full rounded-md flex items-center justify-end px-3"
                      style={{ background: color.bar }}
                    >
                      {/* Label DENTRO da barra: só quando há espaço (>= 25%) */}
                      {barWidth >= 25 && (
                        <span className="text-xs font-bold text-white tabular-nums whitespace-nowrap drop-shadow">
                          {formatNumber(stage.count)}
                        </span>
                      )}
                    </motion.div>
                    {/* Label FORA da barra: só quando barra é pequena (< 25%) */}
                    {barWidth < 25 && (
                      <div
                        className="absolute inset-0 flex items-center pointer-events-none"
                        style={{ paddingLeft: `calc(${barWidth}% + 8px)` }}
                      >
                        <span className="text-[11px] font-bold text-slate-700 tabular-nums whitespace-nowrap">
                          {formatNumber(stage.count)}
                          {scaleMode === "previousStage" && i > 0 && (
                            <span className="text-slate-400 font-normal ml-1">
                              · {pctOfPrev.toFixed(1)}% da etapa anterior
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Drop info à direita */}
              <div className="w-28 sm:w-32 shrink-0 text-right">
                {i === 0 ? (
                  <span className="text-[10px] text-slate-400 font-mono">topo do funil</span>
                ) : isAusente ? (
                  <span className="text-[10px] text-slate-400">—</span>
                ) : dropAbs > 0 ? (
                  <div className="text-right">
                    <div
                      className={`text-xs font-bold flex items-center justify-end gap-0.5 ${
                        isCritical ? "text-red-600" : dropPct > 30 ? "text-amber-600" : "text-slate-500"
                      }`}
                    >
                      <ArrowDownRight size={10} />
                      −{dropPct.toFixed(0)}%
                    </div>
                    <div className="text-[9px] text-slate-400 tabular-nums">
                      −{formatNumber(dropAbs)} usuários
                    </div>
                  </div>
                ) : (
                  <span className="text-[10px] text-emerald-600 font-bold">↑</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Resumo final */}
      {resolved[0].count > 0 && resolved[resolved.length - 1].count > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(() => {
            const startCount = resolved[0].count;
            const endCount = resolved[resolved.length - 1].count;
            const conversionPct = startCount > 0 ? (endCount / startCount) * 100 : 0;
            const dropped = startCount - endCount;
            const groupedAusentes = resolved.filter((s) => s.count === 0).length;

            return (
              <>
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Taxa de conversão geral
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-600 mt-1">
                    {conversionPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    do topo do funil até a compra
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Perdidos no caminho
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-red-600 mt-1">
                    {formatNumber(dropped)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    usuários que entraram mas não compraram
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Eventos do funil ausentes
                  </div>
                  <div
                    className={`text-2xl font-bold tabular-nums mt-1 ${
                      groupedAusentes === 0 ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {groupedAusentes}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {groupedAusentes === 0 ? "funil completo ✓" : "verificar tracking GTM"}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </motion.section>
  );
}
