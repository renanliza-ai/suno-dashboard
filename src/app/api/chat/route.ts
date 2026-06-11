// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  GEMINI_FUNCTION_DECLARATIONS,
  executeChatTool,
  ChatToolContext,
} from "@/lib/gemini-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/chat — fallback IA do copiloto (chat híbrido).
 *
 * Recebe perguntas que o detectIntent (regex) não reconheceu e responde
 * via Gemini 2.5 Flash com function calling sobre os endpoints do painel.
 *
 * POST body:
 *   {
 *     message: string,
 *     history: { role: "user"|"assistant", content: string }[],  // ≤10
 *     context: { propertyId, propertyName, days, startDate?, endDate? }
 *   }
 *
 * Resposta: { reply: string } | { error: string, friendly: string }
 *
 * Decisões (spec 2026-06-11-chat-gemini-hybrid-design.md):
 *  - REST puro (sem SDK) — zero dependência nova
 *  - Key 100% server-side (GEMINI_API_KEY)
 *  - Sem gating Master no chat (decisão do owner)
 *  - Loop de tools com máximo 4 rodadas
 */

const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_TOOL_ROUNDS = 4;

type ChatMessage = { role: "user" | "assistant"; content: string };

type RequestBody = {
  message: string;
  history?: ChatMessage[];
  context: {
    propertyId: string;
    propertyName: string;
    days: number;
    startDate?: string;
    endDate?: string;
  };
};

// Partes de conteúdo no formato da API Gemini
type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function systemPrompt(ctx: RequestBody["context"]): string {
  const periodo =
    ctx.startDate && ctx.endDate
      ? `${ctx.startDate} a ${ctx.endDate}`
      : `últimos ${ctx.days} dias`;
  return [
    `Você é o copiloto de analytics do painel interno da Suno (empresa brasileira de research de investimentos).`,
    `Contexto da sessão: propriedade GA4 "${ctx.propertyName}" · período selecionado: ${periodo}.`,
    ``,
    `REGRAS OBRIGATÓRIAS:`,
    `1. NUNCA invente números. Só cite valores que vieram das ferramentas. Se não tiver o dado, diga claramente que não tem.`,
    `2. Sempre que a pergunta envolver dados/métricas, chame a ferramenta adequada ANTES de responder. Não responda de memória.`,
    `3. Responda em português brasileiro, direto e objetivo, no máximo ~200 palavras.`,
    `4. Formate com markdown leve: **negrito** pra números-chave; tabela markdown quando listar 3+ itens.`,
    `5. Se uma ferramenta retornar { error }, informe o erro real ao usuário em 1 linha — sem mascarar.`,
    `6. Use o período da sessão como padrão; só mude se o usuário pedir explicitamente outro período.`,
    `7. Moeda em R$ quando aplicável. Taxas com 1 casa decimal.`,
  ].join("\n");
}

async function callGemini(
  apiKey: string,
  contents: GeminiContent[],
  sysPrompt: string
): Promise<{ parts: GeminiPart[]; raw?: unknown } | { fail: string; status: number }> {
  const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysPrompt }] },
      contents,
      tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { fail: text.slice(0, 300), status: resp.status };
  }
  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts || [];
  return { parts, raw: data };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "GEMINI_API_KEY ausente",
        friendly:
          "O assistente de IA ainda não está configurado neste ambiente. Use as perguntas rápidas do menu.",
      },
      { status: 503 }
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.message || !body.context?.propertyId) {
    return NextResponse.json(
      { error: "message e context.propertyId são obrigatórios" },
      { status: 400 }
    );
  }

  const toolCtx: ChatToolContext = {
    origin: req.nextUrl.origin,
    propertyId: body.context.propertyId,
    propertyName: body.context.propertyName || "",
    days: body.context.days || 30,
    startDate: body.context.startDate,
    endDate: body.context.endDate,
    cookie: req.headers.get("cookie") || undefined,
  };

  // Monta o histórico no formato Gemini (user/model alternados)
  const contents: GeminiContent[] = [];
  for (const m of (body.history || []).slice(-10)) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 2000) }],
    });
  }
  contents.push({ role: "user", parts: [{ text: body.message.slice(0, 2000) }] });

  const sysPrompt = systemPrompt(body.context);

  try {
    // Loop de function calling
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await callGemini(apiKey, contents, sysPrompt);

      if ("fail" in result) {
        const isQuota = result.status === 429;
        return NextResponse.json(
          {
            error: `gemini_${result.status}`,
            friendly: isQuota
              ? "⏳ Estou no limite de consultas de IA agora (tier gratuito). Tenta de novo em alguns minutos, ou usa as perguntas rápidas do menu."
              : "⚠ O assistente de IA falhou ao processar. Tenta reformular a pergunta ou usa as perguntas rápidas.",
          },
          { status: 200 } // 200 pro client tratar como resposta amigável
        );
      }

      const fnCalls = result.parts.filter(
        (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
          "functionCall" in p
      );

      if (fnCalls.length === 0) {
        // Resposta final em texto
        const text = result.parts
          .filter((p): p is { text: string } => "text" in p)
          .map((p) => p.text)
          .join("");
        return NextResponse.json({ reply: text || "Não consegui formular uma resposta. Reformula a pergunta?" });
      }

      // Executa as tools pedidas (em paralelo) e devolve os resultados
      contents.push({ role: "model", parts: fnCalls });
      const responses = await Promise.all(
        fnCalls.map(async (fc) => ({
          functionResponse: {
            name: fc.functionCall.name,
            response: await executeChatTool(fc.functionCall.name, fc.functionCall.args || {}, toolCtx),
          },
        }))
      );
      contents.push({ role: "user", parts: responses });
    }

    return NextResponse.json({
      reply:
        "Precisei de muitas consultas seguidas e parei por segurança. Tenta quebrar a pergunta em partes menores.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: (e as Error).message,
        friendly: "⚠ O assistente de IA demorou demais ou falhou. Tenta de novo em instantes.",
      },
      { status: 200 }
    );
  }
}
