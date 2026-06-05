# CRO Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar à aba `/cro` um sistema que detecta LPs ativas (≥100 sessões) por property, gera propostas data-driven via 12 heurísticas, persiste estado de aceite/descarte em Vercel KV, e cria task no Monday automaticamente ao aceitar.

**Architecture:** Dados ao vivo do GA4 (range header) + persistência apenas do acceptance state (Vercel KV). Motor de regras stateless puro. Cards prioritários + lista detalhada na mesma página. Reusa endpoint Monday existente.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind, GA4 Data API, Vercel KV (Redis), Monday GraphQL API. Sem framework de testes formal — verificação manual via Chrome MCP / curl.

**Spec de referência:** `docs/superpowers/specs/2026-06-04-cro-automation-design.md`

---

## File Structure

### Arquivos novos

| Path | Responsabilidade |
|---|---|
| `src/lib/cro-rules.ts` | Motor de 12 heurísticas — funções puras + tipos `CRORule`, `Proposal`, `RuleContext` |
| `src/lib/cro-impact.ts` | Cálculo de impacto estimado (leads/mês, pp conv) — função pura |
| `src/lib/cro-kv.ts` | Wrapper Vercel KV com tipos e TTL — `getProposalState`, `setProposalState`, `listProposalStates` |
| `src/app/api/cro/lp-proposals/route.ts` | Endpoint POST que aplica regras |
| `src/app/api/cro/proposal-state/route.ts` | Endpoint GET/POST para acceptance state |
| `src/components/cro-proposals-board.tsx` | Renderização dos cards top + actions |
| `src/components/proposal-card.tsx` | Card individual com badge priority |
| `src/components/proposal-details-modal.tsx` | Modal expandido com dados completos |

### Arquivos modificados

| Path | O que muda |
|---|---|
| `src/app/api/ga4/landing-pages/route.ts` | Adicionar param `comparePreviousPeriod=true` → retorna `pagesPrevious[]` |
| `src/app/cro/page.tsx` | Renderizar `<CROProposalsBoard>` acima do `<LPAnalyzer>` |
| `src/components/lp-analyzer.tsx` | Adicionar seção de breakdown por origem por LP (expand row) |
| `package.json` | Adicionar dependência `@vercel/kv` |
| `.env.local` (manual) | Adicionar `KV_REST_API_URL` e `KV_REST_API_TOKEN` |

---

## Task 1: Setup Vercel KV

**Files:**
- Modify: `package.json`
- Manual: criar database KV no painel Vercel + configurar env vars

- [ ] **Step 1.1: Instalar dependência @vercel/kv**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npm install @vercel/kv
```

Expected: pacote adicionado em `package.json` dependencies, sem erros.

- [ ] **Step 1.2: Criar KV database no Vercel (manual)**

1. Acesse https://vercel.com/dashboard
2. Selecione projeto `suno-dashboard-painel`
3. Aba "Storage" → "Create Database" → "KV"
4. Nome: `cro-proposal-state`, região: São Paulo (gru1) ou mais próxima
5. Após criar, copie `KV_REST_API_URL` e `KV_REST_API_TOKEN`

- [ ] **Step 1.3: Adicionar env vars (Production + Preview)**

No painel Vercel → Settings → Environment Variables:
```
KV_REST_API_URL=<copiado do passo anterior>
KV_REST_API_TOKEN=<copiado do passo anterior>
```

Marque para Production E Preview E Development.

- [ ] **Step 1.4: Pull env vars localmente**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx vercel env pull .env.local
```

Expected: `.env.local` atualizado com `KV_REST_API_URL` e `KV_REST_API_TOKEN`.

- [ ] **Step 1.5: Verificar conexão KV via script ad-hoc**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
node -e "require('dotenv').config({path:'.env.local'}); const {kv}=require('@vercel/kv'); kv.set('test:smoke', 'ok', {ex:60}).then(()=>kv.get('test:smoke')).then(v=>console.log('KV ok:',v)).catch(e=>console.error('KV erro:',e.message))"
```

Expected: `KV ok: ok`

- [ ] **Step 1.6: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add package.json package-lock.json
git commit -m "chore(cro): add @vercel/kv dependency para persistir acceptance state"
```

---

## Task 2: Tipos compartilhados CRO

**Files:**
- Create: `src/lib/cro-types.ts`

- [ ] **Step 2.1: Criar arquivo de tipos**

```typescript
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
```

- [ ] **Step 2.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep -i cro-types | head
```

Expected: nenhum erro.

- [ ] **Step 2.3: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/lib/cro-types.ts
git commit -m "feat(cro): tipos compartilhados do sistema de propostas"
```

---

## Task 3: Função de cálculo de impacto

**Files:**
- Create: `src/lib/cro-impact.ts`

- [ ] **Step 3.1: Criar arquivo cro-impact.ts**

```typescript
// src/lib/cro-impact.ts

/**
 * Cálculo de impacto estimado de propostas CRO.
 *
 * Funções puras, sem efeitos colaterais. Cada uma retorna texto formatado
 * pronto pra exibição na proposta.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (4.3)
 */

import { LPData } from "./cro-types";

/**
 * Calcula impacto de fechar gap de conversão até a mediana do host.
 *
 * Fórmula:
 *   impacto_pp = (hostMedian - leadConvRate) * 100
 *   leads_extras_mes = (impacto_pp/100) * (sessions / rangeDays) * 30
 *
 * Retorna texto pronto pra exibição.
 *
 * @example
 *   impactoFechaGapMediana({ leadConvRate: 0.012, sessions: 4200, ... }, 0.048, 7)
 *   // "+3.6pp conv (~648 leads/mês)"
 */
export function impactoFechaGapMediana(
  lp: LPData,
  hostMedian: number,
  rangeDays: number
): string {
  const gapPP = (hostMedian - lp.leadConvRate) * 100;
  if (gapPP <= 0) return "—";
  const sessionsPerDay = lp.sessions / rangeDays;
  const leadsExtrasMes = Math.round((gapPP / 100) * sessionsPerDay * 30);
  return `+${gapPP.toFixed(1)}pp conv (~${leadsExtrasMes.toLocaleString("pt-BR")} leads/mês)`;
}

/**
 * Impacto qualitativo para regras que não traduzem em pp conv direto
 * (bounce, tempo, engajamento).
 *
 * @example
 *   impactoQualitativo("alto") // "Alto potencial de melhoria"
 */
export function impactoQualitativo(nivel: "alto" | "moderado" | "baixo"): string {
  const map = {
    alto: "Alto potencial de melhoria",
    moderado: "Potencial moderado",
    baixo: "Otimização menor",
  };
  return map[nivel];
}

/**
 * Impacto pra regras de canal mismatch — quantifica perda da fonte top.
 */
export function impactoChannelMismatch(
  topSourceConv: number,
  benchmarkConv: number,
  topSourceSessions: number,
  rangeDays: number
): string {
  const gapPP = (benchmarkConv - topSourceConv) * 100;
  const sessionsPerDay = topSourceSessions / rangeDays;
  const leadsExtras = Math.round((gapPP / 100) * sessionsPerDay * 30);
  return `Origem top perdendo ${gapPP.toFixed(1)}pp vs outras — ~${leadsExtras.toLocaleString("pt-BR")} leads/mês potenciais`;
}
```

- [ ] **Step 3.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep -i cro-impact | head
```

Expected: nenhum erro.

- [ ] **Step 3.3: Smoke test manual via node REPL**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsx -e "import { impactoFechaGapMediana } from './src/lib/cro-impact'; console.log(impactoFechaGapMediana({leadConvRate:0.012, sessions:4200}, 0.048, 7))"
```

Expected output:
```
+3.6pp conv (~648 leads/mês)
```

- [ ] **Step 3.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/lib/cro-impact.ts
git commit -m "feat(cro): função cálculo de impacto estimado"
```

---

## Task 4: Motor de heurísticas — 4 regras críticas

Quebrando em 3 tasks (4-5-6) pra cada bloco de prioridade. Esta é só as críticas.

**Files:**
- Create: `src/lib/cro-rules.ts`

- [ ] **Step 4.1: Criar cro-rules.ts com helpers + 4 regras críticas**

```typescript
// src/lib/cro-rules.ts

/**
 * Motor de heurísticas CRO — 12 regras data-driven.
 *
 * Cada regra é uma função pura que recebe LP + contexto e decide se
 * deve gerar uma proposta. Sem efeitos colaterais, sem chamadas externas.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (4.2)
 */

import { createHash } from "crypto";
import {
  CRORule,
  LPData,
  Proposal,
  RuleContext,
} from "./cro-types";
import {
  impactoFechaGapMediana,
  impactoQualitativo,
  impactoChannelMismatch,
} from "./cro-impact";

// ------------ Helpers ------------

