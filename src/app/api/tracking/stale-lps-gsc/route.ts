import { runGSCQuery, listGSCSites, buildGSCDateRange } from "@/lib/gsc-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/tracking/stale-lps-gsc?siteUrl=...&days=30&hostFilter=lp.
 *
 * 🔒 Master-only.
 *
 * Busca no Google Search Console as URLs do tipo `lp.*` que estão
 * sendo INDEXADAS pelo Google (recebendo impressões), pra cruzar com
 * o que GA4 já mostrou na aba /tracking. As que aparecem aqui mas
 * NÃO têm tráfego no GA4 são as "LPs zumbis" — indexadas no SERP,
 * gastando crawl budget, mas sem ROI.
 *
 * Estratégia:
 *   1. Se siteUrl não foi passado, lista todas as properties GSC
 *      do usuário e procura uma compatível com o hostFilter
 *   2. Roda searchAnalytics.query com dimension=["page"] filtrado
 *      por host CONTAINS hostFilter (ex: "lp.")
 *   3. Retorna até 1000 URLs com clicks + impressions + position
 */
export async function GET(req: NextRequest) {
  // Gate master
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  let siteUrl = req.nextUrl.searchParams.get("siteUrl");
  const hostFilter = req.nextUrl.searchParams.get("hostFilter") || "lp.";
  const propertyName = (req.nextUrl.searchParams.get("propertyName") || "").toLowerCase();
  const days = Number(req.nextUrl.searchParams.get("days") || 30);

  // Auto-discovery inteligente: extrai o domínio "raiz" da propriedade
  // pra achar o sc-domain certo. sc-domains cobrem TODOS os subdomínios
  // (sc-domain:suno.com.br pega lp.suno.com.br também) — eles são a
  // escolha preferida quando disponíveis.
  if (!siteUrl) {
    const sitesRes = await listGSCSites();
    if (sitesRes.error || !sitesRes.data) {
      return NextResponse.json(
        { error: sitesRes.error || "no_sites", suggestion: "Passe siteUrl=...&hostFilter=..." },
        { status: 400 }
      );
    }
    const allSites = sitesRes.data;

    // Mapeia propertyName GA4 → palavra-chave do domínio
    // "Suno Research – Web" → "suno"
    // "Statusinvest - Web" → "statusinvest"
    // "Suno Advisory" → "suno"
    let domainHint = "";
    if (propertyName.includes("statusinvest")) domainHint = "statusinvest.com.br";
    else if (propertyName.includes("suno")) domainHint = "suno.com.br";
    // Se não temos hint do propertyName, tenta extrair do hostFilter
    // ("lp.suno.com.br" → "suno.com.br")
    if (!domainHint && hostFilter.includes(".") && hostFilter !== "lp.") {
      const parts = hostFilter.split(".");
      // Remove o "lp" inicial se houver
      if (parts[0] === "lp") parts.shift();
      domainHint = parts.join(".");
    }

    // 1. Prioridade absoluta: sc-domain que case com domainHint
    // (cobre todos subdomínios, mais robusto)
    const scDomainMatch = domainHint
      ? allSites.find((s) => s.siteUrl === `sc-domain:${domainHint}`)
      : null;

    // 2. Fallback: URL prefix que contenha o domainHint ou hostFilter
    const urlPrefixMatch = !scDomainMatch
      ? allSites.find((s) => {
          if (!s.siteUrl.startsWith("http")) return false;
          const target = domainHint || hostFilter;
          return target && s.siteUrl.includes(target);
        })
      : null;

    // 3. Último recurso: qualquer sc-domain (sem filtro)
    const anyScDomain = !scDomainMatch && !urlPrefixMatch
      ? allSites.find((s) => s.siteUrl.startsWith("sc-domain:") && (
          domainHint ? s.siteUrl.includes(domainHint) : true
        ))
      : null;

    const chosen = scDomainMatch || urlPrefixMatch || anyScDomain;

    if (!chosen) {
      return NextResponse.json(
        {
          error: "no_matching_site",
          available_sites: allSites.map((s) => s.siteUrl),
          domainHint: domainHint || null,
          hint: `Nenhum site GSC casa com "${domainHint || hostFilter}". Sites disponíveis listados acima — passe ?siteUrl=... explicitamente pra forçar um deles.`,
        },
        { status: 404 }
      );
    }
    siteUrl = chosen.siteUrl;
  }

  const range = buildGSCDateRange(days);

  // Query GSC: top 1000 URLs com filter por hostFilter
  const result = await runGSCQuery(siteUrl, {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: ["page"],
    rowLimit: 1000,
    dimensionFilterGroups: [
      {
        filters: [
          {
            dimension: "page",
            operator: "contains",
            expression: hostFilter,
          },
        ],
      },
    ],
  });

  if (result.error) {
    return NextResponse.json(
      { error: result.error, siteUrl, hint: "Verifique se essa propriedade GSC tem dados ou tente outro siteUrl." },
      { status: 200 }
    );
  }

  const rows = (result.data?.rows || []).map((r) => {
    const url = r.keys[0] || "";
    let host = "";
    let path = "";
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname + u.search;
    } catch {
      host = url;
      path = "";
    }
    return {
      url,
      host,
      path,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Number((r.ctr * 100).toFixed(2)), // % para UI
      position: Number(r.position.toFixed(1)),
    };
  });

  return NextResponse.json(
    {
      siteUrl,
      hostFilter,
      range,
      totalUrls: rows.length,
      rows,
    },
    { headers: { "Cache-Control": "private, max-age=900" } }
  );
}
