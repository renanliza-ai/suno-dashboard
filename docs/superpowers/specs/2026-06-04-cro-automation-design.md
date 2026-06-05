# Design — CRO Automation (LP Analysis com Propostas Acionáveis)

**Data:** 2026-06-04
**Status:** Approved (brainstorming)
**Owner:** Renan Liza (Marketing Suno)
**Próximo passo:** invocar `writing-plans` para criar plano de implementação

---

## 1. Visão Geral

Sistema na aba `/cro` que analisa automaticamente todas as **landing pages ativas** (≥100 sessões no range) por property selecionada (Suno Research ou Statusinvest) e gera **propostas de CRO data-driven** baseadas em heurísticas rodando sobre dados GA4 ao vivo.

Cada proposta inclui hipótese, ação sugerida, impacto estimado e effort, e pode ser aceita com um clique → cria task no Monday.com automaticamente. O estado de aceitação/descarte é persistido em Vercel KV para não regenerar propostas já tratadas.

---

## 2. Objetivos e Não-Objetivos

### Objetivos (v1)

1. **Identificar LPs ativas** em hostnames de captura (`lp.suno.com.br`, `lp2.suno.com.br`, `lp.statusinvest.com.br`, `lp2.statusinvest.com.br`) com ≥100 sessões no range
2. **Gerar propostas priorizadas** via motor de heurísticas (12 regras categorizadas em crítico / atenção / otimização)
3. **Comparativos multi-dimensão** por LP:
   - vs. mediana do host
   - vs. período anterior equivalente
   - vs. benchmark de mercado fixo (regra implícita nas condições)
   - vs. performance por origem/campanha
4. **UI quick-view** — cards prioritários no topo + lista detalhada abaixo
5. **Aceitar proposta → cria task Monday** com título + descrição markdown completa
6. **Persistir estado** de aceite/descarte (Vercel KV) com TTL 30 dias
7. **Range-aware** — toda análise respeita o `dateRange` do header

### Não-Objetivos (v1)

- Snapshots persistidos de dados raw (a abordagem é "dados ao vivo do GA4 + estado das decisões persistido")
- Geração de propostas por IA/LLM (Gemini etc) — fica para v2 se houver demanda
- Cron job semanal (não há job; "semanal" significa que a janela default é últimos 7d)
- Kanban / fluxo multi-estado de propostas (binário aceito/descartado)

---

## 3. Arquitetura

### 3.1 Diagrama de componentes

```
┌──────────────────────────────────────────────────────────────────┐
│  ABA /cro (Next.js client)                                        │
│                                                                   │
│  ┌─────────────────────────┐  ┌────────────────────────────────┐ │
│  │ CROProposalsBoard       │  │ LPAnalyzer (ampliado)          │ │
│  │ — cards top 10          │  │ — lista detalhada de todas LPs │ │
│  │ — accept / dismiss      │  │ — adiciona breakdown por       │ │
│  │ — modal detalhes        │  │   origem/campanha              │ │
│  └──────────┬──────────────┘  └────────────┬───────────────────┘ │
│             │                                │                    │
└─────────────┼────────────────────────────────┼────────────────────┘
              │                                │
              ▼                                ▼
   ┌─────────────────────────┐    ┌──────────────────────────────┐
   │ /api/cro/lp-proposals   │    │ /api/ga4/landing-pages       │
   │ (NOVO)                  │    │ (existente — ampliar)        │
   │                         │    │                              │
   │ in: pages[] + breakdown │    │ in: hostsIn, range,          │
   │ apply 12 rules          │    │     comparePreviousPeriod    │
   │ out: proposals[]        │    │ out: pages[], pagesPrev[],   │
   │                         │    │      sourceBreakdown[]       │
   └────────────┬────────────┘    └──────────────┬───────────────┘
                │                                │
                ▼                                │
   ┌─────────────────────────┐                  │
   │ /api/cro/proposal-state │                  │
   │ (NOVO)                  │                  │
   │                         │                  │
   │ GET — list dismissed    │                  │
   │       + accepted IDs    │                  │
   │ POST — save status      │                  │
   └────────────┬────────────┘                  │
                │                                │
                ▼                                ▼
       ┌──────────────────┐              ┌────────────────────┐
       │ Vercel KV (Redis)│              │ GA4 Data API       │
       │ — TTL 30d        │              │ (existente)        │
       └──────────────────┘              └────────────────────┘

   Quando user aceita:
   ┌─────────────────────────┐
   │ /api/monday/create-task │ ← reusa endpoint existente
   │ (existente)             │
   └─────────────────────────┘
```

