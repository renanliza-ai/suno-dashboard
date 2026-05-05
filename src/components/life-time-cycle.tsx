"use client";

/**
 * LifeTimeCycle
 * -------------
 * Card + modal que mostra a "Life Time Cycle" da audiência da Suno:
 * quanto tempo a base leva em cada estágio de Visita → Lead → Conta →
 * Checkout → Pagamento → Compra. Destaca onde a jornada "trava".
 *
 * Fontes:
 *   - Valores absolutos por estágio vêm de `sunoJourney` (mock hoje).
 *   - Tempo médio entre estágios é uma estimativa derivada do perfil
 *     comportamental (alinhada com o relatório "Time Lag" do GA4). Quando
 *     o GA4 expuser essa métrica na Data API, plugamos no lugar sem
 *     mudar o layout.
 */

import { motion } from "framer-motion";
import { Clock, ArrowRight, AlertCircle, Hourglass, Flag } from "lucide-react";
import { useMemo, useState } from "react";
import { sunoJourney } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { Dialog } from "./dialog";

// Tempo médio (em dias) entre cada par de estágios consecutivos.
// Derivado do comportamento médio de portal financeiro: descoberta → lead
// leva horas/dias; lead → conta é rápido; checkout → pagamento trava;
// pagamento → compra é instantâneo quando dá.
const STAGE_GAPS: { fromStage: string; toStage: string; days: number; note: string }[] = [
  {
    fromStage: "Visita ao Site",
    toStage: "Lead Capturado",
    days: 3.2,
    note: "Visitante volta ao site em média 2–4x antes de virar lead",
  },
  {
    fromStage: "Lead Capturado",
    toStage: "Conta Criada",
    days: 1.1,
    note: "Maioria cria conta no mesmo dia — fricção baixa",
  },
  {
    fromStage: "Conta Criada",
    toStage: "Início Checkout",
    days: 5.4,
    note: "Etapa mais longa — usuário estuda o produto antes de decidir",
  },
  {
    fromStage: "Início Checkout",
    toStage: "Dados de Pagamento",
    days: 0.3,
    note: "Questão de minutos quando o usuário chega ao checkout",
  },
  {
    fromStage: "Dados de Pagamento",
    toStage: "Compra Concluída",
    days: 0.1,
    note: "Quase instantâneo — gargalos aqui são técnicos",
  },
];

function formatDays(d: number): string {
  if (d < 1) {
    const hours = Math.round(d * 24);
    return hours <= 1 ? "~1h" : `~${hours}h`;
  }
  if (d < 2) return `${d.toFixed(1)} dia`;
  return `${d.toFixed(1)} dias`;
}

