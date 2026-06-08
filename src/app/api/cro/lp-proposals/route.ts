// src/app/api/cro/lp-proposals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { applyRulesAll } from "@/lib/cro-rules";
import {
  LPData,
  SourceBreakdownRow,
  RuleContext,
} from "@/lib/cro-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/cro/lp-proposals
 *
 * Recebe dados pré-buscados do /api/ga4/landing-pages e aplica o motor
 * de heurísticas. Mantemos o motor como endpoint separado pra:
 *  - Permitir reaproveitar dados GA4 já em cache no cliente
 *  - Permitir evoluir o motor sem mexer no fetch GA4
 *  - Facilitar testes (input determinístico)
 *
 * POST body:
 *   {
 *     pages: LPData[],           // do /api/ga4/landing-pages
 *     pagesPrevious: LPData[],   // mesmo endpoint com comparePreviousPeriod=true
 *     sourceBreakdown: SourceBreakdownRow[],
 *     rangeDays: number          // tamanho do range atual em dias
 *   }
 *
 * Retorna:
 *   { proposals: Proposal[] }  // ordenadas por priority + sessions desc
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (3.2, 5.1)
 */

type RequestBody = {
  pages: LPData[];
  pagesPrevious?: LPData[];
  sourceBreakdown?: SourceBreakdownRow[];
  rangeDays: number;
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.pages) || typeof body.rangeDays !== "number") {
    return NextResponse.json(
      { error: "pages (array) e rangeDays (number) são obrigatórios" },
      { status: 400 }
    );
  }

  // Filtrar só LPs ativas (≥100 sessões) conforme spec — threshold de
  // signif. estatística. Regras adicionais (ex: tracking-broken) tem
  // threshold próprio mais alto interno.
  const activeLPs = body.pages.filter((lp) => lp.sessions >= 100);

  // Calcular hostMedians por host (mediana de leadConvRate). Usado por
  // regras conv-vs-host-median, replicate-winner, etc.
  const hostsSet = new Set(activeLPs.map((lp) => lp.host));
  const hostMedians: Record<string, number> = {};
  const hostTopLP: Record<string, LPData> = {};
  for (const host of hostsSet) {
    const lpsOfHost = activeLPs.filter((lp) => lp.host === host);
    const convs = lpsOfHost.map((lp) => lp.leadConvRate).sort((a, b) => a - b);
    hostMedians[host] =
      convs.length === 0
        ? 0
        : convs.length % 2 === 0
          ? (convs[convs.length / 2 - 1] + convs[convs.length / 2]) / 2
          : convs[Math.floor(convs.length / 2)];
    const top = [...lpsOfHost].sort((a, b) => b.leadConvRate - a.leadConvRate)[0];
    if (top) hostTopLP[host] = top;
  }

  // Mapa previous period por url — pra regra regression-week
  const previousPeriod: Record<string, LPData> = {};
  for (const lp of body.pagesPrevious || []) {
    previousPeriod[lp.url] = lp;
  }

  const ctx: RuleContext = {
    hostMedians,
    hostTopLP,
    previousPeriod,
    sourceBreakdown: body.sourceBreakdown || [],
    rangeDays: body.rangeDays,
  };

  const proposals = applyRulesAll(activeLPs, ctx);

  return NextResponse.json(
    { proposals, activeLPsCount: activeLPs.length, totalRules: 11 },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
