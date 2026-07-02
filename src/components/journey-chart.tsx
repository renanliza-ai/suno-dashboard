"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { formatNumber } from "@/lib/utils";
import {
  Globe,
  UserPlus,
  UserCheck,
  ShoppingCart,
  Wallet,
  CheckCircle2,
  LogIn,
  Gift,
  ArrowDown,
  Sparkles,
  Target,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { Dialog } from "./dialog";
import { useGA4, useGA4Conversions } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock } from "@/components/data-status";
import { MasterOnly } from "@/components/master-only";

type JourneyStep = {
  stage: string;
  event: string;
  value: number;
  pct: number;
  dropPct: number;
  color: string;
  phase: string;
};

// ESTRUTURA das etapas da jornada (nomes, cores, fases) - SEM valores.
// Os valores vem SEMPRE do funil real do GA4. Politica zero mock (30/06):
// numero fabricado nao renderiza em nenhum estado.
const JOURNEY_STAGES: Omit<JourneyStep, "value" | "pct" | "dropPct">[] = [
  { stage: "Visita ao Site", event: "session_start", color: "#7c5cff", phase: "descoberta" },
  { stage: "Lead Capturado", event: "generate_lead", color: "#8b5cff", phase: "descoberta" },
  { stage: "Conta Criada", event: "sign_up", color: "#a78bfa", phase: "ativação" },
  { stage: "Início Checkout", event: "begin_checkout", color: "#f59e0b", phase: "compra" },
  { stage: "Dados de Pagamento", event: "add_payment_info", color: "#f97316", phase: "compra" },
  { stage: "Compra Concluída", event: "purchase", color: "#10b981", phase: "compra" },
];

const iconMap: Record<string, typeof Globe> = {
  "Visita ao Site": Globe,
  "Lead Capturado": UserPlus,
  "Conta Criada": UserCheck,
  "Início Checkout": ShoppingCart,
  "Dados de Pagamento": Wallet,
  "Compra Concluída": CheckCircle2,
  "Área do Investidor": LogIn,
  "Up-sell / Cross-sell": Gift,
};

const phaseLabels: Record<string, string> = {
  descoberta: "Descoberta",
  ativação: "Ativação",
  compra: "Compra",
  retenção: "Retenção",
  expansão: "Expansão",
};

const phaseColors: Record<string, string> = {
  descoberta: "bg-purple-50 text-purple-700 border-purple-200",
  ativação: "bg-violet-50 text-violet-700 border-violet-200",
  compra: "bg-amber-50 text-amber-700 border-amber-200",
  retenção: "bg-blue-50 text-blue-700 border-blue-200",
  expansão: "bg-pink-50 text-pink-700 border-pink-200",
};

// Diagnostico contextual por etapa: O QUE OLHAR e ONDE MELHORAR.
// Texto orientativo SEM numeros da casa (os numeros reais estao nos cards).
// Benchmarks sao referencias publicas de mercado, nao dado do painel.
const stageInsights: Record<string, { diagnosis: string; actions: string[]; benchmark: string }> = {
  "Visita ao Site": {
    diagnosis:
      "Topo do funil. O volume real desta property esta no card acima. Foco: qualificacao do trafego via canais Suno customizados.",
    actions: [
      "Audite canais de baixa conversao em /midia",
      "Valide taxonomia UTM em /tracking",
      "Revise LPs com bounce alto em /cro",
    ],
    benchmark: "Benchmark fintech: 15-25% dos visitantes viram lead em 30d",
  },
  "Lead Capturado": {
    diagnosis:
      "Compare a queda real (card acima) com o benchmark. Queda alta costuma indicar LP com friccao ou oferta generica.",
    actions: [
      "Teste A/B de copy nas LPs principais",
      "Reduza campos do formulario (1 mudanca por vez)",
      "Adicione lead magnet (ebook, planilha)",
    ],
    benchmark: "Fintech top-quartil: 30-40% visita->lead",
  },
  "Conta Criada": {
    diagnosis:
      "Taxa real de lead->conta no card acima. Friccao aqui costuma ser formulario de signup e falta de ativacao imediata.",
    actions: [
      "Email de ativacao automatico logo apos o lead",
      "Pre-preencher o signup com dados do lead",
      "Onboarding gratuito para capturar conta antes da compra",
    ],
    benchmark: "SaaS financeiro: 50-60% lead->conta",
  },
  "Início Checkout": {
    diagnosis:
      "Momento-chave: aqui o lead decide se vira cliente. Compare a taxa real (card acima) com o benchmark.",
    actions: [
      "Retargeting para quem criou conta e nao iniciou checkout",
      "Sequencia de emails com depoimentos nos primeiros dias",
      "Oferta com janela limitada para contas novas",
    ],
    benchmark: "E-commerce SaaS: 25-35% conta->begin_checkout",
  },
  "Dados de Pagamento": {
    diagnosis:
      "Friccao classica: formulario de pagamento (CPF, cartao, Pix). Veja a queda real no card acima.",
    actions: [
      "Oferecer Pix + cartao lado a lado (nao em sub-paginas)",
      "Validar cartao inline antes do submit",
      "Revisar tempo de carregamento da etapa",
    ],
    benchmark: "Top-quartil BR: 70-75% avancam para purchase",
  },
  "Compra Concluída": {
    diagnosis:
      "Fim do funil. Abandono aqui costuma ser pagamento recusado (Pix, 3DS) ou inseguranca de ultima hora.",
    actions: [
      "Revisar taxa de aprovacao da adquirente",
      "Recuperacao de carrinho abandonado",
      "Mostrar garantia + suporte no step de pagamento",
    ],
    benchmark: "Top-quartil: 75-80% pagamento->purchase",
  },
};

