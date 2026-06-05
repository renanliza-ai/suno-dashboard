// src/lib/cro-impact.ts

/**
 * Cálculo de impacto estimado de propostas CRO.
 *
 * Funções puras, sem efeitos colaterais. Cada uma retorna texto formatado
 * pronto pra exibição na proposta.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (4.3)
 */

import { LPData } from "./cro-types";

/**
 * Calcula impacto de fechar gap de conversão até a mediana do host.
 *
 * Fórmula:
 *   impacto_pp = (hostMedian - leadConvRate) * 100
 *   leads_extras_mes = (impacto_pp/100) * (sessions / rangeDays) * 30
 *
 * Retorna texto pronto pra exibição.
 *
 * @example
 *   impactoFechaGapMediana({ leadConvRate: 0.012, sessions: 4200, ... }, 0.048, 7)
 *   // "+3.6pp conv (~648 leads/mês)"
 */
export function impactoFechaGapMediana(
  lp: LPData,
  hostMedian: number,
  rangeDays: number
): string {
  const gapPP = (hostMedian - lp.leadConvRate) * 100;
  if (gapPP <= 0) return "—";
  const sessionsPerDay = lp.sessions / rangeDays;
  const leadsExtrasMes = Math.round((gapPP / 100) * sessionsPerDay * 30);
  return `+${gapPP.toFixed(1)}pp conv (~${leadsExtrasMes.toLocaleString("pt-BR")} leads/mês)`;
}

/**
 * Impacto qualitativo para regras que não traduzem em pp conv direto
 * (bounce, tempo, engajamento).
 *
 * @example
 *   impactoQualitativo("alto") // "Alto potencial de melhoria"
 */
export function impactoQualitativo(nivel: "alto" | "moderado" | "baixo"): string {
  const map = {
    alto: "Alto potencial de melhoria",
    moderado: "Potencial moderado",
    baixo: "Otimização menor",
  };
  return map[nivel];
}

/**
 * Impacto pra regras de canal mismatch — quantifica perda da fonte top.
 */
export function impactoChannelMismatch(
  topSourceConv: number,
  benchmarkConv: number,
  topSourceSessions: number,
  rangeDays: number
): string {
  const gapPP = (benchmarkConv - topSourceConv) * 100;
  const sessionsPerDay = topSourceSessions / rangeDays;
  const leadsExtras = Math.round((gapPP / 100) * sessionsPerDay * 30);
  return `Origem top perdendo ${gapPP.toFixed(1)}pp vs outras — ~${leadsExtras.toLocaleString("pt-BR")} leads/mês potenciais`;
}
