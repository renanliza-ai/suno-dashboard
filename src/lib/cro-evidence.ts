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

export type Classificacao = "corrigir" | "investigar" | "testar" | "sem_volume" | "validar_medicao";

export type Evidencia = {
  /** De onde veio o número. Nunca vazio. */
  fonte: "Clarity" | "GA4" | "Clarity + GA4";
  /** O número em si, já formatado para leitura. */
  valor: string;
  /** Tamanho da amostra sobre a qual o número foi calculado. */
  amostra: string;
  /** Janela de coleta. */
  janela: string;
};

export type Achado = {
  id: string;
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

    const sessoesPorDia = dias > 0 ? Math.round(l.pageViews / dias) : 0;

    // ---- Erro de script: o mais grave, porque quebra funcionalidade ----
    if (l.scriptErrors > 0) {
      achados.push({
        id: `erro:${l.url}`,
        pagina: l.url,
        titulo: "Erro de JavaScript na página",
        evidencias: [
          { fonte: "Clarity", valor: `${l.scriptErrors} ocorrências de erro de script`, amostra: `${l.pageViews.toLocaleString("pt-BR")} pageviews`, janela },
        ],
        hipotese: "Existe erro de JavaScript quebrando funcionalidade nesta página. Pode estar impedindo conversão sem deixar rastro no GA4.",
        classificacao: "corrigir",
        porque: "Erro de JavaScript não é hipótese de UX, é defeito. Não se testa em A/B se o código deve funcionar.",
        proximoPasso: [
          "Abrir o Clarity e filtrar gravações por erro de JavaScript nesta URL",
          "Identificar a mensagem e em qual navegador ou sistema ela aparece",
          "Corrigir e confirmar que o erro sumiu na janela seguinte",
        ],
        prioridade: 100 + Math.min(l.scriptErrors, 500),
        teste: null,
      });
    }

    // ---- Dead click: elemento que parece clicável e não é ----
    if (l.deadRate !== null && l.deadRate >= LIMIAR.deadClick) {
      achados.push({
        id: `dead:${l.url}`,
        pagina: l.url,
        titulo: "Gente clicando em algo que não responde",
        evidencias: [
          { fonte: "Clarity", valor: `dead click em ${l.deadRate.toString().replace(".", ",")}% dos pageviews`, amostra: `${l.deadClicks.toLocaleString("pt-BR")} de ${l.pageViews.toLocaleString("pt-BR")} pageviews`, janela },
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
    if (l.rageRate !== null && l.rageRate >= LIMIAR.rageClick) {
      achados.push({
        id: `rage:${l.url}`,
        pagina: l.url,
        titulo: "Clique repetido de frustração",
        evidencias: [
          { fonte: "Clarity", valor: `rage click em ${l.rageRate.toString().replace(".", ",")}% dos pageviews`, amostra: `${l.rageClicks.toLocaleString("pt-BR")} de ${l.pageViews.toLocaleString("pt-BR")} pageviews`, janela },
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
    if (l.quickbackRate !== null && l.quickbackRate >= LIMIAR.quickback) {
      achados.push({
        id: `quick:${l.url}`,
        pagina: l.url,
        titulo: "Abre e volta imediatamente",
        evidencias: [
          { fonte: "Clarity", valor: `quickback em ${l.quickbackRate.toString().replace(".", ",")}% dos pageviews`, amostra: `${l.quickbacks.toLocaleString("pt-BR")} de ${l.pageViews.toLocaleString("pt-BR")} pageviews`, janela },
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
    texto: "Sem volume",
    cor: "slate",
    explica: `Abaixo de ${PISO_PAGEVIEWS} pageviews na janela. Taxa aqui não é confiável.`,
  },
};
