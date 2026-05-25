import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ads/google
 *
 * Integração com Google Ads API v17 — busca métricas de campanhas reais.
 *
 * Query params:
 *   propertyName  - obrigatório
 *   startDate     - YYYY-MM-DD (opcional, default últimos 30 dias)
 *   endDate       - YYYY-MM-DD (opcional)
 *
 * Env vars necessárias (compartilhadas entre propriedades, OAuth único):
 *   GOOGLE_ADS_CLIENT_ID         = OAuth Client ID (Google Cloud)
 *   GOOGLE_ADS_CLIENT_SECRET     = OAuth Client Secret
 *   GOOGLE_ADS_REFRESH_TOKEN     = Refresh Token (gerado uma vez via OAuth flow)
 *   GOOGLE_ADS_DEVELOPER_TOKEN   = Developer Token (Google Ads → Tools → API Center)
 *
 * Por propriedade (cada uma tem um Customer ID diferente):
 *   GOOGLE_ADS_PROPERTY_1_NAME            = "Suno Research – Web"
 *   GOOGLE_ADS_PROPERTY_1_CUSTOMER_ID     = "1234567890" (sem traços)
 *   GOOGLE_ADS_PROPERTY_1_LOGIN_CUSTOMER_ID = "9876543210" (opcional, manager account)
 *
 * Como obter:
 *   - Developer Token: solicite em https://ads.google.com → Tools → API Center
 *     (pode levar 1-3 dias úteis pra aprovação se a conta é nova)
 *   - OAuth: https://developers.google.com/google-ads/api/docs/oauth/cloud-project
 *   - Customer ID: nos cantos superior direito do Google Ads (formato XXX-XXX-XXXX)
 *     remove os traços ao colocar na env
 *   - Login Customer ID: necessário se você acessa via Manager Account (MCC)
 */

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
}

type GoogleAdsCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  matchedProperty: string | null;
};

function resolveGoogleAdsCredentials(propertyName: string): GoogleAdsCredentials | { error: string; missing: string[] } {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_ADS_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_ADS_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_ADS_REFRESH_TOKEN");
  if (!developerToken) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");

  // Procura customer_id da propriedade
  let customerId: string | null = null;
  let loginCustomerId: string | null = null;
  let matchedProperty: string | null = null;
  const target = normalizeName(propertyName);
  for (let i = 1; i <= 20; i++) {
    const name = process.env[`GOOGLE_ADS_PROPERTY_${i}_NAME`];
    if (name && normalizeName(name) === target) {
      customerId = process.env[`GOOGLE_ADS_PROPERTY_${i}_CUSTOMER_ID`] || null;
      loginCustomerId = process.env[`GOOGLE_ADS_PROPERTY_${i}_LOGIN_CUSTOMER_ID`] || null;
      matchedProperty = name;
      break;
    }
  }
  // Fallback global
  if (!customerId) {
    customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || null;
    loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null;
  }
  if (!customerId) missing.push("GOOGLE_ADS_PROPERTY_N_CUSTOMER_ID");

  if (missing.length > 0) {
    return { error: "missing_credentials", missing };
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    developerToken: developerToken!,
    customerId: customerId!.replace(/-/g, ""),
    loginCustomerId: loginCustomerId?.replace(/-/g, "") || null,
    matchedProperty,
  };
}

