import { kv } from "@vercel/kv";
import { NextRequest, NextResponse } from "next/server";
import {
  verificarEstado,
  aptaParaTrafego,
  CUSTO_MAX_POR_PAGINA_MS,
  type EstadoLP,
  type ResultadoEstado,
} from "@/lib/lp-estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/lp/estado — quais LPs ainda estão no ar e aptas a receber tráfego.
 *
 * @sonda-contrato: `?debug=1` devolve a batida crua (status, destino final e
 * destino da versão sem barra) de cada URL, que é o que sustenta a
 * classificação. A regra e as duas armadilhas estão em `src/lib/lp-estado.ts`.
 *
 * ⚠️ POR QUE ISTO NÃO VERIFICA TUDO NUMA CHAMADA
 *
 * São 2 requisições HTTP por LP, contra um WordPress que leva de 0,6s a 14s por
 * resposta. As 210 LPs da Research levaram 4 minutos na medição de 15/09/2026,
 * e o teto da Vercel é 60s. Então a rota trabalha por ORÇAMENTO DE TEMPO: gasta
 * o que cabe, grava cada resultado no KV, e devolve `pendentes` com quantas
 * faltaram. A tela chama de novo até zerar.
 *
 * Isso é deliberado: verificação parcial declarada é honesta, verificação
 * inteira que estoura o limite devolve 504 e a tela não recebe nada.
 */

const TTL_SEG = 60 * 60 * 12; // 12h: o time mexe em redirect no máximo algumas vezes por dia
/**
 * TTL curto para o `indeterminado`. Ver o comentário no ponto de gravação:
 * não cachear NADA custava 40s fixos em toda chamada e derrubava a rota.
 */
const TTL_INDETERMINADO_SEG = 10 * 60;
const ORCAMENTO_MS = 42_000; // margem sob o maxDuration de 60s
const CONCORRENCIA = 8;

type Entrada = { host: string; path: string };

const chaveKV = (host: string, path: string) =>
  `lp:estado:${host}${path.replace(/\/+$/, "")}`.toLowerCase().replace(/[^a-z0-9:_./-]/g, "_");

