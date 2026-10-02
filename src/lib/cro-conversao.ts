/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FILA DE CRO POR CONVERSÃO: tráfego que entra e não devolve nada
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pedido do Renan em 01/10/2026, nas palavras dele:
 *
 *   "Landing page está tendo muito tráfego e não está tendo conversão. Banner
 *   está tendo muito views e não está tendo clique. Pop-up, a mesma coisa. É
 *   exatamente esse tipo de teste que eu quero acelerar."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE MÓDULO EXISTE, SENDO QUE A ABA DE CRO JÁ TEM SEIS MOTORES
 * ─────────────────────────────────────────────────────────────────────────
 * Porque nenhum deles olha conversão de landing page. Medido em 01/10/2026:
 * `/api/cro/evidence` não tem UMA referência a `/api/lp/performance`. O
 * universo de páginas da aba é o que o Clarity enxergou, e os achados são de
 * FRICÇÃO (dead click, rage click, quickback, erro de script). Nenhum deles
 * responde "esta página recebe tráfego e não converte pelo próprio objetivo".
 *
 * O lado de banner e pop-up JÁ faz o certo em `cro-comunicacao.ts`, que
 * classifica clique sem conversão por precedência de espaço. Este módulo NÃO
 * duplica aquilo. Ele cobre o que falta:
 *
 *   1. landing page com tráfego e sem conversão pelo objetivo declarado
 *   2. landing page no ar que não recebe tráfego (ativo parado)
 *   3. peça com EXIBIÇÃO e sem clique, onde existe par view/click de verdade
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AS GUARDAS NÃO SÃO ZELO, SÃO CICATRIZ
 * ─────────────────────────────────────────────────────────────────────────
 * O critério lido ao pé da letra foi medido na Suno Research em setembro de
 * 2026 e devolveu 6 landing pages. QUATRO estavam erradas:
 *
 *   3 eram páginas APOSENTADAS, que redirecionam para a home e não têm como
 *     converter. Mandar reescrever copy delas é pedir trabalho sobre página
 *     morta.
 *   1 (`/lm/lista-vip-suno`) CONVERTE de verdade: tem 7 disparos de
 *     generate_lead e o Clarity mostra a pessoa chegando em
 *     `/obrigado/?submissionGuid=`. O GA4 é que não atribui a PESSOA. Mandar
 *     "consertar o formulário" seria mandar consertar o que funciona.
 *
 * 67% de falso positivo. Uma aba que erra dois em cada três cards perde a
 * confiança do time na primeira semana, e foi assim que a versão anterior
 * desta aba morreu.
 *
 * Some-se o contraexemplo mais traiçoeiro, medido na Consultoria:
 * `/ebook-como-pagar-menos-imposto/v2` tem 325 sessões e zero lead, passa em
 * TODAS as guardas, e a página-mãe fez 518 leads. É a perna B de um teste em
 * andamento. A aba mandaria otimizar a variação de um experimento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * E A/B NÃO É A SAÍDA PADRÃO
 * ─────────────────────────────────────────────────────────────────────────
 * Dimensionado sobre a população real: de 955 itens, 350 passam do piso de
 * tráfego e apenas 27 fecham um teste de MDE 50% em 30 dias. De 259 peças de
 * banner e pop-up, exatamente UMA é testável. Por isso `decidir` é a saída
 * padrão e `testar` só aparece quando o dimensionamento devolve viável. Card
 * que propõe teste impossível é card que nunca sai do papel.
 */

import type { Achado, Classificacao, Evidencia } from "@/lib/cro-evidence";
import { dimensionarTeste } from "@/lib/cro-evidence";

