import { runReport } from "@/lib/ga4-server";
import {
  computeLPConversion,
  impressionPairFor,
  normalizeSpace,
  resolveBU,
  spaceKind,
  type BUProfile,
  type SpaceKind,
} from "@/lib/bu";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/comunicacao/spaces — desempenho de BANNER e POP-UP por ESPAÇO.
 *
 * ⚠️ LEIA ANTES DE MEXER: por que esta rota não entrega "banner mais visto".
 *
 * Auditoria de 08/09/2026 na GA4 Data API. A criativa individual só existe na
 * SUNO RESEARCH, onde o dataLayer de promoção está populado (promotion_name e
 * creative_name preenchidos, promotion_id faltando, cobertura ~54%). No Status
 * e na Consultoria as dimensões de promoção vêm só como "(not set)", e ali o
 * identificador mais fino é o ESPAÇO, em `sessionMedium`.
 *
 * A versão anterior deste comentário afirmava que NENHUMA property tinha a
 * dimensão. Era falso, e estava travando uma capacidade que já existia.
 *
 * E `sessionMedium` é dimensão de SESSÃO: uma sessão com medium=banner.home é
 * uma sessão que ENTROU clicando naquele espaço. Isso é o numerador. Não existe
 * nada em sessionMedium que conte impressão. Logo:
 *
 *   CTR POR ESPAÇO NÃO É CALCULÁVEL. Esta rota não devolve esse campo, de
 *   propósito, para que nenhuma tela possa exibi-lo por engano.
 *
 * O que ela devolve, que é honesto e útil:
 *   - Cliques (sessões geradas) por espaço, com a taxonomia normalizada
 *   - Conversão a jusante por espaço (lead e compra), que responde a pergunta
 *     de negócio melhor que CTR: qual espaço traz gente que converte
 *   - O par view/click POR PÁGINA onde ele existe de fato (Research tem
 *     wisepops_view/click, Status tem ad_impression/ad_click), sempre com o
 *     aviso de validação anexado
 *
 * Query params:
 *   propertyId    (obrigatório)
 *   propertyName  (obrigatório) — resolve a B.U. e a regra de conversão
 *   kind          banner | popup | todos (default "banner"; valor invalido = 400)
 *   startDate / endDate (YYYY-MM-DD) ou days (default 30)
 */

/**
 * GRÃO DA LINHA: 1 espaço × 1 peça (11/09/2026).
 *
 * Antes era 1 linha por ESPAÇO, com o nome da peça dominante numa coluna e o
 * resto escondido no title. O Renan apontou que ficava confuso: um espaço que
 * roda quatro banners mostrava o desempenho somado dos quatro debaixo do nome
 * de um só, então a peça boa e a peça ruim viravam a mesma linha.
 *
 * Agora cada peça tem a própria linha e o próprio desempenho, e o espaço fica
 * na primeira coluna como agrupador.
 */