export async function POST(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const forcar = req.nextUrl.searchParams.get("forcar") === "1";

  let body: { paginas?: Entrada[] };
  try {
    body = (await req.json()) as { paginas?: Entrada[] };
  } catch {
    return NextResponse.json({ error: "json_invalido" }, { status: 400 });
  }

  const paginas = (body.paginas || []).filter(
    (p): p is Entrada =>
      !!p && typeof p.host === "string" && typeof p.path === "string" && /^[a-z0-9.-]+$/i.test(p.host)
  );
  if (paginas.length === 0) {
    return NextResponse.json({ error: "paginas_obrigatorio" }, { status: 400 });
  }
  if (paginas.length > 600) {
    return NextResponse.json(
      { error: "limite_600_por_chamada", recebidas: paginas.length },
      { status: 400 }
    );
  }

  const inicio = Date.now();
  const resultados: ResultadoEstado[] = [];
  const faltando: Entrada[] = [];

  // 1. O que já está no cache. Uma leitura em lote, não uma por LP.
  if (!forcar) {
    const cacheados = await Promise.all(
      paginas.map((p) =>
        kv.get<ResultadoEstado>(chaveKV(p.host, p.path)).catch(() => null)
      )
    );
    paginas.forEach((p, i) => {
      const c = cacheados[i];
      if (c && c.estado) resultados.push(c);
      else faltando.push(p);
    });
  } else {
    faltando.push(...paginas);
  }

  // 2. Verifica o que falta, até o orçamento de tempo acabar.
  let pendentes = 0;
  for (let i = 0; i < faltando.length; i += CONCORRENCIA) {
    /**
     * ⚠️ A GUARDA RESERVA O CUSTO DO LOTE QUE VAI COMEÇAR. Olhar só o relógio
     * passado era o defeito que estourava a função.
     *
     * Antes: `if (Date.now() - inicio > ORCAMENTO_MS)`. Um lote que começava em
     * 41,9s passava na guarda e podia rodar mais 40s, terminando aos 82s contra
     * um maxDuration de 60s. Resultado medido: 504 em 8 de 8 chamadas com as
     * 151 páginas da Research, e a tela recebia erro em vez de resposta parcial.
     *
     * O custo reservado vem de `CUSTO_MAX_POR_PAGINA_MS`, a MESMA constante que
     * limita a batida, e o lote é cortado por `Promise.race` nesse mesmo valor.
     * Reservar um número e deixar o lote correr por outro não protege nada.
     */
    if (Date.now() - inicio + CUSTO_MAX_POR_PAGINA_MS > ORCAMENTO_MS) {
      pendentes = faltando.length - i;
      break;
    }
    const lote = faltando.slice(i, i + CONCORRENCIA);
    const naoDecidiu = (p: Entrada, motivo: string): ResultadoEstado => ({
      host: p.host,
      path: p.path,
      estado: "indeterminado",
      status: null,
      destino: null,
      destinoSemBarra: null,
      erro: motivo,
      verificadoEm: Date.now(),
    });
    /**
     * Teto duro do lote, no MESMO valor que a guarda reservou. Sem isso a
     * reserva seria só uma intenção: bastaria uma batida se comportar fora do
     * previsto para o lote passar do que foi reservado e a função estourar.
     */
    const novos = await Promise.race([
      Promise.all(
        lote.map((p) =>
          verificarEstado(p.host, p.path).catch((e) =>
            naoDecidiu(p, String((e as Error)?.message || e))
          )
        )
      ),
      new Promise<ResultadoEstado[]>((resolve) =>
        setTimeout(
          () => resolve(lote.map((p) => naoDecidiu(p, "lote passou do teto de tempo"))),
          CUSTO_MAX_POR_PAGINA_MS
        )
      ),
    ]);
    resultados.push(...novos);
    /**
     * ⚠️ `indeterminado` AGORA ENTRA NO CACHE, com TTL curto. Não cachear era
     * a causa raiz do 504.
     *
     * A intenção original estava certa: cachear por 12h uma falha de rede
     * transformaria um soluço em diagnóstico. Mas não cachear NADA tem o preço
     * oposto, e ele foi medido: 15 das 151 LPs da Research estouram sempre, e
     * como nunca entravam no cache, TODA chamada pagava os 40s delas de novo,
     * para sempre. Sozinhas, essas 15 derrubavam a rota em 60s.
     *
     * 10 minutos resolve os dois lados: o custo fixo some e um soluço se
     * corrige sozinho na próxima visita, em vez de ficar meio dia no ar.
     */
    await Promise.all(
      novos.map((r) =>
        kv
          .set(chaveKV(r.host, r.path), r, {
            ex: r.estado === "indeterminado" ? TTL_INDETERMINADO_SEG : TTL_SEG,
          })
          .catch(() => null)
      )
    );
  }

  const contagem: Record<EstadoLP, number> = {
    no_ar: 0,
    no_ar_com_vazamento: 0,
    aposentada: 0,
    fora: 0,
    indeterminado: 0,
  };
  for (const r of resultados) contagem[r.estado]++;

  return NextResponse.json(
    {
      resultados: resultados.map((r) =>
        debug
          ? r
          : {
              host: r.host,
              path: r.path,
              estado: r.estado,
              destino: r.destino,
              destinoSemBarra: r.destinoSemBarra,
              apta: aptaParaTrafego(r.estado),
            }
      ),
      contagem,
      pedidas: paginas.length,
      verificadas: resultados.length,
      pendentes,
      /**
       * A tela é OBRIGADA a mostrar isto quando houver pendente: sem o aviso,
       * uma verificação pela metade parece uma higienização completa.
       */
      aviso:
        pendentes > 0
          ? `${pendentes} LPs ainda não foram verificadas nesta chamada. Chame de novo para continuar de onde parou.`
          : null,
      cacheTtlHoras: TTL_SEG / 3600,
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
