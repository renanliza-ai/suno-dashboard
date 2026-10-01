"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ContratoDeDados } from "@/lib/ga4-context";

/**
 * SELO DO CONTRATO DE DADOS.
 *
 * Diz, numa linha, se a resposta que está na tela passou nas invariantes.
 *
 * ⚠️ FOI UM PAINEL VERMELHO DE PAREDE, E ESTAVA ERRADO. Em 01/10/2026 a
 * primeira versão abria um bloco com quatro achados, cada um com evidência e
 * instrução de correção, no topo da aba de Landing Pages. O Renan viu e disse,
 * com razão: "não podemos exibir essas mensagens".
 *
 * O raciocínio por trás da correção, para não voltar atrás sem querer:
 *
 *   Quem abre esta tela está procurando INSIGHT DE NEGÓCIO, não relatório de
 *   manutenção do painel. Falha de contrato é recado para quem MANTÉM o
 *   painel, e esse caminho já existe e é melhor: o cron diário abre tarefa no
 *   Monday com a evidência inteira.
 *
 *   Esconder por completo também seria errado, porque quando a resposta está
 *   mesmo incompleta o número na tela não vale o que aparenta valer. Então o
 *   sinal fica, em UMA linha, recolhido. Quem quiser o detalhe abre.
 *
 * Resumindo a regra: o contrato GRITA no Monday e SUSSURRA na tela.
 */
export function SeloContrato({ contrato }: { contrato?: ContratoDeDados | null }) {
  if (!contrato) return null;

  const quebras = contrato.achados.filter((a) => a.severidade === "quebra");
  const alertas = contrato.achados.filter((a) => a.severidade === "alerta");
  const total = quebras.length + alertas.length;

  if (total === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
        <CheckCircle2 size={12} />
        <span>
          Contrato de dados: aprovado
          {contrato.unidadeDeLead === "pessoas" && " · leads em pessoas"}
        </span>
      </div>
    );
  }

  const grave = quebras.length > 0;

  return (
    <details className="group inline-block align-top">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${
          grave
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        <AlertTriangle size={12} />
        <span>
          Contrato de dados: {total} {total === 1 ? "pendência" : "pendências"}
          {grave && " · os números podem estar incompletos"}
        </span>
        <span className="opacity-50 group-open:hidden">· ver</span>
        <span className="hidden opacity-50 group-open:inline">· ocultar</span>
      </summary>

      {/* O detalhe só existe depois do clique. É material de manutenção: quem
          abriu a tela para analisar negócio não precisa esbarrar nele. */}
      <div className="mt-2 max-w-3xl space-y-2">
        {[...quebras, ...alertas].map((a) => (
          <div
            key={a.id}
            className={`rounded-lg border px-2.5 py-2 text-xs ${
              a.severidade === "quebra"
                ? "border-rose-200 bg-rose-50/60 text-rose-900"
                : "border-amber-200 bg-amber-50/60 text-amber-900"
            }`}
          >
            <b>{a.titulo}</b>
            <br />
            <span className="opacity-90">{a.evidencia}</span>
            <br />
            <span className="italic opacity-75">Como corrigir: {a.comoCorrigir}</span>
          </div>
        ))}
        <p className="text-[11px] text-[color:var(--muted-foreground)]">
          Esta verificação roda sozinha todo dia e abre tarefa quando reprova. Não é preciso
          acompanhar por aqui.
        </p>
      </div>
    </details>
  );
}
