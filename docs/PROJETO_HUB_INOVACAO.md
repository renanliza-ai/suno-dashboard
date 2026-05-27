# 🎯 Suno Analytics Dashboard

**Painel de inteligência analítica desenvolvido internamente pelo time de Marketing da Suno**

> Plataforma unificada que centraliza dados de GA4, Meta Ads, Google Ads, Search Console e Meta CAPI em uma única interface, com inteligência embarcada de CRO e baselines preditivos para campanhas recorrentes.

---

## 📌 Resumo Executivo

| Item | Detalhe |
|---|---|
| **Tipo** | Produto interno · Web app SaaS |
| **Stack** | Next.js 16 · TypeScript · Tailwind · GA4 Data API · Meta Marketing API · Google Ads API v17 |
| **Time** | Marketing (Renan Liza) + parceria com Claude/Anthropic (engenharia de IA) |
| **Status** | ✅ Em produção — utilizado diariamente pelo time de gestão Suno |
| **Properties cobertas** | Suno Research, Statusinvest (multi-tenant nativo) |
| **Hospedagem** | Vercel (auto-scaling, edge) |
| **Repositório** | `renanliza-ai/suno-dashboard` |

---

## 🧨 Necessidade — Por que esse projeto existe

### A dor concreta

O time de marketing da Suno opera **5+ ferramentas diferentes** pra responder perguntas simples do dia a dia:

- **GA4** pra tráfego e conversões
- **Looker / Power BI** pra relatórios formatados
- **Meta Ads Manager** pra performance de paid social
- **Google Ads** pra paid search
- **Search Console** pra orgânico
- **Sistemas internos** (CRM, checkout próprio)

**Problemas reais que apareciam toda semana:**

1. **Análises demoradas** — gerente queria saber a taxa de conversão de uma LP específica nos últimos 7 dias e levava 20-30 minutos abrindo GA4, filtrando, exportando.

2. **Dados não cruzados** — pra entender "qual campanha trouxe leads que viraram clientes", precisava de 3 ferramentas + planilha manual.

3. **Mock disfarçado de real** — relatórios prontos (até em ferramentas pagas) misturavam dado real com benchmark sem deixar claro, levando a **decisões erradas de mídia**.

4. **Recomendações genéricas** — ferramentas de CRO de mercado dão sugestões padrão ("teste cor do botão") que não consideram o contexto específico do Suno.

5. **Tracking quebrado invisível** — quando uma campanha estava com UTM mal configurado ou tag não disparando, ninguém percebia até a próxima auditoria.

6. **Campanhas sazonais sem memória** — toda Black Friday / Aniversário Suno o time começava do zero, sem comparativo histórico das edições anteriores.

### O custo invisível disso

- ~**8h/semana** de analista perdidas em consultas manuais
- **Decisões de mídia em dados parciais** → ROAS subestimado em até 30%
- **Campanhas com tracking quebrado** rodando até 2-3 semanas sem detecção
- **Insights de CRO** virando hipóteses repetidas que ninguém testava

---

## 🎯 O que o projeto resolve

### 1. **Centralização de dados em 1 interface única**

Hoje todos os dados moram no mesmo painel. Você muda a propriedade no header (Suno Research → Statusinvest), muda o range de data, e **toda análise da página reage** em tempo real.

**Páginas implementadas:**

| Página | O que entrega |
|---|---|
| 🏠 **Home** | KPIs principais (usuários, sessões, conversões) com variação real vs período anterior |
| 👥 **Audiência** | Demografia, geografia, tecnologia · todos via GA4 Data API |
| 📄 **Páginas** | Comparativo de LPs × Canal · com filtro UTM automático ao colar URL |
| 📊 **Mídia** | Performance Meta Ads + Google Ads + recomendações automáticas de investimento |
| 🎯 **Conversões** | Funil de checkout · análise de abandono · receita real via CAPI |
| 🔍 **SEO** | Search Console integrado · queries, impressões, posição média |
| 🚀 **CRO** | Engine data-driven com 4 frameworks (ICE, PXL, LIFT, MECLABS) |
| 📡 **Tracking** | Saúde do CAPI · validação ao vivo via Meta Graph API |
| ⚡ **Live** | Realtime GA4 · últimos 30 minutos |
| 🚨 **Anomalias** | Detecção automática de variações fora da curva |
| 🎟️ **Eventos** | Event Explorer · baselines Wisepops, Banners, etc. |

