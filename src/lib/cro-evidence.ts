/**
 * src/lib/cro-evidence.ts — o ÚNICO motor da aba de CRO.
 *
 * POR QUE SUBSTITUIU TRÊS MOTORES
 * Até 15/09/2026 a aba tinha quatro fontes de card disputando a mesma tela
 * (cro-rules.ts, cro-engine.ts, lp-analyzer.tsx e /api/cro/recommendations,
 * cujo `meta` o front descartava), com regras de precedência entre elas. Não
 * havia como saber de qual motor veio o card que se estava lendo.
 *
 * Pior: a maior parte do conteúdo era gerada. O LCP saía de
 * `1.6 + (bounceRate/100)*2.4 + (seed>>3)%10/20`, o ROI de `(seed + i*7) % 6`,
 * e as evidências eram frases fixas citando um Hotjar que a Suno não usa.
 *
 * AS QUATRO REGRAS DESTE MOTOR
 *
 * 1. Toda afirmação carrega fonte, número, janela e amostra. Sem os quatro, o
 *    card não é emitido.
 * 2. Piso de volume antes de qualquer taxa. Medido em 15/09: pedir o ranking de
 *    rage click sem piso devolveu dez páginas com 100%, todas com 1 ou 2
 *    visitas. Um de um é cem por cento.
 * 3. Achado, hipótese e teste são coisas SEPARADAS, e nem todo achado vira
 *    teste. Elemento que não responde ao clique é bug, e não se faz A/B para
 *    decidir se um botão deve funcionar.
 * 4. Teste só é proposto se couber no calendário. Se a amostra exigir 90 dias,
 *    a recomendação é mudança direta, não experimento.
 */

export type Classificacao =
  | "corrigir"
  | "investigar"
  | "testar"
  | "decidir"
  | "sem_volume"
  | "validar_medicao";

/** Onde o achado vive. Banner e pop-up moram em utm_medium, não em URL. */
export type Superficie = "pagina" | "banner" | "popup";

export type Evidencia = {
  /** De onde veio o número. Nunca vazio. */
  /**
   * "Página" entrou em 21/09/2026: é fato CONTADO no HTML servido, não medição
   * de comportamento. Fica como fonte própria de propósito, para o leitor saber
   * que aquela linha vem da leitura da página e não do Clarity nem do GA4.
   */
  fonte: "Clarity" | "GA4" | "Clarity + GA4" | "Página";
  /** O número em si, já formatado para leitura. */
  valor: string;
  /** Tamanho da amostra sobre a qual o número foi calculado. */
  amostra: string;
  /** Janela de coleta. */
  janela: string;
};

export type Achado = {
  id: string;
  superficie: Superficie;
  pagina: string;
  titulo: string;
  evidencias: Evidencia[];
  hipotese: string;
  classificacao: Classificacao;
  /** Por que esta classificação, e não outra. */
  porque: string;
  proximoPasso: string[];
  /** Ordena a fila. Maior = mais urgente. */
  prioridade: number;
  /** Quando é teste: o dimensionamento. null nos demais casos. */
  teste: DimensionamentoTeste | null;
};

export type DimensionamentoTeste = {
  baseline: number;
  efeitoMinimoPp: number;
  amostraPorVariante: number;
  sessoesPorDia: number;
  diasNecessarios: number;
  viavel: boolean;
  motivo: string;
};

/**
 * Piso de volume. Abaixo disso a página não entra em nenhum ranking de taxa e
 * vai para a lista de sinal fraco.
 */
export const PISO_PAGEVIEWS = 1000;

/**
 * ⚠️ OS DOIS PISOS QUE FALTAVAM, adicionados em 22/09/2026.
 *
 * O DEFEITO: a home do Status apareceu como "CORRIGIR - dead click em 12,5% dos
 * pageviews (1 de 101.736 pageviews)" e a /acoes/petr4 como "quickback em 20%
 * dos pageviews (1 de 5.479 pageviews)". Frases que se contradizem sozinhas: se
 * fosse 12,5% de 101.736, seriam 12.717 ocorrências, não 1.
 *
 * A CAUSA: `PISO_PAGEVIEWS` olhava o volume da PÁGINA, que era enorme, e nada
 * olhava a base da TAXA, que era minúscula. A taxa vem pronta da API calculada
 * sobre as sessões da linha de fricção; uma linha com 5 sessões e 1 quickback dá
 * 20% legítimos e completamente inúteis. Página grande com fricção rara passava
 * pelo piso e virava tarefa de correção com uma única ocorrência.
 *
 * POR QUE ESTES VALORES: com base 5 e proporção 20%, o intervalo de confiança de
 * 95% vai de ~0% a ~55%, ou seja, a taxa não distingue nada. Base 100 põe a
 * margem em torno de 8 pontos, que já sustenta comparação, e 10 ocorrências é o
 * mínimo para o time achar o elemento no heatmap em vez de caçar um clique
 * isolado. Os dois são exigidos JUNTOS: base alta com 2 ocorrências continua
 * sendo ruído, e 50 ocorrências numa base de 8 sessões continua sendo amostra
 * que não representa a página.
 *
 * Apertar isto esvazia parte da aba, e está certo que esvazie. O que ficar de
 * fora vai para `semVolume` com o motivo, em vez de sumir calado.
 */
