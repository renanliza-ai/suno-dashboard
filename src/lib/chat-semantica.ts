/**
 * src/lib/chat-semantica.ts — CONTRATO SEMÂNTICO DO CHAT.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O chat abriu para o time inteiro perguntar em linguagem natural. O risco não
 * é o modelo inventar número: a regra 1 do prompt já proíbe isso, e as tools
 * devolvem dado real. O risco é o modelo devolver um número REAL com a leitura
 * ERRADA, que é muito pior, porque parece certo.
 *
 * Os quatro jeitos de errar com dado verdadeiro, todos MEDIDOS nesta casa:
 *
 *   1. UNIDADE. O CRM conta PESSOA, o GA4 conta DISPARO. Medido na
 *      /cl/arsenal-independencia em setembro/2026: 819 disparos, 777 pessoas,
 *      780 leads no Salesforce. Quem compara disparo com CRM vê perda de dado
 *      onde só há unidade diferente.
 *
 *   2. CARDINALIDADE. Quanto mais fina a quebra, menos o GA4 devolve. Mesmo
 *      evento, mesma janela, mesma property: `generate_lead` deu 5.005 sem
 *      quebra, 5.141 por host e 3.528 por página. Somar linha de tabela nunca
 *      reproduz o total.
 *
 *   3. ESCOPO. Sessão é escopo de sessão e sai de `landingPage`. Evento é
 *      escopo de evento e sai de `pagePath`. Dividir um pelo outro produz taxa
 *      que passa de 100%.
 *
 *   4. REGRA DE NEGÓCIO POR B.U. Qual evento É a conversão muda por B.U. e por
 *      objetivo da URL. Cobrar `cta_click` de uma `/cl/` dá fracasso falso.
 *
 * COMO ESTE ARQUIVO RESOLVE
 * Toda tool devolve `{ dado, contrato }` em vez de devolver o dado solto. O
 * contrato viaja JUNTO do número, então o modelo não consegue ler o valor sem
 * ler a ressalva. E `regrasDoContrato()` manda o modelo publicar a ressalva.
 *
 * Isto NÃO é documentação: é payload. Se sair daqui, sai do prompt.
 */

import type { BUProfile } from "@/lib/bu";

/** Unidade de contagem. Misturar duas destas é o erro mais caro da casa. */
export type Unidade = "pessoa" | "sessao" | "evento" | "pagina" | "moeda";

/** Escopo da dimensão que produziu a linha. */
export type Escopo = "landingPage" | "pagePath" | "sessao" | "property" | "nenhum";

export type ContratoDoDado = {
  fonte: string;
  unidade: Unidade;
  escopo: Escopo;
  janela: string;
  /** O que serve de denominador para taxa. null = não há taxa honesta aqui. */
  denominador: string | null;
  /** Ressalvas que a resposta é OBRIGADA a mencionar quando citar o número. */
  ressalvas: string[];
  /** Usos proibidos deste número. O modelo deve recusar se pedirem isso. */
  naoServePara: string[];
};

export type Envelope<T> = { dado: T; contrato: ContratoDoDado };

export function envelope<T>(dado: T, contrato: ContratoDoDado): Envelope<T> {
  return { dado, contrato };
}

// =====================================================================
// RESSALVAS GLOBAIS — fatos medidos que contaminam leitura em QUALQUER tool.
// Entram só quando a janela perguntada realmente toca o período afetado.
// =====================================================================

/** Enxurrada de bot na Research: 22/08/2026 a 29/09/2026. */
const BOT_RESEARCH_INICIO = "2026-08-22";
const BOT_RESEARCH_FIM = "2026-09-29";

function intervalosSeCruzam(aIni: string, aFim: string, bIni: string, bFim: string): boolean {
  return aIni <= bFim && bIni <= aFim;
}

/**
 * Ressalvas que dependem da JANELA e da B.U. Só entram quando se aplicam, para
 * não virar ruído: guardião que grita todo dia deixa de ser lido.
 */
export function ressalvasDaJanela(
  profile: BUProfile,
  startDate: string | null,
  endDate: string | null
): string[] {
  const out: string[] = [];
  if (!startDate || !endDate) return out;

  const ehResearch = profile.key === "research" || profile.key === "asset";
  if (ehResearch && intervalosSeCruzam(startDate, endDate, BOT_RESEARCH_INICIO, BOT_RESEARCH_FIM)) {
    out.push(
      "⚠️ A janela cruza a enxurrada de bot da Research (22/08 a 29/09/2026), com pico de 1.391.764 sessões em 27/09 e engajamento de 2,5% (humano fica entre 60% e 80%). TODA taxa de conversão deste período está DILUÍDA pelo denominador inflado. Variação percentual contra este período não mede melhora de página."
    );
  }
  return out;
}

