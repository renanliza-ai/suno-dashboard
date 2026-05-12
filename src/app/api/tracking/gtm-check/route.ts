import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/tracking/gtm-check
 *
 * 🔒 Master-only.
 *
 * Faz fetch real de cada URL e detecta:
 *   - GTM container code (googletagmanager.com/gtm.js?id=GTM-XXXXX)
 *   - dataLayer initialization
 *   - gtag() calls
 *   - GA4 Measurement ID (G-XXXXXXX)
 *   - Pixels comuns (Meta, LinkedIn, TikTok)
 *
 * Antes /tracking mostrava alertas HARDCODED ("/lp/premium-30 sem GTM")
 * que confundiam o user — o painel afirmava ausência de GTM em páginas
 * que TINHAM GTM. Agora bate na URL e responde com base no HTML real.
 *
 * Body (POST):
 *   { urls: string[] }   // até 50 URLs
 *
 * Retorna:
 *   { results: GTMCheckResult[], summary: { ... } }
 */

type GTMCheckResult = {
  url: string;
  fetchedOk: boolean;
  httpStatus: number | null;
  hasGTM: boolean;
  gtmIds: string[]; // GTM-XXXXXXX encontrados
  hasDataLayer: boolean;
  hasGtag: boolean;
  ga4Ids: string[]; // G-XXXXXXX encontrados
  metaPixelIds: string[]; // FB Pixel IDs
  detectedPixels: string[]; // "meta", "linkedin", "tiktok", "google_ads" etc
  error: string | null;
  durationMs: number;
};

const BATCH_SIZE = 8;
const TIMEOUT_MS = 12000;

// Regexes pra detectar tracking — case-insensitive nos padrões críticos
const GTM_PATTERN_LOOSE = /googletagmanager\.com\/gtm\.js/i;
const GTM_ID_PATTERN = /GTM-[A-Z0-9]{4,10}/gi;
const DATALAYER_PATTERN = /window\.dataLayer|dataLayer\.push|dataLayer\s*=\s*\[/;
const GTAG_PATTERN = /gtag\s*\(\s*['"]/;
const GA4_ID_PATTERN = /G-[A-Z0-9]{8,12}/g;
const META_PIXEL_PATTERN = /connect\.facebook\.net.*fbevents\.js|fbq\s*\(\s*['"]init/i;
const META_PIXEL_ID_PATTERN = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,18})['"]/g;
const LINKEDIN_PATTERN = /snap\.licdn\.com\/li\.lms-analytics/i;
const TIKTOK_PATTERN = /analytics\.tiktok\.com|ttq\./i;
const GOOGLE_ADS_PATTERN = /AW-\d{9,11}/i;

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

async function checkOne(url: string): Promise<GTMCheckResult> {
  const start = Date.now();
  const result: GTMCheckResult = {
    url,
    fetchedOk: false,
    httpStatus: null,
    hasGTM: false,
    gtmIds: [],
    hasDataLayer: false,
    hasGtag: false,
    ga4Ids: [],
    metaPixelIds: [],
    detectedPixels: [],
    error: null,
    durationMs: 0,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow", // segue redirect — interessa o HTML final
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SunoDashboardGTMCheck/1.0; +https://suno-dashboard-painel.vercel.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(timeoutId);

    result.httpStatus = res.status;
    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      result.durationMs = Date.now() - start;
      return result;
    }

    const html = await res.text();
    result.fetchedOk = true;

    // GTM detection
    result.hasGTM = GTM_PATTERN_LOOSE.test(html);
    const gtmMatches = html.match(GTM_ID_PATTERN) || [];
    result.gtmIds = uniq(gtmMatches.map((s) => s.toUpperCase()));

    // dataLayer + gtag
    result.hasDataLayer = DATALAYER_PATTERN.test(html);
    result.hasGtag = GTAG_PATTERN.test(html);

    // GA4 IDs
    const ga4Matches = html.match(GA4_ID_PATTERN) || [];
    result.ga4Ids = uniq(ga4Matches);

    // Meta Pixel
    const hasMetaPixel = META_PIXEL_PATTERN.test(html);
    if (hasMetaPixel) result.detectedPixels.push("meta");
    const fbqMatches = [...html.matchAll(META_PIXEL_ID_PATTERN)].map((m) => m[1]);
    result.metaPixelIds = uniq(fbqMatches);

    if (LINKEDIN_PATTERN.test(html)) result.detectedPixels.push("linkedin");
    if (TIKTOK_PATTERN.test(html)) result.detectedPixels.push("tiktok");
    if (GOOGLE_ADS_PATTERN.test(html)) result.detectedPixels.push("google_ads");

    // Se tem GTM mas NÃO encontramos GTM-IDs no HTML, pode ser que o
    // GTM esteja num script lazy-loaded — marca o caso pra UI exibir
    // como "GTM detectado mas ID não capturado no HTML inicial"
    if (result.hasGTM && result.gtmIds.length === 0) {
      result.gtmIds = ["[ID em script lazy-load — verifique com Tag Assistant]"];
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      result.error = `timeout (${TIMEOUT_MS}ms)`;
    } else {
      result.error = (e as Error).message;
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

async function checkBatch(urls: string[]): Promise<GTMCheckResult[]> {
  const results: GTMCheckResult[] = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const slice = urls.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(slice.map((u) => checkOne(u)));
    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  let body: { urls: string[] };
  try {
    body = (await req.json()) as { urls: string[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }
  if (body.urls.length > 50) {
    return NextResponse.json(
      { error: "máximo 50 URLs por chamada", got: body.urls.length },
      { status: 400 }
    );
  }

  // Sanitiza URLs
  const urls = body.urls.filter((u): u is string => {
    if (typeof u !== "string") return false;
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  });

  const results = await checkBatch(urls);

  // Sumário
  const summary = {
    total: results.length,
    withGTM: results.filter((r) => r.hasGTM).length,
    withoutGTM: results.filter((r) => r.fetchedOk && !r.hasGTM).length,
    withDataLayer: results.filter((r) => r.hasDataLayer).length,
    withGtag: results.filter((r) => r.hasGtag).length,
    withGA4: results.filter((r) => r.ga4Ids.length > 0).length,
    withMetaPixel: results.filter((r) => r.detectedPixels.includes("meta")).length,
    fetchErrors: results.filter((r) => r.error !== null).length,
    avgDurationMs: Math.round(
      results.reduce((s, r) => s + r.durationMs, 0) / Math.max(1, results.length)
    ),
  };

  return NextResponse.json(
    { results, summary },
    { headers: { "Cache-Control": "private, max-age=600" } } // 10min
  );
}
