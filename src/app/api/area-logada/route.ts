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

  // Subscription Status: tenta query com customUser:subscription_status.
  // Se a dimension não existir, GA4 retorna erro — capturamos e seguimos.
  const subscriptionStatusPromise = runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "customUser:subscription_status" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: onboardingFilter,
  }).catch((e) => ({ data: null, error: (e as Error).message }));

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

  // Subscription Status — pode falhar se custom dim não existir
  const subscriptionStatus =
    subscriptionStatusRes && "error" in subscriptionStatusRes && subscriptionStatusRes.error
      ? {
          available: false,
          error: subscriptionStatusRes.error,
          rows: [],
        }
      : {
          available: true,
          error: null,
          rows: ((subscriptionStatusRes as { data: { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] } | null }).data?.rows || []).map((r) => ({
            status: r.dimensionValues?.[0]?.value || "(unknown)",
            users: Number(r.metricValues?.[0]?.value || 0),
          })),
        };

  return NextResponse.json(
    {
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
      caveat:
        "Análise paralela: blocos Onboarding e Compras NÃO são cruzados 1:1 (limitação GA4 sem User-ID). Demographics/Affinity vêm de Google Signals e cobrem ~30-60% dos users.",
    },
    { headers: { "Cache-Control": "private, max-age=900" } }
  );
}
