import type { Achado } from "@/lib/cro-evidence";
import type { ConteudoLP } from "@/lib/lp-conteudo";

/**
 * src/lib/cro-conteudo.ts — a fricção medida encontra o elemento da página.
 *
 * ⚠️ A REGRA QUE DEFINE ESTE ARQUIVO: NENHUM ACHADO NASCE SÓ DA PÁGINA.
 *
 * Toda hipótese aqui exige as DUAS metades:
 *   1. uma fricção MEDIDA (Clarity ou GA4), que prova que existe problema; e
 *   2. um fato CONTADO na página, que diz qual é o problema.
 *
 * Isso é a diferença entre esta aba e as ferramentas de diagnóstico por IA que
 * leem a página e opinam. Elas produzem lista longa e plausível sobre páginas
 * que talvez não tenham problema nenhum, porque não olham comportamento. Nós
 * tínhamos o defeito espelhado: media a fricção e parava em "investigue",
 * porque não sabia o que havia na tela.
 *
 * Página sozinha não vira achado. Se a LP não tem prova social mas converte
 * bem, não há o que corrigir, e o painel fica calado.
 *
 * E o que NÃO veio da referência, de propósito: nota de 0 a 100 e impacto
 * "Alto/Médio" por julgamento. A prioridade continua saindo de volume medido.
 */

export type FriccaoMedida = {
  url: string;
  pageViews: number;
  deadRate: number | null;
  rageRate: number | null;
  quickbackRate: number | null;
  /** Conversão medida no GA4 para esta página, na janela. */
  conversoes: number;
  /** "lead" para captação, "checkout" para venda. Define o que cobrar da página. */
  objetivo: "captacao" | "venda" | "indefinido";
};

const br = (n: number) => n.toLocaleString("pt-BR");
const vg = (n: number) => String(n).replace(".", ",");

