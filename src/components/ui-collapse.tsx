"use client";

import { useState } from "react";
import { Plus, Minus, Download } from "lucide-react";

/**
 * Blocos de leitura recolhíveis e paginação por "mostrar mais".
 *
 * Pedido do Renan em 08/09/2026: as abas novas ganharam muita ressalva escrita,
 * o que é correto (o número precisa vir com a limitação junto), mas empurrava a
 * tabela para baixo da dobra. A solução não é apagar a ressalva, é recolher:
 * resumo sempre visível, texto completo a um clique.
 */

export function CollapsibleNote({
  title,
  summary,
  children,
  tone = "neutro",
  defaultOpen = false,
  badge,
}: {
  title: string;
  /** Uma linha, sempre visível. É o que a pessoa lê sem clicar. */
  summary: string;
  children: React.ReactNode;
  tone?: "neutro" | "alerta" | "bloqueio";
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const toneCls = {
    neutro: "border-[color:var(--border)] bg-white",
    alerta: "border-amber-200 bg-amber-50",
    bloqueio: "border-red-200 bg-red-50",
  }[tone];

  const titleCls = {
    neutro: "text-[color:var(--foreground)]",
    alerta: "text-amber-900",
    bloqueio: "text-red-900",
  }[tone];

  const summaryCls = {
    neutro: "text-[color:var(--muted-foreground)]",
    alerta: "text-amber-800",
    bloqueio: "text-red-800",
  }[tone];

  return (
    <div className={`rounded-2xl border ${toneCls} mb-4 overflow-hidden`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2.5 p-3.5 text-left hover:bg-black/[0.02] transition"
        aria-expanded={open}
      >
        <span
          className={`shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${
            tone === "bloqueio"
              ? "border-red-300 text-red-700"
              : tone === "alerta"
                ? "border-amber-300 text-amber-700"
                : "border-[color:var(--border)] text-[#7c5cff]"
          }`}
        >
          {open ? <Minus size={12} /> : <Plus size={12} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${titleCls}`}>
            {title}
            {badge && (
              <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/5 align-middle">
                {badge}
              </span>
            )}
          </span>
          {!open && <span className={`block text-xs mt-0.5 ${summaryCls} line-clamp-2`}>{summary}</span>}
        </span>
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-0">{children}</div>}
    </div>
  );
}

/**
 * Rodapé de tabela: mostra N por vez, expande em passos e permite ver tudo.
 * Nunca esconde o total: o texto sempre diz quantas linhas existem.
 */
export function ShowMore({
  shown,
  total,
  step = 10,
  onShowMore,
  onShowAll,
  onReset,
}: {
  shown: number;
  total: number;
  step?: number;
  onShowMore: () => void;
  onShowAll: () => void;
  onReset: () => void;
}) {
  if (total === 0) return null;
  const restante = total - shown;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-3 border-t border-[color:var(--border)] bg-[color:var(--muted)]/30">
      <span className="text-xs text-[color:var(--muted-foreground)]">
        Mostrando <b>{shown}</b> de <b>{total}</b>
      </span>
      {restante > 0 && (
        <>
          <button
            onClick={onShowMore}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[color:var(--border)] bg-white hover:border-[#7c5cff] hover:text-[#7c5cff] transition"
          >
            <Plus size={12} /> mais {Math.min(step, restante)}
          </button>
          <button
            onClick={onShowAll}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-[#7c5cff] hover:bg-[#ede9fe] transition"
          >
            ver todas ({total})
          </button>
        </>
      )}
      {restante <= 0 && total > step && (
        <button
          onClick={onReset}
          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] transition"
        >
          recolher
        </button>
      )}
    </div>
  );
}

/**
 * Exporta linhas para CSV e dispara o download no navegador.
 *
 * Separador ";" e BOM UTF-8 porque o destino é Excel em pt-BR: com vírgula o
 * Excel joga tudo numa coluna só, e sem BOM ele come os acentos.
 * Número sai com vírgula decimal pelo mesmo motivo.
 */
export function baixarCsv(nomeArquivo: string, colunas: string[], linhas: (string | number | null)[][]) {
  const esc = (v: string | number | null): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [colunas.join(";"), ...linhas.map((l) => l.map(esc).join(";"))].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BotaoExportar({ onClick, label = "Exportar CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-xl border border-[color:var(--border)] bg-white hover:border-[#7c5cff] hover:text-[#7c5cff] transition whitespace-nowrap"
      title="Baixa a lista COMPLETA já filtrada, não só as linhas visíveis"
    >
      <Download size={13} /> {label}
    </button>
  );
}