### 3.2 Endpoints

| Endpoint | Método | Status | Mudança |
|---|---|---|---|
| `/api/ga4/landing-pages` | GET | Existente | **Ampliar:** adicionar param `comparePreviousPeriod=true` → retorna `pagesPrevious[]` com mesmo schema mas range deslocado |
| `/api/cro/lp-proposals` | POST | **Novo** | Recebe `{ pages, pagesPrevious, sourceBreakdown }` e retorna `proposals[]` ordenadas por priority |
| `/api/cro/proposal-state` | GET, POST | **Novo** | GET retorna estado de propostas (KV); POST atualiza |
| `/api/monday/create-task` | POST | Existente | Reusar como está |

### 3.3 Componentes Frontend

| Componente | Path | Responsabilidade |
|---|---|---|
| `CROProposalsBoard` | `src/components/cro-proposals-board.tsx` (novo) | Renderiza até 10 cards prioritários. Gerencia estado de loading, accept/dismiss, modal detalhes |
| `ProposalCard` | inline em `cro-proposals-board.tsx` | Card individual com priority badge, hipótese, impacto, actions |
| `ProposalDetailsModal` | `src/components/proposal-details-modal.tsx` (novo) | Modal expandido com sinais, dados, benchmarks, hipótese completa |
| `LPAnalyzer` | `src/components/lp-analyzer.tsx` (existente) | **Ampliar:** adicionar coluna/seção de breakdown por origem |

### 3.4 Storage (Vercel KV)

**Decisão:** Vercel KV (Redis serverless). Já disponível no projeto Vercel free tier.

**Schema:**

```typescript
// Key pattern
type KVKey = `cro:proposal:${propertyId}:${lpUrlHash}:${ruleId}`;

// Onde:
// - propertyId: ex. "properties/123456789"
// - lpUrlHash: SHA-256 first 8 chars de "lp.suno.com.br/aniversario" → "a3f9b2c1"
// - ruleId: ex. "conv-vs-host-median"

// Value
type KVValue = {
  status: "accepted" | "dismissed";
  decidedAt: number;             // unix timestamp ms
  decidedBy: string;             // email do usuário (vem do auth)
  mondayItemId?: string;         // se accepted
  mondayUrl?: string;            // link clicável pra task
  snapshot: {                    // auditoria — dados que geraram a proposta
    leadConvRate: number;
    bounceRate: number;
    sessions: number;
    avgSessionDuration: number;
    sinaisDetalhados: string[];
  };
};

// TTL: 30 dias (2.592.000 segundos)
// Rotação natural — se a proposta voltar depois de 30d, é considerada nova
```

**Composição de key:** `lpUrlHash + ruleId` garante que se o mesmo problema reaparecer em outra LP, gera nova entrada. Se sumir e voltar (regressão), conta como novo após TTL.

---

## 4. Motor de Heurísticas (12 regras)

### 4.1 Estrutura comum de uma regra

```typescript
type CRORule = {
  id: string;                          // "conv-vs-host-median"
  priority: "critico" | "atencao" | "otimizacao";
  category: "tracking" | "engagement" | "conversion" | "channel";
  trigger: (lp: LPData, context: RuleContext) => boolean;
  generate: (lp: LPData, context: RuleContext) => Proposal;
};

type RuleContext = {
  hostMedians: Record<string, number>;          // mediana de leadConvRate por host
  hostTopLP: Record<string, LPData>;            // top LP por conv de cada host
  previousPeriod: Record<string, LPData>;       // LP versão período anterior
  sourceBreakdown: SourceBreakdownRow[];        // LP × source/medium × sessions × conv
};

type Proposal = {
  rule_id: string;
  proposal_key: string;                // hash composta — vira KV key
  lp: { url: string; host: string; path: string };
  priority: "critico" | "atencao" | "otimizacao";
  titulo: string;
  hipotese: string;                    // markdown ~3-4 linhas
  acaoSugerida: string;                // markdown ~2-3 linhas
  effort: "baixo" | "medio" | "alto";
  impactoEstimado: string;             // ex: "+3.6pp conv (~180 leads/mês)"
  sinaisDetalhados: string[];          // lista de sinais que dispararam
  benchmarks: string[];                // lista de comparativos
  status?: "pending" | "accepted" | "dismissed";  // populado do KV
  mondayUrl?: string;
};
```

