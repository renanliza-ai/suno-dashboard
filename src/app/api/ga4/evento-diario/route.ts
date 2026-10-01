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
  /**
   * Quebra alternativa. `data` responde "quanto por dia"; `hostName` e
   * `pagePath` respondem "de ONDE dispara", que e a pergunta quando o time
   * nao reconhece um evento que aparece no relatorio.
   */
  /**
   * `unifiedPagePathScreen` é a dimensão que a UI do GA4 chama de "Caminho da
   * página e classe da tela", e é por ela que o time confere na tela do Google.
   * `pagePath` cobre só web. Manter as duas disponíveis: comparar com o GA4
   * exige usar a MESMA régua, e usar régua diferente foi o que gerou horas de
   * "o painel não bate" quando os dois números estavam certos.
   */
  const quebraRaw = req.nextUrl.searchParams.get("quebra") || "date";
  const quebra = ["date", "hostName", "pagePath", "unifiedPagePathScreen"].includes(quebraRaw)
    ? quebraRaw
    : "date";

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate e endDate obrigatorios" }, { status: 400 });
  }
  const prefixos = eventosParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (prefixos.length === 0) {
    return NextResponse.json({ error: "eventos obrigatorio (lista separada por virgula)" }, { status: 400 });
  }

  /**
   * ⚠️ O FILTRO PRECISA IR NA CONSULTA, NÃO SÓ NO JAVASCRIPT. Corrigido em
   * 30/09/2026, e o defeito me fez afirmar um número errado para o Renan.
   *
   * A versão anterior pedia TODOS os eventos e filtrava depois, casando por
   * prefixo em memória. Como a consulta vinha ordenada por `eventCount` e o
   * limite é de 20.000 linhas, quem domina o ranking ocupa tudo: medido nesta
   * property, `/asset/snel11/` sozinho tinha 272.299 `page_view` e 262.372
   * `session_start`. As linhas de `generate_lead`, que são pequenas, ficavam
   * FORA das 20.000 e simplesmente não chegavam.
   *
   * O resultado não parecia defeito: a rota devolvia 6 páginas com
   * `generate_lead` na Suno Research, número plausível, e eu reportei como
   * fato. O GA4 mostra 71. Faltavam 65 páginas porque a consulta nunca as pediu.
   *
   * Agora o filtro entra no `dimensionFilter`, então o limite de 20.000 se
   * aplica só ao que interessa. O casamento por PREFIXO é preservado com
   * BEGINS_WITH, que é o que permite achar `add_to_cart` e `add_to_cart_oficial`
   * juntos numa migração de tagueamento.
   */
  const filtroEventos =
    prefixos.length === 1
      ? {
          filter: {
            fieldName: "eventName",
            stringFilter: { matchType: "BEGINS_WITH" as const, value: prefixos[0], caseSensitive: false },
          },
        }
      : {
          orGroup: {
            expressions: prefixos.map((p) => ({
              filter: {
                fieldName: "eventName",
                stringFilter: { matchType: "BEGINS_WITH" as const, value: p, caseSensitive: false },
              },
            })),
          },
        };

  const res = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: quebra }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    orderBys: quebra === "date" ? [{ dimension: { dimensionName: "date" } }] : [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 20000,
    dimensionFilter: filtroEventos,
  });

  if (res.error) return NextResponse.json({ propertyId, error: res.error }, { status: 200 });

  const linhas = (res.data?.rows || []) as Linha[];
  const casa = (nome: string) => prefixos.some((p) => nome.toLowerCase().startsWith(p.toLowerCase()));

  // dia -> evento -> contagem
  const porDia = new Map<string, Map<string, number>>();
  const nomesEncontrados = new Set<string>();
  let totalGeral = 0;
  /**
   * ⚠️ USUÁRIO NÃO É EVENTO, E ESSA DISTINÇÃO É O QUE FECHA COM O CRM.
   *
   * Medido em 30/09/2026 na `/cl/arsenal-independencia/`, setembro:
   *   eventos (eventCount) .... 819
   *   usuários (totalUsers) ... 777
   *   leads no Salesforce ..... 780
   *
   * O CRM conta PESSOA, o GA4 conta DISPARO. Quem envia o formulário duas vezes
   * gera dois eventos e um lead. Comparar eventCount com CRM produz uma
   * diferença que parece perda de dado e é só unidade diferente.
   */
  let totalUsuarios = 0;
  const usuariosPorChave = new Map<string, number>();

  for (const r of linhas) {
    const dia = r.dimensionValues?.[0]?.value || "";
    const evento = r.dimensionValues?.[1]?.value || "";
    if (!casa(evento)) continue;
    const n = Number(r.metricValues?.[0]?.value || 0);
    const u = Number(r.metricValues?.[1]?.value || 0);
    nomesEncontrados.add(evento);
    totalGeral += n;
    totalUsuarios += u;
    usuariosPorChave.set(dia, (usuariosPorChave.get(dia) || 0) + u);
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
    return { data: quebra === "date" ? formatarData(d) : d, dataISO: d, ...valores, total: soma, usuarios: usuariosPorChave.get(d) ?? null };
  });

  /**
   * ⚠️ A MEDIA POR TOTAL DE DIAS MENTE, E ME FEZ ERRAR EM 21/09/2026.
   *
   * Reportei que o evento `teste` do Status Invest continuava disparando
   * 12.311 vezes por dia. Ele tinha sido removido em 24/08 e a janela pedida
   * comecava em 22/08: tres dias anteriores a remocao respondiam por 348.935
   * dos 369.316 eventos. O ritmo real na data do relato era 95 por dia.
   *
   * Por isso a resposta traz o ULTIMO DIA, a media so dos dias em que o evento
   * apareceu, e a comparacao entre o comeco e o fim da janela. Media anual de
   * evento que morreu no meio do caminho e numero certo respondendo a pergunta
   * errada.
   */
  const porEvento = nomes.map((nome) => {
    const valores = dias.map((d) => porDia.get(d)?.get(nome) || 0);
    const total = valores.reduce((a, b) => a + b, 0);
    const comEvento = valores.filter((v) => v > 0).length;
    const ultimoIdx = valores.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const primeiroIdx = valores.findIndex((v) => v > 0);
    // Compara a primeira com a ultima semana da janela, quando ha as duas.
    const n = Math.min(7, Math.floor(dias.length / 2));
    const inicio = n > 0 ? valores.slice(0, n).reduce((a, b) => a + b, 0) / n : 0;
    const fim = n > 0 ? valores.slice(-n).reduce((a, b) => a + b, 0) / n : 0;
    const variacao = inicio > 0 ? Number((((fim - inicio) / inicio) * 100).toFixed(1)) : null;
    return {
      evento: nome,
      total,
      mediaDiaria: dias.length ? Math.round(total / dias.length) : 0,
      diasComEvento: comEvento,
      mediaNosDiasComEvento: comEvento ? Math.round(total / comEvento) : 0,
      primeiroDia: primeiroIdx >= 0 ? formatarData(dias[primeiroIdx]) : null,
      ultimoDia: ultimoIdx >= 0 ? formatarData(dias[ultimoIdx]) : null,
      ultimoValor: ultimoIdx >= 0 ? valores[ultimoIdx] : 0,
      mediaPrimeirosDias: Math.round(inicio),
      mediaUltimosDias: Math.round(fim),
      variacaoPct: variacao,
      /** Texto pronto, para ninguem repetir o numero errado por descuido. */
      leitura:
        variacao !== null && variacao <= -80
          ? `Praticamente parou: caiu de ${Math.round(inicio)} para ${Math.round(fim)} por dia na janela. NAO use a media da janela como ritmo atual; o ritmo atual e ${valores[valores.length - 1]} por dia.`
          : variacao !== null && variacao >= 200
            ? `Disparou na janela: subiu de ${Math.round(inicio)} para ${Math.round(fim)} por dia. A media da janela subestima o ritmo atual.`
            : null,
    };
  }).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    propertyId,
    janela: { startDate, endDate, dias: dias.length },
    quebra,
    eventosPedidos: prefixos,
    eventosEncontrados: nomes,
    porEvento,
    serie,
    totalGeral,
    totalUsuarios,
    unidade: "totalGeral conta EVENTOS (disparos). totalUsuarios conta PESSOAS. Para conferir com CRM use usuarios, porque o CRM deduplica e o GA4 nao.",
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
