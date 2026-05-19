import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/recurring-campaigns
 *
 * Detecta automaticamente campanhas recorrentes (Black Friday, Aniversário Suno,
 * Semana do Assinante, etc.) escaneando o histórico de PAGEPATH do GA4.
 *
 * Por que pagePath e não sessionCampaignName:
 *  - Path é canônico (ex: /aniversario-suno/) e estável ano-a-ano
 *  - UTM muda toda hora (campaign names variam por canal/criativo)
 *  - LPs de campanha quase sempre têm slug dedicado
 *
 * Estratégia:
 *  1) Puxa pageviews agrupadas por pagePath + dia nos últimos 3 anos
 *  2) Aplica patterns conhecidos (regex em PT-BR + EN) sobre o path
 *  3) Agrupa por raiz da campanha + ano da edição
 *  4) Retorna lista de campanhas detectadas com edições + janelas + status
 */

// ============================================================
// Patterns de detecção — match sobre pagePath
// Cada padrão tem regex que casa com o slug típico da LP da campanha
// ============================================================

type CampaignPattern = {
  id: string;
  displayName: string;
  icon: string;
  // Regex matching o pagePath (ex: /aniversario-suno/, /black-friday-2024)
  patterns: RegExp[];
  // Mês típico em que roda (1-12) — usado pra prever próxima edição
  typicalMonth?: number;
  // Duração típica em dias
  typicalDurationDays?: number;
  // Descrição das URLs esperadas — mostrada no card pra deixar claro o que estamos buscando
  expectedPaths: string;
};

const CAMPAIGN_PATTERNS: CampaignPattern[] = [
  {
    id: "aniversario-suno",
    displayName: "Aniversário Suno",
    icon: "🎂",
    patterns: [/\/anivers[áa]rio/i, /\/anniversary/i, /\/aniv[-_/]/i],
    typicalMonth: 6,
    typicalDurationDays: 7,
    expectedPaths: "/aniversario-suno/, /aniversario/, /aniv/*",
  },
  {
    id: "black-friday",
    displayName: "Black Friday",
    icon: "🛒",
    patterns: [/\/black[-_]?friday/i, /\/bf\d*[-_/]/i, /\/sexta[-_]?negra/i],
    typicalMonth: 11,
    typicalDurationDays: 7,
    expectedPaths: "/black-friday/, /bf/, /sexta-negra/*",
  },
  {
    id: "cyber-monday",
    displayName: "Cyber Monday",
    icon: "💻",
    patterns: [/\/cyber[-_]?monday/i, /\/cyber\b/i],
    typicalMonth: 12,
    typicalDurationDays: 3,
    expectedPaths: "/cyber-monday/, /cyber/*",
  },
  {
    id: "semana-assinante",
    displayName: "Semana do Assinante",
    icon: "🎫",
    patterns: [/\/semana[-_]?(do[-_]?)?assinante/i, /\/sda[-_/]/i, /\/sub[-_]?week/i],
    typicalMonth: 9,
    typicalDurationDays: 7,
    expectedPaths: "/semana-assinante/, /semana-do-assinante/*",
  },
  {
    id: "natal-suno",
    displayName: "Natal Suno",
    icon: "🎄",
    patterns: [/\/natal/i, /\/xmas/i, /\/christmas/i, /\/natalina/i],
    typicalMonth: 12,
    typicalDurationDays: 14,
    expectedPaths: "/natal-suno/, /natal/, /xmas/*",
  },
  {
    id: "fim-de-ano",
    displayName: "Fim de Ano",
    icon: "🎆",
    patterns: [/\/fim[-_]?de[-_]?ano/i, /\/virada/i, /\/reveillon/i, /\/year[-_]?end/i],
    typicalMonth: 12,
    typicalDurationDays: 14,
    expectedPaths: "/fim-de-ano/, /virada/, /reveillon/*",
  },
  {
    id: "carnaval",
    displayName: "Carnaval Suno",
    icon: "🎭",
    patterns: [/\/carnaval/i, /\/carnival/i],
    typicalMonth: 2,
    typicalDurationDays: 5,
    expectedPaths: "/carnaval-suno/, /carnaval/*",
  },
  {
    id: "dia-do-cliente",
    displayName: "Dia do Cliente",
    icon: "🤝",
    patterns: [/\/dia[-_]?do[-_]?cliente/i, /\/customer[-_]?day/i],
    typicalMonth: 9,
    typicalDurationDays: 3,
    expectedPaths: "/dia-do-cliente/*",
  },
  {
    id: "consumidor",
    displayName: "Dia do Consumidor",
    icon: "🛍️",
    patterns: [/\/dia[-_]?do[-_]?consumidor/i, /\/consumer[-_]?day/i],
    typicalMonth: 3,
    typicalDurationDays: 5,
    expectedPaths: "/dia-do-consumidor/*",
  },
  {
    id: "mes-mulher",
    displayName: "Mês da Mulher",
    icon: "💜",
    patterns: [/\/m[êe]s[-_]?(da[-_]?)?mulher/i, /\/womens?[-_]?day/i, /\/dia[-_]?da[-_]?mulher/i],
    typicalMonth: 3,
    typicalDurationDays: 31,
    expectedPaths: "/mes-da-mulher/, /dia-da-mulher/*",
  },
];