### 4.2 Catálogo de regras

#### Críticas

| ID | Trigger | Effort |
|---|---|---|
| `tracking-broken` | `sessions ≥ 500 && leadCount === 0 && ctaCount === 0` | baixo (operacional) |
| `conv-vs-host-median` | `leadConvRate < hostMedian * 0.5 && sessions ≥ 100` | médio |
| `bounce-critical` | `bounceRate > 70% && sessions ≥ 200` | médio |
| `time-critical` | `avgSessionDuration < 20s && sessions ≥ 200` | baixo (copy) |

#### Atenção

| ID | Trigger | Effort |
|---|---|---|
| `conv-below-median` | `leadConvRate < hostMedian * 0.75 && sessions ≥ 100` | baixo |
| `bounce-high` | `bounceRate ∈ [55%, 70%] && sessions ≥ 100` | médio |
| `time-short` | `avgSessionDuration ∈ [20s, 60s] && sessions ≥ 100` | baixo |
| `engagement-low` | `engagementRate < 40% && sessions ≥ 100` | médio |
| `regression-week` | `(leadConvRatePrev - leadConvRate) / leadConvRatePrev > 0.2 && sessions ≥ 100` | médio (investigativo) |

#### Otimização

| ID | Trigger | Effort |
|---|---|---|
| `replicate-winner` | `leadConvRate > hostMedian * 1.5 && sessions ≥ 100` | alto (replicação) |
| `channel-mismatch` | `topSource.conv < otherSources.median * 0.5 && topSource.sessions > 200` | médio |
| `dead-clicks-high` | (v2 — depende de integração Clarity) | médio |

### 4.3 Cálculo de `impactoEstimado`

Para regras de conversão:

```
impacto_pp = hostMedian - leadConvRate
leads_extras_mes = (impacto_pp / 100) * (sessions / range_days) * 30
output: "+{impacto_pp}pp conv (~{leads_extras_mes} leads/mês)"
```

Para regras de bounce/tempo: impacto qualitativo ("alto potencial", "moderado"), não quantitativo.

### 4.4 Ordem de prioridade nos cards

1. Críticas (priority=critico) primeiro, ordenadas por `sessions` desc
2. Atenção, ordenadas por `sessions` desc
3. Otimização, ordenadas por `sessions` desc

Máximo de **10 cards visíveis** no `CROProposalsBoard`. Resto fica acessível via "Ver todas (N)".

### 4.5 Filtragem de propostas já tratadas

Após gerar `proposals[]`, fazemos GET no `/api/cro/proposal-state?propertyId={id}` que retorna lista de `proposal_keys` com status `accepted` ou `dismissed`.

Propostas com `status !== "pending"` ainda são incluídas no array mas **marcadas** com badge "✓ Aceita (link Monday)" ou "✕ Descartada". Não preenchem slots de cards top — preenchidas em "Ver histórico" oculto.

---

## 5. Data Flow Detalhado

### 5.1 Abertura da aba `/cro`

```
1. /cro mount
2. Lê { propertyId, propertyName, dateRange } do ga4-context
3. Resolve hostnames do property (lp.suno+lp2.suno OU lp.statusinvest+lp2.statusinvest)
4. Fetch paralelo:
   a. GET /api/ga4/landing-pages?propertyId&hostsIn&startDate&endDate&comparePreviousPeriod=true
      → { pages[], pagesPrevious[], sourceBreakdown[] }
   b. GET /api/cro/proposal-state?propertyId
      → { entries: [{ proposalKey, status, mondayUrl, decidedAt }] }
5. POST /api/cro/lp-proposals com { pages, pagesPrevious, sourceBreakdown }
   → { proposals[] }
6. Merge: cada proposal recebe status do KV (ou "pending" se ausente)
7. Render CROProposalsBoard com top 10 priority order
8. Render LPAnalyzer (lista completa) abaixo
```

