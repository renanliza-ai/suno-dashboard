import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolveCAPICredentials } from "@/lib/capi-credenciais";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/capi/test — envia UM evento de teste à Conversions API da Meta.
 *
 * @forma-observada: resposta da Graph API v19.0 POST /{pixel}/events, campos
 * `events_received`, `messages`, `fbtrace_id` e `error{message,type,code}`,
 * observados na validação do pixel da Research em 17/09/2026.
 *
 * ⚠️ TRÊS DEFEITOS CORRIGIDOS EM 17/09/2026. Não reabra nenhum.
 *
 * 1. A ROTA ERA ABERTA. O middleware do projeto exclui `api` do matcher
 *    (`/((?!api|_next/...))`), então NENHUMA rota de API é protegida por ele:
 *    cada uma precisa do seu próprio gate. Esta não tinha. Qualquer pessoa na
 *    internet podia chamar a URL pública e injetar evento no pixel da Suno.
 *
 * 2. A TELA CHAMAVA ISTO SOZINHA, a cada 5 minutos, só para mostrar "status".
 *    Olhar o painel poluía o pixel de produção. A leitura mudou para
 *    `/api/capi/stats`, que não envia nada. Enviar agora exige `?enviar=1`, e
 *    quem passa isso é um botão que a pessoa clica de propósito.
 *
 * 3. O EVENTO LEVAVA PII FALSA: `em` de "test@suno.com.br", `ph` de
 *    "5511999999999" e um `external_id` inventado, todos hasheados e enviados
 *    como se fossem pessoa real. Isso entra em correspondência de público e em
 *    Event Match Quality, ou seja, sujava o sinal que a Meta usa para otimizar
 *    campanha. O teste agora manda SÓ IP e user agent, que é o mínimo para a
 *    Meta aceitar o evento, e nenhum identificador de pessoa inventado.
 *
 * ⚠️ SEM `META_CAPI_TEST_CODE` O EVENTO VAI PARA PRODUÇÃO. Com a variável, ele
 * cai em Test Events e não entra em atribuição. A rota recusa o envio em
 * produção a não ser que quem chama assuma isso explicitamente com
 * `?confirmarProducao=1`, porque o padrão silencioso era o que causava o
 * problema 2.
 */