/** O que a fila precisa saber de uma landing page. Subconjunto de LPPerfRow. */
export type EntradaLP = {
  host: string;
  path: string;
  url: string;
  sessions: number;
  engagementRate: number | null;
  /** PESSOAS. Ver a aba de Landing Pages: é a unidade que fecha com o CRM. */
  leads: number;
  /** Disparos. `leadEvents > 0` com `leads === 0` é atribuição, não formulário. */
  leadEvents: number;
  checkoutStarts: number | null;
  purchases: number | null;
  objective: "captacao" | "venda" | "indefinido";
  objectiveFrom: "url" | "dado" | "nenhum";
  rateCaveat: string | null;
  /** Página de ferramenta do portal, não é landing page. */
  foraDeLP?: boolean;
};

/** Par exibição/clique, só onde ele existe de verdade. */
export type PaginaComExibicao = {
  path: string;
  views: number;
  clicks: number;
  ctr: number | null;
};

export type EstadoDaLP = "no_ar" | "no_ar_com_vazamento" | "aposentada" | "fora" | "indeterminado";

/**
 * PISOS, e cada um tem um porquê medido.
 *
 * 100 sessões em landing page: abaixo disso a conversão zero não distingue
 * página ruim de amostra pequena. Com piso 100 a Research devolveu 10 casos e o
 * Status 4, que é uma fila que um humano olha. Com piso 20 vira 30 casos, e a
 * maior parte do que entra é ruído.
 */
export const PISO_SESSOES_LP = 100;
/** Exibições de peça. Abaixo disso o CTR zero é tão provável quanto qualquer outro. */
export const PISO_EXIBICOES = 500;
/** Uma LP no ar com menos que isto em um mês é ativo parado, não problema de CRO. */
export const TETO_ATIVO_PARADO = 30;

/** `/v2`, `-v2`, `/variante`, `?vwo`: perna de teste, não página para otimizar. */
const PADRAO_DE_VARIACAO = /(\/|-)(v\d+|variante|variacao|teste-[ab]|versao-\d+)(\/|$)/i;

/** A família é o prefixo até o penúltimo segmento. `/cl/x/y` -> `/cl/x`. */
function familiaDe(path: string): string {
  const partes = path.split("/").filter(Boolean);
  if (partes.length <= 1) return "/" + (partes[0] || "");
  return "/" + partes.slice(0, -1).join("/");
}

/** A conversão que ESTA página deve entregar, pelo objetivo dela. */
function conversaoDoObjetivo(lp: EntradaLP): { valor: number; evento: string } | null {
  if (lp.objective === "captacao") return { valor: lp.leads, evento: "generate_lead" };
  if (lp.objective === "venda") return { valor: lp.checkoutStarts ?? 0, evento: "begin_checkout" };
  /**
   * Objetivo indefinido NÃO é cobrado. Medido: 20 landing pages de captação da
   * Research convertem lead e têm zero checkout. Se a fila cobrasse checkout
   * delas, produziria 20 falsos positivos contra 2 achados reais.
   */
  return null;
}

type Contexto = {
  bu: string;
  janela: string;
  /** Estado servido por `/api/lp/estado`, por `host+path` sem barra final. */
  estadoPorLP: Record<string, EstadoDaLP | undefined>;
  /** Dias da janela, para dimensionar o teste. */
  dias: number;
};

