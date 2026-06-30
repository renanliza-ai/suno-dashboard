"use client";

/**
 * LifeTimeCycle → Jornada de Conversão
 * ------------------------------------
 * Card + modal com a JORNADA DE CONVERSÃO real da propriedade SELECIONADA:
 * Visita → Lead → Conta → Checkout → Pagamento → Compra.
 *
 * 100% REAL e por propriedade (via useGA4Conversions): volumes, % das visitas,
 * variação entre etapas e conversão fim-a-fim. Muda ao trocar de conta.
 *
 * IMPORTANTE (honestidade de dado):
 *   - NÃO mostramos "tempo médio entre etapas": o GA4 Data API não expõe
 *     time-lag entre eventos. Tempo real só via BigQuery (Conversion Paths →
 *     Time Lag) — fica como evolução futura.
 *   - Estes 6 eventos NÃO são um funil estritamente encadeado (dá pra iniciar
 *     checkout sem virar lead/criar conta) e cada BU usa eventos diferentes.
 *     Por isso, quando uma etapa tem MAIS eventos que a anterior, marcamos como
 *     "evento independente" em vez de inventar uma queda de funil.
 */

import { motion } from "framer-motion";
import { ArrowRight, AlertCircle, Flag, Route, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Conversions } from "@/lib/ga4-context";
import { Dialog } from "./dialog";

// Rótulo amigável por evento canônico do funil (alinhado ao FUNNEL_STEPS do server).
const STAGE_LABELS: Record<string, string> = {
  session_start: "Visita ao Site",
  generate_lead: "Lead Capturado",
  sign_up: "Conta Criada",
  begin_checkout: "Início Checkout",
  add_payment_info: "Dados de Pagamento",
  purchase: "Compra Concluída",
};

// Limpa o sufixo "– Web" / "- Web" do nome da propriedade pro título ficar curto.
function cleanPropertyName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*[–-]\s*Web\s*$/i, "").trim();
}

type Stage = {
  event: string;
  label: string;
  value: number;
  pctOfVisit: number; // % das visitas (value / 1ª etapa)
  // variação vs etapa anterior: negativo = queda; positivo = cresceu (não-encadeado); null = n/d
  stepChange: number | null;
  isIndependent: boolean; // cresceu vs etapa anterior → evento independente
  hasData: boolean;
};

