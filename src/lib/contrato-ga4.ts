/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTRATO DE DADOS DO PAINEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pedido do Renan em 01/10/2026, depois de um dia em que a aba de Landing
 * Pages foi quebrada e consertada duas vezes: "preciso garantir que isso nunca
 * mais quebre, que isso nunca mais retroceda, porque a gente usa esse painel
 * para trazer insight".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO NÃO PROMETE
 * ─────────────────────────────────────────────────────────────────────────
 * Não promete número IGUAL ao da interface do GA4, porque isso é impossível e
 * prometer seria vender uma garantia que falha no primeiro mês. Três causas
 * estruturais, todas medidas nesta casa:
 *
 *   1. UNIDADE. O CRM conta PESSOA e o GA4 conta DISPARO. Medido na
 *      /cl/arsenal-independencia em set/2026: 819 eventos, 777 usuários, 780
 *      leads no Salesforce. Esta é a única das três que dá para corrigir, e o
 *      contrato EXIGE a correção (ver `unidadeDeLead`).
 *
 *   2. CARDINALIDADE. Quanto mais fina a quebra, menos o GA4 devolve. Mesmo
 *      evento, mesma janela, mesma property: 5.005 sem quebra, 5.141 por
 *      hostName, 3.528 por pagePath. Não tem conserto do nosso lado.
 *
 *   3. MODELAGEM POR CONSENTIMENTO. A interface mostra o número modelado pelo
 *      Google e a Data API devolve o coletado. A API não expõe nenhum sinal
 *      disso, então nem detectar dá.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ELE PROMETE
 * ─────────────────────────────────────────────────────────────────────────
 * Trava tudo que É verificável, e grita quando quebra. São duas famílias:
 *
 *   INVARIANTES — verdades que têm que valer em TODA resposta, hoje e sempre.
 *   Cada uma nasceu de um defeito real que foi para a tela. Elas rodam dentro
 *   da própria rota, com o dado na mão.
 *
 *   NÃO REGRESSÃO — o mês FECHADO não muda mais. Setembro de 2026 tem o número
 *   que tem, para sempre. Se a resposta de hoje para setembro difere da de
 *   ontem além da tolerância, alguma coisa quebrou entre ontem e hoje, e o
 *   painel precisa dizer isso ANTES de alguém levar o número para uma reunião.
 *   É o teste que teria pego 141 linhas virando 22 em uma hora, em vez de só
 *   quando o Renan olhou.
 */

/** `quebra` para o painel, `alerta` para quem mantém. */
export type Severidade = "quebra" | "alerta";

export type Achado = {
  /** Identificador estável: entra em alerta e em histórico, não muda. */
  id: string;
  severidade: Severidade;
  titulo: string;
  /** Os NÚMEROS que sustentam o achado. Sem isso o alerta não é acionável. */
  evidencia: string;
  comoCorrigir: string;
};

/**
 * Como a aba conta lead. O contrato exige `pessoas`, porque é a unidade que
 * fecha com o CRM e é a pergunta de negócio ("quanta gente eu captei").
 * `eventos` é aceito com ALERTA enquanto a aba não migra, nunca em silêncio.
 */
export type UnidadeDeLead = "pessoas" | "eventos" | "indisponivel";

/** Uma consulta ao GA4 e o quanto ela chegou perto do próprio teto. */
export type ConsultaMedida = { nome: string; linhas: number; limite: number };

/**
 * A ASSINATURA é o que o baseline guarda e compara mês a mês. São poucos
 * números de propósito: quanto mais campo, mais ruído, e o alarme que dispara
 * à toa deixa de ser lido.
 */
export type Assinatura = {
  linhas: number;
  sessoes: number;
  /** Conversão principal da aba, na unidade que a aba declara. */
  conversao: number;
};

export type Contrato = {
  aba: string;
  bu: string;
  unidadeDeLead: UnidadeDeLead;
  assinatura: Assinatura;
  achados: Achado[];
  /** Resumo pronto para a tela, sem precisar reprocessar os achados. */
  aprovado: boolean;
};

