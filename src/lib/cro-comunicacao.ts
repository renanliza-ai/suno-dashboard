import { dimensionarTeste, type Achado } from "@/lib/cro-evidence";

/**
 * src/lib/cro-comunicacao.ts — hipóteses de teste para BANNER e POP-UP.
 *
 * Separado de `cro-evidence.ts` porque a evidência vem de outro lugar: banner e
 * pop-up vivem em `sessionMedium`, não em URL, então o Clarity por página não
 * os alcança e tudo aqui é GA4.
 *
 * @forma-observada: /api/comunicacao/spaces?propertyId=309049674&kind=todos,
 * chamado em 15/09/2026 para 01-14/09. 158 linhas, campos conferidos na
 * resposta crua: space, rawMediums[], kind, bannerName, named, sessions,
 * engagedSessions, engagementRate, leads, leadsSource, accounts,
 * checkoutStarts, ctaClicksAll, purchases, sharePct, pecasNoEspaco.
 * `sessions` é o CLIQUE (a sessão entrou pelo espaço), não impressão.
 *
 * ⚠️ A DESCOBERTA QUE MOLDOU ESTAS REGRAS
 *
 * Dimensionei A/B sobre os volumes REAIS do Status Invest e o resultado mata a
 * proposta óbvia. Para a peça de maior volume do grupo (pop-up integração-b3,
 * 30.968 cliques em 14 dias, 0,19% de compra):
 *
 *   detectar ganho de  20%  ->  190 dias
 *   detectar ganho de  50%  ->   31 dias
 *   detectar ganho de 100%  ->    8 dias
 *
 * E num banner de 1.916 cliques, detectar 20% pediria mais de 999 dias.
 *
 * Ou seja: **A/B clássico de criativo de banner não cabe no calendário da
 * Suno.** Só efeito grande é detectável. Propor "testar o CTA do banner" sem
 * dizer isso produz exatamente a proposta que nunca sai do papel, que era o
 * defeito da aba antiga.
 *
 * O que sobra é melhor: a maior parte das perguntas de banner JÁ FOI RESPONDIDA
 * por experimento natural. Duas peças rodaram no mesmo espaço, para o mesmo
 * público, e o dado está na mesa. Isso é o controle que um A/B tenta construir,
 * só que de graça e já concluído.
 */

/** Uma linha de `/api/comunicacao/spaces`, já reduzida ao que as regras usam. */
export type PecaComunicacao = {
  espaco: string;
  peca: string;
  nomeada: boolean;
  /** Sessões que entraram pelo espaço. É o clique, nunca impressão. */
  cliques: number;
  /** Conversão PRINCIPAL desta B.U., já resolvida por quem chama. */
  conversoes: number;
  /** Nome do evento da conversão principal, para aparecer na evidência. */
  eventoConversao: string;
  /** Soma de TODOS os sinais de conversão medidos, usada só para detectar zero absoluto. */
  sinaisTotais: number;
};

/**
 * Piso de cliques para uma peça entrar em qualquer regra.
 *
 * 800 e não 1.000: com 1.000 o corte no Status deixava 28 peças de 158, e
 * perdia `bannerfino` e `_SNCA7F72338_` inteiros, que são justamente casos de
 * zero absoluto que interessam. Com 800 ficam 32 e nenhum espaço some.
 */
export const PISO_CLIQUES = 800;

/**
 * Efeito mínimo que vale testar num criativo: dobrar.
 *
 * Não é ambição, é o limite do volume. A conta no cabeçalho mostra que abaixo
 * disso o teste não fecha em prazo útil nem na peça de maior tráfego do grupo.
 */
const MDE_RELATIVO = 1.0;

/**
 * Quão abaixo a peça pior precisa estar para o experimento natural valer.
 * 35% da taxa da melhor: diferença de 3x não se explica por ruído de amostra
 * nestes volumes, diferença de 30% se explica.
 */
const FRACAO_PERDEDORA = 0.35;

const taxa = (x: PecaComunicacao) => (x.cliques > 0 ? (x.conversoes / x.cliques) * 100 : 0);
const br = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number) => n.toFixed(2).replace(".", ",");

