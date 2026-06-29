"use client";

/**
 * LifeTimeCycle
 * -------------
 * Card + modal que mostra a jornada de conversão da audiência da propriedade
 * SELECIONADA: Visita → Lead → Conta → Checkout → Pagamento → Compra.
 *
 * Fontes:
 *   - Volumes, %, quedas e conversão fim-a-fim: REAIS, por propriedade, via
 *     useGA4Conversions() (funil server-side). Mudam ao trocar de conta.
 *   - Tempo médio entre etapas (dias): ESTIMATIVA comportamental genérica —
 *     o GA4 Data API não expõe time-lag entre eventos. Fica claramente rotulado
 *     como estimativa (não é por propriedade). Quando houver fonte real
 *     (ex.: BigQuery time-lag), plugamos no lugar sem mudar o layout.
 */

import { motion } from "framer-motion";
import { Clock, ArrowRight, AlertCircle, Hourglass, Flag } from "lucide-react";
import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Conversions } from "@/lib/ga4-context";
import { Dialog } from "./dialog";

// Rótulo amigável por evento do funil real (alinhado ao FUNNEL_STEPS do server).
const STAGE_LABELS: Record<string, string> = {
  session_start: "Visita ao Site",
  generate_lead: "Lead Capturado",
  sign_up: "Conta Criada",
  begin_checkout: "Início Checkout",
  add_payment_info: "Dados de Pagamento",
  purchase: "Compra Concluída",
};

// Estimativa de tempo médio (dias) até CHEGAR em cada evento, vinda da etapa
// anterior. GENÉRICA (comportamento de portal financeiro) — NÃO é por
// propriedade. Usada só para dar noção de duração; sempre rotulada como estimativa.
const EST_DAYS_TO_EVENT: Record<string, { days: number; note: string }> = {
  generate_lead: { days: 3.2, note: "Visitante costuma voltar 2–4x antes de virar lead" },
  sign_up: { days: 1.1, note: "Maioria cria conta no mesmo dia — fricção baixa" },
  begin_checkout: { days: 5.4, note: "Etapa mais longa — usuário estuda o produto antes de decidir" },
  add_payment_info: { days: 0.3, note: "Questão de minutos quando o usuário chega ao checkout" },
  purchase: { days: 0.1, note: "Quase instantâneo — gargalos aqui são técnicos" },
};

function formatDays(d: number): string {
  if (d < 1) {
    const hours = Math.round(d * 24);
    return hours <= 1 ? "~1h" : `~${hours}h`;
  }
  if (d < 2) return `${d.toFixed(1)} dia`;
  return `${d.toFixed(1)} dias`;
}

// Limpa o sufixo "– Web" / "- Web" do nome da propriedade pro título ficar curto.
function cleanPropertyName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*[–-]\s*Web\s*$/i, "").trim();
}

type Gap = {
  fromStage: string;
  toStage: string;
  toEvent: string;
  fromValue: number;
  toValue: number;
  dropPct: number; // REAL
  estDays: number; // estimativa genérica
  note: string;
};