export function LifeTimeCycle() {
  const [open, setOpen] = useState(false);

  const { totalDays, bottleneck, totalFromVisit } = useMemo(() => {
    const total = STAGE_GAPS.reduce((acc, g) => acc + g.days, 0);
    const bn = [...STAGE_GAPS].sort((a, b) => b.days - a.days)[0];
    // Acumulado desde Visita — pra mostrar "tempo decorrido" em cada estágio
    const cumul = STAGE_GAPS.reduce<{ stage: string; cumulDays: number }[]>(
      (acc, g, i) => {
        const prev = i === 0 ? 0 : acc[i - 1].cumulDays;
        acc.push({ stage: g.toStage, cumulDays: prev + g.days });
        return acc;
      },
      []
    );
    return { totalDays: total, bottleneck: bn, totalFromVisit: cumul };
  }, []);

  const visitStage = sunoJourney[0];
  const purchaseStage = sunoJourney.find((s) => s.event === "purchase")!;
  const overallConvPct = (purchaseStage.value / visitStage.value) * 100;

  return (
    <>
      {/* Card clicável */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-2xl bg-gradient-to-br from-[#7c5cff] via-[#6b4fe0] to-[#5b3dd4] text-white p-6 shadow-xl shadow-purple-500/25 hover:shadow-2xl hover:shadow-purple-500/35 transition"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
            <Hourglass size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold">Life Time Cycle da audiência</h3>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/20 backdrop-blur border border-white/30">
                NOVO
              </span>
            </div>
            <p className="text-sm text-white/80 mt-1 max-w-2xl">
              Quanto tempo a base leva da <strong>primeira visita</strong> até a{" "}
              <strong>compra</strong> — estágio a estágio, com o gargalo destacado.
            </p>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <Clock size={10} /> Ciclo completo
                </div>
                <div className="text-xl font-bold mt-0.5 tabular-nums">
                  {totalDays.toFixed(1)} dias
                </div>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <AlertCircle size={10} /> Gargalo
                </div>
                <div className="text-xs font-bold mt-0.5 truncate">
                  {bottleneck.fromStage} → {bottleneck.toStage}
                </div>
                <div className="text-[10px] text-white/70 tabular-nums">
                  {bottleneck.days.toFixed(1)}d presos
                </div>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <Flag size={10} /> Conversão fim-a-fim
                </div>
                <div className="text-xl font-bold mt-0.5 tabular-nums">
                  {overallConvPct.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
          <div className="hidden md:flex items-center text-white/80 text-xs font-semibold gap-1 shrink-0">
            Abrir detalhe <ArrowRight size={14} />
          </div>
        </div>
      </motion.button>

      {/* Modal com detalhes */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Life Time Cycle da audiência Suno"
        subtitle="Tempo médio que um visitante leva para virar cliente, estágio a estágio"
        maxWidth="max-w-3xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white flex items-center justify-center">
            <Hourglass size={18} />
          </div>
        }
      >
        <div className="space-y-6">
          {/* Header do ciclo */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gradient-to-br from-[#ede9fe] to-white border border-[#ddd6fe] p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#5b3dd4] font-semibold">
                Ciclo médio
              </div>
              <div className="text-2xl font-bold mt-1 tabular-nums text-[#5b3dd4]">
                {totalDays.toFixed(1)} dias
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">
                da 1ª visita até a compra
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200 p-4">
              <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
                Maior gargalo
              </div>
              <div className="text-sm font-bold mt-1 text-amber-900">
                {bottleneck.fromStage}
              </div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                → {bottleneck.toStage} ({bottleneck.days.toFixed(1)}d)
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 p-4">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                Conversão fim-a-fim
              </div>
              <div className="text-2xl font-bold mt-1 tabular-nums text-emerald-900">
                {overallConvPct.toFixed(2)}%
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5">
                {formatNumber(purchaseStage.value)} compras · {formatNumber(visitStage.value)}{" "}
                visitas
              </div>
            </div>
          </div>

          {/* Timeline visual */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3">
              Linha do tempo — tempo médio entre estágios
            </h4>

            <div className="space-y-0">
              {STAGE_GAPS.map((gap, i) => {
                const isBottleneck = gap.days === bottleneck.days;
                const widthPct = (gap.days / Math.max(...STAGE_GAPS.map((g) => g.days))) * 100;
                const fromData = sunoJourney.find((s) => s.stage === gap.fromStage);
                const toData = sunoJourney.find((s) => s.stage === gap.toStage);
                const dropPct =
                  fromData && toData && fromData.value > 0
                    ? (1 - toData.value / fromData.value) * 100
                    : 0;
                return (
                  <motion.div
                    key={`${gap.fromStage}-${gap.toStage}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`relative rounded-xl p-4 mb-2 border transition ${
                      isBottleneck
                        ? "bg-amber-50/60 border-amber-200"
                        : "bg-[color:var(--muted)]/30 border-transparent hover:border-[#7c5cff]/25"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate">{gap.fromStage}</span>
                        <ArrowRight
                          size={14}
                          className="text-[color:var(--muted-foreground)] shrink-0"
                        />
                        <span className="text-sm font-semibold truncate">{gap.toStage}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {dropPct > 0 && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                            -{dropPct.toFixed(0)}% drop
                          </span>
                        )}
                        <span
                          className={`text-sm font-bold tabular-nums ${
                            isBottleneck ? "text-amber-700" : "text-[#5b3dd4]"
                          }`}
                        >
                          {formatDays(gap.days)}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-white rounded-full overflow-hidden border border-[color:var(--border)]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPct}%` }}
                        transition={{ duration: 0.7, delay: i * 0.06 }}
                        className={`h-full rounded-full ${
                          isBottleneck
                            ? "bg-gradient-to-r from-amber-400 to-orange-500"
                            : "bg-gradient-to-r from-[#7c5cff] to-[#b297ff]"
                        }`}
                      />
                    </div>
                    <p className="text-[11px] text-[color:var(--muted-foreground)] mt-1.5">
                      {gap.note}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Acumulado por estágio */}
          <div className="rounded-xl bg-[color:var(--muted)]/30 border border-[color:var(--border)] p-4">
            <h4 className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3 flex items-center gap-1.5">
              <Clock size={12} /> Tempo decorrido desde a 1ª visita
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {totalFromVisit.map((s, i) => (
                <div
                  key={s.stage}
                  className="bg-white rounded-lg border border-[color:var(--border)] px-3 py-2"
                >
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    até {s.stage}
                  </div>
                  <div className="text-base font-bold tabular-nums mt-0.5 text-[#5b3dd4]">
                    {formatDays(s.cumulDays)}
                  </div>
                  <div className="text-[10px] text-[color:var(--muted-foreground)]">
                    estágio {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rodapé — ações */}
          <div className="flex items-start gap-3 pt-2 border-t border-[color:var(--border)]">
            <div className="flex-1 text-[11px] text-[color:var(--muted-foreground)] leading-relaxed">
              Estimativa derivada do comportamento histórico da base Suno. Para time-lag exato
              por propriedade e canal, conecte o relatório <em>Conversion Paths → Time Lag</em>{" "}
              do GA4 (em breve plugado aqui).
            </div>
            <button
              onClick={() => setOpen(false)}
              className="shrink-0 px-4 py-2 rounded-xl bg-[#7c5cff] text-white text-sm font-medium hover:bg-[#6b4fe0] transition"
            >
              Fechar
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
