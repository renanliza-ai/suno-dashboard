/**
 * src/lib/nai-vendas.ts — VENDAS DA ÁREA LOGADA (NAI), vindas do Zeus.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * A aba de área logada só sabia ler GA4, e o GA4 não tem nem receita nem
 * classificação de pedido. Medido em 27/10/2026: `purchase` dispara ZERO vezes
 * em `investidor.suno.com.br`, porque não existe ambiente de venda lá dentro.
 * A venda nasce na área logada e fecha em `checkout.suno.com.br` ou
 * `carrinho.suno.com.br`. Logo, receita de NAI só existe no Zeus.
 *
 * ⚠️ ESTE MÓDULO NÃO BUSCA DADO SOZINHO AINDA. O Zeus autentica só por fluxo
 * de USUÁRIO (`grant_types_supported` = authorization_code + refresh_token, sem
 * `client_credentials`, verificado em 09/10/2026), e o painel é um servidor.
 * Enquanto não houver credencial, a rota devolve `{ ok: false, motivo }` com o
 * que falta. NUNCA devolve zero: zero com cara de "não vendeu" é pior que erro.
 */

/** As três classificações que o Renan pediu, mais as que aparecem de fato. */
export type ClassificacaoVenda =
  | "Aquisição · Compra"
  | "Renovação · Upgrade"
  | "Renovação · Compra"
  | "Renovação · Renovação"
  | "Outras";

/** Ordem FIXA de exibição e de cor. Cor segue a classificação, nunca o ranking. */
export const CLASSIFICACOES: ClassificacaoVenda[] = [
  "Aquisição · Compra",
  "Renovação · Upgrade",
  "Renovação · Compra",
  "Renovação · Renovação",
  "Outras",
];

export type LinhaDia = {
  dia: string;
  porClassificacao: Record<string, { vendas: number; receita: number }>;
  vendas: number;
  receita: number;
  /** receita ÷ vendas do próprio dia. null quando não houve venda. */
  ticket: number | null;
};

export type LinhaProduto = {
  produto: string;
  vendas: number;
  receita: number;
  ticket: number;
  participacaoReceita: number;
};

export type LinhaProdutoClasse = LinhaProduto & { classificacao: ClassificacaoVenda };

/**
 * O escopo da NAI NÃO é consenso, e o payload declara isso em vez de escolher
 * em silêncio. Medido em 28/10/2026, janela 01 a 26/10:
 *   - arquivo do time ............. 303 pedidos / R$ 112.972,99 (inclui reembolsado)
 *   - carimbo unidade_de_negocio .. 54 pedidos / R$ 30.507,64
 *   - por campanha (este módulo) .. 357 pedidos / R$ 80.409,73 (exclui reembolsado)
 * Nenhuma está errada: são perguntas diferentes. A diferença existe porque o
 * Zeus só carimba `NAI` na campanha AON; a campanha `Upgrade`, que sai dos
 * mesmos placements, vem carimbada como `Suno Research`.
 */
export type DefinicaoDeEscopo = "por_campanha" | "por_carimbo_nai";

export const ESCOPO_PADRAO: DefinicaoDeEscopo = "por_campanha";

/** Campanhas que nascem dentro da área logada. Confirmadas no relatório do time. */
export const CAMPANHAS_DA_NAI = [
  "AON",
  "Upgrade",
  "ModalAutomatizarCarteira",
  "Modal Comunicados B3",
  "Classica.Carteira.Configuracoes.PaywallB3",
  "Assinaturas - B3",
  "RSI.IB326 - Integração B3",
] as const;

/**
 * Status que NÃO contam como venda efetivada. É a mesma lista das métricas
 * oficiais do Zeus. A base mistura português e inglês de propósito (Hotmart
 * legado), então filtrar por uma lista de status POSITIVOS perde linha.
 */
export const STATUS_NAO_EFETIVADO = [
  "Reembolsado",
  "Parcialmente reembolsado",
  "REFUNDED",
  "CHARGEBACK",
  "Cancelado",
  "Cancelado pela operadora de cartão",
  "PROTESTED",
  "Falhou",
] as const;

export type NaiVendasOk = {
  ok: true;
  escopo: DefinicaoDeEscopo;
  periodo: { inicio: string; fim: string };
  totais: { vendas: number; receita: number; ticket: number; receitaRenovacaoPct: number };
  porDia: LinhaDia[];
  porProduto: LinhaProduto[];
  porProdutoEClasse: LinhaProdutoClasse[];
  contrato: ContratoNaiVendas;
};

export type NaiVendasIndisponivel = {
  ok: false;
  motivo: "sem_credencial" | "erro_zeus" | "periodo_invalido";
  /** Texto para a tela. Diz o que falta e quem destrava. */
  explicacao: string;
  /** Passos concretos, para virar tarefa. */
  oQueFalta: string[];
  contrato: ContratoNaiVendas;
};

export type NaiVendas = NaiVendasOk | NaiVendasIndisponivel;

export type ContratoNaiVendas = {
  fonte: string;
  unidade: string;
  ressalvas: string[];
  naoServePara: string[];
};

