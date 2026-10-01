/**
 * LINHAS DA TELA DE LANDING PAGE.
 *
 * Este módulo é dono de duas coisas:
 *
 *   1. O FORMATO da linha (`LPRow`), que era declarado dentro da própria rota.
 *      Saiu de lá para caber em um lugar só, porque agora existem DUAS origens
 *      de linha: a consulta principal (hosts de landing page) e a consulta de
 *      captação fora de LP, abaixo.
 *
 *   2. A CONSULTA SEPARADA dos hosts que captam sem ser landing page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE SEPARADA, E NÃO JUNTO COM A PRINCIPAL
 * ─────────────────────────────────────────────────────────────────────────
 * Em 01/10/2026 eu tentei o caminho óbvio: somar `captureHosts` à lista de
 * hosts da consulta principal. QUEBROU a tela, de 141 linhas para 22.
 *
 * A causa: a consulta principal pede SESSÃO por `landingPage` sem filtro de
 * evento. O portal tem milhares de páginas de notícia, todas com sessão, e
 * elas ocuparam o limite de linhas antes das landing pages aparecerem. A
 * guarda que descarta página de portal sem conversão rodava DEPOIS, quando o
 * estrago já estava feito: ela descartou 958 páginas, mas as LPs perdidas
 * nunca tinham chegado para serem salvas.
 *
 * Aqui a ordem é invertida, e é isso que torna o escopo seguro:
 *
 *   PRIMEIRO pergunta QUAIS páginas dispararam o evento de conversão. Esse
 *   filtro é de evento, então notícia que ninguém converteu nunca entra na
 *   resposta: não existe limite para ela ocupar.
 *
 *   DEPOIS pede sessão SÓ para a lista exata de caminhos que converteram.
 *   Lista fechada não pode ser truncada, então nada se perde por volume.
 *
 * As duas consultas têm limite PRÓPRIO. Nada que acontece aqui tira linha da
 * tabela de landing page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ISSO RECUPERA
 * ─────────────────────────────────────────────────────────────────────────
 * Medido em setembro de 2026 na Suno Research: `www.suno.com.br` respondeu por
 * 624 disparos de `generate_lead`, e a `/ferramentas/calculadora-de-patrimonio-ideal/`
 * sozinha fez 344 leads, o que a colocaria como quinta maior captadora do mês,
 * à frente de quase toda a lista de LPs. Esses leads chegam ao Salesforce. A
 * tela não os mostrava, e quem comparava painel com CRM via um buraco.
 */

import { runReport } from "@/lib/ga4-server";
import {
  computeLPConversion,
  isJunkHost,
  isThankPage,
  type BUProfile,
  type LPObjective,
} from "@/lib/bu";

/** Uma fatia de origem ou meio, já com share dentro da própria LP. */
export type TrafficSlice = { label: string; sessions: number; sharePct: number };