export function classificarComunicacao(
  pecas: PecaComunicacao[],
  superficie: "banner" | "popup",
  janela: string,
  dias: number
): { achados: Achado[]; semVolume: PecaComunicacao[] } {
  const achados: Achado[] = [];
  const semVolume = pecas.filter((x) => x.cliques < PISO_CLIQUES);
  const comVolume = pecas.filter((x) => x.cliques >= PISO_CLIQUES);
  const rotulo = superficie === "banner" ? "banner" : "pop-up";
  const chaveDe = (x: PecaComunicacao) => `${x.espaco} · ${x.peca}`;

  const porEspaco = new Map<string, PecaComunicacao[]>();
  for (const x of comVolume) {
    const arr = porEspaco.get(x.espaco) || [];
    arr.push(x);
    porEspaco.set(x.espaco, arr);
  }

  const jaCoberto = new Set<string>();

  // ================================================================
  // Regra 1 · EXPERIMENTO NATURAL: peças concorrentes no MESMO espaço
  //
  // Tem PRECEDÊNCIA sobre a regra 2 de propósito. Uma peça que converte no
  // espaço PROVA que a medição daquele espaço funciona, então a peça vizinha
  // zerada é peça ruim, não medição quebrada. Essa é exatamente a diferença
  // entre "troque a peça" e "vá conferir a tag", e ela sai do dado.
  // ================================================================
  for (const [espaco, lista] of porEspaco) {
    if (lista.length < 2) continue;
    const ord = [...lista].sort((a, b) => taxa(b) - taxa(a));
    const melhor = ord[0];
    // A melhor precisa ter convertido de verdade, senão é ruído contra ruído.
    if (melhor.conversoes < 3) continue;

    const corte = taxa(melhor) * FRACAO_PERDEDORA;
    for (const pior of ord.slice(1)) {
      if (taxa(pior) > corte) continue;
      jaCoberto.add(chaveDe(pior));
      achados.push({
        id: `comp:${superficie}:${espaco}:${pior.peca}`,
        superficie,
        pagina: chaveDe(pior),
        titulo: "Duas peças no mesmo espaço, uma converte e a outra não",
        evidencias: [
          {
            fonte: "GA4",
            valor: `${melhor.peca}: ${br(melhor.conversoes)} ${melhor.eventoConversao} em ${br(melhor.cliques)} cliques (${pct(taxa(melhor))}%)`,
            amostra: `espaço ${espaco}`,
            janela,
          },
          {
            fonte: "GA4",
            valor: `${pior.peca}: ${br(pior.conversoes)} ${pior.eventoConversao} em ${br(pior.cliques)} cliques (${pct(taxa(pior))}%)`,
            amostra: `espaço ${espaco}`,
            janela,
          },
        ],
        hipotese:
          "O problema é a PEÇA, não o espaço. As duas rodaram no mesmo lugar, para o mesmo público, e só uma converteu.",
        classificacao: "decidir",
        porque:
          "Isto não é hipótese a testar, é experimento que já rodou. As duas peças dividiram o mesmo espaço e o mesmo público, que é o controle que um A/B tenta construir. E como a peça vizinha converte, a medição do espaço está de pé: o resultado é da peça. Montar teste para reconfirmar gastaria semanas para chegar onde o dado já está.",
        proximoPasso: [
          `Tirar ${pior.peca} do ar em ${espaco}`,
          `Subir ${melhor.peca} ou uma variação dela no lugar`,
          "Conferir na janela seguinte se a taxa do espaço subiu",
        ],
        prioridade: 90 + Math.min(Math.round(pior.cliques / 100), 40),
        teste: null,
      });
    }
  }

  // ================================================================
  // Regra 2 · ESPAÇO INTEIRO zerado, com volume
  //
  // Só entra quando NENHUMA peça do espaço registrou sinal nenhum. Aí não
  // existe prova de que a medição funciona ali, e trocar o criativo antes de
  // conferir a tag pode jogar fora peça que funciona.
  // Caso real que motivou o recorte, 01-14/09 no Status: banner.leadmagnet.home
  // tem 2 peças, 1.637 e 1.083 cliques, ZERO em tudo nas duas. É espaço de lead
  // magnet numa property que registrou 1 generate_lead em 127 mil sessões.
  // ================================================================
  for (const [espaco, lista] of porEspaco) {
    const espacoZerado = lista.every((x) => x.sinaisTotais === 0);
    if (!espacoZerado) continue;
    for (const x of lista) {
      if (jaCoberto.has(chaveDe(x))) continue;
      jaCoberto.add(chaveDe(x));
      achados.push({
        id: `zero:${superficie}:${espaco}:${x.peca}`,
        superficie,
        pagina: chaveDe(x),
        titulo: "Espaço inteiro com tráfego e nenhuma conversão de nenhum tipo",
        evidencias: [
          {
            fonte: "GA4",
            valor: `${br(x.cliques)} cliques, 0 lead, 0 conta criada, 0 checkout, 0 compra`,
            amostra: `espaço ${espaco}, ${lista.length} ${lista.length === 1 ? "peça" : "peças"} e todas zeradas`,
            janela,
          },
        ],
        hipotese:
          "Ou o destino não entrega o que a peça promete, ou o evento de conversão do destino não está sendo medido.",
        classificacao: "validar_medicao",
        porque:
          "Zero ABSOLUTO com esse volume é suspeito antes de ser ruim. Peça fraca converte pouco, não zero em quatro eventos diferentes. E aqui NENHUMA peça do espaço registrou sinal, então não existe nada que prove que a medição funciona neste espaço. Enquanto isso não for conferido, qualquer teste mediria a falha em vez da mudança.",
        proximoPasso: [
          "Abrir o destino da peça e conferir no Tag Assistant se o evento de conversão dispara",
          "Se dispara, o problema é a oferta e aí sim vale trocar a peça",
          "Se não dispara, é medição e a correção é no tagueamento, não no criativo",
        ],
        prioridade: 120 + Math.min(Math.round(x.cliques / 100), 40),
        teste: null,
      });
    }
  }

  // ================================================================
  // Regra 3 · candidato a TESTE, só se o efeito detectável couber
  // ================================================================
  for (const x of comVolume) {
    if (jaCoberto.has(chaveDe(x))) continue;
    const base = taxa(x);
    if (base <= 0) continue;

    const porDia = dias > 0 ? Math.round(x.cliques / dias) : 0;
    const dim = dimensionarTeste(base, base * MDE_RELATIVO, porDia);
    if (!dim.viavel) continue;

    achados.push({
      id: `teste:${superficie}:${x.espaco}:${x.peca}`,
      superficie,
      pagina: chaveDe(x),
      titulo: `Peça com volume para um teste que fecha em ${dim.diasNecessarios} dias`,
      evidencias: [
        {
          fonte: "GA4",
          valor: `${br(x.conversoes)} ${x.eventoConversao} em ${br(x.cliques)} cliques (${pct(base)}%)`,
          amostra: `espaço ${x.espaco}, ${br(porDia)} cliques por dia`,
          janela,
        },
      ],
      hipotese: `Uma variante com oferta ou promessa diferente DOBRA a conversão desta peça, de ${pct(base)}% para ${pct(base * 2)}%.`,
      classificacao: "testar",
      porque:
        `A hipótese fala em DOBRAR, e isso não é ambição: é o limite do volume. Com ${br(porDia)} cliques por dia, detectar ganho de 20% neste ${rotulo} levaria mais de meio ano, e de 50% passaria de um mês. Só efeito grande fecha em prazo útil, então o teste tem que ser de OFERTA, não de cor de botão.`,
      proximoPasso: [
        "Criar a variante mudando a OFERTA ou a promessa, não o layout",
        `Rodar ${dim.diasNecessarios} dias, ${br(dim.amostraPorVariante)} cliques por variante`,
        "Promover só se a conversão dobrar. Ganho menor que isso o teste não distingue de ruído.",
      ],
      prioridade: 30 + Math.min(Math.round(x.cliques / 200), 30),
      teste: dim,
    });
  }

  achados.sort((a, b) => b.prioridade - a.prioridade);
  return { achados, semVolume: semVolume.sort((a, b) => b.cliques - a.cliques) };
}
