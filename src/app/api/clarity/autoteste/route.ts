import { NextRequest, NextResponse } from "next/server";
import { fetchClarityPages, clarityTokenEnvFor } from "@/lib/clarity-api";
import { classificarFricção, PISO_PAGEVIEWS } from "@/lib/cro-evidence";
import { resolveBU } from "@/lib/bu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/clarity/autoteste — a integração do Clarity está de pé, sim ou não?
 *
 * POR QUE EXISTE
 * O Renan pediu garantia da integração. Eu não consigo escrever o token no
 * cofre da Vercel daqui, e não devo digitá-lo em comando nem em arquivo. O que
 * dá para garantir é a outra ponta: no instante em que o token entrar, isto
 * responde se a cadeia inteira funciona OU aponta o elo exato que quebrou.
 *
 * Testa a cadeia toda, em ordem, e para no primeiro elo que falha:
 *
 *   1. a variável existe no runtime
 *   2. o valor tem forma de token (JWT), e não de ID de projeto
 *   3. o valor não está exposto no bundle do navegador
 *   4. a API do Clarity aceita o token
 *   5. voltaram linhas
 *   6. o denominador não veio zerado em todas (o zero silencioso)
 *   7. os nomes de campo são os que o parser espera
 *   8. a classificação produz achado ou declara ausência com motivo
 *
 * Cada passo devolve o que foi observado, não um "ok" genérico. Passo que
 * falha traz o que fazer, para a correção não custar outra rodada.
 *
 * NUNCA devolve o valor do token. Só comprimento, prefixo de três letras e
 * veredito, que é o suficiente para diagnosticar e nada além.
 */

type Passo = {
  n: number;
  nome: string;
  ok: boolean;
  observado: string;
  acao?: string;
};

const BUS: Array<{ nome: string; rotulo: string }> = [
  { nome: "Suno Research – Web", rotulo: "Suno Research" },
  { nome: "Statusinvest - Web", rotulo: "Status Invest" },
  { nome: "Suno Advisory", rotulo: "Suno Consultoria" },
];

