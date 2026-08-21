/**
 * Travas do motor de CRO (gates).
 *
 * O motor de insights sabe DETECTAR problema. Estas travas decidem se o
 * problema detectado pode virar experimento, e de que tipo. Existem porque
 * três erros de leitura já aconteceram em análise real e custaram tempo:
 *
 *  1. Gate de MEDIÇÃO — página sem evento de conversão instrumentado aparece
 *     como conversão zero. São diagnósticos opostos: conversão baixa pede
 *     teste de CRO, falta de evento pede instrumentação. Caso real: uma página
 *     de fundo com 16,6 mil sessões/semana e nenhum cta_click registrado.
 *
 *  2. Gate de PODER — MDE de 15% relativo é premissa fixa no motor antigo, e
 *     na maioria das LPs de captação da casa o tráfego não sustenta isso em
 *     menos de 21 dias. Aqui o MDE é CALCULADO do tráfego real e a hipótese é
 *     classificada em trilha A, B ou C. Trilha A é experimento controlado com
 *     poder, B é quase-experimento (pré e pós com controle), C é descoberta
 *     qualitativa que gera hipótese e não decide receita.
 *
 *  3. Gate de COMPOSIÇÃO — métrica agregada da página engana quando a mistura
 *     de origem difere entre segmentos. Caso real: uma LP com 85% de rejeição
 *     no agregado convertia 54% no tráfego de busca paga e 1,1% no social. O
 *     problema era mix de mídia, não a página. Dentro da mesma origem a
 *     diferença entre navegadores ficou entre 2 e 6 pontos, entre origens
 *     chegou a 45. Nenhum experimento de página sobe sem esse cruzamento.
 *
 * Todas as funções aqui são puras e sem dependência de rede, para poderem ser
 * usadas tanto no motor client-side quanto na API.
 */

/** Trilha de evidência da hipótese. */
export type Trilha = "A" | "B" | "C";

/** z(alfa/2) + z(beta) para alfa 0,05 bilateral e poder 0,80. */
const Z_SOMA = 1.959964 + 0.841621;

/** Teto de duração para uma hipótese ser aceita como trilha A. */
export const MAX_DIAS_TRILHA_A = 21;

/** MDE relativo alvo de uma trilha A. */
export const MDE_ALVO_TRILHA_A = 0.15;

/** Acima disto o experimento não decide nada de útil, cai para trilha C. */
export const MDE_LIMITE_TRILHA_B = 0.35;

/** Amostra mínima por variante para não ler ruído em taxa muito baixa. */
export const N_MINIMO_POR_VARIANTE = 300;

/**
 * Abaixo desta taxa, com trafego relevante, a suspeita e medicao incompleta.
 * 0,2% e 15 vezes abaixo do benchmark de 3% de connect rate para LP de captacao
 * da casa. Calibrado em caso real: uma pagina de fundo com 35,8 mil sessoes em
 * 30 dias e 18 leads, 0,050%, precisa cair aqui. Um piso de 0,05% deixava ela
 * passar por 0,002 ponto percentual.
 */
export const PISO_TAXA_SUSPEITA = 0.002;

/** Trafego minimo para a suspeita de medicao incompleta valer. */
export const PISO_SESSOES_SUSPEITA = 5000;

export type CroGate = {
  trilha: Trilha;
  /** Efeito relativo mínimo detectável na janela disponível, em fração (0,33 = 33%). */
  mdeRelativo: number | null;
  /** Dias necessários para detectar o MDE alvo de trilha A. */
  diasParaAlvo: number | null;
  /** Amostra por variante disponível na janela analisada. */
  nPorVariante: number;
  /** true quando a página tem evento de conversão instrumentado. */
  medicaoOk: boolean;
  /** Motivo de a hipótese não ser trilha A. Null quando é trilha A. */
  bloqueio: string | null;
  /** Verificação obrigatória antes de executar. Sempre preenchido. */
  verificacaoObrigatoria: string;
  /** Frase pronta para o card e para a descrição no Monday. */
  resumo: string;
  /** Evento sobre o qual todo o calculo de poder foi feito. */
  metricaPrimaria: string;
};

