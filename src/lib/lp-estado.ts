/**
 * src/lib/lp-estado.ts — a LP ainda está no ar e apta a receber tráfego?
 *
 * Existe porque o GA4 é HISTÓRICO: uma LP aposentada hoje continua aparecendo
 * com o tráfego que teve antes do 301, e o painel a mostrava como se ainda
 * fosse alvo de trabalho. Higienizar exige perguntar ao SERVIDOR, não ao GA4.
 *
 * @forma-observada: 210 LPs de Suno Research verificadas em 15/09/2026, nas
 * duas grafias (com e sem barra final). Contagens abaixo são dessa medição.
 *
 * ⚠️ AS DUAS ARMADILHAS QUE ESTA REGRA EXISTE PARA NÃO CAIR
 *
 * 1. "301 significa aposentada" está ERRADO neste site. TODA LP viva responde
 *    301, porque o WP só acrescenta a barra final:
 *      /asset/snel11  ->  301  ->  /asset/snel11/  ->  200
 *    Classificar 301 como aposentada apagaria as 210 de uma vez, inclusive as
 *    que respondem por 162 mil sessões.
 *
 * 2. "Terminou no mesmo host, então está viva" também está ERRADO:
 *      /ebook-como-analisar-uma-acao/  ->  ...  ->  /nossas-assinaturas/  200
 *    Redirecionar uma LP para outra página aposenta a LP do mesmo jeito. Só
 *    descobri isso comparando o TÍTULO servido, não o código HTTP.
 *
 * Daí a regra ser mais dura do que parece necessário: NO AR é responder 200 no
 * PRÓPRIO caminho. Qualquer outro destino, mesmo host incluído, é aposentada.
 */

export type EstadoLP =
  | "no_ar"
  | "no_ar_com_vazamento"
  | "aposentada"
  | "fora"
  | "indeterminado";

export type ResultadoEstado = {
  host: string;
  path: string;
  estado: EstadoLP;
  /** Código HTTP do destino final da URL canônica (com barra). */
  status: number | null;
  /** Onde a URL canônica foi parar. */
  destino: string | null;
  /** Para quem tem vazamento: onde a versão SEM barra foi parar. */
  destinoSemBarra: string | null;
  erro: string | null;
  verificadoEm: number;
};

const UA =
  "Mozilla/5.0 (compatible; SunoDashboardHealthCheck/1.0; +https://suno-dashboard-painel.vercel.app)";
const TIMEOUT_MS = 20000;

/** Host + caminho sem barra final, em minúsculas. É a identidade da página. */
export function chaveDeUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

type Batida = { status: number | null; final: string | null; erro: string | null };

async function bater(url: string, tentativa = 0): Promise<Batida> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    clearTimeout(t);
    return { status: res.status, final: res.url || url, erro: null };
  } catch (e) {
    clearTimeout(t);
    // Uma segunda tentativa porque `fetch failed` apareceu em URLs que o curl
    // abriu sem problema no mesmo minuto: erro de rede em lote não é estado da
    // página, e classificar por ele removeria LP viva.
    if (tentativa < 1) return bater(url, tentativa + 1);
    const nome = (e as Error).name;
    return {
      status: null,
      final: null,
      erro: nome === "AbortError" ? "timeout" : String((e as Error).message || e),
    };
  }
}

export async function verificarEstado(host: string, path: string): Promise<ResultadoEstado> {
  const semBarra = `https://${host}${path.replace(/\/+$/, "")}`;
  const comBarra = semBarra + "/";
  const origem = chaveDeUrl(comBarra);

  const base = {
    host,
    path,
    status: null as number | null,
    destino: null as string | null,
    destinoSemBarra: null as string | null,
    erro: null as string | null,
    verificadoEm: Date.now(),
  };

  const canonico = await bater(comBarra);
  base.status = canonico.status;
  base.destino = canonico.final;
  base.erro = canonico.erro;

  if (canonico.erro || canonico.status === null) {
    return { ...base, estado: "indeterminado" };
  }
  if (canonico.status === 404 || canonico.status === 410) {
    return { ...base, estado: "fora" };
  }
  // 5xx e 403 ficam INDETERMINADOS de propósito. Neste site caminho frio já
  // devolveu 524 depois de 125s, e página inexistente devolve 500 em vez de
  // 404: nenhum dos dois prova que a LP saiu do ar.
  if (canonico.status >= 500 || canonico.status === 403) {
    return { ...base, estado: "indeterminado" };
  }
  if (canonico.status < 200 || canonico.status >= 300) {
    return { ...base, estado: "indeterminado" };
  }

  if (chaveDeUrl(canonico.final || "") !== origem) {
    return { ...base, estado: "aposentada" };
  }

  // A canônica está viva. Falta saber se quem chega SEM a barra final também
  // chega na LP, ou se um 301 incompleto joga essa pessoa em outro lugar.
  const alternativo = await bater(semBarra);
  base.destinoSemBarra = alternativo.final;
  const vazou =
    !alternativo.erro &&
    alternativo.status !== null &&
    alternativo.status >= 200 &&
    alternativo.status < 300 &&
    chaveDeUrl(alternativo.final || "") !== origem;

  return { ...base, estado: vazou ? "no_ar_com_vazamento" : "no_ar" };
}

/** Só estas duas recebem tráfego de verdade hoje. */
export function aptaParaTrafego(e: EstadoLP): boolean {
  return e === "no_ar" || e === "no_ar_com_vazamento";
}

export const ROTULO_ESTADO: Record<EstadoLP, string> = {
  no_ar: "No ar",
  no_ar_com_vazamento: "No ar, com vazamento",
  aposentada: "Aposentada (redireciona)",
  fora: "Fora do ar (404)",
  indeterminado: "Não verificada",
};

export const EXPLICACAO_ESTADO: Record<EstadoLP, string> = {
  no_ar: "Responde 200 no próprio endereço. Está apta a receber tráfego.",
  no_ar_com_vazamento:
    "A LP está no ar, mas quem chega no endereço SEM a barra final é redirecionado para fora. Metade do tráfego antigo não chega na página. Ou o 301 de aposentadoria ficou incompleto, ou foi aplicado por engano.",
  aposentada:
    "O endereço redireciona para outra página. Continua no relatório do GA4 porque o tráfego é anterior ao redirecionamento, mas não recebe mais nada.",
  fora: "O servidor responde 404. O endereço não existe mais.",
  indeterminado:
    "Não foi possível decidir: o servidor respondeu erro, demorou demais ou recusou a checagem. Fica de fora da higienização de propósito, para não remover LP viva por falha de rede.",
};
