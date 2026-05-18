import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/audience
 *
 * Demografia / geografia / tecnologia REAL do GA4 — pra alimentar a página
 * /audiencia sem depender de mocks estáticos.
 *
 * Importante: `userAgeBracket` e `userGender` só retornam se o Google Signals
 * estiver ativo na propriedade. Caímos no fallback "(not set)" quando não tiver.
 */

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");

  const dateRange =
    startDateParam && endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
      ? { startDate: startDateParam, endDate: endDateParam }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  // 6 queries em paralelo — uma round-trip pra cobrir o dashboard inteiro
  const [ageRes, genderRes, stateRes, browserRes, osRes, deviceRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "userAgeBracket" }],
      metrics: [{ name: "totalUsers" }],
      orderBys: [{ dimension: { dimensionName: "userAgeBracket" } }],
      limit: 20,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "userGender" }],
      metrics: [{ name: "totalUsers" }],
      limit: 10,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "region" }, { name: "country" }],
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: {
        filter: {
          fieldName: "country",
          stringFilter: { matchType: "EXACT", value: "Brazil" },
        },
      },
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 27,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "browser" }],
      metrics: [{ name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 8,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "operatingSystem" }],
      metrics: [{ name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 8,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 5,
    }),
  ]);

  // Helper: extrai linhas e calcula percentuais
  function rowsToList(
    rows: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] | undefined,
    labelMap?: Record<string, string>
  ): { name: string; users: number; pct: number }[] {
    const list = (rows || []).map((r) => {
      const raw = r.dimensionValues?.[0]?.value || "(not set)";
      const name = labelMap?.[raw] || raw;
      return { name, users: Number(r.metricValues?.[0]?.value || 0) };
    });
    const total = list.reduce((s, x) => s + x.users, 0);
    return list
      .map((x) => ({ ...x, pct: total > 0 ? Number(((x.users / total) * 100).toFixed(1)) : 0 }))
      .filter((x) => x.users > 0);
  }

  // Mapeia siglas de regiões BR (GA4 retorna nome completo, normalmente "Sao Paulo", "Rio de Janeiro" etc)
  const stateAbbrev: Record<string, string> = {
    Acre: "AC", Alagoas: "AL", Amapá: "AP", "Amapa": "AP", Amazonas: "AM",
    Bahia: "BA", Ceará: "CE", "Ceara": "CE",
    "Distrito Federal": "DF", "Federal District": "DF",
    "Espírito Santo": "ES", "Espirito Santo": "ES",
    Goiás: "GO", "Goias": "GO", Maranhão: "MA", "Maranhao": "MA",
    "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
    "Minas Gerais": "MG", Pará: "PA", "Para": "PA",
    Paraíba: "PB", "Paraiba": "PB", Paraná: "PR", "Parana": "PR",
    Pernambuco: "PE", Piauí: "PI", "Piaui": "PI",
    "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS",
    Rondônia: "RO", "Rondonia": "RO", Roraima: "RR",
    "Santa Catarina": "SC", "São Paulo": "SP", "Sao Paulo": "SP",
    Sergipe: "SE", Tocantins: "TO",
  };

  const byAge = rowsToList(ageRes.data?.rows);
  const byGender = rowsToList(genderRes.data?.rows, { male: "Masculino", female: "Feminino", unknown: "Não informado" });
  const byBrowser = rowsToList(browserRes.data?.rows);
  const byOS = rowsToList(osRes.data?.rows);
  const byDevice = rowsToList(deviceRes.data?.rows, { desktop: "Desktop", mobile: "Mobile", tablet: "Tablet" });

  // Estados — converte nome completo pra sigla
  const stateList = (stateRes.data?.rows || []).map((r) => {
    const regionName = r.dimensionValues?.[0]?.value || "(not set)";
    const users = Number(r.metricValues?.[0]?.value || 0);
    return { name: stateAbbrev[regionName] || regionName, users };
  });
  const stateTotal = stateList.reduce((s, x) => s + x.users, 0);
  const byState = stateList
    .map((x) => ({ ...x, pct: stateTotal > 0 ? Number(((x.users / stateTotal) * 100).toFixed(1)) : 0 }))
    .filter((x) => x.users > 0)
    .slice(0, 12);

  // Detecta se demografia está disponível (Google Signals)
  const hasAge = byAge.length > 0 && !byAge.every((a) => a.name === "(not set)" || a.name === "unknown");
  const hasGender = byGender.length > 0 && !byGender.every((g) => g.name === "(not set)" || g.name.toLowerCase() === "não informado");

  return NextResponse.json(
    {
      propertyId,
      query: { dateRange, days },
      byAge,
      byGender,
      byState,
      byBrowser,
      byOS,
      byDevice,
      meta: {
        hasDemographics: hasAge || hasGender,
        hasAge,
        hasGender,
        statesCount: byState.length,
        errors: {
          age: ageRes.error,
          gender: genderRes.error,
          state: stateRes.error,
          browser: browserRes.error,
          os: osRes.error,
          device: deviceRes.error,
        },
        // Indica se houve qualquer erro relevante (pra UI exibir warning)
        hasError: !!(ageRes.error || genderRes.error || stateRes.error || browserRes.error || osRes.error || deviceRes.error),
      },
    },
    { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } }
  );
}
