"use client";

/**
 * AssistedTimeToPurchase
 * -----------------------
 * Card exibido APENAS quando a atribuição está em modo "assisted".
 * Mostra, por canal, quanto tempo em média o lead levou do 1º toque até
 * efetivar a compra — a métrica "time-lag" do GA4 (Advertising → Conversion
 * Paths → Time Lag). Como a Data API v1beta não expõe time-lag direto,
 * usamos uma heurística (ver derivação abaixo) e deixamos claro que é
 * estimativa — com destaque para o melhor e o pior ciclo.
 *
 * Heurística:
 *   Canais de topo de funil (social orgânico, display) tendem a ter ciclos
 *   mais longos; canais de fundo de funil (retarget, email, direct) têm
 *   ciclos curtos. Derivamos `estDays` a partir do mix de:
 *     - convRate (quanto maior, mais rápida a intenção)
 *     - avgDuration (tempo engajando dentro da sessão reduz ciclo)
 *     - medium (paid-social/video → ciclo longo; email/cpc/brand → curto)
 *
 * Quando o modo GA4 real estiver conectado, dá pra trocar por um fetch
 * ao GA4 "conversionPath" + "daysToConversion" — já deixo comentado.
 */

import { motion } from "framer-motion";
import { Clock, Zap, TrendingDown, TrendingUp, Info } from "lucide-react";
import { useMemo } from "react";
import { useChat } from "@/lib/chat-context";
import { reportBySunoChannel } from "@/lib/data";
import { formatNumber } from "@/lib/utils";

type ChannelTimeLag = {
  channel: string;
  source?: string;
  medium?: string;
  conversions: number;
  revenue: number;
  convRate: number;
  /** Dias médios entre primeiro toque e compra (estimativa). */
  estDays: number;
  /** Bucket qualitativo para leitura rápida. */
  speed: "rápido" | "médio" | "longo";
};

function estimateDaysToPurchase(row: {
  medium?: string;
  avgDuration: number;
  convRate: number;
}): number {
  const m = (row.medium || "").toLowerCase();
  // base por medium (fundo → topo)
  let base: number;
  if (m === "email") base = 0.9;
  else if (m === "push") base = 0.8;
  else if (m === "(none)") base = 1.3; // direct
  else if (m === "cpc") base = 2.4;
  else if (m === "referral") base = 3.1;
  else if (m === "organic") base = 4.2;
  else if (m === "paid-social") base = 6.8;
  else if (m === "organic-video") base = 7.4;
  else if (m === "audio") base = 8.2;
  else base = 5.0;
  // Quanto maior a convRate, mais curto o ciclo (fator 0.6–1.2)
  const convFactor = Math.max(0.6, 1.2 - row.convRate * 0.2);
  // Sessão longa reduz ciclo (engajou mais antes de sair)
  const durFactor = row.avgDuration > 240 ? 0.85 : row.avgDuration < 90 ? 1.18 : 1;
  const days = base * convFactor * durFactor;
  // Arredonda pra 0.1
  return Math.round(days * 10) / 10;
}

function classify(days: number): "rápido" | "médio" | "longo" {
  if (days < 2) return "rápido";
  if (days < 5) return "médio";
  return "longo";
}

