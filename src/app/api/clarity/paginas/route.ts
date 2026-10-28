// src/app/api/clarity/paginas/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchClarityPages } from "@/lib/clarity-api";
import { resolveBU } from "@/lib/bu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/clarity/paginas — fricção de interface por página, pelo Clarity.
 *
 * POR QUE EXISTE
 * O `clarity-api.ts` já sabia buscar, mas nenhuma rota expunha isso. O chat
 * precisava de uma segunda frente: o GA4 diz O QUE acontece (quanto tráfego,
 * quanta conversão) e o Clarity diz POR QUE (rage click, dead click, scroll,
 * quickback, erro de script). Sem isto, toda hipótese de CRO no chat era
 * dedução a partir de taxa, que é exatamente o que gerava frase inventada.
 *
 * ⚠️ DOIS LIMITES QUE A RESPOSTA DECLARA, NÃO ESCONDE
 *   1. `days` default 1. De 2 dias em diante a Data Export API deixa de
 *      devolver as páginas de maior volume e sobra a cauda, o que INVERTE o
 *      ranking sem avisar. Por isso o default é 1 e a resposta carrega o aviso.
 *   2. 10 requisições por projeto por dia. Estourou, a API recusa até o dia
 *      seguinte. Por isso a resposta é cacheada por 30 minutos.
 *
 * Erro nunca vira lista vazia: o motivo sobe em `reason`, e quem chama
 * traduz. Lista vazia com cara de "não tem fricção" é pior que erro.
 */

const CACHE_S = 1800;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyName = sp.get("propertyName") || "";
  const days = Math.max(1, Math.min(Number(sp.get("days")) || 1, 3));

  if (!propertyName) {
    return NextResponse.json({ ok: false, reason: "sem_property", detail: "propertyName é obrigatório" }, { status: 400 });
  }

  const bu = resolveBU(propertyName);

  try {
    const r = await fetchClarityPages(propertyName, days);

    if (!r.ok) {
      // 200 de propósito: é estado conhecido do ambiente, não falha de servidor.
      return NextResponse.json({ ...r, bu: bu.label, propertyName }, { status: 200 });
    }

    const rows = r.rows.map((row) => ({
      url: row.url,
      sessoes: row.sessions,
      pageViews: row.pageViews,
      sessoesDeBot: row.botSessions,
      rageClicks: row.rageClicks,
      deadClicks: row.deadClicks,
      scrollExcessivo: row.excessiveScrolls,
      quickbacks: row.quickbacks,
      errosDeScript: row.scriptErrors,
      cliquesComErro: row.errorClicks,
      // Taxa SEMPRE com a ocorrência ao lado: taxa sem base não é evidência.
      rageRate: row.rageRate,
      deadRate: row.deadRate,
      quickbackRate: row.quickbackRate,
    }));

    return NextResponse.json(
      {
        ok: true,
        bu: bu.label,
        propertyName,
        days: r.days,
        fetchedAt: r.fetchedAt,
        rows,
        avisoDeJanela:
          days > 1
            ? "⚠️ Janela acima de 1 dia: as páginas de maior volume podem ter sumido da resposta e o ranking pode estar invertido."
            : null,
      },
      { headers: { "Cache-Control": `private, max-age=${CACHE_S}` } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "erro_api", status: 500, detail: (e as Error).message, bu: bu.label },
      { status: 200 }
    );
  }
}
