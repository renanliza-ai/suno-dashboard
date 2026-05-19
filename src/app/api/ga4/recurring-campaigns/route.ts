import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/recurring-campaigns
 *
 * Detecta automaticamente campanhas recorrentes (Black Friday, Aniversário Suno,
 * Semana do Assinante, etc.) escaneando o histórico de UTMs do GA4.
 *
 * Estratégia:
 *  1) Puxa sessões agrupadas por sessionCampaignName + mês nos últimos 3 anos
 *  2) Aplica patterns conhecidos (regex em PT-BR + EN) pra classificar
 *  3) Agrupa por raiz da campanha (ignora sufixos como _2024, _2025, _v2)
 *  4) Retorna lista de campanhas detectadas com edições + janelas + status
 *
 * Cada campanha detectada inclui:
 *  - id (slug canônico)
 *  - displayName
 *  - icon (emoji sugestivo)
 *  - editions: [{ year, startDate, endDate, sessions, leads, purchases, revenue }]
 *  - nextExpected: data prevista da próxima edição (mesma janela do ano passado)
 *  - status: "running" | "upcoming" | "past"
 */

// ============================================================
// Patterns de detecção — case-insensitive, prioridade por ordem
// ============================================================

type CampaignPattern = {
  id: string;
  displayName: string;
  icon: string;
  // Regex matching o sessionCampaignName ou eventCampaign
  patterns: RegExp[];
  // Mês típico em que roda (1-12) — usado pra prever próxima edição
  typicalMonth?: number;
  // Duração típica em dias (pra estimar janela quando só temos sessões esparsas)
  typicalDurationDays?: number;
};

const CAMPAIGN_PATTERNS: CampaignPattern[] = [
  {
    id: "aniversario-suno",
    displayName: "Aniversário Suno",
    icon: "🎂",
    patterns: [/anivers[áa]rio/i, /\baniversary\b/i, /anivers[áa]rio.suno/i, /\baniv\b/i],
    typicalMonth: 6,
    typicalDurationDays: 7,
  },
  {
    id: "black-friday",
    displayName: "Black Friday",
    icon: "🛒",
    patterns: [/black.?friday/i, /\bbf\d*\b/i, /black.?fri/i, /sexta.?negra/i],
    typicalMonth: 11,
    typicalDurationDays: 7,
  },
  {
    id: "cyber-monday",
    displayName: "Cyber Monday",
    icon: "💻",
    patterns: [/cyber.?monday/i, /\bcyber\b/i],
    typicalMonth: 12,
    typicalDurationDays: 3,
  },
  {
    id: "semana-assinante",
    displayName: "Semana do Assinante",
    icon: "🎫",
    patterns: [/semana.?(do.?)?assinante/i, /\bsda\b/i, /sub.?week/i],
    typicalMonth: 9,
    typicalDurationDays: 7,
  },
  {
    id: "natal-suno",
    displayName: "Natal Suno",
    icon: "🎄",
    patterns: [/\bnatal\b/i, /\bxmas\b/i, /christmas/i, /natalina/i],
    typicalMonth: 12,
    typicalDurationDays: 14,
  },
  {
    id: "fim-de-ano",
    displayName: "Fim de Ano",
    icon: "🎆",
    patterns: [/fim.?de.?ano/i, /\bvirada\b/i, /\breveillon\b/i, /year.?end/i, /\bnye\b/i],
    typicalMonth: 12,
    typicalDurationDays: 14,
  },
  {
    id: "carnaval",
    displayName: "Carnaval Suno",
    icon: "🎭",
    patterns: [/carnaval/i, /\bcarnival\b/i],
    typicalMonth: 2,
    typicalDurationDays: 5,
  },
  {
    id: "dia-do-cliente",
    displayName: "Dia do Cliente",
    icon: "🤝",
    patterns: [/dia.?do.?cliente/i, /customer.?day/i],
    typicalMonth: 9,
    typicalDurationDays: 3,
  },
  {
    id: "consumidor",
    displayName: "Dia do Consumidor",
    icon: "🛍️",
    patterns: [/dia.?do.?consumidor/i, /consumer.?day/i],
    typicalMonth: 3,
    typicalDurationDays: 5,
  },
  {
    id: "mes-mulher",
    displayName: "Mês da Mulher",
    icon: "💜",
    patterns: [/m[êe]s.?(da.?)?mulher/i, /dia.?internacional.?(da.?)?mulher/i, /\bwomens?.?day\b/i],
    typicalMonth: 3,
    typicalDurationDays: 31,
  },
];

