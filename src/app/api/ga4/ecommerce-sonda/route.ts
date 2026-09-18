import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/ecommerce-sonda — o `purchase` chega com identificador e valor?
 *
 * @sonda-contrato: esta rota É a sonda. Ela devolve a forma CRUA do que o GA4
 * tem em `transactionId`, `itemId` e nas métricas de receita, em vez de deixar
 * qualquer tela supor que esses campos existem.
 *
 * ⚠️ POR QUE ELA EXISTE (18/09/2026)
 *
 * O Renan propôs cruzar o identificador de transação do GA4 com o pedido do
 * Zeus, para trazer valor e ticket médio para dentro do GA4. A proposta só faz
 * sentido se `transaction_id` estiver realmente chegando, e ninguém tinha
 * olhado. Medição anterior mostrava `purchase` com 1.891 eventos e R$ 284,35 de
 * receita no mês, contra R$ 580 mil no Zeus, o que sugere que o dataLayer do
 * checkout não manda `value`. Mas sugerir não é verificar.
 *
 * Esta rota responde três coisas, e cada uma decide um caminho diferente:
 *   1. `transactionId` vem preenchido? Se vier "(not set)" em tudo, não existe
 *      chave para cruzar com o Zeus e a ideia morre na origem.
 *   2. Quantos identificadores DISTINTOS existem contra o total de eventos?
 *      Se o distinto for muito menor, há duplicação de `purchase`.
 *   3. O valor está em qual evento? A receita pode estar sendo declarada no
 *      `view_item` em vez do `purchase`, e aí o número existe mas no lugar
 *      errado.
 */

type Linha = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

const naoPreenchido = (v: string) =>
  !v || v === "(not set)" || v === "(none)" || v.trim() === "";

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate e endDate obrigatorios" }, { status: 400 });
  }
  const dateRanges = [{ startDate, endDate }];

  const [porTransacao, porEvento] = await Promise.all([
    // 1. O identificador de transação, cru. `transactionId` é dimensão nativa
    //    do e-commerce do GA4: se o dataLayer não manda, tudo volta "(not set)".
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "transactionId" }],
      metrics: [
        { name: "eventCount" },
        { name: "purchaseRevenue" },
        { name: "totalRevenue" },
      ],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 200,
    }),
    // 2. Onde o valor está declarado, por evento.
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }, { name: "totalRevenue" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 50,
    }),
  ]);

  if (porTransacao.error) {
    return NextResponse.json({
      propertyId,
      erroTransacao: porTransacao.error,
      leitura:
        "O GA4 recusou a dimensão transactionId. Isso por si só ja indica que o e-commerce não está registrado nesta property do jeito esperado.",
    });
  }

  const linhas = (porTransacao.data?.rows || []) as Linha[];
  let eventosComId = 0;
  let eventosSemId = 0;
  let idsDistintos = 0;
  const amostra: { id: string; eventos: number; receita: number }[] = [];

  for (const r of linhas) {
    const id = r.dimensionValues?.[0]?.value || "";
    const n = Number(r.metricValues?.[0]?.value || 0);
    const rec = Number(r.metricValues?.[1]?.value || 0);
    if (naoPreenchido(id)) {
      eventosSemId += n;
    } else {
      eventosComId += n;
      idsDistintos++;
      if (amostra.length < 5) {
        // Nunca o id inteiro: identificador de pedido é dado de negócio.
        amostra.push({ id: id.slice(0, 4) + "…" + id.slice(-3), eventos: n, receita: rec });
      }
    }
  }

  const eventos = (porEvento.data?.rows || []) as Linha[];
  const valorPorEvento = eventos
    .map((r) => ({
      evento: r.dimensionValues?.[0]?.value || "",
      contagem: Number(r.metricValues?.[0]?.value || 0),
      valorDeclarado: Number(r.metricValues?.[1]?.value || 0),
      receita: Number(r.metricValues?.[2]?.value || 0),
    }))
    .filter((e) => e.valorDeclarado > 0 || e.receita > 0 || /purchase|checkout|view_item/.test(e.evento))
    .slice(0, 15);

  const total = eventosComId + eventosSemId;
  const pctComId = total > 0 ? Number(((eventosComId / total) * 100).toFixed(1)) : null;

  return NextResponse.json({
    propertyId,
    janela: { startDate, endDate },
    identificadorDeTransacao: {
      linhasRetornadas: linhas.length,
      eventosComId,
      eventosSemId,
      idsDistintos,
      pctComId,
      amostra,
      /**
       * O veredito em texto, porque o número sozinho engana: 0% com id e 100%
       * com id levam a decisões opostas sobre o cruzamento com o Zeus.
       */
      veredito:
        linhas.length === 0
          ? "Nenhuma linha voltou: não há evento de compra com essa dimensão na janela."
          : eventosComId === 0
            ? "NENHUM purchase carrega transaction_id. Não existe chave para cruzar com o pedido do Zeus: o cruzamento é impossível hoje, não é questão de esforço."
            : pctComId !== null && pctComId < 90
              ? `Só ${pctComId}% dos eventos trazem identificador. Cruzamento parcial: o que ficar de fora sai do cálculo e o resultado vira subestimativa, não erro visível.`
              : "Os eventos trazem identificador. O cruzamento com o Zeus é viável pela chave.",
    },
    valorPorEvento,
    /**
     * A leitura que a tela e o leitor precisam ter junto do número. Sem isto,
     * "R$ 2,6 milhões em view_item" parece receita.
     */
    comoLer:
      "valorDeclarado é o que o site DIZ que aquele evento vale. Valor alto em view_item não é receita: é o preço do produto exibido na vitrine, somado a cada exibição. Receita de verdade só conta em purchase.",
  });
}
