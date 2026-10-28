/**
 * src/lib/cron-auth.ts — REGRA ÚNICA de autorização de rotina agendada, e a
 * assinatura das chamadas internas que ela faz.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * A regra estava copiada em cinco rotas, cada cópia com uma variação, e uma
 * delas (`cards-refresh`) tinha um `|| !segredo` que a deixou pública. Regra de
 * autorização repetida é regra que diverge.
 *
 * ⚠️ O QUE MUDOU EM 28/10/2026, E POR QUE
 *
 * 1. CAIU o `user-agent: vercel-cron`. Ele é texto livre: qualquer `curl -H`
 *    passava. Enquanto ele valia, dizer "a rota tem gate próprio" não era
 *    afirmação de segurança. Agora a via de máquina é só o Bearer.
 *
 * 2. FAIL CLOSED. Sem `CRON_SECRET` no ambiente, a resposta é 401. A versão
 *    anterior do `cards-refresh` liberava justamente nesse caso, que é o estado
 *    em que o ambiente de fato estava.
 *
 * 3. CAIU o segredo por query string (`?token=`). Query string entra em log de
 *    servidor, de proxy e de CDN. Agora é só header.
 *
 * ⚠️ DEPENDE DE `CRON_SECRET` EXISTIR NO AMBIENTE. Sem ele, TODA rotina
 * agendada passa a devolver 401, o que é o comportamento correto e também
 * significa que a variável precisa ser criada ANTES deste código ir ao ar.
 */

import type { NextRequest } from "next/server";
import { auth } from "@/auth";

export type ResultadoCron =
  | { ok: true; via: "segredo" | "master" }
  | { ok: false; motivo: "sem_segredo_no_ambiente" | "nao_autorizado"; status: 401 | 500 };

/**
 * Autoriza uma rotina agendada. Duas vias, nesta ordem:
 *   1. `Authorization: Bearer <CRON_SECRET>` — é o que a Vercel manda sozinha
 *      quando a variável existe, e é o que um agendador externo deve mandar.
 *   2. Sessão com `isMaster` — para o Renan disparar pela tela.
 */
export async function autorizarCron(req: NextRequest): Promise<ResultadoCron> {
  const segredo = process.env.CRON_SECRET;

  if (!segredo) {
    // Não é 401: é configuração faltando, e o erro tem que dizer isso, senão
    // alguém passa o dia procurando o motivo errado.
    return { ok: false, motivo: "sem_segredo_no_ambiente", status: 500 };
  }

  if (req.headers.get("authorization") === `Bearer ${segredo}`) {
    return { ok: true, via: "segredo" };
  }

  const s = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (s?.user?.isMaster) return { ok: true, via: "master" };

  return { ok: false, motivo: "nao_autorizado", status: 401 };
}

/** Corpo da resposta de recusa, com o motivo separado do status. */
export function respostaDeRecusa(r: Extract<ResultadoCron, { ok: false }>) {
  return r.motivo === "sem_segredo_no_ambiente"
    ? {
        error: "cron_sem_segredo",
        detalhe:
          "CRON_SECRET não está no ambiente. Enquanto ela não existir, nenhuma rotina agendada roda, de propósito: liberar quando falta configuração é o buraco que esta mudança veio fechar.",
      }
    : { error: "unauthorized" };
}

/**
 * Cabeçalho que uma rotina agendada usa para chamar OUTRA rota do painel.
 *
 * ⚠️ POR QUE ISTO É NECESSÁRIO
 * Os crons consultam o painel por HTTP no próprio origin, de propósito, para
 * exercitar o mesmo caminho que a tela percorre. Essas chamadas NÃO têm cookie
 * de sessão: cron não loga. Hoje elas funcionam porque `/api` está fora do
 * middleware. No dia em que `/api` passar a exigir sessão, cada uma delas vai
 * receber um redirect para `/login`, que volta HTML com status 200, e o cron vai
 * concluir "conector quebrado" onde não há nada quebrado.
 *
 * Assinar a chamada agora resolve isso ANTES de o matcher mudar, que é a única
 * ordem em que dá para saber qual mudança quebrou o quê.
 */
export function cabecalhoInterno(extra?: Record<string, string>): Record<string, string> {
  const segredo = process.env.CRON_SECRET;
  return {
    ...(segredo ? { authorization: `Bearer ${segredo}` } : {}),
    ...(extra || {}),
  };
}

/**
 * Sinal de que uma resposta é, na verdade, a página de login disfarçada.
 *
 * `200 text/html` numa rota de API é a assinatura exata do redirect seguido.
 * Sem esta checagem, o cron faz `r.json()`, estoura, e registra o erro de parse
 * como se fosse falha do conector. A falha em bloco (todas as properties ao
 * mesmo tempo) é o sintoma; conector de verdade quebra uma por vez.
 */
export function pareceTelaDeLogin(r: Response): boolean {
  const ct = r.headers.get("content-type") || "";
  return r.ok && ct.includes("text/html");
}
