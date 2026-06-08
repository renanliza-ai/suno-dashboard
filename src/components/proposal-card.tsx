"use client";

import { motion } from "framer-motion";
import { AlertCircle, AlertTriangle, Sparkles, CheckCircle2, X, FileText, ExternalLink } from "lucide-react";
import type { Proposal } from "@/lib/cro-types";

/**
 * Card individual de uma proposta CRO.
 *
 * Renderiza priority badge + LP + hipótese + ação + impacto + 3 botões:
 * Aceitar (cria task Monday), Descartar (só persiste), Ver Detalhes (abre modal).
 *
 * Não faz chamadas — recebe handlers via props. Stateless puro.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (6.2, 6.3)
 */

export function ProposalCard({
  proposal,
  isAccepting,
  isDismissing,
  onAccept,
  onDismiss,
  onOpenDetails,
}: {
  proposal: Proposal;
  isAccepting?: boolean;
  isDismissing?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onOpenDetails: () => void;
}) {
  const priorityStyle = {
    critico: {
      border: "border-rose-300",
      bg: "bg-gradient-to-br from-rose-50 to-white",
      badge: "bg-rose-100 text-rose-800 border-rose-300",
      icon: <AlertCircle size={14} className="text-rose-600" />,
      label: "CRÍTICO",
    },
    atencao: {
      border: "border-amber-300",
      bg: "bg-gradient-to-br from-amber-50 to-white",
      badge: "bg-amber-100 text-amber-800 border-amber-300",
      icon: <AlertTriangle size={14} className="text-amber-600" />,
      label: "ATENÇÃO",
    },
    otimizacao: {
      border: "border-emerald-300",
      bg: "bg-gradient-to-br from-emerald-50 to-white",
      badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
      icon: <Sparkles size={14} className="text-emerald-600" />,
      label: "OTIMIZAÇÃO",
    },
  }[proposal.priority];

  // Renderização de estado já tratado — compacto pra ocupar pouco espaço
  if (proposal.status === "accepted") {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 opacity-70">
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <CheckCircle2 size={14} className="text-emerald-500" />
          <span className="font-semibold">Aceita</span>
          <span>·</span>
          <span className="font-mono">{proposal.lp.path}</span>
          <span>·</span>
          <span className="truncate">{proposal.titulo}</span>
          {proposal.mondayUrl && (
            <a
              href={proposal.mondayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[#7c5cff] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Ver no Monday <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    );
  }

  if (proposal.status === "dismissed") {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-3 opacity-40 hover:opacity-60 transition">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <X size={12} />
          <span className="font-mono">{proposal.lp.path}</span>
          <span>·</span>
          <span className="truncate">{proposal.titulo}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border-2 ${priorityStyle.border} ${priorityStyle.bg} p-4 hover:shadow-md transition flex flex-col`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${priorityStyle.badge}`}
        >
          {priorityStyle.icon}
          {priorityStyle.label}
        </span>
        <span className="font-mono text-sm font-semibold text-slate-900 truncate">{proposal.lp.path}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
          {proposal.lp.host}
        </span>
      </div>

      {/* Título */}
      <h3 className="text-sm font-bold text-slate-900 mb-2">{proposal.titulo}</h3>

      {/* Hipótese (truncada) */}
      <div className="text-xs text-slate-700 mb-3 line-clamp-2">
        {proposal.hipotese.replace(/[*`]/g, "")}
      </div>

      {/* Sinais (até 2) */}
      {proposal.sinaisDetalhados.length > 0 && (
        <ul className="text-[11px] text-slate-600 mb-3 space-y-0.5">
          {proposal.sinaisDetalhados.slice(0, 2).map((s, i) => (
            <li key={i} className="flex items-start gap-1">
              <span className="text-slate-400 mt-0.5">•</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Impacto + Effort */}
      <div className="flex items-center gap-3 text-[11px] font-semibold mb-3 flex-wrap mt-auto">
        <span className="text-emerald-700">📊 {proposal.impactoEstimado}</span>
        <span className="text-slate-500">⏱ {proposal.effort}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          disabled={isAccepting || isDismissing}
          className="flex-1 px-3 py-1.5 rounded-lg bg-[#7c5cff] hover:bg-[#6b4dff] text-white text-xs font-bold transition disabled:opacity-50"
        >
          {isAccepting ? "Criando..." : "✓ Aceitar → Monday"}
        </button>
        <button
          onClick={onDismiss}
          disabled={isAccepting || isDismissing}
          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition disabled:opacity-50"
        >
          {isDismissing ? "..." : "✕"}
        </button>
        <button
          onClick={onOpenDetails}
          className="px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
          title="Ver detalhes"
        >
          <FileText size={13} />
        </button>
      </div>
    </motion.div>
  );
}
