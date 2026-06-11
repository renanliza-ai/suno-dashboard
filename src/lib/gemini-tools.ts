// src/lib/gemini-tools.ts

/**
 * Tools do chat híbrido com Gemini — declarations (schema que o modelo vê)
 * + executores server-side (fetch interno nos endpoints existentes do painel).
 *
 * IMPORTANTE: este módulo é SERVER-ONLY (usado por /api/chat). As respostas
 * das tools são RESUMIDAS antes de voltar ao modelo — top N linhas e campos
 * relevantes — pra economizar tokens do free tier.
 *
 * Spec: docs/superpowers/specs/2026-06-11-chat-gemini-hybrid-design.md (3)
 */

export type ChatToolContext = {
  origin: string; // req.nextUrl.origin — base pros fetches internos
  propertyId: string;
  propertyName: string;
  days: number;
  startDate?: string;
  endDate?: string;
  cookie?: string; // repassa cookie da sessão pros endpoints que checam auth
};

/** Declarations no formato function_declarations da API Gemini (REST v1beta). */
export const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "get_overview",
    description:
      "KPIs gerais da propriedade no período selecionado: usuários ativos, sessões, pageviews, conversões e tendência diária. Use pra perguntas tipo 'como está o site', 'resumo do mês'.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_pages",
    description:
      "Páginas mais acessadas com views, usuários, sessões, tempo médio e bounce. Use pra 'quais páginas mais acessadas', 'performance da página X'.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: { type: "NUMBER", description: "Quantas páginas retornar (default 15, máx 30)" },
      },
      required: [],
    },
  },
  {
    name: "get_landing_pages",
    description:
      "Landing pages de captação (hosts lp.*) com usuários, sessões, sessões engajadas, leads (generate_lead) e cliques de CTA (cta_click). Use pra 'LPs que mais geraram leads', 'conversão das landing pages', 'lead magnets'.",
    parameters: {
      type: "OBJECT",
      properties: {
        days: { type: "NUMBER", description: "Janela em dias se o usuário pedir período diferente do selecionado (ex.: 60, 90)" },
      },
      required: [],
    },
  },
  {
    name: "get_conversions",
    description:
      "Eventos de conversão (generate_lead, purchase, begin_checkout etc.) com contagem, usuários e valor, mais o funil de compra. Use pra 'quantas vendas', 'quantos leads', 'funil de checkout'.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_campaigns",
    description:
      "Atribuição por canal e campanha: sessões, conversões (generate_lead/purchase) por origem, mídia e campanha. Use pra 'qual campanha converte mais', 'melhor canal', 'de onde vêm os leads'.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_ads",
    description:
      "Mídia paga (Meta Ads e Google Ads): investimento, impressões, cliques, conversões, receita e ROAS por campanha. Use pra 'quanto gastamos', 'ROAS', 'campanhas pagas'.",
    parameters: {
      type: "OBJECT",
      properties: {
        platform: { type: "STRING", description: "'meta', 'google' ou 'both' (default both)" },
      },
      required: [],
    },
  },
];

// ---------- Helpers ----------

function rangeQS(ctx: ChatToolContext): string {
  if (ctx.startDate && ctx.endDate) return `startDate=${ctx.startDate}&endDate=${ctx.endDate}`;
  return `days=${ctx.days}`;
}

async function internalFetch(ctx: ChatToolContext, path: string): Promise<unknown> {
  const resp = await fetch(`${ctx.origin}${path}`, {
    headers: ctx.cookie ? { cookie: ctx.cookie } : undefined,
    // 20s — abaixo do timeout do route handler
    signal: AbortSignal.timeout(20000),
  });
  return resp.json();
}

/** Resolve hosts de LP pela property — mesmo mapa do LP Analyzer. */
function lpHosts(propertyName: string): string[] | null {
  const lower = propertyName.toLowerCase();
  if (lower.includes("suno")) return ["lp.suno.com.br", "lp2.suno.com.br"];
  if (lower.includes("status")) return ["lp.statusinvest.com.br", "lp2.statusinvest.com.br"];
  return null;
}

// ---------- Executores ----------

type ToolResult = Record<string, unknown>;

