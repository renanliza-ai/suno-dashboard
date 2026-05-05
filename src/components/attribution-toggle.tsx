"use client";

import { motion, AnimatePresence } from "framer-motion";
import { MousePointer2, Network, TrendingUp, Info } from "lucide-react";
import { useChat } from "@/lib/chat-context";
import { useGA4 } from "@/lib/ga4-context";

export function AttributionToggle() {
  const { attribution, setAttribution } = useChat();
  const { useRealData } = useGA4();
  const isLast = attribution === "last-click";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl mb-6 border border-[color:var(--border)] bg-gradient-to-br from-white via-white to-[#f5f2ff] shadow-sm"
    >
      <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-gradient-to-br from-[#7c5cff]/10 to-transparent blur-3xl pointer-events-none" />

      <div className="relative p-5 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5 items-center">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30 shrink-0">
            <TrendingUp size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold">Como você quer enxergar seus resultados?</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">
                Interativo
              </span>
              {useRealData && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Aplica somente em dados mock
                </span>
              )}
            </div>
            <AnimatePresence mode="wait">
              <motion.p
                key={attribution}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-sm text-[color:var(--muted-foreground)] mt-1 flex items-start gap-1.5"
              >
                <Info size={14} className="mt-0.5 shrink-0 text-[#7c5cff]" />
                {isLast ? (
                  <span>
                    <strong className="text-[color:var(--foreground)]">Last Click</strong> — atribui 100% do crédito ao último canal antes da conversão. Visão conservadora, ideal para otimização de mídia paga.
                  </span>
                ) : (
                  <span>
                    <strong className="text-[color:var(--foreground)]">Atribuição Assistida</strong> — distribui o crédito entre todos os touchpoints da jornada. Revela o verdadeiro impacto de canais de topo de funil.
                  </span>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <div
          className="relative bg-[color:var(--muted)] p-1.5 rounded-2xl shadow-inner grid grid-cols-2 w-full lg:w-[380px] shrink-0"
          role="tablist"
          aria-label="Modelo de atribuição"
        >
          <motion.div
            aria-hidden
            animate={{ x: isLast ? 0 : "100%" }}
            transition={{ type: "spring", damping: 22, stiffness: 260 }}
            className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-6px)] bg-white rounded-xl shadow-md shadow-purple-500/15"
          />

          <button
            role="tab"
            aria-selected={isLast}
            onClick={() => setAttribution("last-click")}
            className={`relative flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold z-10 transition-colors ${
              isLast ? "text-[#7c5cff]" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            }`}
          >
            <MousePointer2 size={15} className="shrink-0" />
            <span className="truncate">Last Click</span>
          </button>

          <button
            role="tab"
            aria-selected={!isLast}
            onClick={() => setAttribution("assisted")}
            className={`relative flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold z-10 transition-colors ${
              !isLast ? "text-[#7c5cff]" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            }`}
          >
            <Network size={15} className="shrink-0" />
            <span className="truncate">Atribuição Assistida</span>
          </button>
        </div>
      </div>

      <div className="relative px-5 pb-4 flex items-center gap-4 text-xs text-[color:var(--muted-foreground)] border-t border-dashed border-[color:var(--border)] pt-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7c5cff]" />
          Todas as métricas da página se atualizam ao alternar
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          KPIs, tendência, páginas e funil
        </div>
      </div>
    </motion.div>
  );
}
