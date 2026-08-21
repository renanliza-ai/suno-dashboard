/**
 * Análise de COMPOSIÇÃO de tráfego de uma página.
 *
 * Responde a pergunta que o motor de CRO não conseguia responder sozinho:
 * o problema desta página é a página, é a mídia que traz o tráfego, ou é o
 * dado que está quebrado?
 *
 * Sem essa separação o painel produz teste de CRO para problema de mídia, e o
 * time gasta duas semanas de tráfego para descobrir isso. Caso real, LP da 5ª
 * emissão SNEL11, 7 dias:
 *
 *   busca paga google      2.859 sessões    54,1% de cta_click
 *   meta, 8 nomes diferentes   25.703 sessões     1,1% de cta_click
 *
 * A página convertia. O tráfego é que não tinha intenção. E a comparação só
 * ficou possível depois de agrupar as oito variações de nomenclatura do Meta
 * em uma única origem, porque separadas nenhuma delas tinha volume para nada.
 *
 * Funções puras, sem rede. Servem ao motor client-side e à API.
 */

/** Linha de quebra por origem, canal ou campanha. Compatível com LPBreakdownRow. */
export type LinhaOrigem = {
  label: string;
  sessions: number;
  leads?: number;
  ctaClicks?: number;
  purchases?: number;
  bounceRate?: number;
};

export type VeredictoTipo = "pagina" | "midia" | "dado";

export type Veredicto = {
  tipo: VeredictoTipo;
  /** Frase pronta para o card e para a descrição no Monday. */
  texto: string;
  /** Origem de melhor desempenho, com volume relevante. */
  melhor: { label: string; sessoes: number; taxa: number } | null;
  /**
   * Origem de MAIOR VOLUME que nao e a melhor. Nao e a de pior taxa: comparar
   * a melhor com uma origem de 200 sessoes produz razao enorme e decisao
   * nenhuma. O que decide alocacao e como converte o trafego onde o dinheiro
   * esta. Caso real SNEL11: a pior taxa era o trafego direto, com 1.236
   * sessoes, enquanto o volume estava no meta, com 19.754.
   */
  maiorVolume: { label: string; sessoes: number; taxa: number } | null;
  /** Quantas vezes a melhor origem converte mais que a de maior volume. */
  razao: number | null;
  /** Percentual de sessões com nomenclatura ilegível. */
  pctDadoQuebrado: number;
};

/** Volume mínimo de uma origem para ela entrar na comparação. */
export const MIN_SESSOES_ORIGEM = 500;

/** A partir desta razão entre melhor e pior origem, o problema é de mídia. */
export const RAZAO_MIDIA = 5;

/** A partir deste percentual de tráfego ilegível, o problema é de dado. */
export const PCT_DADO_QUEBRADO = 20;

// ============================================================
// 1. Detecção de nomenclatura quebrada
// ============================================================

/**
 * Rótulo que não identifica origem nem campanha. Quatro casos, todos vistos em
 * dado real da casa:
 *
 *  - macro do Meta que chegou como texto, entre chaves duplas
 *  - ID numérico cru, sem nome legível
 *  - not set e variações de ausência
 *  - string vazia
 */
export function nomenclaturaQuebrada(label: string): false | string {
  const l = (label || "").trim();
  if (!l) return "rotulo vazio";
  if (/\{\{.*?\}\}/.test(l)) return "macro nao substituida, chegou como texto";
  if (/^\d{8,}$/.test(l)) return "ID numerico cru, sem nome de campanha";
  const baixo = l.toLowerCase();
  if (baixo === "(not set)" || baixo === "not set") return "not set";
  if (baixo === "(data not available)") return "dado indisponivel";
  return false;
}

export type DiagnosticoNomenclatura = {
  sessoesAfetadas: number;
  sessoesTotais: number;
  pct: number;
  /** Até 5 exemplos, do maior volume para o menor. */
  exemplos: { label: string; sessoes: number; motivo: string }[];
  texto: string | null;
};

