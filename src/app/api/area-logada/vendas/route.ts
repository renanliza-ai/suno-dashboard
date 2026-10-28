// src/app/api/area-logada/vendas/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  contratoNaiVendas,
  montarPorDia,
  normalizaClassificacao,
  sqlPorDia,
  sqlPorProduto,
  ESCOPO_PADRAO,
  CLASSIFICACOES,
  type DefinicaoDeEscopo,
  type NaiVendas,
  type LinhaProduto,
  type LinhaProdutoClasse,
} from "@/lib/nai-vendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/area-logada/vendas — venda que NASCE na área logada e fecha no checkout.
 *
 * ESTADO: a aba está PRONTA, a fonte ainda não.
 *
 * O Zeus autentica só por fluxo de usuário (`authorization_code` +
 * `refresh_token`, sem `client_credentials`, verificado em 09/10/2026). O
 * painel é um servidor e não consegue token sozinho. Enquanto o time de dados
 * não liberar uma das três saídas, esta rota devolve `{ ok:false, motivo }`
 * com o que falta, e a tela mostra isso.
 *
 * ⚠️ NUNCA devolver lista vazia nem zero. Zero com cara de "não vendeu" já
 * custou caro nesta casa: foi o que fez a aba de LP esconder a FIIs inteira.
 * Ausência de fonte é ESTADO DECLARADO, não resultado.
 *
 * Quando a credencial existir, basta `ZEUS_MCP_URL` e `ZEUS_TOKEN` no ambiente:
 * o caminho de consulta abaixo já está escrito.
 */

const ZEUS_URL = process.env.ZEUS_MCP_URL || "https://zeus.suno.com.br/mcp";

