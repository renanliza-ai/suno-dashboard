/**
 * Briefing do card, na linguagem de quem vai executar.
 *
 * O texto do card e o MESMO que vai para a tarefa no Monday. Quem le e a
 * Pamela e o Ricardo, e o que eles precisam saber e: o que vamos atacar, por
 * que, o que vamos subir, como vamos medir e quando isso decide. Nada mais.
 *
 * O motor antigo despejava o framework academico no card, coisa do tipo
 * "MECLABS, motivacao alta, equacao C = 4m + 3v + 2(i-f) - 2a com (i-f)
 * negativo". Isso nao diz a ninguem o que fazer na segunda-feira. O framework
 * continua guiando a analise, mas fica fora do briefing.
 *
 * Regras de escrita, valem para tudo que sai daqui:
 * - Sem travessao. Hifen ou virgula.
 * - Sem asterisco de negrito ou italico.
 * - Numero sempre junto do que ele sustenta.
 * - Frase curta, voz ativa, verbo no comeco quando for instrucao.
 * - Nada de nome de framework, sigla ou equacao.
 */

import type { CROInsight } from "./cro-engine";

/**
 * Troca travessao por pontuacao normal e limpa o resto que nao deve sair no
 * texto do time. Serve como rede de seguranca: mesmo que uma regra nova escreva
 * travessao, ele nao chega no Monday.
 */
