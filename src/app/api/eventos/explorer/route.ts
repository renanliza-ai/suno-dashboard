import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/eventos/explorer
 *
 * Explorer estilo GA4 Exploration — permite cruzar uma DIMENSÃO (ex:
 * eventName, country, deviceCategory, sessionSource) com até 2 MÉTRICAS
 * (eventCount, totalUsers, sessions, eventValue) num período.
 *
 * Retorna:
 *   - rows: tabela ordenada por métrica primária (top 100)
 *   - timeline: série diária da métrica primária total (pro line chart)
 *
 * Public (não master-only) — qualquer user pode explorar eventos.
 */

const ALLOWED_DIMENSIONS = [
  "eventName",
  "sessionDefaultChannelGroup",
  "deviceCategory",
  "country",
  "city",
  "operatingSystem",
  "browser",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
  "pagePath",
  "hostName",
  "newVsReturning",
  // Tempo — permite responder "qual o melhor horário / dia da semana".
  // (pedido: análise do efeito Copom, cujo anúncio saiu 18h30)
  "hour",
  "dayOfWeekName",
  "dateHour",
  // Demografia — dependem de Google Signals ativo na property.
  "userAgeBracket",
  "userGender",
  // Landing page — a primeira página da sessão. Necessário pra aba de LP:
  // pagePath conta qualquer visualização, landingPage conta a ENTRADA.
  "landingPage",
  "landingPagePlusQueryString",
  // Públicos do GA4 (Admin > Públicos). Não têm histórico anterior à criação
  // do público: o GA4 não aplica retroativo.
  "audienceName",
  "audienceId",
  // Promoção (banner/pop-up). ⚠️ São ITEM-SCOPED no GA4: não combinam com
  // métricas de evento (eventCount). Se o GA4 recusar a combinação, o erro
  // agora SOBE pro cliente em vez de virar dado errado silencioso.
  "itemPromotionId",
  "itemPromotionName",
  "itemPromotionCreativeName",
  "itemPromotionCreativeSlot",
];

/**
 * Dimensão personalizada de evento: `customEvent:<param>`. Permite consultar
 * qualquer parâmetro registrado em Admin > Definições personalizadas, o que é
 * o caminho pra identificar criativa de banner sem alterar este arquivo de novo.
 */
const CUSTOM_DIM_RE = /^customEvent:[A-Za-z0-9_]{1,40}$/;

/**
 * Dimensões ITEM-SCOPED. A série diária NÃO pode ser construída para elas.
 *
 * Auditoria de 08/09/2026: a query da timeline usa só `date` e reaproveita o
 * dimensionFilter, não a dimensão. Em dimensão que restringe o universo, o
 * gráfico contradizia a tabela ao lado: na Research a tabela dava 29.082 e a
 * timeline 1.328.430 (45,7x); no Status 3.280 contra 2.868.647 (874,6x); na
 * Consultoria a tabela vinha VAZIA e o gráfico mostrava 23.449 sessões.
 * Controle que provou o escopo: landingPage, sessionMedium, userAgeBracket e
 * eventName ficaram todos em 1,00x.
 *
 * Melhor não ter gráfico do que ter gráfico que contradiz a tabela.
 */
const ITEM_SCOPED_DIMS = new Set([
  "itemPromotionId",
  "itemPromotionName",
  "itemPromotionCreativeName",
  "itemPromotionCreativeSlot",
]);

function isAllowedDimension(d: string): boolean {
  return ALLOWED_DIMENSIONS.includes(d) || CUSTOM_DIM_RE.test(d);
}

const ALLOWED_METRICS = [
  "eventCount",
  "totalUsers",
  "activeUsers",
  "sessions",
  "engagedSessions",
  "eventValue",
  "averageSessionDuration",
  "bounceRate",
  "screenPageViews",
  "userEngagementDuration",
  // Receita: necessárias para reconciliar a CONTAGEM do GA4 com o VALOR real
  // dos pedidos no Zeus. Contagem sozinha não separa "GA4 duplicou o evento"
  // de "GA4 está vendo um pedido que o checkout não gerou".
  "purchaseRevenue",
  "totalRevenue",
  "transactions",
  "itemRevenue",
];

