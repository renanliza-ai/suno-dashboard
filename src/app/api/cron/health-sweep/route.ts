import { listProperties } from "@/lib/ga4-server";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/cron/health-sweep
 *
 * Varredura diária de saúde dos conectores em TODAS as properties principais.
 * Pega "qualquer coisa fora do normal" - foco em ADS (Meta/Google) e GA4.
 *
 * Classificação:
 *   - anomaly   : conector deu ERRO real (API quebrou, token expirou) OU estava
 *                 configurado e voltou 0 campanhas sem fallback → AÇÃO
 *   - configGap : conector não configurado (falta credencial) → conhecido, não é
 *                 quebra; vira backlog de configuração, não alarme
 *   - ok        : carregou normal
 *
 * Auth: header Bearer CRON_SECRET (Vercel Cron manda automático quando a env
 * CRON_SECRET existe) OU sessão master. Sem isso → 401.
 *
 * Alertas push (Monday): OFF por padrão. Ativa com HEALTH_ALERT_MONDAY=true.
 * Enquanto off, o resultado fica no retorno JSON + logs da Vercel.
 */

// Propriedades de teste/descontinuadas ficam de fora da varredura.
const EXCLUDE_RE = /descontinuad|score-|de232|- app$|notícias|noticias/i;

type ConnStatus = { status: "ok" | "error" | "not_configured"; detail: string; count?: number };
type PropReport = {
  property: string;
  propertyId: string;
  meta: ConnStatus;
  google: ConnStatus;
  ga4: ConnStatus;
};

