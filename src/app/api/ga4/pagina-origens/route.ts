import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/pagina-origens — de onde vem quem VISITA uma página.
 *
 * @sonda-contrato: `?debug=1` devolve as linhas cruas do GA4, com os nomes de
 * dimensão como a API os entrega, antes de qualquer agregação nossa.
 *
 * ⚠️ NÃO CONFUNDIR COM LANDING PAGE, QUE É OUTRA PERGUNTA
 *
 * `/api/ga4/lp-channels` quebra por `landingPage`, ou seja, por onde a sessão
 * ENTROU no site. Para uma página de meio de funil como a lojinha isso responde
 * errado: quem entra pela home e navega até /nossas-assinaturas/ conta como
 * sessão da home, e a lojinha aparece quase vazia.
 *
 * Aqui o cruzamento é `pagePath` (escopo de EVENTO) com as dimensões de origem
 * (escopo de SESSÃO). O GA4 aceita, e o resultado responde: "sessões que
 * PASSARAM por esta página, agrupadas pela origem da sessão".
 *
 * A soma por origem pode ficar um pouco acima do total de sessões da página,
 * porque uma sessão que muda de origem no meio aparece nos dois grupos. A rota
 * devolve o total separado, medido sem a quebra, justamente para a tela poder
 * mostrar a diferença em vez de escondê-la.
 */

type Linha = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const pagePath = req.nextUrl.searchParams.get("pagePath");
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!pagePath) return NextResponse.json({ error: "pagePath required" }, { status: 400 });
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate e endDate obrigatorios" }, { status: 400 });
  }

  const dateRanges = [{ startDate, endDate }];
  // BEGINS_WITH e não EXACT: a lojinha antiga tinha subpáginas por plano
  // (/nossas-assinaturas/suno-premium/) que precisam entrar na mesma conta,
  // senão o "antes" fica menor do que foi e a comparação favorece o "depois".
  const filtroPagina = {
    filter: {
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH" as const, value: pagePath, caseSensitive: false },
    },
  };

  const [porCanal, porOrigem, totalPagina] = await Promise.all([
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
      dimensionFilter: filtroPagina,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 100,
      dimensionFilter: filtroPagina,
    }),
    // Total sem quebra: é o número de controle. Se a soma por origem não bater
    // com ele, a tela precisa dizer, em vez de apresentar uma tabela que não fecha.
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
      dimensionFilter: filtroPagina,
    }),
  ]);

  if (porCanal.error) {
    return NextResponse.json({ propertyId, pagePath, error: porCanal.error }, { status: 200 });
  }

  const canais = ((porCanal.data?.rows || []) as Linha[]).map((r) => ({
    canal: r.dimensionValues?.[0]?.value || "(não definido)",
    sessoes: Number(r.metricValues?.[0]?.value || 0),
    sessoesEngajadas: Number(r.metricValues?.[1]?.value || 0),
    usuarios: Number(r.metricValues?.[2]?.value || 0),
  }));

  const origens = ((porOrigem.data?.rows || []) as Linha[]).map((r) => ({
    origem: r.dimensionValues?.[0]?.value || "(não definido)",
    midia: r.dimensionValues?.[1]?.value || "(não definido)",
    sessoes: Number(r.metricValues?.[0]?.value || 0),
    sessoesEngajadas: Number(r.metricValues?.[1]?.value || 0),
  }));

  const paginas = ((totalPagina.data?.rows || []) as Linha[]).map((r) => ({
    caminho: r.dimensionValues?.[0]?.value || "",
    sessoes: Number(r.metricValues?.[0]?.value || 0),
    sessoesEngajadas: Number(r.metricValues?.[1]?.value || 0),
  }));

  const totalSemQuebra = paginas.reduce((s, p) => s + p.sessoes, 0);
  const somaPorCanal = canais.reduce((s, c) => s + c.sessoes, 0);
  const share = (n: number) =>
    somaPorCanal > 0 ? Number(((n / somaPorCanal) * 100).toFixed(1)) : null;

  return NextResponse.json({
    propertyId,
    pagePath,
    janela: { startDate, endDate },
    paginas,
    totalSemQuebra,
    canais: canais.map((c) => ({
      ...c,
      sharePct: share(c.sessoes),
      taxaEngajamento:
        c.sessoes > 0 ? Number(((c.sessoesEngajadas / c.sessoes) * 100).toFixed(1)) : null,
    })),
    origens: origens.slice(0, 40),
    integridade: {
      somaPorCanal,
      totalSemQuebra,
      diferenca: somaPorCanal - totalSemQuebra,
      /**
       * Tolerância de 2%: uma sessão que troca de origem no meio aparece em dois
       * grupos, e isso é comportamento do GA4, não erro. Acima disso é sinal de
       * que a leitura merece desconfiança.
       */
      fecha: totalSemQuebra > 0
        ? Math.abs(somaPorCanal - totalSemQuebra) <= Math.max(5, totalSemQuebra * 0.02)
        : true,
    },
    comoLer:
      "Sessões que PASSARAM por esta página, agrupadas pela origem da sessão. Não é o mesmo que landing page: quem entra pela home e navega até aqui conta nesta lista, e não contaria numa quebra por página de entrada.",
    ...(debug
      ? { amostraCrua: { canal: porCanal.data?.rows?.slice(0, 3), origem: porOrigem.data?.rows?.slice(0, 3) } }
      : {}),
  });
}
