import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/dashboard/journeys
 *
 * Retorna 2 jornadas paralelas — pedido do Renan pra separar:
 *
 *   1. SITE (suno.com.br):
 *      - Foco: acessos diretos/orgânicos
 *      - Evento de captação: lead_create_account (criação de conta)
 *      - Funil: page_view → lead_create_account → sign_up → user_login
 *
 *   2. LANDING PAGES (lp.suno.com.br, lp2.suno.com.br):
 *      - Foco: campanhas pagas + capture de lead via formulário
 *      - Evento de captação: generate_lead
 *      - Funil: page_view → generate_lead → view_item → view_cart
 *               → begin_checkout → add_payment_info → purchase
 *
 * Estratégia: 2 conjuntos de queries em paralelo, cada um com seu
 * dimensionFilter por hostName. Aliases consideradas pra cada evento.
 */

type JourneyStep = {
  event: string;
  aliases: string[];
  label: string;
  description: string;
  phase: "descoberta" | "captacao" | "ativacao" | "compra" | "retencao";
};

const SITE_JOURNEY: JourneyStep[] = [
  {
    event: "page_view",
    aliases: ["page_view", "pageview", "session_start"],
    label: "Visita o site",
    description: "Entrada via orgânico/direto",
    phase: "descoberta",
  },
  {
    event: "lead_create_account",
    aliases: ["lead_create_account", "sign_up_start"],
    label: "Inicia cadastro",
    description: "Começa a criar conta na Suno",
    phase: "captacao",
  },
  {
    event: "sign_up",
    aliases: ["sign_up", "account_created", "user_signup"],
    label: "Conta criada",
    description: "Cadastro concluído com sucesso",
    phase: "ativacao",
  },
  {
    event: "user_login",
    aliases: ["user_login", "login"],
    label: "Loga na área",
    description: "Acessa a área logada (NAI)",
    phase: "retencao",
  },
];

const LP_JOURNEY: JourneyStep[] = [
  {
    event: "page_view",
    aliases: ["page_view", "pageview", "session_start"],
    label: "Visita a LP",
    description: "Cai numa landing page de campanha",
    phase: "descoberta",
  },
  {
    event: "generate_lead",
    aliases: ["generate_lead", "lead", "form_submit_lead", "lead_submit"],
    label: "Vira lead",
    description: "Preenche formulário de captura",
    phase: "captacao",
  },
  {
    event: "view_item",
    aliases: ["view_item", "view_product"],
    label: "Vê produto",
    description: "Acessa página de produto",
    phase: "ativacao",
  },
  {
    event: "view_cart",
    aliases: ["view_cart", "add_to_cart"],
    label: "Adiciona ao carrinho",
    description: "Demonstra interesse de compra",
    phase: "compra",
  },
  {
    event: "begin_checkout",
    aliases: ["begin_checkout", "checkout_start"],
    label: "Inicia checkout",
    description: "Preenche dados pessoais",
    phase: "compra",
  },
  {
    event: "add_payment_info",
    aliases: ["add_payment_info", "add_shipping_info"],
    label: "Preenche pagamento",
    description: "Informa cartão/Pix",
    phase: "compra",
  },
  {
    event: "purchase",
    aliases: ["purchase", "purchase_success"],
    label: "Compra concluída",
    description: "Conversão",
    phase: "compra",
  },
];

type ResolvedStep = {
  event: string;
  matchedAlias: string | null;
  label: string;
  description: string;
  phase: string;
  count: number;
  pctOfTop: number;
  dropFromPrev: number;
  dropAbsoluteFromPrev: number;
};

/**
 * Roda 1 query agregada por eventName filtrada por host, e resolve cada
 * etapa do funil pegando o melhor alias.
 */