export type LPRow = {
  host: string;
  path: string;
  url: string;
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  users: number;
  avgSessionDuration: number;
  bounceRate: number;
  leads: number;
  /** Disparos do evento de lead. leadEvents > leads indica reenvio de formulario. */
  leadEvents: number;
  leadsSource: string;
  qualified: number | null;
  disqualified: number | null;
  qualificationRate: number | null;
  /** Todos os cliques em CTA da LP. ⚠️ NÃO é só checkout, ver comentário na rota. */
  ctaClicks: number | null;
  /** begin_checkout atribuído a esta LP: quem REALMENTE chegou ao checkout. */
  checkoutStarts: number | null;
  /**
   * COMPRAS atribuídas a esta LP.
   *
   * Pedido do Renan em 09/09/2026: "faça um cruzamento se aquela LP teve alguma
   * influência no purchase". A âncora é a mesma do checkout: o `purchase`
   * atribuído à landing page de ENTRADA da sessão. Ou seja, a sessão que
   * começou naquela LP terminou comprando.
   *
   * ⚠️ É influência de ÚLTIMA SESSÃO, não modelo multi-toque. Compra que
   * acontece numa sessão POSTERIOR (a pessoa entrou pela LP hoje e comprou
   * amanhã por e-mail) não aparece aqui, aparece na LP daquela outra sessão.
   * Some a isso o problema conhecido do cookie _ga no checkout, que joga parte
   * da atribuição em (not set). Ou seja: este número é PISO de influência.
   */
  purchases: number | null;
  connectRate: number | null;
  ctaRate: number | null;
  /** begin_checkout ÷ sessões. */
  checkoutRate: number | null;
  /**
   * Objetivo da LP pela regra universal Suno (o padrão da URL diz qual é).
   * captacao -> conversão é generate_lead. venda -> conversão é chegada ao checkout.
   */
  objective: LPObjective;
  objectiveFrom: "url" | "dado" | "nenhum";
  /** Métrica que DEVE ser lida como conversão desta linha. */
  primaryMetric: "leads" | "checkoutStarts" | "ambas";
  /** Valor da métrica primária, já resolvido, para ordenar e comparar. */
  primaryValue: number | null;
  primaryRate: number | null;
  /** Preenchido quando o objetivo declarado não bate com o dado. É alarme. */
  mismatch: string | null;
  /**
   * Preenchido quando a TAXA não pode ser calculada com honestidade.
   *
   * Efeito colateral legítimo do escopo misto: sessão vem da ENTRADA
   * (landingPage) e o evento vem da PÁGINA onde disparou (pagePath). Se a
   * pessoa entrou por outra página e converteu nesta, o numerador existe e o
   * denominador não. Aí a taxa passaria de 100%, que é visivelmente errado.
   * Nesse caso a taxa vira null e o motivo fica aqui.
   */
  rateCaveat: string | null;
  /**
   * De onde vem o tráfego DESTA LP. `sessionSource` e `sessionMedium` são
   * dimensões de SESSÃO, o mesmo escopo de `landingPage`, então a junção é
   * coerente: a origem é a da sessão que ENTROU por esta página.
   */
  topSource: TrafficSlice | null;
  sources: TrafficSlice[];
  topMedium: TrafficSlice | null;
  mediums: TrafficSlice[];
  isThankPage: boolean;
  /**
   * TRUE quando a linha veio de um host de captação, não de um host de landing
   * page. A tela precisa saber para poder rotular e para poder excluir, já que
   * é uma página de produto do portal cumprindo papel de captação, não uma LP.
   */
  foraDeLP?: boolean;
};

/** O que a tela mostra sobre esta consulta, para o número nunca chegar mudo. */
export type ResumoCaptacaoForaDeLP = {
  hosts: string[];
  /** Páginas que captaram fora dos hosts de LP. */
  paginas: number;
  /** PESSOAS únicas por página, somadas. Ver a ressalva de unidade abaixo. */
  pessoas: number;
  /** Disparos do evento. */
  eventos: number;
  /**
   * Páginas cuja sessão de entrada foi RECUSADA por ser aritmeticamente
   * impossível naquele host (entrou por outro host). A linha fica, a sessão
   * vira zero. Não se sobrepõe a `semSessaoDeEntrada`.
   */
  descartadasPorHostCruzado: number;
  /**
   * Páginas para as quais o GA4 não devolveu sessão de entrada nenhuma. É o
   * caso da ferramenta alcançada por navegação interna. Não se sobrepõe a
   * `descartadasPorHostCruzado`: as duas causas são distintas e já foram
   * confundidas uma vez.
   */
  semSessaoDeEntrada: number;
  explica: string;
};

/** O GA4 devolve pagePath COM barra final e landingPage SEM. Normaliza para juntar. */
const normPath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/**
 * Páginas de host de captação que converteram, já no formato da tabela.
 *
 * Devolve lista VAZIA (nunca erro) quando a B.U. não declara `captureHosts` ou
 * quando nada converteu: esta consulta é um complemento, e o painel não pode
 * cair por causa dela.
 */