export function diagnosticarNomenclatura(linhas: LinhaOrigem[]): DiagnosticoNomenclatura {
  const sessoesTotais = linhas.reduce((s, l) => s + l.sessions, 0);
  const quebradas = linhas
    .map((l) => ({ linha: l, motivo: nomenclaturaQuebrada(l.label) }))
    .filter((x): x is { linha: LinhaOrigem; motivo: string } => x.motivo !== false);

  const sessoesAfetadas = quebradas.reduce((s, x) => s + x.linha.sessions, 0);
  const pct = sessoesTotais > 0 ? Number(((sessoesAfetadas / sessoesTotais) * 100).toFixed(1)) : 0;
  const exemplos = quebradas
    .sort((a, b) => b.linha.sessions - a.linha.sessions)
    .slice(0, 5)
    .map((x) => ({ label: x.linha.label, sessoes: x.linha.sessions, motivo: x.motivo }));

  const texto =
    sessoesAfetadas > 0
      ? `${pct}% do trafego desta pagina, ${sessoesAfetadas.toLocaleString("pt-BR")} sessoes, ` +
        `chega sem identificacao legivel de origem ou campanha. ` +
        `Exemplos: ${exemplos.map((e) => `${e.label} (${e.motivo})`).join("; ")}. ` +
        `Isso e defeito de instrumentacao de midia, nao de pagina. Corrigir antes de comparar campanha.`
      : null;

  return { sessoesAfetadas, sessoesTotais, pct, exemplos, texto };
}

// ============================================================
// 2. Agrupador de origem
// ============================================================

/**
 * Canonicaliza o rótulo de origem para que o mesmo canal deixe de ser contado
 * como vários. Na LP da emissão o Meta aparecia sob oito pares diferentes de
 * origem e mídia, e separados nenhum tinha volume para comparação.
 *
 * Isto NÃO substitui a correção da UTM na origem. Serve para conseguir ler
 * enquanto a correção não acontece, e para provar o tamanho do problema.
 */
export function canonizarOrigem(label: string): string {
  const l = (label || "").toLowerCase();

  if (nomenclaturaQuebrada(label)) return "(nao identificado)";

  // Meta: facebook, instagram, audience network, e as abreviacoes usadas na casa
  if (
    /facebook|instagram|\bfb\b|\big\b|\ban\b|audience|meta/.test(l) ||
    /facebookads/.test(l.replace(/\s/g, ""))
  ) {
    return "meta / paid_social";
  }
  if (/google/.test(l) && /cpc|paid|ads/.test(l)) return "google / paid";
  if (/google/.test(l) && /organic/.test(l)) return "google / organico";
  if (/bing|duckduck|yahoo/.test(l) && /organic/.test(l)) return "outras buscas / organico";
  if (/linkedin/.test(l)) return "linkedin";
  if (/tiktok/.test(l)) return "tiktok";
  if (/youtube/.test(l)) return "youtube";
  if (/hubspot|email|newsletter|mailchimp|rdstation/.test(l)) return "email";
  if (/whats/.test(l)) return "whatsapp";
  if (/direct|\(none\)/.test(l)) return "direto";
  if (/referral|referrer/.test(l)) return "referencia";
  return label;
}