// Pega access token via refresh token OAuth
async function getAccessToken(creds: GoogleAdsCredentials): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    });
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await resp.json()) as { access_token?: string; error?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const propertyName = req.nextUrl.searchParams.get("propertyName");
  if (!propertyName) {
    return NextResponse.json({ error: "propertyName required" }, { status: 400 });
  }

  const credResult = resolveGoogleAdsCredentials(propertyName);
  if ("error" in credResult) {
    return NextResponse.json(
      {
        ok: false,
        error: "not_configured",
        message: `Google Ads não configurado pra "${propertyName}". Variáveis faltando.`,
        missing: credResult.missing,
        instructions: {
          steps: [
            "1. Cadastre OAuth no Google Cloud Console",
            "2. Solicite Developer Token em Google Ads → Tools → API Center (~1-3 dias)",
            "3. Pegue Refresh Token via OAuth flow (uma vez só)",
            "4. Pegue Customer ID da propriedade no canto superior direito do Google Ads",
            "5. Adicione todas as variáveis listadas em missing no .env.local da Vercel",
          ],
          docs: "https://developers.google.com/google-ads/api/docs/oauth/cloud-project",
        },
      },
      { status: 200 }
    );
  }
  const creds = credResult;

  // Pega access token via refresh token
  const accessToken = await getAccessToken(creds);
  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "oauth_failed",
        message: "Não consegui gerar access token via refresh token. Token expirado ou OAuth config errada.",
        hint: "Regenere o refresh token via OAuth flow e atualize GOOGLE_ADS_REFRESH_TOKEN no .env.local.",
      },
      { status: 200 }
    );
  }

  // Range default: últimos 30 dias
  let startDate: string;
  let endDate: string;
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");
  if (
    startDateParam &&
    endDateParam &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
  ) {
    startDate = startDateParam;
    endDate = endDateParam;
  } else {
    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - 30);
    startDate = isoDate(start);
    endDate = isoDate(end);
  }

  // GAQL — Google Ads Query Language
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    AND campaign.status IN ('ENABLED', 'PAUSED')
  `.replace(/\s+/g, " ").trim();

  type GAdsRow = {
    campaign?: { id?: string; name?: string; status?: string };
    metrics?: {
      impressions?: string;
      clicks?: string;
      costMicros?: string;
      conversions?: number;
      conversionsValue?: number;
      ctr?: number;
      averageCpc?: string;
      averageCpm?: string;
    };
  };

  const url = `https://googleads.googleapis.com/v17/customers/${creds.customerId}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": creds.developerToken,
    "Content-Type": "application/json",
  };
  if (creds.loginCustomerId) {
    headers["login-customer-id"] = creds.loginCustomerId;
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "network_error",
        message: `Falha ao conectar com Google Ads API: ${(e as Error).message}`,
      },
      { status: 200 }
    );
  }

  if (!resp.ok) {
    const errorText = await resp.text();
    return NextResponse.json(
      {
        ok: false,
        error: "google_ads_api_error",
        httpStatus: resp.status,
        message: `Google Ads API retornou erro ${resp.status}`,
        details: errorText.slice(0, 1000),
        hint:
          resp.status === 401
            ? "Access token inválido ou developer token sem permissão pra esse customer."
            : resp.status === 403
              ? "Sem permissão de acesso pra esse Customer ID. Verifique login_customer_id."
              : resp.status === 404
                ? "Customer ID não encontrado. Verifique o número."
                : null,
      },
      { status: 200 }
    );
  }

  // Response é streaming — vem como array de objetos
  let streamData: { results?: GAdsRow[] }[];
  try {
    streamData = await resp.json();
  } catch {
    streamData = [];
  }

  const rows: GAdsRow[] = [];
  for (const chunk of Array.isArray(streamData) ? streamData : []) {
    if (chunk.results) rows.push(...chunk.results);
  }

  type Campaign = {
    id: string;
    name: string;
    status: string;
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
    platform: "Google Ads";
  };

  const campaigns: Campaign[] = rows.map((row) => {
    const impressions = Number(row.metrics?.impressions || 0);
    const clicks = Number(row.metrics?.clicks || 0);
    // costMicros é em micro-unidades — divide por 1.000.000 pra reais
    const spend = Number(row.metrics?.costMicros || 0) / 1_000_000;
    const conversions = Number(row.metrics?.conversions || 0);
    const revenue = Number(row.metrics?.conversionsValue || 0);

    return {
      id: row.campaign?.id || "",
      name: row.campaign?.name || "(sem nome)",
      status: row.campaign?.status || "UNKNOWN",
      impressions,
      clicks,
      spend: Number(spend.toFixed(2)),
      ctr: Number((row.metrics?.ctr || 0) * 100), // GAds retorna 0..1
      cpm: Number(row.metrics?.averageCpm || 0) / 1_000_000,
      cpc: Number(row.metrics?.averageCpc || 0) / 1_000_000,
      conversions: Number(conversions.toFixed(2)),
      revenue: Number(revenue.toFixed(2)),
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
      cpa: conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
      platform: "Google Ads" as const,
    };
  });

  // Agrupa campanhas iguais (a query traz uma linha por dia × campanha)
  const grouped = new Map<string, Campaign>();
  for (const c of campaigns) {
    const existing = grouped.get(c.id);
    if (existing) {
      existing.impressions += c.impressions;
      existing.clicks += c.clicks;
      existing.spend += c.spend;
      existing.conversions += c.conversions;
      existing.revenue += c.revenue;
    } else {
      grouped.set(c.id, { ...c });
    }
  }
  // Recalcula derivações após agrupar
  const finalCampaigns = Array.from(grouped.values()).map((c) => ({
    ...c,
    ctr: c.impressions > 0 ? Number(((c.clicks / c.impressions) * 100).toFixed(2)) : 0,
    cpc: c.clicks > 0 ? Number((c.spend / c.clicks).toFixed(2)) : 0,
    cpm: c.impressions > 0 ? Number(((c.spend / c.impressions) * 1000).toFixed(2)) : 0,
    spend: Number(c.spend.toFixed(2)),
    revenue: Number(c.revenue.toFixed(2)),
    roas: c.spend > 0 ? Number((c.revenue / c.spend).toFixed(2)) : 0,
    cpa: c.conversions > 0 ? Number((c.spend / c.conversions).toFixed(2)) : 0,
  }));

  const totals = finalCampaigns.reduce(
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
      ok: true,
      propertyName,
      matchedProperty: creds.matchedProperty,
      customerId: creds.customerId,
      timeRange: { startDate, endDate },
      campaigns: finalCampaigns,
      totals: {
        ...totals,
        spend: Number(totals.spend.toFixed(2)),
        revenue: Number(totals.revenue.toFixed(2)),
        roas: totals.spend > 0 ? Number((totals.revenue / totals.spend).toFixed(2)) : 0,
        cpa: totals.conversions > 0 ? Number((totals.spend / totals.conversions).toFixed(2)) : 0,
        ctr: totals.impressions > 0 ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0,
      },
      meta: {
        campaignsCount: finalCampaigns.length,
        platform: "Google Ads",
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
