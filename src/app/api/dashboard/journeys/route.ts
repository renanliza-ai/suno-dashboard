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

// SITE_JOURNEY mapeado a partir dos eventos REAIS observados no
// dataLayer (Renan validou via datalayer|checker em maio/2026):
//
//   1. page_view: visita ao site (suno.com.br + login.suno.com.br)
//   2. lead_create_account: cadastro CONCLUÍDO em login.suno.com.br
//      (dispara APÓS clicar 'Criar senha' — não no início do fluxo)
//   3. user_login: login na área logada (investidor.suno.com.br)
//      — primeiro evento ao chegar na NAI
//   4. onboarding_visualizacao_step: primeira tela de onboarding
//      (investidor.suno.com.br/onboarding)
//
// O 'sign_up' antigo foi removido — não existe na taxonomia real
// da Suno; lead_create_account cumpre essa função.
const SITE_JOURNEY: JourneyStep[] = [
  {
    event: "page_view",
    aliases: ["page_view", "pageview", "session_start"],
    label: "Visita o site",
    description: "Acesso ao suno.com.br ou login.suno.com.br",
    phase: "descoberta",
  },
  {
    event: "lead_create_account",
    aliases: ["lead_create_account"],
    label: "Cria conta",
    description: "Conclui cadastro (define senha)",
    phase: "captacao",
  },
  {
    event: "user_login",
    aliases: ["user_login", "login"],
    label: "Acessa área logada",
    description: "Primeiro login na NAI (investidor.suno.com.br)",
    phase: "ativacao",
  },
  {
    event: "onboarding_visualizacao_step",
    aliases: ["onboarding_visualizacao_step", "onboarding_step"],
    label: "Inicia onboarding",
    description: "Vê primeira tela de configuração de perfil",
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
 *
 * Suporta MÚLTIPLOS host patterns com OR — usado pra LP journey que
 * cobre lp.* (origem do tráfego) E checkout.* (onde o funil de compra
 * acontece de fato, em sistema próprio Suno).
 */
async function fetchJourney(
  propertyId: string,
  startDate: string,
  endDate: string,
  steps: JourneyStep[],
  hostPatterns: { value: string; mode: "EXACT" | "CONTAINS" | "BEGINS_WITH" }[]
): Promise<{ steps: ResolvedStep[]; totalPageViews: number; error: string | null }> {
  const dateRange = { startDate, endDate };

  // Junta todos os aliases que vamos buscar em uma única query
  const allAliases = Array.from(
    new Set(steps.flatMap((s) => s.aliases))
  );

  // Constrói expressão hostName — se 1 pattern, filter direto; se vários, orGroup
  const hostExpressions = hostPatterns.map((p) => ({
    filter: {
      fieldName: "hostName",
      stringFilter: { value: p.value, matchType: p.mode },
    },
  }));
  const hostExpr =
    hostExpressions.length === 1
      ? hostExpressions[0]
      : { orGroup: { expressions: hostExpressions } };

  try {
    const res = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            hostExpr,
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
 *
 * IMPORTANTE: a jornada de LP atravessa MÚLTIPLOS hostnames:
 *   1. lp.suno.com.br ou lp2.suno.com.br (landing pages)
 *   2. checkout.suno.com.br (sistema de checkout próprio Suno)
 *
 * O fluxo é: visita LP → click "comprar" → redireciona pro checkout.suno.com.br
 * onde rolam view_cart, begin_checkout, add_payment_info, purchase.
 *
 * Por isso retornamos array de patterns que viram OR no GA4 filter.
 */
function getHostsForProperty(propertyName: string | null): {
  // SITE journey: atravessa múltiplos hostnames próprios
  // 1) suno.com.br / www.suno.com.br (entrada)
  // 2) login.suno.com.br (cadastro)
  // 3) investidor.suno.com.br (área logada + onboarding)
  // Excluímos lp.* e checkout.* (são da outra jornada)
  siteHosts: { value: string; mode: "EXACT" | "CONTAINS" | "BEGINS_WITH" }[];
  siteHostsLabel: string;
  // LP journey: lista de hosts onde acontece o funil (LP + checkout)
  lpHosts: { value: string; mode: "CONTAINS" | "BEGINS_WITH" }[];
  lpHostsLabel: string;
} {
  const name = (propertyName || "").toLowerCase();
  if (name.includes("statusinvest")) {
    return {
      siteHosts: [
        { value: "statusinvest.com.br", mode: "EXACT" },
        { value: "www.statusinvest.com.br", mode: "EXACT" },
        { value: "login.statusinvest", mode: "CONTAINS" },
        { value: "investidor.statusinvest", mode: "CONTAINS" },
      ],
      siteHostsLabel: "statusinvest.com.br + login.* + investidor.*",
      lpHosts: [
        { value: "lp", mode: "BEGINS_WITH" }, // lp.statusinvest, lp2.statusinvest
        { value: "checkout.statusinvest", mode: "CONTAINS" },
      ],
      lpHostsLabel: "lp.* + checkout.statusinvest.com.br",
    };
  }
  // Default: Suno
  return {
    siteHosts: [
      { value: "suno.com.br", mode: "EXACT" },
      { value: "www.suno.com.br", mode: "EXACT" },
      { value: "login.suno", mode: "CONTAINS" }, // login.suno.com.br (cadastro)
      { value: "investidor.suno", mode: "CONTAINS" }, // investidor.suno.com.br (NAI)
    ],
    siteHostsLabel: "suno.com.br + login.* + investidor.*",
    lpHosts: [
      { value: "lp", mode: "BEGINS_WITH" }, // pega lp.suno, lp2.suno, etc
      { value: "checkout.suno", mode: "CONTAINS" }, // checkout.suno.com.br
    ],
    lpHostsLabel: "lp.* + checkout.suno.com.br",
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

  // 2 jornadas em paralelo, cada uma com lista de hosts permitidos (OR)
  const [siteResult, lpResult] = await Promise.all([
    // Site: atravessa suno.com.br → login.suno.com.br → investidor.suno.com.br
    // (todos hostnames próprios da Suno, exceto lp.* e checkout.* que são da
    // outra jornada). Listamos explicitamente — sem subtração.
    fetchJourney(propertyId, finalStart, finalEnd, SITE_JOURNEY, hosts.siteHosts),
    // LP: cobre TANTO o tráfego que entra na LP QUANTO o que migra pro
    // checkout.suno.com.br no momento da compra (sistema próprio)
    fetchJourney(propertyId, finalStart, finalEnd, LP_JOURNEY, hosts.lpHosts),
  ]);

  return NextResponse.json(
    {
      propertyId, // anti race-condition
      query: { propertyId, propertyName, days, startDate: finalStart, endDate: finalEnd },
      hosts,
      site: {
        title: "Jornada do Site",
        description: "Todos os canais → cadastro → área logada",
        hostFilter: hosts.siteHostsLabel,
        // Marca em qual host cada etapa acontece — mostra transições
        // suno → login.suno → investidor.suno
        hostMap: {
          page_view: "site",
          lead_create_account: "login",
          user_login: "investidor",
          onboarding_visualizacao_step: "investidor",
        },
        steps: siteResult.steps,
        totalPageViews: siteResult.totalPageViews,
        error: siteResult.error,
      },
      landingPages: {
        title: "Jornada das Landing Pages",
        description: "Todos os canais → captura de lead → checkout próprio → compra",
        hostFilter: hosts.lpHostsLabel, // ex: "lp.* + checkout.suno.com.br"
        // Marca quais etapas acontecem em qual host pra UI sinalizar a transição
        hostMap: {
          page_view: "lp",
          generate_lead: "lp",
          view_item: "lp",
          view_cart: "checkout",
          begin_checkout: "checkout",
          add_payment_info: "checkout",
          purchase: "checkout",
        },
        steps: lpResult.steps,
        totalPageViews: lpResult.totalPageViews,
        error: lpResult.error,
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}

