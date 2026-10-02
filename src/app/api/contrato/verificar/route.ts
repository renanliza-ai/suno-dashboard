import { auth } from "@/auth";
import { resolveBU } from "@/lib/bu";
import {
  compararComBaseline,
  mesFechado,
  type Achado,
  type Contrato,
} from "@/lib/contrato-ga4";
import { confirmarBaseline, gravarBaselineSeNovo, lerBaseline } from "@/lib/contrato-kv";
import { listProperties } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/contrato/verificar — O MOTOR DE RISCO DO PAINEL.
 *
 * Pedido do Renan em 01/10/2026: "preciso garantir que isso nunca mais quebre,
 * que isso nunca mais retroceda, porque a gente usa esse painel para trazer
 * insight".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ELE FAZ
 * ─────────────────────────────────────────────────────────────────────────
 * Para cada B.U. que tem dado publicável, e para cada aba que conta conversão,
 * pergunta à PRÓPRIA rota que alimenta a tela os números do MÊS FECHADO, e:
 *
 *   1. Lê o bloco `contrato` que a rota devolve, com as invariantes já
 *      avaliadas lá dentro, onde o dado bruto existe.
 *   2. Compara a assinatura com o baseline gravado no KV. Mês fechado não muda:
 *      qualquer movimento além da tolerância é regressão do painel.
 *   3. Na primeira execução de um período, GRAVA o baseline em vez de comparar.
 *
 * ⚠️ Por que consultar a rota por HTTP em vez de chamar a função direto: o que
 * precisa ser garantido é o que a TELA recebe. Chamar a lógica por dentro
 * testaria um caminho que nenhum usuário percorre, e deixaria passar defeito de
 * serialização, de cache e de parâmetro. O custo é algumas chamadas internas,
 * e vale.
 *
 * ⚠️ Por que o MÊS FECHADO e não os últimos 30 dias: janela móvel muda todo dia
 * por motivo legítimo, então comparar não prova nada. Mês fechado estabiliza em
 * um ou dois dias, e dali em diante qualquer mudança é suspeita.
 *
 * Auth: Vercel Cron, Bearer CRON_SECRET, ou sessão master.
 *
 * Query params:
 *   propertyId   (opcional) — limita a uma property, para depurar
 *   alertar=1    (opcional) — abre tarefa no Monday quando reprova
 */

/** Properties de teste e descontinuadas ficam de fora, igual ao health-sweep. */
const EXCLUIR_RE = /descontinuad|score-|de232|- app$|notícias|noticias/i;