export const PISO_BASE_TAXA = 100;
export const PISO_OCORRENCIAS = 10;

/** Um achado de fricção só nasce se as duas condições valerem. */
function taxaConfiavel(taxa: number | null, base: number | null, ocorrencias: number): boolean {
  return taxa !== null && (base ?? 0) >= PISO_BASE_TAXA && ocorrencias >= PISO_OCORRENCIAS;
}

/** Amostra honesta: a taxa sempre acompanhada do denominador que a produziu. */
function amostraDaTaxa(ocorrencias: number, base: number | null): string {
  const b = base ?? 0;
  return `${ocorrencias.toLocaleString("pt-BR")} ocorrência(s) em ${b.toLocaleString("pt-BR")} sessões medidas`;
}

/**
 * Limiares. Todos calibrados contra a medição de 15/09/2026 nas três B.U.s,
 * não são números de manual:
 *   dead click  - mediana das páginas com volume ficou entre 2% e 6%;
 *                 8% separa o que destoa. Casos reais achados: 15,69% no
 *                 dashboard do Status e 12,43% na carteira.
 *   rage click  - quase tudo abaixo de 0,3%; 1% é anomalia clara.
 *                 Caso real: 1,37% em /asset/snel11.
 *   quickback   - LPs ficam abaixo de 1%, portais entre 5% e 20%.
 *                 20% marca o que destoa. Casos: 31,23% na home da Research e
 *                 24,61% em /acoes/variacao/ibovespa.
 */
export const LIMIAR = {
  deadClick: 8,
  rageClick: 1,
  quickback: 20,
};

/**
 * Tamanho de amostra para teste A/B de proporção, 95% de confiança e 80% de
 * poder. Aproximação padrão n = 16 * p * (1-p) / d², com p = baseline e
 * d = efeito mínimo detectável em pontos percentuais absolutos.
 *
 * Aproximação é o certo aqui: a decisão que ela sustenta é "cabe ou não cabe no
 * mês", e para isso a precisão de segunda casa não muda nada.
 */
export function dimensionarTeste(
  baselinePct: number,
  efeitoMinimoPp: number,
  sessoesPorDia: number
): DimensionamentoTeste {
  const p = Math.min(Math.max(baselinePct / 100, 0.0001), 0.9999);
  const d = efeitoMinimoPp / 100;
  const amostraPorVariante = d > 0 ? Math.ceil((16 * p * (1 - p)) / (d * d)) : Infinity;
  // Duas variantes dividindo o tráfego da página.
  const diasNecessarios =
    sessoesPorDia > 0 && Number.isFinite(amostraPorVariante)
      ? Math.ceil((amostraPorVariante * 2) / sessoesPorDia)
      : Infinity;

  const viavel = diasNecessarios <= 30;
  return {
    baseline: baselinePct,
    efeitoMinimoPp,
    amostraPorVariante: Number.isFinite(amostraPorVariante) ? amostraPorVariante : 0,
    sessoesPorDia,
    diasNecessarios: Number.isFinite(diasNecessarios) ? diasNecessarios : 0,
    viavel,
    motivo: !Number.isFinite(diasNecessarios)
      ? "Sem tráfego suficiente para dimensionar."
      : viavel
        ? `Cabe em ${diasNecessarios} dias com o tráfego atual.`
        : `Precisaria de ${diasNecessarios} dias. Acima de 30 o teste não fecha: prefira mudança direta ou junte páginas semelhantes.`,
  };
}

