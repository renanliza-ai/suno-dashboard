import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/evento-diario — volumetria diária de eventos escolhidos.
 *
 * @sonda-contrato: `?debug=1` devolve as linhas cruas do GA4, com os nomes de
 * dimensão como a API entrega, antes de qualquer pivô nosso.
 *
 * Criada em 21/09/2026 a pedido do time de produto (Lucas), que precisa
 * comparar a volumetria de adição ao carrinho do GA4 com a contagem própria
 * deles, e o mesmo para visualização de página.
 *
 * ⚠️ POR QUE A RESPOSTA TRAZ TODOS OS EVENTOS QUE CASAM, E NÃO SÓ O PEDIDO
 *
 * Em julho de 2026 a Suno Research tinha `add_to_cart` E `add_to_cart_oficial`
 * disparando ao mesmo tempo (7.762 e 5.148 no mês), porque havia uma migração
 * de tagueamento em curso. O mesmo para `view_item` e `view_item_oficial`.
 * Quem pedisse "a volumetria de add_to_cart" receberia metade do número sem
 * saber que existia outra metade com outro nome.
 *
 * Então o parâmetro `eventos` casa por PREFIXO e a resposta devolve cada nome
 * encontrado em sua própria linha, com o total somado à parte e um aviso quando
 * houver mais de uma variante. Somar calado seria pior: numa migração, somar
 * conta a mesma ação duas vezes.
 */

type Linha = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

const formatarData = (aaaammdd: string) =>
  aaaammdd.length === 8
    ? `${aaaammdd.slice(6, 8)}/${aaaammdd.slice(4, 6)}/${aaaammdd.slice(0, 4)}`
    : aaaammdd;

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const eventosParam = req.nextUrl.searchParams.get("eventos") || "";
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate e endDate obrigatorios" }, { status: 400 });
  }
  const prefixos = eventosParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (prefixos.length === 0) {
    return NextResponse.json({ error: "eventos obrigatorio (lista separada por virgula)" }, { status: 400 });
  }

  const res = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "date" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 20000,
  });

  if (res.error) return NextResponse.json({ propertyId, error: res.error }, { status: 200 });

  const linhas = (res.data?.rows || []) as Linha[];
  const casa = (nome: string) => prefixos.some((p) => nome.toLowerCase().startsWith(p.toLowerCase()));

  // dia -> evento -> contagem
  const porDia = new Map<string, Map<string, number>>();
  const nomesEncontrados = new Set<string>();
  let totalGeral = 0;

  for (const r of linhas) {
    const dia = r.dimensionValues?.[0]?.value || "";
    const evento = r.dimensionValues?.[1]?.value || "";
    if (!casa(evento)) continue;
    const n = Number(r.metricValues?.[0]?.value || 0);
    nomesEncontrados.add(evento);
    totalGeral += n;
    const m = porDia.get(dia) || new Map<string, number>();
    m.set(evento, (m.get(evento) || 0) + n);
    porDia.set(dia, m);
  }

  const nomes = Array.from(nomesEncontrados).sort();
  const dias = Array.from(porDia.keys()).sort();
  const serie = dias.map((d) => {
    const m = porDia.get(d)!;
    const valores: Record<string, number> = {};
    let soma = 0;
    for (const nome of nomes) {
      const v = m.get(nome) || 0;
      valores[nome] = v;
      soma += v;
    }
    return { data: formatarData(d), dataISO: d, ...valores, total: soma };
  });

  const porEvento = nomes.map((nome) => {
    const total = dias.reduce((s, d) => s + (porDia.get(d)?.get(nome) || 0), 0);
    return { evento: nome, total, mediaDiaria: dias.length ? Math.round(total / dias.length) : 0 };
  }).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    propertyId,
    janela: { startDate, endDate, dias: dias.length },
    eventosPedidos: prefixos,
    eventosEncontrados: nomes,
    porEvento,
    serie,
    totalGeral,
    /**
     * O aviso é obrigatório na tela e em qualquer relato: sem ele, uma property
     * em migração de tagueamento entrega número pela metade ou dobrado, e os
     * dois erros passam despercebidos.
     */
    aviso:
      nomes.length > 1
        ? `Foram encontrados ${nomes.length} eventos que casam com o pedido: ${nomes.join(", ")}. Eles vêm SEPARADOS na série, e a coluna "total" soma todos. Se forem variantes da mesma ação (migração de tagueamento), somar conta a mesma ação duas vezes: escolha qual é o oficial antes de reportar.`
        : nomes.length === 0
          ? "Nenhum evento com esse prefixo foi encontrado na janela. Confira o nome exato em Admin > Eventos no GA4."
          : null,
    ...(debug ? { amostraCrua: linhas.slice(0, 5) } : {}),
  });
}
