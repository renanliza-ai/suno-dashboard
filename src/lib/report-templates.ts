import type { ReportSheet, ReportMeta } from "./export-utils";

/**
 * Biblioteca de relatórios pré-configurados que o chat pode gerar.
 * Cada template retorna um pacote (meta + sheets) pronto para download.
 */

export type ReportTemplateId =
  | "executive-summary"
  | "top-channels"
  | "top-pages"
  | "top-events"
  | "funnel-diagnostic"
  | "campaigns-roas"
  | "audience-profile"
  | "cro-recommendations"
  | "anomalies";

export type ReportPackage = {
  id: ReportTemplateId;
  meta: ReportMeta;
  sheets: ReportSheet[];
};

// ============================================================
// Dados mock — em produção virão de ga4-server / hooks
// ============================================================

export function buildExecutiveSummary(accountName: string, period: string): ReportPackage {
  return {
    id: "executive-summary",
    meta: {
      title: "Resumo Executivo",
      subtitle: "KPIs principais · funil · canais · anomalias",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "KPIs",
        columns: ["Métrica", "Valor", "Variação vs período anterior"],
        rows: [
          ["Usuários Ativos", "470.860", "+12.4%"],
          ["Sessões", "825.746", "+8.7%"],
          ["Pageviews", "1.680.670", "+15.2%"],
          ["Conversões", "3.611", "-2.1%"],
          ["Receita", "R$ 512.480", "+5.8%"],
          ["Ticket médio", "R$ 142", "+2.1%"],
        ],
      },
      {
        name: "Canais",
        columns: ["Canal", "Sessões", "Conversões", "Taxa", "Receita"],
        rows: [
          ["Orgânico", "512.000", "1.842", "0,36%", "R$ 254.000"],
          ["Direct", "158.000", "784", "0,50%", "R$ 108.000"],
          ["Paid Search", "84.100", "512", "0,61%", "R$ 72.000"],
          ["Email", "18.200", "248", "1,36%", "R$ 42.000"],
          ["Social", "42.800", "128", "0,30%", "R$ 18.000"],
          ["Referral", "9.900", "97", "0,97%", "R$ 14.000"],
        ],
      },
      {
        name: "Funil",
        columns: ["Etapa", "Evento", "Volume", "Conversão acumulada"],
        rows: [
          ["Visita", "session_start", "470.860", "100,0%"],
          ["Lead", "generate_lead", "94.172", "20,0%"],
          ["Conta", "sign_up", "42.378", "9,0%"],
          ["Checkout", "begin_checkout", "15.298", "3,2%"],
          ["Pagamento", "add_payment_info", "8.742", "1,9%"],
          ["Compra", "purchase", "3.611", "0,77%"],
        ],
      },
    ],
  };
}

export function buildTopChannelsReport(accountName: string, period: string): ReportPackage {
  return {
    id: "top-channels",
    meta: {
      title: "Top canais por performance",
      subtitle: "Ranking por conversão, receita e ROAS",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Ranking Canais",
        columns: ["Canal", "Sessões", "Usuários", "Conversões", "Taxa", "Receita", "CPA"],
        rows: [
          ["Orgânico", "512.000", "298.000", "1.842", "0,36%", "R$ 254.000", "—"],
          ["Direct", "158.000", "98.400", "784", "0,50%", "R$ 108.000", "—"],
          ["Paid Search", "84.100", "51.200", "512", "0,61%", "R$ 72.000", "R$ 28"],
          ["Email", "18.200", "12.100", "248", "1,36%", "R$ 42.000", "R$ 4"],
          ["Referral", "9.900", "6.800", "97", "0,97%", "R$ 14.000", "—"],
          ["Social", "42.800", "28.400", "128", "0,30%", "R$ 18.000", "R$ 42"],
        ],
      },
      {
        name: "Insights",
        columns: ["Insight", "Detalhe"],
        rows: [
          ["Email lidera eficiência", "Taxa de 1,36% · 5x média geral"],
          ["Orgânico lidera receita", "R$ 254k (50% do total)"],
          ["Social com fricção", "0,30% conv. · revisar copy/CTAs"],
          ["Paid Search equilíbrio", "Bom volume + qualidade · escalar com cuidado"],
        ],
      },
    ],
  };
}