type EntradaClarity = {
  url: string;
  pageViews: number;
  deadRate: number | null;
  rageRate: number | null;
  quickbackRate: number | null;
  /** Denominador real de cada taxa (sessões medidas). Ver clarity-api.ts. */
  deadBase: number | null;
  rageBase: number | null;
  quickbackBase: number | null;
  deadClicks: number;
  rageClicks: number;
  quickbacks: number;
  scriptErrors: number;
};

/**
 * Converte medição de fricção em achados classificados.
 *
 * `janela` e `dias` entram no texto da evidência: número sem janela não é
 * evidência, é boato.
 */
export function classificarFricção(
  linhas: EntradaClarity[],
  janela: string,
  dias: number
): { achados: Achado[]; semVolume: EntradaClarity[] } {
  const achados: Achado[] = [];
  const semVolume: EntradaClarity[] = [];

  for (const l of linhas) {
    if (l.pageViews < PISO_PAGEVIEWS) {
      semVolume.push(l);
      continue;
    }

    /**
     * Página com volume, fricção acima do limiar, mas base de taxa fraca demais
     * para sustentar decisão. Vai para a lista de sinal fraco em vez de sumir:
     * o próprio arquivo já ensina que resultado desaparecendo em silêncio é a
     * pior saída, porque quem olha conclui "não há achado".
     */
    const acimaDoLimiarMasSemBase =
      (l.deadRate !== null && l.deadRate >= LIMIAR.deadClick && !taxaConfiavel(l.deadRate, l.deadBase, l.deadClicks)) ||
      (l.rageRate !== null && l.rageRate >= LIMIAR.rageClick && !taxaConfiavel(l.rageRate, l.rageBase, l.rageClicks)) ||
      (l.quickbackRate !== null && l.quickbackRate >= LIMIAR.quickback && !taxaConfiavel(l.quickbackRate, l.quickbackBase, l.quickbacks));
    if (acimaDoLimiarMasSemBase) semVolume.push(l);

    const sessoesPorDia = dias > 0 ? Math.round(l.pageViews / dias) : 0;

    // ---- Erro de script: o mais grave, porque quebra funcionalidade ----
    if (l.scriptErrors > 0) {
      achados.push({
        id: `erro:${l.url}`,
        superficie: "pagina",
        pagina: l.url,
        titulo: "Erro de JavaScript na página",
        evidencias: [
          { fonte: "Clarity", valor: `${l.scriptErrors} ocorrências de erro de script`, amostra: `${l.pageViews.toLocaleString("pt-BR")} pageviews`, janela },
        ],
        hipotese: "Existe erro de JavaScript disparando nesta página. Parte deles quebra funcionalidade sem deixar rastro no GA4; parte é ruído conhecido de biblioteca. A mensagem é que separa os dois.",
        classificacao: "corrigir",
        porque: "Erro de JavaScript não é hipótese de UX, é defeito. Não se testa em A/B se o código deve funcionar. Mas antes de abrir tarefa, leia a MENSAGEM: ela decide se é bug de verdade ou ruído.",
        /**
         * ⚠️ ESTES PASSOS FORAM REESCRITOS EM 22/09/2026 POR UM MOTIVO CONCRETO.
         *
         * A versão anterior dizia apenas "filtrar gravações por erro de
         * JavaScript nesta URL". Um analista fez exatamente isso na tela de
         * Gravações do Clarity, com "Qualquer erro de JS" e janela de 60 dias,
         * e recebeu "nenhuma gravação encontrada". A conclusão natural foi que o
         * painel tinha inventado o número.
         *
         * O número estava certo: /acoes/cmig4 tinha 364 erros em 3.043 sessões
         * na janela, confirmado depois na própria API do Clarity, com as
         * mensagens nomeadas ("Cannot read properties of null (reading
         * 'dataset')", 152 ocorrências, entre outras).
         *
         * A diferença é de NATUREZA do dado, e é a armadilha que esta lista
         * agora antecipa: a CONTAGEM de erro vem de telemetria de todas as
         * sessões; a GRAVAÇÃO é amostra. Procurar gravação com filtro genérico
         * em janela longa devolve vazio com facilidade, e esse vazio NÃO
         * desmente a contagem.
         *
         * Regra que fica para qualquer achado deste painel: quando o próximo
         * passo manda conferir em outra ferramenta, ele tem que dizer ONDE a
         * confirmação existe de fato. Mandar o time para uma tela onde o dado
         * não mora é pior do que não dar passo nenhum: destrói a confiança no
         * número que estava certo.
         */
        proximoPasso: [
          "No Clarity, abrir Painel (não Gravações) e a seção de erros de JavaScript: é ali que a MENSAGEM do erro aparece, com a contagem por página",
          "Separar bug de ruído pela mensagem. 'ResizeObserver loop completed with undelivered notifications' é ruído conhecido e não quebra nada; 'Cannot read properties of null' e 'X is not defined' são bug real",
          "Só então procurar gravação, com a URL no filtro e a MESMA janela da análise. Atenção: filtrar 'Qualquer erro de JS' em janela longa costuma voltar vazio, porque gravação é amostra e a contagem é de todas as sessões. Vazio ali não desmente a contagem",
          "Abrir a tarefa para o dev com a MENSAGEM exata, não com a contagem",
          "Confirmar que o erro sumiu na janela seguinte",
        ],
        prioridade: 100 + Math.min(l.scriptErrors, 500),
        teste: null,
      });
    }

    // ---- Dead click: elemento que parece clicável e não é ----
    if (l.deadRate !== null && l.deadRate >= LIMIAR.deadClick && taxaConfiavel(l.deadRate, l.deadBase, l.deadClicks)) {
      achados.push({
        id: `dead:${l.url}`,
        superficie: "pagina",
        pagina: l.url,
        titulo: "Gente clicando em algo que não responde",
        evidencias: [
          { fonte: "Clarity", valor: `dead click em ${l.deadRate.toString().replace(".", ",")}% das sessões medidas`, amostra: amostraDaTaxa(l.deadClicks, l.deadBase), janela },
        ],
        hipotese: `Existe um elemento nesta página que parece clicável e não é. Em página de listagem costuma ser cabeçalho de tabela, número ou card: a pessoa espera abrir o detalhe e nada acontece.`,
        classificacao: "corrigir",
        porque: "Acima de " + LIMIAR.deadClick + "% isso é defeito de interface, não preferência. Não se faz A/B para decidir se um elemento deve responder ao clique: o heatmap mostra qual é o elemento e ele é corrigido.",
        proximoPasso: [
          "Abrir o heatmap de clique desta URL no Clarity",
          "Achar a concentração de clique fora de elemento interativo",
          "Tornar o elemento clicável OU tirar a aparência de clicável",
        ],
        prioridade: 60 + Math.round(l.deadRate),
        teste: null,
      });
    }

    // ---- Rage click: frustração explícita ----
    if (l.rageRate !== null && l.rageRate >= LIMIAR.rageClick && taxaConfiavel(l.rageRate, l.rageBase, l.rageClicks)) {
      achados.push({
        id: `rage:${l.url}`,
        superficie: "pagina",
        pagina: l.url,
        titulo: "Clique repetido de frustração",
        evidencias: [
          { fonte: "Clarity", valor: `rage click em ${l.rageRate.toString().replace(".", ",")}% das sessões medidas`, amostra: amostraDaTaxa(l.rageClicks, l.rageBase), janela },
        ],
        hipotese: "A pessoa clica várias vezes no mesmo lugar porque a resposta não vem ou demora. Costuma ser botão sem retorno visual, ou ação lenta sem estado de carregando.",
        classificacao: "corrigir",
        porque: "Rage click é sinal de algo travado, não de preferência de layout. Primeiro se descobre o que não respondeu.",
        proximoPasso: [
          "Assistir 10 gravações filtradas por rage click nesta URL",
          "Identificar o elemento e se o problema é ausência de resposta ou lentidão",
          "Adicionar estado de carregando ou corrigir a ação",
        ],
        prioridade: 70 + Math.round(l.rageRate * 5),
        teste: null,
      });
    }

    // ---- Quickback: a página não entrega o que prometeu ----
    if (l.quickbackRate !== null && l.quickbackRate >= LIMIAR.quickback && taxaConfiavel(l.quickbackRate, l.quickbackBase, l.quickbacks)) {
      achados.push({
        id: `quick:${l.url}`,
        superficie: "pagina",
        pagina: l.url,
        titulo: "Abre e volta imediatamente",
        evidencias: [
          { fonte: "Clarity", valor: `quickback em ${l.quickbackRate.toString().replace(".", ",")}% das sessões medidas`, amostra: amostraDaTaxa(l.quickbacks, l.quickbackBase), janela },
        ],
        hipotese: "A página não entrega no primeiro viewport o que o clique prometeu, e a pessoa percebe isso em segundos.",
        classificacao: "investigar",
        porque: "Quickback alto diz QUE a promessa foi quebrada, não ONDE. Pode ser a página, mas pode ser o anúncio ou o link que trouxe a pessoa. Testar layout antes de saber a origem é atacar o lugar errado.",
        proximoPasso: [
          "Quebrar o quickback por canal de entrada: se estiver concentrado num canal, o problema é a promessa de origem, não a página",
          "Assistir 10 gravações filtradas por quickback nesta URL",
          "Só então desenhar teste do primeiro viewport",
        ],
        prioridade: 40 + Math.round(l.quickbackRate),
        teste: null,
      });
    }
  }

  achados.sort((a, b) => b.prioridade - a.prioridade);
  semVolume.sort((a, b) => b.pageViews - a.pageViews);
  return { achados, semVolume };
}

