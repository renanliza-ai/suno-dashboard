import { runGSCQuery, buildGSCDateRange } from "@/lib/gsc-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/seo/pages
 *
 * Top páginas com tráfego orgânico (Google).
 * Retorna URL, clicks, impressões, CTR, posição média.
 */
export async function GET(req: NextRequest) {
  const siteUrl = req.nextUrl.searchParams.get("siteUrl");
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const limit = Number(req.nextUrl.searchParams.get("limit") || 50);
  const startDateQ = req.nextUrl.searchParams.get("startDate");
  const endDateQ = req.nextUrl.searchParams.get("endDate");

  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });

  const range = buildGSCDateRange(days, startDateQ, endDateQ);

  const res = await runGSCQuery(siteUrl, {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: ["page"],
    rowLimit: limit,
  });

  if (res.error) {
    return NextResponse.json({ error: res.error, pages: [] }, { status: 200 });
  }

  const pages = (res.data?.rows || []).map((r) => ({
    url: r.keys[0],
    // Path relativo pra UI (mais legível que URL inteira)
    path: (() => {
      try {
        return new URL(r.keys[0]).pathname;
      } catch {
        return r.keys[0];
      }
    })(),
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Number((r.ctr * 100).toFixed(2)),
    position: Number(r.position.toFixed(1)),
  }));

  return NextResponse.json(
    { pages, range },
    {
      headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=3600" },
    }
  );
}
