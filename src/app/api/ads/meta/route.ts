import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ads/meta
 *
 * Integração com Meta Marketing API — busca métricas de campanhas reais
 * de Meta Ads (Facebook + Instagram) por propriedade selecionada.
 *
 * Query params:
 *   propertyName   - obrigatório (ex: "Suno Research – Web")
 *   startDate      - YYYY-MM-DD (opcional, default últimos 30 dias)
 *   endDate        - YYYY-MM-DD (opcional)
 *
 * Env vars necessárias (por propriedade):
 *   META_ADS_PROPERTY_1_NAME = "Suno Research – Web"
 *   META_ADS_PROPERTY_1_AD_ACCOUNT_ID = "act_1234567890"
 *   META_ADS_PROPERTY_1_TOKEN = "EAA..." (pode ser o mesmo do CAPI)
 *
 * OU fallback global:
 *   META_ADS_AD_ACCOUNT_ID
 *   META_ADS_ACCESS_TOKEN
 *
 * Como obter Ad Account ID:
 *   - Meta Business Manager → Configurações → Contas de anúncios → ID
 *   - Formato: 1234567890 (sem o prefixo "act_")
 *
 * Como obter Access Token:
 *   - System User Token do Business Settings (mesmo do CAPI)
 *   - Permissões necessárias: ads_read, ads_management
 */

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim();
}

