import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/area-logada
 *
 * 🌐 Pública (qualquer usuário logado no painel pode ver — não tem mais
 * gate master).
 *
 * Análise dedicada da Área Logada (NAI).
 * Default: investidor.suno.com.br/onboarding, mas configurável.
 *
 * 12 queries paralelas pra cobrir 6 ângulos:
 *
 *   1. Onboarding totals (users, sessions, pageviews, bounce, tempo médio)
 *   2. Mensal — yearMonth pra evolução do volume
 *   3. Device + Channel breakdown da página
 *   4. Purchases globais no MESMO período (paralelo, não cruzado)
 *   5. Plans (item_name + category) — perfil de assinatura
 *   6. Demographics:
 *      - Faixa etária × plano (cruza userAgeBracket com itemName em purchases)
 *      - Gênero × plano
 *   7. Geo (country + region × plano)
 *   8. Affinity / ICP (brandingInterest)
 *   9. New vs Returning (proxy de engajamento)
 *   10. Subscription Status (tenta custom dimension — fallback se não existe)
 *
 * Limitações:
 *   - Demographics (idade/gênero) e Affinity só populam pra ~30-60% dos
 *     users (Google Signals ON + user logado em conta Google)
 *   - Subscription Status precisa de custom dim 'subscription_status'
 *     (user-scoped) populada via dataLayer
 */