export function semTravessao(texto: string): string {
  return (texto || "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\*\*/g, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Nome amigavel do elemento que o teste toca. */
function elementoDe(insight: CROInsight): string {
  const porCategoria: Record<string, string> = {
    Performance: "velocidade de carregamento",
    "UX/CTA": "chamada de acao",
    Funil: "passo do funil",
    Mensagem: "mensagem da primeira dobra",
    "Conteúdo": "conteudo e proximo passo",
    Mobile: "experiencia no celular",
    "Retenção": "continuidade da navegacao",
  };
  return porCategoria[insight.category] || "pagina";
}

/** Uma frase que explica por que isso importa, sem nome de framework. */
function porQueImporta(insight: CROInsight): string {
  const porKind: Record<string, string> = {
    connect_rate:
      "Quem chega nao esta encontrando o caminho para converter, ou encontra tarde demais.",
    bounce:
      "A maioria sai sem interagir, o que aponta para promessa do anuncio diferente do que a pagina entrega.",
    retencao:
      "O visitante consome o conteudo e nao encontra motivo para seguir, entao a visita morre ali.",
    oportunidade:
      "Esta pagina ja funciona acima das outras. O ganho aqui esta em copiar o que ela faz, nao em consertar.",
    funil: "Existe uma etapa perdendo gente que ja demonstrou intencao.",
  };
  return porKind[insight.kind || "funil"] || porKind.funil;
}

/**
 * Briefing completo, em blocos nomeados. Vira o array de steps do insight, que
 * e exatamente o que a API do Monday transforma em descricao da tarefa.
 */
export function montarBriefing(insight: CROInsight): string[] {
  const l: string[] = [];
  const g = insight.gate;
  const v = insight.variants;

  // Card de pagina vencedora tem fluxo proprio. Nao e teste nesta pagina, e
  // extracao de padrao para aplicar em outra. Tratar como A/B faz o briefing
  // mandar mexer na unica pagina que ja funciona.
  if (insight.id.startsWith("conversion-winner")) {
    return briefingDeReplicacao(insight);
  }

  // Pagina sem metrica confiavel nao recebe desenho de variante. O briefing
  // antigo dizia "nao teste aqui" no bloco de atencao e logo abaixo entregava
  // versao A e versao B para subir. Para quem executa, isso e contradicao, e
  // na duvida o time sobe o teste.
  if (g && !g.medicaoOk) {
    return briefingDeBloqueio(insight);
  }

  // 1. O que vamos atacar
  l.push(`O QUE VAMOS ATACAR: ${elementoDe(insight)} em ${insight.page}`);
  l.push(`Pagina: ${insight.pageUrl}`);

  // 2. Por que
  l.push(`POR QUE: ${semTravessao(insight.detectedFrom)}. ${porQueImporta(insight)}`);

  // 3. O bloqueio vem antes do desenho. Se nao da para testar, o time precisa
  // saber disso na primeira tela, nao no fim do texto.
  if (g && g.bloqueio) {
    l.push(`ATENCAO, LEIA ANTES DE COMECAR: ${semTravessao(g.bloqueio)}`);
  }

  // 4. O que vamos subir
  if (v) {
    l.push(`COMO ESTA HOJE, versao A: ${semTravessao(v.a.note)}`);
    l.push(`O QUE VAMOS SUBIR, versao B: ${semTravessao(v.b.note)}`);
    const mudam = v.b.blocks.filter((b) => b.changed).map((b) => b.label);
    if (mudam.length > 0) {
      l.push(`MUDA SO ISSO: ${mudam.join("; ")}. O resto fica igual, senao nao da para saber o que fez efeito.`);
    }
  } else if (insight.action) {
    l.push(`O QUE VAMOS SUBIR: ${semTravessao(insight.action)}`);
  }

  // 5. Como vamos medir
  //
  // A metrica que decide e o EVENTO DE CONVERSAO da pagina, nunca o sintoma.
  // O motor antigo colocava "taxa de rejeicao" como metrica que decide numa
  // pagina cujo objetivo e cta_click, e isso contradizia a propria linha
  // seguinte do briefing. Rejeicao vira guardrail, nao juiz.
  const metricaDoSintoma = v ? v.primaryMetric : insight.primaryKPI;
  const metricaQueDecide = g && g.medicaoOk ? g.metricaPrimaria : metricaDoSintoma;
  l.push(`METRICA QUE DECIDE: ${semTravessao(metricaQueDecide)}`);
  const guardrails = [...(v ? v.guardrails : insight.secondaryKPIs || [])];
  if (semTravessao(metricaDoSintoma) !== semTravessao(metricaQueDecide)) {
    guardrails.unshift(metricaDoSintoma);
  }
  if (guardrails.length > 0) {
    l.push(`NAO PODE PIORAR: ${guardrails.map(semTravessao).join("; ")}`);
  }

  // 6. Quando decide
  if (g) {
    if (g.trilha === "A") {
      l.push(
        `QUANDO DECIDE: teste A/B 50/50. Amostra de ${g.nPorVariante.toLocaleString("pt-BR")} sessoes por versao, ` +
          `leitura em ${g.diasParaAlvo ?? insight.estimatedTestDays ?? "cerca de 14"} dias. ` +
          `Nao olhar resultado antes disso, porque numero de dois dias vira decisao errada.`
      );
    } else if (g.trilha === "B") {
      l.push(
        "QUANDO DECIDE: nao monte A/B aqui, o trafego nao sustenta. Rode antes e depois, " +
          "usando uma LP parecida como comparacao no mesmo periodo. A evidencia e media, " +
          "entao serve para seguir na direcao, nao para fechar decisao de receita."
      );
    } else {
      l.push(
        "QUANDO DECIDE: aqui nao decide. Serve para levantar hipotese, com gravacao de tela " +
          "e conversa com usuario. Nenhuma decisao de receita fecha so com isso."
      );
    }
    l.push(`MEDIDO SOBRE O EVENTO: ${g.metricaPrimaria}`);
  }

  // 7. Antes de subir
  if (g && g.verificacaoObrigatoria) {
    l.push(`CONFERIR ANTES DE SUBIR: ${semTravessao(g.verificacaoObrigatoria)}`);
  }
  l.push(
    "QA OBRIGATORIO ANTES DE SUBIR: abre no celular e no desktop sem quebrar, " +
      "o botao de acao aparece sem rolar a tela, o formulario chega no CRM, " +
      "o evento dispara uma vez por sessao, e o carregamento nao piora."
  );

  // 8. Quando derrubar
  if (insight.rollbackCriteria) {
    l.push(`DERRUBAR SE: ${semTravessao(insight.rollbackCriteria)}`);
  }

  // 9. Confirmacao no comportamento real, se houver protocolo
  if (insight.clarityProtocol && insight.clarityProtocol.length > 0) {
    l.push(
      `CONFIRMAR NA GRAVACAO DE TELA: ${insight.clarityProtocol.map(semTravessao).join("; ")}`
    );
  }

  return l;
}

/**
 * Uma linha para o corpo do card. Substitui a hipotese cheia de jargao.
 * Formato: o que atacar, o numero que sustenta, e o que vamos subir.
 */
export function descricaoCurta(insight: CROInsight): string {
  if (insight.id.startsWith("conversion-winner")) {
    // Nao atacar esta pagina. Ela e a referencia.
    return semTravessao(
      `${insight.page} e a LP que mais converte da property. ${insight.detectedFrom}. ` +
        "Vamos extrair o padrao dela e aplicar na LP de menor conversao, medindo na receptora."
    );
  }
  if (insight.gate && !insight.gate.medicaoOk) {
    // Sem metrica confiavel nao existe o que subir. O corpo do card nao pode
    // prometer variante, senao contradiz o briefing logo abaixo.
    return semTravessao(
      `Nao e teste. ${insight.detectedFrom}, mas falta metrica confiavel nesta pagina. ` +
        "Antes de qualquer variante, decidir o objetivo dela e instrumentar a conversao."
    );
  }
  const alvo = elementoDe(insight);
  const oQueSobe = insight.variants ? insight.variants.b.note : insight.action;
  const base = `Atacar a ${alvo} em ${insight.page}. Evidencia: ${insight.detectedFrom}. Vamos subir: ${oQueSobe}.`;
  return semTravessao(base);
}

/**
 * Briefing de replicacao de padrao. A pagina do card e o controle e nao deve
 * ser tocada. O teste acontece na pagina receptora.
 */
function briefingDeReplicacao(insight: CROInsight): string[] {
  const l: string[] = [];
  l.push(`O QUE VAMOS ATACAR: nao e esta pagina. ${insight.page} e a referencia, e ela nao pode ser alterada.`);
  l.push(`Pagina de referencia: ${insight.pageUrl}`);
  l.push(`POR QUE: ${semTravessao(insight.detectedFrom)}. Copiar o que ja funciona rende mais que consertar pagina ruim no escuro, e o padrao serve para as outras LPs tambem.`);
  l.push(
    "O QUE FAZER, PASSO 1: abrir as duas paginas lado a lado e anotar cada diferenca. " +
      "Primeira dobra, quantidade de campos do formulario, prova social, se mostra preco, " +
      "texto e posicao do botao de acao, e se o botao aparece sem rolar a tela."
  );
  l.push(
    "PASSO 2: conferir de onde vem o trafego das duas. Se a diferenca de origem for grande, " +
      "parte do resultado e da midia e nao da pagina, e a copia rende menos do que parece."
  );
  l.push(
    "PASSO 3: escolher as duas ou tres diferencas de maior efeito e aplicar SO ELAS na pagina receptora. " +
      "Aplicar tudo de uma vez impede saber o que funcionou."
  );
  l.push(`METRICA QUE DECIDE: ${semTravessao(insight.primaryKPI)}`);
  if (insight.secondaryKPIs && insight.secondaryKPIs.length > 0) {
    l.push(`NAO PODE PIORAR: ${insight.secondaryKPIs.map(semTravessao).join("; ")}`);
  }
  l.push(
    "QUANDO DECIDE: mede na pagina receptora, comparando as quatro semanas antes com as quatro depois. " +
      "Nao e A/B, entao a evidencia e media e serve para seguir na direcao."
  );
  l.push(`DERRUBAR SE: ${semTravessao(insight.rollbackCriteria)}`);
  return l;
}

/**
 * Briefing de pagina bloqueada. Vale para dois casos: pagina institucional sem
 * objetivo de conversao, e pagina cuja conversao nao esta medida de forma
 * confiavel. Nos dois, o proximo passo e decisao ou instrumentacao, nunca
 * teste, e o briefing nao entrega variante nenhuma para nao dar margem.
 */
function briefingDeBloqueio(insight: CROInsight): string[] {
  const g = insight.gate;
  const l: string[] = [];
  l.push(`NAO E TESTE: nao desenhar variante e nao subir experimento em ${insight.page}.`);
  l.push(`Pagina: ${insight.pageUrl}`);
  l.push(`O QUE O DADO MOSTRA: ${semTravessao(insight.detectedFrom)}`);
  if (g && g.bloqueio) l.push(`POR QUE NAO E TESTE: ${semTravessao(g.bloqueio)}`);
  l.push(
    "O QUE FAZER AGORA: levar a decisao para quem responde pela pagina. " +
      "Se ela precisa ter objetivo comercial, o que falta e caminho de conversao, " +
      "e isso e construcao e nao otimizacao. Se nao precisa, ela sai da fila de CRO."
  );
  l.push(
    "SE A DECISAO FOR TER OBJETIVO: instrumentar o evento de conversao primeiro, " +
      "esperar duas semanas de dado limpo, e so entao formular hipotese de teste."
  );
  l.push("NAO FAZER: mexer em layout, texto ou botao antes dessa decisao. Sem metrica, nao da para saber se melhorou.");
  return l;
}
