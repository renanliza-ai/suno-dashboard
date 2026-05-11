import { getRealtimeActive, runRealtimeReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  // unifiedScreenName tende a retornar o page_title em web; pra debug mantemos o path
  // também via unifiedPagePathScreen (alias do Realtime API p/ pagePath no web).
  const [active, pages, pagesAlt, devices, countries, events, sources, locations] = await Promise.all([
    getRealtimeActive(propertyId),
    runRealtimeReport(propertyId, {
      dimensions: [{ name: "unifiedPagePathScreen" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      limit: 10,
    }),
    // Fallback: algumas properties só populam `unifiedScreenName` (page_title)
    // ou misturam app+web. Buscamos os dois e usamos o que vier com dados.
    runRealtimeReport(propertyId, {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      limit: 10,
    }),
    runRealtimeReport(propertyId, {
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }],
    }),
    runRealtimeReport(propertyId, {
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      limit: 5,
    }),
    runRealtimeReport(propertyId, {
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      limit: 8,
    }),
    runRealtimeReport(propertyId, {
      // Realtime API não expõe sessionSource, mas expõe platform (web/android/ios) e streamName.
      // Para visão de "origem em tempo real", usamos minutesAgo dimension agregada por platform.
      dimensions: [{ name: "platform" }],
      metrics: [{ name: "activeUsers" }],
      limit: 5,
    }),
    // Localização granular: estado (region) + cidade — top 10 dos últimos 30 min.
    // "region" no GA4 é o estado (SP, RJ, MG...) para BR.
    runRealtimeReport(propertyId, {
      dimensions: [{ name: "country" }, { name: "region" }, { name: "city" }],
      metrics: [{ name: "activeUsers" }],
      limit: 10,
    }),
  ]);

  // Escolhe o conjunto de páginas que veio com dados (path > screenName).
  const pagesPrimary = pages.data?.rows || [];
  const pagesFallback = pagesAlt.data?.rows || [];
  const chosenPages = pagesPrimary.length > 0 ? pagesPrimary : pagesFallback;

  return NextResponse.json({
    propertyId, // anti race-condition entre polls de realtime quando troca property
    active: active.data?.active ?? 0,
    pages:
      chosenPages.map((r) => ({
        path: r.dimensionValues?.[0]?.value || "",
        users: Number(r.metricValues?.[0]?.value || 0),
        views: Number(r.metricValues?.[1]?.value || 0),
      })) || [],
    devices:
      devices.data?.rows?.map((r) => ({
        name: r.dimensionValues?.[0]?.value || "",
        value: Number(r.metricValues?.[0]?.value || 0),
      })) || [],
    countries:
      countries.data?.rows?.map((r) => ({
        country: r.dimensionValues?.[0]?.value || "",
        users: Number(r.metricValues?.[0]?.value || 0),
      })) || [],
    events:
      events.data?.rows?.map((r) => ({
        event: r.dimensionValues?.[0]?.value || "",
        count: Number(r.metricValues?.[0]?.value || 0),
      })) || [],
    platforms:
      sources.data?.rows?.map((r) => ({
        source: r.dimensionValues?.[0]?.value || "",
        users: Number(r.metricValues?.[0]?.value || 0),
      })) || [],
    locations:
      locations.data?.rows?.map((r) => ({
        country: r.dimensionValues?.[0]?.value || "",
        region: r.dimensionValues?.[1]?.value || "",
        city: r.dimensionValues?.[2]?.value || "",
        users: Number(r.metricValues?.[0]?.value || 0),
      })) || [],
  });
}
