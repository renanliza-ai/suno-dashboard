// src/app/api/cro/proposal-state/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  setProposalState,
  listProposalStates,
} from "@/lib/cro-kv";
import type { ProposalKVState } from "@/lib/cro-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/cro/proposal-state
 *
 * Estado de aceitação/descarte das propostas CRO. Persistido em Vercel KV
 * (Upstash Redis) com TTL 30 dias.
 *
 * GET ?propertyId=... → lista todos os estados dessa property
 *   resposta: { entries: [{ proposalKey, state }] }
 *
 * POST body: { propertyId, proposalKey, status, mondayItemId?, mondayUrl?, snapshot }
 *   resposta: { ok: true, state }
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (3.4, 5.2-5.3)
 */

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const entries = await listProposalStates(propertyId);
  return NextResponse.json(
    { entries },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

type POSTBody = {
  propertyId: string;
  proposalKey: string;
  status: "accepted" | "dismissed";
  mondayItemId?: string;
  mondayUrl?: string;
  snapshot: ProposalKVState["snapshot"];
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const decidedBy = session?.user?.email || "anonymous";

  let body: POSTBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.propertyId || !body.proposalKey || !body.status || !body.snapshot) {
    return NextResponse.json(
      { error: "propertyId, proposalKey, status, snapshot são obrigatórios" },
      { status: 400 }
    );
  }
  if (body.status !== "accepted" && body.status !== "dismissed") {
    return NextResponse.json(
      { error: "status deve ser 'accepted' ou 'dismissed'" },
      { status: 400 }
    );
  }

  const state: ProposalKVState = {
    status: body.status,
    decidedAt: Date.now(),
    decidedBy,
    mondayItemId: body.mondayItemId,
    mondayUrl: body.mondayUrl,
    snapshot: body.snapshot,
  };

  const ok = await setProposalState(body.propertyId, body.proposalKey, state);
  return NextResponse.json({ ok, state });
}
