"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { sunoJourney } from "@/lib/data";
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
import { DataStatus } from "@/components/data-status";
import { MasterOnly } from "@/components/master-only";

type JourneyStep = (typeof sunoJourney)[number];

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

// Diagnóstico contextual por etapa (o que olhar, onde melhorar)
const stageInsights: Record<string, { diagnosis: string; actions: string[]; benchmark: string }> = {
  "Visita ao Site": {
    diagnosis:
      "Topo do funil saudável — ~471k sessões/mês. Foco: qualificação do tráfego via canais Suno customizados.",
    actions: [
      "Audite canais de baixa conv (TikTok, YouTube orgânico) em /relatorios",
      "Valide taxonomia UTM em /tracking → aba UTM",
      "Revise LPs com bounce > 60% em /cro",
    ],
    benchmark: "Benchmark fintech: 15–25% viram lead em 30d",
  },
  "Lead Capturado": {
    diagnosis:
      "Drop de 80% é o MAIOR gargalo da jornada. Só 1 em 5 visitantes deixa e-mail — geralmente LP com fricção ou oferta genérica.",
    actions: [
      "Teste A/B de copy da LP Premium-30 (nossa principal)",
      "Reduza campos do form (hoje pede CPF + telefone — remover telefone)",
      "Adicione lead magnet (ebook dividendos, planilha FIIs)",
    ],
    benchmark: "Fintech top-quartil: 30–40% visita→lead",
  },
  "Conta Criada": {
    diagnosis:
      "45% dos leads criam conta — acima da média. Fluxo de ativação está ok, mas 55% de drop ainda é dinheiro na mesa.",
    actions: [
      "Email de ativação automático em até 30min pós-lead",
      "Pré-preencher form de signup com dados do lead",
      "Fluxo de onboarding Suno Free para capturar conta antes da compra",
    ],
    benchmark: "SaaS financeiro: 50–60% lead→conta",
  },
  "Início Checkout": {
    diagnosis:
      "36% das contas novas iniciam checkout em até 7d. Momento-chave: aqui o lead decide se vira cliente.",
    actions: [
      "Retargeting Meta para quem criou conta e não clicou em 'Assinar'",
      "Email sequence com depoimentos dos 3 primeiros dias",
      "Oferta limitada (7 dias) com desconto para nova conta",
    ],
    benchmark: "E-commerce SaaS: 25–35% conta→begin_checkout",
  },
  "Dados de Pagamento": {
    diagnosis:
      "43% de drop entre begin_checkout e add_payment_info. Ponto de fricção no form de pagamento (CPF, cartão, Pix).",
    actions: [
      "Oferecer Pix + cartão lado a lado (não em sub-páginas)",
      "Validar cartão inline antes do submit",
      "Revisar tempo de carregamento da etapa (LCP > 2.5s?)",
    ],
    benchmark: "Top-quartil BR: 70–75% avançam para purchase",
  },
  "Compra Concluída": {
    diagnosis:
      "59% dos que preencheram dados finalizam. Ainda há espaço para reduzir abandono no pagamento (Pix recusado, 3DS).",
    actions: [
      "Revisar taxa de aprovação da adquirente (hoje ~91%)",
      "Implementar recuperação 1-click de carrinho abandonado",
      "Mostrar garantia + suporte 24h no step de pagamento",
    ],
    benchmark: "Top-quartil: 75–80% shipping→purchase",
  },
  "Área do Investidor": {
    diagnosis:
      "183k logins/mês — retenção sólida. Engajamento pós-compra é o principal sinal de LTV futuro.",
    actions: [
      "Segmentar usuários que NÃO logaram em 14d (risco de churn)",
      "Notificar relatórios novos via app push",
      "Experimentar dashboard personalizado por tipo de carteira",
    ],
    benchmark: "Target Suno: 70%+ dos clientes logam mensalmente",
  },
  "Up-sell / Cross-sell": {
    diagnosis:
      "1.2k compras recorrentes/30d. Expansão é onde está a maior margem — clientes ativos custam 5x menos para vender.",
    actions: [
      "Campanha de upgrade para Premium-Plus com 20% desc",
      "Cross-sell de carteiras temáticas (dividendos, FIIs, cripto)",
      "Indicação premiada: R$ 50 de crédito por amigo",
    ],
    benchmark: "Top-quartil SaaS: 15–25% ARR expansion",
  },
};

// Mapa: stage da jornada → nome do evento GA4 equivalente (para puxar valor real)
const stageToEvent: Record<string, string> = {
  "Visita ao Site": "session_start",
  "Lead Capturado": "generate_lead",
  "Conta Criada": "sign_up",
  "Início Checkout": "begin_checkout",
  "Dados de Pagamento": "add_payment_info",
  "Compra Concluída": "purchase",
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

  // Se temos funnel real do GA4, recalcula valores; senão usa mock
  const realFunnel = ga4Conv?.funnel;
  const stageMatch = new Map<
    string,
    { matchedAlias: string | null; aliasesTried: string[]; value: number }
  >();
  const journey: JourneyStep[] = useRealData && realFunnel
    ? sunoJourney.map((step) => {
        const evName = stageToEvent[step.stage];
        const real = realFunnel.steps.find((s) => s.event === evName);
        if (!real) return step;
        stageMatch.set(step.stage, {
          matchedAlias: real.matchedAlias ?? null,
          aliasesTried: real.aliasesTried ?? [evName],
          value: real.value,
        });
        return {
          ...step,
          value: real.value,
          pct: real.pct,
          dropPct: real.dropPct,
        };
      })
    : sunoJourney;

  const isReal = Boolean(useRealData && realFunnel);
  // Stages que esperávamos medir mas vieram zerados (no modo real)
  const zeroStages = isReal
    ? sunoJourney
        .slice(0, 6)
        .filter((s) => {
          const m = stageMatch.get(s.stage);
          return m && m.value === 0;
        })
        .map((s) => ({ stage: s.stage, aliases: stageMatch.get(s.stage)!.aliasesTried }))
    : [];
  const discoveredEvents = realFunnel?.discoveredEvents || [];
  const selectedIdx = selected ? journey.findIndex((s) => s.stage === selected.stage) : -1;
  const insight = selected ? stageInsights[selected.stage] : null;

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            Jornada do Usuário Suno
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-[#7c5cff] to-[#b297ff] text-white uppercase tracking-wider">
              Mapeamento real
            </span>
            <DataStatus meta={meta} usingMock={!useRealData} compact />
            {isReal && null}
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