/** Ressalva universal de cardinalidade, para qualquer tool que quebre por dimensão. */
export const RESSALVA_CARDINALIDADE =
  "Somar as linhas desta tabela NÃO reproduz o total da property: o GA4 devolve menos evento quanto mais fina a quebra (mesmo evento e mesma janela deram 5.005 sem quebra, 5.141 por host e 3.528 por página). Para total, pergunte sem quebra.";

/** Ressalva universal de unidade. */
export const RESSALVA_UNIDADE_EVENTO =
  "Esta contagem é de DISPARO de evento, não de pessoa. O CRM conta pessoa. Comparar os dois direto mostra diferença que é de unidade, não de perda de dado.";

/** Receita do GA4: medida e morta na origem. */
export const RESSALVA_RECEITA_GA4 =
  "⚠️ Receita do GA4 NÃO É UTILIZÁVEL. Medido no dado cru do BigQuery em 16/09 a 05/10/2026: 1.185 purchases, 100% com transaction_id, mas apenas 1 com valor, somando R$ 313,63. O site dispara purchase sem `value`. Receita se lê no Zeus, nunca aqui.";

// =====================================================================
// CONTRATOS POR TIPO DE PERGUNTA
// =====================================================================

/** Descreve, em texto, qual é a regra de conversão desta B.U. */
export function regraDeConversao(profile: BUProfile): string {
  if (profile.conversionModel === "sem_medicao") {
    return `${profile.label} NÃO TEM medição de conversão. Não existe número de lead para esta B.U.`;
  }
  if (profile.mqlEvents) {
    return `${profile.label} não tem checkout. A contagem confiável de lead é a SOMA de ${profile.mqlEvents.qualified} + ${profile.mqlEvents.disqualified}. O generate_lead está duplicado (divisor ${profile.leadDivisor}).`;
  }
  const partes = [`Lead = ${profile.leadEvent}`];
  if (profile.leadDivisor > 1) partes.push(`dividido por ${profile.leadDivisor}`);
  if (profile.ctaEvent) partes.push(`engajamento com CTA = ${profile.ctaEvent}`);
  else partes.push("não existe evento de CTA nesta B.U.");
  if (profile.accountEvent) partes.push(`conta criada = ${profile.accountEvent}`);
  return `${profile.label}: ${partes.join(", ")}.`;
}

export function contratoDeLandingPages(
  profile: BUProfile,
  janela: string,
  startDate: string | null,
  endDate: string | null
): ContratoDoDado {
  const ressalvas = [
    regraDeConversao(profile),
    RESSALVA_CARDINALIDADE,
    "Sessão vem de `landingPage` (escopo de sessão) e evento de conversão vem de `pagePath` (escopo de evento). Quando a pessoa entra por outra página e converte nesta, existe numerador sem denominador, e a taxa fica nula com o motivo declarado em vez de passar de 100%.",
    ...ressalvasDaJanela(profile, startDate, endDate),
  ];
  if (profile.conversaoBloqueada) ressalvas.push(`⚠️ CONVERSÃO SUSPENSA: ${profile.conversaoBloqueada}`);
  if (profile.blocked) ressalvas.push(`⚠️ B.U. BLOQUEADA: ${profile.blocked}`);
  for (const c of profile.caveats) ressalvas.push(c);

  return {
    fonte: "GA4 Data API",
    unidade: "sessao",
    escopo: "landingPage",
    janela,
    denominador: "sessões de ENTRADA na própria landing page",
    ressalvas,
    naoServePara: [
      "somar linhas para obter o total da property (cardinalidade)",
      "comparar direto com a contagem de pessoas do CRM",
      ...(profile.conversaoBloqueada || profile.blocked ? ["citar qualquer número de conversão desta B.U."] : []),
    ],
  };
}

export function contratoDeEventos(janela: string, quebradoPor: string | null): ContratoDoDado {
  return {
    fonte: "GA4 Data API",
    unidade: "evento",
    escopo: quebradoPor ? "pagePath" : "property",
    janela,
    denominador: null,
    ressalvas: [RESSALVA_UNIDADE_EVENTO, ...(quebradoPor ? [RESSALVA_CARDINALIDADE] : [])],
    naoServePara: [
      "ser apresentado como número de PESSOAS",
      ...(quebradoPor ? ["somar as linhas para obter o total"] : []),
    ],
  };
}

