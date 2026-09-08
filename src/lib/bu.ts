/**
 * src/lib/bu.ts — FONTE ÚNICA DA VERDADE de B.U., host de LP e regra de conversão.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Até 08/09/2026 a inferência de B.U. estava espalhada em 12 lugares como teste
 * de substring solto (`name.includes("statusinvest")`, `/consultoria|advisory/i`),
 * cada um com sua própria lista de host e sua própria ideia de qual evento é
 * conversão. Resultado previsível: a mesma pergunta respondida diferente em
 * abas diferentes.
 *
 * REGRAS DE NEGÓCIO CODIFICADAS AQUI (definidas pelo Renan em 08/09/2026)
 *   - Suno Research e Status Invest: sessões, sessões engajadas, `generate_lead`
 *     e clique que leva ao checkout. ⚠️ O pedido original era usar `cta_click`
 *     para isso, mas medição de 08/09/2026 mostrou que o `cta_click` das LPs
 *     inclui WhatsApp, download e formulário, e o GA4 não tem dimensão de
 *     destino registrada para filtrar. Então "levou ao checkout" é medido por
 *     `begin_checkout` atribuído à landing page de entrada, e o `cta_click`
 *     fica na tela como engajamento com CTA, com o rótulo correto.
 *   - Suno Consultoria: não tem checkout. Mede `generate_lead`,
 *     `LeadQualificadoConsultoria` e `LeadDesqualificadoConsultoria`, com
 *     leitura por MQL.
 *   - Demais B.U.s: mesma lógica, ajustada ao que existe de fato.
 *
 * TODO NÚMERO AQUI FOI MEDIDO NA GA4 DATA API em 08/09/2026, janela de 30 dias
 * (2026-08-10 a 2026-09-08). Não é suposição. Onde a medição não fecha, o campo
 * `caveats` diz exatamente o que não fecha, e `blocked` impede a exibição.
 */

export type BUKey =
  | "research"
  | "asset"
  | "status"
  | "consultoria"
  | "fiis"
  | "funds"
  | "fiagro"
  | "certifiquei"
  | "eleven"
  | "simpatio"
  | "agro20"
  | "desconhecida";

/**
 * Modelo de conversão da B.U.
 *   captacao_venda — tem lead E clique pro checkout (Research, Status)
 *   mql            — não tem checkout, mede qualificação (Consultoria)
 *   captacao       — só lead, sem checkout medido
 *   sem_medicao    — não há evento de conversão na property
 */
export type ConversionModel = "captacao_venda" | "mql" | "captacao" | "sem_medicao";

export type BUProfile = {
  key: BUKey;
  label: string;
  /** Hosts que servem landing page. Filtro obrigatório: separa LP de portal e de área logada. */
  lpHosts: string[];
  conversionModel: ConversionModel;
  /** Evento de lead, quando existe. */
  leadEvent: string | null;
  /**
   * Divisor de duplicação do evento de lead.
   * 2 = o evento dispara duas vezes por lead e o número bruto está inflado.
   */
  leadDivisor: number;
  /** true quando a duplicação foi PROVADA, não suposta. */
  leadDivisorProven: boolean;
  /** Eventos de MQL (só Consultoria hoje). Quando presentes, são a fonte de verdade de lead. */
  mqlEvents: { qualified: string; disqualified: string } | null;
  /** Evento de clique pro checkout, quando existe E é confiável no escopo de LP. */
  ctaEvent: string | null;
  /** Ressalvas que a UI é obrigada a mostrar junto do número. */
  caveats: string[];
  /** Quando preenchido, a aba mostra estado vazio explicando o que falta em vez de número. */
  blocked: string | null;
};

/** Hosts de dev, staging, tradutor e lixo. Nunca entram em agregação. */
export const JUNK_HOST_RE =
  /(localhost|^\d+\.\d+\.\d+\.\d+$|\.lndo\.site$|vercel\.app$|^staging|^dev-|-staging|\.translate\.goog$|appspot\.com$|^\(other\)$|^\(not set\)$)/i;

/**
 * Thank Page. Precisa ser excluída de taxa de aquisição porque o `cta_click`
 * dispara nela: 1.896 eventos em /cl/viva-de-dividendos-2026/obrigado/ e 796 em
 * /cl/lpm26-premium/obrigado/ são clique PÓS-conversão. Somados ao numerador,
 * inflam a taxa da LP que já converteu.
 */
