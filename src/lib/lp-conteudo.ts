/**
 * src/lib/lp-conteudo.ts — o que existe DENTRO da página, em fatos contáveis.
 *
 * Nasceu em 21/09/2026 para fechar a lacuna da aba de CRO: o Clarity dizia
 * "15% de dead click nesta URL" e a aba não conseguia dizer EM QUÊ. Fricção sem
 * objeto vira "investigue", e proposta que começa em "investigue" não sai do
 * papel. Com a leitura da página, o mesmo achado passa a apontar o elemento.
 *
 * ⚠️ ESTE MÓDULO NÃO DÁ NOTA, NÃO PONTUA E NÃO OPINA.
 *
 * A referência que originou a ideia (ferramenta do CRO Brasil, vídeo do canal
 * Métricas Boss de 16/09/2026) devolve um "Score de Conversão de 0 a 100" e
 * classifica impacto em Alto/Médio por julgamento de IA. Isso aqui fica de
 * fora, de propósito: é a mesma família de número que este painel já removeu
 * três vezes (o ICE que saía de hash do nome da property, o "ROAS 4.2x", o
 * "+15-25%" de lift da CAPI). Nota agregada vira meta antes do fim do mês e
 * ninguém consegue dizer de onde veio.
 *
 * O que sai daqui é CONTAGEM do que está no HTML. Quem cruza isso com a fricção
 * medida e vira hipótese é `cro-conteudo.ts`, e lá a prioridade continua vindo
 * de volume real e de teste que cabe no calendário.
 *
 * @forma-observada: HTML real de 21/09/2026.
 *   lp.suno.com.br/asset/snel11/ ......... 89 KB, 1 form, 9 botões, 1 h1, 0 iframe
 *   www.suno.com.br/nossas-assinaturas/ .. 19 KB, 0 form, 0 botão, 1 IFRAME
 * A segunda é a armadilha que define este módulo: a LP de verdade mora dentro
 * do iframe, em `data-src` (carregamento adiado), e o conteúdo real tem 336 KB,
 * 5 botões e 14 menções de preço. Ler o shell e reportar "esta LP não tem CTA"
 * seria conclusão errada com cara de medição.
 */