export async function captacaoForaDeLP(args: {
  propertyId: string;
  profile: BUProfile;
  dateRange: { startDate: string; endDate: string };
  /** Os mesmos eventos que a consulta principal pede, já resolvidos pela B.U. */
  events: string[];
  /** Recorte por caminho vindo da query string, já em minúsculas. */
  pathContains: string;
  includeThankPages: boolean;
}): Promise<{ linhas: LPRow[]; resumo: ResumoCaptacaoForaDeLP | null }> {
  const { propertyId, profile, dateRange, events, pathContains, includeThankPages } = args;
  const hosts = (profile.captureHosts || []).filter(Boolean);
  const vazio = { linhas: [] as LPRow[], resumo: null };

  if (hosts.length === 0 || events.length === 0) return vazio;

  const filtroDeHost = {
    filter: { fieldName: "hostName", inListFilter: { values: hosts, caseSensitive: false } },
  };
  const filtroDeEvento = {
    filter: { fieldName: "eventName", inListFilter: { values: events } },
  };

  // ── PASSO 1 ────────────────────────────────────────────────────────────
  // QUAIS páginas destes hosts dispararam conversão. Filtro de EVENTO, então
  // página de notícia sem conversão não entra: não há limite para ela ocupar.
  const evRes = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: "hostName" }, { name: "pagePath" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 500,
    dimensionFilter: { andGroup: { expressions: [filtroDeHost, filtroDeEvento] } },
  });
  if (evRes.error) return vazio;

  /** (host|caminho) -> { evento: disparos } e o mesmo para pessoas. */
  const eventosPorPagina = new Map<string, Record<string, number>>();
  const pessoasPorPagina = new Map<string, Record<string, number>>();
  for (const r of evRes.data?.rows || []) {
    const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const bruto = r.dimensionValues?.[1]?.value ?? "";
    if (!bruto) continue; // balde vazio do GA4, não é uma página
    const path = normPath(bruto);
    const ev = r.dimensionValues?.[2]?.value || "";
    const chave = `${host}|${path}`;

    const be = eventosPorPagina.get(chave) || {};
    be[ev] = (be[ev] || 0) + Number(r.metricValues?.[0]?.value || 0);
    eventosPorPagina.set(chave, be);

    const bp = pessoasPorPagina.get(chave) || {};
    bp[ev] = (bp[ev] || 0) + Number(r.metricValues?.[1]?.value || 0);
    pessoasPorPagina.set(chave, bp);
  }
  if (eventosPorPagina.size === 0) return vazio;

  /**
   * Caminhos a perguntar, nas DUAS grafias.
   *
   * `pagePath` volta com barra final e `landingPage` sem. Perguntar só uma
   * forma faria a junção falhar em quase toda linha, e a tabela mostraria a
   * página com zero sessão. O corte em 150 caminhos existe porque o
   * `inListFilter` tem teto prático; são páginas que CONVERTERAM, então 150 é
   * folgado (na Research de setembro foram 13).
   */
  const caminhos = Array.from(
    new Set(Array.from(eventosPorPagina.keys()).map((k) => k.split("|")[1]))
  ).slice(0, 150);
  const variantes = Array.from(
    new Set(caminhos.flatMap((p) => (p === "/" ? [p] : [p, `${p}/`])))
  );

  // ── PASSO 2 ────────────────────────────────────────────────────────────
  // Sessão, pageview servido e origem SÓ para esses caminhos. Lista fechada:
  // não há como truncar, e nada daqui disputa espaço com a consulta de LP.
  const filtroDeEntrada = {
    andGroup: {
      expressions: [
        filtroDeHost,
        { filter: { fieldName: "landingPage", inListFilter: { values: variantes } } },
      ],
    },
  };
  const filtroDePagina = {
    andGroup: {
      expressions: [
        filtroDeHost,
        { filter: { fieldName: "pagePath", inListFilter: { values: variantes } } },
      ],
    },
  };

  const [sessRes, servedRes, srcRes, medRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPage" }],
      metrics: [
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "totalUsers" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 500,
      dimensionFilter: filtroDeEntrada,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: 500,
      dimensionFilter: filtroDePagina,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPage" }, { name: "sessionSource" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 1000,
      dimensionFilter: filtroDeEntrada,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "landingPage" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 1000,
      dimensionFilter: filtroDeEntrada,
    }),
  ]);

  /** (host|caminho normalizado) -> métricas de sessão de ENTRADA. */
  type Entrada = {
    sessions: number;
    engagedSessions: number;
    users: number;
    avgSessionDuration: number;
    bounceRate: number;
    chaveOriginal: string;
  };
  const entradas = new Map<string, Entrada>();
  for (const r of sessRes.data?.rows || []) {
    const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const bruto = r.dimensionValues?.[1]?.value ?? "";
    if (!bruto || bruto === "(not set)" || bruto === "(other)") continue;
    const chave = `${host}|${normPath(bruto)}`;
    const atual = entradas.get(chave);
    const nova: Entrada = {
      sessions: Number(r.metricValues?.[0]?.value || 0),
      engagedSessions: Number(r.metricValues?.[1]?.value || 0),
      users: Number(r.metricValues?.[2]?.value || 0),
      avgSessionDuration: Number(r.metricValues?.[3]?.value || 0),
      // A Data API devolve bounceRate como FRAÇÃO (0,908 = 90,8%).
      bounceRate: Number((Number(r.metricValues?.[4]?.value || 0) * 100).toFixed(1)),
      chaveOriginal: `${host}|${bruto}`,
    };
    // As duas grafias do mesmo caminho somam na mesma linha.
    entradas.set(
      chave,
      atual
        ? {
            ...nova,
            sessions: atual.sessions + nova.sessions,
            engagedSessions: atual.engagedSessions + nova.engagedSessions,
            users: atual.users + nova.users,
            chaveOriginal: atual.chaveOriginal,
          }
        : nova
    );
  }

  /**
   * Pageviews que o host realmente SERVIU em cada caminho.
   *
   * Mesma guarda da consulta principal, e pelo mesmo motivo: `hostName` é
   * dimensão de EVENTO e `landingPage` é de SESSÃO, então filtrar host NÃO
   * garante que a sessão entrou por aquele host. O teste é aritmético: a
   * sessão que ATERRISSOU num caminho não pode ser mais numerosa que os
   * pageviews servidos ali.
   */
  const servidos = new Map<string, number>();
  for (const r of servedRes.data?.rows || []) {
    const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const bruto = r.dimensionValues?.[1]?.value ?? "";
    if (!bruto) continue;
    const chave = `${host}|${normPath(bruto)}`;
    const n = Number(r.metricValues?.[0]?.value || 0);
    servidos.set(chave, (servidos.get(chave) || 0) + n);
  }

  /** (host|caminho normalizado) -> fatias de origem, já ordenadas. */
  const mapaDeTrafego = (res: typeof srcRes) => {
    const m = new Map<string, { label: string; sessions: number }[]>();
    for (const r of res.data?.rows || []) {
      const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
      const bruto = r.dimensionValues?.[1]?.value ?? "";
      if (!bruto) continue;
      const chave = `${host}|${normPath(bruto)}`;
      const arr = m.get(chave) || [];
      arr.push({
        label: r.dimensionValues?.[2]?.value || "(not set)",
        sessions: Number(r.metricValues?.[0]?.value || 0),
      });
      m.set(chave, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.sessions - a.sessions);
    return m;
  };
  const mapaOrigem = mapaDeTrafego(srcRes);
  const mapaMeio = mapaDeTrafego(medRes);

  const fatias = (arr: { label: string; sessions: number }[] | undefined, take = 5): TrafficSlice[] => {
    if (!arr || arr.length === 0) return [];
    const total = arr.reduce((s, x) => s + x.sessions, 0);
    return arr.slice(0, take).map((x) => ({
      label: x.label,
      sessions: x.sessions,
      sharePct: total > 0 ? Number(((x.sessions / total) * 100).toFixed(1)) : 0,
    }));
  };

  // ── MONTAGEM ───────────────────────────────────────────────────────────
  // ⚠️ A linha nasce do EVENTO, não da sessão, ao contrário da consulta
  // principal. É deliberado: a calculadora do portal recebe a maior parte do
  // tráfego por navegação interna, então ela capta MUITO e quase não é página
  // de entrada. Montar a partir da sessão apagaria exatamente o que esta
  // consulta existe para recuperar.
  const linhas: LPRow[] = [];
  let descartadasPorHostCruzado = 0;
  let semSessaoDeEntrada = 0;

  for (const [chave, bucket] of eventosPorPagina.entries()) {
    const [host, path] = [chave.slice(0, chave.indexOf("|")), chave.slice(chave.indexOf("|") + 1)];
    if (isJunkHost(host)) continue;
    if (path === "(not set)" || path === "(other)") continue;
    if (pathContains && !path.toLowerCase().includes(pathContains)) continue;

    const thank = isThankPage(path);
    if (thank && !includeThankPages) continue;

    const entrada = entradas.get(chave);
    let sessions = entrada?.sessions ?? 0;
    let engagedSessions = entrada?.engagedSessions ?? 0;

    /**
     * ⚠️ DUAS CAUSAS DIFERENTES PARA "SEM SESSÃO", E ELAS NÃO PODEM SER
     * CONTADAS JUNTAS.
     *
     * Na primeira medição as duas davam 5, e eram as MESMAS 5 páginas: quem
     * tinha a sessão descartada caía também no balde de "não recebeu sessão".
     * Isso contava a página duas vezes e, pior, fazia a tela dar a explicação
     * errada ("é ferramenta alcançada por navegação interna") para uma página
     * cuja sessão existia e foi RECUSADA por outro motivo.
     *
     *   descartada  = o GA4 devolveu sessão de entrada, mas ela não cabe nos
     *                 pageviews que este host serviu, então entrou por OUTRO
     *                 host. Contaminação cruzada, mesma guarda da rota.
     *   sem entrada = o GA4 não devolveu sessão nenhuma para esta página. É o
     *                 caso da ferramenta alcançada por navegação interna.
     *
     * Nos dois a linha FICA, porque a conversão é desta página de qualquer
     * forma. O que muda é o motivo que a tela declara.
     */
    const tinhaEntrada = sessions > 0;
    if (tinhaEntrada) {
      const views = servidos.get(chave) || 0;
      if (views < sessions) {
        descartadasPorHostCruzado++;
        sessions = 0;
        engagedSessions = 0;
      }
    } else {
      semSessaoDeEntrada++;
    }

    const conv = computeLPConversion(profile, {
      sessions,
      leadEventCount: profile.leadEvent ? bucket[profile.leadEvent] || 0 : 0,
      qualified: profile.mqlEvents ? bucket[profile.mqlEvents.qualified] || 0 : 0,
      disqualified: profile.mqlEvents ? bucket[profile.mqlEvents.disqualified] || 0 : 0,
      ctaCount: profile.ctaEvent ? bucket[profile.ctaEvent] || 0 : 0,
    });

    let rateCaveat: string | null = null;
    if (sessions === 0) {
      // O motivo tem que ser o certo: ver o comentário das duas causas acima.
      rateCaveat = tinhaEntrada
        ? "Taxa não calculada: o GA4 creditou sessões de entrada a esta página, mas em número maior que os pageviews que este host serviu nela. Isso é impossível, e significa que essas sessões entraram por OUTRO host e só passaram por aqui. A conversão é real; o denominador foi descartado por não ser confiável."
        : "Taxa não calculada: esta página captou, mas nenhuma sessão ENTROU por ela no período. É o caso típico de ferramenta do portal, que recebe tráfego por navegação interna. A conversão é real; o denominador de \"sessões de entrada\" é que não existe aqui.";
      conv.connectRate = null;
      conv.ctaRate = null;
    } else if (conv.leads > sessions) {
      rateCaveat =
        "Taxa não calculada: esta página registrou mais conversões que sessões de ENTRADA. Isso acontece quando a pessoa chega aqui vindo de outra página do mesmo site, então o evento é desta página mas a sessão foi creditada à página de entrada. O número absoluto de conversões está correto.";
      conv.connectRate = null;
    }

    const chaveTrafego = chave;
    const origens = fatias(mapaOrigem.get(chaveTrafego));
    const meios = fatias(mapaMeio.get(chaveTrafego));

    linhas.push({
      host,
      path,
      url: `https://${host}${path}`,
      sessions,
      engagedSessions,
      engagementRate: sessions > 0 ? Number(((engagedSessions / sessions) * 100).toFixed(1)) : null,
      users: entrada?.users ?? 0,
      avgSessionDuration: entrada?.avgSessionDuration ?? 0,
      bounceRate: entrada?.bounceRate ?? 0,
      /** PESSOAS, a mesma unidade da consulta principal: é o que fecha com o CRM. */
      leads: profile.leadEvent
        ? (pessoasPorPagina.get(chave) || {})[profile.leadEvent] || 0
        : conv.leads,
      leadEvents: conv.leads,
      leadsSource: conv.leadsSource,
      qualified: conv.qualified,
      disqualified: conv.disqualified,
      qualificationRate: conv.qualificationRate,
      ctaClicks: conv.ctaClicks,
      checkoutStarts: null, // preenchido na rota, junto com as linhas de LP
      purchases: null,
      connectRate: conv.connectRate,
      ctaRate: conv.ctaRate,
      checkoutRate: null,
      objective: "indefinido", // resolvido na rota, depois do begin_checkout
      objectiveFrom: "nenhum",
      primaryMetric: "ambas",
      primaryValue: null,
      primaryRate: null,
      mismatch: null,
      rateCaveat,
      topSource: origens[0] || null,
      sources: origens,
      topMedium: meios[0] || null,
      mediums: meios,
      isThankPage: thank,
      foraDeLP: true,
    });
  }

  const leadEvent = profile.leadEvent;
  const pessoas = leadEvent ? linhas.reduce((s, l) => s + l.leads, 0) : 0;
  const eventos = leadEvent ? linhas.reduce((s, l) => s + l.leadEvents, 0) : 0;

  const resumo: ResumoCaptacaoForaDeLP = {
    hosts,
    paginas: linhas.length,
    pessoas,
    eventos,
    descartadasPorHostCruzado,
    semSessaoDeEntrada,
    explica:
      `Estas ${linhas.length} páginas captam sem ser landing page: são ferramentas e calculadoras em ${hosts.join(", ")}. ` +
      `Elas somam ${pessoas.toLocaleString("pt-BR")} pessoas e ${eventos.toLocaleString("pt-BR")} disparos, e esses leads chegam ao CRM. ` +
      `Vêm de uma consulta SEPARADA, com limite próprio, que pergunta primeiro QUAIS páginas converteram e só depois pede a sessão delas: por isso o portal não disputa espaço com a lista de LP. ` +
      (semSessaoDeEntrada > 0
        ? `${semSessaoDeEntrada} delas não receberam nenhuma sessão de ENTRADA no período, o que é esperado em ferramenta alcançada por navegação interna: a conversão é real e a taxa fica sem denominador. `
        : "") +
      (descartadasPorHostCruzado > 0
        ? `Em ${descartadasPorHostCruzado}, a sessão de entrada que o GA4 creditou era maior que os pageviews servidos pelo host, o que é impossível: essas sessões entraram por outro host e o denominador foi descartado. `
        : "") +
      `⚠️ Somar a coluna de leads continua dando mais que as PESSOAS ÚNICAS da property: quem captou em duas páginas conta uma vez em cada linha.`,
  };

  return { linhas, resumo };
}
