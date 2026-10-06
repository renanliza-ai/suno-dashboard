import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/origem-do-trafego — de ONDE vem um recorte de sessão.
 *
 * Nasceu em 06/10/2026, de uma pergunta do Renan sobre um banner que ele tinha
 * tirado do ar e que mesmo assim aparecia com 243 mil cliques em 14 dias. O
 * card de tráfego inválido da aba de CRO manda "conferir a origem no GA4 (país,
 * origem e página de entrada) para desenhar a regra de bloqueio", e o painel
 * não respondia isso: mandava o gestor sair da ferramenta.
 *
 * ⚠️ EXIGE UM RECORTE. Sem `medium` nem `campaign` a rota recusa com 400, de
 * propósito. Devolver a property inteira aqui seria fácil e inútil: a pergunta
 * é sempre "de onde vem ESTE pedaço", e uma rota que responde o todo quando se
 * pede a parte é a porta de entrada para conclusão errada.
 *
 * ⚠️ `sessionMedium` e `sessionCampaignName` são dimensões de SESSÃO, e é isso
 * que torna a pergunta respondível: elas carregam a UTM com que a sessão
 * CHEGOU, exista ou não o banner publicado. Foi exatamente assim que meio
 * milhão de sessões continuaram sendo contadas para um criativo fora do ar.
 *
 * Query params:
 *   propertyId  (obrigatório)
 *   medium      (opcional) — casa por CONTÉM, ex. "banner.home"
 *   campaign    (opcional) — casa por CONTÉM, ex. "SNCA12D1FEA"
 *   startDate / endDate (YYYY-MM-DD) ou days (default 14)
 *   limit       (default 50, teto 500)
 */

const TETO = 500;

type Linha = {
  chave: string;
  sessoes: number;
  engajadas: number;
  /** Em PONTO PERCENTUAL já convertido. A Data API devolve fração. */
  engajamentoPct: number | null;
  usuarios: number;
  /** Peso desta linha dentro do recorte. */
  sharePct: number;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const medium = (sp.get("medium") || "").trim();
  const campaign = (sp.get("campaign") || "").trim();
  const days = Number(sp.get("days") || 14);
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const limit = Math.min(Math.max(Number(sp.get("limit") || 50), 1), TETO);

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }
  if (!medium && !campaign) {
    return NextResponse.json(
      {
        error: "recorte_obrigatorio",
        detalhe:
          "Informe medium e/ou campaign. Esta rota responde 'de onde vem ESTE pedaço de tráfego'; " +
          "devolver a property inteira quando se pediu a parte produziria conclusão errada com cara de certa.",
      },
      { status: 400 }
    );
  }

  const dateRange =
    startDate && endDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? { startDate, endDate }
      : { startDate: `${days}daysAgo`, endDate: "today" };

  /** CONTÉM, não exato: o nome de campanha da casa é longo e o usuário passa um pedaço. */
  const condicoes = [];
  if (medium) {
    condicoes.push({
      filter: {
        fieldName: "sessionMedium",
        stringFilter: { matchType: "CONTAINS" as const, value: medium, caseSensitive: false },
      },
    });
  }
  if (campaign) {
    condicoes.push({
      filter: {
        fieldName: "sessionCampaignName",
        stringFilter: { matchType: "CONTAINS" as const, value: campaign, caseSensitive: false },
      },
    });
  }
  const filtro = condicoes.length === 1 ? condicoes[0] : { andGroup: { expressions: condicoes } };

  const METRICAS = [
    { name: "sessions" },
    { name: "engagedSessions" },
    { name: "totalUsers" },
  ];

  /** Cada eixo é uma consulta própria: juntos dariam produto cartesiano. */
  const eixos = [
    { chave: "pais", dims: ["country"] },
    { chave: "cidade", dims: ["country", "city"] },
    { chave: "origem", dims: ["sessionSource"] },
    { chave: "entrada", dims: ["landingPage"] },
    { chave: "dispositivo", dims: ["deviceCategory", "browser"] },
  ] as const;

  const respostas = await Promise.all(
    eixos.map((e) =>
      runReport(propertyId, {
        dateRanges: [dateRange],
        dimensions: e.dims.map((name) => ({ name })),
        metrics: METRICAS,
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit,
        dimensionFilter: filtro,
      })
    )
  );

  const erro = respostas.find((r) => r.error)?.error || null;
  if (erro) {
    return NextResponse.json({ propertyId, erro, recorte: { medium, campaign }, range: dateRange }, { status: 200 });
  }

  const montar = (res: (typeof respostas)[number]): { linhas: Linha[]; truncado: boolean; total: number } => {
    const brutas = res.data?.rows || [];
    const total = brutas.reduce((s, r) => s + Number(r.metricValues?.[0]?.value || 0), 0);
    const linhas: Linha[] = brutas.map((r) => {
      const sessoes = Number(r.metricValues?.[0]?.value || 0);
      const engajadas = Number(r.metricValues?.[1]?.value || 0);
      return {
        chave: (r.dimensionValues || []).map((d) => d.value || "(vazio)").join(" · "),
        sessoes,
        engajadas,
        engajamentoPct: sessoes > 0 ? Number(((engajadas / sessoes) * 100).toFixed(1)) : null,
        usuarios: Number(r.metricValues?.[2]?.value || 0),
        sharePct: total > 0 ? Number(((sessoes / total) * 100).toFixed(1)) : 0,
      };
    });
    // ⚠️ Truncamento declarado. Resposta cortada em silêncio já custou caro aqui.
    return { linhas, truncado: brutas.length >= limit, total };
  };

  const saida = Object.fromEntries(eixos.map((e, i) => [e.chave, montar(respostas[i])]));
  const totalSessoes = (saida.pais as { total: number }).total;

  return NextResponse.json(
    {
      propertyId,
      recorte: { medium: medium || null, campaign: campaign || null },
      range: dateRange,
      totalSessoes,
      ...saida,
      comoLer:
        "Engajamento humano nesta casa fica entre 60% e 80%. Linha com volume alto e engajamento de um dígito " +
        "não é audiência. `sessionMedium` e `sessionCampaignName` são de SESSÃO: contam a UTM com que a pessoa " +
        "(ou o robô) CHEGOU, exista ou não o criativo publicado.",
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