// ═════════════════════════════════════════════════════════════════════════
// INVARIANTES
// ═════════════════════════════════════════════════════════════════════════

/**
 * TRUNCAMENTO SILENCIOSO. O defeito mais caro desta casa, e o único que já
 * aconteceu TRÊS vezes em rotas diferentes.
 *
 * O GA4 ordena por volume e corta no `limit`. Quando a resposta vem com
 * exatamente o número de linhas do limite, quase certamente foi cortada, e o
 * que sobrou são as linhas MAIORES. O resultado parece perfeito: a tela
 * carrega, os números são plausíveis, e o que importava caiu fora.
 *
 * Histórico:
 *   /api/ga4/evento-diario .... page_view e session_start ocuparam o limite e
 *                               a resposta trouxe 6 páginas onde o GA4 tinha 71
 *   /api/lp/performance ....... o portal ocupou o limite e a tabela caiu de
 *                               141 landing pages para 22
 *   /api/comunicacao/spaces ... a razão de existir do pré-filtro de medium
 *
 * Por isso aqui é QUEBRA, não alerta. Resposta truncada não é resposta.
 */
export function verificarTruncamento(consultas: ConsultaMedida[]): Achado[] {
  const achados: Achado[] = [];
  for (const c of consultas) {
    if (c.limite <= 0) continue;
    if (c.linhas >= c.limite) {
      achados.push({
        id: `truncamento:${c.nome}`,
        severidade: "quebra",
        titulo: `A consulta "${c.nome}" bateu no teto de linhas`,
        evidencia: `${c.linhas.toLocaleString("pt-BR")} linhas devolvidas para um limite de ${c.limite.toLocaleString("pt-BR")}. O GA4 ordena por volume e corta no limite, então o que sobrou são as linhas MAIORES e o resto sumiu sem erro.`,
        comoCorrigir:
          "Subir o limite NÃO é a primeira resposta: estreitar a pergunta é. Filtrar na consulta (por evento, por host, por lista fechada de caminhos) tira do caminho o que não interessa e devolve o teto para quem precisa dele.",
      });
    } else if (c.linhas >= c.limite * 0.9) {
      achados.push({
        id: `truncamento-proximo:${c.nome}`,
        severidade: "alerta",
        titulo: `A consulta "${c.nome}" está a menos de 10% do teto`,
        evidencia: `${c.linhas.toLocaleString("pt-BR")} de ${c.limite.toLocaleString("pt-BR")}. Ainda não cortou, mas corta no mês que o volume crescer, e aí corta em silêncio.`,
        comoCorrigir: "Estreitar a consulta ou subir o teto antes que ele seja atingido.",
      });
    }
  }
  return achados;
}

/**
 * COBERTURA MAIOR QUE 100%.
 *
 * A soma da coluna da tabela não pode passar o total que a property registrou
 * no mesmo evento e na mesma janela. Quando passa, ou a tabela está contando a
 * mesma coisa duas vezes, ou o total está medido num escopo menor que a tabela.
 *
 * Os dois já aconteceram: a coerção de vazio para "/" criava duas linhas com o
 * mesmo caminho lendo o mesmo bucket (conversão em dobro), e em 01/10/2026 a
 * tabela passou a incluir hosts de captação enquanto o total ainda contava só
 * host de LP.
 *
 * ⚠️⚠️ OS DOIS NÚMEROS TÊM QUE ESTAR EM DISPARO, NUNCA EM PESSOA. Esta regra
 * custou um falso positivo no ar, em 01/10/2026, na primeira hora de vida do
 * contrato.
 *
 * Eu passei a SOMA DE PESSOAS por página contra as PESSOAS ÚNICAS da property:
 * 4.708 contra 4.561, e o contrato gritou "103,2%, impossível". Não é
 * impossível, é o esperado: usuário único NÃO É ADITIVO, e quem captou em duas
 * páginas conta uma vez em cada linha. O painel chegou a exibir, no MESMO
 * payload, o bloco de cobertura explicando os 147 duplicados como normal e o
 * contrato chamando o mesmo fato de defeito.
 *
 * Disparo é aditivo, então a comparação fecha: a soma por página só pode ser
 * MENOR que o total (a quebra perde linha por cardinalidade), nunca maior. Se
 * for maior, aí sim alguma coisa está contada em dobro.
 */