/**
 * Achado de DIVERGÊNCIA entre o que o Clarity vê e o que o GA4 registra.
 *
 * É o tipo de achado mais valioso que existe e nenhum dos motores antigos
 * conseguia produzir, porque nenhum lia as duas fontes. Caso real que motivou
 * isto, medido em 15/09/2026: nas LPs de Asset o Clarity contou 1.080 sessões
 * com clique de saída e 175 com envio de formulário, enquanto o GA4 registrou
 * ZERO `click_whatsapp`. A LP convertia e a medição não chegava.
 */
export function acharDivergencia(params: {
  pagina: string;
  clarityAcoes: number;
  ga4Conversoes: number;
  eventoGA4: string;
  janela: string;
  amostra: string;
}): Achado | null {
  const { pagina, clarityAcoes, ga4Conversoes, eventoGA4, janela, amostra } = params;
  // Só vira achado quando o Clarity vê ação relevante e o GA4 vê quase nada.
  if (clarityAcoes < 50) return null;
  if (ga4Conversoes > clarityAcoes * 0.2) return null;

  return {
    id: `diverg:${pagina}`,
    superficie: "pagina",
    pagina,
    titulo: "O Clarity vê conversão e o GA4 não registra",
    evidencias: [
      { fonte: "Clarity", valor: `${clarityAcoes.toLocaleString("pt-BR")} sessões com ação de conversão`, amostra, janela },
      { fonte: "GA4", valor: `${ga4Conversoes.toLocaleString("pt-BR")} eventos \`${eventoGA4}\``, amostra, janela },
    ],
    hipotese: "A conversão está acontecendo e o evento não chega ao GA4. Pode ser tag que não dispara, ponte de iframe quebrada ou evento com nome diferente do esperado.",
    classificacao: "validar_medicao",
    porque:
      "Enquanto a medição estiver quebrada, NENHUM teste nesta página produz resultado interpretável: o experimento mediria a falha, não a mudança. E se essa página recebe mídia paga, a plataforma de anúncio está otimizando sem sinal de conversão.",
    proximoPasso: [
      "Reproduzir no ambiente onde quebra, não no desktop",
      "Conferir se o evento de conversão declarado para esta B.U. é o que a tag realmente dispara",
      "Corrigir a medição e só depois considerar qualquer teste aqui",
    ],
    prioridade: 200,
    teste: null,
  };
}