export async function GET(req: NextRequest) {
  // Removido o gate master — agora é pública
  const propertyId = req.nextUrl.searchParams.get("propertyId") || "263739159";
  const startDate = req.nextUrl.searchParams.get("startDate") || "2025-11-01";
  const endDate = req.nextUrl.searchParams.get("endDate") || new Date().toISOString().slice(0, 10);
  const pagePath = req.nextUrl.searchParams.get("pagePath") || "/onboarding";
  const hostname = req.nextUrl.searchParams.get("hostname") || "investidor.suno.com.br";
  // Nome da custom dimension de subscription status — configurável caso
  // o time tenha registrado com nome diferente
  const subDimName =
    req.nextUrl.searchParams.get("subscriptionDim") || "subscription_status";
  // Nome da custom dim de plano: Suno usa membership_name, Statusinvest usa plan_id
  // Default tenta Suno; cliente pode passar planDim explicitamente
  const planDimName = req.nextUrl.searchParams.get("planDim") || "membership_name";
  // Nome da custom dim de data de fim — pra detectar quem está perto do vencimento
  const endDateDimName =
    req.nextUrl.searchParams.get("endDateDim") || "membership_end_date";

  const dateRange = { startDate, endDate };

  const onboardingFilter = {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "hostName",
            stringFilter: { value: hostname, matchType: "EXACT" as const },
          },
        },
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: { value: pagePath, matchType: "EXACT" as const },
          },
        },
      ],
    },
  };

  /**
   * Subscription Status: GA4 distingue 2 escopos de custom dimension.
   *
   *   - customUser:NOME  → registrado como User-scoped (dataLayer
   *     gtag('set', 'user_properties', { subscription_status: ... }))
   *   - customEvent:NOME → registrado como Event-scoped (dataLayer
   *     dataLayer.push({ event: 'X', subscription_status: ... }))
   *
   * O Renan disse que passa via dataLayer, mas pode ser qualquer um
   * dos 2 dependendo de como GTM foi configurado. Tentamos os 2 em
   * paralelo e usamos o que retornou dado.
   */
  type SubsRes = { data: { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] } | null; error: string | null };

  // 2 modos de query: GLOBAL (toda property) e FILTERED (só /onboarding)
  // Depois mesclamos pra mostrar os 2 panoramas — global mostra a base
  // total de assinantes da property, filtrado mostra só quem passou no path.
  const trySubscriptionDim = async (dimName: string, applyFilter: boolean): Promise<SubsRes> => {
    try {
      const r = await runReport(propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: dimName }],
        metrics: [{ name: "totalUsers" }],
        ...(applyFilter ? { dimensionFilter: onboardingFilter } : {}),
      });
      return r;
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  };

  const subscriptionStatusPromise = (async () => {
    // Tenta os 3 escopos × 2 modos (global e filtered) — 6 queries paralelas
    const [
      userScopedG, userScopedF,
      eventScopedG, eventScopedF,
      plainG, plainF,
    ] = await Promise.all([
      trySubscriptionDim(`customUser:${subDimName}`, false),
      trySubscriptionDim(`customUser:${subDimName}`, true),
      trySubscriptionDim(`customEvent:${subDimName}`, false),
      trySubscriptionDim(`customEvent:${subDimName}`, true),
      trySubscriptionDim(subDimName, false),
      trySubscriptionDim(subDimName, true),
    ]);

    type Candidate = { resG: SubsRes; resF: SubsRes; scope: string };
    const candidates: Candidate[] = [
      { resG: userScopedG, resF: userScopedF, scope: "user" },
      { resG: eventScopedG, resF: eventScopedF, scope: "event" },
      { resG: plainG, resF: plainF, scope: "auto" },
    ];

    // Pega o primeiro escopo que retornou rows na query GLOBAL (mais
    // permissiva — se nem ela retornou, é problema de configuração)
    const winner = candidates.find(
      (c) => !c.resG.error && (c.resG.data?.rows?.length || 0) > 0
    );

    const parseRows = (res: SubsRes) =>
      (res.data?.rows || []).map((r) => ({
        status: r.dimensionValues?.[0]?.value || "(unknown)",
        users: Number(r.metricValues?.[0]?.value || 0),
      }));

    if (winner) {
      return {
        data: winner.resG.data,
        error: null,
        scope: winner.scope,
        dimName: subDimName,
        rowsGlobal: parseRows(winner.resG),
        rowsFiltered: parseRows(winner.resF),
        errors: candidates.map((c) => ({ scope: c.scope, error: c.resG.error })),
      };
    }

    return {
      data: null,
      error:
        candidates.find((c) => c.resG.error)?.resG.error ||
        `nenhum scope retornou dados pra '${subDimName}'`,
      scope: null,
      dimName: subDimName,
      rowsGlobal: [],
      rowsFiltered: [],
      errors: candidates.map((c) => ({ scope: c.scope, error: c.resG.error })),
    };
  })();

  // ============================================================
  // USER_LOGIN — queries dedicadas pro storytelling do topo da página.
  // Estratégia: tentar 3 escopos pra cada custom dim (user/event/plain).
  // Suno usa: subscription_status, membership_name, membership_end_date
  // Statusinvest usa: membership_status, plan_id, (sem end_date populado)
  // ============================================================
  const tryLoginQuery = async (
    dimName: string | null
  ): Promise<{ data: { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] } | null; error: string | null; usedDim: string | null }> => {
    const variants = dimName
      ? [`customUser:${dimName}`, `customEvent:${dimName}`, dimName]
      : [null];
    for (const v of variants) {
      try {
        const body: Parameters<typeof runReport>[1] = {
          dateRanges: [dateRange],
          metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
          dimensionFilter: {
            filter: {
              fieldName: "eventName",
              stringFilter: { value: "user_login", matchType: "EXACT" as const },
            },
          },
        };
        if (v) {
          body.dimensions = [{ name: v }];
          body.orderBys = [{ metric: { metricName: "eventCount" }, desc: true }];
          body.limit = 50;
        }
        const r = await runReport(propertyId, body);
        if (r.error) continue;
        const rows = r.data?.rows || [];
        // Se tentou com dim e veio vazio, tenta próximo escopo
        if (v && rows.length === 0) continue;
        return { data: r.data, error: null, usedDim: v };
      } catch {
        continue;
      }
    }
    return { data: null, error: `nenhum scope retornou dados pra ${dimName || "totals"}`, usedDim: null };
  };

  // 4 queries paralelas para o storytelling de user_login
  const loginPromises = Promise.all([
    tryLoginQuery(null), // total de logins (sem breakdown)
    tryLoginQuery(planDimName), // logins por plano
    tryLoginQuery(subDimName), // logins por status
    tryLoginQuery(endDateDimName), // logins por data de vencimento
  ]);

  const [
    onboardingTotalRes,
    onboardingMonthlyRes,
    onboardingDeviceRes,
    onboardingChannelRes,
    purchaseTotalRes,
    purchasePlansRes,
    ageByPlanRes,
    genderByPlanRes,
    geoByPlanRes,
    affinityRes,
    audienceMixRes,
    subscriptionStatusRes,
  ] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [
        { name: "totalUsers" },
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      dimensionFilter: onboardingFilter,
      metricAggregations: ["TOTAL"],
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "yearMonth" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ dimension: { dimensionName: "yearMonth", orderType: "NUMERIC" }, desc: false }],
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      dimensionFilter: onboardingFilter,
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 15,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [{ name: "totalRevenue" }, { name: "purchaseRevenue" }, { name: "transactions" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["purchase", "purchase_success"] },
        },
      },
      metricAggregations: ["TOTAL"],
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "itemName" }, { name: "itemCategory" }],
      metrics: [{ name: "itemsPurchased" }, { name: "itemRevenue" }],
      orderBys: [{ metric: { metricName: "itemsPurchased" }, desc: true }],
      limit: 30,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "userAgeBracket" }, { name: "itemName" }],
      metrics: [{ name: "itemsPurchased" }, { name: "itemRevenue" }],
      orderBys: [{ metric: { metricName: "itemsPurchased" }, desc: true }],
      limit: 100,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "userGender" }, { name: "itemName" }],
      metrics: [{ name: "itemsPurchased" }, { name: "itemRevenue" }],
      orderBys: [{ metric: { metricName: "itemsPurchased" }, desc: true }],
      limit: 100,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "country" }, { name: "region" }, { name: "itemName" }],
      metrics: [{ name: "itemsPurchased" }, { name: "itemRevenue" }],
      orderBys: [{ metric: { metricName: "itemsPurchased" }, desc: true }],
      limit: 100,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "brandingInterest" }],
      metrics: [{ name: "totalUsers" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 25,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "newVsReturning" }],
      metrics: [{ name: "totalUsers" }, { name: "engagedSessions" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 10,
    }),
    subscriptionStatusPromise,
  ]);

  // Aguarda as queries de user_login em paralelo
  const [loginTotalRes, loginByPlanRes, loginByStatusRes, loginByEndDateRes] =
    await loginPromises;

  const readTotal = (
    res: {
      data: {
        rows?: { metricValues?: { value: string }[] }[];
        totals?: { metricValues?: { value: string }[] }[];
      } | null;
    },
    idx: number
  ) => {
    return Number(
      res.data?.rows?.[0]?.metricValues?.[idx]?.value ||
        res.data?.totals?.[0]?.metricValues?.[idx]?.value ||
        0
    );
  };

  const onboarding = {
    totalUsers: readTotal(onboardingTotalRes, 0),
    activeUsers: readTotal(onboardingTotalRes, 1),
    sessions: readTotal(onboardingTotalRes, 2),
    pageViews: readTotal(onboardingTotalRes, 3),
    avgSessionDuration: Math.round(readTotal(onboardingTotalRes, 4)),
    bounceRate: Number((readTotal(onboardingTotalRes, 5) * 100).toFixed(1)),
    error: onboardingTotalRes.error,
  };

  const monthly = (onboardingMonthlyRes.data?.rows || []).map((r) => {
    const ym = r.dimensionValues?.[0]?.value || "";
    const formatted = ym.length === 6 ? `${ym.slice(4, 6)}/${ym.slice(0, 4)}` : ym;
    return {
      month: ym,
      label: formatted,
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions: Number(r.metricValues?.[1]?.value || 0),
      pageViews: Number(r.metricValues?.[2]?.value || 0),
    };
  });

  const devices = (onboardingDeviceRes.data?.rows || []).map((r) => ({
    device: r.dimensionValues?.[0]?.value || "",
    users: Number(r.metricValues?.[0]?.value || 0),
    sessions: Number(r.metricValues?.[1]?.value || 0),
  }));

  const channels = (onboardingChannelRes.data?.rows || []).map((r) => ({
    channel: r.dimensionValues?.[0]?.value || "",
    users: Number(r.metricValues?.[0]?.value || 0),
    sessions: Number(r.metricValues?.[1]?.value || 0),
  }));

  const purchases = {
    totalRevenue: readTotal(purchaseTotalRes, 0),
    purchaseRevenue: readTotal(purchaseTotalRes, 1),
    transactions: readTotal(purchaseTotalRes, 2),
  };

  const plans = (purchasePlansRes.data?.rows || []).map((r) => ({
    itemName: r.dimensionValues?.[0]?.value || "(sem nome)",
    itemCategory: r.dimensionValues?.[1]?.value || "(sem categoria)",
    quantity: Number(r.metricValues?.[0]?.value || 0),
    revenue: Number(r.metricValues?.[1]?.value || 0),
  }));

  const ageByPlan = (ageByPlanRes.data?.rows || [])
    .map((r) => ({
      ageBracket: r.dimensionValues?.[0]?.value || "(unknown)",
      itemName: r.dimensionValues?.[1]?.value || "(sem nome)",
      quantity: Number(r.metricValues?.[0]?.value || 0),
      revenue: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.ageBracket !== "(unknown)" && r.ageBracket !== "(other)");

  const genderByPlan = (genderByPlanRes.data?.rows || [])
    .map((r) => ({
      gender: r.dimensionValues?.[0]?.value || "(unknown)",
      itemName: r.dimensionValues?.[1]?.value || "(sem nome)",
      quantity: Number(r.metricValues?.[0]?.value || 0),
      revenue: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.gender !== "(unknown)" && r.gender !== "(other)" && r.gender);

  const geoByPlan = (geoByPlanRes.data?.rows || [])
    .map((r) => ({
      country: r.dimensionValues?.[0]?.value || "",
      region: r.dimensionValues?.[1]?.value || "",
      itemName: r.dimensionValues?.[2]?.value || "(sem nome)",
      quantity: Number(r.metricValues?.[0]?.value || 0),
      revenue: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.country && r.region);

  const affinity = (affinityRes.data?.rows || [])
    .map((r) => ({
      interest: r.dimensionValues?.[0]?.value || "",
      users: Number(r.metricValues?.[0]?.value || 0),
      engagedSessions: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.interest && r.interest !== "(other)" && r.interest !== "(not set)");

  const audienceMix = (audienceMixRes.data?.rows || [])
    .map((r) => ({
      type: r.dimensionValues?.[0]?.value || "",
      users: Number(r.metricValues?.[0]?.value || 0),
      engagedSessions: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.type);

  // Subscription Status — retorna 2 panoramas (global da property + filtrado por página)
  type SubsResponse = {
    data: { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] } | null;
    error: string | null;
    scope: string | null;
    dimName: string;
    rowsGlobal: { status: string; users: number }[];
    rowsFiltered: { status: string; users: number }[];
    errors: { scope: string; error: string | null }[];
  };
  const subRes = subscriptionStatusRes as SubsResponse;

  const subscriptionStatus = subRes.error
    ? {
        available: false,
        error: subRes.error,
        scope: null,
        dimName: subRes.dimName,
        errors: subRes.errors,
        rowsGlobal: [],
        rowsFiltered: [],
      }
    : {
        available: true,
        error: null,
        scope: subRes.scope,
        dimName: subRes.dimName,
        errors: subRes.errors,
        rowsGlobal: subRes.rowsGlobal,
        rowsFiltered: subRes.rowsFiltered,
      };

  // ============================================================
  // USER_LOGIN — processa as 4 queries de storytelling do topo
  // ============================================================

  // Total geral de logins (data tem só rows; runReport sem dimensão volta em rows[0])
  const totalLoginEvents = Number(
    loginTotalRes.data?.rows?.[0]?.metricValues?.[0]?.value || 0
  );
  const totalLoginUsers = Number(
    loginTotalRes.data?.rows?.[0]?.metricValues?.[1]?.value || 0
  );

  // Breakdown por plano
  const loginByPlan = (loginByPlanRes.data?.rows || [])
    .map((r) => ({
      plan: r.dimensionValues?.[0]?.value || "(sem plano)",
      events: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.plan && r.plan !== "(not set)" && r.plan !== "(other)");

  // Breakdown por status (active, pending, canceled, free, none, etc)
  const loginByStatus = (loginByStatusRes.data?.rows || [])
    .map((r) => ({
      status: r.dimensionValues?.[0]?.value || "(sem status)",
      events: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
    }))
    .filter((r) => r.status && r.status !== "(not set)" && r.status !== "(other)");

  // Quem está perto do vencimento (membership_end_date dentro dos próximos 30/60/90d)
  // Filtra apenas datas válidas ISO YYYY-MM-DD ou similar
  const today = new Date();
  const in30d = new Date(today);
  in30d.setDate(today.getDate() + 30);
  const in60d = new Date(today);
  in60d.setDate(today.getDate() + 60);
  const in90d = new Date(today);
  in90d.setDate(today.getDate() + 90);

  const endDateRows = (loginByEndDateRes.data?.rows || [])
    .map((r) => {
      const dateStr = r.dimensionValues?.[0]?.value || "";
      // Tenta parsear ISO. Suno passa "2025-11-06", Statusinvest passa
      // "0001-01-01T00:00:00+00:00" (data inválida) que vamos filtrar.
      let parsedDate: Date | null = null;
      if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime()) && d.getFullYear() > 1900) parsedDate = d;
      }
      return {
        rawDate: dateStr,
        parsedDate,
        events: Number(r.metricValues?.[0]?.value || 0),
        users: Number(r.metricValues?.[1]?.value || 0),
      };
    })
    .filter((r) => r.parsedDate !== null);

  const expiringIn30d = endDateRows
    .filter((r) => r.parsedDate! >= today && r.parsedDate! <= in30d)
    .reduce(
      (acc, r) => ({ events: acc.events + r.events, users: acc.users + r.users }),
      { events: 0, users: 0 }
    );
  const expiringIn60d = endDateRows
    .filter((r) => r.parsedDate! >= today && r.parsedDate! <= in60d)
    .reduce(
      (acc, r) => ({ events: acc.events + r.events, users: acc.users + r.users }),
      { events: 0, users: 0 }
    );
  const expiringIn90d = endDateRows
    .filter((r) => r.parsedDate! >= today && r.parsedDate! <= in90d)
    .reduce(
      (acc, r) => ({ events: acc.events + r.events, users: acc.users + r.users }),
      { events: 0, users: 0 }
    );
  const expired = endDateRows
    .filter((r) => r.parsedDate! < today)
    .reduce(
      (acc, r) => ({ events: acc.events + r.events, users: acc.users + r.users }),
      { events: 0, users: 0 }
    );

  const userLogin = {
    totalEvents: totalLoginEvents,
    totalUsers: totalLoginUsers,
    byPlan: loginByPlan,
    byStatus: loginByStatus,
    expiring: {
      in30d: expiringIn30d,
      in60d: expiringIn60d,
      in90d: expiringIn90d,
      expired,
    },
    usedDims: {
      total: loginTotalRes.usedDim || null,
      plan: loginByPlanRes.usedDim || null,
      status: loginByStatusRes.usedDim || null,
      endDate: loginByEndDateRes.usedDim || null,
    },
    errors: {
      total: loginTotalRes.error,
      plan: loginByPlanRes.error,
      status: loginByStatusRes.error,
      endDate: loginByEndDateRes.error,
    },
    // Pra UI explicar o que aconteceu
    notes: {
      planDimRequested: planDimName,
      statusDimRequested: subDimName,
      endDateDimRequested: endDateDimName,
      hint: "user_login event capturado via dataLayer. Breakdowns requerem custom dimensions registradas no GA4 Admin.",
    },
  };

  return NextResponse.json(
    {
      propertyId, // anti race-condition
      query: { propertyId, startDate, endDate, pagePath, hostname },
      onboarding,
      monthly,
      devices,
      channels,
      purchases,
      plans,
      demographics: {
        ageByPlan,
        genderByPlan,
        coverageNote:
          "Idade e gênero só populam pra ~30-60% dos users (precisa Google Signals ON no GA4 + user logado em conta Google).",
      },
      geo: { geoByPlan },
      affinity,
      audienceMix,
      subscriptionStatus,
      userLogin, // novo bloco: storytelling de quem loga
      caveat:
        "Análise paralela: blocos Onboarding e Compras NÃO são cruzados 1:1 (limitação GA4 sem User-ID). Demographics/Affinity vêm de Google Signals e cobrem ~30-60% dos users.",
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