async function testarBU(propertyName: string, rotulo: string) {
  const passos: Passo[] = [];
  const envVar = clarityTokenEnvFor(propertyName);
  const parar = () => ({ rotulo, propertyName, envVar, passos, veredito: "FALHOU" as const });

  // 1. variável existe
  const valor = envVar ? process.env[envVar] : undefined;
  passos.push({
    n: 1,
    nome: "variável no runtime",
    ok: Boolean(valor),
    observado: envVar
      ? valor
        ? `${envVar} existe, ${valor.length} caracteres`
        : `${envVar} NÃO existe neste runtime`
      : "esta B.U. não tem variável mapeada",
    acao: valor
      ? undefined
      : `Criar ${envVar} em Settings > Environment Variables, marcando o ambiente Production. Variável nova só vale em build novo.`,
  });
  if (!valor) return parar();

  // 2. forma de token
  const pareceJWT = valor.startsWith("eyJ");
  passos.push({
    n: 2,
    nome: "forma de token",
    ok: pareceJWT,
    observado: pareceJWT
      ? `começa com "eyJ" e tem ${valor.length} caracteres: é JWT`
      : `NÃO começa com "eyJ" e tem ${valor.length} caracteres`,
    acao: pareceJWT
      ? undefined
      : "Isto parece ID de projeto, não token. O ID fica no Settings geral do Clarity; o token da Data Export API fica em Settings > Data Export e tem cerca de 700 caracteres.",
  });
  if (!pareceJWT) return parar();

  // 3. não exposta no navegador
  const exposta = Boolean(envVar?.startsWith("NEXT_PUBLIC_"));
  passos.push({
    n: 3,
    nome: "token fora do bundle do navegador",
    ok: !exposta,
    observado: exposta
      ? `${envVar} tem prefixo NEXT_PUBLIC_: o Next embute o valor no bundle do navegador`
      : `${envVar} é só de servidor`,
    acao: exposta
      ? "ROTACIONAR o token no Clarity e recriar a variável SEM o prefixo NEXT_PUBLIC_. Enquanto estiver assim, o token é público."
      : undefined,
  });
  if (exposta) return parar();

  // 4 a 7. a chamada de verdade
  const r = await fetchClarityPages(propertyName, 3);

  if (!r.ok) {
    passos.push({
      n: 4,
      nome: "a API do Clarity aceita o token",
      ok: false,
      observado: r.reason === "erro_api" ? `HTTP ${r.status}: ${String(r.detail).slice(0, 200)}` : r.reason,
      acao:
        r.reason === "erro_api" && r.status === 401
          ? "401 é token recusado. Confirme que o token é do MESMO projeto desta B.U.: token do projeto A não lê o projeto B."
          : "Ver o detalhe acima. Se a mensagem falar em pageViews zero, o campo de contagem mudou de nome na API.",
    });
    return parar();
  }

  passos.push({
    n: 4,
    nome: "a API do Clarity aceita o token",
    ok: true,
    observado: `HTTP 200, janela de ${r.days} dias`,
  });

  passos.push({
    n: 5,
    nome: "voltaram linhas",
    ok: r.rows.length > 0,
    observado: `${r.rows.length} URLs`,
    acao:
      r.rows.length > 0
        ? undefined
        : "Zero linhas com token válido significa projeto sem coleta na janela. Confirme que clarity.ms/tag/<id> carrega nas páginas desta B.U.",
  });
  if (r.rows.length === 0) return parar();

  // 6. o zero silencioso já é barrado dentro de fetchClarityPages, mas o passo
  //    fica visível aqui para que o autoteste conte a história completa.
  const comVolume = r.rows.filter((x) => x.pageViews > 0).length;
  passos.push({
    n: 6,
    nome: "denominador não veio zerado",
    ok: comVolume > 0,
    observado: `${comVolume} de ${r.rows.length} URLs com pageViews acima de zero`,
  });

  /**
   * 7. nomes de campo.
   *
   * ⚠️ A PRIMEIRA VERSÃO DESTE PASSO PASSAVA COM TUDO ZERADO, e foi assim que
   * ele deu OK numa integração que estava devolvendo 0% de fricção em todas as
   * páginas. `deadRate !== null` é verdadeiro quando deadRate é 0, então o teste
   * afirmava "os campos batem" justamente no caso em que eles não batiam.
   *
   * Teste que só reprova quando o dado some, e passa quando o dado vem zerado,
   * não é teste: é a mesma suposição escrita de outro jeito.
   *
   * Agora exige SINAL: pelo menos uma URL com fricção acima de zero. Num
   * conjunto de milhares de páginas, zero absoluto de rage, dead e quickback em
   * TODAS é defeito de leitura, não site perfeito.
   */
  const topo = r.rows[0];
  const comFriccao = r.rows.filter(
    (x) => x.deadClicks > 0 || x.rageClicks > 0 || x.quickbacks > 0 || x.scriptErrors > 0
  ).length;
  const temSinal = comFriccao > 0;
  passos.push({
    n: 7,
    nome: "os campos de fricção trazem sinal",
    ok: temSinal,
    observado: temSinal
      ? `${comFriccao} de ${r.rows.length} URLs com fricção acima de zero. Topo: ${topo.url.slice(0, 55)} com ${topo.pageViews} pageviews, dead ${topo.deadRate}%, quickback ${topo.quickbackRate}%`
      : `ZERO fricção em todas as ${r.rows.length} URLs. Num conjunto desse tamanho isso é defeito de leitura, não site sem atrito.`,
    acao: temSinal
      ? undefined
      : "Conferir a forma crua em /api/cro/evidence?debug=1 e ajustar METRIC_MAP ou os nomes de campo em src/lib/clarity-api.ts.",
  });

  // 8. classificação
  const { achados, semVolume } = classificarFricção(
    r.rows.map((x) => ({
      url: x.url, pageViews: x.pageViews,
      deadRate: x.deadRate, rageRate: x.rageRate, quickbackRate: x.quickbackRate,
      deadBase: x.deadBase, rageBase: x.rageBase, quickbackBase: x.quickbackBase,
      deadClicks: x.deadClicks, rageClicks: x.rageClicks, quickbacks: x.quickbacks,
      scriptErrors: x.scriptErrors,
    })),
    "autoteste",
    r.days
  );
  const acimaDoPiso = r.rows.filter((x) => x.pageViews >= PISO_PAGEVIEWS).length;
  passos.push({
    n: 8,
    nome: "a classificação roda",
    ok: true,
    observado:
      achados.length > 0
        ? `${achados.length} achado(s) em ${acimaDoPiso} páginas acima do piso de ${PISO_PAGEVIEWS} pageviews`
        : `nenhum achado: ${acimaDoPiso} páginas passaram do piso e nenhuma cruzou os limiares de fricção. Isso é resultado, não falha. ${semVolume.length} ficaram abaixo do piso.`,
  });

  const falhou = passos.some((p) => !p.ok);
  return { rotulo, propertyName, envVar, passos, veredito: falhou ? ("FALHOU" as const) : ("OK" as const) };
}

export async function GET(req: NextRequest) {
  const so = req.nextUrl.searchParams.get("bu");
  const alvo = so ? BUS.filter((b) => resolveBU(b.nome).key === so) : BUS;

  const resultados = await Promise.all(alvo.map((b) => testarBU(b.nome, b.rotulo)));
  const todasOk = resultados.every((r) => r.veredito === "OK");

  return NextResponse.json(
    {
      veredito: todasOk ? "INTEGRAÇÃO DE PÉ" : "ALGO QUEBRADO",
      resumo: resultados.map((r) => `${r.rotulo}: ${r.veredito}`),
      detalhe: resultados,
      nota:
        "Este endpoint nunca devolve o valor de um token. Só comprimento, prefixo de três letras e veredito, que diagnostica sem expor.",
      agora: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
