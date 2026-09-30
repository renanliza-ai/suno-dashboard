import { runReport } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/ga4/ciclo-vida — quanto tempo passa entre a PRIMEIRA sessão do usuário
 * e cada conversão dele.
 *
 * @sonda-contrato: `?debug=1` devolve as linhas cruas do GA4, com os nomes de
 * dimensão como a API entrega, antes de qualquer cálculo nosso.
 *
 * COMO A MEDIÇÃO FUNCIONA
 * A API devolve, por linha, a data da primeira sessão do usuário
 * (`firstSessionDate`, escopo USUÁRIO) e a data do evento (`date`, escopo
 * EVENTO). A latência é a diferença entre as duas, em dias. Zero significa que
 * a conversão aconteceu no mesmo dia em que a pessoa conheceu o site.
 *
 * ⚠️ POR QUE ESTA ROTA SÓ EXISTE DEPOIS DE 30/09/2026
 *
 * Toda a medição se apoia na identidade do usuário. Entre julho e agosto de
 * 2026 o app do checkout corrompia o cookie `_ga`, prefixando `GA1.1.` a cada
 * carga (1 -> 3 -> 5 -> 7...). Com o `client_id` malformado, o GA4 perdia a
 * identidade e a pessoa virava um usuário NOVO ao chegar no checkout. Numa
 * medição como esta, isso não apareceria como erro: apareceria como latência
 * ZERO para quem converte, porque a "primeira sessão" seria a própria compra.
 * Número errado com cara de número certo.
 *
 * Reteste em 30/09/2026 pelo caminho real (LP -> clique no CTA -> checkout ->
 * 3 recargas): `_ga` estável em `GA1.1.<cid>.<ts>`, UM prefixo, `client_id`
 * constante. A correção foi aplicada e a identidade é confiável. Se alguém
 * reabrir aquele defeito no checkout, os números desta rota degradam em
 * silêncio, e o sintoma será a latência caindo para perto de zero.
 *
 * ⚠️ TRÊS LIMITES QUE A RESPOSTA DECLARA, EM VEZ DE ESCONDER
 *
 * 1. `firstSessionDate` é do USUÁRIO, `date` é do EVENTO. Um usuário que
 *    chegou antes da janela aparece com latência grande e correta, mas quem
 *    limpou cookie reaparece como novo e puxa a latência para baixo. Esta rota
 *    devolve MEDIANA junto com a média, porque a média sozinha esconde isso.
 * 2. Evento com pouco volume não sustenta distribuição. A resposta traz o total
 *    por evento e marca `baseFraca` abaixo de `PISO_EVENTOS`, para a tela não
 *    desenhar percentual em cima de punhado.
 * 3. A janela limita o que dá para ver: latência maior que o tamanho da janela
 *    não cabe na consulta. `janelaDias` volta na resposta para quem lê saber o
 *    teto do que está olhando.
 */

/** Abaixo disso a distribuição não é distribuição, é anedota. */
const PISO_EVENTOS = 100;

/** Faixas de latência, em dias. O primeiro item é o de mesma sessão. */
const FAIXAS: Array<{ rotulo: string; min: number; max: number }> = [
  { rotulo: "Mesmo dia", min: 0, max: 0 },
  { rotulo: "1 dia", min: 1, max: 1 },
  { rotulo: "2 a 7 dias", min: 2, max: 7 },
  { rotulo: "8 a 30 dias", min: 8, max: 30 },
  { rotulo: "31 a 90 dias", min: 31, max: 90 },
  { rotulo: "mais de 90 dias", min: 91, max: Infinity },
];

type Linha = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

/** "20260930" -> Date em UTC. Devolve null para qualquer coisa fora do formato. */
const paraData = (aaaammdd: string): Date | null => {
  if (!/^\d{8}$/.test(aaaammdd)) return null;
  const ano = Number(aaaammdd.slice(0, 4));
  const mes = Number(aaaammdd.slice(4, 6));
  const dia = Number(aaaammdd.slice(6, 8));
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return Number.isNaN(d.getTime()) ? null : d;
};

const DIA_MS = 86_400_000;