export async function executeChatTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ChatToolContext
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_overview": {
        const d = (await internalFetch(
          ctx,
          `/api/ga4/overview?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as { kpis?: unknown; error?: string };
        if (d.error) return { error: d.error };
        return { kpis: d.kpis ?? d };
      }

      case "get_pages": {
        const limit = Math.min(Number(args.limit) || 15, 30);
        const d = (await internalFetch(
          ctx,
          `/api/ga4/pages-detail?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as { pages?: Array<Record<string, unknown>>; error?: string };
        if (d.error) return { error: d.error };
        return {
          pages: (d.pages || []).slice(0, limit).map((p) => ({
            host: p.host,
            path: p.path,
            views: p.views,
            users: p.users,
            sessions: p.sessions,
            avgSessionDuration: p.avgSessionDuration,
            bounceRate: p.bounceRate,
          })),
        };
      }

      case "get_landing_pages": {
        const hosts = lpHosts(ctx.propertyName);
        if (!hosts) return { error: `Property ${ctx.propertyName} sem hosts de LP mapeados` };
        const days = Number(args.days) || ctx.days;
        const d = (await internalFetch(
          ctx,
          `/api/ga4/landing-pages?propertyId=${ctx.propertyId}&hostsIn=${hosts.join(",")}&days=${days}&leadEvent=generate_lead&ctaEvent=cta_click&limit=300`
        )) as { pages?: Array<Record<string, unknown>>; error?: string };
        if (d.error) return { error: d.error };
        // Agrega variantes querystring no path base e resume top 25 por leads
        const byPath = new Map<string, { users: number; sessions: number; engaged: number; leads: number; cta: number }>();
        for (const p of d.pages || []) {
          const base = String(p.path || "/").split("?")[0];
          const cur = byPath.get(base) || { users: 0, sessions: 0, engaged: 0, leads: 0, cta: 0 };
          cur.users += Number(p.users) || 0;
          cur.sessions += Number(p.sessions) || 0;
          cur.engaged += Number(p.engagedSessions) || 0;
          cur.leads += Number(p.leadCount) || 0;
          cur.cta += Number(p.ctaCount) || 0;
          byPath.set(base, cur);
        }
        const ranked = Array.from(byPath.entries())
          .map(([path, m]) => ({ path, ...m }))
          .sort((a, b) => b.leads - a.leads)
          .slice(0, 25);
        return { days, hosts, landingPages: ranked };
      }

      case "get_conversions": {
        const d = (await internalFetch(
          ctx,
          `/api/ga4/conversions?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as { conversions?: unknown; funnel?: { steps?: unknown }; error?: string };
        if (d.error) return { error: d.error };
        return { conversions: d.conversions, funnelSteps: d.funnel?.steps };
      }

      case "get_campaigns": {
        const d = (await internalFetch(
          ctx,
          `/api/ga4/campaign-attribution?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as Record<string, unknown> & { error?: string };
        if (d.error) return { error: d.error };
        // Resume: payload completo é enorme (campaignXPage etc). Modelo só
        // precisa de canais, top campanhas, top source/medium e totais.
        return {
          totals: d.totals,
          byChannel: Array.isArray(d.byChannel) ? (d.byChannel as unknown[]).slice(0, 10) : undefined,
          topCampaigns: Array.isArray(d.byCampaign) ? (d.byCampaign as unknown[]).slice(0, 15) : undefined,
          topSourceMedium: Array.isArray(d.bySourceMedium) ? (d.bySourceMedium as unknown[]).slice(0, 10) : undefined,
        };
      }

      case "get_ads": {
        const platform = String(args.platform || "both");
        const out: ToolResult = {};
        const propLabel = encodeURIComponent(`${ctx.propertyName}`);
        if (platform === "meta" || platform === "both") {
          const m = (await internalFetch(ctx, `/api/ads/meta?propertyName=${propLabel}`)) as Record<string, unknown>;
          out.meta = m.error
            ? { error: m.error }
            : { totals: m.totals, campaigns: Array.isArray(m.campaigns) ? (m.campaigns as unknown[]).slice(0, 10) : undefined };
        }
        if (platform === "google" || platform === "both") {
          const g = (await internalFetch(ctx, `/api/ads/google?propertyName=${propLabel}`)) as Record<string, unknown>;
          out.google = g.error
            ? { error: g.error }
            : { totals: g.totals, campaigns: Array.isArray(g.campaigns) ? (g.campaigns as unknown[]).slice(0, 10) : undefined };
        }
        return out;
      }

      default:
        return { error: `Tool desconhecida: ${name}` };
    }
  } catch (e) {
    return { error: `Falha ao executar ${name}: ${(e as Error).message}` };
  }
}
