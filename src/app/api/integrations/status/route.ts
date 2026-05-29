import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/integrations/status
 *
 * Verifica quais integrações estão configuradas via env vars.
 * NÃO faz ping nas APIs externas (rápido, leve) — só checa presença
 * das variáveis necessárias.
 *
 * Pra cada integração retorna:
 *   - configured: boolean (todas as env vars críticas presentes?)
 *   - properties: lista de quais propriedades estão configuradas
 *   - missing: vars faltando pra ativar
 */

type IntegrationStatus = {
  id: string;
  title: string;
  configured: boolean;
  properties: string[]; // nomes de propriedades configuradas
  missing: string[]; // env vars faltando
  notes?: string;
};

function getEnv(name: string): string | undefined {
  return process.env[name];
}

// Descobre propriedades configuradas no padrão META_CAPI_PROPERTY_N_NAME
function findCapiProperties(): string[] {
  const props: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = getEnv(`META_CAPI_PROPERTY_${i}_NAME`);
    const pixel = getEnv(`META_CAPI_PROPERTY_${i}_PIXEL_ID`);
    const token = getEnv(`META_CAPI_PROPERTY_${i}_TOKEN`);
    if (name && pixel && token) props.push(name);
  }
  return props;
}

// Descobre propriedades configuradas no padrão META_ADS_PROPERTY_N_NAME
// OU que reusam o token do CAPI (precisa de Ad Account ID adicional)
function findMetaAdsProperties(): { properties: string[]; reusesCapi: string[] } {
  const properties: string[] = [];
  const reusesCapi: string[] = [];

  for (let i = 1; i <= 20; i++) {
    const name = getEnv(`META_ADS_PROPERTY_${i}_NAME`);
    const acc = getEnv(`META_ADS_PROPERTY_${i}_AD_ACCOUNT_ID`);
    const token = getEnv(`META_ADS_PROPERTY_${i}_TOKEN`);
    if (name && acc && token) {
      properties.push(name);
    }
  }

  // Reutilização do CAPI (caso o user tenha adicionado AD_ACCOUNT_ID no bloco CAPI)
  for (let i = 1; i <= 20; i++) {
    const name = getEnv(`META_CAPI_PROPERTY_${i}_NAME`);
    const token = getEnv(`META_CAPI_PROPERTY_${i}_TOKEN`);
    const adAccount = getEnv(`META_CAPI_PROPERTY_${i}_AD_ACCOUNT_ID`);
    if (name && token && adAccount && !properties.includes(name)) {
      reusesCapi.push(name);
    }
  }

  return { properties, reusesCapi };
}

// Descobre propriedades configuradas pro Google Ads
function findGoogleAdsProperties(): { properties: string[]; globalConfigured: boolean; missing: string[] } {
  const required = [
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ];
  const missing = required.filter((v) => !getEnv(v));
  const globalConfigured = missing.length === 0;

  const properties: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = getEnv(`GOOGLE_ADS_PROPERTY_${i}_NAME`);
    const customer = getEnv(`GOOGLE_ADS_PROPERTY_${i}_CUSTOMER_ID`);
    if (name && customer) properties.push(name);
  }

  return { properties, globalConfigured, missing };
}

export async function GET() {
  const capiProps = findCapiProperties();
  const metaAds = findMetaAdsProperties();
  const googleAds = findGoogleAdsProperties();

  const integrations: IntegrationStatus[] = [
    {
      id: "ga4",
      title: "Google Analytics 4",
      configured: true,
      properties: [],
      missing: [],
      notes: "Integrado nativamente via OAuth da sessão do usuário (GMP-CLI).",
    },
    {
      id: "gtm",
      title: "Google Tag Manager",
      configured: true,
      properties: [],
      missing: [],
      notes: "Validação ao vivo via /api/tracking/gtm-check.",
    },
    {
      id: "meta-capi",
      title: "Meta CAPI (Conversions API)",
      configured: capiProps.length > 0,
      properties: capiProps,
      missing: capiProps.length === 0 ? [
        "META_CAPI_PROPERTY_N_NAME",
        "META_CAPI_PROPERTY_N_PIXEL_ID",
        "META_CAPI_PROPERTY_N_TOKEN",
      ] : [],
      notes: capiProps.length > 0
        ? `Configurado pra ${capiProps.length} propriedade${capiProps.length > 1 ? "s" : ""}: ${capiProps.join(", ")}.`
        : "Envia eventos server-side de purchase/lead pra Meta. Usa Pixel ID (não Ad Account ID).",
    },
    {
      id: "meta-ads",
      title: "Meta Ads (Marketing API)",
      configured: metaAds.properties.length > 0 || metaAds.reusesCapi.length > 0,
      properties: [...metaAds.properties, ...metaAds.reusesCapi.map((n) => `${n} (via CAPI)`)],
      missing: metaAds.properties.length === 0 && metaAds.reusesCapi.length === 0 ? [
        "META_ADS_PROPERTY_N_NAME",
        "META_ADS_PROPERTY_N_AD_ACCOUNT_ID",
        "META_ADS_PROPERTY_N_TOKEN",
      ] : [],
      notes:
        metaAds.properties.length > 0 || metaAds.reusesCapi.length > 0
          ? "Integração ativa — lê campanhas, impressões, gastos, ROAS."
          : "⚠ ATENÇÃO: Meta Ads é DIFERENTE do CAPI. Usa Ad Account ID (não Pixel ID). Token pode ser o mesmo se tiver permissão ads_read.",
    },
    {
      id: "google-ads",
      title: "Google Ads",
      configured: googleAds.globalConfigured && googleAds.properties.length > 0,
      properties: googleAds.properties,
      missing: [
        ...googleAds.missing,
        ...(googleAds.properties.length === 0 ? ["GOOGLE_ADS_PROPERTY_N_NAME", "GOOGLE_ADS_PROPERTY_N_CUSTOMER_ID"] : []),
      ],
      notes:
        googleAds.globalConfigured && googleAds.properties.length > 0
          ? `Configurado pra ${googleAds.properties.length} propriedade${googleAds.properties.length > 1 ? "s" : ""}.`
          : `Faltando: ${googleAds.missing.length} vars globais + ${googleAds.properties.length === 0 ? "pelo menos 1 propriedade" : "0 propriedades"}.`,
    },
    {
      id: "gsc",
      title: "Search Console",
      configured: true,
      properties: [],
      missing: [],
      notes: "Integrado via OAuth do GMP-CLI. Propriedades descobertas dinamicamente em /api/seo/sites — visíveis no seletor da aba SEO.",
    },
    {
      id: "bigquery",
      title: "BigQuery",
      configured: true,
      properties: [],
      missing: [],
      notes: "Integrado via OAuth do GMP-CLI (projeto gmp-cli tem acesso aos datasets de export GA4→BigQuery). Consultas raw disponíveis sob demanda.",
    },
    {
      id: "monday",
      title: "Monday.com",
      configured: !!(getEnv("MONDAY_API_TOKEN") && getEnv("MONDAY_BOARD_ID")),
      properties: [],
      missing: [
        ...(getEnv("MONDAY_API_TOKEN") ? [] : ["MONDAY_API_TOKEN"]),
        ...(getEnv("MONDAY_BOARD_ID") ? [] : ["MONDAY_BOARD_ID"]),
      ],
      notes: "Criação de tarefas CRO direto do painel.",
    },
  ];

  return NextResponse.json(
    {
      integrations,
      summary: {
        total: integrations.length,
        configured: integrations.filter((i) => i.configured).length,
        pending: integrations.filter((i) => !i.configured).length,
      },
    },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
  );
}