export function AssistedTimeToPurchase() {
  const { attribution } = useChat();

  const rows = useMemo<ChannelTimeLag[]>(() => {
    return reportBySunoChannel
      .filter((c) => c.conversions > 0)
      .map((c) => {
        const estDays = estimateDaysToPurchase(c);
        return {
          channel: c.dimension,
          source: c.source,
          medium: c.medium,
          conversions: c.conversions,
          revenue: c.revenue,
          convRate: c.convRate,
          estDays,
          speed: classify(estDays),
        };
      })
      .sort((a, b) => a.estDays - b.estDays);
  }, []);

  // Só faz sentido no modo de atribuição assistida
  if (attribution !== "assisted") return null;

  const maxDays = Math.max(...rows.map((r) => r.estDays));
  const fastest = rows[0];
  const slowest = rows[rows.length - 1];
  const avgDays =
    rows.reduce((acc, r) => acc + r.estDays * r.conversions, 0) /
    rows.reduce((acc, r) => acc + r.conversions, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6"
    >
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Clock size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              Tempo até a compra por canal
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#ede9fe] text-[#5b3dd4]">
                atribuição assistida
              </span>
            </h3>
            <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5 max-w-xl">
              Dias médios entre o <strong>primeiro toque</strong> daquele canal e o{" "}
              <code className="text-[11px] bg-[color:var(--muted)] px-1 rounded">purchase</code>.
              Quanto menor, mais rápido o ciclo comercial deste canal.
            </p>
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold flex items-center gap-1">
              <Zap size={10} /> Mais rápido
            </div>
            <div className="text-sm font-bold text-emerald-900 mt-0.5">
              {fastest.channel} · {fastest.estDays}d
            </div>
          </div>
          <div className="rounded-xl bg-[#f3f0ff] border border-[#ddd6fe] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[#5b3dd4] font-semibold flex items-center gap-1">
              <Clock size={10} /> Média ponderada
            </div>
            <div className="text-sm font-bold text-[#5b3dd4] mt-0.5">
              {avgDays.toFixed(1)} dias
            </div>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold flex items-center gap-1">
              <TrendingUp size={10} /> Mais longo
            </div>
            <div className="text-sm font-bold text-amber-900 mt-0.5">
              {slowest.channel} · {slowest.estDays}d
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const widthPct = (r.estDays / maxDays) * 100;
          const speedColor =
            r.speed === "rápido"
              ? "from-emerald-400 to-emerald-600"
              : r.speed === "médio"
              ? "from-[#7c5cff] to-[#b297ff]"
              : "from-amber-400 to-orange-500";
          const speedPill =
            r.speed === "rápido"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : r.speed === "médio"
              ? "bg-[#ede9fe] text-[#5b3dd4] border-[#ddd6fe]"
              : "bg-amber-50 text-amber-700 border-amber-200";
          return (
            <motion.div
              key={r.channel}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="grid grid-cols-12 gap-3 items-center py-2 px-3 rounded-xl border border-transparent hover:border-[#7c5cff]/25 hover:bg-[color:var(--muted)]/40 transition"
            >
              <div className="col-span-3">
                <div className="text-sm font-semibold truncate">{r.channel}</div>
                <div className="text-[11px] font-mono text-[color:var(--muted-foreground)] truncate">
                  {r.source} / {r.medium}
                </div>
              </div>
              <div className="col-span-5">
                <div className="h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.7, delay: i * 0.03 }}
                    className={`h-full rounded-full bg-gradient-to-r ${speedColor}`}
                  />
                </div>
              </div>
              <div className="col-span-1 text-right">
                <div className="text-sm font-bold tabular-nums">{r.estDays}d</div>
              </div>
              <div className="col-span-1 text-right">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${speedPill} capitalize`}
                >
                  {r.speed}
                </span>
              </div>
              <div className="col-span-1 text-right">
                <div className="text-sm font-bold tabular-nums">
                  {formatNumber(r.conversions)}
                </div>
                <div className="text-[10px] text-[color:var(--muted-foreground)]">compras</div>
              </div>
              <div className="col-span-1 text-right">
                <div className="text-sm font-bold tabular-nums text-emerald-700">
                  R$ {formatNumber(r.revenue)}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t border-[color:var(--border)] flex items-start gap-2 text-[11px] text-[color:var(--muted-foreground)]">
        <Info size={12} className="mt-0.5 shrink-0" />
        <p className="leading-relaxed">
          Estimativa derivada do <strong>medium</strong>, da <strong>taxa de conversão</strong> e da{" "}
          <strong>duração média da sessão</strong> por canal. Para valores exatos, conecte o
          relatório <em>Conversion Paths → Time Lag</em> do GA4 (em breve nesta visão).
          Canais classificados como{" "}
          <span className="inline-block px-1 rounded bg-emerald-50 text-emerald-700">
            rápido
          </span>{" "}
          indicam ciclo decisório curto — ideais para escalar orçamento.
        </p>
      </div>
    </motion.div>
  );
}
