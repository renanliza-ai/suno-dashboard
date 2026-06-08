"use client";

import { Dialog } from "@/components/dialog";
import { X } from "lucide-react";
import type { Proposal } from "@/lib/cro-types";

/**
 * Modal de detalhes expandidos de uma proposta.
 *
 * Mostra: dados completos, sinais detalhados (todos), benchmarks,
 * hipótese completa, ação sugerida formatada, + actions de aceitar/descartar.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (6.4)
 */

export function ProposalDetailsModal({
  proposal,
  open,
  onClose,
  onAccept,
  onDismiss,
  isAccepting,
  isDismissing,
}: {
  proposal: Proposal | null;
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  isAccepting?: boolean;
  isDismissing?: boolean;
}) {
  if (!proposal) return null;

  const priorityColor = {
    critico: "bg-rose-100 text-rose-700",
    atencao: "bg-amber-100 text-amber-700",
    otimizacao: "bg-emerald-100 text-emerald-700",
  }[proposal.priority];

  return (
    <Dialog open={open} onClose={onClose} title={proposal.titulo} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* LP info */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="font-mono px-2 py-1 rounded bg-slate-100 text-slate-700">
            {proposal.lp.host}
          </span>
          <span className="font-mono font-bold text-slate-900">{proposal.lp.path}</span>
          <span
            className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${priorityColor}`}
          >
            {proposal.priority}
          </span>
        </div>

        {/* Hipótese */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Hipótese
          </h4>
          <div className="text-sm text-slate-800 whitespace-pre-wrap">{proposal.hipotese}</div>
        </div>

        {/* Ação sugerida */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Ação sugerida
          </h4>
          <div className="text-sm text-slate-800 whitespace-pre-wrap">{proposal.acaoSugerida}</div>
        </div>

        {/* Sinais detalhados (todos) */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Sinais detectados
          </h4>
          <ul className="text-xs text-slate-700 space-y-1">
            {proposal.sinaisDetalhados.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-slate-400 mt-0.5">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Benchmarks */}
        {proposal.benchmarks.length > 0 && (
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Benchmarks
            </h4>
            <ul className="text-xs text-slate-700 space-y-1">
              {proposal.benchmarks.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">→</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Impacto + Effort */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-500">Impacto estimado</div>
            <div className="text-sm font-bold text-emerald-700">{proposal.impactoEstimado}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-500">Effort</div>
            <div className="text-sm font-bold text-slate-700">{proposal.effort}</div>
          </div>
        </div>

        {/* Actions (só se não tratada) */}
        {proposal.status !== "accepted" && proposal.status !== "dismissed" && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={onAccept}
              disabled={isAccepting || isDismissing}
              className="flex-1 px-4 py-2 rounded-lg bg-[#7c5cff] hover:bg-[#6b4dff] text-white text-sm font-bold transition disabled:opacity-50"
            >
              {isAccepting ? "Criando task no Monday..." : "✓ Aceitar e criar task"}
            </button>
            <button
              onClick={onDismiss}
              disabled={isAccepting || isDismissing}
              className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition disabled:opacity-50"
            >
              {isDismissing ? "Descartando..." : "Descartar"}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
              title="Fechar"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Quando já tratada — só mostra info */}
        {proposal.status === "accepted" && proposal.mondayUrl && (
          <div className="pt-2 border-t border-slate-100 text-center">
            <a
              href={proposal.mondayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[#7c5cff] font-semibold hover:underline"
            >
              Abrir task no Monday →
            </a>
          </div>
        )}
      </div>
    </Dialog>
  );
}