export function buildTopPagesReport(accountName: string, period: string): ReportPackage {
  return {
    id: "top-pages",
    meta: {
      title: "Top páginas por engajamento",
      subtitle: "Ranking por visualizações, conversão e receita",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Páginas",
        columns: ["Página", "Pageviews", "Usuários", "Tempo médio", "Rejeição", "Receita"],
        rows: [
          ["/login", "248.920", "183.225", "00:42", "12,4%", "—"],
          ["/carteiras", "198.420", "84.520", "04:06", "35,8%", "R$ 82.000"],
          ["/home", "187.450", "124.820", "02:28", "42,5%", "—"],
          ["/dashboard", "184.280", "128.420", "06:52", "18,4%", "—"],
          ["/carteiras/dividendos", "156.320", "84.520", "04:58", "32,4%", "R$ 48.000"],
          ["/asset/fundos/snel11", "142.850", "62.480", "04:44", "32,1%", "R$ 58.000"],
          ["/relatorios", "124.820", "32.180", "06:24", "28,4%", "R$ 18.000"],
          ["/blog/como-investir", "68.420", "42.180", "05:12", "54,2%", "R$ 11.000"],
          ["/lp/premium-30", "48.920", "38.420", "02:04", "62,4%", "R$ 118.000"],
          ["/checkout", "32.480", "15.298", "03:04", "18,2%", "R$ 512.000"],
        ],
      },
    ],
  };
}

export function buildTopEventsReport(accountName: string, period: string): ReportPackage {
  return {
    id: "top-events",
    meta: {
      title: "Eventos GA4",
      subtitle: "Catálogo completo · contagem · saúde",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Eventos",
        columns: ["Evento", "Categoria", "Contagem", "Usuários", "Status", "Crítico"],
        rows: [
          ["page_view", "Navegação", "1.680.670", "470.860", "OK", "Não"],
          ["scroll_depth", "Engajamento", "2.158.796", "412.480", "OK", "Não"],
          ["session_start", "Sessão", "825.746", "470.860", "OK", "Não"],
          ["user_engagement", "Engajamento", "494.758", "380.420", "OK", "Não"],
          ["first_visit", "Sessão", "470.860", "470.860", "OK", "Não"],
          ["user_login", "Autenticação", "183.225", "128.420", "OK", "Sim"],
          ["generate_lead", "Lead", "94.172", "94.172", "OK", "Sim"],
          ["sign_up", "Lead", "42.378", "42.378", "OK", "Sim"],
          ["begin_checkout", "Conversão", "15.298", "15.298", "OK", "Sim"],
          ["add_payment_info", "Conversão", "8.742", "8.742", "Atenção", "Sim"],
          ["purchase", "Conversão", "3.611", "3.611", "OK", "Sim"],
          ["purchase_recurring", "Conversão", "1.247", "984", "OK", "Sim"],
        ],
      },
    ],
  };
}

