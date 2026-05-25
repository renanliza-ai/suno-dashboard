import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ads/campaigns
 *
 * Endpoint unificado — chama Meta Ads + Google Ads em paralelo e devolve
 * lista única de campanhas + totais + status de cada plataforma.
 *
 * Retorna `ok: true` se PELO MENOS UMA das integrações funcionou. Cada
 * plataforma tem seu próprio sub-status:
 *   - meta: ok | not_configured | error
 *   - google: ok | not_configured | error
 *
 * Frontend usa isso pra mostrar:
 *   - Quando ambas OK: tabela com todas campanhas misturadas
 *   - Quando uma falhou: tabela só com a que funcionou + aviso da outra
 *   - Quando ambas falharam: card de "configure as APIs"
 */

type UnifiedCampaign = {
  id: string;
  name: string;
  platform: "Meta Ads" | "Google Ads";
  status?: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  cpc: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number;
};

type PlatformResponse = {
  ok: boolean;
  campaigns?: UnifiedCampaign[];
  totals?: {
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    revenue: number;
  };
  error?: string;
  message?: string;
};

export async function GET(req: NextRequest) {
  const propertyName = req.nextUrl.searchParams.get("propertyName");
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");

  if (!propertyName) {
    return NextResponse.json({ error: "propertyName required" }, { status: 400 });
  }

  // Constrói URLs internas pra Meta e Google
  const baseUrl = new URL(req.url);
  baseUrl.search = "";

  const params = new URLSearchParams({ propertyName });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const metaUrl = `${baseUrl.origin}/api/ads/meta?${params.toString()}`;
  const googleUrl = `${baseUrl.origin}/api/ads/google?${params.toString()}`;

  // Roda em paralelo, preserva headers de auth do request original
  const reqHeaders: HeadersInit = {};
  const cookie = req.headers.get("cookie");
  if (cookie) reqHeaders["cookie"] = cookie;

  const [metaResp, googleResp] = await Promise.allSettled([
    fetch(metaUrl, { headers: reqHeaders, cache: "no-store" }).then((r) => r.json()),
    fetch(googleUrl, { headers: reqHeaders, cache: "no-store" }).then((r) => r.json()),
  ]);

  const meta: PlatformResponse =
    metaResp.status === "fulfilled" ? metaResp.value : { ok: false, error: "fetch_failed" };
  const google: PlatformResponse =
    googleResp.status === "fulfilled" ? googleResp.value : { ok: false, error: "fetch_failed" };

  // Junta campanhas das duas plataformas
  const allCampaigns: UnifiedCampaign[] = [
    ...(meta.ok && meta.campaigns ? meta.campaigns : []),
    ...(google.ok && google.campaigns ? google.campaigns : []),
  ];

  // Totais consolidados
  const totals = allCampaigns.reduce(
    (acc, c) => ({
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      spend: acc.spend + c.spend,
      conversions: acc.conversions + c.conversions,
      revenue: acc.revenue + c.revenue,
    }),
    { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
  );

  return NextResponse.json(
    {
      ok: meta.ok || google.ok,
      propertyName,
      campaigns: allCampaigns,
      totals: {
        ...totals,
        spend: Number(totals.spend.toFixed(2)),
        revenue: Number(totals.revenue.toFixed(2)),
        roas: totals.spend > 0 ? Number((totals.revenue / totals.spend).toFixed(2)) : 0,
        cpa: totals.conversions > 0 ? Number((totals.spend / totals.conversions).toFixed(2)) : 0,
        ctr:
          totals.impressions > 0
            ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2))
            : 0,
      },
      platforms: {
        meta: {
          ok: meta.ok,
          campaignsCount: meta.campaigns?.length || 0,
          totals: meta.totals,
          error: meta.error,
          message: meta.message,
        },
        google: {
          ok: google.ok,
          campaignsCount: google.campaigns?.length || 0,
          totals: google.totals,
          error: google.error,
          message: google.message,
        },
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
