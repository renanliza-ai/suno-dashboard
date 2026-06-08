// src/lib/cro-kv.ts
import { kv } from "@vercel/kv";
import type { ProposalKVState } from "./cro-types";

/**
 * Wrapper Vercel KV para o estado de propostas CRO.
 *
 * Schema da key:
 *   cro:proposal:{propertyId}:{proposal_key}
 *
 * Onde proposal_key vem do motor de regras (hash url + rule_id).
 *
 * TTL: 30 dias. Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (3.4)
 */

const TTL_30_DAYS_SEC = 60 * 60 * 24 * 30;

function buildKey(propertyId: string, proposalKey: string): string {
  // sanitiza propertyId pra evitar caracteres estranhos
  const safePid = propertyId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `cro:proposal:${safePid}:${proposalKey}`;
}

export async function getProposalState(
  propertyId: string,
  proposalKey: string
): Promise<ProposalKVState | null> {
  try {
    const v = await kv.get<ProposalKVState>(buildKey(propertyId, proposalKey));
    return v ?? null;
  } catch (e) {
    console.error("[cro-kv] getProposalState falhou:", e);
    return null;
  }
}

export async function setProposalState(
  propertyId: string,
  proposalKey: string,
  state: ProposalKVState
): Promise<boolean> {
  try {
    await kv.set(buildKey(propertyId, proposalKey), state, { ex: TTL_30_DAYS_SEC });
    return true;
  } catch (e) {
    console.error("[cro-kv] setProposalState falhou:", e);
    return false;
  }
}

/**
 * Lista todos os states de propostas pra uma property.
 * Usa SCAN no Redis (KV) — eficiente pra volume baixo (<1000 keys).
 */
export async function listProposalStates(
  propertyId: string
): Promise<Array<{ proposalKey: string; state: ProposalKVState }>> {
  try {
    const safePid = propertyId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const pattern = `cro:proposal:${safePid}:*`;
    const keys: string[] = [];
    let cursor: number | string = 0;
    while (true) {
      const res: [string | number, string[]] = await kv.scan(cursor, {
        match: pattern,
        count: 200,
      });
      cursor = res[0];
      keys.push(...res[1]);
      if (cursor === 0 || cursor === "0") break;
    }

    if (keys.length === 0) return [];

    const values = await Promise.all(
      keys.map((k) => kv.get<ProposalKVState>(k))
    );

    return keys
      .map((k, i) => {
        const value = values[i];
        if (!value) return null;
        const proposalKey = k.replace(`cro:proposal:${safePid}:`, "");
        return { proposalKey, state: value };
      })
      .filter((x): x is { proposalKey: string; state: ProposalKVState } => x !== null);
  } catch (e) {
    console.error("[cro-kv] listProposalStates falhou:", e);
    return [];
  }
}