export function LifeTimeCycle() {
  const [open, setOpen] = useState(false);
  const { selected } = useGA4();
  const { data, meta, loading } = useGA4Conversions();

  const propLabel = cleanPropertyName(selected?.displayName ?? meta.propertyName);
  const titleSuffix = propLabel ? ` ${propLabel}` : "";
  const DESCRIPTION =
    "Tempo médio que um visitante leva para realizar conversões (lead, criar conta, checkout e purchase)";

  const model = useMemo(() => {
    const steps = data?.funnel?.steps ?? null;
    if (!steps || steps.length < 2 || (steps[0]?.value ?? 0) === 0) return null;

    const stages = steps.map((s) => ({
      // s.event é o evento canônico do FUNNEL_STEPS (session_start, generate_lead,
      // sign_up, begin_checkout, add_payment_info, purchase) — é por ele que
      // mapeamos rótulo e estimativa de tempo. matchedAlias é só o apelido que casou.
      event: s.event,
      label: STAGE_LABELS[s.event] || s.event,
      value: s.value,
      pct: s.pct,
      dropPct: s.dropPct,
    }));

    const gaps: Gap[] = [];
    for (let i = 1; i < stages.length; i++) {
      const est = EST_DAYS_TO_EVENT[stages[i].event];
      gaps.push({
        fromStage: stages[i - 1].label,
        toStage: stages[i].label,
        toEvent: stages[i].event,
        fromValue: stages[i - 1].value,
        toValue: stages[i].value,
        dropPct: stages[i].dropPct, // REAL
        estDays: est?.days ?? 0,
        note: est?.note ?? "",
      });
    }

    const first = stages[0];
    const last = stages[stages.length - 1];
    const overallConvPct = first.value > 0 ? (last.value / first.value) * 100 : 0;

    // Gargalo = MAIOR QUEDA real (não mais o maior tempo estimado).
    const bottleneck = [...gaps].sort((a, b) => b.dropPct - a.dropPct)[0];

    // Ciclo médio = soma das estimativas de tempo (rotulado como estimativa).
    const totalEstDays = gaps.reduce((acc, g) => acc + g.estDays, 0);

    // Acumulado de tempo estimado por etapa.
    const cumul = gaps.reduce<{ stage: string; cumulDays: number }[]>((acc, g, i) => {
      const prev = i === 0 ? 0 : acc[i - 1].cumulDays;
      acc.push({ stage: g.toStage, cumulDays: prev + g.estDays });
      return acc;
    }, []);

    return {
      stages,
      gaps,
      first,
      last,
      overallConvPct,
      bottleneck,
      totalEstDays,
      cumul,
    };
  }, [data]);

  const hasData = !!model;
  const maxEstDays = hasData ? Math.max(...model!.gaps.map((g) => g.estDays), 0.1) : 1;

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
              <h3 className="text-lg font-bold">Life Time Cycle da audiência{titleSuffix}</h3>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/20 backdrop-blur border border-white/30">
                NOVO
              </span>
            </div>
            <p className="text-sm text-white/80 mt-1 max-w-2xl">{DESCRIPTION}</p>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <Clock size={10} /> Ciclo (estim.)
                </div>
                <div className="text-xl font-bold mt-0.5 tabular-nums">
                  {hasData ? `${model!.totalEstDays.toFixed(1)} dias` : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <AlertCircle size={10} /> Maior queda
                </div>
                <div className="text-xs font-bold mt-0.5 truncate">
                  {hasData ? `${model!.bottleneck.fromStage} → ${model!.bottleneck.toStage}` : "—"}
                </div>
                <div className="text-[10px] text-white/70 tabular-nums">
                  {hasData ? `${model!.bottleneck.dropPct}% de queda` : ""}
                </div>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <Flag size={10} /> Conversão fim-a-fim
                </div>
                <div className="text-xl font-bold mt-0.5 tabular-nums">
                  {hasData ? `${model!.overallConvPct.toFixed(2)}%` : "—"}
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
        title={`Life Time Cycle da audiência${titleSuffix}`}
        subtitle={DESCRIPTION}
        maxWidth="max-w-3xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white flex items-center justify-center">
            <Hourglass size={18} />
          </div>
        }
      >
        {!hasData ? (
          <div className="py-10 text-center">
            <div className="text-sm font-medium text-[color:var(--foreground)]">
              {loading || meta.status === "loading"
                ? "Carregando o funil desta propriedade…"
                : "Sem dados de funil para esta propriedade no período selecionado."}
            </div>
            <div className="text-[12px] text-[color:var(--muted-foreground)] mt-1">
              {loading || meta.status === "loading"
                ? "Buscando volumes reais por etapa no GA4."
                : "Verifique se a propriedade tem os eventos do funil (generate_lead, begin_checkout, purchase…) e se os dados reais estão ligados."}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header do ciclo */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-gradient-to-br from-[#ede9fe] to-white border border-[#ddd6fe] p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#5b3dd4] font-semibold">
                  Ciclo médio (estimativa)
                </div>
                <div className="text-2xl font-bold mt-1 tabular-nums text-[#5b3dd4]">
                  {model!.totalEstDays.toFixed(1)} dias
                </div>
                <div className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">
                  da 1ª visita até a compra
                </div>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200 p-4">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
                  Maior gargalo (queda real)
                </div>
                <div className="text-sm font-bold mt-1 text-amber-900">
                  {model!.bottleneck.fromStage}
                </div>
                <div className="text-[11px] text-amber-700 mt-0.5">
                  → {model!.bottleneck.toStage} ({model!.bottleneck.dropPct}% de queda)
                </div>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 p-4">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                  Conversão fim-a-fim
                </div>
                <div className="text-2xl font-bold mt-1 tabular-nums text-emerald-900">
                  {model!.overallConvPct.toFixed(2)}%
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  {formatNumber(model!.last.value)} {model!.last.label.toLowerCase()} ·{" "}
                  {formatNumber(model!.first.value)} visitas
                </div>
              </div>
            </div>

            {/* Timeline visual */}
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3">
                Jornada — queda real por etapa <span className="normal-case font-normal">(tempo = estimativa)</span>
              </h4>

              <div className="space-y-0">
                {model!.gaps.map((gap, i) => {
                  const isBottleneck = gap.toEvent === model!.bottleneck.toEvent;
                  const widthPct = (gap.estDays / maxEstDays) * 100;
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
                          {gap.dropPct > 0 && (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                              -{gap.dropPct}% queda
                            </span>
                          )}
                          <span
                            className={`text-sm font-bold tabular-nums ${
                              isBottleneck ? "text-amber-700" : "text-[#5b3dd4]"
                            }`}
                          >
                            {formatDays(gap.estDays)}
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
                        {formatNumber(gap.fromValue)} → {formatNumber(gap.toValue)}
                        {gap.note ? ` · ${gap.note}` : ""}
                      </p>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Acumulado por estágio (tempo estimado) */}
            <div className="rounded-xl bg-[color:var(--muted)]/30 border border-[color:var(--border)] p-4">
              <h4 className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3 flex items-center gap-1.5">
                <Clock size={12} /> Tempo estimado decorrido desde a 1ª visita
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {model!.cumul.map((s, i) => (
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
                Volumes, quedas e conversão são <strong>reais</strong> da propriedade{" "}
                <strong>{propLabel || "selecionada"}</strong> no período. O <em>tempo entre etapas</em> é
                estimativa comportamental (o GA4 Data API não expõe time-lag); para tempo exato por
                propriedade, conecte <em>Conversion Paths → Time Lag</em> via BigQuery.
              </div>
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 px-4 py-2 rounded-xl bg-[#7c5cff] text-white text-sm font-medium hover:bg-[#6b4fe0] transition"
              >
                Fechar
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
