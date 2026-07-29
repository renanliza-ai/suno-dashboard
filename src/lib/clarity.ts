/**
 * Clarity — 2ª frente das sugestões de CRO.
 *
 * Regra do Renan (jul/2026): toda sugestão de teste em CRO precisa de DUAS
 * frentes: GA4 (o QUE está acontecendo, quantitativo) + Clarity (POR QUE está
 * acontecendo, qualitativo: rage click, dead click, scroll, gravação).
 *
 * Estado atual do ambiente: só temos os PROJECT IDs do Clarity
 * (NEXT_PUBLIC_CLARITY_PROJECT_*), que são públicos. A Data Export API do
 * Clarity exige um token separado (Clarity → Settings → Data Export). Sem esse
 * token não é possível LER métricas do Clarity pelo servidor.
 *
 * Então a 2ª frente entra em 2 camadas:
 *   1. AGORA: deep-link por property (heatmap/recordings) + protocolo de
 *      verificação qualitativa obrigatório em cada experimento. Zero invenção.
 *   2. QUANDO houver CLARITY_API_TOKEN: as métricas (rage/dead click, scroll)
 *      entram como evidência quantificada. O slot já está previsto abaixo.
 */

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Resolve o project ID do Clarity a partir do displayName da property GA4.
 * Env esperada: NEXT_PUBLIC_CLARITY_PROJECT_<SLUG DO NOME>
 * ex.: "Suno Research – Web" -> NEXT_PUBLIC_CLARITY_PROJECT_SUNORESEARCHWEB
 */
export function clarityProjectId(propertyName: string | null | undefined): string | null {
  if (!propertyName) return null;
  const key = `NEXT_PUBLIC_CLARITY_PROJECT_${slug(propertyName)}`;
  const direct = process.env[key as keyof typeof process.env] as string | undefined;
  if (direct) return direct;
  // Fallbacks conhecidos (nomes variam: com/sem "- Web")
  const alt = [
    `NEXT_PUBLIC_CLARITY_PROJECT_${slug(propertyName.replace(/[–-]\s*web/i, ""))}WEB`,
    `NEXT_PUBLIC_CLARITY_PROJECT_${slug(propertyName.replace(/[–-]\s*web/i, ""))}`,
  ];
  for (const k of alt) {
    const v = process.env[k as keyof typeof process.env] as string | undefined;
    if (v) return v;
  }
  return null;
}

export type ClarityLinks = {
  projectId: string | null;
  dashboard: string | null;
  heatmaps: string | null;
  recordings: string | null;
  /** Instrução de filtro (o Clarity filtra por URL dentro da própria UI). */
  filterHint: string;
};

/**
 * Deep-links do Clarity para investigar uma página específica.
 * Não fabricamos query-string de filtro (o formato muda entre versões da UI):
 * levamos o analista à seção certa e dizemos exatamente o que filtrar.
 */
export function clarityLinksFor(propertyName: string | null | undefined, pagePath?: string): ClarityLinks {
  const projectId = clarityProjectId(propertyName);
  const base = projectId ? `https://clarity.microsoft.com/projects/view/${projectId}` : null;
  return {
    projectId,
    dashboard: base ? `${base}/dashboard` : null,
    heatmaps: base ? `${base}/heatmaps` : null,
    recordings: base ? `${base}/recordings` : null,
    filterHint: pagePath
      ? `No Clarity, filtre por Page URL contendo "${pagePath}" e período igual ao da análise.`
      : `No Clarity, filtre pela URL da página analisada e use o mesmo período da análise.`,
  };
}

/**
 * Protocolo de validação qualitativa (2ª frente) — vira passos do experimento.
 * Cada tipo de problema tem o sinal do Clarity que confirma ou refuta a hipótese
 * levantada pelo GA4. Isso é o que impede "teste com hipótese rasa".
 */
export type CroKind = "bounce" | "retencao" | "conv_drop" | "connect_rate" | "oportunidade" | "funil";

export function clarityProtocol(kind: CroKind, pagePath?: string): string[] {
  const where = pagePath ? `em ${pagePath}` : "na página";
  const common = `Clarity: filtrar por URL ${pagePath || "da página"} no mesmo período do GA4`;
  switch (kind) {
    case "bounce":
      return [
        common,
        `Heatmap de cliques ${where}: o CTA principal está dentro da área de maior atenção? (se ninguém clica onde o CTA está, é posição, não copy)`,
        `Scroll depth: em que % da página 50% dos usuários param? Se param antes do CTA, o problema é posição/peso do hero`,
        `Rage clicks / dead clicks: elemento que parece clicável e não é (falsa affordance) infla rejeição`,
        `Assistir 5 gravações de sessões com bounce: onde o olho para e onde desiste`,
      ];
    case "retencao":
      return [
        common,
        `Scroll depth ${where}: se a queda é nos primeiros 25%, a primeira dobra não responde à intenção do canal`,
        `Gravações (5-10) filtradas por sessões curtas: o que o usuário procura e não acha`,
        `Heatmap de área: qual bloco recebe atenção real vs qual ocupa espaço sem retorno`,
      ];
    case "conv_drop":
      return [
        common,
        `Comparar gravações da semana da queda vs semana anterior: mudou layout, apareceu erro, popup novo?`,
        `Rage clicks no formulário/CTA: sinal de campo quebrado ou botão que não responde`,
        `Dead clicks: elemento novo capturando clique sem ação`,
      ];
    case "connect_rate":
      return [
        common,
        `Heatmap do formulário ${where}: em qual campo a atenção cai (candidato a remoção)`,
        `Rage/dead clicks no form: validação agressiva ou máscara quebrando o preenchimento`,
        `Gravações de quem abriu o form e NÃO enviou: identificar o campo de abandono`,
        `Scroll: o form está sendo visto sem esforço no mobile?`,
      ];
    case "oportunidade":
      return [
        common,
        `Scroll depth ${where}: achar o ponto de maior dwell time (onde inserir o CTA contextual)`,
        `Heatmap: confirmar que a região escolhida tem atenção real, não só rolagem de passagem`,
      ];
    case "funil":
      return [
        common,
        `Gravações da etapa com maior drop: onde o usuário hesita, volta ou abandona`,
        `Rage clicks na etapa: campo, botão ou validação quebrando o avanço`,
      ];
  }
}
