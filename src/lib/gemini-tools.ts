// src/lib/gemini-tools.ts
import { resolveBU, type BUProfile } from "@/lib/bu";
import {
  envelope,
  contratoDeLandingPages,
  contratoDeEventos,
  contratoDeClarity,
  contratoDeMidia,
  regraDeConversao,
  ressalvasDaJanela,
  RESSALVA_CARDINALIDADE,
  RESSALVA_RECEITA_GA4,
  RESSALVA_UNIDADE_EVENTO,
} from "@/lib/chat-semantica";

/**
 * Tools do chat híbrido com Gemini — declarations (schema que o modelo vê)
 * + executores server-side (fetch interno nos endpoints existentes do painel).
 *
 * IMPORTANTE: este módulo é SERVER-ONLY (usado por /api/chat). As respostas
 * das tools são RESUMIDAS antes de voltar ao modelo — top N linhas e campos
 * relevantes — pra economizar tokens do free tier.
 *
 * Spec: docs/superpowers/specs/2026-06-11-chat-gemini-hybrid-design.md (3)
 *
 * ⚠️ REESCRITO EM 08/10/2026 PARA USAR `bu.ts`.
 *
 * A versão anterior tinha um mapa de host ESCRITO À MÃO aqui dentro, e ele
 * estava errado de três jeitos, todos servindo resposta convincente:
 *
 *   1. `propertyName.includes("suno")` casa com "Suno Advisory", então a
 *      CONSULTORIA recebia os hosts da RESEARCH e devolvia zero para as LPs
 *      dela, com cara de "não teve lead".
 *   2. `lp2.statusinvest.com.br` não existe. O host real é `lps.`. E
 *      `lps.suno.com.br` ficou de fora.
 *   3. FIIs, Funds e Fiagro caíam em `null` ("sem hosts mapeados"), quando a
 *      FIIs tem 3.104 sessões em caminhos de LP de verdade.
 *
 * Pior que os hosts: o executor fixava `leadEvent=generate_lead` e
 * `ctaEvent=cta_click` para TODA B.U. Na Consultoria o generate_lead está
 * duplicado (divisor 2) e não existe cta_click, então o chat publicava o dobro
 * do lead e uma taxa de CTA inventada.
 *
 * Agora todo host e todo evento saem de `bu.ts`, que é a fonte única, e todo
 * retorno vem embrulhado pelo contrato de `chat-semantica.ts`.
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
      "Landing pages da B.U. selecionada, com sessões, sessões engajadas e conversão. O EVENTO de conversão é resolvido por B.U. automaticamente (não é sempre generate_lead): a Consultoria usa os eventos de MQL e tem divisor 2, a FIIs está com conversão suspensa, Funds e Fiagro não têm medição. Use pra 'LPs que mais geraram leads', 'conversão das landing pages', 'lead magnets'.",
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
  {
    name: "explore_data",
    description:
      "Exploração genérica do GA4: cruza UMA dimensão com até DUAS métricas. Use quando nenhuma outra ferramenta cobre — ex.: breakdown por dispositivo, país, cidade, navegador, sistema operacional, novo vs recorrente, ou contagem de um evento específico. Dimensões: eventName, sessionDefaultChannelGroup, deviceCategory, country, city, operatingSystem, browser, sessionSource, sessionMedium, sessionCampaignName, pagePath, hostName, newVsReturning. Métricas: eventCount, totalUsers, activeUsers, sessions, engagedSessions, eventValue, averageSessionDuration, bounceRate, screenPageViews, userEngagementDuration.",
    parameters: {
      type: "OBJECT",
      properties: {
        dimension: { type: "STRING", description: "Uma das dimensões listadas (ex.: deviceCategory)" },
        metric: { type: "STRING", description: "Métrica principal (ex.: sessions)" },
        metric2: { type: "STRING", description: "Métrica secundária opcional (ex.: totalUsers)" },
        eventFilter: { type: "STRING", description: "Substring pra filtrar por nome de evento (ex.: 'purchase')" },
      },
      required: ["dimension", "metric"],
    },
  },
  {
    name: "get_clarity",
    description:
      "Fricção de interface pelo Microsoft Clarity: rage click, dead click, scroll excessivo, quickback e erro de script por página. Use pra 'por que a página X não converte', 'onde o usuário trava', 'tem erro na LP'. Responde o POR QUÊ; o QUANTO vem do GA4. Disponível em Research, Asset, Status e Consultoria. ATENÇÃO: a janela útil é de 1 dia; pedir mais faz as páginas grandes sumirem.",
    parameters: {
      type: "OBJECT",
      properties: {
        days: {
          type: "NUMBER",
          description: "Janela em dias. Default e recomendado: 1. Acima de 1 a resposta fica enviesada.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_regra_da_bu",
    description:
      "Explica a REGRA DE MEDIÇÃO da B.U. selecionada: qual evento é a conversão, se tem divisor de duplicação, se tem CTA, se tem checkout, e se há bloqueio ativo. Use SEMPRE que a pergunta for 'como vocês contam X', 'qual evento é conversão aqui', ou antes de comparar duas B.U.s entre si.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
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

/**
 * Texto da janela, para o contrato. Usa a mesma fonte que a query, então nunca
 * descreve um período diferente do que foi consultado.
 */