// ============================================================
// Helpers
// ============================================================

function classifyCampaignName(campaignName: string): CampaignPattern | null {
  for (const p of CAMPAIGN_PATTERNS) {
    for (const regex of p.patterns) {
      if (regex.test(campaignName)) return p;
    }
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseGA4Date(s: string): Date {
  // GA4 retorna YYYYMMDD como string sem separador
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

  // Histórico: 3 anos pra trás (cobre Aniversário 2024/2025/2026, BF 2023/2024/2025, etc)
  const today = new Date();
  const threeYearsAgo = new Date(today);
  threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);

  const dateRange = {
    startDate: isoDate(threeYearsAgo),
    endDate: isoDate(today),
  };

  // Query 1: sessões por campanha + dia — pra detectar janelas
  // Usamos limit alto pq queremos enxergar TODA a cauda
  const sessionsRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "sessionCampaignName" }, { name: "date" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
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
    // raw UTMs que matcharam (pra debug/transparência)
    matchedUtms: Set<string>;
    // dias com volume — usamos pra inferir janela de início/fim
    dailyVolume: Map<string, { sessions: number; users: number }>;
  };

  const editions = new Map<string, EditionAccumulator>(); // key: `${campaignId}-${year}`

  for (const row of sessionsRes.data?.rows || []) {
    const campaignName = row.dimensionValues?.[0]?.value || "";
    const dateStr = row.dimensionValues?.[1]?.value || "";
    const sessions = Number(row.metricValues?.[0]?.value || 0);
    const users = Number(row.metricValues?.[1]?.value || 0);

    if (!campaignName || campaignName === "(not set)" || sessions === 0) continue;

    const pattern = classifyCampaignName(campaignName);
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
        matchedUtms: new Set(),
        dailyVolume: new Map(),
      };
      editions.set(key, ed);
    }
    ed.matchedUtms.add(campaignName);
    const existing = ed.dailyVolume.get(isoDateStr) || { sessions: 0, users: 0 };
    ed.dailyVolume.set(isoDateStr, {
      sessions: existing.sessions + sessions,
      users: existing.users + users,
    });
  }

  // Infere janela (startDate/endDate) de cada edição — usa primeiro e último dia
  // com volume relevante (>= 10% do pico daquela edição, pra cortar ruído de cauda)
  type Edition = {
    year: number;
    startDate: string;
    endDate: string;
    durationDays: number;
    sessions: number;
    users: number;
    leads: number;
    purchases: number;
    revenue: number;
    peakDate: string;
    peakSessions: number;
    matchedUtms: string[];
  };

  type DetectedCampaign = {
    id: string;
    displayName: string;
    icon: string;
    typicalMonth?: number;
    typicalDurationDays?: number;
    editions: Edition[];
    // Próxima edição prevista (extrapolada da janela média)
    nextExpected: {
      startDate: string;
      endDate: string;
      daysUntilStart: number; // negativo se já passou
      status: "running" | "upcoming" | "past";
    } | null;
    // Stats agregadas pra baseline preditivo
    baseline: {
      avgSessions: number;
      avgLeads: number;
      avgPurchases: number;
      avgRevenue: number;
      yoyGrowth: number | null; // % de crescimento ano-a-ano (último vs penúltimo)
    } | null;
  };

  // Agora pra cada edição que tem janela, precisamos puxar:
  //  - leads (generate_lead)
  //  - purchases (purchase + revenue)
  // Em 1 query única filtrando pelas datas das edições detectadas

  const detectedCampaigns: DetectedCampaign[] = [];
  const editionDateRanges: { campaignId: string; year: number; startDate: string; endDate: string }[] = [];

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

    // Filtra dias com pelo menos 10% do pico (corta cauda residual de UTMs zumbis)
    const threshold = peakSessions * 0.1;
    const activeDays = [...ed.dailyVolume.entries()]
      .filter(([, v]) => v.sessions >= threshold)
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (activeDays.length === 0) continue;

    const startDate = activeDays[0][0];
    const endDate = activeDays[activeDays.length - 1][0];
    const totalSessions = [...ed.dailyVolume.values()].reduce((s, v) => s + v.sessions, 0);
    const totalUsers = [...ed.dailyVolume.values()].reduce((s, v) => s + v.users, 0);
    const duration = Math.round(
      (parseGA4Date(endDate.replace(/-/g, "")).getTime() -
        parseGA4Date(startDate.replace(/-/g, "")).getTime()) /
        86_400_000
    ) + 1;

    editionDateRanges.push({
      campaignId: ed.campaignId,
      year: ed.year,
      startDate,
      endDate,
    });

    // Stub — leads/purchases serão preenchidos abaixo
    const existing = detectedCampaigns.find((c) => c.id === ed.campaignId);
    const edition: Edition = {
      year: ed.year,
      startDate,
      endDate,
      durationDays: duration,
      sessions: totalSessions,
      users: totalUsers,
      leads: 0,
      purchases: 0,
      revenue: 0,
      peakDate,
      peakSessions,
      matchedUtms: [...ed.matchedUtms].slice(0, 10), // limita pra response
    };
    if (existing) {
      existing.editions.push(edition);
    } else {
      detectedCampaigns.push({
        id: ed.campaignId,
        displayName: ed.displayName,
        icon: ed.icon,
        typicalMonth: ed.pattern.typicalMonth,
        typicalDurationDays: ed.pattern.typicalDurationDays,
        editions: [edition],
        nextExpected: null,
        baseline: null,
      });
    }
  }

  // Query 2: pra cada janela detectada, pega leads (generate_lead) e purchases.
  // Em vez de uma query por edição (caro), fazemos 1 query agregada que pega
  // generate_lead + purchase por sessionCampaignName + date no range histórico.
  if (editionDateRanges.length > 0) {
    const eventsRes = await runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionCampaignName" }, { name: "eventName" }, { name: "date" }],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["generate_lead", "purchase", "purchase_success"] },
        },
      },
      limit: 100_000,
    });

    if (!eventsRes.error) {
      for (const row of eventsRes.data?.rows || []) {
        const campaignName = row.dimensionValues?.[0]?.value || "";
        const eventName = row.dimensionValues?.[1]?.value || "";
        const dateStr = row.dimensionValues?.[2]?.value || "";
        const count = Number(row.metricValues?.[0]?.value || 0);
        const value = Number(row.metricValues?.[1]?.value || 0);

        const pattern = classifyCampaignName(campaignName);
        if (!pattern) continue;

        const date = parseGA4Date(dateStr);
        const year = date.getUTCFullYear();
        const camp = detectedCampaigns.find((c) => c.id === pattern.id);
        if (!camp) continue;
        const edition = camp.editions.find((e) => e.year === year);
        if (!edition) continue;

        // Confere se dentro da janela
        const isoDay = isoDate(date);
        if (isoDay < edition.startDate || isoDay > edition.endDate) continue;

        if (eventName === "generate_lead") {
          edition.leads += count;
        } else if (eventName === "purchase" || eventName === "purchase_success") {
          edition.purchases += count;
          edition.revenue += value;
        }
      }
    }
  }

  // Pra cada campanha, calcula próxima edição prevista + baseline
  for (const camp of detectedCampaigns) {
    camp.editions.sort((a, b) => a.year - b.year);
    const lastEdition = camp.editions[camp.editions.length - 1];

    if (lastEdition) {
      // Próxima edição: mesma janela do ano passado +12 meses (se já passou esse ano)
      const currentYear = today.getUTCFullYear();
      const referenceStart = parseGA4Date(lastEdition.startDate.replace(/-/g, ""));
      const referenceEnd = parseGA4Date(lastEdition.endDate.replace(/-/g, ""));

      let nextStart = new Date(referenceStart);
      let nextEnd = new Date(referenceEnd);
      // Avança até cair em ano atual ou futuro
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

    // Baseline médio (todas as edições) + YoY
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
      const avgRevenue =
        camp.editions.reduce((s, e) => s + e.revenue, 0) / n;
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

  // Ordena por relevância: rodando agora primeiro, depois upcoming, depois passadas
  detectedCampaigns.sort((a, b) => {
    const statusRank = (s?: string) => (s === "running" ? 0 : s === "upcoming" ? 1 : 2);
    const ra = statusRank(a.nextExpected?.status);
    const rb = statusRank(b.nextExpected?.status);
    if (ra !== rb) return ra - rb;
    // dentro do mesmo status, ordena por dias até começar
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
        utmsTotal: sessionsRes.data?.rows?.length || 0,
      },
    },
    { headers: { "Cache-Control": "private, max-age=3600, stale-while-revalidate=7200" } }
  );
}
