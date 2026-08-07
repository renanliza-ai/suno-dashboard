import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/products
 *
 * MIX DE PRODUTO / PERFIL DE ASSINATURA — o que foi vendido, não só quanto.
 *
 * Usa dimensões e métricas ITEM-SCOPED do GA4 (itemName / itemCategory com
 * itemsPurchased / itemRevenue). Essas NÃO podem ser misturadas com métricas
 * de evento (eventCount) na mesma query — por isso um endpoint dedicado.
 *
 * Query params:
 *   propertyId (obrigatório)
 *   startDate / endDate (YYYY-MM-DD) ou days (default 30)
 *   dimension: itemName (default) | itemCategory | itemBrand
 *   limit (default 50)
 *
 * Nota de leitura: itemRevenue depende de o dataLayer enviar `price`/`value`
 * corretamente. Na Suno Research a receita do GA4 é sabidamente subcontada
 * (problema do _ga no checkout), então priorize QUANTIDADE (itemsPurchased)
 * para ler mix de plano; use receita só como ordem de grandeza.
 */

const ALLOWED_DIMS = ["itemName", "itemCategory", "itemBrand", "itemCategory2", "itemCategory3"];

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const dimParam = req.nextUrl.searchParams.get("dimension") || "itemName";
  const dimension = ALLOWED_DIMS.includes(dimParam) ? dimParam : "itemName";
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const limit = Number(req.nextUrl.searchParams.get("limit") || 50);

  const dateRange =
    startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? { startDate, endDate }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  const res = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: dimension }],
    metrics: [
      { name: "itemsPurchased" },
      { name: "itemsViewed" },
      { name: "itemRevenue" },
      { name: "itemsAddedToCart" },
    ],
    orderBys: [{ metric: { metricName: "itemsPurchased" }, desc: true }],
    limit,
  });

  if (res.error) {
    return NextResponse.json({ propertyId, error: res.error, items: [] }, { status: 200 });
  }

  const items = (res.data?.rows || []).map((r) => {
    const purchased = Number(r.metricValues?.[0]?.value || 0);
    const viewed = Number(r.metricValues?.[1]?.value || 0);
    const revenue = Number(r.metricValues?.[2]?.value || 0);
    const addedToCart = Number(r.metricValues?.[3]?.value || 0);
    return {
      name: r.dimensionValues?.[0]?.value || "(sem nome)",
      purchased,
      viewed,
      addedToCart,
      revenue: Number(revenue.toFixed(2)),
      // taxa de fechamento do item: comprou / adicionou ao carrinho
      cartToPurchaseRate: addedToCart > 0 ? Number(((purchased / addedToCart) * 100).toFixed(1)) : 0,
      // ticket médio do item (só confiável onde a receita chega correta)
      avgPrice: purchased > 0 ? Number((revenue / purchased).toFixed(2)) : 0,
    };
  });

  const totalPurchased = items.reduce((s, i) => s + i.purchased, 0);
  const withShare = items.map((i) => ({
    ...i,
    sharePct: totalPurchased > 0 ? Number(((i.purchased / totalPurchased) * 100).toFixed(1)) : 0,
  }));

  return NextResponse.json(
    {
      propertyId,
      dimension,
      range: dateRange,
      items: withShare,
      totals: {
        itemsPurchased: totalPurchased,
        itemsViewed: items.reduce((s, i) => s + i.viewed, 0),
        revenue: Number(items.reduce((s, i) => s + i.revenue, 0).toFixed(2)),
        distinctItems: items.length,
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