export function contratoDeClarity(janela: string): ContratoDoDado {
  return {
    fonte: "Microsoft Clarity Data Export API",
    unidade: "sessao",
    escopo: "pagePath",
    janela,
    denominador: "sessões que o Clarity capturou nesta URL, que NÃO é o mesmo universo do GA4",
    ressalvas: [
      "O Clarity amostra e tem universo próprio. NUNCA some nem compare o número absoluto do Clarity com o do GA4: use o Clarity para o POR QUÊ (rage click, dead click, scroll) e o GA4 para o QUANTO.",
      "A janela útil da Data Export API é de 1 DIA. De 2 dias em diante as páginas de maior volume somem da resposta e sobra a cauda, o que inverte o ranking.",
      "Toda taxa precisa vir com o denominador que a produziu. `sessionsWithMetricPercentage` é calculado sobre as POUCAS sessões que a linha de fricção trouxe, não sobre o pageview da página.",
      "Limite de 10 requisições por projeto por dia. Estourou, a API recusa até o dia seguinte.",
    ],
    naoServePara: [
      "comparar volume absoluto com o GA4",
      "calcular taxa sem declarar o número de ocorrências ao lado",
    ],
  };
}

export function contratoDeMidia(janela: string): ContratoDoDado {
  return {
    fonte: "APIs de mídia (Meta e Google Ads)",
    unidade: "moeda",
    escopo: "nenhum",
    janela,
    denominador: "investimento declarado pela própria plataforma",
    ressalvas: [
      "Conversão reportada pela plataforma de mídia usa janela de atribuição PRÓPRIA e quase nunca bate com o GA4. Não apresente as duas como se fossem a mesma coisa.",
      RESSALVA_RECEITA_GA4,
    ],
    naoServePara: ["calcular ROAS com receita do GA4, que está morta na origem"],
  };
}

// =====================================================================
// REGRAS QUE ENTRAM NO SYSTEM PROMPT
// =====================================================================

/**
 * Regras que o modelo recebe por cima das que já existem no /api/chat.
 * Tudo aqui existe porque um número já saiu errado desta casa.
 */
export function regrasDoContrato(): string {
  return [
    `CONTRATO DO DADO (obrigatório, vale mais que a fluidez da resposta):`,
    ``,
    `8. Toda tool devolve { dado, contrato }. O "contrato" NÃO é texto decorativo:`,
    `   é a condição de uso do número. Leia antes de escrever a resposta.`,
    `9. Se contrato.ressalvas tiver item começando com ⚠️, você é OBRIGADO a`,
    `   mencioná-lo junto do número, na mesma resposta, não no fim como nota solta.`,
    `10. NUNCA apresente um número com unidade diferente da que está em`,
    `    contrato.unidade. "evento" é disparo, não pessoa. Se o usuário pedir`,
    `    pessoas e a unidade for evento, diga qual você tem.`,
    `11. NUNCA calcule taxa dividindo números de contratos com "escopo" diferente`,
    `    (ex.: evento de pagePath sobre sessão de landingPage). Se não houver`,
    `    denominador no contrato, não existe taxa honesta: diga isso.`,
    `12. NUNCA some linhas de uma tabela quebrada por dimensão para dar um total.`,
    `    Para total, chame a ferramenta sem quebra.`,
    `13. Se o pedido do usuário estiver em contrato.naoServePara, RECUSE aquele`,
    `    cálculo específico, explique em uma linha por quê, e ofereça o que dá.`,
    `14. Toda taxa sai acompanhada da BASE que a produziu, entre parênteses.`,
    `    Ex.: "3,2% (142 de 4.438 sessões)". Taxa sem base não é evidência.`,
    `15. Se contrato disser que a B.U. está bloqueada ou com conversão suspensa,`,
    `    NÃO publique número de conversão dela, nem estimado, nem aproximado.`,
    `    Mostre tráfego e inventário, e diga o que falta para destravar.`,
  ].join("\n");
}

/** Texto curto que a UI mostra junto do card salvo, para o leitor humano. */
export function resumoDoContrato(c: ContratoDoDado): string {
  const base = `${c.fonte} · unidade: ${c.unidade} · janela: ${c.janela}`;
  const alertas = c.ressalvas.filter((r) => r.startsWith("⚠️")).length;
  return alertas > 0 ? `${base} · ${alertas} alerta(s)` : base;
}