export type GateInput = {
  /** Sessões da página na janela analisada. */
  sessoes: number;
  /** Dias da janela analisada. */
  diasJanela: number;
  /** Taxa de conversão base, em fração. Ex: 0,011 para 1,1%. */
  baseline: number;
  /** Conversões absolutas contadas na janela. Zero com sessões altas indica falta de evento. */
  conversoes: number;
  /** true quando a página tem objetivo de conversão (LP de captação ou de venda). */
  temObjetivoDeConversao: boolean;
  /** Nome do evento usado como metrica primaria. Ex: cta_click, generate_lead. */
  metricaPrimaria?: string;
};

/**
 * Efeito relativo mínimo detectável, dada a taxa base e a amostra por variante.
 * Teste de proporção bilateral, alfa 0,05, poder 0,80.
 * Retorna fração. 0,33 significa que só lift de 33% ou mais é detectável.
 */
export function mdeRelativo(baseline: number, nPorVariante: number): number | null {
  const p = Math.min(0.95, Math.max(0.0001, baseline));
  if (!Number.isFinite(nPorVariante) || nPorVariante < 1) return null;
  const absoluto = Z_SOMA * Math.sqrt((2 * p * (1 - p)) / nPorVariante);
  return absoluto / p;
}

/**
 * Amostra por variante necessária para detectar um MDE relativo.
 * Inverso da função acima.
 */
export function nParaMde(baseline: number, mdeRel: number): number {
  const p = Math.min(0.95, Math.max(0.0001, baseline));
  const absoluto = p * mdeRel;
  if (absoluto <= 0) return Infinity;
  return Math.ceil((Z_SOMA * Z_SOMA * 2 * p * (1 - p)) / (absoluto * absoluto));
}

/** Dias para atingir o MDE alvo, considerando 50/50 e o ritmo real de sessões. */
export function diasParaMde(baseline: number, mdeRel: number, sessoesPorDia: number): number | null {
  if (sessoesPorDia <= 0) return null;
  const n = nParaMde(baseline, mdeRel);
  if (!Number.isFinite(n)) return null;
  return Math.ceil((2 * n) / sessoesPorDia);
}

/**
 * Formata fracao como percentual sem mentir na casa decimal. Arredondar 0,5%
 * para 1% dobra o numero que o time le, e taxa de conversao de LP vive nessa
 * faixa. Abaixo de 1% mostra duas decimais, abaixo de 10% mostra uma.
 */
function pct(fracao: number): string {
  const v = fracao * 100;
  if (v < 1) return `${v.toFixed(2)}%`;
  if (v < 10) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
}

/**
 * Avalia as três travas e devolve a trilha da hipótese.
 *
 * Ordem importa. Medição vem primeiro: sem evento não existe métrica primária,
 * e nenhum cálculo de poder faz sentido sobre conversão que ninguém mede.
 */
