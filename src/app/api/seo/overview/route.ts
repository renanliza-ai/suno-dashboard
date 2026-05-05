import { runGSCQuery, buildGSCDateRange } from "@/lib/gsc-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/seo/overview
 *
 * KPIs SEO: clicks totais, impressões totais, CTR médio, posição média.
 * Também retorna a série diária (clicks por dia) para o gráfico de tendência.
 */
export async function GET(req: NextRequest) {
  const siteUrl = req.nextUrl.searchParams.get("siteUrl");
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateQ = req.nextUrl.searchParams.get("startDate");
  const endDateQ = req.nextUrl.searchParams.get("endDate");

  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });

  const range = buildGSCDateRange(days, startDateQ, endDateQ);

  // Faz 2 queries em paralelo: total agregado + série diária
  const [totals, daily] = await Promise.all([
    runGSCQuery(siteUrl, {
      startDate: range.startDate,
      endDate: range.endDate,
      // sem dimensions = retorna o agregado total como uma única linha
      rowLimit: 1,
    }),
    runGSCQuery(siteUrl, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["date"],
      rowLimit: 1000,
    }),
  ]);

  if (totals.error) {
    return NextResponse.json({ error: totals.error, kpis: null, trend: [] }, { status: 200 });
  }

  const totalRow = totals.data?.rows?.[0];
  const kpis = totalRow
    ? {
        clicks: totalRow.clicks,
        impressions: totalRow.impressions,
        ctr: Number((totalRow.ctr * 100).toFixed(2)), // 0..1 → %
        position: Number(totalRow.position.toFixed(1)),
      }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  const trend = (daily.data?.rows || []).map((r) => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Number((r.ctr * 100).toFixed(2)),
    position: Number(r.position.toFixed(1)),
  }));

  return NextResponse.json(
    { kpis, trend, range, errors: { totals: totals.error, daily: daily.error } },
    {
      headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=3600" },
    }
  );
}
