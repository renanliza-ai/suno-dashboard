# Design — Chat Híbrido com Gemini (IA real no copiloto)

**Data:** 2026-06-11
**Status:** Approved (brainstorming)
**Owner:** Renan Liza (Marketing Suno)
**Contexto:** o chat atual é um roteador de regex (detectIntent) sem nenhum LLM. Perguntas fora dos padrões programados caem em fallback genérico — caso real: Ricardo perguntou "quais as 10 LPs que mais geraram leads" e foi bloqueado indevidamente pelo gating Master (corrigido via intent factual em 8b7b2cd, mas o problema estrutural permanece pra qualquer pergunta nova).

---

## 1. Decisões aprovadas no brainstorming

| Decisão | Escolha |
|---|---|
| Arquitetura | **Híbrida**: intents regex atuais continuam como fast-path; Gemini assume só o fallback (`unknown`) |
| Fontes de dados do Gemini | GA4 completo + Ads + LPs (6 tools mapeando endpoints existentes) |
| Gating Master no chat | **Sem gating** — números E análises liberados pra todos os perfis |
| Memória | Multi-turno: últimas 10 mensagens vão no contexto |
| Modelo | `gemini-2.5-flash` (free tier 1.500 req/dia, function calling) |
| Streaming | Não na v1 — usa padrão placeholder→resposta já existente |
| Key | 100% server-side (`GEMINI_API_KEY` env var, nunca exposta ao client) |

## 2. Fluxo

```
Usuário pergunta → detectIntent() (regex atual, INTACTO)
  ├─ intent conhecido → resposta programática instantânea (como hoje)
  └─ "unknown" → POST /api/chat
        body: { message, history (≤10 msgs), context: { propertyId,
                propertyName, days, startDate?, endDate? } }
        ↓
     Gemini 2.5 Flash com 6 functionDeclarations
        ↓ (loop function calling, máx 4 rodadas)
     Tool executa fetch interno no endpoint do painel → devolve JSON resumido
        ↓
     Resposta final em markdown leve → chat renderiza
```

`smalltalk` continua no handler local (não gasta quota com "oi").

## 3. As 6 tools

| Tool | Endpoint interno | Parâmetros que o modelo controla |
|---|---|---|
| `get_overview` | `/api/ga4/overview` | — (usa property+range do contexto) |
| `get_pages` | `/api/ga4/pages-detail` | `limit` |
| `get_landing_pages` | `/api/ga4/landing-pages` | `hostsIn` (resolvido pela property), `days` |
| `get_conversions` | `/api/ga4/conversions` | — |
| `get_campaigns` | `/api/ga4/campaign-attribution` | — |
| `get_ads` | `/api/ads/meta` + `/api/ads/google` | `platform` ("meta"\|"google"\|"both") |

Execução server-side via fetch interno (`req.nextUrl.origin`) — reusa toda a lógica/cache dos endpoints. Respostas das tools são RESUMIDAS antes de voltar ao modelo (top N linhas, campos relevantes) pra economizar tokens.

## 4. System prompt — regras principais

1. Você é o copiloto de analytics da Suno. Responda em PT-BR, direto, com números.
2. **NUNCA invente números.** Só cite valores vindos das tools. Sem dado → diga que não tem.
3. Use as tools sempre que a pergunta envolver dados. Não responda de memória.
4. Contexto da sessão: property {nome}, período {range}. Use-os como default.
5. Formate com markdown leve: **negrito** pra números-chave, tabelas quando listar 3+ itens.
6. Máximo ~200 palavras por resposta (chat, não relatório).

## 5. Tratamento de erro / quota

| Cenário | Comportamento |
|---|---|
| 429 / quota do free tier | "Estou no limite de consultas de IA agora. Tente em alguns minutos ou use as perguntas rápidas." |
| Timeout (>25s) | Mesma mensagem honesta de erro |
| Tool retorna erro GA4 | Modelo informa o erro real ao usuário (instrução no prompt) |
| GEMINI_API_KEY ausente | Fallback pro comportamento atual de `unknown` (lista de sugestões) |

## 6. Arquivos

| Path | Tipo |
|---|---|
| `src/app/api/chat/route.ts` | NOVO — POST, loop Gemini + tools (REST puro, sem SDK) |
| `src/lib/gemini-tools.ts` | NOVO — declarations + executores |
| `src/lib/chat-context.tsx` | MODIFICADO — fallback `unknown` chama `/api/chat` (placeholder pattern) |

## 7. Fora de escopo (v2)

Streaming SSE; Clarity/GSC como tools; cache de respostas do modelo; avaliação automática de qualidade; gemini-2.5-pro pra perguntas complexas.

## 8. Definition of Done

- [ ] `/api/chat` responde pergunta factual com dados reais via tool
- [ ] Pergunta de follow-up usa o histórico ("e por canal?")
- [ ] Intents existentes continuam funcionando inalterados
- [ ] Erro de quota mostra mensagem honesta
- [ ] Key só no server (nenhuma referência client-side)
- [ ] Deploy validado em produção com pergunta real do Ricardo