export function avaliarGate(input: GateInput): CroGate {
  const { sessoes, diasJanela, baseline, conversoes, temObjetivoDeConversao } = input;
  const metricaPrimaria = input.metricaPrimaria || "conversao";
  const nPorVariante = Math.floor(sessoes / 2);
  const sessoesPorDia = diasJanela > 0 ? sessoes / diasJanela : 0;

  const verificacaoObrigatoria =
    "Antes de executar, cruzar a metrica desta pagina por origem e por campanha. " +
    "Se a diferenca entre origens for maior que a diferenca entre variantes esperada, " +
    "o problema e mix de midia ou defeito de nomenclatura, nao a pagina, e o teste nao deve subir.";

  // Trava 1, medição.
  //
  // Dois casos, e o segundo foi descoberto em dado real. Zero conversao com
  // trafego alto e falta de evento. Mas taxa residual, tipo 6 conversoes em
  // 16 mil sessoes, tem o mesmo efeito pratico: nao existe metrica primaria
  // utilizavel, e a pagina provavelmente esta parcialmente instrumentada ou
  // sem caminho de conversao definido. Os dois viram bloqueio, com texto
  // diferente, porque o segundo e suspeita e nao fato.
  const zeroConversao = temObjetivoDeConversao && conversoes === 0 && sessoes >= 1000;
  const taxaResidual =
    temObjetivoDeConversao && conversoes > 0 && sessoes >= PISO_SESSOES_SUSPEITA && baseline < PISO_TAXA_SUSPEITA;

  if (zeroConversao || taxaResidual) {
    const bloqueio = zeroConversao
      ? `Pagina com ${sessoes.toLocaleString("pt-BR")} sessoes e nenhuma conversao registrada. ` +
        "Isso e ausencia de instrumentacao, nao conversao zero. Instrumentar o evento de " +
        "conversao antes de formular teste. Sem metrica primaria nao existe experimento."
      : `Pagina com ${sessoes.toLocaleString("pt-BR")} sessoes e apenas ${conversoes.toLocaleString("pt-BR")} ` +
        `conversoes, taxa de ${(baseline * 100).toFixed(3)}%. Antes de tratar como conversao baixa, ` +
        "verificar se o evento cobre todos os caminhos de conversao da pagina e se existe " +
        "caminho de conversao definido. Taxa residual assim geralmente e medicao incompleta, " +
        "nao comportamento do usuario.";
    return {
      trilha: "C",
      mdeRelativo: null,
      diasParaAlvo: null,
      nPorVariante,
      medicaoOk: false,
      bloqueio,
      verificacaoObrigatoria,
      metricaPrimaria,
      resumo: zeroConversao
        ? "Trilha C, bloqueada por falta de medicao. Instrumentar evento de conversao primeiro."
        : "Trilha C, bloqueada por suspeita de medicao incompleta. Auditar instrumentacao antes de testar.",
    };
  }

  // Trava 2, poder.
  const mde = mdeRelativo(baseline, nPorVariante);
  const diasAlvo = diasParaMde(baseline, MDE_ALVO_TRILHA_A, sessoesPorDia);

  if (nPorVariante < N_MINIMO_POR_VARIANTE) {
    return {
      trilha: "C",
      mdeRelativo: mde,
      diasParaAlvo: diasAlvo,
      nPorVariante,
      medicaoOk: true,
      bloqueio:
        `Amostra de ${nPorVariante.toLocaleString("pt-BR")} sessoes por variante na janela, abaixo do ` +
        `minimo de ${N_MINIMO_POR_VARIANTE}. Qualquer leitura aqui e ruido. Vale como descoberta ` +
        "qualitativa, nao como decisao.",
      verificacaoObrigatoria,
      metricaPrimaria,
      resumo: "Trilha C, amostra insuficiente. Serve para gerar hipotese, nao para decidir.",
    };
  }

  if (diasAlvo !== null && diasAlvo <= MAX_DIAS_TRILHA_A) {
    return {
      trilha: "A",
      mdeRelativo: mde,
      diasParaAlvo: diasAlvo,
      nPorVariante,
      medicaoOk: true,
      bloqueio: null,
      verificacaoObrigatoria,
      metricaPrimaria,
      resumo:
        `Trilha A, experimento controlado sobre ${metricaPrimaria}. Detecta lift de ${pct(MDE_ALVO_TRILHA_A)} em ${diasAlvo} dias. ` +
        `Na janela analisada o efeito minimo detectavel e de ${mde !== null ? pct(mde) : "indefinido"}.`,
    };
  }

  const mdeEm21Dias = mdeRelativo(baseline, Math.floor((sessoesPorDia * MAX_DIAS_TRILHA_A) / 2));
  if (mdeEm21Dias !== null && mdeEm21Dias <= MDE_LIMITE_TRILHA_B) {
    return {
      trilha: "B",
      mdeRelativo: mdeEm21Dias,
      diasParaAlvo: diasAlvo,
      nPorVariante,
      medicaoOk: true,
      bloqueio:
        `Trafego nao sustenta MDE de ${pct(MDE_ALVO_TRILHA_A)} em ${MAX_DIAS_TRILHA_A} dias, ` +
        `precisaria de ${diasAlvo !== null ? diasAlvo : "mais de 60"} dias. ` +
        `Em ${MAX_DIAS_TRILHA_A} dias so da para detectar lift de ${pct(mdeEm21Dias)} ou mais.`,
      verificacaoObrigatoria,
      metricaPrimaria,
      resumo:
        `Trilha B, quase-experimento com pre e pos e LP irma como controle. ` +
        `Evidencia media. So decide receita se o efeito observado for maior que ${pct(mdeEm21Dias)}.`,
    };
  }

  return {
    trilha: "C",
    mdeRelativo: mdeEm21Dias ?? mde,
    diasParaAlvo: diasAlvo,
    nPorVariante,
    medicaoOk: true,
    bloqueio:
      `Base de conversao de ${pct(baseline)} com ${Math.round(sessoesPorDia).toLocaleString("pt-BR")} ` +
      `sessoes por dia nao produz poder em ${MAX_DIAS_TRILHA_A} dias. Nenhum A/B aqui decide nada.`,
    verificacaoObrigatoria,
    metricaPrimaria,
    resumo:
      "Trilha C, descoberta qualitativa. Usar Clarity e teste de usabilidade para gerar hipotese. " +
      "Nao fecha decisao de receita.",
  };
}

