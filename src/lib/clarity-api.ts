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
 * 1. `numOfDays` aceita 1, 2 ou 3. Não existe janela maior nem data
 *    arbitrária. Toda leitura é dos últimos 3 dias, no máximo.
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
  | { ok: true; days: number; rows: ClarityPageRow[]; fetchedAt: string }
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
 * Busca as métricas de fricção por URL nos últimos `days` dias (1 a 3).
 *
 * A API devolve um array de métricas, cada uma com um array de linhas já
 * quebrado pela dimensão pedida. Nós transpomos para uma linha por URL, que é
 * o formato que a análise usa.
 */
export async function fetchClarityPages(
  propertyName: string,
  days: 1 | 2 | 3 = 3
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

  for (const m of Array.isArray(raw) ? raw : []) {
    const campo = METRIC_MAP[String(m.metricName || "")];
    if (!campo) continue;
    for (const linha of m.information || []) {
      // A dimensão volta com nome variável entre versões da API.
      const u = String(linha.Url ?? linha.URL ?? linha.url ?? "").trim();
      if (!u) continue;
      const atual = porUrl.get(u) || zero(u);
      // `subTotal` é a contagem da métrica; `sessionsCount` o total de sessões.
      atual[campo] += num(linha.subTotal ?? linha.SubTotal ?? linha.count);
      const s = num(linha.sessionsCount ?? linha.SessionsCount ?? linha.sessionsWithMetricPercentage);
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

  return { ok: true, days, rows, fetchedAt: new Date().toISOString() };
}
