// src/app/api/cards/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listarCards, salvarCard, apagarCard, lerCard, idDaChamada, type Card } from "@/lib/cards-kv";
import { executeChatTool, GEMINI_FUNCTION_DECLARATIONS, type ChatToolContext } from "@/lib/gemini-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/cards — perguntas do chat salvas como card vivo.
 *
 * GET    lista os cards
 * POST   salva uma pergunta como card e JÁ EXECUTA uma vez
 * DELETE ?id=... remove
 *
 * ⚠️ O POST só aceita `tool` que exista nas declarations do chat. Isso é o
 * guard-rail: o card não pode virar porta para uma chamada arbitrária que o
 * chat não faria. Tool desconhecida é 400, não "executa e vê no que dá".
 */

const TOOLS_VALIDAS = new Set(GEMINI_FUNCTION_DECLARATIONS.map((d) => d.name));

export async function GET() {
  try {
    return NextResponse.json({ cards: await listarCards() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, cards: [] }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    pergunta?: string;
    titulo?: string;
    autor?: string;
    tool?: string;
    args?: Record<string, unknown>;
    propertyId?: string;
    propertyName?: string;
    days?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { pergunta, tool, propertyId, propertyName } = body;
  if (!pergunta || !tool || !propertyId || !propertyName) {
    return NextResponse.json(
      { error: "pergunta, tool, propertyId e propertyName são obrigatórios" },
      { status: 400 }
    );
  }
  if (!TOOLS_VALIDAS.has(tool)) {
    return NextResponse.json(
      { error: `Tool "${tool}" não existe. Válidas: ${[...TOOLS_VALIDAS].join(", ")}` },
      { status: 400 }
    );
  }

  const chamada: Card["chamada"] = {
    tool,
    args: body.args ?? {},
    propertyId,
    propertyName,
    days: Number(body.days) || 30,
  };

  const agora = new Date().toISOString();
  const id = idDaChamada(chamada);
  const existente = await lerCard(id);

  const ctx: ChatToolContext = {
    origin: req.nextUrl.origin,
    propertyId: chamada.propertyId,
    propertyName: chamada.propertyName,
    days: chamada.days,
    cookie: req.headers.get("cookie") || undefined,
  };

  let resultado: unknown = null;
  let erro: string | null = null;
  try {
    resultado = await executeChatTool(chamada.tool, chamada.args, ctx);
    const r = resultado as { error?: string };
    if (r?.error) erro = r.error;
  } catch (e) {
    erro = (e as Error).message;
  }

  const exec = { em: agora, resultado, erro };
  const card: Card = {
    id,
    pergunta,
    titulo: body.titulo || pergunta.slice(0, 70),
    autor: body.autor || "desconhecido",
    criadoEm: existente?.criadoEm || agora,
    chamada,
    // Primeira execução entra como `ultima` só se deu certo.
    ultima: erro ? existente?.ultima ?? null : exec,
    penultima: erro ? existente?.penultima ?? null : existente?.ultima ?? null,
    ultimoErro: erro ? exec : null,
    ativo: true,
  };

  await salvarCard(card);
  return NextResponse.json({ card, atualizou: Boolean(existente) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
  const existia = await apagarCard(id);
  return NextResponse.json({ ok: true, existia });
}