type SpaceRow = {
  space: string;
  rawMediums: string[];
  kind: SpaceKind;
  /**
   * Nome da peça. Vem de `sessionCampaignName`, que é do MESMO escopo de sessão
   * que o espaço (ver o comentário longo sobre itemPromotionName mais abaixo).
   * Quando a sessão chegou sem campanha, a linha continua existindo com
   * `named: false`, para o somatório das peças fechar com o total do espaço em
   * vez de sumir com tráfego.
   */
  bannerName: string;
  named: boolean;
  /** Sessões que entraram por este espaço com esta peça. É o CLIQUE. */
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  leads: number;
  leadsSource: string;
  /** Conta criada: `lead_create_account`. null quando a B.U. não tem o evento. */
  accounts: number | null;
  /**
   * Chegada ao checkout (`begin_checkout`) atribuída a esta peça.
   *
   * ⚠️ NÃO é `cta_click` filtrado por destino, que foi o pedido literal. Isso
   * não é possível no GA4 hoje: `customEvent:cta_destino` é recusado pela API
   * nas duas properties (reconferido em 11/09/2026), e o Status não tem
   * NENHUMA dimensão cta_* registrada. Como o `cta_click` mistura checkout com
   * WhatsApp, download e formulário, filtrá-lo era impossível e somá-lo inteiro
   * seria mentira. `begin_checkout` mede quem CHEGOU no checkout, que é mais
   * forte que a intenção do clique, e é a mesma âncora da aba de Landing Pages.
   */
  checkoutStarts: number | null;
  /** `cta_click` bruto, TODOS os destinos. Só para contexto no tooltip. */
  ctaClicksAll: number | null;
  purchases: number | null;
  /** Peso desta peça dentro do espaço, em sessões. */
  sharePct: number | null;
  /** Quantas peças distintas rodaram neste espaço no período. */
  pecasNoEspaco: number;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const propertyName = sp.get("propertyName");
  // `kind` validado de forma estrita. Antes `kind=bananas` devolvia HTTP 200
  // com zero espaços, e a tela parecia "não houve tráfego".
  const kindRaw = sp.get("kind") || "banner";
  if (!["banner", "popup", "todos"].includes(kindRaw)) {
    return NextResponse.json(
      { error: "invalid_kind", detail: `kind inválido: "${kindRaw}". Use banner, popup ou todos.` },
      { status: 400 }
    );
  }
  const kindParam = kindRaw as SpaceKind | "todos";
  const days = Number(sp.get("days") || 30);
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!propertyName) {
    return NextResponse.json(
      {
        error: "propertyName_required",
        detail:
          "A regra de conversão a jusante depende da B.U. Sem propertyName este endpoint não adivinha qual evento é lead.",
      },
      { status: 400 }
    );
  }

  const profile: BUProfile = resolveBU(propertyName);

  /**
   * BLOQUEIO POR B.U. — precisa estar AQUI também, não só na rota de LP.
   *
   * Auditoria de 08/09/2026: esta rota ignorava `profile.blocked` e publicava
   * 17 leads da FIIs com `leadsSource: "evento_bruto"`, exatamente o número que
   * src/lib/bu.ts declara impublicável por suspeita de duplicação. A aba de LP
   * obedecia e a aba de banner não, ou seja, duas telas do mesmo painel
   * respondiam diferente sobre a mesma B.U. Era o defeito mais caro da
   * auditoria, porque era o único que colocava no ar um número que a casa já
   * sabia estar errado.
   */
  if (profile.blocked) {
    return NextResponse.json(
      {
        propertyId,
        bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
        kind: kindParam,
        blocked: profile.blocked,
        spaces: [],
        totals: { spaces: 0, sessions: 0, leads: 0, checkoutStarts: null, purchases: null },
        impressions: null,
        limitations: [],
        caveats: profile.caveats,
      },
      { status: 200, headers: { "Cache-Control": "private, max-age=300" } }
    );
  }

  const dateRange =
    startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? { startDate, endDate }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // Eventos de conversão a jusante desta B.U.
  const convEvents: string[] = [];
  if (profile.mqlEvents) {
    convEvents.push(profile.mqlEvents.qualified, profile.mqlEvents.disqualified);
  } else if (profile.leadEvent) {
    convEvents.push(profile.leadEvent);
  }
  // Conta criada. Um nome só: no Status `lead_create_account` e `sign_up` têm
  // eventCount idêntico, somar os dois dobraria o cadastro.
  const accountEvent = profile.accountEvent || null;
  if (accountEvent) convEvents.push(accountEvent);
  // `purchase` só existe onde há checkout.
  const hasPurchase = profile.conversionModel === "captacao_venda";
  // Regra universal Suno: captação mede generate_lead, venda mede chegada ao
  // checkout. Os dois entram aqui para a tela poder separar as ESTRATÉGIAS em
  // vez de misturar tudo numa coluna de "conversão".
  if (hasPurchase) convEvents.push("begin_checkout", "purchase");
  // cta_click entra só como CONTEXTO do tooltip da coluna de checkout, nunca
  // como a coluna em si: ele mistura destino de checkout com WhatsApp,
  // download e formulário, e não há dimensão de destino para separar.
  if (profile.ctaEvent) convEvents.push(profile.ctaEvent);

  const pair = impressionPairFor(profile, kindParam);

  /**
   * PRÉ-FILTRO DE MEDIUM. Existe por causa de TRUNCAMENTO, não de elegância.
   *
   * Com o grão novo (espaço × peça) a query passa a competir com `organic`,
   * `cpc` e `email`, que têm milhares de campanhas cada. O GA4 ordena por
   * sessão e corta no `limit`, então sem este filtro os espaços de banner, que
   * têm menos sessão, seriam simplesmente cortados da resposta e a tabela
   * apareceria incompleta sem nenhum erro.
   *
   * Ele é deliberadamente MAIS LARGO que `spaceKind` (superset): o corte fino
   * continua sendo feito por `spaceKind` em memória, com a taxonomia oficial.
   * Filtro largo demais custa linha; filtro estreito demais perde espaço.
   */
  const medFiltro = {
    orGroup: {
      expressions: ["banner", "popup", "modal", "lightbox", "interstitial", "blur", "nai"].map(
        (v) => ({
          filter: {
            fieldName: "sessionMedium",
            stringFilter: { matchType: "CONTAINS" as const, value: v, caseSensitive: false },
          },
        })
      ),
    },
  };

  /**
   * RANKING DE CRIATIVA — só onde o dataLayer de promoção está populado.
   *
   * Auditoria de 08/09/2026 corrigiu uma afirmação errada desta rota. As
   * dimensões de promoção do GA4 TÊM valor na Suno Research:
   *   itemPromotionName: "Novo banner - E-book como analisar ações - FIXO"
   *   (14.617 sessões) e "FIXO - Minicurso Valuation - Novo" (1.135).
   * No Status e na Consultoria vem só "(not set)", ou seja, ali a afirmação
   * segue verdadeira.
   *
   * ⚠️ Só métrica de sessão/usuário é compatível: com `eventCount` o GA4 recusa
   * ("Please remove eventCount to make the request compatible"). E a cobertura
   * é parcial, cerca de 54% das sessões, porque "(not set)" leva o resto.
   */
  const wantsCreatives = profile.key === "research" || profile.key === "asset";

  const [medRes, convRes, viewRes, clickRes, creativeRes, promoByMedRes, campByMedRes] = await Promise.all([
    // 1. Sessões por medium. É o clique: a sessão entrou por aquele espaço.
    //    Fica como TOTAL DE CONTROLE do espaço: a soma das peças tem que bater
    //    com ele, e a diferença vai declarada no meta.
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 1000,
    }),
    // 2. Conversão a jusante por medium E PEÇA. As três dimensões são do mesmo
    //    escopo de sessão, exceto eventName que é de evento: o cruzamento
    //    responde "evento disparado em sessão que entrou por este espaço com
    //    esta campanha", que é exatamente a pergunta da tela.
    convEvents.length > 0
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [
            { name: "sessionMedium" },
            { name: "sessionCampaignName" },
            { name: "eventName" },
          ],
          metrics: [{ name: "eventCount" }],
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
          limit: 20000,
          dimensionFilter: {
            andGroup: {
              expressions: [
                { filter: { fieldName: "eventName", inListFilter: { values: convEvents } } },
                medFiltro,
              ],
            },
          },
        })
      : Promise.resolve({ data: null, error: null }),
    // 3 e 4. Par view/click por página, só onde existe de verdade.
    pair
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
          limit: 200,
          dimensionFilter: {
            filter: {
              fieldName: "eventName",
              stringFilter: { matchType: "EXACT" as const, value: pair.viewEvent },
            },
          },
        })
      : Promise.resolve({ data: null, error: null }),
    pair
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
          limit: 200,
          dimensionFilter: {
            filter: {
              fieldName: "eventName",
              stringFilter: { matchType: "EXACT" as const, value: pair.clickEvent },
            },
          },
        })
      : Promise.resolve({ data: null, error: null }),
    wantsCreatives
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "itemPromotionName" }, { name: "itemPromotionCreativeName" }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 100,
        })
      : Promise.resolve({ data: null, error: null }),
    /**
     * NOME DO BANNER POR ESPAÇO — tentativa 1: o nome real da promoção.
     *
     * `itemPromotionName` é item-scoped e `sessionMedium` é session-scoped.
     * A combinação pode ser recusada pelo GA4; nesse caso o erro fica aqui
     * dentro e cai no fallback de campanha, sem derrubar a rota.
     * Métrica `sessions` de propósito: com `eventCount` o GA4 recusa dimensão
     * de promoção ("Please remove eventCount to make the request compatible").
     */
    wantsCreatives
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "sessionMedium" }, { name: "itemPromotionName" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 2000,
        })
      : Promise.resolve({ data: null, error: null }),
    /**
     * Tentativa 2, fallback universal: a campanha. Na prática o time nomeia a
     * peça dentro do utm_campaign ("_SNCE74BC112_ao---suno-one---banner-lead-magnet"),
     * então é o mais próximo de nome de banner que existe fora da Research.
     */
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionMedium" }, { name: "sessionCampaignName" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20000,
      dimensionFilter: medFiltro,
    }),
  ]);

  if (medRes.error) {
    return NextResponse.json(
      { propertyId, bu: { key: profile.key, label: profile.label }, error: medRes.error, spaces: [] },
      { status: 200 }
    );
  }

  // Chave do grão novo: o par espaço + peça.
  const chave = (med: string, camp: string) => med + "||" + camp;

  /**
   * Rótulo da peça. Campanha vazia ou placeholder do GA4 vira UM bucket só por
   * espaço, em vez de três linhas de lixo separadas.
   *
   * O bucket CONTINUA aparecendo na tabela de propósito: sem ele a soma das
   * peças não fecharia com o total do espaço, e a tela perderia tráfego sem
   * avisar ninguém. Um espaço cujo tráfego é quase todo "sem nome" é um espaço
   * com UTM mal marcada, e isso é informação, não sujeira para esconder.
   */
  const SEM_NOME = "(sem nome de campanha)";
  const rotuloPeca = (raw: string): { label: string; named: boolean } => {
    const v = (raw || "").trim();
    // Escape dos parênteses: sem eles o regex casava "not set" cru e deixava
    // passar "(not set)", que é justamente o valor que o GA4 devolve.
    if (!v || /^((not set|direct|other|empty|none|organic|referral))$/i.test(v)) {
      return { label: SEM_NOME, named: false };
    }
    return { label: v, named: true };
  };

  // Conversão por espaço × peça × evento.
  const convByPeca = new Map<string, Record<string, number>>();
  for (const r of convRes.data?.rows || []) {
    const med = normalizeSpace(r.dimensionValues?.[0]?.value || "");
    const { label } = rotuloPeca(r.dimensionValues?.[1]?.value || "");
    const ev = r.dimensionValues?.[2]?.value || "";
    const n = Number(r.metricValues?.[0]?.value || 0);
    const k = chave(med, label);
    const b = convByPeca.get(k) || {};
    b[ev] = (b[ev] || 0) + n;
    convByPeca.set(k, b);
  }

  /**
   * ⚠️ POR QUE O NOME DA PEÇA VEM DA CAMPANHA, E NÃO DA PROMOÇÃO.
   *
   * A primeira versão usava `itemPromotionName` cruzado com `sessionMedium` e
   * o resultado, medido em 09/09/2026 na Research, foi ENGANOSO: a mesma peça
   * ("Novo banner - E-book como analisar ações - FIXO") aparecia em banner.home,
   * banner.leadmagnet.home, banner.noticias e banner, com 75% a 89% de share em
   * todas. Não é coincidência: `itemPromotionName` é ITEM-SCOPED e
   * `sessionMedium` é SESSION-SCOPED. O cruzamento responde "qual promoção foi
   * VISTA nas sessões que entraram por este espaço", não "qual peça roda neste
   * espaço". Como quase toda sessão vê o mesmo bloco de promoção do site, o
   * nome se repetia e dava a impressão de que todo espaço tem o mesmo banner.
   *
   * `sessionCampaignName` é do MESMO escopo do medium, então o cruzamento é
   * coerente, e na convenção da Suno a campanha nomeia a peça dentro da UTM
   * ("_SNCE74BC112_ao---suno-one---banner-lead-magnet"). É texto livre, e a
   * tela declara isso, mas é o único nome por espaço que não mente.
   *
   * O ranking por promoção continua existindo no bloco "Criativas nomeadas",
   * onde ele é honesto: lá o eixo é a própria promoção, sem cruzar escopo.
   */
  const promoNamesIgnored = Boolean(!promoByMedRes.error && promoByMedRes.data?.rows?.length);

  // Sessões por espaço × peça. Este é o esqueleto das linhas.
  type PecaAgg = {
    space: string;
    kind: SpaceKind;
    label: string;
    named: boolean;
    sessions: number;
    engaged: number;
    raws: Set<string>;
  };
  const pecas = new Map<string, PecaAgg>();
  for (const r of campByMedRes.data?.rows || []) {
    const raw = r.dimensionValues?.[0]?.value || "(none)";
    const kind = spaceKind(raw);
    if (kind === "outro") continue; // não é banner nem pop-up
    if (kindParam !== "todos" && kind !== kindParam) continue;

    const space = normalizeSpace(raw);
    const { label, named } = rotuloPeca(r.dimensionValues?.[1]?.value || "");
    const k = chave(space, label);
    const cur =
      pecas.get(k) ||
      { space, kind, label, named, sessions: 0, engaged: 0, raws: new Set<string>() };
    cur.sessions += Number(r.metricValues?.[0]?.value || 0);
    cur.engaged += Number(r.metricValues?.[1]?.value || 0);
    cur.raws.add(raw);
    pecas.set(k, cur);
  }

  /**
   * TOTAL DE CONTROLE por espaço, vindo da query que só quebra por medium.
   *
   * Serve para duas coisas: o share de cada peça dentro do espaço, e a
   * verificação de integridade. Se a soma das peças não bater com o total do
   * espaço, houve corte de linha no GA4 e a tela precisa dizer isso em vez de
   * apresentar uma tabela que não fecha.
   */
  const totalPorEspaco = new Map<string, number>();
  for (const r of medRes.data?.rows || []) {
    const raw = r.dimensionValues?.[0]?.value || "(none)";
    const kind = spaceKind(raw);
    if (kind === "outro") continue;
    if (kindParam !== "todos" && kind !== kindParam) continue;
    const space = normalizeSpace(raw);
    totalPorEspaco.set(
      space,
      (totalPorEspaco.get(space) || 0) + Number(r.metricValues?.[0]?.value || 0)
    );
  }

  const pecasPorEspaco = new Map<string, number>();
  for (const v of pecas.values()) {
    pecasPorEspaco.set(v.space, (pecasPorEspaco.get(v.space) || 0) + 1);
  }

  const spaces: SpaceRow[] = Array.from(pecas.values())
    .map((v) => {
      const bucket = convByPeca.get(chave(v.space, v.label)) || {};
      const conv = computeLPConversion(profile, {
        sessions: v.sessions,
        leadEventCount: profile.leadEvent ? bucket[profile.leadEvent] || 0 : 0,
        qualified: profile.mqlEvents ? bucket[profile.mqlEvents.qualified] || 0 : 0,
        disqualified: profile.mqlEvents ? bucket[profile.mqlEvents.disqualified] || 0 : 0,
        ctaCount: 0,
      });
      const totalEspaco = totalPorEspaco.get(v.space) || 0;
      return {
        space: v.space,
        rawMediums: Array.from(v.raws).sort(),
        kind: v.kind,
        bannerName: v.label,
        named: v.named,
        sessions: v.sessions,
        engagedSessions: v.engaged,
        engagementRate:
          v.sessions > 0 ? Number(((v.engaged / v.sessions) * 100).toFixed(1)) : null,
        leads: conv.leads,
        leadsSource: conv.leadsSource,
        accounts: accountEvent ? bucket[accountEvent] || 0 : null,
        checkoutStarts: hasPurchase ? bucket["begin_checkout"] || 0 : null,
        ctaClicksAll: profile.ctaEvent ? bucket[profile.ctaEvent] || 0 : null,
        purchases: hasPurchase ? bucket["purchase"] || 0 : null,
        sharePct:
          totalEspaco > 0 ? Number(((v.sessions / totalEspaco) * 100).toFixed(1)) : null,
        pecasNoEspaco: pecasPorEspaco.get(v.space) || 1,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  const bannerNameSource: "promotion" | "campaign" | null = spaces.some((r) => r.named)
    ? "campaign"
    : null;

  // Integridade: a soma das peças tem que bater com o total por espaço.
  const sessoesPorPeca = spaces.reduce((s2, r) => s2 + r.sessions, 0);
  const sessoesPorEspaco = Array.from(totalPorEspaco.values()).reduce((s2, n) => s2 + n, 0);
  const diferencaQuebra = sessoesPorEspaco - sessoesPorPeca;

  // Par view/click por página. O CTR só é calculado quando o par existe, e
  // vem sempre acompanhado de `warning` e da flag `ctrTrustworthy`.
  type PageRow = { path: string; views: number; clicks: number; ctr: number | null; implausible: boolean };
  let impressions: {
    label: string;
    viewEvent: string;
    clickEvent: string;
    warning: string | null;
    ctrTrustworthy: boolean;
    totals: { views: number; clicks: number; ctr: number | null };
    pages: PageRow[];
  } | null = null;

  if (pair) {
    const vMap = new Map<string, number>();
    for (const r of viewRes.data?.rows || []) {
      vMap.set(r.dimensionValues?.[0]?.value || "/", Number(r.metricValues?.[0]?.value || 0));
    }
    const cMap = new Map<string, number>();
    for (const r of clickRes.data?.rows || []) {
      cMap.set(r.dimensionValues?.[0]?.value || "/", Number(r.metricValues?.[0]?.value || 0));
    }
    const paths = new Set([...vMap.keys(), ...cMap.keys()]);
    const pages: PageRow[] = Array.from(paths)
      .map((path) => {
        const views = vMap.get(path) || 0;
        const clicks = cMap.get(path) || 0;
        const ctr = views > 0 ? Number(((clicks / views) * 100).toFixed(2)) : null;
        return { path, views, clicks, ctr, implausible: ctr !== null && ctr > 100 };
      })
      .sort((a, b) => b.views - a.views);

    const tv = pages.reduce((s, p) => s + p.views, 0);
    const tc = pages.reduce((s, p) => s + p.clicks, 0);
    const anyImplausible = pages.some((p) => p.implausible);

    impressions = {
      label: pair.label,
      viewEvent: pair.viewEvent,
      clickEvent: pair.clickEvent,
      warning: pair.warning,
      // Wisepops passa de 100% em páginas da área logada, então CTR não é confiável.
      // Status tem razão de 900:1 ainda não validada.
      ctrTrustworthy: false,
      totals: { views: tv, clicks: tc, ctr: tv > 0 ? Number(((tc / tv) * 100).toFixed(2)) : null },
      pages: pages.slice(0, 100),
    };
    if (anyImplausible && impressions.warning) {
      impressions.warning +=
        " Há páginas com razão acima de 100% nesta janela, o que confirma o defeito de disparo.";
    }
  }

  // Criativas nomeadas, quando o dataLayer de promoção está populado.
  type Creative = { promotion: string; creative: string; sessions: number; users: number; sharePct: number | null };
  let creatives: { rows: Creative[]; coveragePct: number | null; notSetSessions: number; note: string } | null = null;
  if (wantsCreatives && !creativeRes.error && creativeRes.data?.rows?.length) {
    const all = creativeRes.data.rows.map((r) => ({
      promotion: r.dimensionValues?.[0]?.value || "(not set)",
      creative: r.dimensionValues?.[1]?.value || "(not set)",
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      sharePct: null as number | null,
    }));
    const total = all.reduce((s, r) => s + r.sessions, 0);
    const notSet = all
      .filter((r) => r.promotion === "(not set)")
      .reduce((s, r) => s + r.sessions, 0);
    const named = all
      .filter((r) => r.promotion !== "(not set)")
      .map((r) => ({ ...r, sharePct: total > 0 ? Number(((r.sessions / total) * 100).toFixed(1)) : null }))
      .sort((a, b) => b.sessions - a.sessions);
    creatives = {
      rows: named,
      coveragePct: total > 0 ? Number((((total - notSet) / total) * 100).toFixed(1)) : null,
      notSetSessions: notSet,
      note:
        "Sessões atribuídas a cada promoção nomeada no dataLayer. Só métrica de sessão é compatível com dimensão de promoção no GA4, então aqui não há contagem de evento nem CTR. A cobertura abaixo de 100% é o quanto das sessões de promoção chegou sem nome.",
    };
  }

  return NextResponse.json(
    {
      propertyId,
      bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
      kind: kindParam,
      range: dateRange,
      spaces,
      creatives,
      totals: {
        // `spaces` continua sendo ESPAÇO distinto, não linha: o KPI "espaços
        // ativos" perderia o sentido se virasse contagem de peça.
        spaces: totalPorEspaco.size,
        pecas: spaces.length,
        pecasNomeadas: spaces.filter((r) => r.named).length,
        sessions: sessoesPorPeca,
        leads: spaces.reduce((s, r) => s + r.leads, 0),
        accounts: accountEvent ? spaces.reduce((s, r) => s + (r.accounts || 0), 0) : null,
        checkoutStarts: hasPurchase ? spaces.reduce((s, r) => s + (r.checkoutStarts || 0), 0) : null,
        purchases: hasPurchase ? spaces.reduce((s, r) => s + (r.purchases || 0), 0) : null,
      },
      /**
       * Verificação de integridade da quebra por peça, exposta de propósito.
       * Se a soma das peças não bate com o total por espaço, houve corte de
       * linha no GA4 e a tela precisa dizer, em vez de mostrar uma tabela que
       * não fecha e deixar o leitor descobrir sozinho.
       */
      integridade: {
        sessoesPorEspaco,
        sessoesPorPeca,
        diferenca: diferencaQuebra,
        fecha: Math.abs(diferencaQuebra) <= Math.max(1, sessoesPorEspaco * 0.005),
      },
      eventos: {
        cliques: "sessões com este utm_medium (a sessão entrou clicando no espaço)",
        leads: profile.mqlEvents
          ? `${profile.mqlEvents.qualified} + ${profile.mqlEvents.disqualified}`
          : profile.leadEvent,
        contaCriada: accountEvent,
        checkout: hasPurchase ? "begin_checkout" : null,
        compras: hasPurchase ? "purchase" : null,
        ctaClickObservacao: profile.ctaEvent
          ? `A coluna Checkout mede ${"begin_checkout"}, não ${profile.ctaEvent} filtrado por destino. Filtrar o ${profile.ctaEvent} por destino é impossível no GA4 hoje: customEvent:cta_destino é recusado pela API. O total bruto de ${profile.ctaEvent} vem no campo ctaClicksAll de cada linha, para contexto, e inclui WhatsApp, download e formulário além de checkout.`
          : null,
      },
      impressions,
      /**
       * Limitações que a UI é OBRIGADA a exibir. Não remover: foram medidas,
       * não são disclaimer defensivo.
       */
      /**
       * Regra universal do Grupo Suno: captação de lead mede `generate_lead`,
       * venda direta mede chegada ao checkout. As colunas da tela vêm separadas
       * por estratégia DE PROPÓSITO, senão um espaço que alimenta LP de captação
       * apareceria como fracasso por não gerar checkout.
       */
      bannerNameSource,
      bannerNameNote:
        bannerNameSource === "campaign"
          ? "Nome vindo de sessionCampaignName, do MESMO escopo de sessão do espaço, então o cruzamento é coerente. Na convenção da Suno a campanha nomeia a peça dentro do utm_campaign. É texto livre: não garante exatamente uma peça por linha." +
            (promoNamesIgnored
              ? " O dataLayer de promoção existe nesta property, mas itemPromotionName é item-scoped: cruzado com o espaço ele devolvia a MESMA peça em todos os espaços, porque responde 'promoção vista na sessão', não 'peça do espaço'. O ranking por promoção fica no bloco Criativas nomeadas, onde é honesto."
              : "")
          : "Não há nome disponível: sessionCampaignName não trouxe valor para estes espaços no período.",
      strategyNote:
        "Captação de lead mede generate_lead. Venda direta mede chegada ao checkout. Cada espaço deve ser cobrado pela estratégia que ele serve: espaço que manda gente para LP de captação não converte em checkout, e isso não é falha dele.",
      limitations: [
        wantsCreatives && creatives
          ? "Ranking de criativa disponível NESTA B.U.: o dataLayer de promoção está populado com promotion_name e creative_name. Falta o promotion_id, e a cobertura é parcial (o restante das sessões chega como (not set)). Nas outras B.U.s a criativa continua indisponível."
          : "Não há ranking de criativa nesta B.U.: as dimensões de promoção do GA4 (itemPromotionName, itemPromotionCreativeName) vêm apenas como (not set), porque o dataLayer de banner não envia o objeto promotion. O identificador mais fino disponível aqui é o ESPAÇO.",
        "CTR por espaço não é calculável: sessionMedium é dimensão de sessão e conta apenas quem ENTROU clicando. Não existe contagem de impressão nesse eixo. Por isso esta tela mostra cliques e conversão por espaço, e não CTR.",
        "A taxonomia de medium está fatiada por grafia (bannergam e bannerGAM, bannerfino e banner.fino e banner.thin, banner e banners). Os valores aqui já vêm normalizados e somados; a coluna de origem mostra quais grafias entraram em cada linha.",
        profile.ctaEvent
          ? `A coluna Checkout mede begin_checkout, ou seja quem CHEGOU no checkout, e não ${profile.ctaEvent} filtrado por destino. O filtro por destino não existe: customEvent:cta_destino é recusado pela API do GA4 nas duas properties (reconferido em 11/09/2026) e o Status não tem nenhuma dimensão cta_* registrada. Como o ${profile.ctaEvent} mistura checkout com WhatsApp, download e formulário, usá-lo inteiro nessa coluna infla o número. Registrar cta_destino em Admin > Definições personalizadas destrava a leitura pedida.`
          : "Esta B.U. não tem evento de clique em CTA registrado no GA4.",
        `O nome da peça vem de sessionCampaignName. Sessão que chegou pelo espaço sem campanha marcada aparece na linha "${"(sem nome de campanha)"}" em vez de sumir, porque somar só o que tem nome esconderia tráfego real e a tabela não fecharia com o total do espaço.`,
      ],
      caveats: profile.caveats,
    },
    { headers: { "Cache-Control": "private, max-age=180, stale-while-revalidate=600" } }
  );
}