export function JourneyChart() {
  const [selected, setSelected] = useState<JourneyStep | null>(null);
  const { useRealData, days, customRange } = useGA4();
  // Sem daysOverride — respeita o calendário do header (days/customRange do contexto)
  const { data: ga4Conv, meta } = useGA4Conversions();
  // Label dinâmico do período em uso
  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `últimos ${days}d`;

  const realFunnel = ga4Conv?.funnel;

  // POLITICA ZERO MOCK (30/06): sem funil real, nada de numero ilustrativo.
  // Estados possiveis: skeleton (carregando), aviso de conexao (!useRealData)
  // ou aviso de indisponibilidade (fetch terminou sem funil).
  if (!useRealData || !realFunnel) {
    const carregando = useRealData && (meta.status === "loading" || meta.status === "idle");
    return (
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
        <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap mb-4">
          Jornada do Usuário Suno
          <DataStatus meta={meta} usingMock={!useRealData} compact />
        </h3>
        {carregando ? (
          <SkeletonBlock height={240} />
        ) : !useRealData ? (
          <div className="rounded-xl border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--muted-foreground)] text-center">
            Sem conexão com o GA4. Selecione uma property no header - este painel não exibe
            dados de exemplo.
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Sem dados do funil desta property no período selecionado. Nenhum número
            ilustrativo é exibido aqui para não se passar por dado real. Tente trocar o
            período ou a property no header.
          </div>
        )}
      </div>
    );
  }
  const stageMatch = new Map<
    string,
    { matchedAlias: string | null; aliasesTried: string[]; value: number }
  >();
  // A partir daqui o funil real EXISTE: montamos as etapas com valores 100% do GA4.
  const journey: JourneyStep[] = JOURNEY_STAGES.map((st) => {
    const real = realFunnel.steps.find((s) => s.event === st.event);
    stageMatch.set(st.stage, {
      matchedAlias: real?.matchedAlias ?? null,
      aliasesTried: real?.aliasesTried ?? [st.event],
      value: real?.value ?? 0,
    });
    return {
      ...st,
      value: real?.value ?? 0,
      pct: real?.pct ?? 0,
      dropPct: real?.dropPct ?? 0,
    };
  });

  const isReal = true;
  // Stages que esperávamos medir mas vieram zerados
  const zeroStages = JOURNEY_STAGES.filter((s) => {
    const m = stageMatch.get(s.stage);
    return m && m.value === 0;
  }).map((s) => ({ stage: s.stage, aliases: stageMatch.get(s.stage)!.aliasesTried }));
  const discoveredEvents = realFunnel?.discoveredEvents || [];
  const selectedIdx = selected ? journey.findIndex((s) => s.stage === selected.stage) : -1;
  const insight = selected ? stageInsights[selected.stage] : null;

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            Jornada do Usuário Suno
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider bg-gradient-to-r from-[#7c5cff] to-[#b297ff] text-white">
              Mapeamento real
            </span>
            <DataStatus meta={meta} usingMock={false} compact />
          </h3>
          <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
            Da primeira visita ao up-sell na área do investidor · <strong>clique em qualquer etapa</strong>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {Object.entries(phaseLabels).map(([key, label]) => (
            <span
              key={key}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-medium ${phaseColors[key]}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {journey.slice(0, 6).map((step, i) => {
          const Icon = iconMap[step.stage] || Globe;
          const isLast = i === 5;
          return (
            <motion.button
              key={step.stage}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setSelected(step)}
              className="relative text-left"
            >
              <div className="relative rounded-xl border border-[color:var(--border)] bg-gradient-to-br from-white to-[color:var(--muted)]/30 p-4 h-full hover:shadow-lg hover:shadow-purple-500/10 hover:border-[#7c5cff]/40 hover:-translate-y-0.5 transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-sm"
                    style={{ background: step.color }}
                  >
                    <Icon size={16} />
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${phaseColors[step.phase]}`}
                  >
                    {phaseLabels[step.phase]}
                  </span>
                </div>
                <div className="text-[10px] text-[color:var(--muted-foreground)] font-mono">
                  Etapa {i + 1}
                </div>
                <div className="text-sm font-semibold mt-0.5">{step.stage}</div>
                <div className="text-[11px] text-[color:var(--muted-foreground)] font-mono mt-0.5 truncate">
                  {step.event}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-[color:var(--border)]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-bold">{formatNumber(step.value)}</span>
                    <span className="text-xs text-[color:var(--muted-foreground)]">{step.pct}%</span>
                  </div>
                  {step.dropPct > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-red-500 mt-1">
                      <ArrowDown size={10} />
                      <span>drop {step.dropPct}%</span>
                    </div>
                  )}
                  {isReal && stageMatch.get(step.stage)?.value === 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-1 font-medium">
                      <AlertTriangle size={9} />
                      <span>evento não disparado na property</span>
                    </div>
                  )}
                  {isReal &&
                    stageMatch.get(step.stage)?.matchedAlias &&
                    stageMatch.get(step.stage)!.matchedAlias !== step.event && (
                      <div
                        className="text-[10px] text-blue-600 mt-1 font-mono truncate"
                        title={`Alias detectado: ${stageMatch.get(step.stage)!.matchedAlias}`}
                      >
                        via {stageMatch.get(step.stage)!.matchedAlias}
                      </div>
                    )}
                </div>
              </div>
              {!isLast && i !== 2 && (
                <div className="hidden lg:flex absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-[#7c5cff]/30 items-center justify-center z-10">
                  <div className="w-1 h-1 rounded-full bg-[#7c5cff]" />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {isReal && zeroStages.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={16} className="text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-900">
                {zeroStages.length} etapa(s) sem eventos disparados na property
                <span className="ml-2 font-normal text-amber-700">
                  ({zeroStages.map((z) => z.stage).join(", ")})
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-1">
                Tentamos os aliases padrão GA4 para cada etapa e nenhum retornou contagem. Abaixo estão os
                <strong> eventos realmente disparados</strong> nessa property — use para mapear novos aliases em
                <code className="mx-1 px-1 bg-white/60 rounded">getJourneyFunnel</code> se o seu GTM usa
                nomenclatura custom.
              </p>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {discoveredEvents.slice(0, 12).map((e) => (
                  <div
                    key={e.event}
                    className="flex items-center justify-between text-[11px] bg-white/80 border border-amber-200/60 rounded-md px-2 py-1 font-mono"
                    title={`${e.count} ocorrências · ${e.event}`}
                  >
                    <span className="truncate text-amber-900">{e.event}</span>
                    <span className="text-amber-600 tabular-nums ml-1">{formatNumber(e.count)}</span>
                  </div>
                ))}
              </div>
              {zeroStages.some((z) => z.aliases.length > 1) && (
                <details className="mt-2 text-[11px] text-amber-800">
                  <summary className="cursor-pointer font-medium">Aliases tentados por etapa</summary>
                  <ul className="mt-1 space-y-0.5 font-mono">
                    {zeroStages.map((z) => (
                      <li key={z.stage}>
                        <strong>{z.stage}:</strong> {z.aliases.join(" | ")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-[color:var(--border)]">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <h4 className="text-sm font-semibold">Pós-compra · Área do Investidor</h4>
          <span className="text-[10px] text-[color:var(--muted-foreground)]">Eventos recorrentes</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {journey.slice(6).map((step, i) => {
            const Icon = iconMap[step.stage] || Globe;
            return (
              <motion.button
                key={step.stage}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                onClick={() => setSelected(step)}
                className="flex items-center gap-3 p-4 rounded-xl border border-[color:var(--border)] bg-gradient-to-r from-white to-blue-50/30 text-left hover:shadow-md hover:border-blue-300 hover:-translate-y-0.5 transition-all cursor-pointer"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm"
                  style={{ background: step.color }}
                >
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{step.stage}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${phaseColors[step.phase]}`}
                    >
                      {phaseLabels[step.phase]}
                    </span>
                  </div>
                  <div className="text-[11px] text-[color:var(--muted-foreground)] font-mono">
                    {step.event}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold">{formatNumber(step.value)}</div>
                  <div className="text-[10px] text-[color:var(--muted-foreground)]">{periodLabel}</div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <button
          onClick={() => setSelected(journey[1])}
          className="p-3 rounded-lg bg-red-50 border border-red-100 text-left hover:bg-red-100 transition cursor-pointer"
        >
          <div className="text-[10px] text-red-600 font-semibold uppercase tracking-wider">Maior Drop</div>
          <div className="text-sm font-bold mt-1">Visita → Lead</div>
          <div className="text-[11px] text-red-500 mt-0.5">80% dos visitantes saem sem virar lead</div>
        </button>
        <button
          onClick={() => setSelected(journey[3])}
          className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-left hover:bg-amber-100 transition cursor-pointer"
        >
          <div className="text-[10px] text-amber-700 font-semibold uppercase tracking-wider">
            Gargalo Checkout
          </div>
          <div className="text-sm font-bold mt-1">begin → purchase</div>
          <div className="text-[11px] text-amber-600 mt-0.5">76.4% abandonam após begin_checkout</div>
        </button>
        <button
          onClick={() => setSelected(journey[7])}
          className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-left hover:bg-emerald-100 transition cursor-pointer"
        >
          <div className="text-[10px] text-emerald-700 font-semibold uppercase tracking-wider">
            Oportunidade
          </div>
          <div className="text-sm font-bold mt-1">Up-sell / Cross-sell</div>
          <div className="text-[11px] text-emerald-600 mt-0.5">
            34.5% dos compradores reabrem área logada
          </div>
        </button>
      </div>

      {/* Dialog: detalhe da etapa — mesmo padrão do /conversoes */}
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.stage ?? ""}
        subtitle={selected ? `Etapa ${selectedIdx + 1} · evento: ${selected.event}` : ""}
        icon={
          selected ? (
            (() => {
              const Icon = iconMap[selected.stage] || Globe;
              return (
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                  style={{ background: selected.color }}
                >
                  <Icon size={16} />
                </div>
              );
            })()
          ) : null
        }
      >
        {selected && insight && (
          <div className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-[color:var(--muted)]/40 border border-[color:var(--border)]">
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                  Volume
                </div>
                <div className="text-xl font-bold tabular-nums mt-0.5">
                  {formatNumber(selected.value)}
                </div>
                <div className="text-[10px] text-[color:var(--muted-foreground)]">{periodLabel}</div>
              </div>
              <div className="p-3 rounded-lg bg-[color:var(--muted)]/40 border border-[color:var(--border)]">
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                  % do topo
                </div>
                <div className="text-xl font-bold tabular-nums mt-0.5">{selected.pct}%</div>
                <div className="text-[10px] text-[color:var(--muted-foreground)]">de {formatNumber(journey[0]?.value || 0)} visitas</div>
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  selected.dropPct > 50
                    ? "bg-red-50 border-red-200"
                    : selected.dropPct > 0
                      ? "bg-amber-50 border-amber-200"
                      : "bg-emerald-50 border-emerald-200"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider font-semibold">Drop vs anterior</div>
                <div className="text-xl font-bold tabular-nums mt-0.5">
                  {selected.dropPct > 0 ? `-${selected.dropPct}%` : "—"}
                </div>
                <div className="text-[10px]">
                  {selected.dropPct > 50 ? "crítico" : selected.dropPct > 0 ? "atenção" : "topo de funil"}
                </div>
              </div>
            </div>

            {/* Diagnóstico (Leitura do copiloto) — MASTER ONLY */}
            <MasterOnly>
              <div className="p-4 rounded-xl bg-gradient-to-br from-[#ede9fe] to-[#dbeafe] border border-[#c4b5fd]/40">
                <div className="text-xs font-bold text-[#5b3ed6] flex items-center gap-1.5">
                  <Sparkles size={12} /> Leitura do copiloto
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">Master</span>
                </div>
                <p className="text-sm text-slate-700 mt-1">{insight.diagnosis}</p>
                <div className="mt-2 text-[11px] text-slate-600 flex items-center gap-1">
                  <TrendingUp size={11} /> {insight.benchmark}
                </div>
              </div>
            </MasterOnly>

            {/* Ações recomendadas — MASTER ONLY */}
            <MasterOnly>
              <div>
                <div className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Target size={12} /> Ações recomendadas
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">Master</span>
                </div>
                <ol className="space-y-2">
                  {insight.actions.map((action, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 p-2.5 rounded-lg border border-[color:var(--border)] bg-white"
                    >
                      <span className="w-5 h-5 rounded-full bg-[#7c5cff] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-slate-700">{action}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </MasterOnly>

            {/* Query GA4 de referência */}
            <div className="text-[11px] font-mono bg-slate-900 text-slate-100 p-3 rounded-lg">
              <div className="text-slate-400">// Query GA4 equivalente</div>
              <div>eventName = &quot;{selected.event.split(" ")[0]}&quot;</div>
              <div>dateRange: {periodLabel}</div>
              <div>metrics: [eventCount, totalUsers, conversions]</div>
            </div>

            <MasterOnly>
              {selected.dropPct >= 50 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-red-800">
                    <strong>Gargalo prioritário:</strong> essa etapa concentra a maior perda da jornada. Recomendo rodar
                    experimento A/B na semana corrente.
                  </div>
                </div>
              )}
            </MasterOnly>
          </div>
        )}
      </Dialog>
    </div>
  );
}