async function fetchJourney(
  propertyId: string,
  startDate: string,
  endDate: string,
  steps: JourneyStep[],
  hostFilterValue: string,
  hostFilterMode: "EXACT" | "CONTAINS" | "BEGINS_WITH" = "EXACT"
): Promise<{ steps: ResolvedStep[]; totalPageViews: number; error: string | null }> {
  const dateRange = { startDate, endDate };

  // Junta todos os aliases que vamos buscar em uma única query
  const allAliases = Array.from(
    new Set(steps.flatMap((s) => s.aliases))
  );

  try {
    const res = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "hostName",
                stringFilter: { value: hostFilterValue, matchType: hostFilterMode },
              },
            },
            {
              filter: {
                fieldName: "eventName",
                inListFilter: { values: allAliases },
              },
            },
          ],
        },
      },
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 200,
    });

    if (res.error) {
      return { steps: [], totalPageViews: 0, error: res.error };
    }

    // Mapa eventName → count
    const counts = new Map<string, number>();
    for (const r of res.data?.rows || []) {
      const name = r.dimensionValues?.[0]?.value || "";
      const count = Number(r.metricValues?.[0]?.value || 0);
      counts.set(name, count);
    }

    // Resolve cada step pegando o melhor alias
    const resolved: ResolvedStep[] = steps.map((step) => {
      let bestAlias: string | null = null;
      let bestCount = 0;
      for (const alias of step.aliases) {
        const c = counts.get(alias) || 0;
        if (c > bestCount) {
          bestAlias = alias;
          bestCount = c;
        }
      }
      return {
        event: step.event,
        matchedAlias: bestAlias,
        label: step.label,
        description: step.description,
        phase: step.phase,
        count: bestCount,
        pctOfTop: 0, // calculado abaixo
        dropFromPrev: 0,
        dropAbsoluteFromPrev: 0,
      };
    });

    // Calcula pctOfTop + drop entre etapas
    const top = resolved[0]?.count || 0;
    resolved.forEach((s, i) => {
      s.pctOfTop = top > 0 ? Number(((s.count / top) * 100).toFixed(2)) : 0;
      if (i > 0) {
        const prev = resolved[i - 1];
        s.dropAbsoluteFromPrev = Math.max(0, prev.count - s.count);
        s.dropFromPrev =
          prev.count > 0
            ? Number(((1 - s.count / prev.count) * 100).toFixed(1))
            : 0;
      }
    });

    return { steps: resolved, totalPageViews: top, error: null };
  } catch (e) {
    return { steps: [], totalPageViews: 0, error: (e as Error).message };
  }
}

/**
 * Detecta hostnames de site e LPs baseado no nome da property.
 * Mapeamento alinhado com o resto do painel (área-logada, paginas, etc).
 */