function janelaTexto(ctx: ChatToolContext): string {
  if (ctx.startDate && ctx.endDate) return `${ctx.startDate} a ${ctx.endDate}`;
  return `últimos ${ctx.days} dias`;
}

/** Datas efetivas da janela, para decidir se uma ressalva de período se aplica. */
function janelaDatas(ctx: ChatToolContext): { ini: string | null; fim: string | null } {
  if (ctx.startDate && ctx.endDate) return { ini: ctx.startDate, fim: ctx.endDate };
  const hoje = new Date();
  const fim = new Date(hoje.getTime() - 86400000);
  const ini = new Date(fim.getTime() - (ctx.days - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { ini: iso(ini), fim: iso(fim) };
}

/** Perfil da B.U. da sessão. Fonte única: bu.ts. Nunca mapa local. */
function perfil(ctx: ChatToolContext): BUProfile {
  return resolveBU(ctx.propertyName);
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
        const p = perfil(ctx);
        const { ini, fim } = janelaDatas(ctx);
        return envelope(
          { bu: p.label, kpis: d.kpis ?? d },
          {
            fonte: "GA4 Data API",
            unidade: "sessao",
            escopo: "property",
            janela: janelaTexto(ctx),
            denominador: "total da property, sem quebra",
            ressalvas: [
              "Este é o total SEM quebra, então é o número que mais se aproxima da interface do GA4. Qualquer tabela quebrada por dimensão vai somar MENOS que isto, e a diferença é cardinalidade, não erro.",
              ...ressalvasDaJanela(p, ini, fim),
            ],
            naoServePara: ["ser comparado linha a linha com uma tabela quebrada por dimensão"],
          }
        );
      }

      case "get_pages": {
        const limit = Math.min(Number(args.limit) || 15, 30);
        const d = (await internalFetch(
          ctx,
          `/api/ga4/pages-detail?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as { pages?: Array<Record<string, unknown>>; error?: string };
        if (d.error) return { error: d.error };
        return envelope(
          {
            paginas: (d.pages || []).slice(0, limit).map((pg) => ({
              host: pg.host,
              path: pg.path,
              views: pg.views,
              users: pg.users,
              sessions: pg.sessions,
              avgSessionDuration: pg.avgSessionDuration,
              bounceRate: pg.bounceRate,
            })),
          },
          {
            fonte: "GA4 Data API",
            unidade: "pagina",
            escopo: "pagePath",
            janela: janelaTexto(ctx),
            denominador: "pageviews da própria página",
            ressalvas: [
              RESSALVA_CARDINALIDADE,
              "Esta lista inclui páginas de PORTAL e de área logada, não só landing page. Para LP use get_landing_pages, que filtra pelos hosts corretos da B.U.",
            ],
            naoServePara: ["ser lido como inventário de landing page"],
          }
        );
      }

      case "get_landing_pages": {
        const p = perfil(ctx);
        const hosts = p.lpHosts;
        if (hosts.length === 0) {
          return {
            error: `${p.label} não tem host de landing page registrado.`,
            contrato: { regra: regraDeConversao(p), bloqueio: p.blocked },
          };
        }
        if (p.blocked) {
          // Não há o que mostrar: a B.U. inteira está bloqueada, com motivo medido.
          return { error: p.blocked, bu: p.label, bloqueada: true };
        }
        const days = Number(args.days) || ctx.days;
        // Eventos vêm do PERFIL, nunca fixos. Sem evento, a rota não cobra conversão.
        const qs = new URLSearchParams({
          propertyId: ctx.propertyId,
          hostsIn: hosts.join(","),
          days: String(days),
          limit: "300",
        });
        if (p.leadEvent) qs.set("leadEvent", p.leadEvent);
        if (p.ctaEvent) qs.set("ctaEvent", p.ctaEvent);
        const d = (await internalFetch(
          ctx,
          `/api/ga4/landing-pages?${qs.toString()}`
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
        const divisor = p.leadDivisor > 1 ? p.leadDivisor : 1;
        const bloqueada = Boolean(p.conversaoBloqueada);
        const ranked = Array.from(byPath.entries())
          .map(([path, m]) => ({
            path,
            users: m.users,
            sessions: m.sessions,
            engagedSessions: m.engaged,
            // Conversão respeita o divisor da B.U. e some quando está suspensa.
            conversoes: bloqueada ? null : Math.round(m.leads / divisor),
            ctaClicks: p.ctaEvent && !bloqueada ? m.cta : null,
          }))
          .sort((a, b) => (b.conversoes ?? 0) - (a.conversoes ?? 0) || b.sessions - a.sessions)
          .slice(0, 25);

        const { ini, fim } = janelaDatas(ctx);
        return envelope(
          {
            bu: p.label,
            janelaDias: days,
            hosts,
            eventoDeConversao: bloqueada ? null : p.leadEvent,
            divisorAplicado: divisor,
            landingPages: ranked,
          },
          contratoDeLandingPages(p, `últimos ${days} dias`, ini, fim)
        );
      }

      case "get_regra_da_bu": {
        const p = perfil(ctx);
        return envelope(
          {
            bu: p.label,
            modeloDeConversao: p.conversionModel,
            eventoDeLead: p.leadEvent,
            divisor: p.leadDivisor,
            divisorProvado: p.leadDivisorProven,
            eventosDeMQL: p.mqlEvents,
            eventoDeCTA: p.ctaEvent,
            eventoDeContaCriada: p.accountEvent ?? null,
            hostsDeLP: p.lpHosts,
            hostsQueCaptamSemSerLP: p.captureHosts ?? [],
            bloqueioTotal: p.blocked,
            conversaoSuspensa: p.conversaoBloqueada ?? null,
            ressalvasDaBU: p.caveats,
            explicacao: regraDeConversao(p),
          },
          {
            fonte: "src/lib/bu.ts (fonte única de regra de negócio)",
            unidade: "evento",
            escopo: "nenhum",
            janela: "não se aplica, é configuração",
            denominador: null,
            ressalvas: [
              "Esta é a regra vigente, não um número. Use para explicar COMO se conta, antes de comparar B.U.s diferentes entre si.",
            ],
            naoServePara: ["ser apresentado como métrica ou volume"],
          }
        );
      }

      case "get_clarity": {
        const p = perfil(ctx);
        const days = Math.max(1, Number(args.days) || 1);
        const d = (await internalFetch(
          ctx,
          `/api/clarity/paginas?propertyName=${encodeURIComponent(ctx.propertyName)}&days=${days}`
        )) as Record<string, unknown> & { ok?: boolean; reason?: string; rows?: unknown[] };

        if (d.ok === false) {
          const motivos: Record<string, string> = {
            sem_suporte: `${p.label} não tem projeto do Clarity ligado ao painel.`,
            sem_token: `${p.label} tem projeto no Clarity, mas o token da Data Export API não está configurado neste ambiente.`,
            erro_api: `A API do Clarity recusou: ${String(d.detail ?? "")}`.trim(),
          };
          return { error: motivos[String(d.reason)] || `Clarity indisponível (${String(d.reason)})` };
        }

        const rows = Array.isArray(d.rows) ? d.rows.slice(0, 20) : [];
        return envelope(
          { bu: p.label, janelaDias: days, paginas: rows },
          contratoDeClarity(`últimos ${days} dia(s)`)
        );
      }

      case "get_conversions": {
        const d = (await internalFetch(
          ctx,
          `/api/ga4/conversions?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as { conversions?: unknown; funnel?: { steps?: unknown }; error?: string };
        if (d.error) return { error: d.error };
        const p = perfil(ctx);
        const { ini, fim } = janelaDatas(ctx);
        return envelope(
          {
            bu: p.label,
            regraDaBU: regraDeConversao(p),
            conversoes: d.conversions,
            etapasDoFunil: d.funnel?.steps,
          },
          {
            fonte: "GA4 Data API",
            unidade: "evento",
            escopo: "property",
            janela: janelaTexto(ctx),
            denominador: null,
            ressalvas: [
              RESSALVA_UNIDADE_EVENTO,
              regraDeConversao(p),
              RESSALVA_RECEITA_GA4,
              ...(p.leadDivisor > 1
                ? [
                    `⚠️ O generate_lead desta B.U. está DUPLICADO (divisor ${p.leadDivisor}). O número bruto que aparece aqui está INFLADO. Divida antes de citar, ou use os eventos de MQL.`,
                  ]
                : []),
              ...ressalvasDaJanela(p, ini, fim),
            ],
            naoServePara: [
              "citar receita ou valor monetário",
              "ser apresentado como contagem de pessoas",
            ],
          }
        );
      }

      case "get_campaigns": {
        const d = (await internalFetch(
          ctx,
          `/api/ga4/campaign-attribution?propertyId=${ctx.propertyId}&${rangeQS(ctx)}`
        )) as Record<string, unknown> & { error?: string };
        if (d.error) return { error: d.error };
        // Resume: payload completo é enorme (campaignXPage etc). Modelo só
        // precisa de canais, top campanhas, top source/medium e totais.
        const p = perfil(ctx);
        const { ini, fim } = janelaDatas(ctx);
        return envelope(
          {
            totais: d.totals,
            porCanal: Array.isArray(d.byChannel) ? (d.byChannel as unknown[]).slice(0, 10) : undefined,
            topCampanhas: Array.isArray(d.byCampaign) ? (d.byCampaign as unknown[]).slice(0, 15) : undefined,
            topOrigemMidia: Array.isArray(d.bySourceMedium) ? (d.bySourceMedium as unknown[]).slice(0, 10) : undefined,
          },
          {
            fonte: "GA4 Data API",
            unidade: "sessao",
            escopo: "sessao",
            janela: janelaTexto(ctx),
            denominador: "sessões da campanha",
            ressalvas: [
              "⚠️ `sessionCampaignName` e `sessionMedium` são dimensões de SESSÃO: elas contam quem CHEGOU com aquela URL, exista ou não o criativo publicado. Um banner tirado do ar há meses acumulou 243 mil cliques em 14 dias porque os links com a UTM continuavam circulando. Volume de campanha NÃO prova que a peça está no ar.",
              RESSALVA_CARDINALIDADE,
              ...ressalvasDaJanela(p, ini, fim),
            ],
            naoServePara: [
              "concluir que uma peça está publicada ou ativa",
              "calcular CTR, porque não existe contagem de impressão neste eixo",
            ],
          }
        );
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
        return envelope(out, contratoDeMidia(janelaTexto(ctx)));
      }

      case "explore_data": {
        const dimension = String(args.dimension || "eventName");
        const metric = String(args.metric || "sessions");
        const qs = new URLSearchParams({
          propertyId: ctx.propertyId,
          dimension,
          metric,
        });
        if (args.metric2) qs.set("metric2", String(args.metric2));
        if (args.eventFilter) qs.set("eventFilter", String(args.eventFilter));
        if (ctx.startDate && ctx.endDate) {
          qs.set("startDate", ctx.startDate);
          qs.set("endDate", ctx.endDate);
        } else {
          qs.set("days", String(ctx.days));
        }
        const d = (await internalFetch(ctx, `/api/eventos/explorer?${qs.toString()}`)) as {
          rows?: Array<Record<string, unknown>>;
          totals?: unknown;
          error?: string;
        };
        if (d.error) return { error: d.error };
        const ehEvento = metric === "eventCount" || Boolean(args.eventFilter);
        return envelope(
          {
            dimensao: dimension,
            metrica: metric,
            totais: d.totals,
            linhas: (d.rows || []).slice(0, 25),
          },
          ehEvento
            ? contratoDeEventos(janelaTexto(ctx), dimension)
            : {
                fonte: "GA4 Data API",
                unidade: metric.includes("ser") ? "sessao" : "pessoa",
                escopo: "property",
                janela: janelaTexto(ctx),
                denominador: `total de ${metric} sem quebra`,
                ressalvas: [
                  RESSALVA_CARDINALIDADE,
                  "⚠️ `totalUsers` e `activeUsers` NÃO SÃO SOMÁVEIS: a mesma pessoa aparece em mais de uma linha quando a quebra permite. Somar a coluna dá número maior que o universo real.",
                ],
                naoServePara: ["somar a coluna de usuários entre linhas"],
              }
        );
      }

      default:
        return { error: `Tool desconhecida: ${name}` };
    }
  } catch (e) {
    return { error: `Falha ao executar ${name}: ${(e as Error).message}` };
  }
}