/** Mediana de uma lista de pares (valor, peso). Não é a média, e é de propósito. */
function medianaPonderada(pares: Array<{ valor: number; peso: number }>): number | null {
  if (pares.length === 0) return null;
  const ordenado = [...pares].sort((a, b) => a.valor - b.valor);
  const total = ordenado.reduce((s, p) => s + p.peso, 0);
  if (total <= 0) return null;
  let acumulado = 0;
  for (const p of ordenado) {
    acumulado += p.peso;
    if (acumulado >= total / 2) return p.valor;
  }
  return ordenado[ordenado.length - 1].valor;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const propertyId = sp.get("propertyId");
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const debug = sp.get("debug") === "1";
  const eventosParam =
    sp.get("eventos") || "generate_lead,cta_click,begin_checkout,lead_create_account,purchase";

  if (!propertyId) return NextResponse.json({ error: "propertyId obrigatorio" }, { status: 400 });
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate e endDate obrigatorios" }, { status: 400 });
  }

  const eventos = eventosParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (eventos.length === 0) {
    return NextResponse.json({ error: "eventos obrigatorio" }, { status: 400 });
  }

  const ini = paraData(startDate.replace(/-/g, ""));
  const fim = paraData(endDate.replace(/-/g, ""));
  const janelaDias = ini && fim ? Math.round((fim.getTime() - ini.getTime()) / DIA_MS) + 1 : null;

  const res = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "firstSessionDate" }, { name: "date" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: eventos, caseSensitive: false },
      },
    },
    limit: 100000,
  });

  if (res.error) return NextResponse.json({ propertyId, error: res.error }, { status: 200 });

  const linhas = (res.data?.rows || []) as Linha[];

  /**
   * GUARDA DE COMBINAÇÃO INVÁLIDA.
   *
   * `firstSessionDate` e `date` têm escopos diferentes. Se a API recusar a
   * combinação ou devolver a primeira coluna vazia, o cálculo inteiro vira
   * latência zero, que é um número plausível e completamente falso. Então a
   * ausência falha alto aqui em vez de virar resultado.
   */
  const comPrimeiraSessao = linhas.filter((r) => /^\d{8}$/.test(r.dimensionValues?.[0]?.value || ""));
  if (linhas.length > 0 && comPrimeiraSessao.length === 0) {
    return NextResponse.json(
      {
        propertyId,
        error: "first_session_date_ausente",
        detalhe:
          "A API devolveu linhas, mas nenhuma traz firstSessionDate no formato AAAAMMDD. Sem essa coluna a latencia seria calculada como zero para todo mundo, o que pareceria resultado. Conferir o nome da dimensao antes de confiar em qualquer numero desta rota.",
        amostraCrua: linhas.slice(0, 3),
      },
      { status: 200 }
    );
  }

  // evento -> { total, pares de latencia, contagem por faixa }
  const porEvento = new Map<
    string,
    { total: number; usuarios: number; pares: Array<{ valor: number; peso: number }>; faixas: number[] }
  >();
  let linhasDescartadas = 0;

  for (const r of linhas) {
    const primeira = paraData(r.dimensionValues?.[0]?.value || "");
    const doEvento = paraData(r.dimensionValues?.[1]?.value || "");
    const evento = r.dimensionValues?.[2]?.value || "";
    const contagem = Number(r.metricValues?.[0]?.value || 0);
    const usuarios = Number(r.metricValues?.[1]?.value || 0);

    if (!primeira || !doEvento || !evento) {
      linhasDescartadas++;
      continue;
    }
    const dias = Math.round((doEvento.getTime() - primeira.getTime()) / DIA_MS);
    // Latência negativa não existe: se aparecer, é defeito de dado, não sinal.
    if (dias < 0) {
      linhasDescartadas++;
      continue;
    }

    const atual =
      porEvento.get(evento) || { total: 0, usuarios: 0, pares: [], faixas: FAIXAS.map(() => 0) };
    atual.total += contagem;
    atual.usuarios += usuarios;
    atual.pares.push({ valor: dias, peso: contagem });
    const idx = FAIXAS.findIndex((f) => dias >= f.min && dias <= f.max);
    if (idx >= 0) atual.faixas[idx] += contagem;
    porEvento.set(evento, atual);
  }

  const resultado = Array.from(porEvento.entries())
    .map(([evento, d]) => {
      const somaPonderada = d.pares.reduce((s, p) => s + p.valor * p.peso, 0);
      const media = d.total > 0 ? somaPonderada / d.total : null;
      const mediana = medianaPonderada(d.pares);
      const mesmoDia = d.total > 0 ? (d.faixas[0] / d.total) * 100 : 0;
      return {
        evento,
        total: d.total,
        usuarios: d.usuarios,
        mediaDias: media === null ? null : Number(media.toFixed(1)),
        medianaDias: mediana,
        pctMesmoDia: Number(mesmoDia.toFixed(1)),
        faixas: FAIXAS.map((f, i) => ({
          rotulo: f.rotulo,
          eventos: d.faixas[i],
          pct: d.total > 0 ? Number(((d.faixas[i] / d.total) * 100).toFixed(1)) : 0,
        })),
        baseFraca: d.total < PISO_EVENTOS,
        /** Texto pronto, para ninguem ler a media sem a mediana do lado. */
        leitura:
          media !== null && mediana !== null && media > mediana * 3
            ? `A media (${media.toFixed(1)} dias) e muito maior que a mediana (${mediana} dias): a distribuicao tem cauda longa, e um punhado de gente que demorou meses puxa a media. Use a MEDIANA para falar de "quanto tempo leva".`
            : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    propertyId,
    janela: { startDate, endDate, dias: janelaDias },
    eventosPedidos: eventos,
    porEvento: resultado,
    linhasLidas: linhas.length,
    linhasDescartadas,
    piso: PISO_EVENTOS,
    limitacoes: [
      `A latencia maxima observavel e o tamanho da janela (${janelaDias ?? "?"} dias). Conversao de quem chegou antes disso aparece, mas so porque o GA4 guarda a primeira sessao do usuario fora da janela.`,
      "Quem limpa cookie ou troca de aparelho reaparece como usuario novo, e isso puxa a latencia medida PARA BAIXO. O numero real e igual ou maior que o mostrado.",
      "A media sofre com cauda longa. A mediana responde melhor a pergunta 'quanto tempo leva'.",
      `Evento com menos de ${PISO_EVENTOS} ocorrencias na janela vem com baseFraca=true: a distribuicao dele nao sustenta percentual.`,
    ],
    ...(debug ? { amostraCrua: linhas.slice(0, 5), totalLinhasCruas: linhas.length } : {}),
  });
}
