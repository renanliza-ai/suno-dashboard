// src/app/api/area-logada/trial/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runReport } from "@/lib/ga4-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/area-logada/trial — ativação do trial de 7 dias do Status Invest.
 *
 * ⚠️ EXCLUSIVO DO STATUS INVEST. A funcionalidade não existe nas outras B.U.s,
 * e a rota recusa property que não seja do Status em vez de devolver zero.
 *
 * ESTADO DA MEDIÇÃO EM 28/10/2026 (medido, não suposto)
 * Os eventos existem e TODOS são de 27/10/2026. Antes disso, nada. A
 * funcionalidade subiu ontem. Volume do primeiro dia:
 *   trial_offer_impression ....... 8 eventos / 6 pessoas
 *   trial_offer_click ............ 1 / 1
 *   trial_offer_dismiss .......... 1 / 1
 *   trial_start .................. 1 / 1   <- a ativação
 *   trial_feature_use ............ 30 / 13
 *   trial_winback_impression ..... 2 / 1
 *   trial_upgrade_offer_impression 1 / 1
 *
 * ⚠️ UMA INCOERÊNCIA JÁ VISÍVEL: 13 pessoas usaram recurso de trial
 * (`trial_feature_use`) e só 1 começou um (`trial_start`). Ou o
 * `trial_feature_use` dispara para quem não está em trial, ou existe trial
 * concedido fora do fluxo medido. Vale conferir o gatilho no GTM antes de usar
 * esse evento como régua.
 *
 * COMO O STATUS É DERIVADO
 * O GA4 não guarda estado, só evento. Então "vencido" e "em andamento" saem da
 * IDADE da ativação: trial dura 7 dias, logo quem ativou há menos de 7 dias
 * está em andamento e quem ativou há 7 ou mais já venceu. "Convertido" NÃO está
 * em v1: separar quem comprou durante o trial exige funil por pessoa
 * (runFunnelReport), e com 1 ativação não haveria o que ler. O payload declara
 * isso em vez de fingir que a fatia existe.
 */

const DIAS_DE_TRIAL = 7;

const EVENTOS = [
  "trial_offer_impression",
  "trial_offer_click",
  "trial_offer_dismiss",
  "trial_start",
  "trial_feature_use",
  "trial_winback_impression",
  "trial_upgrade_offer_impression",
] as const;

export type TrialResposta =
  | {
      ok: true;
      periodo: { inicio: string; fim: string };
      diasDeTrial: number;
      /** Ativações (`trial_start`) por dia, sem buraco. */
      ativacoesPorDia: { dia: string; pessoas: number; eventos: number }[];
      totais: { ativacoes: number; pessoas: number };
      /** As fatias da pizza. Soma = total de ativações da janela. */
      status: { rotulo: "Em andamento" | "Vencido"; pessoas: number; desde: string }[];
      /** Funil da oferta, do que apareceu ao que virou ativação. */
      funilDaOferta: { evento: string; eventos: number; pessoas: number }[];
      avisos: string[];
    }
  | { ok: false; motivo: "property_sem_trial" | "erro_ga4"; explicacao: string; avisos: string[] };

function ehStatusInvest(nome: string): boolean {
  return /status\s*-?\s*invest|statusinvest/i.test(nome);
}

