import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/monday/create-task
 *
 * Cria um item no Monday.com via GraphQL API quando o usuário aceita uma
 * recomendação CRO. Retorna o item criado com `id`, `name` e `url` para
 * o painel poder linkar direto na task.
 *
 * Variáveis necessárias em .env.local:
 *   MONDAY_API_TOKEN     — token pessoal do Monday (Profile > Admin > API)
 *   MONDAY_BOARD_ID      — ID do board onde criar as tasks (URL do board)
 *   MONDAY_GROUP_ID      — opcional: grupo dentro do board (default = "topics")
 *
 * Como pegar o board ID:
 *   - Abra o board no Monday
 *   - URL: https://suno.monday.com/boards/1234567890 → o número é o board ID
 *
 * Body esperado:
 * {
 *   title: string,           // título da task
 *   description?: string,    // descrição (markdown)
 *   priority?: "Alta" | "Média" | "Baixa",
 *   effort?: "baixo" | "médio" | "alto",
 *   impact?: string,         // ex.: "+18% conversão"
 *   owner?: string,          // ex.: "Dev frontend"
 *   sourceLink?: string      // link de volta pro insight no painel
 * }
 */

type MondayResponse<T> = {
  data?: T;
  errors?: { message: string; locations?: unknown[] }[];
  error_code?: string;
  error_message?: string;
  account_id?: number;
};

type CreateItemResp = {
  create_item: {
    id: string;
    name: string;
    board: { id: string; url?: string };
  };
};

// Cache leve do group_id resolvido por nome — evita chamada extra a cada item
let __cachedGroupId: { boardId: string; groupName: string; groupId: string } | null = null;

async function resolveGroupId(
  apiToken: string,
  boardId: string,
  groupName: string,
  fallbackId: string
): Promise<string> {
  // Se já resolvemos antes pra esse board+nome, retorna o cache
  if (
    __cachedGroupId &&
    __cachedGroupId.boardId === boardId &&
    __cachedGroupId.groupName === groupName
  ) {
    return __cachedGroupId.groupId;
  }

  try {
    const query = `query GetGroups($boardId: ID!) { boards(ids: [$boardId]) { groups { id title } } }`;
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiToken,
        "API-Version": "2024-01",
      },
      body: JSON.stringify({ query, variables: { boardId } }),
    });
    const data = (await res.json()) as {
      data?: { boards?: { groups?: { id: string; title: string }[] }[] };
    };
    const groups = data.data?.boards?.[0]?.groups || [];
    const found = groups.find(
      (g) => g.title.toLowerCase().trim() === groupName.toLowerCase().trim()
    );
    const resolvedId = found?.id || fallbackId;
    __cachedGroupId = { boardId, groupName, groupId: resolvedId };
    return resolvedId;
  } catch {
    return fallbackId;
  }
}