export async function GET(req: NextRequest) {
  // ---- Auth ----
  // Aceita: (1) Vercel Cron (user-agent vercel-cron) — funciona out-of-the-box;
  // (2) Bearer CRON_SECRET (opcional, mais forte); (3) sessão master.
  // A varredura só expõe status de conector (sem credenciais), risco baixo.
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const ua = req.headers.get("user-agent") || "";
  const isVercelCron = /vercel-cron/i.test(ua);
  const hasSecret = Boolean(secret && authHeader === `Bearer ${secret}`);
  let isMaster = false;
  if (!isVercelCron && !hasSecret) {
    const s = (await auth()) as { user?: { isMaster?: boolean } } | null;
    isMaster = Boolean(s?.user?.isMaster);
  }
  if (!isVercelCron && !hasSecret && !isMaster) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = req.nextUrl.origin;

  // ---- Properties ----
  const propsRes = await listProperties();
  if (propsRes.error || !propsRes.data) {
    return NextResponse.json({ ok: false, error: `listProperties: ${propsRes.error}` }, { status: 200 });
  }
  const properties = propsRes.data.filter((p) => !EXCLUDE_RE.test(p.displayName));

  // ---- Checa 1 property ----
  async function checkProperty(p: { id: string; displayName: string }): Promise<PropReport> {
    const meta: ConnStatus = { status: "error", detail: "sem resposta" };
    const google: ConnStatus = { status: "error", detail: "sem resposta" };
    const ga4: ConnStatus = { status: "error", detail: "sem resposta" };

    // Ads (meta + google) — 1 chamada combinada
    try {
      const r = await fetch(`${origin}/api/ads/campaigns?propertyName=${encodeURIComponent(p.displayName)}`, { cache: "no-store" });
      const j = await r.json();
      const m = j.platforms?.meta;
      const g = j.platforms?.google;
      if (m) {
        if (m.error === "not_configured") { meta.status = "not_configured"; meta.detail = "sem credencial Meta"; }
        else if (m.ok) { meta.status = "ok"; meta.detail = "carregou"; meta.count = m.campaignsCount || 0; }
        else { meta.status = "error"; meta.detail = m.error || m.message || "erro Meta"; }
      }
      if (g) {
        if (g.error === "not_configured") { google.status = "not_configured"; google.detail = "sem credencial Google"; }
        else if (g.ok) { google.status = "ok"; google.detail = "carregou"; google.count = g.campaignsCount || 0; }
        else { google.status = "error"; google.detail = g.error || g.message || "erro Google"; }
      }
    } catch (e) {
      meta.detail = google.detail = `fetch falhou: ${(e as Error).message}`;
    }

    // GA4 — presença de dados (últimos 7 dias)
    try {
      const r = await fetch(`${origin}/api/ga4/overview?propertyId=${p.id}&days=7`, { cache: "no-store" });
      const j = await r.json();
      if (j.errors?.kpis || j.error) { ga4.status = "error"; ga4.detail = j.errors?.kpis || j.error; }
      else if (j.kpis && (j.kpis.activeUsers > 0 || j.kpis.sessions > 0)) { ga4.status = "ok"; ga4.detail = `${j.kpis.sessions} sessões/7d`; }
      else { ga4.status = "error"; ga4.detail = "GA4 sem dados (7d)"; }
    } catch (e) {
      ga4.detail = `fetch falhou: ${(e as Error).message}`;
    }

    return { property: p.displayName, propertyId: p.id, meta, google, ga4 };
  }

  // ---- Roda em lotes de 4 (evita hammering de quota) ----
  const reports: PropReport[] = [];
  for (let i = 0; i < properties.length; i += 4) {
    const batch = properties.slice(i, i + 4);
    const res = await Promise.all(batch.map((p) => checkProperty(p)));
    reports.push(...res);
  }

  // ---- Classifica ----
  const anomalies: { property: string; connector: string; detail: string }[] = [];
  const configGaps: { property: string; connector: string }[] = [];
  for (const r of reports) {
    for (const [conn, st] of [["Meta Ads", r.meta], ["Google Ads", r.google], ["GA4", r.ga4]] as [string, ConnStatus][]) {
      if (st.status === "error") anomalies.push({ property: r.property, connector: conn, detail: st.detail });
      else if (st.status === "not_configured") configGaps.push({ property: r.property, connector: conn });
    }
  }

  const summary = {
    properties: reports.length,
    anomalies: anomalies.length,
    configGaps: configGaps.length,
    healthy: reports.filter((r) => r.meta.status !== "error" && r.google.status !== "error" && r.ga4.status !== "error").length,
  };

  // Log (visível nos logs da Vercel)
  console.log(`[health-sweep] ${new Date().toISOString()} | props=${summary.properties} anomalies=${summary.anomalies} configGaps=${summary.configGaps}`);
  if (anomalies.length > 0) {
    console.log(`[health-sweep] ANOMALIES: ${anomalies.map((a) => `${a.property}/${a.connector}: ${a.detail}`).join(" | ")}`);
  }

  // Alerta push no Monday (OFF por padrão — liga com HEALTH_ALERT_MONDAY=true)
  let alertResult: string | null = null;
  if (process.env.HEALTH_ALERT_MONDAY === "true" && anomalies.length > 0) {
    try {
      const body = anomalies.map((a) => `- **${a.property}** · ${a.connector}: ${a.detail}`).join("\n");
      const r = await fetch(`${origin}/api/monday/create-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[HEALTH] ${anomalies.length} conector(es) fora do normal`,
          description: `## 🚨 Varredura diária de saúde\n\nConectores com anomalia hoje:\n\n${body}\n\n_Gerado automaticamente pelo health-sweep._`,
          rawBody: false,
          priority: "Alta",
        }),
      });
      const j = await r.json();
      alertResult = j.ok ? `Monday item criado: ${j.item?.id}` : `falha: ${j.error}`;
    } catch (e) {
      alertResult = `erro ao alertar: ${(e as Error).message}`;
    }
  }

  return NextResponse.json(
    { ok: true, generatedAt: new Date().toISOString(), summary, anomalies, configGaps, reports, alertResult },
    { headers: { "Cache-Control": "no-store" } }
  );
}