function getHostsForProperty(propertyName: string | null): {
  siteHost: string;
  siteHostMode: "EXACT" | "CONTAINS";
  lpHostPattern: string; // substring pra CONTAINS
} {
  const name = (propertyName || "").toLowerCase();
  if (name.includes("statusinvest")) {
    return {
      siteHost: "statusinvest.com.br",
      siteHostMode: "CONTAINS",
      lpHostPattern: "lp", // lp.statusinvest.com.br ou similar
    };
  }
  // Default: Suno
  return {
    siteHost: "suno.com.br",
    siteHostMode: "CONTAINS", // pega www.suno.com.br também
    lpHostPattern: "lp.",
  };
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const propertyName = req.nextUrl.searchParams.get("propertyName") || "";
  const days = Number(req.nextUrl.searchParams.get("days") || 30);

  // Date range
  const today = new Date();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  // Honra customRange se enviado
  const customStart = req.nextUrl.searchParams.get("startDate");
  const customEnd = req.nextUrl.searchParams.get("endDate");
  const finalStart =
    customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart) ? customStart : startDate;
  const finalEnd =
    customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customEnd) ? customEnd : endDate;

  const hosts = getHostsForProperty(propertyName);

  // 2 jornadas em paralelo
  // Para o SITE: queremos hostName == "suno.com.br" OU "www.suno.com.br" — NÃO os lp.*
  // Como o GA4 filter não suporta NOT facilmente, fazemos CONTAINS no domínio raiz
  // mas filtramos lp.* depois client-side. Pra simplificar, usamos BEGINS_WITH pra evitar lp.*
  const [siteResult, lpResult] = await Promise.all([
    // Site: hosts que NÃO começam com "lp." — usamos suno.com.br ou statusinvest.com.br exato + www
    // Como não dá pra exigir "NOT BEGINS_WITH lp.", fazemos 2 sub-queries unidas:
    fetchSiteJourney(propertyId, finalStart, finalEnd, hosts.siteHost),
    fetchJourney(propertyId, finalStart, finalEnd, LP_JOURNEY, hosts.lpHostPattern, "CONTAINS"),
  ]);

  return NextResponse.json(
    {
      propertyId, // anti race-condition
      query: { propertyId, propertyName, days, startDate: finalStart, endDate: finalEnd },
      hosts,
      site: {
        title: "Jornada do Site",
        description: "Tráfego orgânico/direto que cria conta na Suno",
        hostFilter: hosts.siteHost,
        steps: siteResult.steps,
        totalPageViews: siteResult.totalPageViews,
        error: siteResult.error,
      },
      landingPages: {
        title: "Jornada das Landing Pages",
        description: "Tráfego pago → captura de lead → compra",
        hostFilter: `*${hosts.lpHostPattern}*`,
        steps: lpResult.steps,
        totalPageViews: lpResult.totalPageViews,
        error: lpResult.error,
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}

/**
 * Site journey é especial — precisa EXCLUIR hostnames que começam com "lp."
 * porque o tráfego deles é capturado na journey de landing pages.
 * Estratégia: 2 sub-queries (todos os hosts da property + lp.*) e subtraímos.
 */
async function fetchSiteJourney(
  propertyId: string,
  startDate: string,
  endDate: string,
  siteHost: string
): Promise<{ steps: ResolvedStep[]; totalPageViews: number; error: string | null }> {
  const dateRange = { startDate, endDate };
  const allAliases = Array.from(new Set(SITE_JOURNEY.flatMap((s) => s.aliases)));

  try {
    // Query 1: TODOS os hosts da property que contenham o siteHost (suno.com.br)
    const [totalRes, lpRes] = await Promise.all([
      runReport(propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "hostName",
                  stringFilter: { value: siteHost, matchType: "CONTAINS" },
                },
              },
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: { values: allAliases },
                },
              },
            ],
          },
        },
        limit: 200,
      }),
      // Query 2: APENAS hosts que começam com "lp." (pra subtrair)
      runReport(propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "hostName",
                  stringFilter: { value: "lp", matchType: "BEGINS_WITH" },
                },
              },
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: { values: allAliases },
                },
              },
            ],
          },
        },
        limit: 200,
      }),
    ]);

    if (totalRes.error) {
      return { steps: [], totalPageViews: 0, error: totalRes.error };
    }

    const totalCounts = new Map<string, number>();
    for (const r of totalRes.data?.rows || []) {
      totalCounts.set(
        r.dimensionValues?.[0]?.value || "",
        Number(r.metricValues?.[0]?.value || 0)
      );
    }
    const lpCounts = new Map<string, number>();
    for (const r of lpRes.data?.rows || []) {
      lpCounts.set(
        r.dimensionValues?.[0]?.value || "",
        Number(r.metricValues?.[0]?.value || 0)
      );
    }

    // Site = total - lp
    const siteCounts = new Map<string, number>();
    for (const [name, count] of totalCounts) {
      siteCounts.set(name, Math.max(0, count - (lpCounts.get(name) || 0)));
    }

    const resolved: ResolvedStep[] = SITE_JOURNEY.map((step) => {
      let bestAlias: string | null = null;
      let bestCount = 0;
      for (const alias of step.aliases) {
        const c = siteCounts.get(alias) || 0;
        if (c > bestCount) {
          bestAlias = alias;
          bestCount = c;
        }
      }
      return {
        event: step.event,
        matchedAlias: bestAlias,
        label: step.label,
        description: step.description,
        phase: step.phase,
        count: bestCount,
        pctOfTop: 0,
        dropFromPrev: 0,
        dropAbsoluteFromPrev: 0,
      };
    });

    const top = resolved[0]?.count || 0;
    resolved.forEach((s, i) => {
      s.pctOfTop = top > 0 ? Number(((s.count / top) * 100).toFixed(2)) : 0;
      if (i > 0) {
        const prev = resolved[i - 1];
        s.dropAbsoluteFromPrev = Math.max(0, prev.count - s.count);
        s.dropFromPrev =
          prev.count > 0 ? Number(((1 - s.count / prev.count) * 100).toFixed(1)) : 0;
      }
    });

    return { steps: resolved, totalPageViews: top, error: null };
  } catch (e) {
    return { steps: [], totalPageViews: 0, error: (e as Error).message };
  }
}