// ============================================================
// Helpers
// ============================================================

function classifyPath(pagePath: string): CampaignPattern | null {
  for (const p of CAMPAIGN_PATTERNS) {
    for (const regex of p.patterns) {
      if (regex.test(pagePath)) return p;
    }
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseGA4Date(s: string): Date {
  if (/^\d{8}$/.test(s)) {
    return new Date(
      Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
    );
  }
  return new Date(s + "T00:00:00Z");
}

// ============================================================
// Endpoint
// ============================================================

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  // Histórico: 3 anos pra trás
  const today = new Date();
  const threeYearsAgo = new Date(today);
  threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);

  const dateRange = {
    startDate: isoDate(threeYearsAgo),
    endDate: isoDate(today),
  };

  // Query 1: pageviews por path + dia. Filtramos no servidor pelos paths conhecidos
  // pra reduzir payload (sem isso vinha 100k linhas)
  const pathRegexUnion = CAMPAIGN_PATTERNS.flatMap((p) =>
    p.patterns.map((r) => r.source.replace(/^\/\\?\//, ""))
  )
    .map((s) => s.replace(/\\b/g, ""))
    .join("|");

  const sessionsRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "pagePath" }, { name: "date" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: {
          matchType: "PARTIAL_REGEXP",
          value: pathRegexUnion,
          caseSensitive: false,
        },
      },
    },
    orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
    limit: 100_000,
  });

  if (sessionsRes.error) {
    return NextResponse.json(
      { error: sessionsRes.error, propertyId },
      { status: 500 }
    );
  }

  // Classifica cada linha — agrupa por (campaignPatternId, year)
  type EditionAccumulator = {
    campaignId: string;
    displayName: string;
    icon: string;
    pattern: CampaignPattern;
    year: number;
    matchedPaths: Set<string>; // os pagePaths reais que casaram
    dailyVolume: Map<string, { sessions: number; users: number; views: number }>;
  };

  const editions = new Map<string, EditionAccumulator>();

  for (const row of sessionsRes.data?.rows || []) {
    const pagePath = row.dimensionValues?.[0]?.value || "";
    const dateStr = row.dimensionValues?.[1]?.value || "";
    const sessions = Number(row.metricValues?.[0]?.value || 0);
    const users = Number(row.metricValues?.[1]?.value || 0);
    const views = Number(row.metricValues?.[2]?.value || 0);

    if (!pagePath || sessions === 0) continue;

    const pattern = classifyPath(pagePath);
    if (!pattern) continue;

    const date = parseGA4Date(dateStr);
    const year = date.getUTCFullYear();
    const key = `${pattern.id}-${year}`;
    const isoDateStr = isoDate(date);

    let ed = editions.get(key);
    if (!ed) {
      ed = {
        campaignId: pattern.id,
        displayName: pattern.displayName,
        icon: pattern.icon,
        pattern,
        year,
        matchedPaths: new Set(),
        dailyVolume: new Map(),
      };
      editions.set(key, ed);
    }
    ed.matchedPaths.add(pagePath);
    const existing = ed.dailyVolume.get(isoDateStr) || { sessions: 0, users: 0, views: 0 };
    ed.dailyVolume.set(isoDateStr, {
      sessions: existing.sessions + sessions,
      users: existing.users + users,
      views: existing.views + views,
    });
  }

  type Edition = {
    year: number;
    startDate: string;
    endDate: string;
    durationDays: number;
    sessions: number;
    users: number;
    views: number;
    leads: number;
    purchases: number;
    revenue: number;
    peakDate: string;
    peakSessions: number;
    matchedPaths: string[];
  };

  type DetectedCampaign = {
    id: string;
    displayName: string;
    icon: string;
    expectedPaths: string;
    typicalMonth?: number;
    typicalDurationDays?: number;
    editions: Edition[];
    nextExpected: {
      startDate: string;
      endDate: string;
      daysUntilStart: number;
      status: "running" | "upcoming" | "past";
    } | null;
    baseline: {
      avgSessions: number;
      avgLeads: number;
      avgPurchases: number;
      avgRevenue: number;
      yoyGrowth: number | null;
    } | null;
  };

  const detectedCampaigns: DetectedCampaign[] = [];

  for (const ed of editions.values()) {
    if (ed.dailyVolume.size === 0) continue;

    // Encontra pico
    let peakDate = "";
    let peakSessions = 0;
    for (const [day, v] of ed.dailyVolume.entries()) {
      if (v.sessions > peakSessions) {
        peakSessions = v.sessions;
        peakDate = day;
      }
    }

    // Filtra dias com pelo menos 10% do pico
    const threshold = peakSessions * 0.1;
    const activeDays = [...ed.dailyVolume.entries()]
      .filter(([, v]) => v.sessions >= threshold)
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (activeDays.length === 0) continue;

    const startDate = activeDays[0][0];
    const endDate = activeDays[activeDays.length - 1][0];
    const totalSessions = [...ed.dailyVolume.values()].reduce((s, v) => s + v.sessions, 0);
    const totalUsers = [...ed.dailyVolume.values()].reduce((s, v) => s + v.users, 0);
    const totalViews = [...ed.dailyVolume.values()].reduce((s, v) => s + v.views, 0);
    const duration =
      Math.round(
        (parseGA4Date(endDate.replace(/-/g, "")).getTime() -
          parseGA4Date(startDate.replace(/-/g, "")).getTime()) /
          86_400_000
      ) + 1;

    const existing = detectedCampaigns.find((c) => c.id === ed.campaignId);
    const edition: Edition = {
      year: ed.year,
      startDate,
      endDate,
      durationDays: duration,
      sessions: totalSessions,
      users: totalUsers,
      views: totalViews,
      leads: 0,
      purchases: 0,
      revenue: 0,
      peakDate,
      peakSessions,
      matchedPaths: [...ed.matchedPaths].slice(0, 10),
    };
    if (existing) {
      existing.editions.push(edition);
    } else {
      detectedCampaigns.push({
        id: ed.campaignId,
        displayName: ed.displayName,
        icon: ed.icon,
        expectedPaths: ed.pattern.expectedPaths,
        typicalMonth: ed.pattern.typicalMonth,
        typicalDurationDays: ed.pattern.typicalDurationDays,
        editions: [edition],
        nextExpected: null,
        baseline: null,
      });
    }
  }

  // Query 2: leads e purchases dentro das janelas detectadas — filtrando por pagePath
  if (detectedCampaigns.length > 0) {
    // Coleta todos os paths conhecidos pra fazer 1 query única
    const allPaths = new Set<string>();
    for (const camp of detectedCampaigns) {
      for (const ed of camp.editions) {
        for (const p of ed.matchedPaths) allPaths.add(p);
      }
    }

    if (allPaths.size > 0) {
      const pathsArr = [...allPaths];
      // Como inListFilter aceita até ~100 valores, fazemos em chunks de 50 pra
      // garantir margem em caso de paths longos
      const chunks: string[][] = [];
      for (let i = 0; i < pathsArr.length; i += 50) {
        chunks.push(pathsArr.slice(i, i + 50));
      }

      // Estrutura: pathToEvents[path][eventName] = { count, value }
      const pathToEvents = new Map<string, { leads: number; purchases: number; revenue: number; dailyMap: Map<string, { leads: number; purchases: number; revenue: number }> }>();

      for (const chunk of chunks) {
        const eventsRes = await runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "pagePath" }, { name: "eventName" }, { name: "date" }],
          metrics: [{ name: "eventCount" }, { name: "eventValue" }],
          dimensionFilter: {
            andGroup: {
              expressions: [
                {
                  filter: {
                    fieldName: "pagePath",
                    inListFilter: { values: chunk },
                  },
                },
                {
                  filter: {
                    fieldName: "eventName",
                    inListFilter: { values: ["generate_lead", "purchase", "purchase_success"] },
                  },
                },
              ],
            },
          },
          limit: 100_000,
        });

        if (eventsRes.error) continue;

        for (const row of eventsRes.data?.rows || []) {
          const path = row.dimensionValues?.[0]?.value || "";
          const eventName = row.dimensionValues?.[1]?.value || "";
          const dateStr = row.dimensionValues?.[2]?.value || "";
          const count = Number(row.metricValues?.[0]?.value || 0);
          const value = Number(row.metricValues?.[1]?.value || 0);

          let pathData = pathToEvents.get(path);
          if (!pathData) {
            pathData = { leads: 0, purchases: 0, revenue: 0, dailyMap: new Map() };
            pathToEvents.set(path, pathData);
          }

          const isoDay = isoDate(parseGA4Date(dateStr));
          let dayData = pathData.dailyMap.get(isoDay);
          if (!dayData) {
            dayData = { leads: 0, purchases: 0, revenue: 0 };
            pathData.dailyMap.set(isoDay, dayData);
          }

          if (eventName === "generate_lead") {
            pathData.leads += count;
            dayData.leads += count;
          } else if (eventName === "purchase" || eventName === "purchase_success") {
            pathData.purchases += count;
            pathData.revenue += value;
            dayData.purchases += count;
            dayData.revenue += value;
          }
        }
      }

      // Distribui os eventos pra edição correspondente baseado em path + janela
      for (const camp of detectedCampaigns) {
        for (const ed of camp.editions) {
          for (const path of ed.matchedPaths) {
            const pathData = pathToEvents.get(path);
            if (!pathData) continue;
            for (const [day, dayEvents] of pathData.dailyMap.entries()) {
              if (day >= ed.startDate && day <= ed.endDate) {
                ed.leads += dayEvents.leads;
                ed.purchases += dayEvents.purchases;
                ed.revenue += dayEvents.revenue;
              }
            }
          }
        }
      }
    }
  }

  // Próxima edição prevista + baseline
  for (const camp of detectedCampaigns) {
    camp.editions.sort((a, b) => a.year - b.year);
    const lastEdition = camp.editions[camp.editions.length - 1];

    if (lastEdition) {
      const referenceStart = parseGA4Date(lastEdition.startDate.replace(/-/g, ""));
      const referenceEnd = parseGA4Date(lastEdition.endDate.replace(/-/g, ""));

      const nextStart = new Date(referenceStart);
      const nextEnd = new Date(referenceEnd);
      while (nextStart < today && nextEnd < today) {
        nextStart.setUTCFullYear(nextStart.getUTCFullYear() + 1);
        nextEnd.setUTCFullYear(nextEnd.getUTCFullYear() + 1);
      }

      const daysUntilStart = Math.round(
        (nextStart.getTime() - today.getTime()) / 86_400_000
      );
      let status: "running" | "upcoming" | "past" = "upcoming";
      if (today >= nextStart && today <= nextEnd) status = "running";
      else if (daysUntilStart < 0) status = "past";

      camp.nextExpected = {
        startDate: isoDate(nextStart),
        endDate: isoDate(nextEnd),
        daysUntilStart,
        status,
      };
    }

    if (camp.editions.length > 0) {
      const n = camp.editions.length;
      const avgSessions = Math.round(
        camp.editions.reduce((s, e) => s + e.sessions, 0) / n
      );
      const avgLeads = Math.round(
        camp.editions.reduce((s, e) => s + e.leads, 0) / n
      );
      const avgPurchases = Math.round(
        camp.editions.reduce((s, e) => s + e.purchases, 0) / n
      );
      const avgRevenue = camp.editions.reduce((s, e) => s + e.revenue, 0) / n;
      let yoyGrowth: number | null = null;
      if (camp.editions.length >= 2) {
        const last = camp.editions[camp.editions.length - 1];
        const prev = camp.editions[camp.editions.length - 2];
        if (prev.sessions > 0) {
          yoyGrowth = Number(
            (((last.sessions - prev.sessions) / prev.sessions) * 100).toFixed(1)
          );
        }
      }
      camp.baseline = {
        avgSessions,
        avgLeads,
        avgPurchases,
        avgRevenue: Math.round(avgRevenue),
        yoyGrowth,
      };
    }
  }

  detectedCampaigns.sort((a, b) => {
    const statusRank = (s?: string) => (s === "running" ? 0 : s === "upcoming" ? 1 : 2);
    const ra = statusRank(a.nextExpected?.status);
    const rb = statusRank(b.nextExpected?.status);
    if (ra !== rb) return ra - rb;
    const da = a.nextExpected?.daysUntilStart ?? 999;
    const db = b.nextExpected?.daysUntilStart ?? 999;
    return Math.abs(da) - Math.abs(db);
  });

  return NextResponse.json(
    {
      propertyId,
      query: { dateRange },
      campaigns: detectedCampaigns,
      meta: {
        totalDetected: detectedCampaigns.length,
        patternsScanned: CAMPAIGN_PATTERNS.length,
        pagesScanned: sessionsRes.data?.rows?.length || 0,
        detectionMode: "pagePath", // distingue da versão antiga (sessionCampaignName)
      },
    },
    { headers: { "Cache-Control": "private, max-age=3600, stale-while-revalidate=7200" } }
  );
}