/**
 * A versão anterior aceitava só os sufixos fixos `-q` e `-nq`, então escapavam
 * `/obrigado-a`, `/obrigado-bi-v1`, `/obrigado-download` e `/qt-obrigado`
 * (achados em auditoria de 08/09/2026). O impacto numérico era pequeno, a
 * fragilidade não: qualquer variante nova de Thank Page voltaria a contaminar
 * a taxa de aquisição.
 */
export const THANK_PAGE_RE =
  /(^|\/)[a-z0-9-]*?(obrigado|obrigada|thank[-_]?you|thankyou)([a-z0-9-]*)?(\/|$|\?)/i;

export function isThankPage(path: string): boolean {
  return THANK_PAGE_RE.test(path || "");
}

export function isJunkHost(host: string): boolean {
  return JUNK_HOST_RE.test(host || "");
}

// =====================================================================
// OBJETIVO DA LANDING PAGE — regra UNIVERSAL do Grupo Suno
//
// Material oficial do Growth Team, slide "03 · Research, Status Invest e Funds":
//   "Têm checkout próprio. A âncora certa depende do OBJETIVO da página, e o
//    padrão da URL já diz qual é."
//
// Vale para TODAS as B.U.s, não é específico de uma property.
//
//   Estratégia A · CAPTAÇÃO DE LEAD  → conversão = generate_lead
//     (inclui "/cl/", que é literalmente a sigla de Captação de Lead)
//   Estratégia B · VENDA DIRETA      → conversão = cta_click (leva ao checkout)
//
// Por que isso importa: cobrar cta_click de uma LP /lm/ ou generate_lead de uma
// /pv/ produz leitura falsa de fracasso. A aba usava as duas colunas com o mesmo
// peso para toda LP, o que confundia objetivo com desempenho.
// =====================================================================

export type LPObjective = "captacao" | "venda" | "indefinido";

/** Estratégia A: padrões oficiais de captação de lead. */
const CAPTACAO_PATTERNS = [
  // "/cl/" é a sigla de Captação de Lead. Confirmado pelo Renan em 08/09/2026.
  // Não estava no slide oficial e ficava como indefinido, o que deixava fora da
  // conta LPs de peso: /cl/arsenal-independencia (8.670 sessões, 651 leads),
  // /cl/viva-de-dividendos-2026 (2.849 sessões, 1.407 leads) na Research e
  // /cl/masterclass-eleicoes-b na Consultoria.
  "/cl/",
  "/lm/",
  "/ebook-",
  "/minicurso-",
  "/planilha-",
  "/whatsapp-",
  "/lista-vip-",
];

/** Estratégia B: padrões oficiais de venda direta. */
const VENDA_PATTERNS = [
  "/pv/",
  "/nossas-assinaturas",
  "/planos-",
  "/combo-",
  "/integracao-",
  "/especial-",
];

/**
 * DIRETÓRIO vence SLUG.
 *
 * `/cl/` e `/lm/` são pastas que declaram a intenção da LP, e `/pv/` também.
 * Um padrão que aparece no MEIO do slug é mais fraco que a pasta: sem essa
 * precedência, `/cl/algo-combo-premium` seria classificado como venda por causa
 * do "-combo-", contrariando a pasta que diz Captação de Lead.
 */
const DIR_CAPTACAO = ["/cl/", "/lm/"];
const DIR_VENDA = ["/pv/"];

/**
 * Classifica a LP pelo padrão da URL.
 *
 * ⚠️ O `/ao/` é ambíguo DE PROPÓSITO: pelo material oficial ele é captação
 * SOMENTE quando a página tem formulário. Isso não se decide pela URL, então
 * aqui ele sai como "indefinido" e quem chama pode desambiguar pelo dado
 * (ver `resolveObjective`): se a página registra generate_lead, tem formulário.
 *
 * Padrões fora da lista (`/asset/`, `/redes/`, `/sessao-*`) ficam indefinidos.
 * Preferimos declarar "não sei" a adivinhar.
 */