export function verificarCobertura(args: {
  /** Soma dos DISPAROS por linha. Nunca a soma de pessoas. */
  somaDaColuna: number;
  /** Total de DISPAROS do evento, sem quebra. Nunca pessoas únicas. */
  totalNaProperty: number | null;
  evento: string | null;
}): Achado[] {
  const { somaDaColuna, totalNaProperty, evento } = args;
  if (totalNaProperty === null || totalNaProperty <= 0) return [];
  const pct = (somaDaColuna / totalNaProperty) * 100;
  if (pct > 101) {
    return [
      {
        id: "cobertura-acima-de-100",
        severidade: "quebra",
        titulo: "A soma da tabela passou o total da property",
        evidencia: `A tabela soma ${somaDaColuna.toLocaleString("pt-BR")} de ${evento || "conversão"} e a property registrou ${totalNaProperty.toLocaleString("pt-BR")} na mesma janela. Isso dá ${pct.toFixed(1)}%, que é impossível.`,
        comoCorrigir:
          "Duas causas conhecidas: linha duplicada lendo o mesmo bucket de evento (conferir normalização de caminho e coerção de vazio), ou o total medido num escopo MENOR que o da tabela (conferir se o filtro de host do total cobre todos os hosts que a tabela mostra).",
      },
    ];
  }
  return [];
}

/**
 * TAXA IMPOSSÍVEL SEM RESSALVA.
 *
 * Conversão maior que sessão acontece de forma legítima: a sessão é contada na
 * página de ENTRADA e o evento na página onde DISPAROU, então quem chega por
 * outra página gera numerador sem denominador. Isso é efeito colateral aceito
 * do escopo misto, e não é defeito.
 *
 * O defeito é EXIBIR a taxa nesse caso. A regra: o número absoluto fica, a taxa
 * vira nula, e o motivo vai declarado na linha. Esta invariante checa que
 * nenhuma linha escapou dessa regra.
 */
export function verificarTaxaImpossivel(
  linhas: { conversao: number; sessoes: number; taxa: number | null; ressalva: string | null }[]
): Achado[] {
  const escapou = linhas.filter(
    (l) => l.conversao > l.sessoes && l.taxa !== null && !l.ressalva
  );
  if (escapou.length === 0) return [];
  return [
    {
      id: "taxa-impossivel-exibida",
      severidade: "quebra",
      titulo: `${escapou.length} linha(s) exibem taxa acima de 100%`,
      evidencia: `Exemplo: ${escapou[0].conversao.toLocaleString("pt-BR")} conversões para ${escapou[0].sessoes.toLocaleString("pt-BR")} sessões de entrada, com taxa ${escapou[0].taxa}% na tela e sem ressalva.`,
      comoCorrigir:
        "O número absoluto está certo e fica. A taxa tem que virar nula com o motivo na própria linha: a sessão é contada na página de ENTRADA e o evento na página onde disparou.",
    },
  ];
}

/**
 * UNIDADE DA CONVERSÃO.
 *
 * Em 30/09/2026 o Renan comparou a tela com o Salesforce e a diferença de 32
 * leads parecia perda de dado. Não era: a tela mostrava DISPARO e o CRM conta
 * PESSOA. Contra usuário a diferença caía para 3.
 *
 * Aba que ainda conta disparo não está errada, está em unidade diferente, e o
 * estrago é o mesmo: quem compara com o CRM conclui que o painel não bate.
 * Então é ALERTA, nunca silêncio.
 */