/** Gera proposal_key estável baseado em LP url + rule id */
function makeKey(lp: LPData, ruleId: string): string {
  const hash = createHash("sha256")
    .update(lp.url)
    .digest("hex")
    .slice(0, 8);
  return `${hash}:${ruleId}`;
}

/** Formata percentual com 1 casa decimal */
function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Formata número com separador BR */
function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

// ------------ Regras CRÍTICAS ------------

const ruleTrackingBroken: CRORule = {
  id: "tracking-broken",
  priority: "critico",
  category: "tracking",
  trigger: (lp) => lp.sessions >= 500 && lp.leadCount === 0 && lp.ctaCount === 0,
  generate: (lp): Proposal => ({
    rule_id: "tracking-broken",
    proposal_key: makeKey(lp, "tracking-broken"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "critico",
    category: "tracking",
    titulo: "LP sem nenhum evento de conversão",
    hipotese: `LP \`${lp.path}\` recebeu **${fmt(lp.sessions)} sessões** sem disparar nenhum \`generate_lead\` nem \`cta_click\`. Provável bug de tracking ou formulário/CTA quebrado.`,
    acaoSugerida: `Abrir a LP em janela anônima, completar formulário/clicar CTA, verificar no GA4 Realtime se evento dispara. Se não disparar, conferir GTM. Se evento existe mas com outro nome, ajustar regra.`,
    effort: "baixo",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      `${fmt(lp.sessions)} sessões no período`,
      `0 eventos generate_lead disparados`,
      `0 eventos cta_click disparados`,
      `Bounce rate: ${pct(lp.bounceRate)}`,
    ],
    benchmarks: [
      "Esperado: pelo menos 1% das sessões disparam generate_lead ou cta_click",
    ],
  }),
};

const ruleConvVsHostMedian: CRORule = {
  id: "conv-vs-host-median",
  priority: "critico",
  category: "conversion",
  trigger: (lp, ctx) => {
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 && lp.leadConvRate < median * 0.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const topLP = ctx.hostTopLP[lp.host];
    return {
      rule_id: "conv-vs-host-median",
      proposal_key: makeKey(lp, "conv-vs-host-median"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "critico",
      category: "conversion",
      titulo: "Conversão metade da mediana do host",
      hipotese: `LP \`${lp.path}\` converte **${pct(lp.leadConvRate)}** vs mediana de **${pct(median)}** do host \`${lp.host}\`. Top LP do host (\`${topLP?.path || "n/a"}\`) faz **${pct(topLP?.leadConvRate || 0)}**.`,
      acaoSugerida: `Comparar formulário, copy do CTA e proposta de valor com a top LP do host. Testar versão A/B replicando elementos vencedores.`,
      effort: "medio",
      impactoEstimado: impactoFechaGapMediana(lp, median, ctx.rangeDays),
      sinaisDetalhados: [
        `Conv. lead atual: ${pct(lp.leadConvRate)}`,
        `Mediana do host: ${pct(median)}`,
        `Top LP do host: ${pct(topLP?.leadConvRate || 0)} (${topLP?.path || "n/a"})`,
        `Sessões: ${fmt(lp.sessions)}`,
      ],
      benchmarks: [
        `Mediana host \`${lp.host}\`: ${pct(median)}`,
        topLP ? `Top LP: ${topLP.path} → ${pct(topLP.leadConvRate)}` : "",
      ].filter(Boolean),
    };
  },
};

const ruleBounceCritical: CRORule = {
  id: "bounce-critical",
  priority: "critico",
  category: "engagement",
  trigger: (lp) => lp.sessions >= 200 && lp.bounceRate > 0.7,
  generate: (lp): Proposal => ({
    rule_id: "bounce-critical",
    proposal_key: makeKey(lp, "bounce-critical"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "critico",
    category: "engagement",
    titulo: "Rejeição crítica acima de 70%",
    hipotese: `LP \`${lp.path}\` tem rejeição de **${pct(lp.bounceRate)}** — usuários chegam mas saem imediatamente. Provavelmente o criativo/anúncio promete algo diferente do que a LP entrega.`,
    acaoSugerida: `Auditar match entre criativos de mídia (Meta + Google) e o hero da LP. Hipótese: ajustar headline + sub-headline pra alinhar com promessa do anúncio.`,
    effort: "medio",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      `Bounce rate: ${pct(lp.bounceRate)} (limite alerta: 70%)`,
      `${fmt(lp.sessions)} sessões impactadas`,
      `Conv. lead: ${pct(lp.leadConvRate)}`,
      `Tempo médio sessão: ${lp.avgSessionDuration.toFixed(0)}s`,
    ],
    benchmarks: [
      "Bounce saudável LP de captura: 30-50%",
      "Bounce crítico: >70%",
    ],
  }),
};

const ruleTimeCritical: CRORule = {
  id: "time-critical",
  priority: "critico",
  category: "engagement",
  trigger: (lp) => lp.sessions >= 200 && lp.avgSessionDuration < 20,
  generate: (lp): Proposal => ({
    rule_id: "time-critical",
    proposal_key: makeKey(lp, "time-critical"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "critico",
    category: "engagement",
    titulo: "Primeira dobra não convence — sessão <20s",
    hipotese: `LP \`${lp.path}\` tem sessão média de apenas **${lp.avgSessionDuration.toFixed(0)}s**. Usuário sai antes mesmo de ler. Headline e prova social inicial não estão convencendo.`,
    acaoSugerida: `Testar variação A/B do hero com: (1) headline mais direta com benefício claro, (2) sub-headline com prova social numérica (ex: "+50 mil investidores"), (3) CTA visível sem scroll.`,
    effort: "baixo",
    impactoEstimado: impactoQualitativo("alto"),
    sinaisDetalhados: [
      `Tempo médio: ${lp.avgSessionDuration.toFixed(0)}s (limite alerta: 20s)`,
      `${fmt(lp.sessions)} sessões impactadas`,
      `Engajamento: ${pct(lp.engagementRate)}`,
      `Bounce: ${pct(lp.bounceRate)}`,
    ],
    benchmarks: [
      "Tempo saudável LP de captura: 60-120s",
      "Tempo crítico: <30s",
    ],
  }),
};

export const CRITICAL_RULES: CRORule[] = [
  ruleTrackingBroken,
  ruleConvVsHostMedian,
  ruleBounceCritical,
  ruleTimeCritical,
];
```

- [ ] **Step 4.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep -i cro-rules | head
```

Expected: nenhum erro.

- [ ] **Step 4.3: Smoke test — disparar regra com fixture**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
cat > /tmp/cro-smoke.ts << 'EOF'
import { CRITICAL_RULES } from "./src/lib/cro-rules";

const fixture = {
  host: "lp.suno.com.br",
  path: "/aniversario",
  url: "lp.suno.com.br/aniversario",
  users: 4000,
  sessions: 4200,
  engagedSessions: 1500,
  engagementRate: 0.36,
  avgSessionDuration: 28,
  bounceRate: 0.62,
  leadCount: 50,
  leadConvRate: 0.012,
  ctaCount: 0,
  ctaConvRate: 0,
};

const ctx = {
  hostMedians: { "lp.suno.com.br": 0.048 },
  hostTopLP: {
    "lp.suno.com.br": { ...fixture, path: "/eu-quero", leadConvRate: 0.071 },
  },
  previousPeriod: {},
  sourceBreakdown: [],
  rangeDays: 7,
};

for (const rule of CRITICAL_RULES) {
  if (rule.trigger(fixture, ctx)) {
    const p = rule.generate(fixture, ctx);
    console.log(`✓ Disparou: ${rule.id} → ${p.titulo}`);
  }
}
EOF
npx tsx /tmp/cro-smoke.ts
```

Expected: pelo menos a regra `conv-vs-host-median` dispara. Output esperado:
```
✓ Disparou: conv-vs-host-median → Conversão metade da mediana do host
```

- [ ] **Step 4.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/lib/cro-rules.ts
git commit -m "feat(cro): motor heurísticas - 4 regras críticas (tracking, conv, bounce, time)"
```

---

## Task 5: Motor de heurísticas — 5 regras de atenção

**Files:**
- Modify: `src/lib/cro-rules.ts`

- [ ] **Step 5.1: Adicionar 5 regras de atenção ao final de cro-rules.ts**

Adicionar antes de `export const CRITICAL_RULES`:

```typescript
// ------------ Regras de ATENÇÃO ------------

const ruleConvBelowMedian: CRORule = {
  id: "conv-below-median",
  priority: "atencao",
  category: "conversion",
  trigger: (lp, ctx) => {
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 &&
      lp.leadConvRate < median * 0.75 && lp.leadConvRate >= median * 0.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    return {
      rule_id: "conv-below-median",
      proposal_key: makeKey(lp, "conv-below-median"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "atencao",
      category: "conversion",
      titulo: "Conversão abaixo da mediana do host",
      hipotese: `LP \`${lp.path}\` converte **${pct(lp.leadConvRate)}** vs mediana **${pct(median)}** do host. Gap de ${pct(median - lp.leadConvRate)} no host.`,
      acaoSugerida: `Testar variação A/B do copy do CTA + revisar campos do formulário (reduzir atrito). Trocar 1 campo por vez.`,
      effort: "baixo",
      impactoEstimado: impactoFechaGapMediana(lp, median, ctx.rangeDays),
      sinaisDetalhados: [
        `Conv. lead: ${pct(lp.leadConvRate)}`,
        `Mediana host: ${pct(median)}`,
        `Gap: ${pct(median - lp.leadConvRate)}`,
        `Sessões: ${fmt(lp.sessions)}`,
      ],
      benchmarks: [`Mediana \`${lp.host}\`: ${pct(median)}`],
    };
  },
};

