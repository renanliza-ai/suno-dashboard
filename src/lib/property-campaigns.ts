/**
 * Campanhas Meta/Google/etc. por PROPRIEDADE.
 *
 * Cada propriedade tem mix de plataformas, naming e volumes diferentes —
 * porque cada produto Suno tem audiência e estratégia próprias.
 *
 * Quando o usuário troca a propriedade no header, este helper devolve o
 * conjunto certo. Usado em:
 *   - components/campaign-performance.tsx (tabela "Performance de Campanhas")
 *   - lib/chat-context.tsx (intents `top_campaigns_7d` e `sales_purchase`)
 *
 * IMPORTANTE: este é o mock pré-CAPI. Quando ligarmos integração real (Meta
 * Marketing API, Google Ads API), o helper troca a fonte mas mantém a interface.
 */

import { campaignMediaData, type CampaignMediaRow } from "./data";

/** Hash determinístico — mesma propriedade sempre gera os mesmos números. */
function hashSeed(s: string | null | undefined): number {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Normaliza nome de propriedade pra match tolerante. */
function normName(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—-]/g, " ")
    .trim();
}

/**
 * Templates de naming/mix por propriedade. Cada chave é um substring que
 * casa contra `normName(propertyName)`. A primeira que casar é usada.
 */
type PropertyTemplate = {
  matchKeys: string[]; // substrings que casam com propertyName normalizado
  // Substituições de nome de campanha — aplicadas em ordem
  nameTransforms: Array<{ from: RegExp; to: string }>;
  // Mix de plataformas: peso (1.0 = como o template; 0.5 = metade do tráfego; 1.5 = 1.5x)
  platformWeights: Partial<Record<CampaignMediaRow["platform"], number>>;
  // Multiplicador geral de volume (impressions/clicks/spend/etc.)
  volumeMultiplier: number;
  // Tom geral (afeta ROAS) — finanças premium tem ROAS maior, ativos B2C menor
  roasMultiplier: number;
};

const TEMPLATES: PropertyTemplate[] = [
  // --- Suno Research – Web ---
  // Foco: assinatura premium de research (B2B/B2C high-ticket).
  // Audiência adulta, alto ticket, plataformas pagas Google + LinkedIn dominantes.
  {
    matchKeys: ["suno research", "research"],
    nameTransforms: [
      { from: /premium-30/gi, to: "research-premium-30" },
      { from: /retargeting-carteira/gi, to: "research-retargeting-investidor" },
      { from: /lookalike-1pct/gi, to: "research-lookalike-assinantes" },
      { from: /brand-google/gi, to: "research-brand-google" },
      { from: /^carteira-/gi, to: "research-carteira-" },
    ],
    platformWeights: {
      "Google Ads": 1.3,
      "LinkedIn Ads": 1.6,
      "Meta Ads": 0.9,
      "TikTok Ads": 0.4,
      "YouTube Ads": 1.1,
    },
    volumeMultiplier: 1.0,
    roasMultiplier: 1.15, // produto premium → ROAS melhor
  },

  // --- Statusinvest - Web ---
  // Foco: ferramenta gratuita de análise (B2C massivo).
  // Audiência ampla, plataformas pagas Meta + TikTok dominantes.
  {
    matchKeys: ["statusinvest", "status invest"],
    nameTransforms: [
      { from: /premium-30/gi, to: "statusinvest-premium-mensal" },
      { from: /retargeting-carteira/gi, to: "statusinvest-retargeting-acoes" },
      { from: /lookalike-1pct/gi, to: "statusinvest-lookalike-usuarios" },
      { from: /brand-google/gi, to: "statusinvest-brand-google" },
      { from: /^carteira-/gi, to: "statusinvest-fundos-" },
    ],
    platformWeights: {
      "Google Ads": 0.9,
      "LinkedIn Ads": 0.3, // pouca penetração B2B
      "Meta Ads": 1.5, // Meta Ads é principal canal
      "TikTok Ads": 1.4, // TikTok cresceu muito
      "YouTube Ads": 1.0,
    },
    volumeMultiplier: 2.4, // base muito maior que Research
    roasMultiplier: 0.85, // produto freemium → ROAS menor
  },

  // --- Outros (Suno Notícias, Suno One, etc.) ---
  // Template default: mantém os nomes do mock e ajusta volumes pelo seed.
  {
    matchKeys: ["suno notícias", "suno noticias", "suno one", "suno"],
    nameTransforms: [],
    platformWeights: {
      "Google Ads": 1.1,
      "LinkedIn Ads": 0.8,
      "Meta Ads": 1.2,
      "TikTok Ads": 1.0,
      "YouTube Ads": 1.0,
    },
    volumeMultiplier: 0.8,
    roasMultiplier: 1.0,
  },
];