export function buildFunnelDiagnostic(accountName: string, period: string): ReportPackage {
  return {
    id: "funnel-diagnostic",
    meta: {
      title: "Diagnóstico do funil",
      subtitle: "Drops críticos, oportunidades e hipóteses",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Etapas",
        columns: ["Etapa", "Evento", "Volume", "Drop absoluto", "Drop %"],
        rows: [
          ["Visita", "session_start", "470.860", "—", "—"],
          ["Lead", "generate_lead", "94.172", "-376.688", "-80,0%"],
          ["Conta", "sign_up", "42.378", "-51.794", "-55,0%"],
          ["Checkout", "begin_checkout", "15.298", "-27.080", "-63,9%"],
          ["Pagamento", "add_payment_info", "8.742", "-6.556", "-42,9%"],
          ["Compra", "purchase", "3.611", "-5.131", "-58,7%"],
        ],
      },
      {
        name: "Oportunidades",
        columns: ["Etapa", "Hipótese", "Ação recomendada", "Impacto estimado"],
        rows: [
          ["Visita → Lead", "Falta captura leve em blog/home", "Pop-up exit-intent + CTA lateral", "+6-10% leads"],
          ["Lead → Conta", "Formulário longo / email não verificado", "Cadastro social (Google) + magic link", "+15% conta"],
          ["Conta → Checkout", "Tempo pós-cadastro até primeira oferta", "Onboarding com oferta única em 24h", "+8% checkout"],
          ["Checkout → Pagamento", "Fricção em endereço/CEP", "Autocomplete CEP + 1-page checkout", "+20% avanço"],
          ["Pagamento → Compra", "Cartão recusado / abandono", "Salvar cartão · Pix · parcelamento", "+12% compra"],
        ],
      },
    ],
  };
}

export function buildCampaignsReport(accountName: string, period: string): ReportPackage {
  return {
    id: "campaigns-roas",
    meta: {
      title: "Campanhas por ROAS",
      subtitle: "Investimento, receita e retorno",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Campanhas",
        columns: ["Campanha", "Canal", "Sessões", "Conversões", "Investimento", "Receita", "ROAS"],
        rows: [
          ["premium-30-search", "Paid Search", "32.000", "484", "R$ 16.800", "R$ 70.560", "4,20x"],
          ["brand-google", "Paid Search", "24.000", "312", "R$ 12.400", "R$ 47.120", "3,80x"],
          ["retargeting-carteira", "Display", "8.000", "124", "R$ 4.900", "R$ 15.680", "3,20x"],
          ["snel11-display", "Display", "14.000", "84", "R$ 8.200", "R$ 11.480", "1,40x"],
          ["email-dividendos", "Email", "6.200", "148", "R$ 420", "R$ 21.060", "50,14x"],
          ["social-investidor-iniciante", "Social", "18.400", "48", "R$ 3.600", "R$ 6.720", "1,87x"],
        ],
      },
    ],
  };
}

export function buildAudienceReport(accountName: string, period: string): ReportPackage {
  return {
    id: "audience-profile",
    meta: {
      title: "Perfil de audiência",
      subtitle: "Demografia, dispositivo e geografia",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Idade",
        columns: ["Faixa", "Usuários", "Share"],
        rows: [
          ["18-24", "42.378", "9,0%"],
          ["25-34", "148.332", "31,5%"],
          ["35-44", "150.676", "32,0%"],
          ["45-54", "84.755", "18,0%"],
          ["55-64", "33.960", "7,2%"],
          ["65+", "10.759", "2,3%"],
        ],
      },
      {
        name: "Dispositivo",
        columns: ["Device", "Usuários", "Share", "Conversão"],
        rows: [
          ["mobile", "320.185", "68,0%", "0,33%"],
          ["desktop", "131.841", "28,0%", "0,66%"],
          ["tablet", "18.834", "4,0%", "0,41%"],
        ],
      },
      {
        name: "Região",
        columns: ["Estado", "Usuários", "Share"],
        rows: [
          ["SP", "188.344", "40,0%"],
          ["RJ", "89.463", "19,0%"],
          ["MG", "51.795", "11,0%"],
          ["RS", "37.669", "8,0%"],
          ["PR", "28.252", "6,0%"],
          ["outros", "75.337", "16,0%"],
        ],
      },
    ],
  };
}