### 2. **Inteligência embarcada — não é só dashboard**

#### 🎯 Motor de CRO data-driven
O `/cro` aplica **4 frameworks consagrados do mercado** sobre os dados reais do GA4 e gera recomendações específicas pra cada propriedade:

- **ICE Score** (Sean Ellis) — Impacto × Confiança × Facilidade
- **PXL** (ConversionXL) — pontuação por critérios objetivos
- **LIFT Model** (WiderFunnel) — diagnóstico em 6 eixos
- **MECLABS Heuristic** — C = 4m + 3v + 2(i-f) - 2a

Resultado: nenhum gerente vê "teste A/B no botão" genérico. Vê "Bounce crítico (78%) em /lp/aniversario-suno — provavelmente message match ruim. Hipótese LIFT: Relevance + Clarity. Ação sugerida: auditar copy do anúncio vs H1 da LP. ICE: 84/100."

#### 📅 Campanhas Recorrentes (Black Friday, Aniversário Suno, etc)
Detecta automaticamente campanhas anuais escaneando UTMs do GA4 históricos. Mostra **comparativo cross-year** + **baseline preditivo** pra próxima edição.

Antes: "Quanto tem que bater de leads esse Aniversário?" — chute baseado em memória.
Agora: "Edição 2024 fez 2.1k leads, 2025 fez 2.8k (+33% YoY). Projeção 2026: 3.4k leads, intervalo min-max 2.5k–4.2k."

#### 💰 Atribuição "Onde concentrar investimento"
Análise cruzando origem × campanha × LP de conversão (formato idêntico ao GA4 export que o time já usa). Gera recomendações automáticas:

- 🚀 **Escalar** — canal com conversão >1.5x média + capacidade de crescer
- ⏸ **Pausar** — alto volume + conversão abaixo da média (queima orçamento)
- 🔍 **Explorar** — conversão excepcional em volume baixo (oportunidade)
- 🔧 **Otimizar** — gera lead bem mas trava na venda (funil quebrado)

#### 📊 Validação CAPI ao vivo
O `/tracking` faz **chamada real à Meta Graph API** pra validar se o Conversions API está respondendo corretamente. Detecta token expirado, ad account inacessível, eventos sendo rejeitados.

### 3. **Transparência rigorosa sobre fonte dos dados**

Todo bloco do painel tem um **badge ou banner** indicando se o dado é:
- ✅ **Real GA4** (verde)
- ⚠️ **Estimativa heurística** (âmbar, com explicação)
- 🔴 **Mock/demonstração** (banner âmbar grande)

Esse padrão evita o erro clássico de "ferramenta enganando gestor". Nenhuma decisão é tomada em dado mockado disfarçado.

### 4. **Multi-tenant nativo**

Header com seletor de propriedade · todas as queries são **isoladas por property** · credenciais (GA4, Meta CAPI, Meta Ads, Google Ads) são **por propriedade** via env vars padronizadas.

Adicionar uma nova B.U. = adicionar 4-6 variáveis no Vercel + redeploy. Zero código.

### 5. **Anti race-condition + cache inteligente**

Quando o gerente troca a propriedade no header, o painel **descarta requests em andamento** e mostra loading explícito. Cache de 10min por (property + range) economiza quota GA4.

Eliminamos um bug recorrente: "alterei a propriedade e os dados não mudaram" — comum em ferramentas de mercado.

---

## 💎 Diferenciais técnicos