/**
 * Retorna campanhas customizadas para a propriedade selecionada.
 * Se não houver template específico, aplica seed determinístico ao mock base.
 */
export function getCampaignsForProperty(
  propertyName: string | null | undefined,
  propertyId?: string | null
): CampaignMediaRow[] {
  const seed = hashSeed(propertyId || propertyName || "demo");
  const norm = normName(propertyName);

  // Acha o template que casa
  const template = TEMPLATES.find((t) =>
    t.matchKeys.some((k) => norm.includes(k))
  );

  return campaignMediaData.map((c, i) => {
    let row: CampaignMediaRow = { ...c };

    // 1. Renomeia campanhas conforme transforms do template
    if (template) {
      for (const t of template.nameTransforms) {
        row.campaign = row.campaign.replace(t.from, t.to);
      }
    }

    // 2. Aplica peso de plataforma (volume + spend)
    const platformWeight = template?.platformWeights[row.platform] ?? 1.0;

    // 3. Variação seedada por linha (cada campanha varia ±15% pra parecer real)
    const lineVariation = 0.85 + ((seed + i * 17) % 30) / 100;

    // 4. Multiplicador final de volume
    const finalMultiplier = (template?.volumeMultiplier ?? 1.0) * platformWeight * lineVariation;

    row.impressions = Math.round(row.impressions * finalMultiplier);
    row.clicks = Math.round(row.clicks * finalMultiplier);
    row.spend = Math.round(row.spend * finalMultiplier);
    row.sessions = Math.round(row.sessions * finalMultiplier);
    row.conversions = Math.round(row.conversions * finalMultiplier);

    // 5. ROAS varia por template (premium tem ROAS maior, freemium menor)
    const roasMul = (template?.roasMultiplier ?? 1.0) * (0.9 + ((seed + i * 23) % 20) / 100);
    row.revenue = Math.round(row.spend * (row.roas * roasMul));
    row.roas = Number((row.revenue / Math.max(row.spend, 1)).toFixed(2));

    // 6. Recalcula derivados pra ficar coerente
    row.ctr = row.impressions > 0 ? Number(((row.clicks / row.impressions) * 100).toFixed(2)) : 0;
    row.cpc = row.clicks > 0 ? Number((row.spend / row.clicks).toFixed(2)) : 0;
    row.convRate = row.sessions > 0 ? Number(((row.conversions / row.sessions) * 100).toFixed(2)) : 0;
    row.cpa = row.conversions > 0 ? Number((row.spend / row.conversions).toFixed(2)) : 0;

    return row;
  });
}

/**
 * Helper de log/debug — útil pra ver qual template a propriedade casou.
 * Não usado em produção, mas exportado pra testes manuais.
 */
export function debugMatchedTemplate(propertyName: string | null | undefined) {
  const norm = normName(propertyName);
  const idx = TEMPLATES.findIndex((t) =>
    t.matchKeys.some((k) => norm.includes(k))
  );
  return {
    propertyName,
    normalized: norm,
    matchedTemplateIndex: idx,
    matchedKeys: idx >= 0 ? TEMPLATES[idx].matchKeys : null,
  };
}