/** D-1: o Zeus não tem o dia corrente, e perguntar por hoje devolve incompleto. */
function ontem(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function primeiroDiaDoMes(ref: string): string {
  return ref.slice(0, 8) + "01";
}

type LinhaCrua = Record<string, string | number>;

/**
 * Chama uma tool do Zeus por MCP sobre HTTP (JSON-RPC). O transporte nunca foi
 * o problema: `https://zeus.suno.com.br/mcp` responde 401, não 404. O que falta
 * é credencial.
 */
async function zeusQuery(sql: string, pergunta: string, token: string): Promise<LinhaCrua[]> {
  const resp = await fetch(ZEUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "run_query", arguments: { sql, pergunta } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Zeus HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json = (await resp.json()) as {
    result?: { structuredContent?: { rows?: LinhaCrua[] }; content?: { text?: string }[] };
    error?: { message?: string };
  };
  if (json.error) throw new Error(`Zeus: ${json.error.message || "erro sem mensagem"}`);
  const rows = json.result?.structuredContent?.rows;
  if (Array.isArray(rows)) return rows;
  // Alguns servidores MCP devolvem só texto; tenta ler JSON de dentro dele.
  const txt = json.result?.content?.[0]?.text;
  if (txt) {
    try {
      const p = JSON.parse(txt);
      if (Array.isArray(p)) return p as LinhaCrua[];
      if (Array.isArray(p?.rows)) return p.rows as LinhaCrua[];
    } catch {
      /* cai no erro abaixo */
    }
  }
  throw new Error("Zeus respondeu num formato que esta rota não sabe ler");
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => String(v ?? "");

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const escopo = (sp.get("escopo") === "por_carimbo_nai" ? "por_carimbo_nai" : ESCOPO_PADRAO) as DefinicaoDeEscopo;
  const contrato = contratoNaiVendas(escopo);

  const fim = sp.get("fim") || ontem();
  const inicio = sp.get("inicio") || primeiroDiaDoMes(fim);

  if (fim >= new Date().toISOString().slice(0, 10)) {
    const corpo: NaiVendas = {
      ok: false,
      motivo: "periodo_invalido",
      explicacao:
        "O Zeus só tem dado até ontem (D-1). Pedir o dia de hoje devolve número incompleto, e por isso a consulta é recusada em vez de responder errado.",
      oQueFalta: ["Escolher uma data final até ontem."],
      contrato,
    };
    return NextResponse.json(corpo, { status: 200 });
  }

  const token = process.env.ZEUS_TOKEN;
  if (!token) {
    const corpo: NaiVendas = {
      ok: false,
      motivo: "sem_credencial",
      explicacao:
        "A receita da área logada existe só no Zeus, e o painel ainda não tem credencial para ler de lá. O GA4 não serve para isto: o evento de compra não dispara dentro de investidor.suno.com.br, porque a venda fecha no checkout aberto.",
      oQueFalta: [
        "O Zeus autentica só por fluxo de usuário (authorization_code e refresh_token). Não existe client_credentials, então um servidor não consegue token sozinho.",
        "Caminho 1: pedir ao time de dados que habilite client_credentials para uma conta de serviço do painel.",
        "Caminho 2: pedir um token de longa duração para o painel e gravar em ZEUS_TOKEN no Vercel (ambiente production).",
        "Caminho 3 (o mais correto): login por usuário via NextAuth, para cada pessoa ver só o que a permissão dela permite. Dá mais trabalho e preserva o controle de acesso ao dado de cliente.",
      ],
      contrato,
    };
    return NextResponse.json(corpo, { status: 200 });
  }

  try {
    const [cruDia, cruProduto] = await Promise.all([
      zeusQuery(sqlPorDia(inicio, fim, escopo), "Vendas da área logada por dia e classificação", token),
      zeusQuery(sqlPorProduto(inicio, fim, escopo), "Vendas da área logada por produto e classificação", token),
    ]);

    const porDia = montarPorDia(
      cruDia.map((r) => ({
        dia: s(r.dia).slice(0, 10),
        classificacao: s(r.classificacao),
        vendas: n(r.vendas),
        receita: n(r.receita),
      })),
      inicio,
      fim
    );

    // Total vem do DIA, nunca da soma por produto: pedido com itens de dois
    // produtos conta uma vez em cada linha de produto.
    const vendas = porDia.reduce((a, d) => a + d.vendas, 0);
    const receita = Math.round(porDia.reduce((a, d) => a + d.receita, 0) * 100) / 100;
    const receitaRenov = porDia.reduce(
      (a, d) =>
        a +
        CLASSIFICACOES.filter((c) => c.startsWith("Renovação")).reduce(
          (b, c) => b + (d.porClassificacao[c]?.receita || 0),
          0
        ),
      0
    );

    const porProdutoEClasse: LinhaProdutoClasse[] = cruProduto.map((r) => {
      const v = n(r.vendas);
      const rc = n(r.receita);
      return {
        produto: s(r.produto) || "Outros",
        classificacao: normalizaClassificacao(s(r.classificacao)),
        vendas: v,
        receita: rc,
        ticket: v ? Math.round((rc / v) * 100) / 100 : 0,
        participacaoReceita: receita ? rc / receita : 0,
      };
    });

    const agregado = new Map<string, { vendas: number; receita: number }>();
    for (const l of porProdutoEClasse) {
      const a = agregado.get(l.produto) || { vendas: 0, receita: 0 };
      a.vendas += l.vendas;
      a.receita += l.receita;
      agregado.set(l.produto, a);
    }
    const porProduto: LinhaProduto[] = [...agregado.entries()]
      .map(([produto, a]) => ({
        produto,
        vendas: a.vendas,
        receita: Math.round(a.receita * 100) / 100,
        ticket: a.vendas ? Math.round((a.receita / a.vendas) * 100) / 100 : 0,
        participacaoReceita: receita ? a.receita / receita : 0,
      }))
      .sort((x, y) => y.receita - x.receita);

    const corpo: NaiVendas = {
      ok: true,
      escopo,
      periodo: { inicio, fim },
      totais: {
        vendas,
        receita,
        ticket: vendas ? Math.round((receita / vendas) * 100) / 100 : 0,
        receitaRenovacaoPct: receita ? receitaRenov / receita : 0,
      },
      porDia,
      porProduto,
      porProdutoEClasse,
      contrato,
    };
    return NextResponse.json(corpo, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    const corpo: NaiVendas = {
      ok: false,
      motivo: "erro_zeus",
      explicacao: `O painel tem credencial, mas a consulta ao Zeus falhou: ${(e as Error).message}`,
      oQueFalta: [
        "Conferir se o ZEUS_TOKEN não expirou.",
        "Conferir se a conta tem acesso ao dataset Vendas Por Hora (áreas: Administração Central, MÍDIAS, RESEARCH, Status Invest).",
      ],
      contrato,
    };
    return NextResponse.json(corpo, { status: 200 });
  }
}