export function verificarUnidade(unidade: UnidadeDeLead, aba: string): Achado[] {
  if (unidade === "pessoas" || unidade === "indisponivel") return [];
  return [
    {
      id: "unidade-em-evento",
      severidade: "alerta",
      titulo: `A aba ${aba} conta DISPARO, não pessoa`,
      evidencia:
        "A aba de Landing Pages conta pessoas desde 30/09/2026. Enquanto esta contar disparo, as duas telas respondem números diferentes para a mesma pergunta, e nenhuma das duas fecha com o CRM.",
      comoCorrigir:
        "Pedir `totalUsers` junto de `eventCount` na mesma consulta e usar o usuário como conversão principal, mantendo o disparo ao lado: a razão entre os dois é reenvio de formulário, que é sinal de fricção.",
    },
  ];
}

/**
 * INTEGRIDADE DA QUEBRA.
 *
 * Quando a tabela quebra um total em partes (peça dentro de espaço, página
 * dentro de host), a soma das partes tem que bater com o total medido sem
 * quebra. Quando não bate, houve corte de linha, e a tela precisa dizer em vez
 * de apresentar uma tabela que não fecha.
 */
export function verificarIntegridade(args: {
  nome: string;
  totalSemQuebra: number;
  somaDasPartes: number;
  /** Fração aceita, ex. 0,005 para 0,5%. */
  tolerancia: number;
}): Achado[] {
  const { nome, totalSemQuebra, somaDasPartes, tolerancia } = args;
  if (totalSemQuebra <= 0) return [];
  const dif = Math.abs(totalSemQuebra - somaDasPartes);
  const limite = Math.max(1, totalSemQuebra * tolerancia);
  if (dif <= limite) return [];
  const pct = (dif / totalSemQuebra) * 100;
  return [
    {
      id: `integridade:${nome}`,
      severidade: dif > totalSemQuebra * 0.05 ? "quebra" : "alerta",
      titulo: `A quebra por ${nome} não fecha com o total`,
      evidencia: `Total sem quebra: ${totalSemQuebra.toLocaleString("pt-BR")}. Soma das partes: ${somaDasPartes.toLocaleString("pt-BR")}. Diferença de ${dif.toLocaleString("pt-BR")} (${pct.toFixed(1)}%).`,
      comoCorrigir:
        "Quase sempre é corte de linha na consulta quebrada, que tem muito mais combinações que a consulta do total. Conferir o truncamento antes de procurar erro de soma.",
    },
  ];
}

/**
 * BLOQUEIO POR B.U.
 *
 * `src/lib/bu.ts` é a fonte única: B.U. com `blocked` preenchido tem número
 * impublicável e a tela mostra o motivo, nunca o número. Isso precisa valer em
 * TODA rota. Na auditoria de 08/09/2026 a aba de LP obedecia e a de banner
 * publicava 17 leads da FIIs, ou seja, duas telas do mesmo painel respondiam
 * diferente sobre a mesma B.U.
 */
export function verificarBloqueio(args: { bloqueada: boolean; linhas: number }): Achado[] {
  if (!args.bloqueada || args.linhas === 0) return [];
  return [
    {
      id: "bloqueio-ignorado",
      severidade: "quebra",
      titulo: "B.U. bloqueada publicou número",
      evidencia: `A B.U. está marcada como bloqueada em lib/bu.ts e mesmo assim esta rota devolveu ${args.linhas} linha(s).`,
      comoCorrigir:
        "A rota tem que checar `profile.blocked` ANTES de consultar o GA4 e devolver o motivo com a lista vazia, igual à rota de LP.",
    },
  ];
}

// ═════════════════════════════════════════════════════════════════════════
// NÃO REGRESSÃO
// ═════════════════════════════════════════════════════════════════════════