export const ROTULO_CLASSIFICACAO: Record<Classificacao, { texto: string; cor: string; explica: string }> = {
  decidir: {
    texto: "Decidir",
    cor: "sky",
    explica: "O experimento já rodou sozinho e o resultado está na mesa. Não há o que testar, há o que trocar.",
  },
  validar_medicao: {
    texto: "Validar medição",
    cor: "violet",
    explica: "O número pode estar errado. Confirmar antes de decidir qualquer coisa em cima dele.",
  },
  corrigir: {
    texto: "Corrigir",
    cor: "red",
    explica: "É defeito, não hipótese. Corrige e confere na janela seguinte, sem A/B.",
  },
  investigar: {
    texto: "Investigar",
    cor: "amber",
    explica: "O dado mostra QUE tem problema, não ONDE. Falta um corte antes de desenhar teste.",
  },
  testar: {
    texto: "Testar",
    cor: "emerald",
    explica: "Hipótese clara, volume suficiente e teste que cabe no calendário.",
  },
  sem_volume: {
    texto: "Sinal fraco",
    cor: "slate",
    explica: `Abaixo de ${PISO_PAGEVIEWS} pageviews na janela, OU com fricção acima do limiar mas medida sobre menos de ${PISO_BASE_TAXA} sessões ou menos de ${PISO_OCORRENCIAS} ocorrências. Nos dois casos a taxa não sustenta decisão.`,
  },
};