### 5.2 Aceitar proposta

```
1. User click "Aceitar → Monday" no card
2. Confirmation inline ("Criar task no board CRO?") + spinner
3. POST /api/monday/create-task com:
   {
     title: "[CRO] {lp.url} — {proposta.titulo}",
     description: markdown com hipotese + acaoSugerida + sinais + benchmarks + link de volta,
     sourceLink: `${origin}/cro?lp=${encodeURIComponent(lp.url)}#${proposalKey}`
   }
4. Monday retorna { itemId, url }
5. POST /api/cro/proposal-state com:
   {
     proposalKey,
     status: "accepted",
     mondayItemId,
     mondayUrl,
     snapshot: { ...dados da proposta }
   }
6. Card animação fade-out + toast "✓ Task criada no Monday"
7. Próxima proposta sobe pra ocupar o slot
```

### 5.3 Descartar

Mesmo fluxo de aceite, mas pula passos 3 e 4. Apenas POST `proposal-state` com `status: "dismissed"` e snapshot.

### 5.4 Mudança de range no header

Mesma sequência da 5.1, com novo range. Cache-control respeita `private, max-age=60`.

### 5.5 Mudança de property no header

Mesma sequência da 5.1. Cards são re-renderizados com nova property. Estado KV é por property, então não cruza.

---

## 6. UX e Layout

### 6.1 Layout geral da aba /cro

```
┌─────────────────────────────────────────────────────────────┐
│ Header global (property + range)                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 🎯 Propostas CRO · {N} ativas · Análise: {range}             │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│ │ Card 1 (crítico) │ │ Card 2 (atenção) │ │ Card 3       │ │
│ │ ...              │ │ ...              │ │ ...          │ │
│ └──────────────────┘ └──────────────────┘ └──────────────┘ │
│ [Ver todas as {N} propostas] [Ver histórico tratadas]       │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 📋 LP Analyzer · {M} LPs ativas                              │
│ (lista detalhada existente, ampliada com origens)            │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Card individual

```
┌────────────────────────────────────────────────────────┐
│ 🔴 CRÍTICO · /lp/aniversario                            │
│    LP captura · 4.2k sessões · lp.suno.com.br          │
│ ─────────────────────────────────────────────────────  │
│ ⚠ Conv 1.2% — abaixo da mediana 4.8% do host           │
│                                                         │
│ 💡 Refazer hero alinhado com promessa do criativo Meta  │
│                                                         │
│ Sinais (3):                                            │
│  • Top tráfego (Meta 62%) converte 0.8%                │
│  • Sessão média 28s — primeira dobra fraca             │
│  • /eu-quero (mesmo host) faz 7.1% — replicar copy     │
│                                                         │
│ 📊 +3.6pp conv (~180 leads/mês)  ⏱ Médio                │
│                                                         │
│ [✓ Aceitar → Monday] [✕ Descartar] [💭 Ver detalhes]   │
└────────────────────────────────────────────────────────┘
```

### 6.3 Estados visuais por priority

| Priority | Borda | Background | Ícone |
|---|---|---|---|
| `critico` | `border-red-500` | `bg-red-50` | 🔴 |
| `atencao` | `border-amber-400` | `bg-amber-50` | 🟡 |
| `otimizacao` | `border-emerald-500` | `bg-emerald-50` | 🟢 |
| `accepted` | `border-slate-300` opacity 60% | `bg-slate-50` | ✓ |
| `dismissed` | `border-slate-200` opacity 40% | `bg-slate-25` | ✕ |

### 6.4 Modal de detalhes

