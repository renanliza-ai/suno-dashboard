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
    return NextResponse.json({ error, anomalies: null }, { status: 200 });
  }

  return NextResponse.json(data, {
    headers: {
      // Cache 30min — anomalias mudam pouco durante o dia (já compara D-1 fechado)
      "Cache-Control": "private, max-age=1800, stale-while-revalidate=3600",
    },
  });
}
