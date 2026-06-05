// src/lib/cro-types.ts

/**
 * Tipos compartilhados do sistema CRO Automation.
 *
 * Centraliza contracts entre:
 * - Motor de heurísticas (cro-rules.ts)
 * - Endpoint que aplica regras (/api/cro/lp-proposals)
 * - Storage KV (cro-kv.ts)
 * - Frontend (cro-proposals-board, proposal-card, etc)
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (seções 3.4, 4.1)
 */

export type ProposalPriority = "critico" | "atencao" | "otimizacao";

export type ProposalEffort = "baixo" | "medio" | "alto";

/** Categorias usadas pra agrupar regras no catálogo */
export type RuleCategory = "tracking" | "engagement" | "conversion" | "channel";

/**
 * Dados de uma LP individual que o motor recebe pra aplicar regras.
 * Vem do /api/ga4/landing-pages — schema atual + breakdown adicional.
 */
export type LPData = {
  host: string;
  path: string;
  url: string;
  users: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;
  avgSessionDuration: number;
  bounceRate: number;
  leadCount: number;
  leadConvRate: number;
  ctaCount: number;
  ctaConvRate: number;
};

/** Breakdown de uma LP por source/medium */
export type SourceBreakdownRow = {
  host: string;
  path: string;
  url: string;
  source: string;
  medium: string;
  sessions: number;
  users: number;
};

/** Contexto compartilhado entre regras (calculado uma vez antes de iterar) */
export type RuleContext = {
  hostMedians: Record<string, number>;           // mediana de leadConvRate por host
  hostTopLP: Record<string, LPData>;             // top LP por conv de cada host
  previousPeriod: Record<string, LPData>;        // mesmo LP no período anterior (key = url)
  sourceBreakdown: SourceBreakdownRow[];         // todas as linhas
  rangeDays: number;                             // tamanho do range em dias (pra cálculo de leads/mês)
};

/**
 * Proposta gerada pelo motor.
 * Vai pro frontend e (parcial) pra task Monday.
 */
export type Proposal = {
  rule_id: string;
  proposal_key: string;                          // hash composta — vira KV key
  lp: { url: string; host: string; path: string };
  priority: ProposalPriority;
  category: RuleCategory;
  titulo: string;
  hipotese: string;                              // markdown ~3-4 linhas
  acaoSugerida: string;                          // markdown ~2-3 linhas
  effort: ProposalEffort;
  impactoEstimado: string;                       // texto pronto: "+3.6pp conv (~180 leads/mês)"
  sinaisDetalhados: string[];
  benchmarks: string[];
  // Populado do KV no frontend, vazio no output do motor
  status?: "pending" | "accepted" | "dismissed";
  mondayUrl?: string;
  decidedAt?: number;
};

/**
 * Definição de uma regra. Cada item no catálogo implementa essa interface.
 */
export type CRORule = {
  id: string;
  priority: ProposalPriority;
  category: RuleCategory;
  /** Retorna true se a regra dispara pra essa LP nesse contexto */
  trigger: (lp: LPData, ctx: RuleContext) => boolean;
  /** Gera a proposta concreta. Só chamado se trigger retornou true. */
  generate: (lp: LPData, ctx: RuleContext) => Proposal;
};

/** Estado persistido no KV */
export type ProposalKVState = {
  status: "accepted" | "dismissed";
  decidedAt: number;                             // unix ms
  decidedBy: string;
  mondayItemId?: string;
  mondayUrl?: string;
  snapshot: {
    leadConvRate: number;
    bounceRate: number;
    sessions: number;
    avgSessionDuration: number;
    sinaisDetalhados: string[];
  };
};
