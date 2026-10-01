"use client";

import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { ContratoDeDados } from "@/lib/ga4-context";

/**
 * SELO DO CONTRATO DE DADOS.
 *
 * Mostra, na própria tela, se a resposta que está sendo exibida passou nas
 * invariantes. Existe porque o defeito mais caro deste painel nunca foi o
 * número errado sozinho: foi o número errado com cara de certo, que ninguém
 * tinha como contestar olhando a tela.
 *
 * ⚠️ Quando passa, o selo é DISCRETO de propósito. Um banner verde grande em
 * toda tela vira ruído e some da percepção em uma semana, e aí o dia em que
 * ficar vermelho também passa batido.
 */
export function SeloContrato({ contrato }: { contrato?: ContratoDeDados | null }) {
  if (!contrato) return null;

  const quebras = contrato.achados.filter((a) => a.severidade === "quebra");
  const alertas = contrato.achados.filter((a) => a.severidade === "alerta");

  if (quebras.length === 0 && alertas.length === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
        <CheckCircle2 size={12} />
        <span>
          Contrato de dados: {contrato.achados.length === 0 ? "aprovado" : "aprovado"} ·{" "}
          {contrato.unidadeDeLead === "pessoas" ? "leads em pessoas" : "ver unidade"}
        </span>
      </div>
    );
  }

  const grave = quebras.length > 0;

  return (
    <div
      className={`rounded-2xl border p-4 mb-3 ${
        grave ? "border-rose-300 bg-rose-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex items-start gap-3">
        {grave ? (
          <ShieldAlert size={18} className="text-rose-600 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`font-semibold text-sm mb-1 ${grave ? "text-rose-900" : "text-amber-900"}`}>
            {grave
              ? `Contrato de dados REPROVADO: ${quebras.length} quebra${quebras.length === 1 ? "" : "s"}${alertas.length ? ` e ${alertas.length} alerta${alertas.length === 1 ? "" : "s"}` : ""}`
              : `Contrato de dados com ${alertas.length} alerta${alertas.length === 1 ? "" : "s"}`}
          </p>
          <p className={`text-xs mb-2 ${grave ? "text-rose-900" : "text-amber-900"}`}>
            {grave
              ? "Os números abaixo podem estar incompletos ou contados em dobro. Isto é defeito para corrigir, não ressalva para ignorar."
              : "Os números abaixo estão íntegros, mas há algo que afasta esta tela de outra do painel ou do CRM."}
          </p>
          <ul className="space-y-2">
            {[...quebras, ...alertas].map((a) => (
              <li
                key={a.id}
                className={`text-xs rounded-lg px-2.5 py-2 border ${
                  a.severidade === "quebra"
                    ? "bg-white/70 border-rose-200 text-rose-900"
                    : "bg-white/70 border-amber-200 text-amber-900"
                }`}
              >
                <b>{a.titulo}</b>
                <br />
                <span className="opacity-90">{a.evidencia}</span>
                <br />
                <span className="opacity-75 italic">Como corrigir: {a.comoCorrigir}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
