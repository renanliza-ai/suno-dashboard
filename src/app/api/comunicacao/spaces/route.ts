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

type SpaceRow = {
  space: string;
  rawMediums: string[];
  kind: SpaceKind;
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  leads: number;
  leadsSource: string;
  /**
   * Estratégia B: chegada ao checkout (begin_checkout) atribuída ao espaço.
   * Mesma âncora usada na aba de Landing Pages, para as duas telas não medirem
   * venda de formas diferentes.
   */
  checkoutStarts: number | null;
  purchases: number | null;
  /** leads ÷ sessões geradas pelo espaço */
  leadRate: number | null;
  /** chegadas ao checkout ÷ sessões geradas pelo espaço */
  checkoutRate: number | null;
  /** compras ÷ sessões geradas pelo espaço */
  purchaseRate: number | null;
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
  // `purchase` só existe onde há checkout.
  const hasPurchase = profile.conversionModel === "captacao_venda";
  // Regra universal Suno: captação mede generate_lead, venda mede chegada ao
  // checkout. Os dois entram aqui para a tela poder separar as ESTRATÉGIAS em
  // vez de misturar tudo numa coluna de "conversão".
  if (hasPurchase) convEvents.push("begin_checkout", "purchase");

  const pair = impressionPairFor(profile, kindParam);

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

  const [medRes, convRes, viewRes, clickRes, creativeRes] = await Promise.all([
    // 1. Sessões por medium. É o clique: a sessão entrou por aquele espaço.
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 1000,
    }),
    // 2. Conversão a jusante por medium.
    convEvents.length > 0
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "sessionMedium" }, { name: "eventName" }],
          metrics: [{ name: "eventCount" }],
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
          limit: 2000,
          dimensionFilter: {
            filter: { fieldName: "eventName", inListFilter: { values: convEvents } },
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
  ]);

  if (medRes.error) {
    return NextResponse.json(
      { propertyId, bu: { key: profile.key, label: profile.label }, error: medRes.error, spaces: [] },
      { status: 200 }
    );
  }

  // Conversão por medium normalizado
  const convByMedium = new Map<string, Record<string, number>>();
  for (const r of convRes.data?.rows || []) {
    const med = normalizeSpace(r.dimensionValues?.[0]?.value || "");
    const ev = r.dimensionValues?.[1]?.value || "";
    const n = Number(r.metricValues?.[0]?.value || 0);
    const b = convByMedium.get(med) || {};
    b[ev] = (b[ev] || 0) + n;
    convByMedium.set(med, b);
  }

  // Agrega por espaço normalizado. Guarda as grafias cruas para a UI poder
  // mostrar que `bannergam` e `bannerGAM` foram somados, em vez de esconder.
  const agg = new Map<
    string,
    { kind: SpaceKind; sessions: number; engaged: number; raws: Set<string> }
  >();

  for (const r of medRes.data?.rows || []) {
    const raw = r.dimensionValues?.[0]?.value || "(none)";
    const kind = spaceKind(raw);
    if (kind === "outro") continue; // não é banner nem pop-up
    if (kindParam !== "todos" && kind !== kindParam) continue;

    const space = normalizeSpace(raw);
    const cur =
      agg.get(space) || { kind, sessions: 0, engaged: 0, raws: new Set<string>() };
    cur.sessions += Number(r.metricValues?.[0]?.value || 0);
    cur.engaged += Number(r.metricValues?.[2]?.value || 0);
    cur.raws.add(raw);
    agg.set(space, cur);
  }

  const spaces: SpaceRow[] = Array.from(agg.entries())
    .map(([space, v]) => {
      const bucket = convByMedium.get(space) || {};
      const conv = computeLPConversion(profile, {
        sessions: v.sessions,
        leadEventCount: profile.leadEvent ? bucket[profile.leadEvent] || 0 : 0,
        qualified: profile.mqlEvents ? bucket[profile.mqlEvents.qualified] || 0 : 0,
        disqualified: profile.mqlEvents ? bucket[profile.mqlEvents.disqualified] || 0 : 0,
        ctaCount: 0,
      });
      const purchases = hasPurchase ? bucket["purchase"] || 0 : null;
      const checkoutStarts = hasPurchase ? bucket["begin_checkout"] || 0 : null;
      return {
        space,
        rawMediums: Array.from(v.raws).sort(),
        kind: v.kind,
        sessions: v.sessions,
        engagedSessions: v.engaged,
        engagementRate: v.sessions > 0 ? Number(((v.engaged / v.sessions) * 100).toFixed(1)) : null,
        leads: conv.leads,
        leadsSource: conv.leadsSource,
        checkoutStarts,
        purchases,
        leadRate: v.sessions > 0 ? Number(((conv.leads / v.sessions) * 100).toFixed(2)) : null,
        checkoutRate:
          checkoutStarts !== null && v.sessions > 0
            ? Number(((checkoutStarts / v.sessions) * 100).toFixed(2))
            : null,
        purchaseRate:
          purchases !== null && v.sessions > 0
            ? Number(((purchases / v.sessions) * 100).toFixed(2))
            : null,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

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
        spaces: spaces.length,
        sessions: spaces.reduce((s, r) => s + r.sessions, 0),
        leads: spaces.reduce((s, r) => s + r.leads, 0),
        checkoutStarts: hasPurchase ? spaces.reduce((s, r) => s + (r.checkoutStarts || 0), 0) : null,
        purchases: hasPurchase ? spaces.reduce((s, r) => s + (r.purchases || 0), 0) : null,
      },
      impressions,
      /**
       * Limitações que a UI é OBRIGADA a exibir. Não remover: foram medidas,
       * não são disclaimer defensivo.
       */
      limitations: [
        wantsCreatives && creatives
          ? "Ranking de criativa disponível NESTA B.U.: o dataLayer de promoção está populado com promotion_name e creative_name. Falta o promotion_id, e a cobertura é parcial (o restante das sessões chega como (not set)). Nas outras B.U.s a criativa continua indisponível."
          : "Não há ranking de criativa nesta B.U.: as dimensões de promoção do GA4 (itemPromotionName, itemPromotionCreativeName) vêm apenas como (not set), porque o dataLayer de banner não envia o objeto promotion. O identificador mais fino disponível aqui é o ESPAÇO.",
        "CTR por espaço não é calculável: sessionMedium é dimensão de sessão e conta apenas quem ENTROU clicando. Não existe contagem de impressão nesse eixo. Por isso esta tela mostra cliques e conversão por espaço, e não CTR.",
        "A taxonomia de medium está fatiada por grafia (bannergam e bannerGAM, bannerfino e banner.fino e banner.thin, banner e banners). Os valores aqui já vêm normalizados e somados; a coluna de origem mostra quais grafias entraram em cada linha.",
      ],
      caveats: profile.caveats,
    },
    { headers: { "Cache-Control": "private, max-age=180, stale-while-revalidate=600" } }
  );
}
