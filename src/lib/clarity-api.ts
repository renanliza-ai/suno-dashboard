import { resolveBU, type BUKey } from "@/lib/bu";

/**
 * src/lib/clarity-api.ts — cliente da Data Export API do Microsoft Clarity.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Até 15/09/2026 o painel só sabia montar LINK para o Clarity (lib/clarity.ts).
 * Nenhuma tela lia dado de fricção. A aba de CRO preenchia esse vazio com
 * frases inventadas ("Scrollmap mostra que 70% param antes do botão") e com
 * Web Vitals calculados a partir da taxa de rejeição. Este cliente troca a
 * ficção por medição.
 *
 * ⚠️ TRÊS LIMITES DA API QUE MOLDAM TODO O DESENHO
 *
 * 1. `numOfDays`: a documentação da Data Export API diz 1 a 3. MAS um teste
 *    de 01/09/2026 pelo MCP devolveu 15 dias (287.120 sessões) e 30 dias
 *    (575.097), o que contradiz a documentação. Como os dois caminhos podem
 *    bater em back-ends diferentes, aqui o valor é PASSADO ADIANTE e o que a
 *    API responder manda. Se ela recusar, o erro sobe com o status, em vez de
 *    a gente presumir um limite que talvez não exista.
 * 2. **10 requisições por projeto por dia.** Estourou, a API recusa até o dia
 *    seguinte. Por isso a rota que consome isto faz UMA chamada por B.U. e
 *    cacheia com folga.
 * 3. O token é POR PROJETO, gerado em Settings > Data Export no Clarity. Não
 *    existe token de conta que leia todos.
 *
 * Sem token configurado a função devolve `{ ok: false, reason: "sem_token" }`
 * e a tela mostra o que falta. Nunca devolve número inventado.
 */

/** Variável de ambiente esperada por B.U. O token NÃO tem fallback no código. */
const TOKEN_ENV_BY_BU: Partial<Record<BUKey, string>> = {
  research: "CLARITY_TOKEN_RESEARCH",
  asset: "CLARITY_TOKEN_RESEARCH", // Asset compartilha o projeto da Research
  status: "CLARITY_TOKEN_STATUS",
  consultoria: "CLARITY_TOKEN_CONSULTORIA",
  funds: "CLARITY_TOKEN_FUNDS",
};

export type ClarityPageRow = {
  url: string;
  /** Pageviews (a API chama de Traffic / totalSessionCount por dimensão). */
  pageViews: number;
  sessions: number;
  rageClicks: number;
  deadClicks: number;
  excessiveScrolls: number;
  quickbacks: number;
  scriptErrors: number;
  errorClicks: number;
  /** Taxas em %, calculadas sobre pageViews. null quando não há denominador. */
  rageRate: number | null;
  deadRate: number | null;
  quickbackRate: number | null;
};

export type ClarityFetchResult =
  | { ok: true; days: number; rows: ClarityPageRow[]; fetchedAt: string; amostraCrua: unknown[] }
  | { ok: false; reason: "sem_token"; envVar: string | null; bu: BUKey }
  | { ok: false; reason: "sem_suporte"; bu: BUKey }
  | { ok: false; reason: "erro_api"; status: number; detail: string; bu: BUKey };

