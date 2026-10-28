// src/app/api/cron/cards-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listarCards, salvarCard, comNovaExecucao } from "@/lib/cards-kv";
import { executeChatTool, type ChatToolContext } from "@/lib/gemini-tools";
import { autorizarCron, respostaDeRecusa } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/cron/cards-refresh — é isto que faz o card "se manter atualizado
 * conforme o dado muda".
 *
 * Reexecuta a CHAMADA de cada card ativo e empurra a execução anterior para
 * `penultima`, para a tela mostrar variação sem série histórica.
 *
 * ⚠️ TRÊS DECISÕES QUE EVITAM DEFEITO CONHECIDO
 *
 * 1. SEM reexecução de card com erro sobrescrevendo o bom. `comNovaExecucao`
 *    guarda a falha em `ultimoErro` e deixa o último número bom no lugar, com
 *    a data dele. Trocar dado bom por "erro" apaga a única referência do leitor.
 *
 * 2. TETO DE CARDS POR RODADA. O maxDuration da Vercel é 60s e cada tool faz
 *    fetch interno de até 20s. Sem teto, uma lista grande estoura no meio e
 *    metade dos cards fica com data velha sem ninguém saber. Com teto, o que
 *    não coube é DECLARADO na resposta.
 *
 * 3. SEQUENCIAL, não paralelo. As tools batem nas rotas do próprio painel, que
 *    batem na API do GA4. Disparar tudo junto multiplica a chance de 429.
 */

const TETO_POR_RODADA = 12;

export async function GET(req: NextRequest) {
  /**
   * Mesma regra dos outros dois crons. Ver src/lib/cron-auth.ts.
   *
   * ⚠️ A versão que subiu em 28/10/2026 tinha `|| !segredo`, que liberava a
   * rota para QUALQUER UM enquanto CRON_SECRET não existisse no ambiente. Como
   * a variável nunca foi criada, ela foi ao ar pública: qualquer pessoa com a
   * URL disparava a rotina e queimava cota do GA4. Escape hatch em verificação
   * de autorização é buraco, não conveniência.
   */
  const permissao = await autorizarCron(req);
  if (!permissao.ok) {
    return NextResponse.json(respostaDeRecusa(permissao), { status: permissao.status });
  }

  const todos = await listarCards();
  const ativos = todos.filter((c) => c.ativo);
  const naRodada = ativos.slice(0, TETO_POR_RODADA);
  const foraDaRodada = ativos.length - naRodada.length;

  const agora = new Date().toISOString();
  const relatorio: Array<{ id: string; ok: boolean; motivo?: string }> = [];

  for (const card of naRodada) {
    const ctx: ChatToolContext = {
      origin: req.nextUrl.origin,
      propertyId: card.chamada.propertyId,
      propertyName: card.chamada.propertyName,
      days: card.chamada.days,
      cookie: req.headers.get("cookie") || undefined,
    };

    let resultado: unknown = null;
    let erro: string | null = null;
    try {
      resultado = await executeChatTool(card.chamada.tool, card.chamada.args, ctx);
      const r = resultado as { error?: string };
      if (r?.error) erro = r.error;
    } catch (e) {
      erro = (e as Error).message;
    }

    await salvarCard(comNovaExecucao(card, { em: agora, resultado, erro }));
    relatorio.push({ id: card.id, ok: !erro, ...(erro ? { motivo: erro } : {}) });
  }

  return NextResponse.json({
    em: agora,
    totalAtivos: ativos.length,
    atualizados: relatorio.filter((r) => r.ok).length,
    comFalha: relatorio.filter((r) => !r.ok).length,
    // Nunca truncar em silêncio: o que não coube é declarado.
    naoCouberamNestaRodada: foraDaRodada,
    avisoDeTeto:
      foraDaRodada > 0
        ? `${foraDaRodada} card(s) ativos ficaram de fora por causa do teto de ${TETO_POR_RODADA} por rodada. Eles seguem com o dado da rodada anterior.`
        : null,
    relatorio,
  });
}