type AbaVerificada = {
  aba: string;
  property: string;
  propertyId: string;
  bu: string;
  /** null quando a rota nem respondeu. */
  contrato: Contrato | null;
  baseline: { gravadoEm: string; periodo: string; linhas: number; sessoes: number; conversao: number } | null;
  baselineCriadoAgora: boolean;
  achados: Achado[];
  aprovado: boolean;
  erro: string | null;
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const ua = req.headers.get("user-agent") || "";
  const ehCronDaVercel = /vercel-cron/i.test(ua);
  const temSegredo = Boolean(secret && authHeader === `Bearer ${secret}`);
  let ehMaster = false;
  if (!ehCronDaVercel && !temSegredo) {
    const s = (await auth()) as { user?: { isMaster?: boolean } } | null;
    ehMaster = Boolean(s?.user?.isMaster);
  }
  if (!ehCronDaVercel && !temSegredo && !ehMaster) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = req.nextUrl.origin;
  const soEssaProperty = req.nextUrl.searchParams.get("propertyId");
  /**
   * ⚠️ O CRON ALERTA POR PADRÃO, sem depender de query string.
   *
   * A primeira versão registrava o cron como `/api/contrato/verificar?alertar=1`.
   * Eu não confirmei que a Vercel aceita query string no `path` de um cron, e
   * apostar nisso tem um custo ruim: se ela tratar a string inteira como
   * caminho, o cron bate num 404 todo dia e o motor de risco fica desligado
   * exatamente como se estivesse funcionando, que é o pior dos dois mundos.
   *
   * Quem é chamado pelo cron QUER alertar, então a regra virou essa, e
   * `?alertar=0` existe para quem precisa rodar sem abrir tarefa.
   */
  const alertarParam = req.nextUrl.searchParams.get("alertar");
  const deveAlertar = alertarParam === "1" || (ehCronDaVercel && alertarParam !== "0");

  const periodo = mesFechado();

  const propsRes = await listProperties();
  if (propsRes.error || !propsRes.data) {
    return NextResponse.json(
      { ok: false, error: `listProperties: ${propsRes.error}` },
      { status: 200 }
    );
  }

  /**
   * Só B.U. com dado publicável entra. B.U. bloqueada não tem número para
   * comparar, e incluí-la encheria o relatório de linhas vazias que ninguém
   * lê, o que mata a utilidade do alarme.
   */
  const properties = propsRes.data
    .filter((p) => !EXCLUIR_RE.test(p.displayName))
    .filter((p) => !resolveBU(p.displayName).blocked)
    .filter((p) => (soEssaProperty ? p.id === soEssaProperty : true));

  /** As abas que contam conversão, com a rota que alimenta cada uma. */
  const ABAS = [
    {
      aba: "landing-pages",
      url: (pid: string, nome: string) =>
        `/api/lp/performance?propertyId=${pid}&propertyName=${encodeURIComponent(nome)}` +
        `&startDate=${periodo.startDate}&endDate=${periodo.endDate}&limit=1000`,
    },
    {
      aba: "banners",
      url: (pid: string, nome: string) =>
        `/api/comunicacao/spaces?propertyId=${pid}&propertyName=${encodeURIComponent(nome)}` +
        `&kind=banner&startDate=${periodo.startDate}&endDate=${periodo.endDate}`,
    },
    {
      aba: "pop-ups",
      url: (pid: string, nome: string) =>
        `/api/comunicacao/spaces?propertyId=${pid}&propertyName=${encodeURIComponent(nome)}` +
        `&kind=popup&startDate=${periodo.startDate}&endDate=${periodo.endDate}`,
    },
  ];

  async function verificar(
    p: { id: string; displayName: string },
    def: (typeof ABAS)[number]
  ): Promise<AbaVerificada> {
    const base: AbaVerificada = {
      aba: def.aba,
      property: p.displayName,
      propertyId: p.id,
      bu: resolveBU(p.displayName).key,
      contrato: null,
      baseline: null,
      baselineCriadoAgora: false,
      achados: [],
      aprovado: false,
      erro: null,
    };

    let payload: { contrato?: Contrato | null; blocked?: string | null; error?: string };
    try {
      const r = await fetch(`${origin}${def.url(p.id, p.displayName)}`, { cache: "no-store" });
      payload = await r.json();
      if (!r.ok) {
        return { ...base, erro: `HTTP ${r.status}` };
      }
    } catch (e) {
      return { ...base, erro: e instanceof Error ? e.message : "falha na chamada" };
    }

    if (payload.blocked) {
      // B.U. bloqueada respondendo corretamente não é achado, é o esperado.
      return { ...base, aprovado: true, erro: null };
    }
    if (payload.error) return { ...base, erro: payload.error };

    const contrato = payload.contrato ?? null;
    if (!contrato) {
      /**
       * Rota sem bloco de contrato é um buraco no motor, não um "sem achado".
       * Se isso passasse calado, bastaria alguém remover o bloco para a aba
       * sair da vigilância sem ninguém notar.
       */
      return {
        ...base,
        erro: null,
        achados: [
          {
            id: "sem-contrato",
            severidade: "quebra",
            titulo: "Esta rota não declara contrato de dados",
            evidencia: `A resposta de ${def.aba} em ${p.displayName} veio sem o bloco \`contrato\`, então nenhuma invariante foi avaliada e a regressão não tem como ser detectada.`,
            comoCorrigir:
              "Montar o bloco com `montarContrato` dentro da própria rota, onde o dado bruto existe. Ver lib/contrato-ga4.ts.",
          },
        ],
      };
    }

    // ── Não regressão ────────────────────────────────────────────────────
    const achados: Achado[] = [...contrato.achados];
    const { criado, baseline } = await gravarBaselineSeNovo(
      p.id,
      def.aba,
      periodo.rotulo,
      contrato.assinatura
    );

    if (!criado) {
      const regressoes = compararComBaseline({
        aba: def.aba,
        atual: contrato.assinatura,
        baseline,
      });
      achados.push(...regressoes);
      if (regressoes.length === 0) {
        await confirmarBaseline(p.id, def.aba, periodo.rotulo, baseline);
      }
    }

    return {
      ...base,
      contrato,
      baseline: {
        gravadoEm: baseline.gravadoEm,
        periodo: baseline.periodo,
        linhas: baseline.linhas,
        sessoes: baseline.sessoes,
        conversao: baseline.conversao,
      },
      baselineCriadoAgora: criado,
      achados,
      aprovado: !achados.some((a) => a.severidade === "quebra"),
    };
  }

  /**
   * Sequencial de propósito. Cada chamada dispara várias consultas ao GA4, e
   * disparar tudo em paralelo estoura a cota da Data API e faz o próprio
   * verificador produzir erro que não existe no painel.
   */
  const resultados: AbaVerificada[] = [];
  for (const p of properties) {
    for (const def of ABAS) {
      resultados.push(await verificar(p, def));
    }
  }

  const quebras = resultados.filter((r) => r.achados.some((a) => a.severidade === "quebra"));
  const alertas = resultados.filter(
    (r) => !r.achados.some((a) => a.severidade === "quebra") && r.achados.length > 0
  );
  const erros = resultados.filter((r) => r.erro);

  const resumo = {
    periodo: periodo.rotulo,
    janela: { startDate: periodo.startDate, endDate: periodo.endDate },
    verificadas: resultados.length,
    aprovadas: resultados.filter((r) => r.aprovado && !r.erro).length,
    comQuebra: quebras.length,
    comAlerta: alertas.length,
    comErro: erros.length,
    baselinesCriados: resultados.filter((r) => r.baselineCriadoAgora).length,
  };

  console.log(
    `[contrato] ${new Date().toISOString()} | periodo=${resumo.periodo} ` +
      `verificadas=${resumo.verificadas} quebras=${resumo.comQuebra} alertas=${resumo.comAlerta} erros=${resumo.comErro}`
  );
  for (const r of quebras) {
    for (const a of r.achados.filter((x) => x.severidade === "quebra")) {
      console.log(`[contrato] QUEBRA ${r.property}/${r.aba}: ${a.titulo} — ${a.evidencia}`);
    }
  }

  // Alerta só para QUEBRA. Alerta para tudo vira ruído e deixa de ser lido.
  let alerta: string | null = null;
  if (deveAlertar && quebras.length > 0) {
    try {
      const corpo = quebras
        .map((r) => {
          const itens = r.achados
            .filter((a) => a.severidade === "quebra")
            .map((a) => `  - **${a.titulo}**\n    ${a.evidencia}\n    _Como corrigir:_ ${a.comoCorrigir}`)
            .join("\n");
          return `### ${r.property} · aba ${r.aba}\n${itens}`;
        })
        .join("\n\n");
      const r = await fetch(`${origin}/api/monday/create-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[CONTRATO] ${quebras.length} quebra(s) de dado no painel`,
          description:
            `## Contrato de dados reprovado\n\n` +
            `Período verificado: **${periodo.rotulo}** (${periodo.startDate} a ${periodo.endDate}), ` +
            `que é um mês FECHADO e não deveria mudar mais.\n\n${corpo}\n\n` +
            `_Gerado automaticamente por /api/contrato/verificar._`,
          rawBody: false,
          priority: "Alta",
        }),
      });
      const j = await r.json();
      alerta = j.ok ? `Monday item criado: ${j.item?.id}` : `falha: ${j.error}`;
    } catch (e) {
      alerta = `erro ao alertar: ${(e as Error).message}`;
    }
  }

  return NextResponse.json(
    { ok: true, geradoEm: new Date().toISOString(), resumo, resultados, alerta },
    { headers: { "Cache-Control": "no-store" } }
  );
}
