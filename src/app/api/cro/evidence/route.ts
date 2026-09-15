import { NextRequest, NextResponse } from "next/server";
import { runReport } from "@/lib/ga4-server";
import { fetchClarityPages, clarityTokenEnvFor } from "@/lib/clarity-api";
import { classificarFricção, acharDivergencia, dimensionarTeste, PISO_PAGEVIEWS, type Achado } from "@/lib/cro-evidence";
import { resolveBU } from "@/lib/bu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/cro/evidence — a ÚNICA fonte da aba de CRO.
 *
 * Substitui quatro fontes que disputavam a mesma tela. Ver o cabeçalho de
 * src/lib/cro-evidence.ts para o histórico.
 *
 * O que ela NÃO faz, de propósito:
 *   - não estima impacto em R$ (o GA4 da Suno não tem receita utilizável)
 *   - não calcula ROI (era hash do nome da property na versão antiga)
 *   - não devolve Core Web Vitals (o GA4 não fornece, e a média do Clarity é
 *     inutilizável: LCP médio de 1.292.259 ms no login, medido em 15/09/2026)
 *
 * Params: propertyId, propertyName, days (1 a 30; ver a ressalva em clarity-api.ts)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const propertyName = sp.get("propertyName");

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!propertyName) {
    return NextResponse.json(
      { error: "propertyName_required", detail: "A regra de conversão depende da B.U." },
      { status: 400 }
    );
  }

  // A documentação do Clarity diz no máximo 3 dias, mas teste de 01/09/2026
  // devolveu 15 e 30. Aceitamos até 30 e deixamos a API decidir: se ela
  // recusar, o erro sobe com o status em vez de virar limite presumido.
  const diasRaw = Number(sp.get("days") || 3);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(Math.round(diasRaw), 1), 30) : 3;
  const profile = resolveBU(propertyName);

  // Janela do GA4 alinhada à do Clarity: comparar períodos diferentes produz
  // divergência falsa, que é exatamente o defeito que este endpoint caça.
  const hoje = new Date();
  const fim = new Date(hoje);
  fim.setUTCDate(fim.getUTCDate() - 1); // Clarity e GA4 fecham em D-1
  const ini = new Date(fim);
  ini.setUTCDate(ini.getUTCDate() - (dias - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const dateRange = { startDate: iso(ini), endDate: iso(fim) };
  const janelaTexto = `${iso(ini).split("-").reverse().join("/")} a ${iso(fim).split("-").reverse().join("/")}`;

  const eventosConversao: string[] = [];
  if (profile.mqlEvents) {
    eventosConversao.push(profile.mqlEvents.qualified, profile.mqlEvents.disqualified);
  } else if (profile.leadEvent) {
    eventosConversao.push(profile.leadEvent);
  }
  if (profile.accountEvent) eventosConversao.push(profile.accountEvent);
  if (profile.conversionModel === "captacao_venda") eventosConversao.push("begin_checkout", "purchase");

  const [clarity, ga4Conv] = await Promise.all([
    fetchClarityPages(propertyName, dias),
    eventosConversao.length > 0
      ? runReport(propertyId, {
          dateRanges: [dateRange],
          dimensions: [{ name: "pagePath" }, { name: "eventName" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: {
            andGroup: {
              expressions: [
                { filter: { fieldName: "eventName", inListFilter: { values: eventosConversao } } },
                /**
                 * Recorte do Brasil. Desde 22/08/2026 a Research recebe
                 * enxurrada de tráfego automatizado de China e Singapura, e o
                 * Brasil caiu de 90% para 22% das sessões. Sem este recorte a
                 * aba proporia teste em cima de bot.
                 */
                { filter: { fieldName: "country", stringFilter: { matchType: "EXACT" as const, value: "Brazil" } } },
              ],
            },
          },
          limit: 2000,
        }).catch((e) => ({ data: null, error: (e as Error).message }))
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Conversões do GA4 por caminho de página.
  const convPorPath = new Map<string, number>();
  for (const r of ga4Conv.data?.rows || []) {
    const path = (r.dimensionValues?.[0]?.value || "").replace(/\/+$/, "") || "/";
    convPorPath.set(path, (convPorPath.get(path) || 0) + Number(r.metricValues?.[0]?.value || 0));
  }

  if (!clarity.ok) {
    return NextResponse.json(
      {
        propertyId,
        bu: { key: profile.key, label: profile.label },
        janela: janelaTexto,
        dias,
        clarity: {
          conectado: false,
          motivo: clarity.reason,
          envVar: clarity.reason === "sem_token" ? clarity.envVar : clarityTokenEnvFor(propertyName),
          /**
           * Quais variáveis com "clarity" no nome existem no runtime. APENAS
           * os NOMES, nunca o valor: nome de variável não é segredo, token é.
           *
           * Existe porque "não achei a variável" tem três causas diferentes e
           * indistinguíveis de fora: nome diferente do esperado, variável criada
           * só em Preview e não em Production, ou build anterior à criação dela.
           * Listar os nomes separa as três em um olhar.
           */
          variaveisVistas: Object.keys(process.env).filter((k) => /clarit/i.test(k)).sort(),
          detalhe:
            clarity.reason === "sem_token"
              ? `O Clarity não está conectado para esta B.U. Falta a variável de ambiente com o token da Data Export API. Sem ela esta aba não tem evidência de usabilidade, e prefere não mostrar nada a mostrar número inventado.`
              : clarity.reason === "sem_suporte"
                ? `Esta B.U. não tem projeto do Clarity mapeado.`
                : `A API do Clarity respondeu ${clarity.status}: ${clarity.detail}`,
        },
        achados: [],
        semVolume: [],
        totais: { achados: 0, corrigir: 0, investigar: 0, testar: 0, validar: 0 },
        piso: PISO_PAGEVIEWS,
      },
      { status: 200, headers: { "Cache-Control": "private, max-age=600" } }
    );
  }

  const { achados, semVolume } = classificarFricção(
    clarity.rows.map((r) => ({
      url: r.url,
      pageViews: r.pageViews,
      deadRate: r.deadRate,
      rageRate: r.rageRate,
      quickbackRate: r.quickbackRate,
      deadClicks: r.deadClicks,
      rageClicks: r.rageClicks,
      quickbacks: r.quickbacks,
      scriptErrors: r.scriptErrors,
    })),
    janelaTexto,
    dias
  );

  /**
   * Divergência Clarity x GA4. Só para páginas com volume: numa página pequena
   * "Clarity vê 3, GA4 vê 0" não significa nada.
   */
  const divergencias: Achado[] = [];
  const eventoPrincipal = profile.ctaEvent || profile.leadEvent || "conversão";
  for (const r of clarity.rows) {
    if (r.pageViews < PISO_PAGEVIEWS) continue;
    let path = "/";
    try {
      path = new URL(r.url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      continue;
    }
    const d = acharDivergencia({
      pagina: r.url,
      // Proxy de ação: clique morto não conta, clique com erro e rage sim,
      // porque indicam interação real que não resultou no que devia.
      clarityAcoes: r.errorClicks + r.rageClicks,
      ga4Conversoes: convPorPath.get(path) || 0,
      eventoGA4: eventoPrincipal,
      janela: janelaTexto,
      amostra: `${r.pageViews.toLocaleString("pt-BR")} pageviews`,
    });
    if (d) divergencias.push(d);
  }

  /**
   * Candidatos a TESTE.
   *
   * Uma página só é candidata quando NÃO tem defeito conhecido. Testar em cima
   * de página com elemento morto ou evento quebrado produz resultado que
   * ninguém consegue interpretar: o experimento mede a falha, não a mudança.
   *
   * E só entra se o teste couber em 30 dias com o tráfego que a página tem.
   * Proposta que precisa de 90 dias nunca sai do papel e só ocupa a fila.
   */
  const comDefeito = new Set([...divergencias, ...achados].map((a) => a.pagina));
  const candidatos: Achado[] = [];
  for (const r of clarity.rows) {
    if (r.pageViews < PISO_PAGEVIEWS) continue;
    if (comDefeito.has(r.url)) continue;
    let path = "/";
    try {
      path = new URL(r.url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      continue;
    }
    const conv = convPorPath.get(path) || 0;
    if (conv < 10) continue; // sem conversão medida não há baseline para dimensionar
    const baseline = (conv / r.pageViews) * 100;
    const sessoesPorDia = Math.round(r.pageViews / dias);
    // Efeito mínimo de 20% RELATIVO sobre o baseline: é o menor ganho que
    // justifica o custo de montar, rodar e decidir um teste.
    const efeitoPp = Number((baseline * 0.2).toFixed(2));
    const dim = dimensionarTeste(baseline, efeitoPp, sessoesPorDia);
    if (!dim.viavel) continue;

    candidatos.push({
      id: `teste:${r.url}`,
      superficie: "pagina",
      pagina: r.url,
      titulo: "Página sem defeito conhecido e com volume para testar",
      evidencias: [
        { fonte: "Clarity", valor: `sem fricção acima dos limiares`, amostra: `${r.pageViews.toLocaleString("pt-BR")} pageviews`, janela: janelaTexto },
        { fonte: "GA4", valor: `conversão de ${baseline.toFixed(2).replace(".", ",")}%`, amostra: `${conv.toLocaleString("pt-BR")} conversões, recorte Brasil`, janela: janelaTexto },
      ],
      hipotese:
        `Uma mudança no primeiro viewport (título, prova ou posição do CTA) eleva a conversão de ` +
        `${baseline.toFixed(2).replace(".", ",")}% para ao menos ${(baseline + efeitoPp).toFixed(2).replace(".", ",")}%.`,
      classificacao: "testar",
      porque:
        `Esta página não acusou dead click, rage click, quickback nem erro de script acima dos limiares, ` +
        `e a conversão está sendo medida. É condição para experimento: o que mudar na tela vai aparecer no resultado.`,
      proximoPasso: [
        `Montar a variante B na VWO (conta 873070), divisão 50/50`,
        `Rodar por ${dim.diasNecessarios} dias sem olhar o resultado no meio: ${dim.amostraPorVariante.toLocaleString("pt-BR")} sessões por variante`,
        `Critério de decisão definido ANTES: promover só com ganho de ${efeitoPp.toFixed(2).replace(".", ",")} ponto percentual ou mais`,
      ],
      prioridade: 20 + Math.round(conv / 10),
      teste: dim,
    });
  }

  const todos = [...divergencias, ...achados, ...candidatos].sort((a, b) => b.prioridade - a.prioridade);

  return NextResponse.json(
    {
      propertyId,
      bu: { key: profile.key, label: profile.label, conversionModel: profile.conversionModel },
      janela: janelaTexto,
      dias,
      clarity: {
        conectado: true,
        paginas: clarity.rows.length,
        coletadoEm: clarity.fetchedAt,
        // ?debug=1 devolve a FORMA crua da resposta do Clarity. Existe porque
        // supor nome de campo ja zerou o denominador de toda taxa uma vez.
        ...(sp.get("debug") === "1" ? { amostraCrua: clarity.amostraCrua, topo: clarity.rows.slice(0, 5) } : {}),
      },
      ga4: { eventos: eventosConversao, recorte: "Brasil", erro: ga4Conv.error || null },
      achados: todos,
      semVolume: semVolume.slice(0, 30).map((s) => ({ url: s.url, pageViews: s.pageViews })),
      totais: {
        achados: todos.length,
        corrigir: todos.filter((a) => a.classificacao === "corrigir").length,
        investigar: todos.filter((a) => a.classificacao === "investigar").length,
        testar: todos.filter((a) => a.classificacao === "testar").length,
        validar: todos.filter((a) => a.classificacao === "validar_medicao").length,
      },
      piso: PISO_PAGEVIEWS,
      limitacoes: [
        `A janela é de no máximo 3 dias: é o limite da Data Export API do Clarity, não uma escolha.`,
        `A API do Clarity aceita 10 requisições por projeto por dia. Esta rota faz uma por consulta e cacheia por 10 minutos.`,
        `Páginas abaixo de ${PISO_PAGEVIEWS} pageviews ficam fora do ranking de taxa: sem piso, uma página com 1 visita e 1 rage click aparece com 100%.`,
        `Esta aba não mostra Core Web Vitals. O GA4 não fornece, e a média do Clarity é inutilizável (LCP médio de 1.292.259 ms no login, medido em 15/09/2026). Para performance de campo, use o PageSpeed Insights.`,
        `As conversões do GA4 vêm recortadas por Brasil, por causa do tráfego automatizado que entrou na Research em 22/08/2026.`,
      ],
    },
    { status: 200, headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=1800" } }
  );
}