// Slug agressivo: tira acento, espaço e TODA pontuação. Faz "Status Invest - Web",
// "Statusinvest – Web" e "statusinvest_web" casarem entre si. Evita not_configured
// por diferença boba de como o nome foi digitado na env vs displayName do GA4.
function slugName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveMetaCredentials(propertyName: string | null): {
  adAccountId: string;
  accessToken: string;
  matchedProperty: string | null;
  fromFallback: boolean;
} | null {
  if (propertyName) {
    const target = normalizeName(propertyName);
    const targetSlug = slugName(propertyName);
    for (let i = 1; i <= 20; i++) {
      const name = process.env[`META_ADS_PROPERTY_${i}_NAME`];
      const account = process.env[`META_ADS_PROPERTY_${i}_AD_ACCOUNT_ID`];
      const token = process.env[`META_ADS_PROPERTY_${i}_TOKEN`];
      // Match por nome normalizado OU por slug (tolera espaço/acento/pontuação).
      if (name && account && token && (normalizeName(name) === target || slugName(name) === targetSlug)) {
        return {
          adAccountId: account.startsWith("act_") ? account : `act_${account}`,
          accessToken: token,
          matchedProperty: name,
          fromFallback: false,
        };
      }
    }
  }

  // Fallback global
  const fbAccount = process.env.META_ADS_AD_ACCOUNT_ID;
  const fbToken = process.env.META_ADS_ACCESS_TOKEN;
  if (fbAccount && fbToken) {
    return {
      adAccountId: fbAccount.startsWith("act_") ? fbAccount : `act_${fbAccount}`,
      accessToken: fbToken,
      matchedProperty: null,
      fromFallback: true,
    };
  }

  // Último fallback: tenta usar o token do CAPI (mesma conta Meta normalmente)
  for (let i = 1; i <= 20; i++) {
    const capiToken = process.env[`META_CAPI_PROPERTY_${i}_TOKEN`];
    const capiName = process.env[`META_CAPI_PROPERTY_${i}_NAME`];
    const adAccount = process.env[`META_CAPI_PROPERTY_${i}_AD_ACCOUNT_ID`];
    if (capiToken && capiName && adAccount && propertyName && (normalizeName(capiName) === normalizeName(propertyName) || slugName(capiName) === slugName(propertyName))) {
      return {
        adAccountId: adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`,
        accessToken: capiToken,
        matchedProperty: capiName,
        fromFallback: false,
      };
    }
  }

  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type MetaInsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  date_start?: string;
  date_stop?: string;
};

export async function GET(req: NextRequest) {
  const propertyName = req.nextUrl.searchParams.get("propertyName");
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");

  if (!propertyName) {
    return NextResponse.json({ error: "propertyName required" }, { status: 400 });
  }

  const credentials = resolveMetaCredentials(propertyName);
  if (!credentials) {
    // Diagnóstico: lista os NOMES de property configurados (só nomes, sem token)
    // e sinaliza se algum tem AD_ACCOUNT/TOKEN faltando. Ajuda a ver se é
    // mismatch de nome ou credencial incompleta - sem expor segredo.
    const configured: { slot: number; name: string; hasAccount: boolean; hasToken: boolean; slugMatchesRequest: boolean }[] = [];
    const reqSlug = slugName(propertyName);
    for (let i = 1; i <= 20; i++) {
      const name = process.env[`META_ADS_PROPERTY_${i}_NAME`];
      if (!name) continue;
      configured.push({
        slot: i,
        name,
        hasAccount: Boolean(process.env[`META_ADS_PROPERTY_${i}_AD_ACCOUNT_ID`]),
        hasToken: Boolean(process.env[`META_ADS_PROPERTY_${i}_TOKEN`]),
        slugMatchesRequest: slugName(name) === reqSlug,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: "not_configured",
        message: `Meta Ads não resolveu credencial pra "${propertyName}".`,
        requestedSlug: reqSlug,
        configuredMetaProperties: configured,
        diagnostic:
          configured.some((c) => c.slugMatchesRequest && (!c.hasAccount || !c.hasToken))
            ? "Existe uma entrada com nome equivalente, mas falta AD_ACCOUNT_ID ou TOKEN nela."
            : configured.length === 0
              ? "Nenhuma META_ADS_PROPERTY_N configurada no ambiente."
              : "Nenhuma entrada bate (nem por slug) com o nome desta property. Confira o valor de META_ADS_PROPERTY_N_NAME vs o displayName do GA4.",
        instructions: {
          required: ["META_ADS_PROPERTY_N_NAME", "META_ADS_PROPERTY_N_AD_ACCOUNT_ID", "META_ADS_PROPERTY_N_TOKEN"],
        },
      },
      { status: 200 }
    );
  }

  // Range default: últimos 30 dias
  let timeRange: { since: string; until: string };
  if (
    startDateParam &&
    endDateParam &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
  ) {
    timeRange = { since: startDateParam, until: endDateParam };
  } else {
    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - 30);
    timeRange = { since: isoDate(start), until: isoDate(end) };
  }

  const fields = [
    "campaign_id",
    "campaign_name",
    "impressions",
    "clicks",
    "spend",
    "ctr",
    "cpm",
    "cpc",
    "reach",
    "frequency",
    "actions",
    "action_values",
  ].join(",");

  // Busca as insights de campanha pra uma janela. Retorna rows OU um erro.
  async function fetchInsights(range: { since: string; until: string }): Promise<{
    rows: MetaInsightRow[] | null;
    error: { message: string; code: number; type: string } | null;
    httpStatus: number;
  }> {
    const url =
      `https://graph.facebook.com/v19.0/${credentials!.adAccountId}/insights` +
      `?level=campaign` +
      `&fields=${fields}` +
      `&time_range=${encodeURIComponent(JSON.stringify(range))}` +
      `&limit=500` +
      `&access_token=${credentials!.accessToken}`;
    try {
      const resp = await fetch(url, { cache: "no-store" });
      const j = (await resp.json()) as {
        data?: MetaInsightRow[];
        error?: { message: string; code: number; type: string };
      };
      if (j.error) return { rows: null, error: j.error, httpStatus: resp.status };
      return { rows: j.data || [], error: null, httpStatus: resp.status };
    } catch (e) {
      return { rows: null, error: { message: (e as Error).message, code: -1, type: "network" }, httpStatus: 0 };
    }
  }

  const spendOf = (rows: MetaInsightRow[]) => rows.reduce((s, r) => s + Number(r.spend || 0), 0);

  // 1ª tentativa: janela pedida
  const first = await fetchInsights(timeRange);
  if (first.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "meta_api_error",
        message: first.error.message,
        code: first.error.code,
        type: first.error.type,
        propertyName,
        adAccountId: credentials.adAccountId,
        httpStatus: first.httpStatus,
        hint:
          first.error.code === 190
            ? "Token expirado ou sem permissão. Gere um System User Token novo em Business Settings."
            : first.error.code === 100
              ? "Ad Account ID inválido ou inacessível com esse token."
              : null,
      },
      { status: 200 }
    );
  }

  // FALLBACK "sempre carregar": se a janela pedida nao tem investimento Meta,
  // busca os ultimos 90 dias (que costumam ter dados) e sinaliza a troca.
  // Motivo: no inicio do mes / com atraso de reporte, a janela corrente pode
  // vir vazia mesmo com Meta sendo 70% do budget.
  let rows = first.rows || [];
  let windowFallback: { applied: boolean; requestedRange: typeof timeRange; effectiveRange: typeof timeRange } | null = null;
  if (spendOf(rows) === 0) {
    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - 90);
    const wide = { since: isoDate(start), until: isoDate(end) };
    const fb = await fetchInsights(wide);
    if (!fb.error && fb.rows && spendOf(fb.rows) > 0) {
      rows = fb.rows;
      windowFallback = { applied: true, requestedRange: timeRange, effectiveRange: wide };
      timeRange = wide;
    }
  }

  const metaData: { data?: MetaInsightRow[] } = { data: rows };

  // Processa as linhas — extrai conversões e receita dos arrays actions/action_values
  type Campaign = {
    id: string;
    name: string;
    impressions: number;
    clicks: number;
    spend: number;
    ctr: number;
    cpm: number;
    cpc: number;
    reach: number;
    conversions: number;
    revenue: number;
    roas: number;
    cpa: number;
    platform: "Meta Ads";
  };

  const campaigns: Campaign[] = (metaData.data || []).map((row) => {
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const spend = Number(row.spend || 0);

    // Conversões (action_type=purchase, lead, complete_registration, etc.)
    let conversions = 0;
    let revenue = 0;
    for (const action of row.actions || []) {
      // Soma compras + leads + signups como conversões
      if (["purchase", "lead", "complete_registration", "offsite_conversion.fb_pixel_purchase", "offsite_conversion.fb_pixel_lead"].includes(action.action_type)) {
        conversions += Number(action.value || 0);
      }
    }
    for (const av of row.action_values || []) {
      if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(av.action_type)) {
        revenue += Number(av.value || 0);
      }
    }

    return {
      id: row.campaign_id || "",
      name: row.campaign_name || "(sem nome)",
      impressions,
      clicks,
      spend: Number(spend.toFixed(2)),
      ctr: Number(row.ctr || 0),
      cpm: Number(row.cpm || 0),
      cpc: Number(row.cpc || 0),
      reach: Number(row.reach || 0),
      conversions,
      revenue: Number(revenue.toFixed(2)),
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
      cpa: conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
      platform: "Meta Ads" as const,
    };
  });

  // Totais
  const totals = campaigns.reduce(
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
      matchedProperty: credentials.matchedProperty,
      fromFallback: credentials.fromFallback,
      adAccountId: credentials.adAccountId,
      timeRange,
      windowFallback,
      campaigns,
      totals: {
        ...totals,
        spend: Number(totals.spend.toFixed(2)),
        revenue: Number(totals.revenue.toFixed(2)),
        roas: totals.spend > 0 ? Number((totals.revenue / totals.spend).toFixed(2)) : 0,
        cpa: totals.conversions > 0 ? Number((totals.spend / totals.conversions).toFixed(2)) : 0,
        ctr: totals.impressions > 0 ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0,
      },
      meta: {
        campaignsCount: campaigns.length,
        platform: "Meta Ads",
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