Abre ao clicar "💭 Ver detalhes". Conteúdo:
- Header: LP URL, host, badge priority
- Seção "Dados completos" — todas as métricas (sessions, users, bounce, time, engaged, leadConv, ctaConv)
- Seção "Comparativos" — vs host median, vs período anterior (com setas ▲▼), vs benchmark mercado (texto)
- Seção "Breakdown por origem" — tabela top 5 sources com sessions + conv
- Seção "Hipótese completa" — markdown formatado
- Seção "Próximos passos sugeridos" — ação detalhada
- Footer: mesmos botões do card (Aceitar / Descartar)

### 6.5 Responsividade

- Desktop (>1024px): grid 3 colunas de cards
- Tablet (768-1024px): grid 2 colunas
- Mobile (<768px): 1 coluna, cards full-width

---

## 7. Edge cases e tratamento

| Caso | Comportamento |
|---|---|
| Property sem hostnames mapeados | Mostrar banner "Property não mapeada" (igual já existe no LPAnalyzer) |
| 0 LPs ativas no range | "Nenhuma LP com ≥100 sessões no período. Aumente o range ou verifique tracking" |
| 0 propostas após filtro | "Todas as LPs estão dentro dos parâmetros saudáveis 🎉" |
| Erro no /api/cro/lp-proposals | DataErrorCard com retry |
| Erro na criação Monday | Toast vermelho + mantém card pendente. Loga erro no Sentry/console |
| Erro no Vercel KV (POST status) | Toast amarelo "Salvo localmente, sincronizando..." + tenta retry em 5s |
| User não autenticado | Redireciona pra login (segue padrão MasterGuard existente) |
| Múltiplos clicks rápidos no Aceitar | Desabilita botão após 1º click até resposta |

---

## 8. Testing Strategy

Conforme `test-driven-development` (Superpowers), tests escritos **antes** da implementação.

### 8.1 Unit tests — Motor de heurísticas

Path: `src/lib/__tests__/cro-rules.test.ts`

```
✓ Rule "tracking-broken" dispara com sessions=600, leadCount=0, ctaCount=0
✓ Rule "tracking-broken" não dispara com sessions=600, leadCount=5
✓ Rule "conv-vs-host-median" dispara com convRate 2%, hostMedian 5%
✓ Rule "conv-vs-host-median" não dispara com sessions=50 (abaixo de 100)
... (1 caso de dispara + 1 caso de não-dispara por regra = 24 testes mínimos)
```

Fixtures em `src/lib/__tests__/fixtures/lp-data.ts`.

### 8.2 Integration tests — Endpoints

Path: `src/app/api/cro/lp-proposals/__tests__/route.test.ts`

```
✓ Retorna proposals ordenadas por priority (criticos primeiro)
✓ Aplica máximo 10 itens
✓ Mantém metadata do snapshot pra cada proposta
```

Path: `src/app/api/cro/proposal-state/__tests__/route.test.ts`

```
✓ GET retorna lista vazia pra propertyId novo
✓ POST grava entry com TTL 30 dias
✓ GET retorna entry após POST
✓ Status transition accepted → dismissed funciona
```

### 8.3 Component tests — Frontend

Path: `src/components/__tests__/cro-proposals-board.test.tsx`

```
✓ Renderiza até 10 cards
✓ Click "Aceitar" chama Monday API + KV POST
✓ Click "Descartar" chama só KV POST
✓ Modal de detalhes abre com dados certos
✓ Mudança de property dispara re-fetch
```

Framework: Vitest + React Testing Library (já presente no projeto, verificar).

### 8.4 E2E (opcional v1, recomendado v2)

Playwright ou Chrome MCP test:
- Abrir /cro, ver pelo menos 1 card
- Aceitar → verificar task no Monday (com test board)
- Recarregar → verificar card sumiu / tem badge accepted

---

## 9. Performance e Limites

| Operação | Tempo esperado | Limite |
|---|---|---|
| Abertura inicial de /cro | <3s | Hard cap: 5s |
| GA4 landing-pages query | ~1-1.5s | 3s timeout |
| `lp-proposals` cálculo de regras | <100ms | Stateless puro |
| KV reads (GET state) | ~5-20ms | — |
| KV writes (POST state) | ~10-30ms | — |
| Monday task creation | ~500ms-2s | 5s timeout |
| Cache de `landing-pages` | 60s server-side, 300s SWR | Já existe |