/**
 * ⚠️ NÃO reintroduzir fallback silencioso aqui.
 *
 * Até 08/09/2026 estas funções trocavam qualquer dimensão desconhecida por
 * `eventName` e devolviam HTTP 200. Consequência real, medida numa auditoria:
 * `dimension=bananas` respondia com dado plausível, e nove dimensões de
 * promoção testadas devolveram todas a MESMA linha de eventName, com o nome
 * pedido ecoado de volta no payload. Ou seja, o painel podia rotular um
 * gráfico com uma dimensão que nunca foi consultada.
 *
 * Regra nova: nome inválido é erro 400 declarando o que foi rejeitado.
 * Errar alto é melhor que acertar por acidente.
 */
function validateDimension(d: string | null): { ok: true; value: string } | { ok: false; msg: string } {
  if (!d) return { ok: true, value: "eventName" };
  if (isAllowedDimension(d)) return { ok: true, value: d };
  return {
    ok: false,
    msg: `dimensão não suportada: "${d}". Use uma de [${ALLOWED_DIMENSIONS.join(", ")}] ou o formato customEvent:<parametro>.`,
  };
}

function validateMetric(
  m: string | null,
  fallback: string
): { ok: true; value: string } | { ok: false; msg: string } {
  if (!m) return { ok: true, value: fallback };
  if (ALLOWED_METRICS.includes(m)) return { ok: true, value: m };
  return {
    ok: false,
    msg: `métrica não suportada: "${m}". Use uma de [${ALLOWED_METRICS.join(", ")}].`,
  };
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const dimCheck = validateDimension(req.nextUrl.searchParams.get("dimension"));
  if (!dimCheck.ok) {
    return NextResponse.json({ error: "invalid_dimension", detail: dimCheck.msg }, { status: 400 });
  }
  const dimension = dimCheck.value;

  const metricCheck = validateMetric(req.nextUrl.searchParams.get("metric"), "eventCount");
  if (!metricCheck.ok) {
    return NextResponse.json({ error: "invalid_metric", detail: metricCheck.msg }, { status: 400 });
  }
  const metric = metricCheck.value;

  const metric2Raw = req.nextUrl.searchParams.get("metric2");
  let metric2Safe: string | null = null;
  if (metric2Raw && metric2Raw !== "none") {
    const m2Check = validateMetric(metric2Raw, "totalUsers");
    if (!m2Check.ok) {
      return NextResponse.json({ error: "invalid_metric2", detail: m2Check.msg }, { status: 400 });
    }
    metric2Safe = m2Check.value;
  }

  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");
  const eventFilter = req.nextUrl.searchParams.get("eventFilter") || ""; // filtra por nome de evento (substring)
  // limit: top-100 escondia campanhas de cauda longa (ex: codigos SNC por anuncio).
  const limitParam = Number(req.nextUrl.searchParams.get("limit") || 100);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 5000) : 100;

  // Date range — honra custom ou usa relativo
  const dateRange =
    startDateParam && endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
      ? { startDate: startDateParam, endDate: endDateParam }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // Filter por nome de evento.
  // ⚠️ Antes só era aplicado quando dimension === "eventName" — o que fazia
  // "compras por hora" devolver TODOS os eventos por hora (bug silencioso de
  // leitura: 167k "compras" num dia). Agora o filtro vale para QUALQUER
  // dimensão, que é o caso de uso real (evento X quebrado por hora/canal/device).
  const buildFilter = () => {
    if (!eventFilter) return undefined;
    // "purchase|generate_lead" -> lista exata; senão CONTAINS
    if (eventFilter.includes("|")) {
      return {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: eventFilter.split("|").map((s) => s.trim()).filter(Boolean) },
        },
      };
    }
    return {
      filter: {
        fieldName: "eventName",
        stringFilter: { value: eventFilter, matchType: "CONTAINS" as const },
      },
    };
  };

  /**
   * Filtro de host (`hostsIn=lp.suno.com.br,lp2.suno.com.br`).
   *
   * Existe porque agregar landing page no cliente era impossível: pagePath
   * devolve exatamente 3.000 linhas em Research e Status, ou seja, a cauda
   * chega truncada e a soma sai errada. Filtrando host NO SERVIDOR, antes do
   * corte, o total fecha. Também é o que separa LP de portal e de área logada.
   */
  const hostsIn = (req.nextUrl.searchParams.get("hostsIn") || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const buildHostFilter = () =>
    hostsIn.length > 0
      ? { filter: { fieldName: "hostName", inListFilter: { values: hostsIn, caseSensitive: false } } }
      : undefined;

  const evF = buildFilter();
  const hostF = buildHostFilter();
  // Combina os dois com AND quando ambos existem.
  const dimensionFilter =
    evF && hostF ? { andGroup: { expressions: [evF, hostF] } } : evF || hostF;

  // ============================================================
  // 2 queries paralelas: tabela (por dimension) + timeline (por date)
  // ============================================================
  const metricsToQuery = metric2Safe ? [{ name: metric }, { name: metric2Safe }] : [{ name: metric }];

  const [tableRes, timelineRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: dimension }],
      metrics: metricsToQuery,
      orderBys: [{ metric: { metricName: metric }, desc: true }],
      limit,
      dimensionFilter,
    }),
    ITEM_SCOPED_DIMS.has(dimension)
      ? Promise.resolve({ data: null, error: null })
      : runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "date" }],
          metrics: [{ name: metric }],
          orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
          dimensionFilter,
        }),
  ]);

  if (tableRes.error) {
    /**
     * O GA4 recusou a consulta. Isso NÃO pode voltar como HTTP 200.
     *
     * Auditoria de 08/09/2026: com `customEvent:banner_name` inexistente, ou
     * com dimensão de promoção somada a eventCount, o GA4 respondia 400 e esta
     * rota devolvia 200 com `rows: []`. Qualquer cliente que testasse
     * `res.ok` lia "período sem dado" onde houve consulta RECUSADA. É a forma
     * residual do mesmo defeito do fallback silencioso.
     */
    return NextResponse.json(
      {
        propertyId,
        error: "ga4_rejected_query",
        detail: tableRes.error,
        query: { dimension, metric, metric2: metric2Safe },
        rows: [],
        timeline: [],
      },
      { status: 502 }
    );
  }

  const rows = (tableRes.data?.rows || []).map((r) => ({
    dimension: r.dimensionValues?.[0]?.value || "(empty)",
    metric: Number(r.metricValues?.[0]?.value || 0),
    metric2: metric2Safe ? Number(r.metricValues?.[1]?.value || 0) : null,
  }));

  const timeline = (timelineRes.data?.rows || []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value || "";
    // GA4 retorna YYYYMMDD — formata para YYYY-MM-DD
    const date =
      raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    return {
      date,
      value: Number(r.metricValues?.[0]?.value || 0),
    };
  });

  // Totals
  const totalMetric = rows.reduce((s, r) => s + r.metric, 0);
  const totalMetric2 = metric2Safe ? rows.reduce((s, r) => s + (r.metric2 || 0), 0) : null;

  return NextResponse.json(
    {
      propertyId,
      query: { dimension, metric, metric2: metric2Safe, days, dateRange, eventFilter, hostsIn },
      rows,
      timeline,
      totals: { metric: totalMetric, metric2: totalMetric2 },
      meta: {
        rowCount: rows.length,
        timelineDays: timeline.length,
        timelineUnavailableReason: ITEM_SCOPED_DIMS.has(dimension)
          ? "Dimensão item-scoped: a série diária mostraria o total da propriedade, não o recorte da tabela, então não é gerada."
          : null,
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
