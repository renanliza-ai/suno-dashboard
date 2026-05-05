"use client";

import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatNumber } from "@/lib/utils";

type Props = {
  label: string;
  value: number;
  delta: number;
  color: string;
  index: number;
};

export function KpiCard({ label, value, delta, color, index }: Props) {
  const positive = delta >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: "easeOut" }}
      className="relative bg-white rounded-2xl border border-[color:var(--border)] p-5 overflow-hidden hover:shadow-lg hover:shadow-purple-500/5 transition-shadow"
    >
      <div
        className="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl opacity-20"
        style={{ background: color }}
      />
      <div className="relative">
        <p className="text-sm text-[color:var(--muted-foreground)] font-medium min-h-[20px]">
          <AnimatePresence mode="wait">
            <motion.span
              key={label}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
              className="inline-block"
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </p>
        <div className="flex items-baseline gap-2 mt-2 min-h-[36px]">
          <AnimatePresence mode="wait">
            <motion.p
              key={value}
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="text-3xl font-bold tracking-tight"
            >
              {formatNumber(value)}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${
              positive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
            }`}
          >
            {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {positive ? "+" : ""}
            {delta.toFixed(1)}%
          </div>
          <span className="text-xs text-[color:var(--muted-foreground)]">vs mês anterior</span>
        </div>
      </div>
    </motion.div>
  );
}
