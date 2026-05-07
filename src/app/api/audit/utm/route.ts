import { getUTMAudit } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/audit/utm?propertyId=...&path=...&days=30
 *
 * Master-only. Análise de UTMs/source/medium pra uma LP específica.
 * Detecta variações, calcula % de (direct)/(none), gera diagnósticos
 * automáticos pra investigar divergência GA4 vs PowerBI/sunocode.
 */
export async function GET(req: NextRequest) {
  const session = (await auth()) as {
    user?: { isMaster?: boolean; email?: string };
  } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const path = req.nextUrl.searchParams.get("path") || "";
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");

  const result = await getUTMAudit(propertyId, path, days, startDate, endDate);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