type Linha = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId") || "";
  const propertyName = sp.get("propertyName") || "";
  const inicio = sp.get("inicio") || "";
  const fim = sp.get("fim") || "";

  if (!propertyId || !inicio || !fim) {
    return NextResponse.json(
      { ok: false, motivo: "erro_ga4", explicacao: "propertyId, inicio e fim são obrigatórios", avisos: [] },
      { status: 400 }
    );
  }

  // Recusa explícita, com motivo. Zero numa property sem a feature seria
  // indistinguível de "ninguém ativou".
  if (propertyName && !ehStatusInvest(propertyName)) {
    const corpo: TrialResposta = {
      ok: false,
      motivo: "property_sem_trial",
      explicacao: `O trial de ${DIAS_DE_TRIAL} dias existe só no Status Invest. A property selecionada é "${propertyName}", então não há o que medir aqui, e isso não é o mesmo que zero ativação.`,
      avisos: [],
    };
    return NextResponse.json(corpo, { status: 200 });
  }

  try {
    const filtro = {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: [...EVENTOS] },
      },
    };

    const [porDia, porEvento] = await Promise.all([
      runReport(propertyId, {
        dateRanges: [{ startDate: inicio, endDate: fim }],
        dimensions: [{ name: "date" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: filtro,
        limit: 2000,
      }),
      runReport(propertyId, {
        dateRanges: [{ startDate: inicio, endDate: fim }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: filtro,
        limit: 100,
      }),
    ]);

    const linhasDia: Linha[] = porDia?.data?.rows || [];
    const linhasEvt: Linha[] = porEvento?.data?.rows || [];

    /**
     * @sonda-contrato
     * `?debug=1` devolve a resposta CRUA da Data API, com os nomes reais dos
     * campos, em vez de só o resumo. Existe porque esta rota lê a forma de um
     * dado externo, e a forma tem que ser conferível sem abrir o código.
     *
     * Mesmo padrão do `amostraCrua` de `src/lib/clarity-api.ts`.
     *
     * @forma-observada: os VALORES foram conferidos em 28/10/2026 pela gmp-cli
     *   (`gmp ga report -p 309049674 -d date,eventName -m eventCount,totalUsers`):
     *   `date` vem como "20261027" sem hífen, `eventName` traz os 7 eventos de
     *   trial e todos são do mesmo dia. O ENVELOPE (`data.rows[].dimensionValues[].value`)
     *   é o que esta sonda deixa conferir em produção.
     */
    if (sp.get("debug") === "1") {
      return NextResponse.json({
        sonda: "resposta crua da GA4 Data API, sem tratamento",
        periodo: { inicio, fim },
        porDiaCru: porDia,
        porEventoCru: porEvento,
        comoLer:
          "porDiaCru.data.rows[].dimensionValues = [date, eventName]; metricValues = [eventCount, totalUsers]. date vem no formato AAAAMMDD, sem hífen.",
      });
    }

    // Série diária de ativação, sem buraco: dia sem ativação é zero explícito.
    const mapa = new Map<string, { pessoas: number; eventos: number }>();
    for (let d = new Date(inicio + "T00:00:00Z"); d <= new Date(fim + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      mapa.set(d.toISOString().slice(0, 10), { pessoas: 0, eventos: 0 });
    }
    for (const r of linhasDia) {
      const bruto = r.dimensionValues?.[0]?.value || "";
      const evt = r.dimensionValues?.[1]?.value || "";
      if (evt !== "trial_start") continue;
      const dia = `${bruto.slice(0, 4)}-${bruto.slice(4, 6)}-${bruto.slice(6, 8)}`;
      const alvo = mapa.get(dia);
      if (!alvo) continue;
      alvo.eventos += Number(r.metricValues?.[0]?.value || 0);
      alvo.pessoas += Number(r.metricValues?.[1]?.value || 0);
    }
    const ativacoesPorDia = [...mapa.entries()]
      .map(([dia, v]) => ({ dia, ...v }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    // Status pela IDADE da ativação. Corte: hoje menos 7 dias.
    const hoje = new Date();
    hoje.setUTCHours(0, 0, 0, 0);
    const corte = new Date(hoje);
    corte.setUTCDate(corte.getUTCDate() - DIAS_DE_TRIAL);
    const corteIso = corte.toISOString().slice(0, 10);

    const emAndamento = ativacoesPorDia.filter((d) => d.dia > corteIso).reduce((a, d) => a + d.pessoas, 0);
    const vencidos = ativacoesPorDia.filter((d) => d.dia <= corteIso).reduce((a, d) => a + d.pessoas, 0);

    const funilDaOferta = (["trial_offer_impression", "trial_offer_click", "trial_start"] as string[])
      .map((nome) => {
        const r = linhasEvt.find((l) => l.dimensionValues?.[0]?.value === nome);
        return {
          evento: nome,
          eventos: Number(r?.metricValues?.[0]?.value || 0),
          pessoas: Number(r?.metricValues?.[1]?.value || 0),
        };
      });

    const avisos: string[] = [
      `O status sai da IDADE da ativação, não de um campo de estado: o GA4 guarda evento, não situação. Quem ativou depois de ${corteIso} está em andamento; quem ativou até essa data já completou os ${DIAS_DE_TRIAL} dias.`,
      "A fatia 'Convertido' não existe nesta versão. Separar quem comprou durante o trial exige funil por pessoa, e isso ainda não está ligado aqui.",
    ];

    const uso = linhasEvt.find((l) => l.dimensionValues?.[0]?.value === "trial_feature_use");
    const start = linhasEvt.find((l) => l.dimensionValues?.[0]?.value === "trial_start");
    const pessoasUso = Number(uso?.metricValues?.[1]?.value || 0);
    const pessoasStart = Number(start?.metricValues?.[1]?.value || 0);
    if (pessoasUso > pessoasStart) {
      avisos.unshift(
        `⚠️ ${pessoasUso} pessoas usaram recurso de trial (trial_feature_use) e só ${pessoasStart} ativaram um (trial_start). Ou o trial_feature_use dispara para quem não está em trial, ou existe trial concedido fora do fluxo medido. Conferir o gatilho no GTM antes de usar esse evento como régua.`
      );
    }

    const totalAtiv = ativacoesPorDia.reduce((a, d) => a + d.eventos, 0);
    const totalPessoas = ativacoesPorDia.reduce((a, d) => a + d.pessoas, 0);
    if (totalPessoas > 0 && totalPessoas < 30) {
      avisos.unshift(
        `⚠️ Base pequena: ${totalPessoas} ativação(ões) na janela. Qualquer percentual aqui se move inteiro com uma pessoa a mais. Leia como contagem, não como taxa.`
      );
    }

    const corpo: TrialResposta = {
      ok: true,
      periodo: { inicio, fim },
      diasDeTrial: DIAS_DE_TRIAL,
      ativacoesPorDia,
      totais: { ativacoes: totalAtiv, pessoas: totalPessoas },
      status: [
        { rotulo: "Em andamento", pessoas: emAndamento, desde: corteIso },
        { rotulo: "Vencido", pessoas: vencidos, desde: corteIso },
      ],
      funilDaOferta,
      avisos,
    };
    return NextResponse.json(corpo, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    const corpo: TrialResposta = {
      ok: false,
      motivo: "erro_ga4",
      explicacao: `A consulta ao GA4 falhou: ${(e as Error).message}`,
      avisos: [],
    };
    return NextResponse.json(corpo, { status: 200 });
  }
}