/** Resposta crua da API: lista de métricas, cada uma com suas linhas. */
type RawMetric = {
  metricName?: string;
  information?: Array<Record<string, string | number | undefined>>;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Nomes de métrica que a API devolve. Mapeados explicitamente: se a Microsoft
 * incluir uma métrica nova, ela é IGNORADA em vez de virar campo desconhecido.
 * E se renomear uma existente, o campo vem zero e o defeito aparece na tela
 * como ausência, não como número errado.
 */
const METRIC_MAP: Record<string, keyof Omit<ClarityPageRow, "url" | "rageRate" | "deadRate" | "quickbackRate">> = {
  Traffic: "pageViews",
  RageClickCount: "rageClicks",
  DeadClickCount: "deadClicks",
  ExcessiveScroll: "excessiveScrolls",
  QuickbackClick: "quickbacks",
  ScriptErrorCount: "scriptErrors",
  ErrorClickCount: "errorClicks",
};

export function clarityTokenEnvFor(propertyName: string): string | null {
  return TOKEN_ENV_BY_BU[resolveBU(propertyName).key] || null;
}

/**
 * Busca as métricas de fricção por URL nos últimos `days` dias.
 *
 * A API devolve um array de métricas, cada uma com um array de linhas já
 * quebrado pela dimensão pedida. Nós transpomos para uma linha por URL, que é
 * o formato que a análise usa.
 */
export async function fetchClarityPages(
  propertyName: string,
  days: number = 3
): Promise<ClarityFetchResult> {
  const bu = resolveBU(propertyName).key;
  const envVar = TOKEN_ENV_BY_BU[bu] || null;

  if (!envVar) {
    return { ok: false, reason: "sem_suporte", bu };
  }

  const token = process.env[envVar];
  if (!token) {
    return { ok: false, reason: "sem_token", envVar, bu };
  }

  const url =
    `https://www.clarity.ms/export-data/api/v1/project-live-insights` +
    `?numOfDays=${days}&dimension1=URL`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: "erro_api", status: 0, detail: (e as Error).message, bu };
  }

  if (!resp.ok) {
    const txt = (await resp.text().catch(() => "")).slice(0, 300);
    return { ok: false, reason: "erro_api", status: resp.status, detail: txt, bu };
  }

  let raw: RawMetric[];
  try {
    raw = (await resp.json()) as RawMetric[];
  } catch (e) {
    return { ok: false, reason: "erro_api", status: resp.status, detail: `JSON inválido: ${(e as Error).message}`, bu };
  }

  // Transpõe métrica -> URL para URL -> métricas.
  const porUrl = new Map<string, ClarityPageRow>();
  const zero = (u: string): ClarityPageRow => ({
    url: u,
    pageViews: 0, sessions: 0, rageClicks: 0, deadClicks: 0,
    excessiveScrolls: 0, quickbacks: 0, scriptErrors: 0, errorClicks: 0,
    rageRate: null, deadRate: null, quickbackRate: null,
  });

  /**
   * ⚠️ A CONTAGEM VEM EM CAMPO DIFERENTE POR MÉTRICA.
   *
   * `Traffic` traz o volume em `totalSessionCount`; as métricas de fricção
   * (RageClickCount, DeadClickCount e companhia) trazem em `subTotal`, com
   * `sessionsCount` do lado dizendo em quantas sessões aquilo aconteceu.
   *
   * Ler `subTotal` para tudo, que foi a primeira versão deste arquivo, zera o
   * `pageViews` de todas as linhas. E `pageViews` é o denominador de toda taxa
   * e o piso de volume: zerado, nenhuma página passa do piso e a aba fica vazia
   * sem erro nenhum. Defeito silencioso da pior espécie.
   */
  for (const m of Array.isArray(raw) ? raw : []) {
    const nome = String(m.metricName || "");
    const campo = METRIC_MAP[nome];
    if (!campo) continue;
    for (const linha of m.information || []) {
      // A dimensão volta sob o próprio nome dela, e a grafia varia por versão.
      const u = String(linha.Url ?? linha.URL ?? linha.url ?? "").trim();
      if (!u) continue;
      const atual = porUrl.get(u) || zero(u);

      const volume =
        nome === "Traffic"
          ? num(linha.totalSessionCount ?? linha.TotalSessionCount ?? linha.subTotal)
          : num(linha.subTotal ?? linha.SubTotal ?? linha.count ?? linha.totalSessionCount);

      atual[campo] += volume;

      const s = num(linha.sessionsCount ?? linha.SessionsCount ?? linha.totalSessionCount);
      if (s > atual.sessions) atual.sessions = s;
      porUrl.set(u, atual);
    }
  }

  const rows = Array.from(porUrl.values()).map((r) => {
    const base = r.pageViews > 0 ? r.pageViews : null;
    return {
      ...r,
      rageRate: base ? Number(((r.rageClicks / base) * 100).toFixed(2)) : null,
      deadRate: base ? Number(((r.deadClicks / base) * 100).toFixed(2)) : null,
      quickbackRate: base ? Number(((r.quickbacks / base) * 100).toFixed(2)) : null,
    };
  });

  rows.sort((a, b) => b.pageViews - a.pageViews);

  /**
   * GUARDA DE ZERO SILENCIOSO.
   *
   * Nasceu de um defeito real: a primeira versão deste parser leu `subTotal`
   * para todas as métricas, mas `Traffic` traz o volume em `totalSessionCount`.
   * Resultado: `pageViews` saía ZERO em toda linha. Como `pageViews` é o
   * denominador de toda taxa E o piso de volume, a aba ficava vazia sem
   * devolver erro nenhum. Quem abrisse concluiria "não há achado".
   *
   * A regra geral, que vale para qualquer cliente de API externa deste projeto:
   * receber linhas e todas com denominador zero NÃO é um resultado, é um
   * defeito de leitura. Resultado vazio é `rows.length === 0`. Linha existindo
   * com denominador zero em 100% dos casos significa que o campo mudou de nome
   * ou nunca foi o que eu supus.
   *
   * Falhar alto aqui custa uma mensagem de erro. Falhar baixo custa uma
   * decisão de negócio tomada em cima de uma tela vazia.
   */
  if (rows.length > 0 && rows.every((r) => r.pageViews === 0)) {
    const camposVistos = Array.from(
      new Set((Array.isArray(raw) ? raw : []).flatMap((m) => Object.keys((m.information || [])[0] || {})))
    );
    return {
      ok: false,
      reason: "erro_api",
      status: 200,
      detail:
        `O Clarity devolveu ${rows.length} linhas e TODAS com pageViews zero. ` +
        `Isso é defeito de leitura, não ausência de tráfego: o campo de contagem mudou de nome. ` +
        `Campos presentes na resposta: ${camposVistos.join(", ") || "nenhum"}.`,
      bu,
    };
  }

  /**
   * Amostra crua da resposta, para conferir a FORMA em vez de supor.
   * A primeira versão deste parser supôs o nome do campo de contagem e errou,
   * zerando o denominador de toda taxa sem devolver erro. Com a amostra na mão
   * o mesmo engano vira uma conferência de dez segundos.
   */
  const amostraCrua = (Array.isArray(raw) ? raw : []).slice(0, 3).map((m) => ({
    metricName: m.metricName,
    campos: Object.keys((m.information || [])[0] || {}),
    primeiraLinha: (m.information || [])[0],
  }));

  return { ok: true, days, rows, fetchedAt: new Date().toISOString(), amostraCrua };
}