/** Agrupa as linhas por origem canônica, somando as métricas. */
export function agruparPorOrigem(linhas: LinhaOrigem[]): LinhaOrigem[] {
  const mapa = new Map<string, LinhaOrigem>();
  for (const l of linhas) {
    const chave = canonizarOrigem(l.label);
    const cur =
      mapa.get(chave) ||
      ({ label: chave, sessions: 0, leads: 0, ctaClicks: 0, purchases: 0, bounceRate: 0 } as LinhaOrigem);
    cur.sessions += l.sessions;
    cur.leads = (cur.leads || 0) + (l.leads || 0);
    cur.ctaClicks = (cur.ctaClicks || 0) + (l.ctaClicks || 0);
    cur.purchases = (cur.purchases || 0) + (l.purchases || 0);
    // média ponderada por sessões, finalizada depois
    cur.bounceRate = (cur.bounceRate || 0) + (l.bounceRate || 0) * l.sessions;
    mapa.set(chave, cur);
  }
  return Array.from(mapa.values())
    .map((l) => ({
      ...l,
      bounceRate: l.sessions > 0 ? Number(((l.bounceRate || 0) / l.sessions).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ============================================================
// 3. Veredicto: página, mídia ou dado
// ============================================================

function taxaDe(l: LinhaOrigem, metrica: "leads" | "ctaClicks" | "purchases"): number {
  if (l.sessions <= 0) return 0;
  return ((l[metrica] || 0) / l.sessions) * 100;
}

/**
 * Decide de quem é o problema, antes de qualquer hipótese de CRO subir.
 *
 * Ordem das checagens importa. Dado quebrado vem primeiro: sem saber de onde
 * vem o tráfego não existe comparação possível, e a conclusão de mídia ou de
 * página seria construída sobre rótulo inventado.
 */
export function analisarComposicao(
  linhas: LinhaOrigem[],
  metrica: "leads" | "ctaClicks" | "purchases" = "leads"
): Veredicto {
  const nomenclatura = diagnosticarNomenclatura(linhas);
  const agrupadas = agruparPorOrigem(linhas);
  const elegiveis = agrupadas
    .filter((l) => l.sessions >= MIN_SESSOES_ORIGEM && l.label !== "(nao identificado)")
    .map((l) => ({ label: l.label, sessoes: l.sessions, taxa: Number(taxaDe(l, metrica).toFixed(2)) }))
    .sort((a, b) => b.taxa - a.taxa);

  const melhor = elegiveis[0] || null;
  // Maior volume que nao e a melhor origem. E a comparacao que decide verba.
  const maiorVolume =
    [...elegiveis]
      .filter((l) => !melhor || l.label !== melhor.label)
      .sort((a, b) => b.sessoes - a.sessoes)[0] || null;
  const razao =
    melhor && maiorVolume && maiorVolume.taxa > 0
      ? Number((melhor.taxa / maiorVolume.taxa).toFixed(1))
      : melhor && maiorVolume
        ? Infinity
        : null;

  if (nomenclatura.pct >= PCT_DADO_QUEBRADO) {
    return {
      tipo: "dado",
      texto:
        `Antes de tratar como problema de pagina: ${nomenclatura.texto} ` +
        `Nenhum experimento com leitura por campanha deve subir nesta pagina enquanto isso durar.`,
      melhor,
      maiorVolume,
      razao,
      pctDadoQuebrado: nomenclatura.pct,
    };
  }

  if (razao !== null && razao >= RAZAO_MIDIA && melhor && maiorVolume) {
    const volumeTotal = agrupadas.reduce((s, l) => s + l.sessions, 0);
    const pctVolume = volumeTotal > 0 ? Math.round((maiorVolume.sessoes / volumeTotal) * 100) : 0;
    return {
      tipo: "midia",
      texto:
        `A pagina converte de forma muito diferente conforme a origem. ` +
        `${melhor.label} converte ${melhor.taxa}% em ${melhor.sessoes.toLocaleString("pt-BR")} sessoes, ` +
        `${maiorVolume.label} converte ${maiorVolume.taxa}% em ${maiorVolume.sessoes.toLocaleString("pt-BR")} sessoes, ` +
        `uma razao de ${razao === Infinity ? "mais de 100" : razao} vezes. ` +
        `E a origem de maior volume da pagina, ${pctVolume}% do trafego. ` +
        `Com essa diferenca, mudar a pagina rende menos que mudar a origem do trafego. ` +
        `Tratar primeiro como decisao de midia, e so depois desenhar teste de CRO.`,
      melhor,
      maiorVolume,
      razao,
      pctDadoQuebrado: nomenclatura.pct,
    };
  }

  return {
    tipo: "pagina",
    texto:
      melhor && maiorVolume
        ? `Composicao de origem homogenea, razao de ${razao} vezes entre a melhor origem e a de maior volume. ` +
          `O problema e da pagina, e o teste de CRO e o caminho certo.`
        : "Nao ha origens com volume suficiente para separar efeito de pagina de efeito de midia. " +
          "Tratar o resultado como indicativo.",
    melhor,
    maiorVolume,
    razao,
    pctDadoQuebrado: nomenclatura.pct,
  };
}
