import { runGSCQuery, buildGSCDateRange } from "@/lib/gsc-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/seo/queries
 *
 * Top termos de busca orgânica para a propriedade.
 * Retorna: query, clicks, impressions, ctr, position, e a página principal de
 * destino (a URL que mais ranqueia para esse termo).
 *
 * Cruzar query × page exige 2 queries (limitação do API: você só pode pedir
 * uma combinação de dimensões por chamada). Fazemos as duas em paralelo e
 * casamos no servidor.
 */
export async function GET(req: NextRequest) {
  const siteUrl = req.nextUrl.searchParams.get("siteUrl");
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const limit = Number(req.nextUrl.searchParams.get("limit") || 100);
  const startDateQ = req.nextUrl.searchParams.get("startDate");
  const endDateQ = req.nextUrl.searchParams.get("endDate");

  if (!siteUrl) return NextResponse.json({ error: "siteUrl required" }, { status: 400 });

  const range = buildGSCDateRange(days, startDateQ, endDateQ);

  // 1) Top queries agregadas
  const [queriesRes, queryPagesRes] = await Promise.all([
    runGSCQuery(siteUrl, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["query"],
      rowLimit: Math.min(limit * 2, 1000),
    }),
    // 2) Cruzamento query × page para descobrir a landing page principal
    runGSCQuery(siteUrl, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["query", "page"],
      rowLimit: 25000,
    }),
  ]);

  if (queriesRes.error) {
    return NextResponse.json({ error: queriesRes.error, queries: [] }, { status: 200 });
  }

  // Mapa: query → página com mais clicks pra esse termo
  const queryPageMap = new Map<string, { page: string; clicks: number }>();
  for (const r of queryPagesRes.data?.rows || []) {
    const q = r.keys[0];
    const p = r.keys[1];
    const cur = queryPageMap.get(q);
    if (!cur || r.clicks > cur.clicks) {
      queryPageMap.set(q, { page: p, clicks: r.clicks });
    }
  }

  const queries = (queriesRes.data?.rows || [])
    .slice(0, limit)
    .map((r) => {
      const query = r.keys[0];
      const topPage = queryPageMap.get(query);
      return {
        query,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Number((r.ctr * 100).toFixed(2)),
        position: Number(r.position.toFixed(1)),
        topPage: topPage?.page || null,
        // Heurística: termo com posição boa (1-10) e CTR baixo = oportunidade
        // de melhorar título/meta description.
        opportunity:
          r.position <= 10 && r.ctr < 0.05
            ? "low_ctr"
            : // Termo com posição 5-15 e clicks decentes = oportunidade de criar conteúdo Parte 2
              r.position >= 4 && r.position <= 15 && r.clicks >= 50
              ? "part_2_candidate"
              : null,
      };
    });

  return NextResponse.json(
    { queries, range },
    {
      headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=3600" },
    }
  );
}