/** Ressalvas que a tela é obrigada a mostrar junto do número. */
export function contratoNaiVendas(escopo: DefinicaoDeEscopo): ContratoNaiVendas {
  return {
    fonte: "Zeus · dataset Vendas Por Hora",
    unidade: "pedido (venda) e reais",
    ressalvas: [
      "⚠️ O escopo da NAI não é consenso. Existem três respostas para 'quanto a área logada vendeu': o relatório do time (inclui reembolsado), o carimbo `unidade_de_negocio = NAI` do Zeus (só marca a campanha AON) e este recorte por campanha. Escolher uma é decisão de negócio.",
      ...(escopo === "por_carimbo_nai"
        ? [
            "⚠️ O carimbo `NAI` do Zeus está INCOMPLETO: a campanha `Upgrade` sai como `Suno Research` mesmo nascendo na área logada. Medido em 28/10/2026, esse recorte subestima a área logada em cerca de 3,5 vezes.",
          ]
        : []),
      "Venda é `COUNT(DISTINCT pedido_id)`. O grão da tabela do Zeus é ITEM de pedido, e contar linha infla de 2x a 3x desde nov/2025.",
      "Somar a coluna de vendas da tabela por produto NÃO dá o total: pedido com itens de dois produtos conta uma vez em cada. Em out/2026 isso eram 2 pedidos (359 somando produtos contra 357 reais).",
      "Receita exclui reembolso, estorno, cancelado e falha, na contagem e no valor.",
      "Dados são D-1. A tabela do Zeus recarrega inteira às 07h BRT, então reembolso feito depois disso só aparece no dia seguinte.",
      "Esta é a venda que NASCE na área logada e FECHA no checkout aberto. Não existe `purchase` dentro de `investidor.suno.com.br`.",
    ],
    naoServePara: [
      "somar a coluna de vendas da tabela por produto para obter o total",
      "ser comparado com o `purchase` do GA4, que perde 30% das vendas e não tem receita utilizável",
      "fechamento contábil (para isso, Snowflake)",
    ],
  };
}

/**
 * SQL pronto para o dia em que a credencial existir. Fica aqui, e não na rota,
 * porque é regra de negócio: a lista de campanha e a de status são o escopo.
 *
 * ⚠️ O fim do período é INCLUSIVO via `::date`. Usar `BETWEEN` numa coluna com
 * hora corta o último dia às 00:00 e perde o dia inteiro. O próprio Zeus avisa.
 */
export function sqlPorDia(inicio: string, fim: string, escopo: DefinicaoDeEscopo): string {
  const filtroEscopo =
    escopo === "por_carimbo_nai"
      ? `AND unidade_de_negocio = 'NAI'`
      : `AND campanha IN (${CAMPANHAS_DA_NAI.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")})`;
  return `
SELECT
  data_hora_pagamento::date AS dia,
  tipo_entrada || ' · ' || pedido_tipo_desc AS classificacao,
  COUNT(DISTINCT pedido_id) AS vendas,
  ROUND(SUM(preco_final), 2) AS receita
FROM public.vendas_por_hora
WHERE data_hora_pagamento::date BETWEEN '${inicio}' AND '${fim}'
  AND produto_area = 'Research'
  ${filtroEscopo}
  AND pedido_status_pagamento_desc NOT IN (${STATUS_NAO_EFETIVADO.map((s) => `'${s}'`).join(",")})
GROUP BY dia, classificacao
ORDER BY dia`.trim();
}

export function sqlPorProduto(inicio: string, fim: string, escopo: DefinicaoDeEscopo): string {
  return sqlPorDia(inicio, fim, escopo)
    .replace("data_hora_pagamento::date AS dia,", "nome_plano_agrupado AS produto,")
    .replace("GROUP BY dia, classificacao", "GROUP BY nome_plano_agrupado, classificacao")
    .replace("ORDER BY dia", "ORDER BY receita DESC");
}

/** Normaliza o que o Zeus devolve para as 5 classificações da tela. */
export function normalizaClassificacao(bruta: string): ClassificacaoVenda {
  const c = (bruta || "").trim();
  return (CLASSIFICACOES as string[]).includes(c) ? (c as ClassificacaoVenda) : "Outras";
}

/** Monta a visão diária a partir das linhas cruas, sem perder dia sem venda. */
export function montarPorDia(
  linhas: { dia: string; classificacao: string; vendas: number; receita: number }[],
  inicio: string,
  fim: string
): LinhaDia[] {
  const mapa = new Map<string, LinhaDia>();
  for (let d = new Date(inicio + "T00:00:00Z"); d <= new Date(fim + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const dia = d.toISOString().slice(0, 10);
    mapa.set(dia, { dia, porClassificacao: {}, vendas: 0, receita: 0, ticket: null });
  }
  for (const l of linhas) {
    const alvo = mapa.get(l.dia);
    if (!alvo) continue;
    const c = normalizaClassificacao(l.classificacao);
    const atual = alvo.porClassificacao[c] || { vendas: 0, receita: 0 };
    atual.vendas += l.vendas;
    atual.receita += l.receita;
    alvo.porClassificacao[c] = atual;
    alvo.vendas += l.vendas;
    alvo.receita += l.receita;
  }
  for (const linha of mapa.values()) {
    linha.receita = Math.round(linha.receita * 100) / 100;
    linha.ticket = linha.vendas ? Math.round((linha.receita / linha.vendas) * 100) / 100 : null;
  }
  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}
