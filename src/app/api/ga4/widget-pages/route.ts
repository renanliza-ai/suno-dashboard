import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ga4/widget-pages
 *
 * Endpoint dedicado para perguntas do tipo "quais páginas têm o widget X e
 * quantos acessos tiveram?". Cruza eventos cujo nome contém um padrão (ex.:
 * "whatsapp") com a `pagePath` onde dispararam, agregando page views e users.
 *
 * Casos de uso:
 *   - WhatsApp widget: eventContains=whatsapp
 *   - Newsletter modal: eventContains=newsletter
 *   - Botão de download: eventContains=download
 *
 * Query params:
 *   propertyId       (obrigatório)
 *   eventContains    string. Filtra eventos cujo nome contém esse texto. Default: ""
 *   days             default 90 (3 meses) — esse endpoint serve perguntas de janela larga
 *   hostContains     opcional — restringe a um subdomínio (ex.: "research")
 *   limit            default 50
 */
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const eventContains = (req.nextUrl.searchParams.get("eventContains") || "").toLowerCase();
  const days = Number(req.nextUrl.searchParams.get("days") || 90);
  const hostContains = (req.nextUrl.searchParams.get("hostContains") || "").toLowerCase();
  const limit = Number(req.nextUrl.searchParams.get("limit") || 50);

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const dateRange = { startDate: `${days}daysAgo`, endDate: "today" };

  // 1) Eventos relacionados ao widget — pagePath + eventName + métricas
  // (eventCount + activeUsers + screenPageViews para descobrir engajamento)
  const eventsRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [
      { name: "hostName" },
      { name: "pagePath" },
      { name: "eventName" },
    ],
    metrics: [
      { name: "eventCount" },
      { name: "totalUsers" },
      { name: "screenPageViews" },
    ],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 500,
  });

  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error, pages: [] }, { status: 200 });
  }

  // Agrupa por (host + pagePath) e coleta os eventos que casam com o filtro
  type PageBucket = {
    host: string;
    path: string;
    url: string;
    pageviews: number;
    users: number;
    matchedEvents: { event: string; count: number }[];
  };
  const buckets = new Map<string, PageBucket>();

  for (const r of eventsRes.data?.rows || []) {
    const host = r.dimensionValues?.[0]?.value || "";
    const path = r.dimensionValues?.[1]?.value || "/";
    const eventName = r.dimensionValues?.[2]?.value || "";
    const eventCount = Number(r.metricValues?.[0]?.value || 0);
    const users = Number(r.metricValues?.[1]?.value || 0);
    const pageviews = Number(r.metricValues?.[2]?.value || 0);

    if (hostContains && !host.toLowerCase().includes(hostContains)) continue;

    const matchesEvent = eventContains && eventName.toLowerCase().includes(eventContains);
    // Sempre acumulamos pageviews/users no bucket; só sinalizamos eventos casados.
    const key = `${host}|${path}`;
    const cur = buckets.get(key) || {
      host,
      path,
      url: `${host}${path}`,
      pageviews: 0,
      users: 0,
      matchedEvents: [],
    };
    cur.pageviews = Math.max(cur.pageviews, pageviews); // pageviews é igual entre eventos
    cur.users = Math.max(cur.users, users);
    if (matchesEvent) {
      const existing = cur.matchedEvents.find((e) => e.event === eventName);
      if (existing) existing.count += eventCount;
      else cur.matchedEvents.push({ event: eventName, count: eventCount });
    }
    buckets.set(key, cur);
  }

  // Filtramos apenas páginas que tiveram pelo menos 1 evento casado
  const pagesWithWidget = Array.from(buckets.values())
    .filter((b) => b.matchedEvents.length > 0)
    .map((b) => ({
      ...b,
      totalEventCount: b.matchedEvents.reduce((s, e) => s + e.count, 0),
    }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, limit);

  // Total agregado
  const totalAccesses = pagesWithWidget.reduce((s, p) => s + p.pageviews, 0);
  const totalUsers = pagesWithWidget.reduce((s, p) => s + p.users, 0);
  const totalEvents = pagesWithWidget.reduce((s, p) => s + p.totalEventCount, 0);

  // Lista de eventos únicos detectados — útil para debug
  const detectedEvents = new Map<string, number>();
  for (const p of pagesWithWidget) {
    for (const e of p.matchedEvents) {
      detectedEvents.set(e.event, (detectedEvents.get(e.event) || 0) + e.count);
    }
  }
  const eventsList = Array.from(detectedEvents.entries())
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(
    {
      pages: pagesWithWidget,
      totals: {
        pages: pagesWithWidget.length,
        accesses: totalAccesses,
        users: totalUsers,
        events: totalEvents,
      },
      detectedEvents: eventsList,
      query: { eventContains, days, hostContains, limit },
    },
    {
      headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=3600" },
    }
  );
}
