import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { lerConteudo } from "@/lib/lp-conteudo";
import { cruzarConteudoComFriccao, type FriccaoMedida } from "@/lib/cro-conteudo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/cro/conteudo — lê as páginas dos achados e devolve o que há nelas.
 *
 * @sonda-contrato: `?debug=1` devolve a leitura CRUA de cada página, com todas
 * as contagens, antes de virar achado. É por ali que se confere se o extrator
 * ainda entende o HTML depois que o time mexe no tema.
 *
 * A tela manda as páginas que já têm fricção medida e recebe de volta os
 * achados que combinam as duas metades. Quem decide o que é fricção continua
 * sendo o Clarity e o GA4: esta rota não inventa problema a partir da página.
 *
 * ⚠️ ORÇAMENTO DE TEMPO, pelo mesmo motivo de /api/lp/estado: cada página é uma
 * requisição HTTP contra um WordPress que leva de 0,6s a 25s, e o teto da
 * Vercel é 60s. A rota gasta o que cabe e devolve `pendentes`.
 */

const ORCAMENTO_MS = 42_000;
const CONCORRENCIA = 4;

export async function POST(req: NextRequest) {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const debug = req.nextUrl.searchParams.get("debug") === "1";
  let body: { paginas?: FriccaoMedida[]; janela?: string };
  try {
    body = (await req.json()) as { paginas?: FriccaoMedida[]; janela?: string };
  } catch {
    return NextResponse.json({ error: "json_invalido" }, { status: 400 });
  }

  const paginas = (body.paginas || []).filter(
    (p) => p && typeof p.url === "string" && /^https?:\/\//.test(p.url)
  );
  if (paginas.length === 0) {
    return NextResponse.json({ error: "paginas_obrigatorio" }, { status: 400 });
  }
  if (paginas.length > 60) {
    return NextResponse.json({ error: "limite_60_por_chamada", recebidas: paginas.length }, { status: 400 });
  }

  const janela = body.janela || "janela atual";
  const inicio = Date.now();
  const achados = [];
  const leituras = [];
  let pendentes = 0;
  let naoLegiveis = 0;

  for (let i = 0; i < paginas.length; i += CONCORRENCIA) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      pendentes = paginas.length - i;
      break;
    }
    const lote = paginas.slice(i, i + CONCORRENCIA);
    const lidas = await Promise.all(
      lote.map(async (p) => ({ f: p, c: await lerConteudo(p.url).catch(() => null) }))
    );
    for (const { f, c } of lidas) {
      if (!c) continue;
      leituras.push(
        debug
          ? c
          : {
              url: c.url,
              seguiuIframe: c.seguiuIframe,
              renderizadoPorJs: c.renderizadoPorJs,
              leituraConfiavel: c.leituraConfiavel,
              erro: c.erro,
              resumo: c.leituraConfiavel
                ? {
                    h1: c.h1[0] || null,
                    palavras: c.palavras,
                    botoes: c.botoes,
                    ctasParaCheckout: c.ctasParaCheckout,
                    camposDeFormulario: c.camposDeFormulario,
                    precoVisivel: c.precoVisivel,
                    temGarantia: c.temGarantia,
                    temDepoimento: c.temDepoimento,
                    falsosClicaveis: c.falsosClicaveis,
                    linksVazios: c.linksVazios,
                  }
                : null,
            }
      );
      if (c.erro || !c.leituraConfiavel) naoLegiveis++;
      achados.push(...cruzarConteudoComFriccao(f, c, janela));
    }
  }

  return NextResponse.json({
    achados,
    leituras,
    pedidas: paginas.length,
    lidas: leituras.length,
    naoLegiveis,
    pendentes,
    /**
     * A tela precisa mostrar isto: página montada por JavaScript não é lida
     * estaticamente, e silenciar isso faria parecer que ela não tem problema.
     */
    aviso:
      naoLegiveis > 0
        ? `${naoLegiveis} página(s) não puderam ser lidas: ou o servidor recusou, ou o conteúdo é montado por JavaScript e não existe no HTML. Elas ficam sem achado de conteúdo, o que não significa que estejam boas.`
        : null,
  });
}