const ev = (fonte: Evidencia["fonte"], valor: string, amostra: string, janela: string): Evidencia => ({
  fonte,
  valor,
  amostra,
  janela,
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CASO 1: landing page com tráfego e sem conversão
 * ═══════════════════════════════════════════════════════════════════════
 */
function acharLPsSemConversao(lps: EntradaLP[], ctx: Contexto): Achado[] {
  const achados: Achado[] = [];

  /** Quem converteu, por família. Sustenta a precedência. */
  const converteNaFamilia = new Map<string, number>();
  for (const lp of lps) {
    const c = conversaoDoObjetivo(lp);
    if (!c) continue;
    const f = familiaDe(lp.path);
    converteNaFamilia.set(f, (converteNaFamilia.get(f) || 0) + c.valor);
  }

  for (const lp of lps) {
    // ── Guardas, na ordem em que cada uma foi provada necessária ──────────
    if (lp.foraDeLP) continue; // ferramenta do portal, não é landing page
    if (PADRAO_DE_VARIACAO.test(lp.path)) continue; // perna de teste em andamento
    if (lp.sessions < PISO_SESSOES_LP) continue;

    const estado = ctx.estadoPorLP[`${lp.host}${lp.path.replace(/\/+$/, "")}`.toLowerCase()];
    // Aposentada e fora do ar não são oportunidade de CRO: não há o que otimizar
    // numa página que redireciona. Tirou 3 dos 6 casos na medição.
    if (estado === "aposentada" || estado === "fora") continue;

    const conv = conversaoDoObjetivo(lp);
    if (!conv) continue; // objetivo indefinido não é cobrado
    if (conv.valor > 0) continue; // converte, não é este caso

    const familia = familiaDe(lp.path);
    const familiaConverte = (converteNaFamilia.get(familia) || 0) > 0;

    /**
     * ⚠️ A BIFURCAÇÃO QUE MAIS VALE: a tag está quebrada ou a página é ruim?
     *
     * Confundir as duas manda o time refazer copy quando o problema era a
     * medição, e é o erro que mais rápido queima a credibilidade da aba.
     */
    let classificacao: Classificacao;
    let porque: string;
    let hipotese: string;
    let ondeAtacar: string;
    let proximoPasso: string[];

    if (lp.objective === "captacao" && lp.leadEvents > 0) {
      /**
       * O evento DISPARA mas o GA4 não atribui a pessoa. Caso real medido:
       * `/lm/lista-vip-suno`, 7 disparos e zero pessoa, e o Clarity mostra a
       * chegada em `/obrigado/?submissionGuid=`. O formulário funciona.
       */
      classificacao = "validar_medicao";
      porque =
        `O evento de conversão DISPARA nesta página (${lp.leadEvents} vezes), mas o GA4 não atribui nenhuma ` +
        `PESSOA a ela. Isso não é formulário quebrado, é atribuição: o usuário provavelmente é contado na ` +
        `página de entrada da sessão, não nesta.`;
      hipotese =
        "O formulário capta, e o que falha é a atribuição do usuário à página. Antes de mexer em qualquer " +
        "coisa da página, confirmar no Clarity se há sessão completando o envio e chegando na Thank Page.";
      ondeAtacar = "A medição, não a página.";
      proximoPasso = [
        `Abrir as gravações do Clarity filtrando por esta URL e procurar sessão que chega na Thank Page.`,
        `Conferir no GTM se o generate_lead desta LP envia os mesmos parâmetros das LPs que atribuem certo.`,
        `Só depois de confirmar que a atribuição está errada, abrir tarefa de correção de tag.`,
        `NÃO reescrever copy nem formulário nesta etapa: há ${lp.leadEvents} disparos provando que capta.`,
      ];
    } else if (!familiaConverte) {
      /**
       * A família INTEIRA está zerada. Peça vizinha que converte provaria que a
       * medição daquele prefixo funciona; sem nenhuma, a suspeita é tag.
       */
      classificacao = "validar_medicao";
      porque =
        `Nenhuma página da família ${familia} converteu nesta janela. Quando o prefixo inteiro está zerado, ` +
        `a hipótese mais provável é a medição, não o conteúdo de cada página.`;
      hipotese =
        `O evento ${conv.evento} pode não estar disparando nesta família. Enquanto isso não for descartado, ` +
        `qualquer mudança de página é feita no escuro, porque não há como medir o resultado.`;
      ondeAtacar = "A tag da família inteira, antes de qualquer página individual.";
      proximoPasso = [
        `Abrir uma página de ${familia} com o Tag Assistant e confirmar se ${conv.evento} dispara.`,
        `Comparar com uma família que converte na mesma property, para isolar o que difere.`,
        `Se a tag estiver certa, voltar este card para a fila como problema de página.`,
      ];
    } else {
      /**
       * Irmã do mesmo prefixo converte: a medição daquela família funciona,
       * então o zero é da página. Aqui sim é CRO, e o dimensionamento decide
       * se cabe teste ou se é decisão direta.
       */
      const sessoesPorDia = lp.sessions / Math.max(1, ctx.dias);
      /**
       * ⚠️ Taxa base ZERO quebra a fórmula de amostra. Usa-se a taxa da família
       * como baseline: é a taxa que esta página DEVERIA ter, e é o efeito que
       * se quer detectar.
       */
      const baseFamilia = lps.filter((x) => familiaDe(x.path) === familia && x.sessions > 0);
      const convFamilia = baseFamilia.reduce((s, x) => s + (conversaoDoObjetivo(x)?.valor || 0), 0);
      const sessFamilia = baseFamilia.reduce((s, x) => s + x.sessions, 0);
      const taxaEsperada = sessFamilia > 0 ? (convFamilia / sessFamilia) * 100 : 0;

      /**
       * ⚠️ O EFEITO MÍNIMO É METADE DA TAXA DA FAMÍLIA, e a escolha não é
       * arbitrária.
       *
       * A página converte ZERO, e zero quebra a fórmula de amostra (p=0 anula o
       * numerador). O baseline honesto é a taxa que as irmãs entregam, porque é
       * a taxa que esta página deveria ter. E o efeito que vale a pena detectar
       * é ela chegar a pelo menos METADE do que a família já faz: exigir
       * igualdade seria exigir demais de um teste, e exigir menos produziria um
       * teste longo para um ganho que não muda decisão nenhuma.
       */
      const efeitoMinimoPp = taxaEsperada / 2;
      const teste = taxaEsperada > 0 ? dimensionarTeste(taxaEsperada, efeitoMinimoPp, sessoesPorDia) : null;
      const cabe = Boolean(teste?.viavel);

      classificacao = cabe ? "testar" : "decidir";
      porque =
        `As páginas irmãs de ${familia} convertem (${convFamilia} no total), o que prova que a medição desta ` +
        `família funciona. Logo o zero desta página é da PÁGINA, não da tag. ` +
        (cabe
          ? `E o volume comporta um teste: ${teste!.diasNecessarios} dias para detectar o efeito.`
          : `Mas o volume NÃO comporta teste A/B (${teste ? teste.motivo : "taxa esperada igual a zero"}), ` +
            `então a saída é mudança direta e medição antes/depois.`);
      hipotese =
        `A página recebe ${lp.sessions.toLocaleString("pt-BR")} sessões e entrega zero ${conv.evento}, ` +
        `enquanto a família entrega ${taxaEsperada.toFixed(2).replace(".", ",")}%. ` +
        (lp.engagementRate !== null && lp.engagementRate < 30
          ? `O engajamento de ${lp.engagementRate}% indica que a pessoa sai antes de ver a oferta: o problema está ACIMA da dobra.`
          : `O engajamento de ${lp.engagementRate ?? "n/d"}% indica que a pessoa FICA e mesmo assim não converte: o problema está na oferta ou no formulário, não na atenção.`);
      ondeAtacar =
        lp.engagementRate !== null && lp.engagementRate < 30
          ? "Primeiro viewport: título, promessa e imagem."
          : lp.objective === "captacao"
            ? "O formulário: número de campos, rótulo do botão e o que é prometido em troca."
            : "O bloco de preço e o CTA que leva ao checkout.";
      proximoPasso = cabe
        ? [
            `Rodar A/B na ${ondeAtacar.toLowerCase()}`,
            `Perna A: como está hoje. Perna B: ${lp.objective === "captacao" ? "promessa específica no título e formulário com o mínimo de campos" : "preço e benefício visíveis no primeiro viewport, com CTA único"}.`,
            `Duração mínima: ${teste!.diasNecessarios} dias, ${teste!.amostraPorVariante.toLocaleString("pt-BR")} sessões por variante.`,
            `Promover só com ganho de ${teste!.efeitoMinimoPp.toFixed(2).replace(".", ",")} ponto percentual ou mais.`,
            `Antes de começar, ver as gravações do Clarity desta URL para escolher o que mudar na perna B.`,
          ]
        : [
            `NÃO abrir teste A/B: o volume não fecha no calendário.`,
            `Comparar esta página com a irmã de ${familia} que mais converte e copiar o que difere na ${ondeAtacar.toLowerCase()}`,
            `Aplicar a mudança direto e medir antes/depois, assumindo que é leitura direcional e não prova estatística.`,
            `Se nada mudar em 30 dias, a decisão é aposentar a página e redirecionar o tráfego para a irmã que converte.`,
          ];

      achados.push({
        id: `conv:lp:${lp.host}${lp.path}`,
        superficie: "pagina",
        pagina: lp.url,
        titulo: `Tráfego sem conversão: ${lp.path}`,
        evidencias: [
          ev("GA4", `${lp.sessions.toLocaleString("pt-BR")} sessões, zero ${conv.evento}`, `objetivo ${lp.objective} (${lp.objectiveFrom})`, ctx.janela),
          ev("GA4", `família ${familia} converte a ${taxaEsperada.toFixed(2).replace(".", ",")}%`, `${sessFamilia.toLocaleString("pt-BR")} sessões na família`, ctx.janela),
          ev("GA4", `engajamento ${lp.engagementRate ?? "n/d"}%`, `${lp.sessions.toLocaleString("pt-BR")} sessões`, ctx.janela),
        ],
        hipotese: `${hipotese} ONDE ATACAR: ${ondeAtacar}`,
        classificacao,
        porque,
        proximoPasso,
        prioridade: lp.sessions,
        teste: cabe ? teste : null,
      });
      continue;
    }

    achados.push({
      id: `conv:lp:${lp.host}${lp.path}`,
      superficie: "pagina",
      pagina: lp.url,
      titulo: `Tráfego sem conversão: ${lp.path}`,
      evidencias: [
        ev("GA4", `${lp.sessions.toLocaleString("pt-BR")} sessões, zero ${conv.evento} atribuído`, `objetivo ${lp.objective}`, ctx.janela),
        ev("GA4", `${lp.leadEvents} disparo(s) do evento, ${lp.leads} pessoa(s)`, `${lp.sessions.toLocaleString("pt-BR")} sessões`, ctx.janela),
      ],
      hipotese: `${hipotese} ONDE ATACAR: ${ondeAtacar}`,
      classificacao,
      porque,
      proximoPasso,
      // Validar medição vem antes de otimizar: sem medir, teste nenhum conclui.
      prioridade: lp.sessions * 2,
      teste: null,
    });
  }

  return achados;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CASO 2: landing page no ar que não recebe tráfego
 * ═══════════════════════════════════════════════════════════════════════
 * Pedido explícito do Renan. ⚠️ NÃO é problema de CRO e o card diz isso: uma
 * página que ninguém visita não tem o que otimizar, tem o que distribuir. A
 * saída é mídia ou aposentadoria, nunca teste A/B.
 */
function acharAtivosParados(lps: EntradaLP[], ctx: Contexto): Achado[] {
  const achados: Achado[] = [];
  for (const lp of lps) {
    if (lp.foraDeLP) continue;
    if (PADRAO_DE_VARIACAO.test(lp.path)) continue;
    if (lp.sessions > TETO_ATIVO_PARADO) continue;

    const estado = ctx.estadoPorLP[`${lp.host}${lp.path.replace(/\/+$/, "")}`.toLowerCase()];
    // Só interessa o que está NO AR: aposentada sem tráfego é o esperado.
    if (estado !== "no_ar" && estado !== "no_ar_com_vazamento") continue;

    achados.push({
      id: `conv:parada:${lp.host}${lp.path}`,
      superficie: "pagina",
      pagina: lp.url,
      titulo: `Ativo parado: ${lp.path}`,
      evidencias: [
        ev("GA4", `${lp.sessions} sessão(ões) no período`, `página no ar e respondendo 200`, ctx.janela),
      ],
      hipotese:
        "A página está publicada e funcionando, e quase ninguém chega nela. Não há problema de conversão a " +
        "resolver aqui: há uma decisão de distribuição. ONDE ATACAR: a origem de tráfego, não a página.",
      classificacao: "sem_volume",
      porque:
        "Com este volume, qualquer taxa calculada seria ruído, e nenhum teste conclui. O card existe para a " +
        "decisão ser tomada de propósito, em vez de a página ficar no ar sem ninguém lembrar dela.",
      proximoPasso: [
        "Decidir entre dar mídia para a página ou aposentá-la.",
        "Se a oferta ainda é válida, incluir a URL numa campanha ou num espaço de banner e reavaliar em 30 dias.",
        "Se a oferta não é mais válida, redirecionar para a página que a substitui e tirar do inventário.",
        "NÃO abrir teste A/B: não há volume para concluir nada.",
      ],
      // Fica abaixo dos achados de conversão de propósito: é decisão, não defeito.
      prioridade: 1,
      teste: null,
    });
  }
  return achados;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CASO 3: peça com EXIBIÇÃO e sem clique
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ SÓ ONDE O PAR VIEW/CLICK EXISTE DE VERDADE, e isso é raro. `sessionMedium`
 * conta apenas quem ENTROU clicando, então não há contagem de impressão nesse
 * eixo e CTR por espaço NÃO é calculável. O par existe em dois lugares:
 *
 *   Research e Asset, pop-up .... wisepops_view / wisepops_click
 *   Status, banner .............. ad_impression / ad_click
 *
 * Fora desses dois, "muitos views e nenhum clique" não é mensurável hoje, e o
 * módulo devolve lista vazia em vez de inventar denominador.
 *
 * ⚠️ E o CTR daqui NÃO é confiável: o Wisepops passa de 100% em página de área
 * logada e o Status tem razão de 900 para 1 ainda não validada. Por isso o
 * achado sai como `validar_medicao` quando a razão é impossível, e o card
 * carrega a ressalva.
 */
function acharExibicaoSemClique(
  paginas: PaginaComExibicao[],
  rotuloDoPar: string,
  avisoDoPar: string | null,
  superficie: "banner" | "popup",
  /** O que a própria rota declara sobre o par. Hoje é sempre false. */
  parConfiavel: boolean,
  ctx: Contexto
): Achado[] {
  const candidatas = paginas
    .filter((p) => p.views >= PISO_EXIBICOES)
    .filter((p) => p.clicks === 0 || (p.ctr ?? 0) < 0.5)
    .sort((a, b) => b.views - a.views);

  if (candidatas.length === 0) return [];

  /**
   * ⚠️ PAR NÃO VALIDADO VIRA UM CARD SÓ, NÃO UM POR PÁGINA.
   *
   * A primeira versão deste módulo emitiu 93 cards de "exibição sem clique" no
   * Status, cada um mandando mexer na posição e na criativa. Errado por dois
   * motivos, e os dois medidos:
   *
   *   1. O CTR desta fonte NÃO é confiável, e quem diz isso é a própria casa:
   *      `ctrTrustworthy` é false, o Wisepops passa de 100% em página de área
   *      logada e o Status tem razão de 900 para 1 ainda não validada. Mandar
   *      93 vezes "a peça é ruim" com base num número que ninguém validou é
   *      instrução errada em cima de dado que nem se sabe se está certo.
   *   2. A maior delas tinha CTR de 0,14% em 616 mil exibições, que é NORMAL
   *      para inventário programático. O card chamaria de defeito o que pode
   *      ser o comportamento esperado do formato.
   *
   * Enquanto o par não for validado, o achado honesto é UM: validar o par. As
   * páginas de maior volume entram como evidência, não como 93 tarefas.
   */
  if (!parConfiavel) {
    const totalViews = candidatas.reduce((s, p) => s + p.views, 0);
    const totalClicks = candidatas.reduce((s, p) => s + p.clicks, 0);
    const top = candidatas.slice(0, 5);
    return [
      {
        id: `conv:exib:${superficie}:par-nao-validado`,
        superficie,
        pagina: top[0].path,
        titulo: `Validar o par exibição/clique de ${rotuloDoPar} antes de cobrar criativa`,
        evidencias: [
          ev("GA4", `${candidatas.length} páginas com exibição alta e clique quase zero`, `${totalViews.toLocaleString("pt-BR")} exibições, ${totalClicks.toLocaleString("pt-BR")} cliques`, ctx.janela),
          ...top.map((p) =>
            ev("GA4", `${p.path}: ${p.views.toLocaleString("pt-BR")} exib., ${p.clicks.toLocaleString("pt-BR")} cliques (${p.ctr === null ? "n/d" : p.ctr.toFixed(2).replace(".", ",") + "%"})`, "por página", ctx.janela)
          ),
        ],
        hipotese:
          `Há volume de exibição com quase nenhum clique, mas o par ${rotuloDoPar} ainda não foi validado nesta B.U., ` +
          `então não dá para saber se o CTR baixo é a peça ou o jeito como a exibição é contada. ` +
          `ONDE ATACAR: o disparo da exibição, antes de qualquer conclusão sobre criativa.`,
        classificacao: "validar_medicao",
        porque:
          (avisoDoPar ? avisoDoPar + " " : "") +
          `Enquanto isso não for resolvido, qualquer card por página seria uma recomendação sobre criativa ` +
          `apoiada num denominador não validado. Por isso este é UM achado, e não ${candidatas.length}.`,
        proximoPasso: [
          `Conferir no GTM como ${rotuloDoPar} dispara exibição: a tag conta peça VISTA ou carga de slot?`,
          `Comparar a contagem de exibição com uma fonte externa (o próprio Wisepops ou o ad server) numa página de volume alto.`,
          `Se a exibição contar carga de slot, trocar para disparo por visibilidade antes de usar o número.`,
          `Depois de validado, este card se desdobra em um por página e aí sim cabe falar de posição e criativa.`,
        ],
        prioridade: totalViews,
        teste: null,
      },
    ];
  }

  const achados: Achado[] = [];
  for (const p of candidatas) {

    const razaoImpossivel = p.ctr !== null && p.ctr > 100;
    const zeroAbsoluto = p.clicks === 0;

    achados.push({
      id: `conv:exib:${superficie}:${p.path}`,
      superficie,
      pagina: p.path,
      titulo: razaoImpossivel
        ? `Razão impossível em ${rotuloDoPar}: ${p.path}`
        : `Exibição sem clique em ${rotuloDoPar}: ${p.path}`,
      evidencias: [
        ev("GA4", `${p.views.toLocaleString("pt-BR")} exibições, ${p.clicks.toLocaleString("pt-BR")} clique(s)`, `${rotuloDoPar}`, ctx.janela),
        ev("GA4", p.ctr === null ? "CTR não calculável" : `CTR ${p.ctr.toFixed(2).replace(".", ",")}%`, `${p.views.toLocaleString("pt-BR")} exibições`, ctx.janela),
      ],
      hipotese: razaoImpossivel
        ? "A razão entre clique e exibição passa de 100%, o que é impossível. Antes de qualquer conclusão " +
          "sobre a peça, o disparo precisa ser validado. ONDE ATACAR: a tag, não a criativa."
        : `A peça aparece ${p.views.toLocaleString("pt-BR")} vezes nesta página e ` +
          (zeroAbsoluto ? "ninguém clica" : `quase ninguém clica (${p.ctr?.toFixed(2).replace(".", ",")}%)`) +
          ". Ou ela aparece onde ninguém olha, ou a promessa não interessa a quem está nesta página. " +
          "ONDE ATACAR: primeiro a POSIÇÃO e o MOMENTO do disparo, depois a criativa.",
      classificacao: razaoImpossivel ? "validar_medicao" : zeroAbsoluto ? "investigar" : "decidir",
      porque: razaoImpossivel
        ? `${avisoDoPar || "O par exibição/clique desta B.U. ainda não foi validado."} Com razão acima de 100% o defeito de disparo está confirmado.`
        : `${avisoDoPar ? avisoDoPar + " " : ""}Exibição sem clique é o único sinal de banner e pop-up que NÃO depende de conversão a jusante, ` +
          `então é o mais direto que existe para esta superfície. Mas o CTR desta fonte ainda não foi validado, ` +
          `e por isso a saída é investigar, não testar.`,
      proximoPasso: razaoImpossivel
        ? [
            `Conferir no GTM como ${rotuloDoPar} dispara exibição e clique nesta página.`,
            `Suspeita mais comum: a exibição conta recarga de slot em vez de peça vista.`,
            `Não tirar conclusão sobre a criativa enquanto a razão não fizer sentido.`,
          ]
        : [
            `Ver no Clarity o mapa de calor desta página e confirmar se a peça está na área vista.`,
            `Checar o momento do disparo: pop-up que abre antes da pessoa ler a página é fechado por reflexo.`,
            `Se a posição estiver certa, trocar a promessa da peça pela que já funciona em outro espaço da mesma B.U.`,
            `NÃO abrir A/B de criativa: com este volume o teste não fecha no calendário.`,
          ],
      prioridade: p.views,
      teste: null,
    });
  }
  return achados;
}

/**
 * Quais LPs precisam de verificação de estado no servidor.
 *
 * ⚠️ Existe para a tela NÃO verificar o inventário inteiro. Verificar estado é
 * uma batida HTTP contra o WordPress por página, e na Research são 171. Só os
 * CANDIDATOS precisam: quem tem tráfego e não converte (para saber se está
 * aposentada) e quem quase não tem tráfego (para saber se está no ar). O resto
 * nunca vira card, então verificar seria gastar tempo do Renan à toa.
 */
export function candidatosParaEstado(lps: EntradaLP[]): { host: string; path: string }[] {
  const saida: { host: string; path: string }[] = [];
  for (const lp of lps) {
    if (lp.foraDeLP) continue;
    if (PADRAO_DE_VARIACAO.test(lp.path)) continue;
    const semTrafego = lp.sessions <= TETO_ATIVO_PARADO;
    const conv = conversaoDoObjetivo(lp);
    const semConversao = lp.sessions >= PISO_SESSOES_LP && conv !== null && conv.valor === 0;
    if (semTrafego || semConversao) saida.push({ host: lp.host, path: lp.path });
  }
  return saida;
}

/**
 * Monta a fila inteira. Ordenada por prioridade, que é volume ponderado pela
 * classe: validar medição vem antes de otimizar, porque sem medir nenhum teste
 * conclui.
 */
export function montarFilaDeConversao(args: {
  lps: EntradaLP[];
  exibicoes: { paginas: PaginaComExibicao[]; rotulo: string; aviso: string | null; superficie: "banner" | "popup"; confiavel: boolean } | null;
  contexto: Contexto;
}): Achado[] {
  const { lps, exibicoes, contexto } = args;
  const todos = [
    ...acharLPsSemConversao(lps, contexto),
    ...acharAtivosParados(lps, contexto),
    ...(exibicoes
      ? acharExibicaoSemClique(exibicoes.paginas, exibicoes.rotulo, exibicoes.aviso, exibicoes.superficie, exibicoes.confiavel, contexto)
      : []),
  ];
  return todos.sort((a, b) => b.prioridade - a.prioridade);
}
