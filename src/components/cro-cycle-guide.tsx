"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Lightbulb, ListOrdered, FlaskConical, BarChart3, GraduationCap,
  ChevronDown, RefreshCw, CheckCircle2, Clock,
} from "lucide-react";

/**
 * Guia visual do Ciclo de CRO — 6 etapas da metodologia padrão de mercado
 * (análise → hipótese → priorização → experimentação → resultados →
 * aprendizado), cada uma mapeada pra ONDE ela vive neste painel.
 *
 * Nível 1 (educativo): só visual, sem state machine. As etapas 5-6 são
 * marcadas honestamente como "em breve" — o fechamento do loop (registrar
 * resultado do teste + documentar aprendizado) é o Nível 2 do roadmap.
 *
 * Colapsável e fechado por padrão pra não roubar espaço de quem já conhece.
 */

type CycleStep = {
  n: number;
  title: string;
  desc: string;
  whereInPanel: string;
  status: "ativo" | "parcial" | "em-breve";
  icon: typeof Search;
};

const STEPS: CycleStep[] = [
  {
    n: 1,
    title: "Análise e diagnóstico",
    desc: "Dados quantitativos e qualitativos pra achar fricções e oportunidades.",
    whereInPanel: "Motor de 11 heurísticas + CRO Engine (ICE/PXL/LIFT/MECLABS) rodando sobre o GA4 real da property.",
    status: "ativo",
    icon: Search,
  },
  {
    n: 2,
    title: "Hipótese",
    desc: "Se mudarmos [X] de [A] para [B], então [impacto esperado].",
    whereInPanel: "Toda proposta CRO nasce com hipótese estruturada — veja o campo \"Hipótese\" em cada card.",
    status: "ativo",
    icon: Lightbulb,
  },
  {
    n: 3,
    title: "Priorização",
    desc: "Impacto × esforço × confiança decidem o que testar primeiro.",
    whereInPanel: "Badges Crítico/Atenção/Otimização + impacto estimado + effort em cada proposta, ordenadas automaticamente.",
    status: "ativo",
    icon: ListOrdered,
  },
  {
    n: 4,
    title: "Experimentação",
    desc: "Executar o teste: A/B, multivariado ou teste de UX.",
    whereInPanel: "\"Aceitar → Monday\" cria a task do teste com hipótese, dados e link da página — o time executa.",
    status: "parcial",
    icon: FlaskConical,
  },
  {
    n: 5,
    title: "Análise de resultados",
    desc: "O teste ganhou, perdeu ou foi inconclusivo? Com significância?",
    whereInPanel: "Em breve (Nível 2): registrar resultado do teste direto na proposta aceita.",
    status: "em-breve",
    icon: BarChart3,
  },
  {
    n: 6,
    title: "Aprendizado e escala",
    desc: "Documentar o que funcionou e replicar nas próximas hipóteses.",
    whereInPanel: "Em breve (Nível 2): seção de Aprendizados por property — a memória institucional de CRO da Suno.",
    status: "em-breve",
    icon: GraduationCap,
  },
];

const STATUS_BADGE = {
  ativo: { label: "Ativo no painel", cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  parcial: { label: "Parcial", cls: "bg-amber-100 text-amber-700", icon: Clock },
  "em-breve": { label: "Em breve", cls: "bg-slate-100 text-slate-500", icon: Clock },
} as const;

export function CROCycleGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      {/* Header clicável */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-4 flex items-center gap-3 hover:bg-slate-50/60 transition text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white flex items-center justify-center shrink-0">
          <RefreshCw size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Ciclo de CRO — como este painel trabalha</h2>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            6 etapas da metodologia: da análise ao aprendizado contínuo. Clique pra ver onde cada uma vive aqui.
          </p>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-slate-400 shrink-0">
          <ChevronDown size={18} />
        </motion.span>
      </button>

      {/* Conteúdo expandido */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 pt-2">
              {/* Grid das 6 etapas — 3 col desktop, 2 tablet, 1 mobile */}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {STEPS.map((s) => {
                  const badge = STATUS_BADGE[s.status];
                  const BadgeIcon = badge.icon;
                  const StepIcon = s.icon;
                  return (
                    <div
                      key={s.n}
                      className={`rounded-xl border p-4 ${
                        s.status === "em-breve"
                          ? "border-slate-100 bg-slate-50/40"
                          : "border-violet-100 bg-gradient-to-br from-violet-50/60 to-white"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                          {s.n}
                        </span>
                        <StepIcon size={15} className="text-violet-600 shrink-0" />
                        <h3 className="text-xs font-bold text-slate-900 flex-1">{s.title}</h3>
                      </div>
                      <p className="text-[11px] text-slate-600 mb-2 leading-relaxed">{s.desc}</p>
                      <div className="text-[11px] text-slate-700 bg-white/70 rounded-lg p-2 border border-slate-100 mb-2 leading-relaxed">
                        <span className="font-semibold text-violet-700">Neste painel: </span>
                        {s.whereInPanel}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}
                      >
                        <BadgeIcon size={10} />
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-[color:var(--muted-foreground)] mt-4 flex items-start gap-1.5">
                <RefreshCw size={12} className="shrink-0 mt-0.5" />
                <span>
                  CRO não é mudar por mudar — é aprender continuamente o que gera valor. O ciclo recomeça
                  a cada aprendizado: princípio central é decidir por <strong>dados</strong>, não por achismo.
                </span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
