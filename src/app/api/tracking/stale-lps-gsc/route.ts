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
  const days = Number(req.nextUrl.searchParams.get("days") || 30);

  // Auto-discovery: se siteUrl não foi passado, lista as properties e pega
  // a primeira que faça sentido pro hostFilter (ex: lp.suno.com.br).
  if (!siteUrl) {
    const sitesRes = await listGSCSites();
    if (sitesRes.error || !sitesRes.data) {
      return NextResponse.json(
        { error: sitesRes.error || "no_sites", suggestion: "Passe siteUrl=...&hostFilter=..." },
        { status: 400 }
      );
    }
    // Procura sites que casem com hostFilter
    const candidates = sitesRes.data.filter((s) => s.siteUrl.includes(hostFilter));
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error: "no_matching_site",
          available_sites: sitesRes.data.map((s) => s.siteUrl),
          hint: `Nenhum site GSC contém "${hostFilter}". Adicione lp.suno.com.br como property no Search Console ou use um sc-domain (ex: sc-domain:suno.com.br) que cobre o subdomínio.`,
        },
        { status: 404 }
      );
    }
    // Prioriza siteOwner > siteFullUser
    candidates.sort((a, b) => {
      const order = ["siteOwner", "siteFullUser", "siteRestrictedUser"];
      return order.indexOf(a.permissionLevel) - order.indexOf(b.permissionLevel);
    });
    siteUrl = candidates[0].siteUrl;
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
