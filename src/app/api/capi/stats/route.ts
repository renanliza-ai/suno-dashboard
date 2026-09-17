import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveCAPICredentials } from "@/lib/capi-credenciais";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/capi/stats — leitura PURA do pixel. NÃO envia evento nenhum.
 *
 * @sonda-contrato: `?debug=1` devolve o JSON cru de /{pixel}/stats, que é o
 * único jeito de saber se o shape mudou. A forma esperada está anotada abaixo.
 *
 * ⚠️ POR QUE ESTA ROTA EXISTE, SEPARADA DE /api/capi/test
 *
 * Auditoria de 17/09/2026: a aba /tracking chamava `/api/capi/test` a cada 5
 * minutos para "ver o status". Só que aquela rota ENVIA um PageView de mentira
 * ao pixel, com e-mail, telefone e external_id inventados. Ou seja, o ato de
 * OLHAR o painel poluía o pixel de produção da Suno.
 *
 * Ler e escrever tinham que estar separados. Esta rota só lê: serve o status de
 * configuração e a contagem real de eventos que a Meta recebeu. É ela que a tela
 * chama sozinha; enviar evento passou a ser ação deliberada, com botão.
 */

type LinhaStats = { event: string; count: number };

export async function GET(req: NextRequest) {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const propertyName = req.nextUrl.searchParams.get("propertyName");
  const credentials = resolveCAPICredentials(propertyName);

  if (!credentials) {
    return NextResponse.json({
      capiConfigured: false,
      propertyRequested: propertyName,
      detalhe: propertyName
        ? `Não há credencial de CAPI para "${propertyName}". Falta um bloco META_CAPI_PROPERTY_N_NAME / PIXEL_ID / TOKEN no ambiente.`
        : "Nenhuma credencial de CAPI configurada no ambiente.",
    });
  }

  const { pixelId, accessToken, matchedProperty, fromFallback } = credentials;

  /**
   * GET /{pixel}/stats?aggregation=event
   *
   * @forma-observada: shape tratado defensivamente porque a Meta muda a
   * agregação sem aviso. `data[].value` vem como ARRAY de {value, count} quando
   * a agregação é por evento, mas já veio como número em outras agregações.
   * Qualquer coisa fora disso vira `null` + `erro`, nunca zero silencioso.
   */
  let stats: LinhaStats[] | null = null;
  let erro: string | null = null;
  let cru: unknown = null;

  try {
    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/stats?aggregation=event`,
      {
        method: "GET",
        // Token no HEADER, não na query string: query string vai parar em log de
        // servidor, de proxy e de browser. A rota antiga mandava na URL.
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    const json = (await resp.json()) as {
      data?: { value?: { value?: string; count?: number }[] | number }[];
      error?: { message?: string; code?: number };
    };
    if (debug) cru = json;

    if (!resp.ok || json.error) {
      erro = json.error?.message?.slice(0, 300) || `HTTP ${resp.status}`;
    } else if (Array.isArray(json.data)) {
      const agg = new Map<string, number>();
      for (const bucket of json.data) {
        if (Array.isArray(bucket.value)) {
          for (const v of bucket.value) {
            if (v && typeof v.value === "string") {
              agg.set(v.value, (agg.get(v.value) || 0) + Number(v.count || 0));
            }
          }
        }
      }
      stats = agg.size > 0
        ? Array.from(agg.entries())
            .map(([event, count]) => ({ event, count }))
            .sort((a, b) => b.count - a.count)
        : null;
      if (!stats) {
        erro =
          "A Meta respondeu sem nenhuma contagem por evento. Ou o pixel não recebeu evento na janela, ou o token não tem permissão de leitura de estatística.";
      }
    } else {
      erro = "Resposta da Meta em formato inesperado: `data` não veio como lista.";
    }
  } catch (e) {
    erro = (e as Error).message.slice(0, 300);
  }

  return NextResponse.json({
    capiConfigured: true,
    matchedProperty,
    propertyRequested: propertyName,
    fromFallback,
    pixelIdMasked: `${pixelId.slice(0, 4)}****${pixelId.slice(-4)}`,
    tokenLastFour: accessToken.slice(-4),
    modoTeste: Boolean(process.env.META_CAPI_TEST_CODE),
    stats,
    erro,
    /**
     * O que estes números PROVAM e o que NÃO provam. A tela é obrigada a repetir
     * isto, senão o leitor confunde "o pixel recebe eventos" com "a CAPI está
     * enviando as conversões da Suno".
     */
    leitura:
      "Contagem total que a Meta recebeu neste pixel, somando navegador e servidor. Esta chamada NÃO separa os dois, então ela não prova que a CAPI está funcionando: um pixel só client-side também aparece aqui. A separação por origem só existe no Events Manager, em Connection Method.",
    ...(debug ? { amostraCrua: cru } : {}),
  });
}