/**
 * O MÊS FECHADO NÃO MUDA MAIS. É esta função que impede o retrocesso.
 *
 * Setembro de 2026 tem o número que tem. Se a resposta de hoje para setembro
 * difere da de ontem, não foi o GA4 que mudou: foi o painel. É o único teste
 * que pegaria 141 linhas virando 22 na hora em que acontece, sem depender de
 * alguém olhar a tela e estranhar.
 *
 * ⚠️ Por que o mês FECHADO e não os últimos 30 dias: janela móvel muda todo dia
 * por motivo legítimo, então comparar não prova nada. Mês fechado é estável
 * depois de uns dois dias, e qualquer movimento nele é suspeito.
 *
 * QUEDA é mais grave que ALTA, e os dois são reportados. Queda costuma ser
 * perda de linha (truncamento, filtro novo, escopo estreitado). Alta costuma
 * ser contagem em dobro, que é igualmente ruim e passa muito mais despercebida
 * porque "melhorou".
 */
export const TOLERANCIA_PADRAO = 0.02; // 2%

export function compararComBaseline(args: {
  aba: string;
  atual: Assinatura;
  baseline: Assinatura & { gravadoEm: string; periodo: string };
  tolerancia?: number;
}): Achado[] {
  const { aba, atual, baseline } = args;
  const tol = args.tolerancia ?? TOLERANCIA_PADRAO;
  const achados: Achado[] = [];

  const campos: { chave: keyof Assinatura; rotulo: string }[] = [
    { chave: "linhas", rotulo: "linhas na tabela" },
    { chave: "sessoes", rotulo: "sessões" },
    { chave: "conversao", rotulo: "conversão" },
  ];

  for (const { chave, rotulo } of campos) {
    const antes = baseline[chave];
    const agora = atual[chave];
    if (antes <= 0) continue;
    const delta = (agora - antes) / antes;
    if (Math.abs(delta) <= tol) continue;

    const caiu = delta < 0;
    achados.push({
      id: `regressao:${aba}:${chave}`,
      severidade: "quebra",
      titulo: `${rotulo} ${caiu ? "CAIU" : "SUBIU"} num período já fechado`,
      evidencia:
        `Período ${baseline.periodo}, que não muda mais. Baseline de ${baseline.gravadoEm.slice(0, 10)}: ` +
        `${antes.toLocaleString("pt-BR")}. Agora: ${agora.toLocaleString("pt-BR")} ` +
        `(${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%).`,
      comoCorrigir: caiu
        ? "Queda em período fechado é perda de linha. Conferir, nesta ordem: truncamento de consulta, filtro novo que estreitou o escopo, e guarda de plausibilidade descartando mais do que devia."
        : "Alta em período fechado costuma ser contagem em dobro, e passa despercebida porque parece melhora. Conferir junção duplicada e linha repetida lendo o mesmo bucket de evento.",
    });
  }

  return achados;
}

/**
 * O mês fechado mais recente, em YYYY-MM-DD.
 *
 * Usa UTC para não depender do fuso de quem chama: o cron roda num servidor e
 * o navegador do Renan está em outro lugar, e o baseline tem que ser o MESMO
 * período nos dois.
 */
export function mesFechado(hoje = new Date()): { startDate: string; endDate: string; rotulo: string } {
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth(); // 0-11, o mês corrente
  // Dia 0 do mês corrente é o último dia do mês anterior.
  const fim = new Date(Date.UTC(ano, mes, 0));
  const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startDate: iso(inicio),
    endDate: iso(fim),
    rotulo: `${String(fim.getUTCMonth() + 1).padStart(2, "0")}/${fim.getUTCFullYear()}`,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// MONTAGEM
// ═════════════════════════════════════════════════════════════════════════

export function montarContrato(args: {
  aba: string;
  bu: string;
  unidadeDeLead: UnidadeDeLead;
  assinatura: Assinatura;
  achados: Achado[];
}): Contrato {
  const achados = [...args.achados, ...verificarUnidade(args.unidadeDeLead, args.aba)];
  return {
    aba: args.aba,
    bu: args.bu,
    unidadeDeLead: args.unidadeDeLead,
    assinatura: args.assinatura,
    achados,
    aprovado: !achados.some((a) => a.severidade === "quebra"),
  };
}