/** Rótulo curto para exibir no card. */
export function rotuloTrilha(t: Trilha): string {
  if (t === "A") return "Trilha A, experimento controlado";
  if (t === "B") return "Trilha B, quase-experimento";
  return "Trilha C, descoberta qualitativa";
}

// ============================================================
// 4. Escopo da pagina: o que se espera dela
// ============================================================

/**
 * Objetivo da pagina. Define com que regua ela pode ser julgada.
 *
 * Existe porque o motor estava tratando pagina institucional como landing page.
 * Caso real que expos isso: www.suno.com.br/asset/fundos/snfz11/ e
 * /asset/fundos/snel11/, 78,7 mil sessoes em 30 dias, apareciam como as duas
 * maiores oportunidades do painel, com rejeicao de 87% e 84% e conversao perto
 * de zero. Inspecionadas, nao tem formulario, nao tem CTA de intencao, e a
 * unica acao disponivel sao links de download de relatorio gerencial a partir
 * de 2.858px de altura. Sao paginas de informacao de fundo, por decisao.
 * Usuario que chega, ve cota e rendimento e sai, fez exatamente o que a pagina
 * pede. Cobrar conversao dela produz proposta falsa e enterra a proposta real.
 *
 * Regra da casa, confirmada em 13/08/2026: o par LP mais institucional e
 * intencional. lp.suno.com.br/asset/snel11/ e a LP do fundo, com objetivo de
 * conversao. www.suno.com.br/asset/fundos/snel11/ e a institucional do mesmo
 * fundo, sem objetivo de conversao. Nao e duplicacao.
 */
export type EscopoPagina = "lp" | "institucional" | "checkout" | "logado" | "conteudo";

/** Marcadores de caminho que indicam pagina de conversao nos sites da casa. */
const MARCADORES_LP = ["/pv/", "/cl/", "/lm/", "/ao/", "/lp/", "/oferta", "/aplicacao", "/emissao"];

export function escopoDaPagina(host: string, path: string): EscopoPagina {
  const h = (host || "").toLowerCase();
  const p = (path || "").toLowerCase();

  if (p.includes("/checkout") || p.includes("/carrinho") || p.startsWith("/v5")) return "checkout";
  if (h.startsWith("investidor.") || p.startsWith("/entrar") || p.startsWith("/conta") || p.startsWith("/perfil")) {
    return "logado";
  }
  // Host dedicado a landing page, ou caminho com marcador de campanha.
  // lp., lp2., lp3., lps. Todos sao hosts de landing page da casa.
  // O host lp2.suno.com.br foi descoberto em 13/08/2026 hospedando /cl/ e /pv/,
  // e o teste anterior por startsWith("lp.") o classificava como conteudo.
  if (/^lps?d*./.test(h) || MARCADORES_LP.some((m) => p.includes(m))) return "lp";
  // Site institucional: informa, nao converte.
  if (h.startsWith("www.") || h === "suno.com.br" || h === "statusinvest.com.br") {
    if (p.startsWith("/asset/") || p.startsWith("/fundos/") || p.startsWith("/quem-somos") || p.startsWith("/politicas")) {
      return "institucional";
    }
  }
  return "conteudo";
}