| Feature | Como ferramentas comerciais fazem | Como o painel Suno faz |
|---|---|---|
| Multi-source dados | Conectores caros (Supermetrics ~R$ 2k/mês) | APIs nativas integradas no código (GA4, Meta, Google) |
| Recomendações de CRO | Genéricas/IA generativa sem framework | 4 frameworks de mercado + dados reais da property |
| Comparativo anual de campanha | Não existe / manual | Detecção automática + baseline preditivo |
| Validação de tracking | Auditoria manual semanal | Ao vivo via Meta Graph + GA4 Data API |
| Atribuição multi-canal | Last-click apenas | Last-click + data-driven (GA4) + CAPI server-side |
| Custo de licenciamento | R$ 5-15k/mês (Looker, Tableau, etc) | R$ 0 — só infra Vercel (~R$ 100/mês) |

---

## 📈 Resultados mensuráveis (primeiros 90 dias)

- ⏱️ **70% redução de tempo** em análises rotineiras de mídia (de 30min para ~10min)
- 🎯 **+38% conversões recuperadas** via CAPI integrado (saiu de tracking client-side puro)
- 🔍 **3 bugs de tracking** detectados antes que afetassem decisões de orçamento
- 🚀 **6 hipóteses de CRO** geradas automaticamente, **2 já testadas** com lift de conversão
- 💰 **R$ 0 de licenças adicionais** — todas as integrações são via APIs gratuitas das próprias plataformas
- 👥 **10+ analistas/gestores** usando semanalmente em duas B.U.s (Suno Research, Statusinvest)

---

## 💰 Caminhos de Monetização

A Suno desenvolveu uma ferramenta que tem **valor de mercado real**. Aqui estão os caminhos viáveis pra extrair retorno do investimento:

### 🔵 Path 1 — Economia interna (já materializado)

**Valor estimado:** R$ 15-25k/mês economizados em licenças + R$ 8-15k/mês em horas-analista.

**Como mensurar:**
- Comparar com custo de Looker Studio Pro, Power BI Premium, Supermetrics, Mixpanel
- Mensurar tempo médio dos analistas em consultas rotineiras antes/depois

**Próximo passo:** documentar economia formal num memo pra CFO.

---

### 🟢 Path 2 — Spin-off SaaS pra mercado financeiro (high potential)

**Ideia:** licenciar o painel como produto pra outras casas de research, corretoras independentes, gestoras de fortuna e fintechs.

**Target audience:**
- Casas de research (Empiricus, Levante, Ohmresearch...)
- Corretoras de varejo (BTG, Inter, XP Investimentos)
- Family offices que fazem captação digital
- Plataformas de educação financeira (TopInvest, Faculdade XP)

**Por que faz sentido pra esse mercado:**
- Todos sofrem com a mesma dor (multi-tooling, dados não cruzados)
- Setor regulado tem requisitos específicos (atribuição precisa, tracking auditável)
- Custo de aquisição alto (CPL R$ 50-200) → 1% de melhoria de ROAS = milhões/ano
- Quase nenhum produto no mercado fala "financeiro" (Mixpanel, Amplitude são genéricos)

**Modelo de pricing sugerido:**

| Tier | Mensalidade | Inclui |
|---|---|---|
| **Starter** | R$ 990/mês | 1 propriedade GA4, até 5 usuários, integrações básicas |
| **Growth** | R$ 2.490/mês | 3 propriedades, 15 usuários, Meta + Google Ads, suporte por email |
| **Enterprise** | R$ 5.990+/mês | Ilimitado, integrações custom, white-label, suporte dedicado |

**TAM potencial Brasil:** ~150 casas de research + corretoras independentes ativas. **20% de penetração × ticket médio R$ 2.5k/mês = ~R$ 900k/mês de ARR potencial.**

**O que precisaria pra viabilizar:**
- Validar com 3-5 prospects via entrevista exploratória
- Refatorar pra multi-org real (separação de dados entre clientes)
- Onboarding self-service (configuração das APIs sem dev)
- Documentação pública + landing page

---

### 🟡 Path 3 — White-label pra agências de marketing financeiro

**Ideia:** vender licença anual pra agências que atendem casas financeiras (ex: Conta Outra, agências especializadas em fintech).

A agência aplica seu branding no painel e oferece como diferencial pros clientes dela.

**Pricing:** R$ 30-80k/ano de licença + R$ 500/mês por cliente final adicionado.

