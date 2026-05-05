import { auth } from "@/auth";

/**
 * Google Search Console API helpers.
 *
 * Endpoints relevantes:
 *   - sites.list                 — propriedades GSC do usuário logado
 *   - searchanalytics.query      — métricas (clicks, impressions, ctr, position) por
 *                                  dimensões: query, page, country, device, date
 *
 * Docs: https://developers.google.com/webmaster-tools/v1/api_reference_index
 *
 * Escopo necessário no OAuth: `https://www.googleapis.com/auth/webmasters.readonly`
 */

const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";

type GSCResponse<T> = { data: T | null; error: string | null };

async function getTokenAndError(): Promise<{ token: string | null; authError: string | null }> {
  const session = (await auth()) as { accessToken?: string; authError?: string } | null;
  return { token: session?.accessToken ?? null, authError: session?.authError ?? null };
}

async function gscFetch<T>(url: string, body?: unknown): Promise<GSCResponse<T>> {
  const { token, authError } = await getTokenAndError();
  if (authError) return { data: null, error: `auth_${authError}` };
  if (!token) return { data: null, error: "no_session" };

  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401)
        return { data: null, error: "token_expired (relogue com Google e aceite o escopo do Search Console)" };
      if (res.status === 403)
        return {
          data: null,
          error: "sem_permissao (sua conta precisa ter acesso à propriedade GSC ou aceitar o scope webmasters.readonly)",
        };
      return { data: null, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ====================================================================
// Lista de propriedades (sites) do usuário logado.
// ====================================================================
export type GSCSite = {
  siteUrl: string;
  permissionLevel: string; // siteOwner, siteFullUser, siteRestrictedUser, siteUnverifiedUser
};

export async function listGSCSites() {
  const res = await gscFetch<{ siteEntry?: GSCSite[] }>(`${GSC_BASE}/sites`);
  if (res.error || !res.data) return { data: null, error: res.error };
  // Filtra só as que têm permissão real (ignora siteUnverifiedUser)
  const sites = (res.data.siteEntry || []).filter(
    (s) => s.permissionLevel !== "siteUnverifiedUser"
  );
  return { data: sites, error: null };
}

// ====================================================================
// Search Analytics — query principal pra métricas
// ====================================================================
export type GSCQueryRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
};

export type GSCQueryRequest = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dimensions?: ("query" | "page" | "country" | "device" | "date" | "searchAppearance")[];
  rowLimit?: number; // default 1000, max 25000
  startRow?: number; // pagination
  searchType?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  dimensionFilterGroups?: Array<{
    groupType?: "and";
    filters: Array<{
      dimension: "query" | "page" | "country" | "device";
      operator?: "contains" | "equals" | "notContains" | "notEquals" | "includingRegex" | "excludingRegex";
      expression: string;
    }>;
  }>;
};

export async function runGSCQuery(siteUrl: string, body: GSCQueryRequest) {
  // siteUrl precisa estar URL-encoded (ex.: https%3A%2F%2Fsuno.com.br%2F)
  const encoded = encodeURIComponent(siteUrl);
  return gscFetch<{ rows?: GSCQueryRow[]; responseAggregationType?: string }>(
    `${GSC_BASE}/sites/${encoded}/searchAnalytics/query`,
    body
  );
}

// ====================================================================
// Helpers para construir date ranges
// ====================================================================
export function buildGSCDateRange(days: number, customStart?: string | null, customEnd?: string | null) {
  if (customStart && customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customStart) && /^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
    return { startDate: customStart, endDate: customEnd };
  }
  // GSC tem latência de 2-3 dias. Por isso `endDate` = D-3 evita "buracos"
  // de dados nos últimos 2 dias que poluem a UI com zeros.
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}