export function lpObjective(path: string): LPObjective {
  const p = (path || "").toLowerCase();
  if (!p) return "indefinido";

  // 1. Pasta primeiro: é declaração estrutural de intenção.
  if (DIR_CAPTACAO.some((d) => p.includes(d))) return "captacao";
  if (DIR_VENDA.some((d) => p.includes(d))) return "venda";

  // 2. Padrão no slug depois.
  if (VENDA_PATTERNS.some((v) => p.includes(v))) return "venda";
  if (CAPTACAO_PATTERNS.some((c) => p.includes(c))) return "captacao";
  return "indefinido";
}

/** true quando o caminho é do grupo `/ao/`, que só é captação se tiver formulário. */
export function isAmbiguousAo(path: string): boolean {
  return /\/ao\//i.test(path || "") && lpObjective(path) === "indefinido";
}

/**
 * Objetivo final, desambiguando o `/ao/` (e qualquer indefinido) pelo dado.
 *
 * Regra de desempate, na ordem:
 *   1. Padrão da URL, quando é conclusivo.
 *   2. `/ao/` com generate_lead > 0 tem formulário, logo é captação.
 *   3. Indefinido com chegada ao checkout e sem lead é venda.
 *   4. Continua indefinido: a aba mostra as duas métricas sem eleger primária.
 */
export function resolveObjective(
  path: string,
  signals: { leads: number; checkoutStarts: number | null }
): { objective: LPObjective; inferredFrom: "url" | "dado" | "nenhum" } {
  const byUrl = lpObjective(path);
  if (byUrl !== "indefinido") return { objective: byUrl, inferredFrom: "url" };

  const leads = signals.leads || 0;
  const chk = signals.checkoutStarts || 0;

  if (isAmbiguousAo(path) && leads > 0) return { objective: "captacao", inferredFrom: "dado" };
  if (leads > 0 && chk === 0) return { objective: "captacao", inferredFrom: "dado" };
  if (chk > 0 && leads === 0) return { objective: "venda", inferredFrom: "dado" };
  return { objective: "indefinido", inferredFrom: "nenhum" };
}

/**
 * Desalinhamento entre o objetivo declarado pela URL e o que o dado mostra.
 * Isso é ALARME, não resultado: LP de captação sem lead tem formulário quebrado,
 * LP de venda sem chegada ao checkout tem âncora errada ou CTA quebrado.
 * Devolve null quando não há nada a apontar.
 */
export function objectiveMismatch(
  objective: LPObjective,
  inferredFrom: "url" | "dado" | "nenhum",
  signals: { sessions: number; leads: number; checkoutStarts: number | null }
): string | null {
  // Só acusa quando o objetivo vem da URL (declarado) e há volume suficiente
  // para que zero seja informativo.
  if (inferredFrom !== "url" || signals.sessions < 100) return null;

  if (objective === "captacao" && signals.leads === 0) {
    return "LP de captação sem nenhum generate_lead no período. Com esse volume de sessão, zero lead aponta formulário quebrado ou evento não disparando, não falta de interesse.";
  }
  if (objective === "venda" && (signals.checkoutStarts ?? 0) === 0) {
    return "LP de venda sem nenhuma chegada ao checkout no período. Aponta CTA apontando para o lugar errado, ou o link do checkout quebrado.";
  }
  return null;
}