const ruleBounceHigh: CRORule = {
  id: "bounce-high",
  priority: "atencao",
  category: "engagement",
  trigger: (lp) =>
    lp.sessions >= 100 && lp.bounceRate > 0.55 && lp.bounceRate <= 0.7,
  generate: (lp): Proposal => ({
    rule_id: "bounce-high",
    proposal_key: makeKey(lp, "bounce-high"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "atencao",
    category: "engagement",
    titulo: "Rejeição moderada — hero pode estar abaixo da dobra",
    hipotese: `Bounce de **${pct(lp.bounceRate)}** indica usuário sai sem rolar. Possível CTA abaixo da dobra ou hero pouco atrativo.`,
    acaoSugerida: `Testar versão com CTA visível sem scroll + reforçar headline na primeira dobra.`,
    effort: "medio",
    impactoEstimado: impactoQualitativo("moderado"),
    sinaisDetalhados: [
      `Bounce: ${pct(lp.bounceRate)}`,
      `Sessões: ${fmt(lp.sessions)}`,
      `Tempo médio: ${lp.avgSessionDuration.toFixed(0)}s`,
    ],
    benchmarks: ["Bounce saudável LP captura: 30-55%"],
  }),
};

const ruleTimeShort: CRORule = {
  id: "time-short",
  priority: "atencao",
  category: "engagement",
  trigger: (lp) =>
    lp.sessions >= 100 && lp.avgSessionDuration >= 20 && lp.avgSessionDuration < 60,
  generate: (lp): Proposal => ({
    rule_id: "time-short",
    proposal_key: makeKey(lp, "time-short"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "atencao",
    category: "engagement",
    titulo: "Sessão curta — usuário não chega no CTA",
    hipotese: `Tempo médio de **${lp.avgSessionDuration.toFixed(0)}s** sugere que usuário lê parte do conteúdo mas não chega no CTA. CTA pode estar longe demais.`,
    acaoSugerida: `Mover CTA pra mais cedo na página OU repetir CTA ao longo do scroll (após cada bloco de prova social).`,
    effort: "baixo",
    impactoEstimado: impactoQualitativo("moderado"),
    sinaisDetalhados: [
      `Tempo médio: ${lp.avgSessionDuration.toFixed(0)}s`,
      `Sessões: ${fmt(lp.sessions)}`,
      `Engajamento: ${pct(lp.engagementRate)}`,
    ],
    benchmarks: ["Tempo saudável: 60-120s"],
  }),
};

const ruleEngagementLow: CRORule = {
  id: "engagement-low",
  priority: "atencao",
  category: "engagement",
  trigger: (lp) => lp.sessions >= 100 && lp.engagementRate < 0.4,
  generate: (lp): Proposal => ({
    rule_id: "engagement-low",
    proposal_key: makeKey(lp, "engagement-low"),
    lp: { url: lp.url, host: lp.host, path: lp.path },
    priority: "atencao",
    category: "engagement",
    titulo: "Engajamento baixo — pouca interação",
    hipotese: `Engajamento de **${pct(lp.engagementRate)}** (vs 50%+ esperado) indica usuário não interage com elementos da página. Conteúdo pode ser estático demais.`,
    acaoSugerida: `Adicionar elementos interativos: vídeo curto (15-30s) acima da dobra, prova social com depoimentos visíveis, ou animação leve no CTA.`,
    effort: "medio",
    impactoEstimado: impactoQualitativo("moderado"),
    sinaisDetalhados: [
      `Engagement rate: ${pct(lp.engagementRate)}`,
      `Engaged sessions: ${fmt(lp.engagedSessions)} / ${fmt(lp.sessions)}`,
    ],
    benchmarks: ["Engagement saudável: >50%"],
  }),
};

const ruleRegressionWeek: CRORule = {
  id: "regression-week",
  priority: "atencao",
  category: "conversion",
  trigger: (lp, ctx) => {
    const prev = ctx.previousPeriod[lp.url];
    if (!prev || prev.leadConvRate === 0 || lp.sessions < 100) return false;
    const delta = (prev.leadConvRate - lp.leadConvRate) / prev.leadConvRate;
    return delta > 0.2;
  },
  generate: (lp, ctx): Proposal => {
    const prev = ctx.previousPeriod[lp.url];
    const dropPP = ((prev.leadConvRate - lp.leadConvRate) * 100).toFixed(1);
    return {
      rule_id: "regression-week",
      proposal_key: makeKey(lp, "regression-week"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "atencao",
      category: "conversion",
      titulo: "Regressão vs período anterior",
      hipotese: `Conv. caiu de **${pct(prev.leadConvRate)}** (período anterior) para **${pct(lp.leadConvRate)}** atual — queda de ${dropPP}pp.`,
      acaoSugerida: `Investigar o que mudou no período: novos criativos de mídia, alteração da LP, mudança de tracking. Reverter se for regressão de tracking; se for criativo, ajustar.`,
      effort: "medio",
      impactoEstimado: `Recuperar ${dropPP}pp pra voltar ao patamar anterior`,
      sinaisDetalhados: [
        `Atual: ${pct(lp.leadConvRate)}`,
        `Anterior (mesmo range): ${pct(prev.leadConvRate)}`,
        `Queda: ${dropPP}pp`,
        `Sessões atuais: ${fmt(lp.sessions)} | anteriores: ${fmt(prev.sessions)}`,
      ],
      benchmarks: [`Período anterior: ${pct(prev.leadConvRate)}`],
    };
  },
};

export const ATTENTION_RULES: CRORule[] = [
  ruleConvBelowMedian,
  ruleBounceHigh,
  ruleTimeShort,
  ruleEngagementLow,
  ruleRegressionWeek,
];
```

- [ ] **Step 5.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep -i cro-rules | head
```

Expected: nenhum erro.

- [ ] **Step 5.3: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/lib/cro-rules.ts
git commit -m "feat(cro): motor heurísticas - 5 regras de atenção"
```

---

## Task 6: Motor de heurísticas — 2 regras otimização + export final

**Files:**
- Modify: `src/lib/cro-rules.ts`

- [ ] **Step 6.1: Adicionar 2 regras otimização ao final**

Adicionar antes do bloco final de exports:

```typescript
// ------------ Regras de OTIMIZAÇÃO ------------

const ruleReplicateWinner: CRORule = {
  id: "replicate-winner",
  priority: "otimizacao",
  category: "conversion",
  trigger: (lp, ctx) => {
    const median = ctx.hostMedians[lp.host] || 0;
    return median > 0 && lp.sessions >= 100 && lp.leadConvRate > median * 1.5;
  },
  generate: (lp, ctx): Proposal => {
    const median = ctx.hostMedians[lp.host] || 0;
    const ratio = (lp.leadConvRate / median).toFixed(1);
    return {
      rule_id: "replicate-winner",
      proposal_key: makeKey(lp, "replicate-winner"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "otimizacao",
      category: "conversion",
      titulo: "LP top do host — replicar elementos vencedores",
      hipotese: `LP \`${lp.path}\` converte **${pct(lp.leadConvRate)}** (${ratio}x a mediana do host \`${lp.host}\`). Identificar e replicar elementos vencedores.`,
      acaoSugerida: `Documentar elementos diferenciados dessa LP: hero, CTA, copy do formulário, ordem de prova social. Propor sprint pra aplicar nas LPs abaixo da mediana.`,
      effort: "alto",
      impactoEstimado: impactoQualitativo("alto"),
      sinaisDetalhados: [
        `Conv. lead: ${pct(lp.leadConvRate)}`,
        `Mediana host: ${pct(median)}`,
        `Ratio: ${ratio}x acima`,
        `Sessões: ${fmt(lp.sessions)}`,
      ],
      benchmarks: [`Mediana host: ${pct(median)}`, `LP top: ${pct(lp.leadConvRate)}`],
    };
  },
};

const ruleChannelMismatch: CRORule = {
  id: "channel-mismatch",
  priority: "otimizacao",
  category: "channel",
  trigger: (lp, ctx) => {
    const lpSources = ctx.sourceBreakdown.filter((s) => s.url === lp.url);
    if (lpSources.length < 2) return false;
    const sorted = [...lpSources].sort((a, b) => b.sessions - a.sessions);
    const top = sorted[0];
    if (top.sessions < 200) return false;
    // Compara com mediana de conv das outras fontes (usa leadCount estimado proporcional)
    // Simplificação: usa share de leadCount pelo share de sessions
    const otherSessions = sorted.slice(1).reduce((a, b) => a + b.sessions, 0);
    if (otherSessions === 0) return false;
    // Heurística simples: se top source tem >40% das sessões mas <30% dos leads
    const topShareSessions = top.sessions / lp.sessions;
    // Sem leadCount por source, dispara só por desproporção alta de tráfego top
    return topShareSessions > 0.5 && lp.leadConvRate < (ctx.hostMedians[lp.host] || 0) * 0.7;
  },
  generate: (lp, ctx): Proposal => {
    const lpSources = ctx.sourceBreakdown.filter((s) => s.url === lp.url);
    const top = [...lpSources].sort((a, b) => b.sessions - a.sessions)[0];
    return {
      rule_id: "channel-mismatch",
      proposal_key: makeKey(lp, "channel-mismatch"),
      lp: { url: lp.url, host: lp.host, path: lp.path },
      priority: "otimizacao",
      category: "channel",
      titulo: `LP pode não casar com tráfego ${top.source}/${top.medium}`,
      hipotese: `${pct(top.sessions / lp.sessions)} do tráfego dessa LP vem de \`${top.source}/${top.medium}\`, mas a conv geral está abaixo do esperado. A mensagem do anúncio dessa origem pode estar desalinhada.`,
      acaoSugerida: `Auditar criativos da origem \`${top.source}\` e comparar com hero da LP. Se desalinhado, fazer LP dedicada pra essa origem OU ajustar criativo pra refletir o conteúdo real.`,
      effort: "medio",
      impactoEstimado: impactoQualitativo("moderado"),
      sinaisDetalhados: [
        `Top origem: ${top.source}/${top.medium} (${pct(top.sessions / lp.sessions)} do tráfego)`,
        `Sessões top: ${fmt(top.sessions)} / ${fmt(lp.sessions)}`,
        `Conv. lead LP: ${pct(lp.leadConvRate)}`,
      ],
      benchmarks: [
        `Mediana host: ${pct(ctx.hostMedians[lp.host] || 0)}`,
      ],
    };
  },
};

export const OPTIMIZATION_RULES: CRORule[] = [
  ruleReplicateWinner,
  ruleChannelMismatch,
];

// ------------ Export consolidado ------------

export const ALL_RULES: CRORule[] = [
  ...CRITICAL_RULES,
  ...ATTENTION_RULES,
  ...OPTIMIZATION_RULES,
];

/**
 * Aplica todas as regras em uma LP. Cada regra pode disparar 1 proposta.
 * Retorna array vazio se nenhuma dispara.
 */
export function applyRules(lp: LPData, ctx: RuleContext): Proposal[] {
  return ALL_RULES.filter((r) => r.trigger(lp, ctx)).map((r) => r.generate(lp, ctx));
}

/**
 * Aplica regras em todas as LPs do array. Retorna todas propostas geradas,
 * ordenadas por priority (critico > atencao > otimizacao) e dentro de cada
 * grupo por sessões desc.
 */
export function applyRulesAll(lps: LPData[], ctx: RuleContext): Proposal[] {
  const all: Proposal[] = [];
  for (const lp of lps) {
    all.push(...applyRules(lp, ctx));
  }
  const priorityOrder: Record<string, number> = {
    critico: 0,
    atencao: 1,
    otimizacao: 2,
  };
  // sort by priority, then by sessions of LP desc
  const sessionByUrl = new Map(lps.map((lp) => [lp.url, lp.sessions]));
  return all.sort((a, b) => {
    const dp = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (dp !== 0) return dp;
    return (sessionByUrl.get(b.lp.url) || 0) - (sessionByUrl.get(a.lp.url) || 0);
  });
}
```

- [ ] **Step 6.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep -i cro-rules | head
```

Expected: nenhum erro.

- [ ] **Step 6.3: Smoke test consolidado**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
cat > /tmp/cro-smoke2.ts << 'EOF'
import { applyRulesAll, ALL_RULES } from "./src/lib/cro-rules";

console.log("Total regras:", ALL_RULES.length);

const lps = [
  {
    host: "lp.suno.com.br", path: "/aniversario", url: "lp.suno.com.br/aniversario",
    users: 4000, sessions: 4200, engagedSessions: 1500, engagementRate: 0.36,
    avgSessionDuration: 28, bounceRate: 0.62, leadCount: 50, leadConvRate: 0.012,
    ctaCount: 0, ctaConvRate: 0,
  },
  {
    host: "lp.suno.com.br", path: "/eu-quero", url: "lp.suno.com.br/eu-quero",
    users: 800, sessions: 900, engagedSessions: 500, engagementRate: 0.55,
    avgSessionDuration: 110, bounceRate: 0.35, leadCount: 64, leadConvRate: 0.071,
    ctaCount: 0, ctaConvRate: 0,
  },
];

const ctx = {
  hostMedians: { "lp.suno.com.br": 0.048 },
  hostTopLP: { "lp.suno.com.br": lps[1] },
  previousPeriod: {},
  sourceBreakdown: [],
  rangeDays: 7,
};

const proposals = applyRulesAll(lps, ctx);
console.log(`Propostas geradas: ${proposals.length}`);
for (const p of proposals) {
  console.log(`  [${p.priority}] ${p.lp.path}: ${p.titulo}`);
}
EOF
npx tsx /tmp/cro-smoke2.ts
```

Expected: pelo menos 2-3 propostas geradas. Esperado que `/aniversario` dispare `conv-vs-host-median` (crítico) e que `/eu-quero` dispare `replicate-winner` (otimização).

Output esperado:
```
Total regras: 11
Propostas geradas: 2 (ou mais)
  [critico] /aniversario: Conversão metade da mediana do host
  [otimizacao] /eu-quero: LP top do host — replicar elementos vencedores
```

- [ ] **Step 6.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/lib/cro-rules.ts
git commit -m "feat(cro): motor heurísticas - regras otimização + applyRulesAll consolidado"
```

---

## Task 7: Ampliar /api/ga4/landing-pages com comparePreviousPeriod

**Files:**
- Modify: `src/app/api/ga4/landing-pages/route.ts`

- [ ] **Step 7.1: Ler o endpoint atual**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
cat src/app/api/ga4/landing-pages/route.ts | head -80
```

- [ ] **Step 7.2: Adicionar suporte ao comparePreviousPeriod**

Localizar o bloco onde o `dateRange` é construído (linha ~38-44) e adicionar lógica:

```typescript
// Após o cálculo do dateRange original, ADICIONAR:

const comparePreviousPeriod = req.nextUrl.searchParams.get("comparePreviousPeriod") === "true";

// Calcula o range anterior do mesmo tamanho
let previousDateRange: { startDate: string; endDate: string } | null = null;
if (comparePreviousPeriod) {
  // Calcula tamanho em dias
  const parseDate = (s: string): Date => {
    if (/^\d+daysAgo$/.test(s)) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(s, 10));
      return d;
    }
    if (s === "today") return new Date();
    return new Date(s);
  };
  const start = parseDate(dateRange.startDate);
  const end = parseDate(dateRange.endDate);
  const diffMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 dia antes do start atual
  const prevStart = new Date(prevEnd.getTime() - diffMs);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  previousDateRange = { startDate: fmt(prevStart), endDate: fmt(prevEnd) };
}
```

- [ ] **Step 7.3: Adicionar query do período anterior**

Após a chamada principal `pagesRes = await runReport(...)`, adicionar (em paralelo via Promise.all com leadsRes/ctaRes):

```typescript
// Modificar o Promise.all existente pra incluir o previousRes opcional
const [leadsRes, ctaRes, previousRes] = await Promise.all([
  runReport(propertyId, { /* ... query lead existente ... */ }),
  runReport(propertyId, { /* ... query cta existente ... */ }),
  comparePreviousPeriod && previousDateRange
    ? runReport(propertyId, {
        dateRanges: [previousDateRange],
        dimensions: [{ name: "hostName" }, { name: "landingPagePlusQueryString" }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit,
        ...(hostFilter ? { dimensionFilter: hostFilter } : {}),
      })
    : Promise.resolve({ data: null, error: null }),
]);
```

E construir o `pagesPrevious[]`:

```typescript
// Construir pagesPrevious (mesmo schema de pages, sem leadCount/ctaCount)
let pagesPrevious: typeof pages = [];
if (previousRes.data?.rows) {
  pagesPrevious = previousRes.data.rows.map((r) => {
    const host = r.dimensionValues?.[0]?.value || "(sem host)";
    const path = r.dimensionValues?.[1]?.value || "/";
    const sessions = Number(r.metricValues?.[1]?.value || 0);
    const engagedSessions = Number(r.metricValues?.[2]?.value || 0);
    return {
      host,
      path,
      url: `${host}${path}`,
      users: Number(r.metricValues?.[0]?.value || 0),
      sessions,
      engagedSessions,
      engagementRate: sessions > 0 ? engagedSessions / sessions : 0,
      avgSessionDuration: Number(r.metricValues?.[3]?.value || 0),
      bounceRate: Number(r.metricValues?.[4]?.value || 0),
      leadCount: 0,
      leadConvRate: 0,
      ctaCount: 0,
      ctaConvRate: 0,
    };
  });
}
```

- [ ] **Step 7.4: Incluir pagesPrevious no response JSON**

Modificar o `NextResponse.json({...})` final pra incluir:

```typescript
return NextResponse.json(
  {
    propertyId,
    pages,
    pagesPrevious,        // novo
    sourceBreakdown: filteredSourceRows,
    topSources,
    days,
    hostContains,
    hostsIn,
    leadEvent,
    ctaEvent,
    comparePreviousPeriod, // novo
    previousDateRange,     // novo
  },
  { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" } }
);
```

- [ ] **Step 7.5: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep landing-pages | head
```

Expected: sem erros.

- [ ] **Step 7.6: Smoke test via curl**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npm run dev &
sleep 8
# Substituir PROPERTY_ID pela property real do Suno Research
curl -s "http://localhost:3000/api/ga4/landing-pages?propertyId=PROPERTY_ID&hostsIn=lp.suno.com.br,lp2.suno.com.br&days=7&comparePreviousPeriod=true" | jq '. | {pages: (.pages | length), pagesPrevious: (.pagesPrevious | length), previousDateRange}'
kill %1
```

Expected: response com `pagesPrevious` populado com mesma quantidade ou menor de páginas.

- [ ] **Step 7.7: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/app/api/ga4/landing-pages/route.ts
git commit -m "feat(cro): ampliar /api/ga4/landing-pages com comparePreviousPeriod"
```

---

## Task 8: Endpoint /api/cro/lp-proposals

**Files:**
- Create: `src/app/api/cro/lp-proposals/route.ts`

- [ ] **Step 8.1: Criar o endpoint**

```typescript
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
 * POST body:
 *   {
 *     pages: LPData[],           // do /api/ga4/landing-pages
 *     pagesPrevious: LPData[],   // do mesmo endpoint com comparePreviousPeriod=true
 *     sourceBreakdown: SourceBreakdownRow[],
 *     rangeDays: number          // tamanho do range atual
 *   }
 *
 * Retorna:
 *   {
 *     proposals: Proposal[]      // ordenadas por priority + sessions desc
 *   }
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

  // Filtrar só LPs ativas (≥100 sessões) conforme spec
  const activeLPs = body.pages.filter((lp) => lp.sessions >= 100);

  // Calcular hostMedians (só LPs com volume relevante)
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
    // top LP do host (maior leadConvRate)
    const top = [...lpsOfHost].sort((a, b) => b.leadConvRate - a.leadConvRate)[0];
    if (top) hostTopLP[host] = top;
  }

  // Mapa previous period por url
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
    { proposals },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
```

- [ ] **Step 8.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep cro/lp-proposals | head
```

Expected: sem erros.

- [ ] **Step 8.3: Smoke test via curl**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npm run dev &
sleep 8
curl -s -X POST http://localhost:3000/api/cro/lp-proposals \
  -H "Content-Type: application/json" \
  -d '{
    "rangeDays": 7,
    "pages": [
      {"host":"lp.suno.com.br","path":"/aniv","url":"lp.suno.com.br/aniv","users":4000,"sessions":4200,"engagedSessions":1500,"engagementRate":0.36,"avgSessionDuration":28,"bounceRate":0.62,"leadCount":50,"leadConvRate":0.012,"ctaCount":0,"ctaConvRate":0},
      {"host":"lp.suno.com.br","path":"/win","url":"lp.suno.com.br/win","users":800,"sessions":900,"engagedSessions":500,"engagementRate":0.55,"avgSessionDuration":110,"bounceRate":0.35,"leadCount":64,"leadConvRate":0.071,"ctaCount":0,"ctaConvRate":0}
    ],
    "pagesPrevious": [],
    "sourceBreakdown": []
  }' | jq '.proposals | length'
kill %1
```

Expected: número de propostas geradas (>0).

- [ ] **Step 8.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/app/api/cro/lp-proposals/route.ts
git commit -m "feat(cro): endpoint POST /api/cro/lp-proposals - aplica motor heurísticas"
```

---

## Task 9: Wrapper de Vercel KV (cro-kv.ts)

**Files:**
- Create: `src/lib/cro-kv.ts`

- [ ] **Step 9.1: Criar wrapper KV**

```typescript
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
 * TTL: 30 dias. Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (seção 3.4)
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
    do {
      const res = await kv.scan(cursor, { match: pattern, count: 200 });
      cursor = res[0];
      keys.push(...res[1]);
    } while (cursor !== 0 && cursor !== "0");

    if (keys.length === 0) return [];

    const values = await Promise.all(
      keys.map((k) => kv.get<ProposalKVState>(k))
    );

    return keys
      .map((k, i) => {
        const value = values[i];
        if (!value) return null;
        // Extrai proposal_key do final da key
        const proposalKey = k.replace(`cro:proposal:${safePid}:`, "");
        return { proposalKey, state: value };
      })
      .filter((x): x is { proposalKey: string; state: ProposalKVState } => x !== null);
  } catch (e) {
    console.error("[cro-kv] listProposalStates falhou:", e);
    return [];
  }
}
```

- [ ] **Step 9.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep cro-kv | head
```

Expected: sem erros.

- [ ] **Step 9.3: Smoke test KV write + read + scan**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
cat > /tmp/kv-smoke.ts << 'EOF'
import { setProposalState, getProposalState, listProposalStates } from "./src/lib/cro-kv";

(async () => {
  const pid = "test-property-123";
  const pk = "abc123:tracking-broken";
  const state = {
    status: "accepted" as const,
    decidedAt: Date.now(),
    decidedBy: "test@suno.com",
    mondayItemId: "fake-001",
    mondayUrl: "https://suno.monday.com/boards/x/pulses/fake-001",
    snapshot: {
      leadConvRate: 0.012, bounceRate: 0.62, sessions: 4200,
      avgSessionDuration: 28, sinaisDetalhados: ["a", "b"],
    },
  };
  console.log("set:", await setProposalState(pid, pk, state));
  console.log("get:", await getProposalState(pid, pk));
  const list = await listProposalStates(pid);
  console.log("list count:", list.length);
})();
EOF
npx tsx -r dotenv/config /tmp/kv-smoke.ts dotenv_config_path=.env.local
```

Expected:
```
set: true
get: { status: 'accepted', ... }
list count: 1 (ou mais)
```

- [ ] **Step 9.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/lib/cro-kv.ts
git commit -m "feat(cro): wrapper Vercel KV pra acceptance state"
```

---

## Task 10: Endpoint /api/cro/proposal-state

**Files:**
- Create: `src/app/api/cro/proposal-state/route.ts`

- [ ] **Step 10.1: Criar endpoint GET + POST**

```typescript
// src/app/api/cro/proposal-state/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getProposalState,
  setProposalState,
  listProposalStates,
} from "@/lib/cro-kv";
import type { ProposalKVState } from "@/lib/cro-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/cro/proposal-state
 *
 * GET ?propertyId=... → lista todos os estados dessa property
 *   resposta: { entries: [{ proposalKey, state }] }
 *
 * POST body: { propertyId, proposalKey, status, mondayItemId?, mondayUrl?, snapshot }
 *   resposta: { ok: true }
 */

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  const entries = await listProposalStates(propertyId);
  return NextResponse.json({ entries });
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
```

- [ ] **Step 10.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep cro/proposal-state | head
```

Expected: sem erros.

- [ ] **Step 10.3: Smoke test endpoint**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npm run dev &
sleep 8
# POST
curl -s -X POST http://localhost:3000/api/cro/proposal-state \
  -H "Content-Type: application/json" \
  -d '{
    "propertyId":"test-prop",
    "proposalKey":"smoke:test",
    "status":"dismissed",
    "snapshot":{"leadConvRate":0.01,"bounceRate":0.6,"sessions":500,"avgSessionDuration":30,"sinaisDetalhados":["x"]}
  }' | jq

# GET
curl -s "http://localhost:3000/api/cro/proposal-state?propertyId=test-prop" | jq '.entries | length'
kill %1
```

Expected: POST retorna `{ok: true, state: {...}}`. GET retorna entries.length ≥ 1.

- [ ] **Step 10.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/app/api/cro/proposal-state/route.ts
git commit -m "feat(cro): endpoint GET/POST /api/cro/proposal-state"
```

---

## Task 11: Componente ProposalCard

**Files:**
- Create: `src/components/proposal-card.tsx`

- [ ] **Step 11.1: Criar componente isolado**

```typescript
// src/components/proposal-card.tsx
"use client";

import { motion } from "framer-motion";
import { AlertCircle, AlertTriangle, Sparkles, CheckCircle2, X, FileText, ExternalLink } from "lucide-react";
import type { Proposal } from "@/lib/cro-types";

/**
 * Card individual de uma proposta CRO.
 *
 * Renderiza priority badge + LP + hipótese + ação + impacto + 3 botões:
 * Aceitar (cria task Monday), Descartar (só persiste), Ver Detalhes (abre modal).
 *
 * Não faz chamadas — recebe handlers via props. Stateless puro.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (6.2, 6.3)
 */

export function ProposalCard({
  proposal,
  isAccepting,
  isDismissing,
  onAccept,
  onDismiss,
  onOpenDetails,
}: {
  proposal: Proposal;
  isAccepting?: boolean;
  isDismissing?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onOpenDetails: () => void;
}) {
  const priorityStyle = {
    critico: {
      border: "border-rose-300",
      bg: "bg-gradient-to-br from-rose-50 to-white",
      badge: "bg-rose-100 text-rose-800 border-rose-300",
      icon: <AlertCircle size={14} className="text-rose-600" />,
      label: "CRÍTICO",
    },
    atencao: {
      border: "border-amber-300",
      bg: "bg-gradient-to-br from-amber-50 to-white",
      badge: "bg-amber-100 text-amber-800 border-amber-300",
      icon: <AlertTriangle size={14} className="text-amber-600" />,
      label: "ATENÇÃO",
    },
    otimizacao: {
      border: "border-emerald-300",
      bg: "bg-gradient-to-br from-emerald-50 to-white",
      badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
      icon: <Sparkles size={14} className="text-emerald-600" />,
      label: "OTIMIZAÇÃO",
    },
  }[proposal.priority];

  // Renderização de estado já tratado
  if (proposal.status === "accepted") {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 opacity-70">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 size={14} className="text-emerald-500" />
          <span className="font-semibold">Aceita</span>
          <span>· {proposal.lp.path}</span>
          {proposal.mondayUrl && (
            <a
              href={proposal.mondayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[#7c5cff] hover:underline"
            >
              Ver no Monday <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    );
  }

  if (proposal.status === "dismissed") {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-3 opacity-40 hover:opacity-60 transition">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <X size={12} />
          <span>Descartada · {proposal.lp.path} · {proposal.titulo}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border-2 ${priorityStyle.border} ${priorityStyle.bg} p-4 hover:shadow-md transition`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${priorityStyle.badge}`}
        >
          {priorityStyle.icon}
          {priorityStyle.label}
        </span>
        <span className="font-mono text-sm font-semibold text-slate-900">{proposal.lp.path}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
          {proposal.lp.host}
        </span>
      </div>

      {/* Título */}
      <h3 className="text-sm font-bold text-slate-900 mb-2">{proposal.titulo}</h3>

      {/* Hipótese (truncada) */}
      <div className="text-xs text-slate-700 mb-3 line-clamp-2">
        {proposal.hipotese.replace(/[*`]/g, "")}
      </div>

      {/* Sinais (até 2) */}
      {proposal.sinaisDetalhados.length > 0 && (
        <ul className="text-[11px] text-slate-600 mb-3 space-y-0.5">
          {proposal.sinaisDetalhados.slice(0, 2).map((s, i) => (
            <li key={i} className="flex items-start gap-1">
              <span className="text-slate-400 mt-0.5">•</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Impacto + Effort */}
      <div className="flex items-center gap-3 text-[11px] font-semibold mb-3">
        <span className="text-emerald-700">📊 {proposal.impactoEstimado}</span>
        <span className="text-slate-500">⏱ Effort: {proposal.effort}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          disabled={isAccepting || isDismissing}
          className="flex-1 px-3 py-1.5 rounded-lg bg-[#7c5cff] hover:bg-[#6b4dff] text-white text-xs font-bold transition disabled:opacity-50"
        >
          {isAccepting ? "Criando task..." : "✓ Aceitar → Monday"}
        </button>
        <button
          onClick={onDismiss}
          disabled={isAccepting || isDismissing}
          className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition disabled:opacity-50"
        >
          {isDismissing ? "..." : "✕ Descartar"}
        </button>
        <button
          onClick={onOpenDetails}
          className="px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
          title="Ver detalhes"
        >
          <FileText size={13} />
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 11.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep proposal-card | head
```

Expected: sem erros.

- [ ] **Step 11.3: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/components/proposal-card.tsx
git commit -m "feat(cro): ProposalCard component"
```

---

## Task 12: Componente ProposalDetailsModal

**Files:**
- Create: `src/components/proposal-details-modal.tsx`

- [ ] **Step 12.1: Criar modal**

```typescript
// src/components/proposal-details-modal.tsx
"use client";

import { Dialog } from "@/components/dialog";
import { X } from "lucide-react";
import type { Proposal } from "@/lib/cro-types";

/**
 * Modal de detalhes expandidos de uma proposta.
 *
 * Mostra: dados completos, sinais detalhados (todos), benchmarks,
 * hipótese completa, ação sugerida formatada, + actions de aceitar/descartar.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (6.4)
 */

export function ProposalDetailsModal({
  proposal,
  open,
  onClose,
  onAccept,
  onDismiss,
  isAccepting,
  isDismissing,
}: {
  proposal: Proposal | null;
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  isAccepting?: boolean;
  isDismissing?: boolean;
}) {
  if (!proposal) return null;

  return (
    <Dialog open={open} onClose={onClose} title={proposal.titulo}>
      <div className="space-y-4 max-w-2xl">
        {/* LP info */}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono px-2 py-1 rounded bg-slate-100 text-slate-700">
            {proposal.lp.host}
          </span>
          <span className="font-mono font-bold text-slate-900">{proposal.lp.path}</span>
          <span
            className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              proposal.priority === "critico"
                ? "bg-rose-100 text-rose-700"
                : proposal.priority === "atencao"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {proposal.priority}
          </span>
        </div>

        {/* Hipótese */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Hipótese
          </h4>
          <div className="text-sm text-slate-800 whitespace-pre-wrap">
            {proposal.hipotese}
          </div>
        </div>

        {/* Ação sugerida */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Ação sugerida
          </h4>
          <div className="text-sm text-slate-800 whitespace-pre-wrap">
            {proposal.acaoSugerida}
          </div>
        </div>

        {/* Sinais detalhados (todos) */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Sinais detectados
          </h4>
          <ul className="text-xs text-slate-700 space-y-1">
            {proposal.sinaisDetalhados.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-slate-400 mt-0.5">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Benchmarks */}
        {proposal.benchmarks.length > 0 && (
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Benchmarks
            </h4>
            <ul className="text-xs text-slate-700 space-y-1">
              {proposal.benchmarks.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">→</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Impacto + Effort */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-500">Impacto estimado</div>
            <div className="text-sm font-bold text-emerald-700">{proposal.impactoEstimado}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-500">Effort</div>
            <div className="text-sm font-bold text-slate-700">{proposal.effort}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={onAccept}
            disabled={isAccepting || isDismissing}
            className="flex-1 px-4 py-2 rounded-lg bg-[#7c5cff] hover:bg-[#6b4dff] text-white text-sm font-bold transition disabled:opacity-50"
          >
            {isAccepting ? "Criando task no Monday..." : "✓ Aceitar e criar task"}
          </button>
          <button
            onClick={onDismiss}
            disabled={isAccepting || isDismissing}
            className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition disabled:opacity-50"
          >
            {isDismissing ? "Descartando..." : "Descartar"}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
            title="Fechar"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 12.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep proposal-details-modal | head
```

Expected: sem erros.

- [ ] **Step 12.3: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/components/proposal-details-modal.tsx
git commit -m "feat(cro): ProposalDetailsModal component"
```

---

## Task 13: Componente CROProposalsBoard (orquestrador)

**Files:**
- Create: `src/components/cro-proposals-board.tsx`

- [ ] **Step 13.1: Criar o componente principal**

```typescript
// src/components/cro-proposals-board.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Info, Loader2 } from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";
import { ProposalCard } from "@/components/proposal-card";
import { ProposalDetailsModal } from "@/components/proposal-details-modal";
import { SkeletonBlock, DataErrorCard } from "@/components/data-status";
import type { Proposal, LPData, SourceBreakdownRow } from "@/lib/cro-types";

// Mesma resolução de hostnames do LP Analyzer. Centralizar em /lib se replicar.
const LP_HOSTS_BY_PROPERTY: Array<{ match: string; hosts: string[] }> = [
  { match: "suno", hosts: ["lp.suno.com.br", "lp2.suno.com.br"] },
  { match: "status", hosts: ["lp.statusinvest.com.br", "lp2.statusinvest.com.br"] },
];

function resolveLPHosts(name: string | null | undefined): string[] | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const cfg of LP_HOSTS_BY_PROPERTY) {
    if (lower.includes(cfg.match)) return cfg.hosts;
  }
  return null;
}

const MAX_VISIBLE_CARDS = 10;

export function CROProposalsBoard() {
  const { selectedId, selected, useRealData, days, customRange } = useGA4();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalProposal, setModalProposal] = useState<Proposal | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"accept" | "dismiss" | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const hosts = resolveLPHosts(selected?.displayName);

  // Carrega proposals + states
  useEffect(() => {
    if (!selectedId || !useRealData || !hosts) {
      setProposals([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    const rangeDays = customRange?.startDate && customRange?.endDate
      ? Math.max(
          1,
          Math.round(
            (new Date(customRange.endDate).getTime() - new Date(customRange.startDate).getTime()) /
              (1000 * 60 * 60 * 24)
          ) + 1
        )
      : days;

    (async () => {
      try {
        // 1. Fetch LPs do GA4
        const qs = new URLSearchParams({
          propertyId: selectedId,
          hostsIn: hosts.join(","),
          comparePreviousPeriod: "true",
          leadEvent: "generate_lead",
          limit: "100",
        });
        if (customRange?.startDate && customRange?.endDate) {
          qs.set("startDate", customRange.startDate);
          qs.set("endDate", customRange.endDate);
        } else {
          qs.set("days", String(days));
        }
        const lpRes = await fetch(`/api/ga4/landing-pages?${qs.toString()}`, { signal: ctrl.signal });
        const lpData = await lpRes.json();
        if (lpData.error) throw new Error(lpData.error);

        // 2. Fetch state KV
        const stateRes = await fetch(
          `/api/cro/proposal-state?propertyId=${encodeURIComponent(selectedId)}`,
          { signal: ctrl.signal }
        );
        const stateData = await stateRes.json();
        const stateMap = new Map<string, { status: "accepted" | "dismissed"; mondayUrl?: string; decidedAt?: number }>();
        for (const e of stateData.entries || []) {
          stateMap.set(e.proposalKey, {
            status: e.state.status,
            mondayUrl: e.state.mondayUrl,
            decidedAt: e.state.decidedAt,
          });
        }

        // 3. POST pra motor de propostas
        const propRes = await fetch("/api/cro/lp-proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages: lpData.pages as LPData[],
            pagesPrevious: lpData.pagesPrevious as LPData[],
            sourceBreakdown: lpData.sourceBreakdown as SourceBreakdownRow[],
            rangeDays,
          }),
          signal: ctrl.signal,
        });
        const propData = await propRes.json();
        if (propData.error) throw new Error(propData.error);

        // 4. Merge state
        const merged = (propData.proposals as Proposal[]).map((p) => {
          const st = stateMap.get(p.proposal_key);
          if (st) {
            return { ...p, status: st.status, mondayUrl: st.mondayUrl, decidedAt: st.decidedAt };
          }
          return { ...p, status: "pending" as const };
        });

        setProposals(merged);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message || "erro");
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [selectedId, useRealData, days, customRange?.startDate, customRange?.endDate, hosts?.join(",")]);

  // Split pending vs tratadas
  const { pending, treated } = useMemo(() => {
    const p: Proposal[] = [];
    const t: Proposal[] = [];
    for (const x of proposals) {
      if (x.status === "pending" || !x.status) p.push(x);
      else t.push(x);
    }
    return { pending: p, treated: t };
  }, [proposals]);

  const visibleCards = pending.slice(0, MAX_VISIBLE_CARDS);
  const remainingCount = pending.length - visibleCards.length;

  async function handleAccept(p: Proposal) {
    if (!selectedId) return;
    setActingKey(p.proposal_key);
    setActionType("accept");
    try {
      // 1. Cria task no Monday
      const description = [
        `**LP:** \`${p.lp.url}\``,
        `**Prioridade:** ${p.priority}`,
        ``,
        `### Hipótese`,
        p.hipotese,
        ``,
        `### Ação sugerida`,
        p.acaoSugerida,
        ``,
        `### Sinais detectados`,
        p.sinaisDetalhados.map((s) => `- ${s}`).join("\n"),
        ``,
        `### Benchmarks`,
        p.benchmarks.map((b) => `- ${b}`).join("\n"),
        ``,
        `**Impacto estimado:** ${p.impactoEstimado}`,
        `**Effort:** ${p.effort}`,
        ``,
        `---`,
        `[Ver no painel](${typeof window !== "undefined" ? window.location.origin : ""}/cro?lp=${encodeURIComponent(p.lp.url)}#${p.proposal_key})`,
      ].join("\n");

      const mondayRes = await fetch("/api/monday/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[CRO] ${p.lp.path} — ${p.titulo}`,
          description,
        }),
      });
      const mondayData = await mondayRes.json();
      const mondayItemId = mondayData?.item?.id || mondayData?.itemId;
      const mondayUrl = mondayData?.item?.url || mondayData?.url;

      // 2. Persiste state KV
      await fetch("/api/cro/proposal-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedId,
          proposalKey: p.proposal_key,
          status: "accepted",
          mondayItemId,
          mondayUrl,
          snapshot: {
            leadConvRate: 0, // os campos vem do snapshot original; simplificação por hora
            bounceRate: 0,
            sessions: 0,
            avgSessionDuration: 0,
            sinaisDetalhados: p.sinaisDetalhados,
          },
        }),
      });

      // 3. Atualiza local state
      setProposals((prev) =>
        prev.map((x) =>
          x.proposal_key === p.proposal_key
            ? { ...x, status: "accepted" as const, mondayUrl }
            : x
        )
      );
      // Fecha modal se aberto nessa proposta
      if (modalProposal?.proposal_key === p.proposal_key) setModalProposal(null);
    } catch (e) {
      alert(`Falhou ao criar task: ${(e as Error).message}`);
    } finally {
      setActingKey(null);
      setActionType(null);
    }
  }

  async function handleDismiss(p: Proposal) {
    if (!selectedId) return;
    setActingKey(p.proposal_key);
    setActionType("dismiss");
    try {
      await fetch("/api/cro/proposal-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedId,
          proposalKey: p.proposal_key,
          status: "dismissed",
          snapshot: {
            leadConvRate: 0,
            bounceRate: 0,
            sessions: 0,
            avgSessionDuration: 0,
            sinaisDetalhados: p.sinaisDetalhados,
          },
        }),
      });
      setProposals((prev) =>
        prev.map((x) =>
          x.proposal_key === p.proposal_key ? { ...x, status: "dismissed" as const } : x
        )
      );
      if (modalProposal?.proposal_key === p.proposal_key) setModalProposal(null);
    } finally {
      setActingKey(null);
      setActionType(null);
    }
  }

  // Estados especiais
  if (!hosts) {
    return null; // Property sem hosts mapeados — não mostra board
  }
  if (!useRealData) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[color:var(--border)] bg-gradient-to-r from-violet-50 via-white to-indigo-50">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles size={18} className="text-[#7c5cff]" />
            Propostas CRO
            <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
              {loading ? "carregando..." : `${pending.length} pendente${pending.length !== 1 ? "s" : ""}`}
            </span>
          </h2>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs text-[color:var(--muted-foreground)] hover:text-slate-700 underline"
          >
            {showHistory ? "Ocultar" : "Ver"} histórico tratadas ({treated.length})
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="p-6 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonBlock key={i} height={180} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="p-6">
          <DataErrorCard
            meta={{ status: "error", propertyId: selectedId, propertyName: selected?.displayName || null, fetchedAt: null }}
            error={error}
          />
        </div>
      )}

      {/* Cards */}
      {!loading && !error && pending.length === 0 && (
        <div className="p-12 text-center text-sm text-[color:var(--muted-foreground)]">
          <span className="text-2xl">🎉</span>
          <div className="mt-2">Todas as LPs estão dentro dos parâmetros saudáveis.</div>
        </div>
      )}

      {!loading && !error && pending.length > 0 && (
        <div className="p-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleCards.map((p) => (
            <ProposalCard
              key={p.proposal_key}
              proposal={p}
              isAccepting={actingKey === p.proposal_key && actionType === "accept"}
              isDismissing={actingKey === p.proposal_key && actionType === "dismiss"}
              onAccept={() => handleAccept(p)}
              onDismiss={() => handleDismiss(p)}
              onOpenDetails={() => setModalProposal(p)}
            />
          ))}
        </div>
      )}

      {remainingCount > 0 && (
        <div className="px-6 py-3 border-t border-slate-100 text-center text-xs text-slate-500">
          +{remainingCount} propostas adicionais. Trate as visíveis primeiro.
        </div>
      )}

      {/* Histórico tratadas */}
      {showHistory && treated.length > 0 && (
        <div className="border-t border-slate-100 p-4 space-y-1.5 bg-slate-50/30">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Histórico
          </div>
          {treated.map((p) => (
            <ProposalCard
              key={p.proposal_key}
              proposal={p}
              onAccept={() => {}}
              onDismiss={() => {}}
              onOpenDetails={() => setModalProposal(p)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      <ProposalDetailsModal
        proposal={modalProposal}
        open={!!modalProposal}
        onClose={() => setModalProposal(null)}
        onAccept={() => modalProposal && handleAccept(modalProposal)}
        onDismiss={() => modalProposal && handleDismiss(modalProposal)}
        isAccepting={!!modalProposal && actingKey === modalProposal.proposal_key && actionType === "accept"}
        isDismissing={!!modalProposal && actingKey === modalProposal.proposal_key && actionType === "dismiss"}
      />
    </div>
  );
}
```

- [ ] **Step 13.2: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep cro-proposals-board | head
```

Expected: sem erros.

- [ ] **Step 13.3: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/components/cro-proposals-board.tsx
git commit -m "feat(cro): CROProposalsBoard component - orquestrador principal"
```

---

## Task 14: Plugar CROProposalsBoard em /cro/page.tsx

**Files:**
- Modify: `src/app/cro/page.tsx`

- [ ] **Step 14.1: Adicionar import**

Adicionar perto dos outros imports do `src/components`:

```typescript
import { CROProposalsBoard } from "@/components/cro-proposals-board";
```

- [ ] **Step 14.2: Inserir o componente acima do LPAnalyzer**

Localizar o JSX onde `<LPAnalyzer />` está sendo renderizado (foi adicionado em Task #32 anterior). Inserir imediatamente antes:

```tsx
{/* CRO Automation — propostas data-driven */}
<div className="mb-8">
  <CROProposalsBoard />
</div>

{/* LP Analyzer — análise detalhada de LPs */}
<div className="mb-8">
  <LPAnalyzer />
</div>
```

- [ ] **Step 14.3: Verificar TypeScript**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | head -10
```

Expected: sem erros.

- [ ] **Step 14.4: Smoke test no browser**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npm run dev
```

Abrir http://localhost:3000/cro no browser. Selecionar property "Suno Research – Web" no header. Confirmar:
- Board "Propostas CRO" aparece acima do LP Analyzer
- Loading skeleton aparece
- Após carregar, cards aparecem (se houver LPs ativas com sinais)
- Clicar em "Ver detalhes" abre modal
- Clicar em "Aceitar" cria task no Monday (verificar no board)
- Clicar em "Descartar" remove o card visualmente

- [ ] **Step 14.5: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/app/cro/page.tsx
git commit -m "feat(cro): plugar CROProposalsBoard na aba /cro"
```

---

## Task 15: Ampliar LPAnalyzer com breakdown de origem por LP

**Files:**
- Modify: `src/components/lp-analyzer.tsx`

- [ ] **Step 15.1: Receber sourceBreakdown via prop ou fetch interno**

Como o LPAnalyzer já chama `/api/ga4/landing-pages` internamente e recebe `sourceBreakdown`, basta usar o dado que já está sendo retornado.

Localizar o `useEffect` que faz fetch e armazenar `sourceBreakdown` no state.

```typescript
// Estado adicional
const [sourceBreakdown, setSourceBreakdown] = useState<Array<{ host: string; path: string; url: string; source: string; medium: string; sessions: number; users: number }>>([]);

// No .then(d => ...) do fetch, adicionar:
setSourceBreakdown(d.sourceBreakdown || []);
```

- [ ] **Step 15.2: Adicionar seção de breakdown no row expandido**

Localizar onde `LPRow` mostra o conteúdo expandido (após clique). Adicionar uma seção:

```tsx
{/* Breakdown por origem — só top 5 sources com mais sessões nessa LP */}
{(() => {
  const lpSources = sourceBreakdown
    .filter((s) => s.url === row.url)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);

  if (lpSources.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        Top origens nessa LP
      </h5>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-slate-500">
            <th className="text-left font-semibold py-1">Origem</th>
            <th className="text-right font-semibold py-1">Sessões</th>
            <th className="text-right font-semibold py-1">% da LP</th>
          </tr>
        </thead>
        <tbody>
          {lpSources.map((s, i) => (
            <tr key={i} className="border-t border-slate-50">
              <td className="py-1 font-mono">
                {s.source}/{s.medium}
              </td>
              <td className="py-1 text-right tabular-nums">{s.sessions.toLocaleString("pt-BR")}</td>
              <td className="py-1 text-right tabular-nums text-slate-600">
                {((s.sessions / row.sessions) * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
})()}
```

Passar `sourceBreakdown` como prop pra `LPRow` ou via closure se estiver no mesmo escopo.

- [ ] **Step 15.3: Verificar TypeScript + smoke browser**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
npx tsc --noEmit 2>&1 | grep lp-analyzer | head
npm run dev
```

Browser http://localhost:3000/cro → expandir uma LP → confirmar que tabela de origens aparece.

- [ ] **Step 15.4: Commit**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git add src/components/lp-analyzer.tsx
git commit -m "feat(cro): LPAnalyzer mostra breakdown top 5 origens por LP expandida"
```

---

## Task 16: Push final + deploy

- [ ] **Step 16.1: Verificar status do branch**

Run:
```bash
cd C:/Users/RenanLiza/suno-dashboard
git status
git log --oneline -20
```

Expected: working tree clean, commits acumulados desde o início do plano.

- [ ] **Step 16.2: Push pra remote**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git push
```

Vercel auto-deploy vai disparar.

- [ ] **Step 16.3: Aguardar deploy e validar em produção**

Aguardar ~2 min, então abrir https://suno-dashboard-painel.vercel.app/cro

Confirmar:
- Board "Propostas CRO" aparece
- Property "Suno Research – Web" gera propostas
- Property "Statusinvest – Web" também gera (se tiver volume)
- Aceitar uma proposta cria task no board Monday configurado
- Descartar uma proposta a esmaece visualmente
- Recarregar a página mantém o estado (KV funcionando)

- [ ] **Step 16.4: Update final TASKLIST + DEFINITION OF DONE**

Marcar como concluídos no spec:
- 11 regras implementadas (12 menos `dead-clicks-high` que ficou pra v2)
- Endpoints funcionais
- Componentes renderizando
- Monday integration validada
- Vercel KV configurado
- Deploy validado

- [ ] **Step 16.5: Tag de release**

```bash
cd C:/Users/RenanLiza/suno-dashboard
git tag -a v1-cro-automation -m "Release v1: CRO Automation feature (LP proposals + Monday integration)"
git push --tags
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Detecção LPs ativas (≥100 sessions) — Task 8 (filtro no endpoint)
- ✅ Motor 12 heurísticas — Tasks 4, 5, 6 (entregou 11; `dead-clicks-high` ficou marcado pra v2)
- ✅ 4 dimensões de comparação — Task 8 (hostMedian, hostTopLP, previousPeriod, sourceBreakdown via ctx)
- ✅ Cards prioritários — Task 13 (MAX_VISIBLE_CARDS=10, sorted by priority)
- ✅ Aceitar → Monday — Task 13 handler `handleAccept`
- ✅ Persistir estado KV — Tasks 9, 10
- ✅ Range-aware — Task 13 effect deps include customRange
- ✅ Modal detalhes — Task 12
- ✅ Breakdown origem em LPAnalyzer — Task 15
- ✅ comparePreviousPeriod no endpoint — Task 7

**Placeholder scan:** sem TODOs/TBDs/FIXMEs no plano

**Type consistency:** `Proposal` definido em Task 2, usado em todas as tasks subsequentes. `LPData`, `RuleContext` consistentes. `proposal_key` é a key estável usada tanto no motor quanto no KV.

**Gaps remanescentes (documentar como v2):**
- `dead-clicks-high` (depende de integração Clarity — fora do escopo v1)
- Testes formais (Vitest não instalado; smoke tests manuais cobrem)
- E2E Playwright (v2)
- Migrar handler `handleAccept` pra snapshot completo (atualmente snapshot fica vazio — preencher quando tiver mais dados no Proposal)

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-04-cro-automation.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — eu dispatch um subagent fresco por task, revisão entre tasks, iteração rápida. Cada task vira um agente independente sem context contamination.

**2. Inline Execution** — executo as 16 tasks nessa sessão usando o skill `executing-plans`, com checkpoints pra você revisar.

**Qual você quer?**