### Limites de quota
- Vercel KV free tier: 30k commands/day, 256 MB storage — folgado pra esse use case
- GA4 Data API: 10 RPS, 250k/day — uso atual está bem abaixo
- Monday API: 5 RPS — limite individual ações de aceite, sem risco

---

## 10. Plano de rollout

### v1 (este spec)
- 12 regras hardcoded
- 4 dimensões de comparação implementadas
- Cards top 10 + lista completa
- Monday integration
- Vercel KV pra acceptance state

### v2 (potenciais melhorias futuras)
- Integração Clarity pra `dead-clicks-high` (regra 12)
- Adicionar IA Gemini opcional pra refinar texto das propostas
- Snapshots semanais persistidos (histórico raw)
- Notificação Slack quando proposta crítica nova aparecer
- Dashboard de "taxa de aceite" das propostas (qualidade do motor)

### v3 (hipotético)
- Auto-execução de pequenos testes A/B via VWO ou Optimizely API
- Aprendizado de máquina: regras adaptativas baseadas em quais propostas são aceitas

---

## 11. Decisões e Trade-offs

### Decisão 1: Vercel KV vs. Postgres vs. localStorage
**Escolhido:** Vercel KV
**Por quê:** estado por usuário precisa sincronizar entre devices/sessões. Postgres seria overkill. localStorage não sincroniza entre browsers.

### Decisão 2: Dados ao vivo vs. snapshots persistidos
**Escolhido:** ao vivo (apenas acceptance state persistido)
**Por quê:** GA4 mantém histórico. Snapshotar dados raw é duplicação. O que tem valor de persistir é a DECISÃO humana (aceitar/descartar), não o dado.

### Decisão 3: Heurísticas vs. IA
**Escolhido:** heurísticas hardcoded
**Por quê:** determinístico, gratuito, auditável. User pode ver exatamente por que cada proposta foi gerada. IA seria opcional em v2.

### Decisão 4: 10 cards vs. paginação
**Escolhido:** 10 cards visíveis + "Ver todas" link
**Por quê:** quick-view de absorção em 1 tela. Cognição limitada — mais que 10 vira ruído.

### Decisão 5: TTL 30 dias na KV
**Por quê:** propostas críticas que ressurgem depois de 30d devem voltar à atenção (a empresa pode ter pivotado). Curto demais (7d) gera ruído; longo demais (∞) acumula entries mortas.

---

## 12. Open Questions / Riscos

- **Volume de propostas:** com 4 hostnames × ~30 LPs ativas × 12 regras, teoricamente 1440 propostas possíveis. Na prática, com filtros e priorização, deve dar 20-50 propostas/análise. Aceitável.
- **Custos de cache:** range mudanças no header geram nova GA4 query. Cache 60s mitiga. Monitorar uso.
- **Falsos positivos das regras:** algumas regras (tracking-broken) podem disparar pra LP nova/legítima sem tracking ainda configurado. Mitigação: badge "verificar" + descarte fácil.
- **Conflito com /api/cro/recommendations existente:** esse endpoint master-only gera recomendações em outro formato. Decisão: manter ambos coexistindo. O `recommendations` é mais amplo (não só LPs). O `lp-proposals` é específico de LPs. Documentar a diferença.

---

## 13. Definition of Done

- [ ] 12 regras implementadas e testadas (unit tests passando)
- [ ] Endpoint `/api/cro/lp-proposals` funcional, com integration test
- [ ] Endpoint `/api/cro/proposal-state` funcional, integration test, TTL configurado
- [ ] Endpoint `/api/ga4/landing-pages` ampliado com `comparePreviousPeriod`
- [ ] Componente `CROProposalsBoard` renderizando cards prioritários
- [ ] Componente `ProposalDetailsModal` funcional
- [ ] `LPAnalyzer` ampliado com breakdown de origem
- [ ] Integração com `/api/monday/create-task` validada manualmente em board real
- [ ] Vercel KV configurado em produção
- [ ] Deploy em produção validado em pelo menos 1 property (Suno Research)
- [ ] Documentação user-facing curta em `/configuracoes` ou tooltip explicando o que faz

---

**Próximo passo:** invocar skill `writing-plans` para gerar plano de implementação faseado.
