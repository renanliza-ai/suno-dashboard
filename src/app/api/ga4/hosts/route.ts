import { runReport } from "@/lib/ga4-server";
import { resolveBU, type BUProfile } from "@/lib/bu";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/hosts — QUAIS HOSTS A PROPERTY REALMENTE TEM, e o que a casa declara.
 *
 * Nasceu em 06/10/2026, de um defeito que o Renan achou mandando uma URL:
 * `lp.fundsexplorer.com.br/parceriasunofiisfunds/`. O painel declarava o host
 * da Funds Explorer como `lps.fundsexplorer.com.br`, com S. A aba lia 4 sessões,
 * concluía "não há dado de landing page confiável" e mostrava tela vazia, com
 * um texto convincente explicando uma ausência que não existia.
 *
 * ⚠️ A CAUSA RAIZ NÃO É O TYPO, É A LISTA SER ESCRITA À MÃO. `lpHosts` em
 * bu.ts foi preenchido por suposição, e suposição sobre a forma de um dado
 * externo é a família de erro mais cara deste projeto. Host errado não falha:
 * ele devolve zero com cara de resposta legítima.
 *
 * Esta rota inverte a direção: em vez de o painel AFIRMAR onde estão as LPs,
 * ele PERGUNTA ao GA4 quais hosts existem e confronta com o que está declarado.
 * É o conserto e, rodando no contrato diário, é a guarda para não repetir.
 *
 * Query params:
 *   propertyId   (obrigatório)
 *   propertyName (obrigatório) — sem ele não há com o que confrontar
 *   days         (default 30) ou startDate/endDate
 */

/** Padrões de caminho que a casa usa em landing page. Ver a regra em bu.ts. */
const PADRAO_DE_LP =
  /^\/(cl|lm|pv|ao|asset|lan)\/|^\/(ebook|minicurso|planilha|whatsapp|lista-vip|combo|planos|integracao|especial|parceria)/i;

/** Sinais no NOME do host. Fraco sozinho, forte junto do caminho. */
const NOME_DE_HOST_DE_LP = /^(lp|lps|lp\d+|landing|materiais|conteudo)\./i;