/**
 * Pagina que nao deve receber proposta de teste de conversao.
 * Rejeicao alta e sessao curta em pagina informativa sao comportamento
 * esperado, nao defeito.
 */
export function foraDoEscopoDeConversao(escopo: EscopoPagina): boolean {
  return escopo === "institucional";
}

/** Texto para o card quando a pagina esta fora do escopo de conversao. */
export function textoForaDeEscopo(host: string, path: string): string {
  return (
    `Pagina institucional (${host}${path}), sem objetivo de conversao declarado. ` +
    "Rejeicao alta e sessao curta aqui sao comportamento esperado de pagina de informacao, " +
    "nao defeito de CRO. Antes de qualquer teste, decidir com a area responsavel se a pagina " +
    "deve ter objetivo comercial. Se sim, o que falta e caminho de conversao, e nao otimizacao. " +
    "Se nao, ela sai da fila de CRO e passa a ser medida por retorno e profundidade de leitura."
  );
}

/**
 * Gate pronto para pagina fora do escopo de conversao. Nao e teste, e decisao
 * de objetivo, e o card precisa dizer isso em vez de propor variante.
 */
export function gateForaDeEscopo(host: string, path: string): CroGate {
  return {
    trilha: "C",
    mdeRelativo: null,
    diasParaAlvo: null,
    nPorVariante: 0,
    medicaoOk: false,
    bloqueio: textoForaDeEscopo(host, path),
    verificacaoObrigatoria:
      "Nao desenhar variante. Levar a decisao de objetivo para a area responsavel pela pagina " +
      "antes de qualquer hipotese de CRO.",
    resumo: "Fora do escopo de conversao. Pagina institucional, decisao de objetivo pendente.",
    metricaPrimaria: "nenhuma definida",
  };
}

// ============================================================
// 5. Score de execucao: o que atacar primeiro
// ============================================================

/**
 * Ordena a fila por VELOCIDADE DE DECISAO, nao por gravidade do sintoma.
 *
 * O motor ordenava por ICE, e ICE nao sabe quanto tempo o teste leva para
 * responder. Na pratica isso colocava no topo pagina com rejeicao alta que
 * levaria 46 dias para produzir leitura, e empurrava para baixo pagina que
 * fecha experimento em 3 dias. Para quem quer acelerar cadencia de teste, essa
 * ordem esta invertida.
 *
 * A hipotese que resolve em 3 dias vale mais que a mesma hipotese em 46 dias,
 * porque libera a fila para a proxima. O score abaixo e ICE multiplicado por um
 * fator de velocidade e de confiabilidade da medicao:
 *
 *   sem medicao confiavel   x 0,30   instrumentar antes, nao testar
 *   trilha C                x 0,35   nao decide receita
 *   trilha B                x 0,70   evidencia media
 *   trilha A                x 1,00 a 1,50, conforme os dias para leitura
 *
 * Numeros medidos na Research em 30/08/2026: LP da 5a emissao, ICE 80 e trilha
 * A em 3 dias, sai com 114. Pagina de ativo, ICE 70 e trilha B em 46 dias, sai
 * com 49. Institucional fora de escopo, ICE 40, sai com 12. A ordem passa a
 * refletir o que da para executar e ler nesta semana.
 *
 * ICE continua exibido no card sem distorcao. Este score decide apenas a ordem.
 */
export function scoreDeExecucao(iceTotal: number, gate: CroGate | undefined): number {
  if (!gate) return iceTotal;
  if (!gate.medicaoOk) return Math.round(iceTotal * 0.3);
  if (gate.trilha === "C") return Math.round(iceTotal * 0.35);
  if (gate.trilha === "B") return Math.round(iceTotal * 0.7);
  // Trilha A: bonus por rapidez de leitura, ate 50%.
  const dias = gate.diasParaAlvo ?? MAX_DIAS_TRILHA_A;
  const rapidez = Math.max(0, Math.min(1, (MAX_DIAS_TRILHA_A - dias) / MAX_DIAS_TRILHA_A));
  return Math.round(iceTotal * (1 + rapidez * 0.5));
}
