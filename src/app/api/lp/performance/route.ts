import { runReport } from "@/lib/ga4-server";
import {
  computeLPConversion,
  isJunkHost,
  isThankPage,
  objectiveMismatch,
  resolveBU,
  resolveObjective,
  type BUProfile,
  type LPObjective,
} from "@/lib/bu";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/lp/performance — DESEMPENHO DE LANDING PAGE, com a regra da B.U. aplicada.
 *
 * Substitui o uso de /api/ga4/pages-detail para landing page. A diferença não é
 * cosmética:
 *
 *   1. Filtra host de LP NO SERVIDOR (`hostsIn`), antes do corte de linhas.
 *      Sem isso a agregação sai truncada: pagePath devolve exatamente 3.000
 *      linhas em Research e Status, e a cauda longa nunca chega.
 *   2. Usa `landingPage`, ou seja, a página de ENTRADA da sessão.
 *      `pagePath` contaria qualquer visualização e infla o denominador.
 *   3. Exclui Thank Page do numerador. O cta_click dispara em /obrigado/ e é
 *      clique pós-conversão.
 *   4. Aplica a regra de conversão da B.U. via src/lib/bu.ts. Na Consultoria o
 *      lead vem da soma dos eventos de qualificação, porque o generate_lead
 *      está duplicado desde 22/07/2026.
 *
 * Query params:
 *   propertyId    (obrigatório)
 *   propertyName  (obrigatório) — usado para resolver a B.U. e, com ela, quais
 *                 hosts são LP e qual evento é conversão. Sem o nome não há
 *                 como saber a regra, e o endpoint recusa em vez de adivinhar.
 *   startDate / endDate (YYYY-MM-DD) ou days (default 30)
 *   pathContains  (opcional) — recorte por caminho, ex. "/asset/" para a B.U. Asset
 *   limit         (default 200)
 *   includeThankPages=true (opcional) — só para depuração
 */

