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
 * Auditoria de 08/09/2026 na GA4 Data API, todas as properties: NÃO EXISTE
 * dimensão que identifique a criativa individual. As dimensões de promoção
 * (itemPromotionName, itemPromotionCreativeName) não têm valor populado porque
 * o dataLayer de banner não envia o objeto `promotion`. O identificador mais
 * fino que existe é o ESPAÇO, em `sessionMedium`.
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
 *   kind          banner | popup | todos (default "todos")
 *   startDate / endDate (YYYY-MM-DD) ou days (default 30)
 */

type SpaceRow = {
  space: string;
  rawMediums: string[];
  kind: SpaceKind;
  sessions: number;
  users: number;
  engagedSessions: number;
  engagementRate: number | null;
  leads: number;
  leadsSource: string;
  purchases: number | null;
  /** leads ÷ sessões geradas pelo espaço */
  leadRate: number | null;
  /** compras ÷ sessões geradas pelo espaço */
  purchaseRate: number | null;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const propertyName = sp.get("propertyName");
  const kindParam = (sp.get("kind") || "todos") as SpaceKind | "todos";
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
  if (hasPurchase) convEvents.push("purchase");

  const pair = impressionPairFor(profile);

  const [medRes, convRes, viewRes, clickRes] = await Promise.all([
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
    { kind: SpaceKind; sessions: number; users: number; engaged: number; raws: Set<string> }
  >();

  for (const r of medRes.data?.rows || []) {
    const raw = r.dimensionValues?.[0]?.value || "(none)";
    const kind = spaceKind(raw);
    if (kind === "outro") continue; // não é banner nem pop-up
    if (kindParam !== "todos" && kind !== kindParam) continue;

    const space = normalizeSpace(raw);
    const cur =
      agg.get(space) || { kind, sessions: 0, users: 0, engaged: 0, raws: new Set<string>() };
    cur.sessions += Number(r.metricValues?.[0]?.value || 0);
    cur.users += Number(r.metricValues?.[1]?.value || 0);
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
      return {
        space,
        rawMediums: Array.from(v.raws).sort(),
        kind: v.kind,
        sessions: v.sessions,
        users: v.users,
        engagedSessions: v.engaged,
        engagementRate: v.sessions > 0 ? Number(((v.engaged / v.sessions) * 100).toFixed(1)) : null,
        leads: conv.leads,
        leadsSource: conv.leadsSource,
        purchases,
        leadRate: v.sessions > 0 ? Number(((conv.leads / v.sessions) * 100).toFixed(2)) : null,
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

  return NextResponse.json(
    {
      propertyId,
      bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
      kind: kindParam,
      range: dateRange,
      spaces,
      totals: {
        spaces: spaces.length,
        sessions: spaces.reduce((s, r) => s + r.sessions, 0),
        leads: spaces.reduce((s, r) => s + r.leads, 0),
        purchases: hasPurchase ? spaces.reduce((s, r) => s + (r.purchases || 0), 0) : null,
      },
      impressions,
      /**
       * Limitações que a UI é OBRIGADA a exibir. Não remover: foram medidas,
       * não são disclaimer defensivo.
       */
      limitations: [
        "Não existe ranking de banner individual: nenhuma property tem dimensão que identifique a criativa. O dataLayer de banner não envia o objeto `promotion` (promotion_id, promotion_name, creative_name, creative_slot), então o GA4 não tem o que consultar. O identificador mais fino disponível é o ESPAÇO.",
        "CTR por espaço não é calculável: `sessionMedium` é dimensão de sessão e conta apenas quem ENTROU clicando. Não existe contagem de impressão nesse eixo. Por isso esta tela mostra cliques e conversão por espaço, e não CTR.",
        "A taxonomia de medium está fatiada por grafia (bannergam e bannerGAM, bannerfino e banner.fino e banner.thin, banner e banners). Os valores aqui já vêm normalizados e somados; a coluna de origem mostra quais grafias entraram em cada linha.",
      ],
      caveats: profile.caveats,
    },
    { headers: { "Cache-Control": "private, max-age=180, stale-while-revalidate=600" } }
  );
}
