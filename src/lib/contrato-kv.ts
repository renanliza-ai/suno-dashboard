import { kv } from "@vercel/kv";
import type { Assinatura } from "./contrato-ga4";

/**
 * BASELINE DO CONTRATO: a memória que impede o retrocesso.
 *
 * Guarda a assinatura de cada aba, por property e por MÊS FECHADO. Setembro de
 * 2026 tem o número que tem; se a leitura de amanhã para setembro for outra,
 * não foi o GA4 que mudou, foi o painel.
 *
 * Schema da chave:
 *   contrato:baseline:{propertyId}:{aba}:{periodo}
 *
 * Sem TTL de propósito. O valor DESTE registro é justamente ele ser velho: um
 * baseline que expira em 30 dias não pega a regressão que aconteceu no mês
 * passado, que é exatamente o caso de uso ("no próximo mês, no outro mês, e
 * assim sucessivamente").
 */

export type Baseline = Assinatura & {
  /** ISO de quando foi gravado pela primeira vez. Nunca é reescrito. */
  gravadoEm: string;
  /** Rótulo humano do período, ex. "09/2026". */
  periodo: string;
  /** Quantas vezes a verificação confirmou este baseline sem divergência. */
  confirmacoes: number;
  /** ISO da última confirmação. */
  conferidoEm: string;
};

function chave(propertyId: string, aba: string, periodo: string): string {
  const pid = propertyId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ab = aba.replace(/[^a-zA-Z0-9_-]/g, "_");
  const per = periodo.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `contrato:baseline:${pid}:${ab}:${per}`;
}

export async function lerBaseline(
  propertyId: string,
  aba: string,
  periodo: string
): Promise<Baseline | null> {
  try {
    return (await kv.get<Baseline>(chave(propertyId, aba, periodo))) ?? null;
  } catch (e) {
    console.error("[contrato-kv] lerBaseline falhou:", e);
    return null;
  }
}

/**
 * Grava o baseline na PRIMEIRA vez e nunca mais sobrescreve os números.
 *
 * ⚠️ Esta é a decisão que faz o mecanismo funcionar. Se cada execução
 * reescrevesse o baseline com o valor de hoje, uma queda seria absorvida
 * silenciosamente no dia seguinte e o alarme nunca dispararia: o painel
 * "esqueceria" o número certo. Então a gravação só acontece uma vez, e dali em
 * diante só se atualiza o contador de confirmação.
 *
 * Para corrigir um baseline gravado errado existe `regravarBaseline`, que é
 * explícito e deixa rastro.
 */
export async function gravarBaselineSeNovo(
  propertyId: string,
  aba: string,
  periodo: string,
  assinatura: Assinatura
): Promise<{ criado: boolean; baseline: Baseline }> {
  const existente = await lerBaseline(propertyId, aba, periodo);
  if (existente) return { criado: false, baseline: existente };

  const agora = new Date().toISOString();
  const novo: Baseline = {
    ...assinatura,
    gravadoEm: agora,
    periodo,
    confirmacoes: 0,
    conferidoEm: agora,
  };
  try {
    await kv.set(chave(propertyId, aba, periodo), novo);
  } catch (e) {
    console.error("[contrato-kv] gravarBaselineSeNovo falhou:", e);
  }
  return { criado: true, baseline: novo };
}

/** Só incrementa o contador. Os números do baseline não se mexem aqui. */
export async function confirmarBaseline(
  propertyId: string,
  aba: string,
  periodo: string,
  baseline: Baseline
): Promise<void> {
  try {
    await kv.set(chave(propertyId, aba, periodo), {
      ...baseline,
      confirmacoes: baseline.confirmacoes + 1,
      conferidoEm: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[contrato-kv] confirmarBaseline falhou:", e);
  }
}

/**
 * Sobrescreve um baseline. Só para quando o baseline ESTAVA errado e foi
 * corrigido de propósito, por exemplo depois de consertar um defeito que
 * estava no ar quando a primeira gravação aconteceu.
 *
 * Deixa rastro em `regravadoEm` e `motivo`: baseline que muda sem explicação
 * destrói a serventia do mecanismo inteiro.
 */
export async function regravarBaseline(
  propertyId: string,
  aba: string,
  periodo: string,
  assinatura: Assinatura,
  motivo: string
): Promise<Baseline> {
  const anterior = await lerBaseline(propertyId, aba, periodo);
  const agora = new Date().toISOString();
  const novo = {
    ...assinatura,
    gravadoEm: agora,
    periodo,
    confirmacoes: 0,
    conferidoEm: agora,
    regravadoEm: agora,
    motivo,
    anterior: anterior
      ? { linhas: anterior.linhas, sessoes: anterior.sessoes, conversao: anterior.conversao }
      : null,
  } as Baseline;
  try {
    await kv.set(chave(propertyId, aba, periodo), novo);
  } catch (e) {
    console.error("[contrato-kv] regravarBaseline falhou:", e);
  }
  return novo;
}