export async function POST(req: NextRequest) {
  const apiToken = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;
  const groupName = process.env.MONDAY_GROUP_NAME;
  const groupIdFallback = process.env.MONDAY_GROUP_ID || "topics";

  if (!apiToken || !boardId) {
    return NextResponse.json(
      {
        ok: false,
        error: "configuration_missing",
        message:
          "MONDAY_API_TOKEN e MONDAY_BOARD_ID não configurados em .env.local. Como configurar: 1) Profile > Admin > API > Generate Token. 2) Pega o ID do board na URL.",
      },
      { status: 500 }
    );
  }

  // Resolve o group_id real — preferimos por nome (mais robusto a renomeações)
  const groupId = groupName
    ? await resolveGroupId(apiToken, boardId, groupName, groupIdFallback)
    : groupIdFallback;

  type InsightPayload = {
    title: string;
    description?: string;
    action?: string;
    priority?: "Alta" | "Média" | "Baixa";
    confidence?: "Alta" | "Média" | "Baixa";
    effort?: "baixo" | "médio" | "alto";
    risk?: "baixo" | "médio" | "alto";
    riskNotes?: string;
    impact?: string;
    owner?: string;
    hypothesis?: string;
    evidence?: string;
    primaryKPI?: string;
    secondaryKPIs?: string[];
    testWindow?: string;
    rollback?: string;
    costEstimate?: string;
    affectedSegments?: string[];
    steps?: string[];
    iceScore?: number;
    iceImpact?: number;
    iceConfidence?: number;
    iceEase?: number;
    iceTier?: "alto" | "medio" | "baixo";
    propertyName?: string;
  };

  let body: {
    title?: string;
    insight?: InsightPayload;
    sourceLink?: string;
    // Compatibilidade retroativa com chamadas antigas (description simples)
    description?: string;
    priority?: "Alta" | "Média" | "Baixa";
    effort?: "baixo" | "médio" | "alto";
    impact?: string;
    owner?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Reconciliação: aceita `insight` (formato novo, completo) OU campos soltos (legado)
  const ins: InsightPayload = body.insight || {
    title: body.title || "",
    description: body.description,
    priority: body.priority,
    effort: body.effort,
    impact: body.impact,
    owner: body.owner,
  };
  if (!ins.title && !body.title) {
    return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  }
  const itemTitle = ins.title || body.title || "";

  // Nome da task: prioridade + ICE + título + data
  const iceTag = ins.iceScore ? ` [ICE ${ins.iceScore}]` : "";
  const priorityTag = ins.priority ? ` [${ins.priority}]` : "";
  const dateTag = ` [CRO·${new Date().toLocaleDateString("pt-BR")}]`;
  // Monday limita item_name a 255 chars — truncamos o título se necessário
  const maxTitleLen = 255 - iceTag.length - priorityTag.length - dateTag.length;
  const truncatedTitle =
    itemTitle.length > maxTitleLen ? itemTitle.slice(0, maxTitleLen - 1) + "…" : itemTitle;
  const itemName = truncatedTitle + priorityTag + iceTag + dateTag;

  // ====================================================================
  // Description em markdown — TODA a info do insight, organizada em seções
  // pra ficar clara no update do Monday (acesso histórico permanente).
  // ====================================================================
  const lines: string[] = [];

  if (ins.description) {
    lines.push("## 📋 Resumo");
    lines.push(ins.description);
    lines.push("");
  }

  if (ins.action) {
    lines.push(`**🎯 Ação principal:** ${ins.action}`);
    lines.push("");
  }

  // ICE Score em destaque
  if (ins.iceScore !== undefined) {
    lines.push("## 🏆 Score ICE");
    lines.push(
      `**${ins.iceScore}** _(${ins.iceTier === "alto" ? "Prioridade absoluta" : ins.iceTier === "medio" ? "Vale rodar" : "Backlog longo"})_`
    );
    lines.push(
      `Impacto **${ins.iceImpact || "?"}** × Confiança **${ins.iceConfidence || "?"}** × Facilidade **${ins.iceEase || "?"}**`
    );
    lines.push("");
  }

  // Tabela de atributos
  lines.push("## 📊 Atributos");
  if (ins.priority) lines.push(`- **Prioridade:** ${ins.priority}`);
  if (ins.confidence) lines.push(`- **Confiança:** ${ins.confidence}`);
  if (ins.effort) lines.push(`- **Esforço:** ${ins.effort}`);
  if (ins.risk) lines.push(`- **Risco:** ${ins.risk}`);
  if (ins.impact) lines.push(`- **Impacto estimado:** ${ins.impact}`);
  if (ins.costEstimate) lines.push(`- **Custo estimado:** ${ins.costEstimate}`);
  if (ins.owner) lines.push(`- **Responsável sugerido:** ${ins.owner}`);
  lines.push("");

  // Hipótese + Evidência
  if (ins.hypothesis) {
    lines.push("## 🧪 Hipótese a validar");
    lines.push(ins.hypothesis);
    lines.push("");
  }
  if (ins.evidence) {
    lines.push("## 📈 Evidência");
    lines.push(ins.evidence);
    lines.push("");
  }

  // Métricas de acompanhamento
  if (ins.primaryKPI || (ins.secondaryKPIs && ins.secondaryKPIs.length > 0)) {
    lines.push("## 🎯 Métricas de acompanhamento");
    if (ins.primaryKPI) lines.push(`- **KPI principal:** ${ins.primaryKPI}`);
    if (ins.secondaryKPIs && ins.secondaryKPIs.length > 0) {
      lines.push("- **KPIs secundários:**");
      for (const kpi of ins.secondaryKPIs) lines.push(`  - ${kpi}`);
    }
    lines.push("");
  }

  // Janela de teste + rollback
  if (ins.testWindow) {
    lines.push("## ⏱️ Janela de teste");
    lines.push(ins.testWindow);
    lines.push("");
  }
  if (ins.rollback) {
    lines.push("## ⏪ Critério de rollback");
    lines.push(ins.rollback);
    lines.push("");
  }

  // Riscos
  if (ins.riskNotes) {
    lines.push("## ⚠️ O que pode dar errado");
    lines.push(ins.riskNotes);
    lines.push("");
  }

  // Segmentos afetados
  if (ins.affectedSegments && ins.affectedSegments.length > 0) {
    lines.push("## 👥 Segmentos afetados");
    for (const s of ins.affectedSegments) lines.push(`- ${s}`);
    lines.push("");
  }

  // Plano de ação
  if (ins.steps && ins.steps.length > 0) {
    lines.push("## 📝 Plano de ação");
    ins.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push(`📌 **Origem:** Painel Suno · Aba CRO${ins.propertyName ? ` · ${ins.propertyName}` : ""}`);
  if (body.sourceLink) lines.push(`🔗 **Ver no painel:** ${body.sourceLink}`);
  lines.push(`🕒 **Criado em:** ${new Date().toLocaleString("pt-BR")}`);

  const description = lines.join("\n");

  // GraphQL mutation pra criar o item
  // ⚠ Variables tem que ser JSON string conforme a doc do Monday
  // https://developer.monday.com/api-reference/docs/items#create-an-item
  const query = `
    mutation CreateItem($boardId: ID!, $groupId: String!, $itemName: String!) {
      create_item(
        board_id: $boardId
        group_id: $groupId
        item_name: $itemName
        create_labels_if_missing: true
      ) {
        id
        name
        board { id }
      }
    }
  `;

  const variables = {
    boardId: String(boardId),
    groupId,
    itemName,
  };

  let mondayResp: MondayResponse<CreateItemResp>;
  try {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiToken,
        "API-Version": "2024-01",
      },
      body: JSON.stringify({ query, variables }),
    });
    mondayResp = (await res.json()) as MondayResponse<CreateItemResp>;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "network", message: (e as Error).message },
      { status: 500 }
    );
  }

  if (mondayResp.errors && mondayResp.errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "graphql_error",
        details: mondayResp.errors,
        message: mondayResp.errors[0].message,
      },
      { status: 500 }
    );
  }

  if (mondayResp.error_code) {
    return NextResponse.json(
      {
        ok: false,
        error: mondayResp.error_code,
        message: mondayResp.error_message,
      },
      { status: 500 }
    );
  }

  const created = mondayResp.data?.create_item;
  if (!created) {
    return NextResponse.json(
      { ok: false, error: "no_data", raw: mondayResp },
      { status: 500 }
    );
  }

  // Adiciona um update no item com a descrição completa (Monday limita item_name
  // a 256 chars; o resto fica no update/comment do item)
  if (description) {
    try {
      const updateQuery = `
        mutation CreateUpdate($itemId: ID!, $body: String!) {
          create_update(item_id: $itemId, body: $body) { id }
        }
      `;
      await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiToken,
          "API-Version": "2024-01",
        },
        body: JSON.stringify({
          query: updateQuery,
          variables: { itemId: created.id, body: description },
        }),
      });
    } catch {
      // best-effort — se a update falhar, a task já foi criada
    }
  }

  // URL final da task no Monday
  const itemUrl = `https://monday.com/boards/${created.board.id}/pulses/${created.id}`;

  return NextResponse.json({
    ok: true,
    item: {
      id: created.id,
      name: created.name,
      boardId: created.board.id,
      url: itemUrl,
    },
  });
}