export function buildCroRecommendations(accountName: string, period: string): ReportPackage {
  return {
    id: "cro-recommendations",
    meta: {
      title: "Roadmap CRO · recomendações priorizadas",
      subtitle: "ICE score (Impacto × Confiança × Esforço)",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Backlog",
        columns: ["Iniciativa", "Área", "Impacto R$/mês", "Esforço", "Confiança", "ICE"],
        rows: [
          ["Remarketing begin_checkout sem purchase", "Checkout", "+R$ 48.000", "baixo", "alta", "9,0"],
          ["Auto-completar CEP checkout", "Checkout", "+20% avanço", "baixo", "alta", "8,7"],
          ["Email pós-compra cross-sell 7d", "Retention", "+R$ 32.000", "baixo", "alta", "8,5"],
          ["Pop-up exit-intent relatório grátis", "Lead", "+8% leads", "baixo", "média", "7,8"],
          ["Bundle Premium + Consultoria", "Up-sell", "+R$ 54.000", "médio", "média", "7,2"],
          ["1-page checkout mobile", "Checkout", "+15% mobile conv.", "alto", "alta", "7,0"],
          ["LP específica investidor iniciante", "Lead", "+15% qualidade", "alto", "média", "5,8"],
        ],
      },
    ],
  };
}

export function buildAnomaliesReport(accountName: string, period: string): ReportPackage {
  return {
    id: "anomalies",
    meta: {
      title: "Anomalias detectadas",
      subtitle: "Últimos 30 dias · drops e picos incomuns",
      accountName,
      period,
      generatedBy: "Copiloto Suno",
    },
    sheets: [
      {
        name: "Anomalias",
        columns: ["Data", "Tipo", "Métrica", "Variação", "Hipótese"],
        rows: [
          ["15/04", "Drop", "Conversão mobile", "-23%", "Possível bug em deploy das 14h"],
          ["22/04", "Pico", "Tráfego /lp/premium-30", "+300%", "Campanha paga não mapeada (UTM?)"],
          ["28/04", "Pico", "Orgânico SNEL11", "+187%", "Viralização no Twitter · replicar conteúdo"],
        ],
      },
    ],
  };
}

export function resolveReport(
  id: ReportTemplateId,
  accountName: string,
  period: string
): ReportPackage {
  switch (id) {
    case "executive-summary":
      return buildExecutiveSummary(accountName, period);
    case "top-channels":
      return buildTopChannelsReport(accountName, period);
    case "top-pages":
      return buildTopPagesReport(accountName, period);
    case "top-events":
      return buildTopEventsReport(accountName, period);
    case "funnel-diagnostic":
      return buildFunnelDiagnostic(accountName, period);
    case "campaigns-roas":
      return buildCampaignsReport(accountName, period);
    case "audience-profile":
      return buildAudienceReport(accountName, period);
    case "cro-recommendations":
      return buildCroRecommendations(accountName, period);
    case "anomalies":
      return buildAnomaliesReport(accountName, period);
    default:
      return buildExecutiveSummary(accountName, period);
  }
}

export const REPORT_CATALOG: { id: ReportTemplateId; label: string; emoji: string; description: string }[] = [
  { id: "executive-summary", label: "Resumo Executivo", emoji: "📋", description: "KPIs + canais + funil em 1 arquivo" },
  { id: "top-channels", label: "Top Canais", emoji: "🏆", description: "Ranking por conversão e receita" },
  { id: "top-pages", label: "Top Páginas", emoji: "📄", description: "Engajamento por URL" },
  { id: "top-events", label: "Eventos GA4", emoji: "⚡", description: "Catálogo + saúde dos eventos" },
  { id: "funnel-diagnostic", label: "Diagnóstico do Funil", emoji: "🩺", description: "Drops + hipóteses + ações" },
  { id: "campaigns-roas", label: "Campanhas ROAS", emoji: "💰", description: "Investimento × receita × retorno" },
  { id: "audience-profile", label: "Audiência", emoji: "👥", description: "Demografia + device + geo" },
  { id: "cro-recommendations", label: "Roadmap CRO", emoji: "🎯", description: "Backlog priorizado por ICE" },
  { id: "anomalies", label: "Anomalias", emoji: "🔍", description: "Drops e picos incomuns" },
];
