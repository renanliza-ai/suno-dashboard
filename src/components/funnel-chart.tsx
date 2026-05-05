"use client";

import { motion } from "framer-motion";
import { getFunnel } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useChat } from "@/lib/chat-context";

export function FunnelChart() {
  const { attribution } = useChat();
  const funnel = getFunnel(attribution);
  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
      <div className="mb-6">
        <h3 className="text-base font-semibold">Funil de Conversão</h3>
        <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">Da visita à compra</p>
      </div>

      <div className="space-y-3">
        {funnel.map((step, i) => {
          const prev = i > 0 ? funnel[i - 1].value : step.value;
          const drop = i > 0 && prev > 0 ? Math.round((1 - step.value / prev) * 100) : 0;
          return (
            <div key={step.stage}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-md bg-[#ede9fe] text-[#7c5cff] text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium truncate">{step.stage}</span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-base font-bold tabular-nums">{formatNumber(step.value)}</span>
                  <span className="text-[10px] text-[color:var(--muted-foreground)] tabular-nums">
                    {step.pct}% do topo
                  </span>
                  {i > 0 && drop > 0 && (
                    <span className="text-[10px] text-red-500 font-semibold tabular-nums">
                      −{drop}%
                    </span>
                  )}
                </div>
              </div>
              <div className="relative h-6 bg-[color:var(--muted)] rounded-md overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${step.pct}%` }}
                  transition={{ delay: i * 0.12, duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-md bg-gradient-to-r from-[#7c5cff] to-[#b297ff] flex items-center px-2"
                >
                  <span className="text-[10px] font-bold text-white tabular-nums drop-shadow whitespace-nowrap">
                    {formatNumber(step.value)}
                  </span>
                </motion.div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-5 border-t border-[color:var(--border)] flex items-center justify-between">
        <div>
          <p className="text-xs text-[color:var(--muted-foreground)]">Taxa Visitante → Compra</p>
          <p className="text-xl font-bold text-[#7c5cff] mt-1">0.77%</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[color:var(--muted-foreground)]">Maior drop</p>
          <p className="text-sm font-semibold mt-1">Login → Item</p>
        </div>
      </div>
    </div>
  );
}
