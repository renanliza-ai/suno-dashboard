import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/capi/test
 *
 * Faz um ping real à Meta Conversions API e retorna o diagnóstico:
 *  - Pixel ID + token estão configurados?
 *  - O endpoint Meta aceita o token? (pixel/token combinam?)
 *  - Um evento de teste (PageView com event_id sintético) é aceito?
 *  - Match Quality estimado por proxy (campos que enviamos)
 *
 * Se METAPIA_CAPI_TEST_CODE estiver setado, o evento entra em "Test Events"
 * (não vai pra produção/atribuição). Recomendado pra validação inicial.
 *
 * Uso: GET /api/capi/test?clientIp=auto&userAgent=auto
 */
/**
 * Normaliza nome de propriedade pra comparação tolerante (case-insensitive,
 * remove espaços extras, normaliza "–" e "-").
 */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim();
}

/**
 * Busca o par (pixelId, token) para uma propriedade específica.
 * Procura nos blocos `META_CAPI_PROPERTY_N_*` por nome.
 * Cai no fallback `META_PIXEL_ID` / `META_CAPI_ACCESS_TOKEN` se não achar.
 *
 * Retorna `null` se nem o fallback estiver configurado, indicando que a
 * propriedade não tem CAPI ativa.
 */
function resolveCAPICredentials(propertyName: string | null): {
  pixelId: string;
  accessToken: string;
  matchedProperty: string | null;
  fromFallback: boolean;
} | null {
  // 1. Tenta achar bloco numerado por nome
  if (propertyName) {
    const target = normalizeName(propertyName);
    for (let i = 1; i <= 20; i++) {
      const name = process.env[`META_CAPI_PROPERTY_${i}_NAME`];
      const pixel = process.env[`META_CAPI_PROPERTY_${i}_PIXEL_ID`];
      const token = process.env[`META_CAPI_PROPERTY_${i}_TOKEN`];
      if (name && pixel && token && normalizeName(name) === target) {
        return { pixelId: pixel, accessToken: token, matchedProperty: name, fromFallback: false };
      }
    }
  }

  // 2. Fallback global (legado / default)
  const fbPixel = process.env.META_PIXEL_ID;
  const fbToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (fbPixel && fbToken) {
    return { pixelId: fbPixel, accessToken: fbToken, matchedProperty: null, fromFallback: true };
  }

  return null;
}

export async function GET(req: NextRequest) {
  const propertyName = req.nextUrl.searchParams.get("propertyName");
  const credentials = resolveCAPICredentials(propertyName);
  const testCode = process.env.META_CAPI_TEST_CODE;

  // 1. Validação de configuração — se nem a propriedade específica nem o fallback,
  // é porque essa property realmente não tem CAPI configurada.
  if (!credentials) {
    return NextResponse.json({
      ok: false,
      stage: "config",
      error:
        propertyName
          ? `CAPI não configurada para a propriedade "${propertyName}". Adicione um bloco META_CAPI_PROPERTY_N_NAME / PIXEL_ID / TOKEN em .env.local.`
          : "Nenhuma credencial CAPI configurada em .env.local.",
      propertyRequested: propertyName,
      capiConfigured: false,
      checks: {
        hasPropertyName: Boolean(propertyName),
        hasPropertySpecificConfig: false,
        hasFallback: Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN),
        hasTestCode: Boolean(testCode),
      },
    }, { status: 200 }); // 200 para o frontend conseguir renderizar o estado "não configurado"
  }

  const { pixelId, accessToken, matchedProperty, fromFallback } = credentials;

  // 2. Sanity check do formato do token (Meta access tokens começam com EAA...)
  if (!accessToken.startsWith("EA")) {
    return NextResponse.json({
      ok: false,
      stage: "format",
      error: "Token não parece ser um access token válido da Meta (deveria começar com EAA...)",
    }, { status: 400 });
  }

  // 3. Monta um evento de teste — PageView é o mais seguro (não cria conversão real)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "Mozilla/5.0 (CAPI-Test)";
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `test_${eventTime}_${Math.random().toString(36).slice(2, 10)}`;

  // Hash SHA-256 simples — Meta exige PII hasheada
  const hash = (s: string) => crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

  const payload = {
    data: [
      {
        event_name: "PageView",
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        event_source_url: req.headers.get("referer") || "https://suno.com.br/test",
        user_data: {
          client_ip_address: ip,
          client_user_agent: userAgent,
          em: [hash("test@suno.com.br")],
          ph: [hash("5511999999999")],
          external_id: [hash("test-user-suno-001")],
        },
        custom_data: {
          test_source: "suno-dashboard-capi-validator",
          dashboard_version: "1.0",
        },
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  // 4. Chama a Graph API da Meta
  const metaUrl = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;
  let metaResponse: {
    events_received?: number;
    messages?: string[];
    fbtrace_id?: string;
    error?: { message: string; type: string; code: number; fbtrace_id: string };
  } | null = null;
  let httpStatus = 0;
  let networkError: string | null = null;

  try {
    const resp = await fetch(metaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    httpStatus = resp.status;
    metaResponse = await resp.json();
  } catch (e) {
    networkError = (e as Error).message;
  }

  // 5. Diagnóstico
  const isOk = httpStatus === 200 && metaResponse?.events_received === 1;
  const checks = {
    "1_credentials_configured": Boolean(pixelId && accessToken),
    "2_token_format_valid": accessToken.startsWith("EA"),
    "3_meta_api_reachable": httpStatus > 0,
    "4_pixel_token_match": httpStatus === 200,
    "5_event_accepted": metaResponse?.events_received === 1,
    "6_test_mode_active": Boolean(testCode),
  };

  // 6. Recomendações práticas
  const recommendations: string[] = [];
  if (!testCode) {
    recommendations.push(
      "⚠ Você está enviando para PRODUÇÃO. Pegue um Test Event Code em Events Manager → Test Events e adicione META_CAPI_TEST_CODE no .env.local."
    );
  }
  if (metaResponse?.error) {
    recommendations.push(
      `❌ Meta retornou erro: ${metaResponse.error.message}. Verifique se o token tem permissão para o pixel ${pixelId}.`
    );
  }
  if (httpStatus === 200 && metaResponse?.events_received === 1) {
    recommendations.push(
      "✅ Integração funcionando! Vá em Events Manager → Test Events e confirme que o evento PageView com event_id começando com 'test_' chegou."
    );
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    recommendations.push(
      "❌ Erro 4xx geralmente indica token expirado, pixel ID errado ou permissão faltando. Renove o access token em Events Manager → Settings → Generate Access Token."
    );
  }

  // Aviso adicional se a propriedade pediu específica mas caiu no fallback
  if (propertyName && fromFallback) {
    recommendations.unshift(
      `ℹ Você está usando o pixel padrão (META_PIXEL_ID). A propriedade "${propertyName}" não tem bloco específico em .env.local — está usando as credenciais default do Suno Research. Considere adicionar um bloco META_CAPI_PROPERTY_N_* dedicado.`
    );
  }

  return NextResponse.json({
    ok: isOk,
    capiConfigured: true,
    matchedProperty,
    propertyRequested: propertyName,
    fromFallback,
    pixelId,
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
      pii_fields_sent: ["em", "ph", "external_id", "client_ip_address", "client_user_agent"],
      test_mode: Boolean(testCode),
    },
    recommendations,
    nextStep: isOk
      ? "Abra Meta Events Manager → Test Events e confirme que o evento chegou com selo 'Server'."
      : "Veja recommendations acima para diagnosticar o problema.",
  }, { status: isOk ? 200 : 500 });
}
