import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/tracking/lp-healthcheck
 *
 * 🔒 Master-only.
 *
 * Recebe uma lista de URLs (POST body) e devolve o status HTTP real de cada
 * uma. Resolve a pergunta: essa LP está no ar, redirecionada ou 404?
 *
 * Estratégia:
 *  - GET com redirect: "manual" pra capturar 301/302 sem seguir
 *  - timeout 8s por URL pra não travar batch
 *  - concorrência 10 (não inundar servidor de origem)
 *  - retorna por URL: status, redirectTo (se 3xx), finalUrl, error
 */

type HealthRequest = { urls: string[] };
type HealthResult = {
  url: string;
  status: number | null;
  ok: boolean;
  redirectTo: string | null;
  contentType: string | null;
  error: string | null;
  durationMs: number;
};

const BATCH_SIZE = 10;
const TIMEOUT_MS = 8000;

async function checkOne(url: string): Promise<HealthResult> {
  const start = Date.now();
  const result: HealthResult = {
    url,
    status: null,
    ok: false,
    redirectTo: null,
    contentType: null,
    error: null,
    durationMs: 0,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: "GET",
      redirect: "manual", // não segue 3xx — deixa a gente vê-los
      signal: controller.signal,
      cache: "no-store",
      headers: {
        // User-agent realista pra não cair em WAF agressivo
        "User-Agent":
          "Mozilla/5.0 (compatible; SunoDashboardHealthCheck/1.0; +https://suno-dashboard-painel.vercel.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeoutId);

    result.status = res.status;
    result.ok = res.status >= 200 && res.status < 300;
    result.contentType = res.headers.get("content-type");

    // Captura redirect destination
    if (res.status >= 300 && res.status < 400) {
      result.redirectTo = res.headers.get("location") || null;
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

async function checkBatch(urls: string[]): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
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
  // Gate master
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  let body: HealthRequest;
  try {
    body = (await req.json()) as HealthRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }

  if (body.urls.length > 500) {
    return NextResponse.json(
      { error: "máximo 500 URLs por chamada", got: body.urls.length },
      { status: 400 }
    );
  }

  // Sanitiza URLs — só http(s) válidas
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

  // Sumário pra UI gerar KPIs
  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    redirect: results.filter((r) => r.status !== null && r.status >= 300 && r.status < 400).length,
    not_found: results.filter((r) => r.status === 404).length,
    server_error: results.filter((r) => r.status !== null && r.status >= 500).length,
    error: results.filter((r) => r.error !== null).length,
  };

  return NextResponse.json(
    { results, summary },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
