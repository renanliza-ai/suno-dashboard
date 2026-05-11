import { getAnomalies } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ga4/anomalies
 *
 * Detecta anomalias em 5 métricas-chave (users, sessions, engagedSessions,
 * leads, purchases) em 3 níveis (macro, canal, campanha) comparando o último
 * dia (D-1) contra a mediana dos últimos N dias (default 14).
 *
 * 🔒 RESTRITO A USUÁRIOS MASTER. Insights e diagnósticos não são acessíveis
 * a usuários comuns.
 *
 * Query params:
 *   propertyId       (obrigatório)
 *   baselineDays     default 14
 */
export async function GET(req: NextRequest) {
  // Gate de master no nível de API — defesa em profundidade
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const baselineDays = Number(req.nextUrl.searchParams.get("baselineDays") || 14);

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  if (baselineDays < 7 || baselineDays > 30) {
    return NextResponse.json(
      { error: "baselineDays deve estar entre 7 e 30" },
      { status: 400 }
    );
  }

  const { data, error } = await getAnomalies(propertyId, baselineDays);

  if (error) {
    return NextResponse.json({ error, anomalies: null, propertyId }, { status: 200 });
  }

  // ⚠ Inclui propertyId no payload pra cliente validar (anti race-condition
  // entre trocas rápidas de property — sem isso a resposta da property
  // antiga podia sobrescrever a nova)
  return NextResponse.json({ ...data, propertyId }, {
    headers: {
      // Reduzido pra 60s — anomalias mudam pouco mas cache longo bloqueava
      // refresh ao trocar de property. SWR mantém UI responsiva.
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}