type LPRow = {
  host: string;
  path: string;
  url: string;
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  users: number;
  avgSessionDuration: number;
  bounceRate: number;
  leads: number;
  leadsSource: string;
  qualified: number | null;
  disqualified: number | null;
  qualificationRate: number | null;
  /** Todos os cliques em CTA da LP. ⚠️ NÃO é só checkout, ver comentário abaixo. */
  ctaClicks: number | null;
  /** begin_checkout atribuído a esta LP: quem REALMENTE chegou ao checkout. */
  checkoutStarts: number | null;
  connectRate: number | null;
  ctaRate: number | null;
  /** begin_checkout ÷ sessões. */
  checkoutRate: number | null;
  /**
   * Objetivo da LP pela regra universal Suno (o padrão da URL diz qual é).
   * captacao -> conversão é generate_lead. venda -> conversão é chegada ao checkout.
   */
  objective: LPObjective;
  objectiveFrom: "url" | "dado" | "nenhum";
  /** Métrica que DEVE ser lida como conversão desta linha. */
  primaryMetric: "leads" | "checkoutStarts" | "ambas";
  /** Valor da métrica primária, já resolvido, para ordenar e comparar. */
  primaryValue: number | null;
  primaryRate: number | null;
  /** Preenchido quando o objetivo declarado não bate com o dado. É alarme. */
  mismatch: string | null;
  isThankPage: boolean;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const propertyName = sp.get("propertyName");
  const days = Number(sp.get("days") || 30);
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const pathContains = (sp.get("pathContains") || "").toLowerCase();
  const limit = Math.min(Number(sp.get("limit") || 200), 1000);
  const includeThankPages = sp.get("includeThankPages") === "true";

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  if (!propertyName) {
    return NextResponse.json(
      {
        error: "propertyName_required",
        detail:
          "A regra de conversão depende da B.U. Sem propertyName não é possível saber qual host é landing page nem qual evento é conversão, e este endpoint não adivinha.",
      },
      { status: 400 }
    );
  }

  const profile: BUProfile = resolveBU(propertyName);

  const dateRange =
    startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? { startDate, endDate }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // B.U. sem dado confiável: devolve o motivo, nunca número.
  // Regra ZERO MOCK: melhor tela vazia explicando a lacuna que gráfico bonito
  // com número que não sustenta.
  if (profile.blocked || profile.lpHosts.length === 0) {
    return NextResponse.json(
      {
        propertyId,
        bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
        blocked:
          profile.blocked ||
          `Não há host de landing page mapeado para ${profile.label}. Sem host não é possível separar LP de portal.`,
        caveats: profile.caveats,
        rows: [],
        totals: null,
        range: dateRange,
      },
      { status: 200, headers: { "Cache-Control": "private, max-age=300" } }
    );
  }

  const hostFilter = {
    filter: {
      fieldName: "hostName",
      inListFilter: { values: profile.lpHosts, caseSensitive: false },
    },
  };

  // Eventos que interessam nesta B.U., em UMA query, quebrados por eventName.
  const events: string[] = [];
  if (profile.leadEvent) events.push(profile.leadEvent);
  if (profile.mqlEvents) events.push(profile.mqlEvents.qualified, profile.mqlEvents.disqualified);
  if (profile.ctaEvent) events.push(profile.ctaEvent);

  const eventFilter =
    events.length > 0
      ? {
          andGroup: {
            expressions: [
              hostFilter,
              { filter: { fieldName: "eventName", inListFilter: { values: events } } },
            ],
          },
        }
      : hostFilter;

  const [sessionsRes, eventsRes, servedRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPage" }],
      metrics: [
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "totalUsers" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit,
      dimensionFilter: hostFilter,
    }),
    events.length > 0
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [
            { name: "hostName" },
            { name: "landingPage" },
            { name: "eventName" },
          ],
          metrics: [{ name: "eventCount" }],
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
          limit: 2000,
          dimensionFilter: eventFilter,
        })
      : Promise.resolve({ data: null, error: null }),
    /**
     * GUARDA CONTRA CONTAMINAÇÃO CRUZADA DE HOST.
     *
     * `hostName` é dimensão de EVENTO e `landingPage` é de SESSÃO. Filtrar
     * hostName NÃO filtra a página de entrada: o GA4 devolve a sessão para cada
     * combinação (host, landingPage) em que houve evento. Resultado medido em
     * 08/09/2026 no Status: apareciam `/`, `/fiagros/roca11` e
     * `/fundos-imobiliarios/mxrf11` como landing page de lp.statusinvest.com.br,
     * com 99,7% de engajamento. Eram sessões que aterrissaram no PORTAL e depois
     * passaram pela LP.
     *
     * Esta query lista os caminhos que cada host de LP realmente SERVIU como
     * página (pagePath, que é event-scoped igual ao hostName). Só sobrevive a
     * linha cujo par (host, caminho) existe aqui.
     */
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 3000,
      dimensionFilter: hostFilter,
    }),
  ]);

  if (sessionsRes.error) {
    return NextResponse.json(
      {
        propertyId,
        bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
        error: sessionsRes.error,
        rows: [],
        totals: null,
        range: dateRange,
      },
      { status: 200 }
    );
  }

  // Mapa (host|path) -> { evento: contagem }
  const evMap = new Map<string, Record<string, number>>();
  for (const r of eventsRes.data?.rows || []) {
    const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const path = r.dimensionValues?.[1]?.value ?? "";
    if (!path) continue; // bucket vazio do GA4: nao e uma pagina
    const ev = r.dimensionValues?.[2]?.value || "";
    const n = Number(r.metricValues?.[0]?.value || 0);
    const key = `${host}|${path}`;
    const bucket = evMap.get(key) || {};
    bucket[ev] = (bucket[ev] || 0) + n;
    evMap.set(key, bucket);
  }

  /**
   * (host|caminho) -> pageviews que aquele host realmente serviu.
   *
   * Guarda existência NÃO basta. Auditoria de 08/09/2026 provou que um único
   * pageview solto liberava centenas de sessões de portal:
   * `lp.statusinvest.com.br/acoes/cmig4` aparecia com 371 sessões de
   * aterrissagem contra 1 pageview servido, e entrava no top 10 de LP do Status
   * com 99,5% de engajamento. Eram 574 sessões fantasma no Status e 1.570 na
   * Research.
   *
   * O teste correto é aritmético: a sessão que ATERRISSOU num caminho não pode
   * ser mais numerosa que os pageviews que o host serviu naquele caminho, na
   * mesma janela. Se for, a sessão entrou por outro host.
   */
  const servedViews = new Map<string, number>();
  const bump = (k: string, n: number) => servedViews.set(k, Math.max(servedViews.get(k) || 0, n));
  for (const r of servedRes.data?.rows || []) {
    const h = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const p = r.dimensionValues?.[1]?.value ?? "";
    if (!p) continue;
    const views = Number(r.metricValues?.[0]?.value || 0);
    // O GA4 alterna barra final entre pagePath e landingPage. Registra as três
    // formas para a comparação não falhar por isso.
    bump(`${h}|${p}`, views);
    bump(`${h}|${p.replace(/\/$/, "")}`, views);
    bump(`${h}|${p}/`, views);
  }
  let crossHostDropped = 0;
  let crossHostDroppedSessions = 0;

  const rows: LPRow[] = [];
  for (const r of sessionsRes.data?.rows || []) {
    const host = r.dimensionValues?.[0]?.value || "(sem host)";
    if (isJunkHost(host)) continue;
    // ⚠️ NAO coagir vazio para "/" aqui. O GA4 devolve landingPage VAZIO como bucket
    // proprio, e coagir vazio para "/" criava DUAS linhas com o mesmo host e o
    // mesmo caminho. As duas liam o mesmo bucket de eventos no evMap, entao a
    // conversao era contada em dobro: +39 leads na Consultoria (+9,9%) e +46
    // leads mais +511 cta_click na Research, medidos em auditoria de 08/09/2026.
    const path = r.dimensionValues?.[1]?.value ?? "";
    if (!path) continue;
    // "(not set)" aparece quando o GA4 não conseguiu resolver a página de
    // entrada da sessão. Não é uma LP: exibir como linha sugeriria que existe
    // uma página com aquele volume.
    if (path === "(not set)" || path === "(other)") continue;
    if (pathContains && !path.toLowerCase().includes(pathContains)) continue;

    const sessions = Number(r.metricValues?.[0]?.value || 0);
    const engagedSessions = Number(r.metricValues?.[1]?.value || 0);

    // Descarta contaminação cruzada: sessão que entrou por outro host.
    // Existência não basta, o volume tem que ser possível (ver servedViews).
    if (servedViews.size > 0) {
      const views = servedViews.get(`${host.toLowerCase()}|${path}`) || 0;
      if (views < sessions) {
        crossHostDropped++;
        crossHostDroppedSessions += sessions;
        continue;
      }
    }

    const thank = isThankPage(path);
    if (thank && !includeThankPages) continue;

    const bucket = evMap.get(`${host.toLowerCase()}|${path}`) || {};

    const conv = computeLPConversion(profile, {
      sessions,
      leadEventCount: profile.leadEvent ? bucket[profile.leadEvent] || 0 : 0,
      qualified: profile.mqlEvents ? bucket[profile.mqlEvents.qualified] || 0 : 0,
      disqualified: profile.mqlEvents ? bucket[profile.mqlEvents.disqualified] || 0 : 0,
      ctaCount: profile.ctaEvent ? bucket[profile.ctaEvent] || 0 : 0,
    });

    rows.push({
      host,
      path,
      url: `https://${host}${path}`,
      sessions,
      engagedSessions,
      engagementRate: sessions > 0 ? Number(((engagedSessions / sessions) * 100).toFixed(1)) : null,
      users: Number(r.metricValues?.[2]?.value || 0),
      avgSessionDuration: Number(r.metricValues?.[3]?.value || 0),
      // A Data API devolve bounceRate como FRAÇÃO (0,908 = 90,8%). Sem o ×100 a
      // tela mostrava 0,9% de rejeição em LP com 9,2% de engajamento, ou seja,
      // cem vezes menor e com cara de excelente.
      bounceRate: Number((Number(r.metricValues?.[4]?.value || 0) * 100).toFixed(1)),
      leads: conv.leads,
      leadsSource: conv.leadsSource,
      qualified: conv.qualified,
      disqualified: conv.disqualified,
      qualificationRate: conv.qualificationRate,
      ctaClicks: conv.ctaClicks,
      checkoutStarts: null, // preenchido abaixo
      connectRate: conv.connectRate,
      ctaRate: conv.ctaRate,
      checkoutRate: null, // preenchido abaixo
      objective: "indefinido", // resolvido abaixo, depois do begin_checkout
      objectiveFrom: "nenhum",
      primaryMetric: "ambas",
      primaryValue: null,
      primaryRate: null,
      mismatch: null,
      isThankPage: thank,
    });
  }

  /**
   * QUEM REALMENTE CHEGOU AO CHECKOUT.
   *
   * Pedido do Renan em 08/09/2026: a coluna de CTA deveria mostrar só clique que
   * leva ao checkout. Ele estava certo em desconfiar. O `cta_click` das LPs NÃO
   * é só checkout: sondando `customEvent:cta_name` dentro do próprio evento
   * aparecem "entrar_na_comunidade" (826 sessões), "entrar_no_grupo_vip_agora"
   * (659), "entre_na_comunidade" (643), "baixar_agora" (476) e
   * "preencha_o_formulário" (449), que são WhatsApp, download e formulário.
   * Existe uma segunda tag disparando cta_click genérico além do motor da LP.
   *
   * E não dá para filtrar por destino: o parâmetro `cta_destino` existe no
   * dataLayer mas NUNCA foi registrado como dimensão personalizada no GA4
   * (`customEvent:cta_destino` é recusado pela API). No Status não existe
   * nenhuma dimensão `cta_*`.
   *
   * A medição honesta de "levou ao checkout" é o `begin_checkout` atribuído à
   * landing page de entrada: medida na CHEGADA, não na intenção do clique.
   *
   * ⚠️ Duas ressalvas de método, ambas declaradas no payload:
   *   1. O begin_checkout dispara no domínio de checkout, então NÃO se pode
   *      aplicar filtro de hostName aqui: hostName é event-scoped e zeraria a
   *      contagem. O recorte é feito pela lista de caminhos de LP já validados.
   *   2. Por isso a junção é por CAMINHO. Se o portal servir um caminho com o
   *      mesmo texto de uma LP, os dois somam na mesma linha.
   */
  let checkoutAttribution: {
    event: string;
    method: string;
    caveat: string;
    matchedPaths: number;
  } | null = null;

  if (profile.conversionModel === "captacao_venda" && rows.length > 0) {
    const paths = Array.from(new Set(rows.map((r) => r.path))).slice(0, 300);
    const bcRes = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "landingPage" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 500,
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "eventName",
                stringFilter: { matchType: "EXACT" as const, value: "begin_checkout" },
              },
            },
            { filter: { fieldName: "landingPage", inListFilter: { values: paths } } },
          ],
        },
      },
    });
    if (!bcRes.error) {
      const bcMap = new Map<string, number>();
      for (const r of bcRes.data?.rows || []) {
        const pth = r.dimensionValues?.[0]?.value ?? "";
        if (!pth) continue;
        bcMap.set(pth, Number(r.metricValues?.[0]?.value || 0));
      }
      for (const row of rows) {
        const bc = bcMap.get(row.path) ?? 0;
        row.checkoutStarts = bc;
        row.checkoutRate = row.sessions > 0 ? Number(((bc / row.sessions) * 100).toFixed(2)) : null;
      }
      checkoutAttribution = {
        event: "begin_checkout",
        method:
          "Atribuído pela landing page de entrada da sessão. É a medição de quem CHEGOU ao checkout, não de quem clicou com intenção de ir.",
        caveat:
          "O begin_checkout dispara no domínio de checkout, então não é possível filtrar por host aqui. A junção é por caminho: se o portal servir um caminho com o mesmo texto de uma LP, os dois somam na mesma linha.",
        matchedPaths: bcMap.size,
      };
    }
  }

  /**
   * OBJETIVO DA LP E MÉTRICA PRIMÁRIA.
   *
   * Regra universal do Grupo Suno (material oficial do Growth Team): o padrão da
   * URL declara o objetivo, e o objetivo declara qual evento é a conversão.
   * `/cl/`, `/lm/`, `/ebook-`, `/minicurso-`, `/planilha-`, `/whatsapp-`,
   * `/lista-vip-` são captação (generate_lead). `/pv/`, `/nossas-assinaturas`, `/planos-`,
   * `/combo-`, `/integracao-`, `/especial-` são venda (levar ao checkout).
   *
   * Roda AQUI, depois do begin_checkout, porque o `/ao/` só é captação quando
   * tem formulário, e isso se desambigua pelo dado.
   */
  for (const row of rows) {
    const { objective, inferredFrom } = resolveObjective(row.path, {
      leads: row.leads,
      checkoutStarts: row.checkoutStarts,
    });
    row.objective = objective;
    row.objectiveFrom = inferredFrom;

    if (objective === "captacao") {
      row.primaryMetric = "leads";
      row.primaryValue = row.leads;
      row.primaryRate = row.connectRate;
    } else if (objective === "venda") {
      row.primaryMetric = "checkoutStarts";
      row.primaryValue = row.checkoutStarts;
      row.primaryRate = row.checkoutRate;
    } else {
      // Sem objetivo declarado nem inferível: NÃO elege primária. Mostrar as
      // duas é honesto; escolher uma seria adivinhar qual métrica cobrar.
      row.primaryMetric = "ambas";
      row.primaryValue = null;
      row.primaryRate = null;
    }

    row.mismatch = objectiveMismatch(objective, inferredFrom, {
      sessions: row.sessions,
      leads: row.leads,
      checkoutStarts: row.checkoutStarts,
    });
  }

  const objectiveSummary = {
    captacao: rows.filter((r) => r.objective === "captacao").length,
    venda: rows.filter((r) => r.objective === "venda").length,
    indefinido: rows.filter((r) => r.objective === "indefinido").length,
    inferidoPorDado: rows.filter((r) => r.objectiveFrom === "dado").length,
    comAlarme: rows.filter((r) => r.mismatch).length,
    // Conversão somada SÓ da métrica que importa em cada objetivo. É o número
    // que o gestor deve olhar, em vez de somar lead e checkout de tudo junto.
    leadsDeCaptacao: rows
      .filter((r) => r.objective === "captacao")
      .reduce((s, r) => s + r.leads, 0),
    sessoesDeCaptacao: rows
      .filter((r) => r.objective === "captacao")
      .reduce((s, r) => s + r.sessions, 0),
    checkoutDeVenda: rows
      .filter((r) => r.objective === "venda")
      .reduce((s, r) => s + (r.checkoutStarts || 0), 0),
    sessoesDeVenda: rows.filter((r) => r.objective === "venda").reduce((s, r) => s + r.sessions, 0),
  };

  // Totais recalculados a partir das linhas, não somando taxa (média de taxa mente).
  const sum = (f: (r: LPRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tSessions = sum((r) => r.sessions);
  const tEngaged = sum((r) => r.engagedSessions);
  const tLeads = sum((r) => r.leads);
  const tQual = profile.mqlEvents ? sum((r) => r.qualified || 0) : null;
  const tDisq = profile.mqlEvents ? sum((r) => r.disqualified || 0) : null;
  const tCta = profile.ctaEvent ? sum((r) => r.ctaClicks || 0) : null;
  const tCheckout = checkoutAttribution ? sum((r) => r.checkoutStarts || 0) : null;

  const totals = {
    landingPages: rows.length,
    sessions: tSessions,
    engagedSessions: tEngaged,
    engagementRate: tSessions > 0 ? Number(((tEngaged / tSessions) * 100).toFixed(1)) : null,
    leads: tLeads,
    qualified: tQual,
    disqualified: tDisq,
    qualificationRate:
      tQual !== null && tLeads > 0 ? Number(((tQual / tLeads) * 100).toFixed(1)) : null,
    ctaClicks: tCta,
    connectRate: tSessions > 0 ? Number(((tLeads / tSessions) * 100).toFixed(2)) : null,
    ctaRate: tCta !== null && tSessions > 0 ? Number(((tCta / tSessions) * 100).toFixed(2)) : null,
    checkoutStarts: tCheckout,
    checkoutRate:
      tCheckout !== null && tSessions > 0 ? Number(((tCheckout / tSessions) * 100).toFixed(2)) : null,
  };

  return NextResponse.json(
    {
      propertyId, // anti race-condition: o cliente descarta resposta de property antiga
      bu: {
        key: profile.key,
        label: profile.label,
        conversionModel: profile.conversionModel,
        leadEvent: profile.leadEvent,
        mqlEvents: profile.mqlEvents,
        ctaEvent: profile.ctaEvent,
        leadDivisor: profile.leadDivisor,
      },
      lpHosts: profile.lpHosts,
      caveats: profile.caveats,
      checkoutAttribution,
      objectiveSummary,
      objectiveRule: {
        fonte: "Material oficial do Growth Team, slide 03. Regra universal do Grupo Suno.",
        captacao: {
          evento: "generate_lead",
          objetivo: "Pegar contato para nutrir.",
          padroes: ["/cl/", "/lm/", "/ebook-", "/minicurso-", "/planilha-", "/whatsapp-", "/lista-vip-"],
        },
        venda: {
          evento: "cta_click (lido pela chegada ao checkout)",
          objetivo: "Levar ao checkout.",
          padroes: ["/pv/", "/nossas-assinaturas", "/planos-", "/combo-", "/integracao-", "/especial-"],
        },
        ambiguo:
          "/ao/ só é captação QUANDO a página tem formulário. Não se decide pela URL: aqui é desambiguado pelo dado (se registra generate_lead, tem formulário).",
      },
      blocked: null,
      rows,
      totals,
      range: dateRange,
      meta: {
        eventsQueried: events,
        thankPagesExcluded: !includeThankPages,
        crossHostDropped,
        crossHostDroppedSessions,
        rowsReturnedByGa4: sessionsRes.data?.rows?.length || 0,
        truncated: (sessionsRes.data?.rows?.length || 0) >= limit,
      },
    },
    { headers: { "Cache-Control": "private, max-age=180, stale-while-revalidate=600" } }
  );
}