const PROFILES: Record<Exclude<BUKey, "desconhecida">, BUProfile> = {
  research: {
    key: "research",
    label: "Suno Research",
    lpHosts: ["lp.suno.com.br", "lp2.suno.com.br", "lps.suno.com.br"],
    conversionModel: "captacao_venda",
    leadEvent: "generate_lead",
    leadDivisor: 1,
    leadDivisorProven: true, // 1,04 evento por sessão: limpo
    mqlEvents: null,
    ctaEvent: "cta_click",
    caveats: [
      "O cta_click da Research é 100% de landing page (31.530 em lp + 4.285 em lp2, zero no portal e zero no checkout).",
      "⚠️ O cta_click NÃO é só clique para checkout. Sondando customEvent:cta_name dentro do próprio evento aparecem entrar_na_comunidade (826 sessões), entrar_no_grupo_vip_agora (659), entre_na_comunidade (643), baixar_agora (476) e preencha_o_formulário (449), que são WhatsApp, download e formulário. Existe uma segunda tag disparando cta_click genérico além do motor da LP, que esse sim só dispara para destino de checkout. Use a coluna Chegou ao checkout para ler intenção de compra.",
      "Não é possível filtrar cta_click por destino no GA4 hoje: o parâmetro cta_destino existe no dataLayer mas nunca foi registrado como dimensão personalizada (customEvent:cta_destino é recusado pela API). Registrar essa dimensão em Admin > Definições personalizadas destrava o filtro por destino real.",
      "Thank Pages excluídas do numerador: o cta_click dispara depois da conversão.",
      "BANNER E POP-UP: na Research a conversão por espaço é estruturalmente próxima de zero. Espaço de banner responde por 12,1% das sessões (160.895 de 1.331.119) e por 0,66% dos leads (39 de 5.920). Não é atribuição quebrada: o mesmo eixo devolve 1.229 leads para e-mail e 873 para orgânico, e banner dá 39, não zero. A causa provável é o link interno com utm_medium=banner forçar novo session_start e zerar a atribuição, então só conta a conversão que acontece dentro dessa sessão nova. Use a coluna de sessões para rankear espaço na Research, não a de lead.",
      "A coluna de sessões por espaço significa COISAS DIFERENTES entre B.U.s: na Research são 1,00 a 1,06 sessão por usuário (visita única de gente distinta), no Status são 8,7 a 12,4 (sessão interna reciclada). Não compare o número absoluto entre as duas.",
    ],
    blocked: null,
  },

  asset: {
    key: "asset",
    label: "Suno Asset",
    // O Asset não tem property própria: vive dentro da Research, em /asset/*.
    lpHosts: ["lp.suno.com.br", "snel11.suno.com.br"],
    conversionModel: "captacao_venda",
    leadEvent: "generate_lead",
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: "cta_click",
    caveats: [
      "Asset não tem property GA4 separada. O corte é por caminho (/asset/*) dentro da Suno Research.",
    ],
    blocked: null,
  },

  status: {
    key: "status",
    label: "Status Invest",
    lpHosts: ["lp.statusinvest.com.br", "lps.statusinvest.com.br"],
    conversionModel: "captacao_venda",
    leadEvent: "generate_lead",
    leadDivisor: 1,
    leadDivisorProven: true, // 1,09 evento por sessão: limpo
    mqlEvents: null,
    ctaEvent: "cta_click",
    caveats: [
      "ATENÇÃO: 97,6% do cta_click do Status vem de statusinvest.com.br (78,8% só na home), não da LP. Sem filtro de host o número infla cerca de 40x. Esta aba conta apenas o cta_click de sessão que ATERRISSOU numa LP deste host, o que é menos que o total do host: o resto veio de sessão que entrou pelo portal e passou pela LP depois.",
      "Nunca somar lead_create_account com sign_up: os dois têm eventCount idêntico (7.385), é o mesmo disparo com dois nomes.",
      "O Status não tem NENHUMA dimensão personalizada cta_* registrada no GA4, então aqui não há como saber nem o nome nem o destino do clique. Use a coluna Chegou ao checkout, que mede begin_checkout atribuído à LP de entrada.",
    ],
    blocked: null,
  },

  consultoria: {
    key: "consultoria",
    label: "Suno Consultoria",
    lpHosts: ["lp.sunoconsultoria.com.br"],
    conversionModel: "mql",
    leadEvent: "generate_lead",
    leadDivisor: 2,
    leadDivisorProven: true,
    mqlEvents: {
      qualified: "LeadQualificadoConsultoria",
      disqualified: "LeadDesqualificadoConsultoria",
    },
    ctaEvent: null, // não existe cta_click na Consultoria, e não há checkout
    caveats: [
      "Consultoria não tem checkout: a conversão é lead e a leitura de valor é MQL.",
      "O generate_lead está DUPLICADO desde 22/07/2026 (razão exata 2,00 em 12 de 14 páginas). Esta aba usa LeadQualificado + LeadDesqualificado como fonte de verdade de lead, que é a única contagem confiável hoje.",
    ],
    blocked: null,
  },

  fiis: {
    key: "fiis",
    label: "FIIs",
    lpHosts: ["lp.fiis.com.br"],
    conversionModel: "captacao",
    leadEvent: "generate_lead",
    leadDivisor: 1,
    leadDivisorProven: false,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Número de lead da FIIs sob suspeita de duplicação: 2,1 eventos por usuário em todos os caminhos de volume, o mesmo padrão que provou a duplicação da Consultoria. Como a FIIs não tem evento de etapa seguinte, não é possível cravar a razão pela API. Auditoria no GTM da FIIs pendente. Até lá esta aba não publica o número, para não repetir o caso da Consultoria.",
  },

  funds: {
    key: "funds",
    label: "Funds Explorer",
    lpHosts: ["lps.fundsexplorer.com.br"],
    conversionModel: "sem_medicao",
    leadEvent: "generate_lead",
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Não existe medição de conversão de landing page no Funds Explorer. O host de LP (lps.fundsexplorer.com.br) teve 4 sessões e zero lead em 30 dias. Os 113 generate_lead da property vêm de /funds/*, /cadastro e /entrar no portal, que não são LP. Falta instrumentar generate_lead nas LPs.",
  },

  fiagro: {
    key: "fiagro",
    label: "Fiagro",
    lpHosts: ["lps.fiagro.com.br"],
    conversionModel: "sem_medicao",
    leadEvent: "generate_lead",
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Fiagro registrou 2 eventos generate_lead em 30 dias, nenhum em host de LP. Não há volume para leitura. Falta instrumentar a medição de conversão.",
  },

  certifiquei: {
    key: "certifiquei",
    label: "Certifiquei",
    lpHosts: [],
    conversionModel: "sem_medicao",
    leadEvent: null,
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Certifiquei não tem evento de conversão configurado (2 generate_lead em 30 dias, sem host de LP). Falta instrumentação.",
  },

  eleven: {
    key: "eleven",
    label: "Eleven Financial",
    lpHosts: [],
    conversionModel: "sem_medicao",
    leadEvent: null,
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Eleven Financial coleta apenas eventos automáticos do GA4 (page_view, session_start, scroll, form_start). Não há nenhum evento de conversão. Falta instrumentação completa.",
  },

  simpatio: {
    key: "simpatio",
    label: "Simpatio",
    lpHosts: [],
    conversionModel: "sem_medicao",
    leadEvent: null,
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Simpatio coleta apenas eventos automáticos do GA4. Não há nenhum evento de conversão. Falta instrumentação completa.",
  },

  agro20: {
    key: "agro20",
    label: "Agro20",
    lpHosts: [],
    conversionModel: "sem_medicao",
    leadEvent: null,
    leadDivisor: 1,
    leadDivisorProven: true,
    mqlEvents: null,
    ctaEvent: null,
    caveats: [],
    blocked:
      "Agro20 coleta apenas eventos automáticos do GA4. Não há nenhum evento de conversão. Falta instrumentação completa.",
  },
};

const UNKNOWN: BUProfile = {
  key: "desconhecida",
  label: "B.U. não mapeada",
  lpHosts: [],
  conversionModel: "sem_medicao",
  leadEvent: null,
  leadDivisor: 1,
  leadDivisorProven: false,
  mqlEvents: null,
  ctaEvent: null,
  caveats: [],
  blocked:
    "Esta propriedade GA4 não está mapeada em src/lib/bu.ts. Sem mapeamento não há como saber qual host é landing page nem qual evento é conversão, e exibir número aqui seria adivinhação. Mapeie a B.U. para habilitar a aba.",
};

/**
 * Resolve a B.U. pelo displayName da property no GA4.
 *
 * A ordem importa: "Suno Advisory" tem que casar com consultoria ANTES de casar
 * com o "suno" da Research, senão a Consultoria seria lida com regra de venda e
 * o painel mostraria checkout onde não existe checkout.
 */
export function resolveBU(propertyName: string | null | undefined): BUProfile {
  const n = (propertyName || "").toLowerCase();
  if (!n) return UNKNOWN;

  if (/consultoria|advisory/.test(n)) return PROFILES.consultoria;
  if (/statusinvest|status invest/.test(n)) return PROFILES.status;
  if (/fundsexplorer|funds explorer/.test(n)) return PROFILES.funds;
  if (/fiagro/.test(n)) return PROFILES.fiagro;
  if (/\bfiis\b|^fiis/.test(n)) return PROFILES.fiis;
  if (/certifiquei/.test(n)) return PROFILES.certifiquei;
  if (/eleven/.test(n)) return PROFILES.eleven;
  if (/simpatio|simpátio/.test(n)) return PROFILES.simpatio;
  if (/agro20/.test(n)) return PROFILES.agro20;
  if (/suno research|sunoresearch|^suno\b/.test(n)) return PROFILES.research;

  return UNKNOWN;
}

export function buProfileByKey(key: BUKey): BUProfile {
  if (key === "desconhecida") return UNKNOWN;
  return PROFILES[key];
}

/** Hosts de LP da property, prontos pro parâmetro `hostsIn` das rotas. */
export function lpHostsFor(propertyName: string | null | undefined): string[] {
  return resolveBU(propertyName).lpHosts;
}

/**
 * Eventos que a aba de LP precisa buscar nesta B.U.
 * Devolve lista sem nulo, pronta pro `eventFilter` (formato "a|b|c").
 */
export function lpEventsFor(profile: BUProfile): string[] {
  const out: string[] = [];
  if (profile.leadEvent) out.push(profile.leadEvent);
  if (profile.mqlEvents) out.push(profile.mqlEvents.qualified, profile.mqlEvents.disqualified);
  if (profile.ctaEvent) out.push(profile.ctaEvent);
  return out;
}

export type LPConversion = {
  /** Contagem de lead já corrigida (MQL quando existe, senão evento bruto ÷ divisor). */
  leads: number;
  /** Como o número de lead foi obtido. Vai pra tela: o usuário tem direito de saber. */
  leadsSource: "mql" | "evento_bruto" | "evento_dividido" | "indisponivel";
  qualified: number | null;
  disqualified: number | null;
  /** MQL ÷ leads. Só existe onde há qualificação. É a métrica que inverte o ranking na Consultoria. */
  qualificationRate: number | null;
  ctaClicks: number | null;
  /** leads ÷ sessões. */
  connectRate: number | null;
  /** cta_click ÷ sessões. */
  ctaRate: number | null;
};

/**
 * Aplica a regra de conversão da B.U. sobre contagens cruas de evento.
 *
 * Esta é a função que "amarra" a regra: qualquer aba que precise de conversão de
 * LP chama aqui, e nenhuma decide sozinha o que é lead.
 */
export function computeLPConversion(
  profile: BUProfile,
  raw: { sessions: number; leadEventCount: number; qualified: number; disqualified: number; ctaCount: number }
): LPConversion {
  const { sessions } = raw;
  const pct = (num: number) => (sessions > 0 ? Number(((num / sessions) * 100).toFixed(2)) : null);

  // Consultoria: a soma dos dois eventos de qualificação é a única contagem de
  // lead confiável, porque o generate_lead está duplicado.
  if (profile.mqlEvents) {
    const leads = raw.qualified + raw.disqualified;
    return {
      leads,
      leadsSource: "mql",
      qualified: raw.qualified,
      disqualified: raw.disqualified,
      qualificationRate: leads > 0 ? Number(((raw.qualified / leads) * 100).toFixed(1)) : null,
      ctaClicks: null,
      connectRate: pct(leads),
      ctaRate: null,
    };
  }

  if (!profile.leadEvent) {
    return {
      leads: 0,
      leadsSource: "indisponivel",
      qualified: null,
      disqualified: null,
      qualificationRate: null,
      ctaClicks: profile.ctaEvent ? raw.ctaCount : null,
      connectRate: null,
      ctaRate: profile.ctaEvent ? pct(raw.ctaCount) : null,
    };
  }

  const divided = profile.leadDivisor > 1;
  const leads = divided ? Math.round(raw.leadEventCount / profile.leadDivisor) : raw.leadEventCount;

  return {
    leads,
    leadsSource: divided ? "evento_dividido" : "evento_bruto",
    qualified: null,
    disqualified: null,
    qualificationRate: null,
    ctaClicks: profile.ctaEvent ? raw.ctaCount : null,
    connectRate: pct(leads),
    ctaRate: profile.ctaEvent ? pct(raw.ctaCount) : null,
  };
}

/**
 * ESPAÇOS DE BANNER E POP-UP.
 *
 * O identificador de espaço vive em `sessionMedium`. ⚠️ É dimensão de SESSÃO:
 * uma sessão com medium=banner.home é uma sessão que ENTROU clicando naquele
 * espaço. Isso é o numerador (clique). Não existe nada em sessionMedium que
 * conte impressão, então CTR por espaço NÃO é calculável, e a aba não deve
 * prometer isso.
 *
 * A taxonomia está fatiada por caixa e por grafia: convivem `bannergam` e
 * `bannerGAM`, `bannerfino` e `banner.fino` e `banner.thin`, `banner.Busca` e
 * `banner.busca`, `banner` e `banners`. Normalizar é obrigatório, senão o
 * ranking sai partido.
 */
export function normalizeSpace(medium: string): string {
  let m = (medium || "").trim().toLowerCase();
  m = m.replace(/\./g, "."); // no-op explícito: o ponto é separador válido na convenção
  const alias: Record<string, string> = {
    banners: "banner",
    "banner.thin": "bannerfino",
    "banner.fino": "bannerfino",
    "banner.busca": "banner.busca",
    "nai-banner": "banner.area.logada",
    "nai-popup": "popup.area.logada",
  };
  return alias[m] || m;
}

export type SpaceKind = "banner" | "popup" | "outro";

export function spaceKind(medium: string): SpaceKind {
  const m = normalizeSpace(medium);
  // Pop-up e sobreposição (modal, lightbox, blur de paywall).
  if (/popup|modal|lightbox|interstitial|blur/.test(m)) return "popup";
  if (/^banner|banner\.|bannergam|bannerfino/.test(m)) return "banner";
  /**
   * Comunicação da área logada (família `nai.*`).
   *
   * Auditoria de 08/09/2026: 84 mediums `nai.*` da Research, somando 5.828
   * sessões, caíam em "outro" e desapareciam das DUAS abas. Pior, a família era
   * cortada ao meio por acidente de string: os `nai.*.modal.*` entravam na aba
   * de pop-up (a regex de pop-up casa "modal") enquanto os `nai.*.carteiras.*`,
   * `nai.*.home.*`, `nai.*.perfil.*` e `nai.*.portfolio.*` saíam. A aba de
   * pop-up exibia um subconjunto enviesado da mesma taxonomia.
   *
   * `menu.nai` fica de fora de propósito: é navegação, não peça de comunicação.
   */
  if (/^nai[.-]/.test(m)) return "banner";
  return "outro";
}

/**
 * Pares view/click que EXISTEM de fato, por B.U. Fora daqui não há CTR honesto.
 * Medido em 08/09/2026.
 */
export type ImpressionPair = {
  viewEvent: string;
  clickEvent: string;
  scope: "pagePath";
  label: string;
  warning: string | null;
};

/**
 * O par depende do TIPO: o Wisepops é ferramenta de pop-up, então não pode
 * aparecer na aba de banner. O `ad_impression` do Status é inventário de
 * banner, então não pode aparecer na aba de pop-up.
 */
export function impressionPairFor(
  profile: BUProfile,
  kind: SpaceKind | "todos" = "todos"
): ImpressionPair | null {
  if ((profile.key === "research" || profile.key === "asset") && kind === "popup") {
    return {
      viewEvent: "wisepops_view",
      clickEvent: "wisepops_click",
      scope: "pagePath",
      label: "Wisepops (pop-up)",
      warning:
        "CTR do Wisepops está BLOQUEADO: o wisepops_click dispara múltiplas vezes na área logada e passa de 100% em /carteiras (2,06), /carteiras/fiis (1,95) e /home (1,12). Toda página com razão acima de 1 é da área logada, toda página abaixo de 1 é pública, o que descarta aleatoriedade. Use a exibição como volume, não como denominador. Em 29 e 30/08/2026 a coleta caiu 99,3%, então agregados que incluem esses dias subestimam o mês.",
    };
  }
  if (profile.key === "status" && kind === "banner") {
    return {
      viewEvent: "ad_impression",
      clickEvent: "ad_click",
      scope: "pagePath",
      label: "Inventário de anúncio",
      warning:
        "CTR calculável mas NÃO validado: 1.288.560 impressões contra 1.424 cliques é uma razão de 900 para 1 (CTR 0,11%). Pode ser real para inventário programático, ou o ad_impression conta recarga de slot em vez de banner visto. Confirmar como as duas tags disparam antes de usar como meta.",
    };
  }
  return null;
}