export function LifeTimeCycle() {
  const [open, setOpen] = useState(false);
  const { selected } = useGA4();
  const { data, meta, loading } = useGA4Conversions();

  const propLabel = cleanPropertyName(selected?.displayName ?? meta.propertyName);
  const titleSuffix = propLabel ? ` ${propLabel}` : "";
  const DESCRIPTION =
    "Da 1ª visita à compra: volume e taxa de conversão por etapa (dados reais da propriedade)";

  const model = useMemo(() => {
    const steps = data?.funnel?.steps ?? null;
    if (!steps || steps.length < 2) return null;
    const visitValue = steps[0]?.value ?? 0;
    if (visitValue === 0) return null;

    const stages: Stage[] = steps.map((s, i) => {
      const prev = i > 0 ? steps[i - 1].value : null;
      let stepChange: number | null = null;
      if (i > 0 && prev && prev > 0 && s.value > 0) {
        stepChange = ((s.value - prev) / prev) * 100; // negativo = queda
      }
      return {
        event: s.event,
        label: STAGE_LABELS[s.event] || s.event,
        value: s.value,
        pctOfVisit: visitValue > 0 ? (s.value / visitValue) * 100 : 0,
        stepChange,
        isIndependent: stepChange !== null && stepChange > 0.5,
        hasData: s.value > 0,
      };
    });

    const first = stages[0];
    const last = stages[stages.length - 1];
    const overallConvPct = first.value > 0 ? (last.value / first.value) * 100 : 0;

    // Gargalo = MAIOR QUEDA real entre etapas consecutivas (só quedas, ignora crescimento).
    const drops = stages.filter((s) => s.stepChange !== null && s.stepChange < 0);
    const bottleneck =
      drops.length > 0
        ? [...drops].sort((a, b) => (a.stepChange! - b.stepChange!))[0] // mais negativo
        : null;
    const bottleneckPrev = bottleneck
      ? stages[stages.findIndex((s) => s.event === bottleneck.event) - 1]
      : null;

    return { stages, first, last, overallConvPct, bottleneck, bottleneckPrev };
  }, [data]);

  const hasData = !!model;

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
            <Route size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold">Jornada de Conversão da audiência{titleSuffix}</h3>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/20 backdrop-blur border border-white/30">
                NOVO
              </span>
            </div>
            <p className="text-sm text-white/80 mt-1 max-w-2xl">{DESCRIPTION}</p>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <Flag size={10} /> Conversão fim-a-fim
                </div>
                <div className="text-xl font-bold mt-0.5 tabular-nums">
                  {hasData ? `${model!.overallConvPct.toFixed(2)}%` : "—"}
                </div>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <AlertCircle size={10} /> Maior queda
                </div>
                <div className="text-xs font-bold mt-0.5 truncate">
                  {hasData && model!.bottleneck
                    ? `${model!.bottleneckPrev?.label} → ${model!.bottleneck.label}`
                    : "—"}
                </div>
                <div className="text-[10px] text-white/70 tabular-nums">
                  {hasData && model!.bottleneck
                    ? `${Math.abs(model!.bottleneck.stepChange!).toFixed(0)}% de queda`
                    : ""}
                </div>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-white/70 font-semibold flex items-center gap-1">
                  <ShoppingCart size={10} /> Compras no período
                </div>
                <div className="text-xl font-bold mt-0.5 tabular-nums">
                  {hasData ? formatNumber(model!.last.value) : "—"}
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
        title={`Jornada de Conversão da audiência${titleSuffix}`}
        subtitle={DESCRIPTION}
        maxWidth="max-w-3xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white flex items-center justify-center">
            <Route size={18} />
          </div>
        }
      >
        {!hasData ? (
          <div className="py-10 text-center">
            <div className="text-sm font-medium text-[color:var(--foreground)]">
              {loading || meta.status === "loading"
                ? "Carregando a jornada desta propriedade…"
                : "Sem dados de jornada para esta propriedade no período selecionado."}
            </div>
            <div className="text-[12px] text-[color:var(--muted-foreground)] mt-1">
              {loading || meta.status === "loading"
                ? "Buscando volumes reais por etapa no GA4."
                : "Verifique se a propriedade tem os eventos da jornada (generate_lead, begin_checkout, purchase…) e se os dados reais estão ligados."}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="grid grid-cols-3 gap-3">
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
              <div className="rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200 p-4">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
                  Maior gargalo (queda real)
                </div>
                {model!.bottleneck ? (
                  <>
                    <div className="text-sm font-bold mt-1 text-amber-900">
                      {model!.bottleneckPrev?.label}
                    </div>
                    <div className="text-[11px] text-amber-700 mt-0.5">
                      → {model!.bottleneck.label} ({Math.abs(model!.bottleneck.stepChange!).toFixed(0)}% de
                      queda)
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-amber-700 mt-1">
                    Sem queda monotônica clara nesta jornada
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-gradient-to-br from-[#ede9fe] to-white border border-[#ddd6fe] p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#5b3dd4] font-semibold">
                  Compras no período
                </div>
                <div className="text-2xl font-bold mt-1 tabular-nums text-[#5b3dd4]">
                  {formatNumber(model!.last.value)}
                </div>
                <div className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">
                  {model!.last.label}
                </div>
              </div>
            </div>

            {/* Jornada por etapa */}
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3">
                Etapas da jornada — volume real e % das visitas
              </h4>

              <div className="space-y-0">
                {model!.stages.map((stage, i) => {
                  const isBottleneck = model!.bottleneck?.event === stage.event;
                  const widthPct = Math.max(stage.pctOfVisit, 1.5); // barra = % das visitas
                  return (
                    <motion.div
                      key={stage.event}
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
                          <span className="text-[10px] font-bold text-[color:var(--muted-foreground)] tabular-nums">
                            {i + 1}.
                          </span>
                          <span className="text-sm font-semibold truncate">{stage.label}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {/* variação vs etapa anterior */}
                          {stage.stepChange !== null && stage.stepChange < 0 && (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                              -{Math.abs(stage.stepChange).toFixed(0)}% vs anterior
                            </span>
                          )}
                          {stage.isIndependent && (
                            <span
                              className="text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded"
                              title="Esta etapa registra mais eventos que a anterior — sinal de que não é um funil encadeado (ex.: usuário inicia checkout sem ter gerado lead). É um evento independente nesta BU."
                            >
                              ↑ evento independente
                            </span>
                          )}
                          <span className="text-sm font-bold tabular-nums text-[#5b3dd4]">
                            {formatNumber(stage.value)}
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
                        {stage.pctOfVisit.toFixed(stage.pctOfVisit < 1 ? 2 : 1)}% das visitas chegam aqui
                      </p>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Rodapé */}
            <div className="flex items-start gap-3 pt-2 border-t border-[color:var(--border)]">
              <div className="flex-1 text-[11px] text-[color:var(--muted-foreground)] leading-relaxed">
                Volumes, % e conversão são <strong>reais</strong> da propriedade{" "}
                <strong>{propLabel || "selecionada"}</strong> no período. As etapas são{" "}
                <strong>eventos-chave</strong> (não um funil estritamente encadeado — cada BU usa eventos
                diferentes; etapas marcadas <em>"↑ evento independente"</em> registram mais eventos que a
                anterior). O <em>tempo entre etapas</em> não é exibido porque o GA4 não o expõe; para
                tempo real, conecte <em>Conversion Paths → Time Lag</em> via BigQuery.
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