export type ConteudoLP = {
  url: string;
  urlAnalisada: string;
  seguiuIframe: boolean;
  bytes: number;
  erro: string | null;

  titulo: string | null;
  h1: string[];
  h2: number;
  palavras: number;

  formularios: number;
  camposDeFormulario: number;
  botoes: number;
  ctasParaCheckout: number;
  textosDeCta: string[];
  precoVisivel: boolean;
  mencoesDePreco: number;

  imagens: number;
  imagensSemAlt: number;
  videos: number;

  temGarantia: boolean;
  temDepoimento: boolean;

  /**
   * A página é montada por JavaScript e o HTML estático não tem o conteúdo.
   *
   * ⚠️ Medido em 21/09/2026: www.suno.com.br/nossas-assinaturas/ segue para um
   * bundle de 329 KB que devolve 9 palavras, nenhum h1 e nenhum preço, porque
   * o runtime do bundler monta tudo no navegador. A própria lojinha mostra 14
   * menções de preço na tela.
   *
   * Sem esta bandeira o módulo reportaria "LP sem título, sem preço e sem CTA"
   * para uma página que tem os três. Conclusão errada com cara de medição é
   * exatamente o que este arquivo promete não produzir, então quando isto vier
   * `true` a tela mostra o aviso e NÃO usa as contagens.
   */
  renderizadoPorJs: boolean;
  /** As contagens acima valem? Falso quando a leitura estática não alcança. */
  leituraConfiavel: boolean;

  /**
   * Elementos com CARA de botão que não respondem a clique: div ou span com
   * classe de botão, sem href, sem onclick e sem role. É o candidato direto a
   * explicar dead click, e é o cruzamento que justifica este módulo existir.
   */
  falsosClicaveis: number;
  amostraFalsosClicaveis: string[];
  linksVazios: number;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const conta = (html: string, re: RegExp) => (html.match(re) || []).length;

/** Texto sem script, style nem tag, para contar palavra de leitura. */
function textoVisivel(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function buscar(url: string, timeoutMs = 25000): Promise<{ html: string; erro: string | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Cache-buster: neste WordPress a URL limpa serve versão antiga e já mordeu
    // este projeto várias vezes. Param que NÃO começa com utm_, senão cai na
    // mesma entrada de cache.
    const comBuster = url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now();
    const res = await fetch(comBuster, {
      redirect: "follow",
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(t);
    if (!res.ok) return { html: "", erro: `HTTP ${res.status}` };
    return { html: await res.text(), erro: null };
  } catch (e) {
    clearTimeout(t);
    const nome = (e as Error).name;
    return { html: "", erro: nome === "AbortError" ? "timeout" : String((e as Error).message || e) };
  }
}

/** src ou data-src: o shell da Suno adia o carregamento do iframe. */
function acharIframeDaLP(html: string, base: string): string | null {
  const tags = html.match(/<iframe[^>]*>/gi) || [];
  for (const tag of tags) {
    const m = tag.match(/(?:data-src|src)\s*=\s*"([^"]+)"/i);
    if (!m) continue;
    const src = m[1];
    // Ignora incorporação de terceiro: vídeo, mapa, widget.
    if (/youtube|youtu\.be|vimeo|google\.com\/maps|gstatic|doubleclick|facebook/i.test(src)) continue;
    try {
      return new URL(src, base).toString();
    } catch {
      continue;
    }
  }
  return null;
}

export async function lerConteudo(url: string): Promise<ConteudoLP> {
  const vazio: ConteudoLP = {
    url, urlAnalisada: url, seguiuIframe: false, bytes: 0, erro: null,
    titulo: null, h1: [], h2: 0, palavras: 0,
    formularios: 0, camposDeFormulario: 0, botoes: 0, ctasParaCheckout: 0,
    textosDeCta: [], precoVisivel: false, mencoesDePreco: 0,
    imagens: 0, imagensSemAlt: 0, videos: 0,
    temGarantia: false, temDepoimento: false,
    renderizadoPorJs: false, leituraConfiavel: false,
    falsosClicaveis: 0, amostraFalsosClicaveis: [], linksVazios: 0,
  };

  const primeira = await buscar(url);
  if (primeira.erro) return { ...vazio, erro: primeira.erro };

  let html = primeira.html;
  let urlAnalisada = url;
  let seguiuIframe = false;

  // Se o corpo é fino e aponta para um iframe próprio, a LP está lá dentro.
  const alvo = acharIframeDaLP(html, url);
  if (alvo && conta(html, /<button|<form/gi) < 3) {
    const dentro = await buscar(alvo);
    if (!dentro.erro && dentro.html.length > html.length) {
      html = dentro.html;
      urlAnalisada = alvo;
      seguiuIframe = true;
    }
  }

  const texto = textoVisivel(html);
  const palavras = texto ? texto.split(" ").length : 0;
  /**
   * HTML pesado com quase nenhuma palavra = conteudo montado em runtime.
   * Calibrado no caso real: 329 KB devolvendo 9 palavras. Uma LP de verdade
   * desse tamanho tem entre 900 e 1.800 palavras (snel11 918, arsenal 1.775).
   */
  const renderizadoPorJs = html.length > 50_000 && palavras < 100;

  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [])
    .map((t) => textoVisivel(t).slice(0, 160))
    .filter(Boolean);

  const titulo = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || null;

  // CTA: texto de botão e de link. Serve para a tela mostrar o que a página
  // realmente oferece, em vez de "existem 9 botões".
  const textosDeCta = Array.from(
    new Set(
      (html.match(/<(?:button|a)[^>]*>([\s\S]{0,120}?)<\/(?:button|a)>/gi) || [])
        .map((t) => textoVisivel(t).trim())
        .filter((t) => t.length > 2 && t.length < 60)
    )
  ).slice(0, 25);

  /**
   * Falso clicável: div ou span com classe de botão, sem href, sem onclick e
   * sem role. É a explicação candidata para dead click.
   */
  const falsos = (html.match(/<(?:div|span)[^>]*class="[^"]*\b(?:btn|button|cta)\b[^"]*"[^>]*>/gi) || [])
    .filter((t) => !/href=|onclick=|role\s*=\s*"button"/i.test(t));

  return {
    url,
    urlAnalisada,
    seguiuIframe,
    bytes: html.length,
    erro: null,
    titulo,
    h1,
    h2: conta(html, /<h2[\s>]/gi),
    palavras,
    renderizadoPorJs,
    leituraConfiavel: !renderizadoPorJs,
    formularios: conta(html, /<form[\s>]/gi),
    camposDeFormulario: conta(html, /<input[^>]*type="(?:text|email|tel|number)"/gi) + conta(html, /<select[\s>]/gi),
    botoes: conta(html, /<button[\s>]/gi),
    ctasParaCheckout: conta(html, /href="[^"]*checkout\.(?:suno|statusinvest)\.com\.br/gi),
    textosDeCta,
    precoVisivel: /R\$\s?\d/.test(texto),
    mencoesDePreco: conta(texto, /R\$\s?\d/g),
    imagens: conta(html, /<img[\s>]/gi),
    imagensSemAlt: (html.match(/<img[^>]*>/gi) || []).filter((t) => !/alt\s*=\s*"[^"]+"/i.test(t)).length,
    videos: conta(html, /<video[\s>]/gi) + conta(html, /youtube\.com\/embed|player\.vimeo/gi),
    temGarantia: /garantia|reembolso|devolu[çc][ãa]o do dinheiro|7 dias|30 dias/i.test(texto),
    temDepoimento: /depoimento|o que dizem|clientes? dizem?|avalia[çc][õo]es|★|⭐/i.test(texto),
    falsosClicaveis: falsos.length,
    amostraFalsosClicaveis: falsos.slice(0, 5).map((t) => {
      const c = t.match(/class="([^"]{0,90})"/i);
      return c ? c[1] : t.slice(0, 80);
    }),
    linksVazios: conta(html, /<a[^>]*href="#"/gi),
  };
}
