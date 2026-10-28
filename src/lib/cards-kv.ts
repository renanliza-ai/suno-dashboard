/**
 * src/lib/cards-kv.ts — PERGUNTAS SALVAS COMO CARD VIVO.
 *
 * O QUE ISTO RESOLVE
 * O chat respondia e a resposta morria no histórico. A ideia do Renan
 * (08/10/2026) é a do Claude Dashboards: pergunta em linguagem simples vira
 * painel, e o painel se mantém atualizado conforme o dado muda.
 *
 * DECISÃO CENTRAL: o card NÃO guarda o texto da resposta como verdade.
 * Guarda a CHAMADA que produziu o número (tool + args + contexto). Reexecutar
 * a chamada é o que mantém atualizado. Guardar o texto geraria um painel que
 * envelhece em silêncio, que é o problema que o painel inteiro existe para
 * evitar.
 *
 * E guarda a ÚLTIMA e a PENÚLTIMA execução, para a tela mostrar variação sem
 * precisar de série histórica. Duas execuções bastam para "mudou ou não".
 *
 * ⚠️ O card herda o contrato semântico da tool. Se a regra da B.U. mudar no
 * `bu.ts`, a próxima execução já sai com a regra nova e o contrato novo. Card
 * não congela regra de negócio.
 */

import { kv } from "@vercel/kv";

export type CardExecucao = {
  /** ISO. Quando esta execução rodou. */
  em: string;
  /** Resultado bruto da tool, já com { dado, contrato }. */
  resultado: unknown;
  /** Falha da execução, quando houver. Nunca apaga a execução anterior. */
  erro: string | null;
};

export type Card = {
  id: string;
  /** A pergunta em linguagem natural, como a pessoa escreveu. */
  pergunta: string;
  /** Título curto para a tela. */
  titulo: string;
  /** Quem salvou (e-mail da sessão), para o time saber a quem perguntar. */
  autor: string;
  criadoEm: string;
  /** A chamada que reproduz o número. É isto que o cron reexecuta. */
  chamada: {
    tool: string;
    args: Record<string, unknown>;
    propertyId: string;
    propertyName: string;
    days: number;
  };
  ultima: CardExecucao | null;
  penultima: CardExecucao | null;
  /**
   * Última falha, guardada SEPARADA do último número bom. A tela mostra o
   * número com a data dele mais o aviso de que a atualização falhou, em vez de
   * trocar dado bom por mensagem de erro.
   */
  ultimoErro: CardExecucao | null;
  /** false = fica salvo mas o cron pula. */
  ativo: boolean;
};

const PREFIXO = "card:";
const INDICE = "cards:index";

function chave(id: string): string {
  return `${PREFIXO}${id}`;
}

/**
 * ID determinístico pela chamada, não aleatório. Salvar a MESMA pergunta duas
 * vezes atualiza o card em vez de criar duplicata. `Math.random` e `Date.now`
 * ficariam de fora de qualquer forma: o id tem que ser reproduzível.
 */
export function idDaChamada(c: Card["chamada"]): string {
  const bruto = [c.tool, c.propertyId, c.days, JSON.stringify(c.args ?? {})].join("|");
  let h = 0;
  for (let i = 0; i < bruto.length; i++) {
    h = (h << 5) - h + bruto.charCodeAt(i);
    h |= 0;
  }
  return `${c.tool}-${Math.abs(h).toString(36)}`;
}

export async function listarCards(): Promise<Card[]> {
  const ids = (await kv.smembers<string[]>(INDICE)) || [];
  if (ids.length === 0) return [];
  const cards = await Promise.all(ids.map((id) => kv.get<Card>(chave(id))));
  return cards
    .filter((c): c is Card => Boolean(c))
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
}

export async function lerCard(id: string): Promise<Card | null> {
  return (await kv.get<Card>(chave(id))) ?? null;
}

export async function salvarCard(card: Card): Promise<Card> {
  await kv.set(chave(card.id), card);
  await kv.sadd(INDICE, card.id);
  return card;
}

export async function apagarCard(id: string): Promise<boolean> {
  const existia = Boolean(await kv.get(chave(id)));
  await kv.del(chave(id));
  await kv.srem(INDICE, id);
  return existia;
}

/**
 * Registra uma execução nova, empurrando a anterior para `penultima`.
 *
 * ⚠️ Execução com ERRO NÃO vira `ultima`: ela é anexada ao card como falha,
 * mas o último número BOM continua visível, com a data dele. Substituir dado
 * bom por erro apaga a única referência que o leitor tinha.
 */
export function comNovaExecucao(card: Card, exec: CardExecucao): Card {
  if (exec.erro) {
    // Preserva ultima/penultima intactas: o número bom sobrevive à falha.
    return { ...card, ultimoErro: exec };
  }
  return { ...card, penultima: card.ultima, ultima: exec, ultimoErro: null };
}