type HostMedido = {
  host: string;
  sessoes: number;
  usuarios: number;
  /** Caminhos de maior volume servidos por este host, para julgar com dado. */
  amostraDeCaminhos: string[];
  /** Quantos dos caminhos amostrados casam com o padrão de LP da casa. */
  caminhosComCaraDeLP: number;
  declarado: boolean;
  /** Veredicto do conjunto: nome do host + formato dos caminhos + volume. */
  pareceLP: boolean;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const propertyName = sp.get("propertyName");
  const days = Number(sp.get("days") || 30);
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!propertyName) {
    return NextResponse.json(
      {
        error: "propertyName_required",
        detalhe:
          "Sem propertyName não há com o que confrontar: esta rota existe para comparar o que o GA4 TEM " +
          "com o que a casa DECLARA, e a declaração vem da B.U.",
      },
      { status: 400 }
    );
  }

  const profile: BUProfile = resolveBU(propertyName);
  const dateRange =
    startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? { startDate, endDate }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  /**
   * Duas consultas. A primeira dá o universo de hosts; a segunda dá os caminhos
   * por host, que é o que permite julgar se um host serve LANDING PAGE ou é
   * portal. Nome de host sozinho não decide: `lp.` pode ser qualquer coisa e
   * um host sem prefixo pode servir LP.
   */
  const [hostsRes, caminhosRes] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 500,
    }),
    runReport(propertyId, {
      dateRanges: [dateRange],
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 20000,
    }),
  ]);

  if (hostsRes.error) {
    return NextResponse.json(
      { propertyId, bu: profile.key, erro: hostsRes.error, range: dateRange },
      { status: 200 }
    );
  }

  /** host -> caminhos de maior volume. */
  const caminhosPorHost = new Map<string, string[]>();
  for (const r of caminhosRes.data?.rows || []) {
    const h = (r.dimensionValues?.[0]?.value || "").toLowerCase();
    const p = r.dimensionValues?.[1]?.value || "";
    if (!h || !p) continue;
    const lista = caminhosPorHost.get(h) || [];
    if (lista.length < 12) lista.push(p);
    caminhosPorHost.set(h, lista);
  }

  const declarados = profile.lpHosts.map((h) => h.toLowerCase());
  const hosts: HostMedido[] = (hostsRes.data?.rows || [])
    .map((r) => {
      const host = (r.dimensionValues?.[0]?.value || "").toLowerCase();
      const amostra = caminhosPorHost.get(host) || [];
      const comCara = amostra.filter((p) => PADRAO_DE_LP.test(p)).length;
      const sessoes = Number(r.metricValues?.[0]?.value || 0);
      return {
        host,
        sessoes,
        usuarios: Number(r.metricValues?.[1]?.value || 0),
        amostraDeCaminhos: amostra,
        caminhosComCaraDeLP: comCara,
        declarado: declarados.includes(host),
        /**
         * Veredicto conservador: precisa de volume E de evidência de formato.
         * Nome de host de LP com caminho de LP fecha; nome sozinho não, porque
         * `lps.` já apontou para host morto nesta casa.
         */
        pareceLP: sessoes >= 30 && (comCara >= 2 || (NOME_DE_HOST_DE_LP.test(host) && comCara >= 1)),
      };
    })
    .filter((h) => h.host && h.host !== "(not set)");

  /**
   * AS DIVERGÊNCIAS. É por isto que a rota existe, e é o que o contrato diário
   * passa a vigiar.
   */
  const divergencias: { tipo: string; host: string; detalhe: string; gravidade: "quebra" | "alerta" }[] = [];

  for (const d of declarados) {
    const medido = hosts.find((h) => h.host === d);
    if (!medido) {
      divergencias.push({
        tipo: "host_declarado_inexistente",
        host: d,
        gravidade: "quebra",
        detalhe:
          `A B.U. declara "${d}" como host de landing page, e o GA4 não tem NENHUMA sessão nesse host ` +
          `nesta janela. Host declarado errado não falha: devolve zero com cara de resposta legítima, e a ` +
          `tela conclui que a B.U. não tem LP.`,
      });
      continue;
    }
    if (medido.sessoes < 30) {
      divergencias.push({
        tipo: "host_declarado_sem_volume",
        host: d,
        gravidade: "alerta",
        detalhe: `"${d}" está declarado e tem só ${medido.sessoes} sessão(ões). Confirmar se é o host certo.`,
      });
    }
  }

  for (const h of hosts) {
    if (h.declarado || !h.pareceLP) continue;
    /**
     * Host NÃO declarado que tem cara de LP. Este é o achado que teria pego a
     * Funds Explorer: `lp.fundsexplorer.com.br` com volume e caminhos de LP,
     * enquanto a casa declarava `lps.` e via tela vazia.
     */
    const irmao = declarados.find((d) => d.split(".").slice(1).join(".") === h.host.split(".").slice(1).join("."));
    divergencias.push({
      tipo: irmao ? "host_vizinho_nao_declarado" : "host_de_lp_nao_declarado",
      host: h.host,
      gravidade: "quebra",
      detalhe:
        `"${h.host}" tem ${h.sessoes.toLocaleString("pt-BR")} sessões e serve caminho de landing page ` +
        `(${h.caminhosComCaraDeLP} dos ${h.amostraDeCaminhos.length} caminhos amostrados), e NÃO está declarado em bu.ts.` +
        (irmao
          ? ` A B.U. declara "${irmao}" no mesmo domínio: é o caso clássico de host trocado por uma letra.`
          : ""),
    });
  }

  return NextResponse.json(
    {
      propertyId,
      bu: { key: profile.key, label: profile.label, blocked: profile.blocked },
      range: dateRange,
      declarados,
      hosts: hosts.slice(0, 100),
      divergencias,
      aprovado: divergencias.every((d) => d.gravidade !== "quebra"),
      comoLer:
        "Host de landing page declarado à mão é suposição sobre dado externo, e suposição assim não falha " +
        "alto: devolve zero e a tela explica a ausência com um texto convincente. Por isso a lista precisa " +
        "ser CONFRONTADA com o que o GA4 tem, e não apenas escrita.",
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
