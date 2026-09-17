/**
 * src/lib/capi-credenciais.ts — resolução de pixel e token por B.U.
 *
 * Extraído de `/api/capi/test` em 17/09/2026, quando a leitura de estatística
 * foi separada do envio de evento. As duas rotas precisam da mesma resolução, e
 * duplicar isso garantiria que uma delas ficasse para trás.
 */

/** Tolerante a caixa, espaço duplo e ao travessão que a Meta usa no nome. */
function normalizarNome(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
}

export type CredencialCAPI = {
  pixelId: string;
  accessToken: string;
  matchedProperty: string | null;
  fromFallback: boolean;
};

/**
 * Procura o bloco `META_CAPI_PROPERTY_N_*` da property e, se não achar, usa o
 * par global.
 *
 * ⚠️ O FALLBACK É ARMADILHA e fica declarado na resposta das rotas. Property sem
 * bloco próprio cai no pixel do Suno Research, então o painel diria "CAPI ativa"
 * para uma B.U. que não tem CAPI nenhuma: estaria validando o pixel errado.
 * Por isso `fromFallback` volta sempre, e a tela é obrigada a mostrar.
 */
export function resolveCAPICredentials(propertyName: string | null): CredencialCAPI | null {
  if (propertyName) {
    const alvo = normalizarNome(propertyName);
    for (let i = 1; i <= 20; i++) {
      const name = process.env[`META_CAPI_PROPERTY_${i}_NAME`];
      const pixel = process.env[`META_CAPI_PROPERTY_${i}_PIXEL_ID`];
      const token = process.env[`META_CAPI_PROPERTY_${i}_TOKEN`];
      if (name && pixel && token && normalizarNome(name) === alvo) {
        return { pixelId: pixel, accessToken: token, matchedProperty: name, fromFallback: false };
      }
    }
  }

  const fbPixel = process.env.META_PIXEL_ID;
  const fbToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (fbPixel && fbToken) {
    return { pixelId: fbPixel, accessToken: fbToken, matchedProperty: null, fromFallback: true };
  }

  return null;
}