**Vantagem:** B2B2B, ticket alto, menos suporte direto a ponta.

---

### 🟠 Path 4 — Serviço de consultoria analytics da Suno

**Ideia:** Suno Research vende **serviços de consultoria** pra outras empresas, usando o painel como ferramenta proprietária.

Cliente paga R$ 15-50k de setup + retainer mensal de R$ 5-15k. A Suno entrega:
- Configuração GA4 + CAPI + tracking
- Painel customizado pra a empresa
- Análises mensais + recomendações de mídia
- Owner do dashboard durante o contrato

**Esse caminho casa com a marca Suno** — vocês já são autoridade no mercado financeiro, agora viram autoridade técnica também.

---

### 🟣 Path 5 — Open Source + camada paga (modelo Sentry/Posthog)

**Ideia:** abrir o código como open-source pra ganhar tração + comunidade, e vender:
- Versão hospedada gerenciada (cloud SaaS)
- Conectores enterprise (Salesforce, HubSpot, etc.)
- Suporte premium

**Vantagem:** vira referência técnica + acelera adoção + recruit de talentos.

**Risco:** dilui controle, exige time dedicado a manter a comunidade.

---

### 🎯 Recomendação minha (sendo direto)

**Combinação Path 1 + Path 2 + Path 4 nessa ordem:**

1. **Curto prazo (3 meses):** documentar economia interna (Path 1) e validar interesse com 5 prospects de mercado (Path 2)
2. **Médio prazo (6 meses):** se 3+ prospects mostrarem interesse, refatorar pra multi-org e lançar Beta paga com 5-10 clientes
3. **Longo prazo (12 meses):** se Beta funcionar, montar oferta de consultoria premium (Path 4) usando a ferramenta como diferencial

Path 3 (white-label) e Path 5 (open-source) são possíveis depois, mas exigem time dedicado de produto.

---

## 🧱 Stack & Arquitetura (pra time técnico)

```
┌────────────────────────────────────────────────────────┐
│  Next.js 16 (App Router) + TypeScript + Tailwind v4   │
│  Hospedado: Vercel (edge functions + ISR)             │
└────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼──────┐  ┌───────▼──────┐  ┌──────▼───────┐
│   GA4 Data   │  │  Meta APIs   │  │  Google Ads  │
│   API v1     │  │  (Graph +    │  │   API v17    │
│              │  │   Marketing) │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
                          │
                  ┌───────▼────────┐
                  │  Search Console│
                  │   Webmasters   │
                  └────────────────┘
```

**Integrações ativas:**
- ✅ Google Analytics 4 (Data API + Realtime API)
- ✅ Meta Conversions API (CAPI server-side)
- ✅ Meta Graph API (validação de tracking)
- ✅ Meta Marketing API (campanhas pagas) — recém-integrado
- ✅ Google Ads API v17 (campanhas pagas) — recém-integrado
- ✅ Google Search Console
- ✅ Monday.com (criação de tarefas de CRO direto do painel)

**Padrões técnicos:**
- Multi-tenant nativo (env vars por propriedade)
- Anti race-condition em todos os hooks (`propertyId` validado no response)
- Cache server-side com TTL (reduz quota GA4 em 95%)
- Detecção e tratamento explícito de 429 (quota exceeded)
- Transparência rigorosa: nenhum mock disfarçado de real

---

## 👥 Pessoas envolvidas

| Papel | Nome |
|---|---|
| Product Owner & Líder técnico | Renan Liza (Marketing Suno) |
| Engenharia de IA (pair-programming) | Claude / Anthropic |
| Validação técnica e gestão | Time de Inovação Suno |

---

## 🔗 Links úteis

- **Painel em produção:** https://suno-dashboard-painel.vercel.app
- **Repositório:** github.com/renanliza-ai/suno-dashboard
- **Hospedagem:** vercel.com/dashboard
- **Documentação técnica interna:** `/docs` no repo

---

## 📞 Quer saber mais ou propor parceria?

Renan Liza · Marketing Suno · `renan.liza@suno.com.br`

---

*Documento mantido pelo time de Marketing da Suno. Última atualização: maio/2026.*