export async function GET(req: NextRequest) {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const propertyName = req.nextUrl.searchParams.get("propertyName");
  const enviar = req.nextUrl.searchParams.get("enviar") === "1";
  const confirmarProducao = req.nextUrl.searchParams.get("confirmarProducao") === "1";
  const credentials = resolveCAPICredentials(propertyName);
  const testCode = process.env.META_CAPI_TEST_CODE;

  if (!credentials) {
    return NextResponse.json({
      ok: false,
      stage: "config",
      capiConfigured: false,
      propertyRequested: propertyName,
      error: propertyName
        ? `CAPI não configurada para "${propertyName}". Falta um bloco META_CAPI_PROPERTY_N_NAME / PIXEL_ID / TOKEN no ambiente.`
        : "Nenhuma credencial CAPI configurada no ambiente.",
      checks: {
        hasPropertyName: Boolean(propertyName),
        hasPropertySpecificConfig: false,
        hasFallback: Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN),
        hasTestCode: Boolean(testCode),
      },
    });
  }

  const { pixelId, accessToken, matchedProperty, fromFallback } = credentials;

  if (!accessToken.startsWith("EA")) {
    return NextResponse.json(
      {
        ok: false,
        stage: "format",
        error: "O token não tem formato de access token da Meta (esperado começar com EA).",
      },
      { status: 400 }
    );
  }

  // Sem `enviar=1` a rota só DIZ o que faria. É o estado seguro por padrão.
  if (!enviar) {
    return NextResponse.json({
      ok: null,
      enviado: false,
      capiConfigured: true,
      matchedProperty,
      propertyRequested: propertyName,
      fromFallback,
      pixelIdMasked: `${pixelId.slice(0, 4)}****${pixelId.slice(-4)}`,
      tokenLastFour: accessToken.slice(-4),
      modoTeste: Boolean(testCode),
      detalhe: testCode
        ? "Pronto para enviar um PageView de teste. Como META_CAPI_TEST_CODE está configurado, ele cai em Test Events e não entra em atribuição. Chame com enviar=1."
        : "Pronto para enviar, MAS sem META_CAPI_TEST_CODE o evento vai para PRODUÇÃO e entra na contagem do pixel. Configure o test code, ou chame com enviar=1&confirmarProducao=1 se aceitar isso de propósito.",
    });
  }

  // Envio em produção exige aceite explícito.
  if (!testCode && !confirmarProducao) {
    return NextResponse.json(
      {
        ok: false,
        enviado: false,
        stage: "producao_nao_confirmada",
        error:
          "Envio recusado: sem META_CAPI_TEST_CODE este evento entraria no pixel de PRODUÇÃO e na contagem real. Configure o test code em Events Manager > Test Events, ou repita com confirmarProducao=1 para assumir o envio em produção.",
        modoTeste: false,
      },
      { status: 409 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "Mozilla/5.0 (CAPI-Test)";
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `suno_dashboard_test_${eventTime}_${crypto.randomBytes(4).toString("hex")}`;

  /**
   * user_data com o MÍNIMO que a Meta aceita.
   *
   * Nada de `em`, `ph` ou `external_id`: identificador de pessoa inventado entra
   * em correspondência de público e em Event Match Quality, e distorce o sinal
   * de otimização de campanha com uma pessoa que não existe.
   */
  const payload = {
    data: [
      {
        event_name: "PageView",
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        event_source_url: "https://suno-dashboard-painel.vercel.app/tracking",
        user_data: { client_ip_address: ip, client_user_agent: userAgent },
        custom_data: { test_source: "suno-dashboard-capi-validator" },
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  let metaResponse: {
    events_received?: number;
    messages?: string[];
    fbtrace_id?: string;
    error?: { message: string; type: string; code: number; fbtrace_id: string };
  } | null = null;
  let httpStatus = 0;
  let networkError: string | null = null;

  try {
    // Token no HEADER. Na query string ele vaza para log de servidor e de proxy.
    const resp = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    httpStatus = resp.status;
    metaResponse = await resp.json();
  } catch (e) {
    networkError = (e as Error).message;
  }

  const isOk = httpStatus === 200 && metaResponse?.events_received === 1;

  const checks = {
    "1_credentials_configured": Boolean(pixelId && accessToken),
    "2_token_format_valid": accessToken.startsWith("EA"),
    "3_meta_api_reachable": httpStatus > 0,
    "4_pixel_token_match": httpStatus === 200,
    "5_event_accepted": metaResponse?.events_received === 1,
    "6_test_mode_active": Boolean(testCode),
  };

  const recommendations: string[] = [];
  if (!testCode) {
    recommendations.push(
      "Este evento foi para PRODUÇÃO. Configure META_CAPI_TEST_CODE (Events Manager > Test Events) para que a validação não entre mais na contagem do pixel."
    );
  }
  if (metaResponse?.error) {
    recommendations.push(
      `A Meta recusou: ${metaResponse.error.message}. Confira se o token tem permissão para o pixel ${pixelId}.`
    );
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    recommendations.push(
      "Erro 4xx costuma ser token expirado, pixel errado ou permissão faltando. Gere outro token em Events Manager > Settings."
    );
  }
  if (propertyName && fromFallback) {
    recommendations.unshift(
      `Atenção: "${propertyName}" não tem bloco próprio e caiu no pixel padrão (META_PIXEL_ID). Este teste validou o pixel do Suno Research, não o desta B.U.`
    );
  }
  if (isOk) {
    recommendations.push(
      "O ping funcionou. Isso prova que a credencial é válida e que a Meta aceita evento por este pixel. NÃO prova que as conversões reais da Suno estão indo por CAPI: quem responde isso é Events Manager > Connection Method."
    );
  }

  return NextResponse.json(
    {
      ok: isOk,
      enviado: true,
      capiConfigured: true,
      matchedProperty,
      propertyRequested: propertyName,
      fromFallback,
      pixelIdMasked: `${pixelId.slice(0, 4)}****${pixelId.slice(-4)}`,
      tokenLastFour: accessToken.slice(-4),
      httpStatus,
      networkError,
      checks,
      metaResponse: {
        events_received: metaResponse?.events_received,
        messages: metaResponse?.messages,
        fbtrace_id: metaResponse?.fbtrace_id,
        error: metaResponse?.error,
      },
      eventSent: {
        event_name: "PageView",
        event_id: eventId,
        event_time: eventTime,
        action_source: "website",
        pii_fields_sent: ["client_ip_address", "client_user_agent"],
        test_mode: Boolean(testCode),
      },
      recommendations,
      /**
       * O limite desta rota, explícito na própria resposta. Sem isto a tela
       * mostrava "Ativo" e o leitor concluía que a CAPI da Suno estava operando,
       * quando o que passou foi só o ping do painel.
       */
      oQueIstoNaoProva:
        "Que os eventos reais de Lead e Purchase da Suno estão sendo enviados por CAPI, que estão deduplicando com o pixel do navegador pelo event_id, e qual é o Event Match Quality. Nada disso sai desta rota.",
    },
    { status: isOk ? 200 : 500 }
  );
}