export function cruzarConteudoComFriccao(
  f: FriccaoMedida,
  c: ConteudoLP,
  janela: string
): Achado[] {
  const achados: Achado[] = [];

  // Leitura não confiável não gera achado NENHUM. Uma LP montada por JS
  // devolve zero em tudo, e "esta página não tem preço" seria falso.
  if (c.erro || !c.leituraConfiavel) return achados;

  const amostra = `${br(f.pageViews)} pageviews`;
  const taxaConv = f.pageViews > 0 ? (f.conversoes / f.pageViews) * 100 : 0;

  // ================================================================
  // 1. Dead click com elemento falso-clicável na página
  //    A fricção diz QUANTO, a página diz O QUÊ. É o caso que motivou tudo.
  // ================================================================
  if (f.deadRate !== null && f.deadRate >= 8 && (c.falsosClicaveis > 0 || c.linksVazios > 0)) {
    const lista = c.amostraFalsosClicaveis.slice(0, 3).join(" · ");
    achados.push({
      id: `conteudo:dead:${f.url}`,
      superficie: "pagina",
      pagina: f.url,
      titulo: "Dead click com elemento sem resposta identificado na página",
      evidencias: [
        { fonte: "Clarity", valor: `dead click em ${vg(f.deadRate)}% dos pageviews`, amostra, janela },
        {
          fonte: "Página",
          valor:
            (c.falsosClicaveis > 0 ? `${c.falsosClicaveis} elemento(s) com classe de botão sem link nem ação` : "") +
            (c.falsosClicaveis > 0 && c.linksVazios > 0 ? " e " : "") +
            (c.linksVazios > 0 ? `${c.linksVazios} link(s) com href="#"` : ""),
          amostra: lista ? `classes: ${lista}` : "lidos do HTML servido",
          janela: "leitura de hoje",
        },
      ],
      hipotese:
        "As pessoas estão clicando em algo que parece botão e não é. A página tem elemento com aparência de clicável sem nenhuma ação associada.",
      classificacao: "corrigir",
      porque:
        "Aqui não há o que testar: a medição mostra o clique acontecendo e a leitura da página mostra o elemento que não responde. Tornar o elemento clicável, ou tirar dele a aparência de botão, é correção direta.",
      proximoPasso: [
        "Abrir o heatmap desta URL no Clarity e confirmar em qual dos elementos a concentração bate",
        "Dar ação ao elemento OU remover a aparência de botão",
        "Conferir o dead click na janela seguinte",
      ],
      prioridade: 95 + Math.round(f.deadRate),
      teste: null,
    });
  }

  // ================================================================
  // 2. Quickback com promessa não reafirmada no topo
  // ================================================================
  if (f.quickbackRate !== null && f.quickbackRate >= 20 && c.h1.length === 0) {
    achados.push({
      id: `conteudo:quickback:${f.url}`,
      superficie: "pagina",
      pagina: f.url,
      titulo: "Abre e volta, e a página não tem título de abertura",
      evidencias: [
        { fonte: "Clarity", valor: `quickback em ${vg(f.quickbackRate)}% dos pageviews`, amostra, janela },
        { fonte: "Página", valor: "nenhum H1 no HTML", amostra: `${br(c.palavras)} palavras no total`, janela: "leitura de hoje" },
      ],
      hipotese:
        "Quem chega não encontra, no primeiro instante, a mesma promessa que trouxe o clique, porque a página não abre com um título que a reafirme.",
      classificacao: "testar",
      porque:
        "A fricção está medida e a lacuna na página é concreta e barata de corrigir. Como mexer no primeiro viewport é mudança de conteúdo, e não defeito, entra como teste.",
      proximoPasso: [
        "Escrever um H1 que repita a promessa do anúncio ou do banner de origem",
        "Rodar contra a versão atual e medir queda do quickback, não só conversão",
      ],
      prioridade: 45 + Math.round(f.quickbackRate),
      teste: null,
    });
  }

  // ================================================================
  // 3. Página de VENDA sem preço na tela
  // ================================================================
  if (f.objetivo === "venda" && !c.precoVisivel && f.pageViews >= 1000 && taxaConv < 1) {
    achados.push({
      id: `conteudo:preco:${f.url}`,
      superficie: "pagina",
      pagina: f.url,
      titulo: "Página de venda sem preço visível no conteúdo",
      evidencias: [
        { fonte: "GA4", valor: `${br(f.conversoes)} chegadas ao checkout (${vg(Number(taxaConv.toFixed(2)))}%)`, amostra, janela },
        { fonte: "Página", valor: "nenhuma menção de valor em R$ no HTML", amostra: `${c.botoes} botões, ${c.ctasParaCheckout} levando ao checkout`, janela: "leitura de hoje" },
      ],
      hipotese:
        "A pessoa precisa sair da página para descobrir quanto custa, e parte dela desiste nesse salto em vez de avançar.",
      classificacao: "testar",
      porque:
        "A conversão baixa está medida e a ausência do preço é fato contado no HTML, não impressão. Mostrar preço é mudança de conteúdo com efeito conhecido nos dois sentidos, então é teste e não correção: em oferta cara, esconder o preço às vezes é decisão deliberada.",
      proximoPasso: [
        "Confirmar com o time se omitir o preço foi escolha ou esquecimento",
        "Se foi esquecimento, incluir e medir",
        "Se foi escolha, testar a versão com preço contra a atual",
      ],
      prioridade: 55,
      teste: null,
    });
  }

  // ================================================================
  // 4. Objeção não respondida em página de venda com tráfego
  // ================================================================
  if (f.objetivo === "venda" && !c.temGarantia && !c.temDepoimento && f.pageViews >= 1000 && taxaConv < 1) {
    achados.push({
      id: `conteudo:prova:${f.url}`,
      superficie: "pagina",
      pagina: f.url,
      titulo: "Página de venda sem prova social nem garantia",
      evidencias: [
        { fonte: "GA4", valor: `${br(f.conversoes)} chegadas ao checkout (${vg(Number(taxaConv.toFixed(2)))}%)`, amostra, janela },
        { fonte: "Página", valor: "nenhum depoimento e nenhuma menção a garantia ou reembolso", amostra: `${br(c.palavras)} palavras`, janela: "leitura de hoje" },
      ],
      hipotese:
        "A objeção de risco não está respondida na página: quem está em dúvida não encontra nem prova de que outros compraram, nem garantia de que pode voltar atrás.",
      classificacao: "testar",
      porque:
        "As outras LPs de venda da casa trazem os dois, então a ausência aqui é exceção e não padrão. Mas o efeito depende do quanto o preço pesa nesta oferta, e isso só o teste responde.",
      proximoPasso: [
        "Incluir bloco de garantia com a regra real de reembolso",
        "Incluir depoimento de assinante, com nome e contexto",
        "Testar contra a versão atual",
      ],
      prioridade: 40,
      teste: null,
    });
  }

  // ================================================================
  // 5. Formulário longo em página de captação que converte pouco
  // ================================================================
  if (f.objetivo === "captacao" && c.camposDeFormulario >= 5 && f.pageViews >= 1000 && taxaConv < 5) {
    achados.push({
      id: `conteudo:form:${f.url}`,
      superficie: "pagina",
      pagina: f.url,
      titulo: `Formulário de ${c.camposDeFormulario} campos numa página que converte ${vg(Number(taxaConv.toFixed(2)))}%`,
      evidencias: [
        { fonte: "GA4", valor: `${br(f.conversoes)} leads (${vg(Number(taxaConv.toFixed(2)))}%)`, amostra, janela },
        { fonte: "Página", valor: `${c.camposDeFormulario} campos em ${c.formularios} formulário(s)`, amostra: "contados no HTML", janela: "leitura de hoje" },
      ],
      hipotese: `Reduzir o formulário aos campos que o time realmente usa aumenta o número de leads, mesmo que cada lead venha com menos informação.`,
      classificacao: "testar",
      porque:
        "Campo a mais custa lead, e campo a menos custa qualificação. Os dois lados são reais, então a decisão é de teste, não de opinião. E antes de testar vale perguntar quais campos alguém de fato usa: às vezes a resposta já resolve.",
      proximoPasso: [
        "Perguntar ao time comercial quais campos são usados na abordagem",
        "Montar a variante só com os usados",
        "Medir lead E qualificação do lead, não só o volume",
      ],
      prioridade: 50,
      teste: null,
    });
  }

  return achados;
}
