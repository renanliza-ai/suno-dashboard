import { NextRequest, NextResponse } from "next/server";
import { runReport } from "@/lib/ga4-server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/audit/data-quality
 *
 * Auditoria diária dos dados que servimos no painel vs o que o GA4 nativo
 * mostra. Cobre as 4 fontes mais comuns de divergência:
 *
 *   1) Métrica de usuário: totalUsers vs activeUsers vs newUsers
 *      → o GA4 UI mostra "Usuários ativos" (= activeUsers). Nosso painel
 *      historicamente usa totalUsers. Diferença típica: 0-3%, mas em
 *      properties com muito tráfego anônimo pode passar de 10%.
 *
 *   2) Métrica de conversão: keyEvents vs conversions
 *      → keyEvents é a métrica nova do GA4 (>= jul/24). conversions
 *      ainda funciona mas vai depreciar. Se houver eventos NOVOS marcados
 *      como keyEvent que não estavam marcados como conversion, divergem.
 *
 *   3) Channel grouping: sessionDefaultChannelGroup vs firstUserDefaultChannelGroup
 *      → quando "Aquisição" é mostrada no GA4, depende do report. Acquisition
 *      Overview usa firstUser. Traffic Acquisition usa session. São diferentes.
 *
 *   4) Sampling + freshness:
 *      → samplingMetadatas no response indica que GA4 amostrou (não confiável)
 *      → comparar D-1 vs D-2 vs same-DoW-last-week pra detectar dados
 *        ainda em processamento.
 *
 * Cada propriedade vira um "report card" com status ok | warning | error.
 *
 * Auth: query param ?token=BRIEFING_CRON_TOKEN (pra cron) OU sessão master.
 */

type AuditComparison = {
  set: string;
  label: string;
  values: Record<string, number>;
  variance_pct: Record<string, number>; // chave = "X_vs_Y"
  status: "ok" | "warning" | "error";
  threshold_pct: number;
  explanation: string;
};

type PropertyAudit = {
  id: string;
  name: string;
  status: "ok" | "warning" | "error" | "skipped";
  comparisons: AuditComparison[];
  sampling_detected: boolean;
  freshness_warning: string | null;
  errors: string[];
};

type AuditReport = {
  audit_at: string;
  audit_date: string; // YYYY-MM-DD do dia auditado (ontem)
  properties: PropertyAudit[];
  summary: {
    ok_count: number;
    warning_count: number;
    error_count: number;
    needs_attention: string[];
  };
};

const VARIANCE_WARNING_PCT = 5; // > 5% vira warning
const VARIANCE_ERROR_PCT = 15; // > 15% vira error

function calcVariance(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  if (a === 0 || b === 0) return 100;
  return Math.abs((a - b) / Math.max(a, b)) * 100;
}

/**
 * Lê metricValues de runReport — quando a query NÃO tem dimensões, o GA4
 * coloca o resultado em `rows[0]`, não em `totals[0]`. Quando tem dimensão
 * + metricAggregations, aí sim popula `totals[0]`. Esse helper tenta os
 * dois lugares e retorna o número convertido na posição requisitada, ou
 * `null` se nem rows[0] nem totals[0] existem (sinal de "sem dados").
 */
function readMetric(
  res: { data: { rows?: { metricValues?: { value: string }[] }[]; totals?: { metricValues?: { value: string }[] }[] } | null; error: string | null },
  index = 0
): number | null {
  // Prioridade 1: rows[0] (queries sem dimensão)
  const fromRows = res.data?.rows?.[0]?.metricValues?.[index]?.value;
  if (fromRows !== undefined) return Number(fromRows);
  // Prioridade 2: totals[0] (queries com dimensão + metricAggregations)
  const fromTotals = res.data?.totals?.[0]?.metricValues?.[index]?.value;
  if (fromTotals !== undefined) return Number(fromTotals);
  return null;
}

function pickStatus(variance: number): "ok" | "warning" | "error" {
  if (variance >= VARIANCE_ERROR_PCT) return "error";
  if (variance >= VARIANCE_WARNING_PCT) return "warning";
  return "ok";
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function auditProperty(propertyId: string, propertyName: string, auditDate: string): Promise<PropertyAudit> {
  const audit: PropertyAudit = {
    id: propertyId,
    name: propertyName,
    status: "ok",
    comparisons: [],
    sampling_detected: false,
    freshness_warning: null,
    errors: [],
  };

  const dateRange = { startDate: auditDate, endDate: auditDate };

  // ============================================================
  // SET 1 — Métricas de usuário (totalUsers vs activeUsers vs newUsers)
  // ============================================================
  try {
    const usersRes = await runReport(propertyId, {
      dateRanges: [dateRange],
      metrics: [
        { name: "totalUsers" },
        { name: "activeUsers" },
        { name: "newUsers" },
      ],
    });
    const totalUsers = readMetric(usersRes, 0);
    const activeUsers = readMetric(usersRes, 1);
    const newUsers = readMetric(usersRes, 2);
    if (usersRes.error || totalUsers === null) {
      audit.errors.push(`users metrics: ${usersRes.error || "no data"}`);
    } else {
      // Fallback: se algumas das 3 métricas não vieram, usa 0 (não é "sem dados")
      const totalUsersV = totalUsers || 0;
      const activeUsersV = activeUsers || 0;
      const newUsersV = newUsers || 0;
      const variance = calcVariance(totalUsersV, activeUsersV);
      audit.comparisons.push({
        set: "users",
        label: "Usuários — totalUsers (nosso painel) vs activeUsers (GA4 UI)",
        values: { totalUsers: totalUsersV, activeUsers: activeUsersV, newUsers: newUsersV },
        variance_pct: { totalUsers_vs_activeUsers: Number(variance.toFixed(2)) },
        status: pickStatus(variance),
        threshold_pct: VARIANCE_WARNING_PCT,
        explanation:
          variance < VARIANCE_WARNING_PCT
            ? "Diferença abaixo de 5% — normal. totalUsers conta qualquer user com evento; activeUsers exige sessão engajada."
            : variance < VARIANCE_ERROR_PCT
              ? `Diferença de ${variance.toFixed(1)}% entre totalUsers e activeUsers. Investigar se o painel deveria mostrar activeUsers em vez de totalUsers.`
              : `Divergência ALTA (${variance.toFixed(1)}%). Provável causa: alto volume de eventos sem engagement, ou bots inflando totalUsers.`,
      });
    }
  } catch (e) {
    audit.errors.push(`users metrics threw: ${(e as Error).message}`);
  }

  // ============================================================
  // SET 2 — Conversões: keyEvents vs conversions
  // ============================================================
  try {
    const [keyEventsRes, conversionsRes] = await Promise.all([
      runReport(propertyId, { dateRanges: [dateRange], metrics: [{ name: "keyEvents" }] }),
      runReport(propertyId, { dateRanges: [dateRange], metrics: [{ name: "conversions" }] }),
    ]);
    const keyEv = readMetric(keyEventsRes, 0) || 0;
    const conv = readMetric(conversionsRes, 0) || 0;

    if (keyEventsRes.error && conversionsRes.error) {
      audit.errors.push(`conversion metrics both failed: ${keyEventsRes.error}`);
    } else {
      const variance = calcVariance(keyEv, conv);
      audit.comparisons.push({
        set: "conversions",
        label: "Conversões — keyEvents (novo GA4) vs conversions (legado)",
        values: { keyEvents: keyEv, conversions: conv },
        variance_pct: { keyEvents_vs_conversions: Number(variance.toFixed(2)) },
        status: pickStatus(variance),
        threshold_pct: VARIANCE_WARNING_PCT,
        explanation:
          variance < VARIANCE_WARNING_PCT
            ? "Métricas alinhadas. keyEvents = soma de eventos marcados como 'Key event' no GA4 Admin."
            : `Divergência ${variance.toFixed(1)}% entre keyEvents e conversions. Provável causa: evento foi marcado como Key Event mas não como Conversion (ou vice-versa) no GA4 Admin → Events. Recomenda padronizar.`,
      });
    }
  } catch (e) {
    audit.errors.push(`conversion metrics threw: ${(e as Error).message}`);
  }

  // ============================================================
  // SET 3 — Channel grouping (session vs firstUser)
  // ============================================================
  try {
    const [sessionChRes, firstUserChRes] = await Promise.all([
      runReport(propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 5,
      }),
      runReport(propertyId, {
        dateRanges: [dateRange],
        dimensions: [{ name: "firstUserDefaultChannelGroup" }],
        metrics: [{ name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: 5,
      }),
    ]);

    const sessionCh = (sessionChRes.data?.rows || []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || "",
      sessions: Number(r.metricValues?.[0]?.value || 0),
    }));
    const firstUserCh = (firstUserChRes.data?.rows || []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || "",
      users: Number(r.metricValues?.[0]?.value || 0),
    }));

    const sessionTopCh = sessionCh[0]?.channel || "(none)";
    const firstUserTopCh = firstUserCh[0]?.channel || "(none)";
    const matched = sessionTopCh === firstUserTopCh;

    audit.comparisons.push({
      set: "channel_attribution",
      label: "Atribuição — Top canal (sessionDefault) vs (firstUserDefault)",
      values: {
        sessionTop_sessions: sessionCh[0]?.sessions || 0,
        firstUserTop_users: firstUserCh[0]?.users || 0,
      },
      variance_pct: { same_top_channel: matched ? 0 : 100 },
      status: matched ? "ok" : "warning",
      threshold_pct: 0,
      explanation: matched
        ? `Top canal igual nas 2 dimensões: ${sessionTopCh}. Atribuição consistente.`
        : `Top canal por sessão é "${sessionTopCh}" mas por primeiro toque é "${firstUserTopCh}". Painéis do GA4 podem mostrar números diferentes dependendo de qual dimensão usam (Acquisition Overview = firstUser, Traffic Acquisition = session).`,
    });
  } catch (e) {
    audit.errors.push(`channel attribution threw: ${(e as Error).message}`);
  }

  // ============================================================
  // SET 4 — Sessões em D-1 vs D-2 vs same-DoW-last-week (freshness)
  // ============================================================
  try {
    const dayMinus1 = auditDate;
    const dayMinus2 = daysAgoISO(2);
    const sameDoWLastWeek = daysAgoISO(8);

    const [d1, d2, dWeek] = await Promise.all([
      runReport(propertyId, {
        dateRanges: [{ startDate: dayMinus1, endDate: dayMinus1 }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      }),
      runReport(propertyId, {
        dateRanges: [{ startDate: dayMinus2, endDate: dayMinus2 }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      }),
      runReport(propertyId, {
        dateRanges: [{ startDate: sameDoWLastWeek, endDate: sameDoWLastWeek }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      }),
    ]);

    const s1 = readMetric(d1, 0) || 0;
    const s2 = readMetric(d2, 0) || 0;
    const sWeek = readMetric(dWeek, 0) || 0;

    // Se D-1 < 70% de D-2 OU < 70% de sameDoWLastWeek → freshness warning
    if (s2 > 0 && s1 < s2 * 0.7) {
      audit.freshness_warning = `Sessões de ontem (${s1}) estão muito abaixo de anteontem (${s2}). Pode ser dado ainda em processamento (GA4 leva 24-48h pra estabilizar) ou drop real.`;
    } else if (sWeek > 0 && s1 < sWeek * 0.5) {
      audit.freshness_warning = `Sessões de ontem (${s1}) estão muito abaixo do mesmo dia da semana passada (${sWeek}). Investigar.`;
    }

    audit.comparisons.push({
      set: "freshness",
      label: "Freshness — sessões D-1 vs D-2 vs mesmo dia da semana anterior",
      values: { D_minus_1: s1, D_minus_2: s2, same_dow_last_week: sWeek },
      variance_pct: {
        d1_vs_d2: s2 > 0 ? Number(calcVariance(s1, s2).toFixed(2)) : 0,
        d1_vs_dow_last_week: sWeek > 0 ? Number(calcVariance(s1, sWeek).toFixed(2)) : 0,
      },
      status: audit.freshness_warning ? "warning" : "ok",
      threshold_pct: 30,
      explanation: audit.freshness_warning || "Volume de ontem está consistente com tendência recente.",
    });
  } catch (e) {
    audit.errors.push(`freshness threw: ${(e as Error).message}`);
  }

  // ============================================================
  // Status final
  // ============================================================
  const hasError = audit.comparisons.some((c) => c.status === "error") || audit.errors.length > 0;
  const hasWarning = audit.comparisons.some((c) => c.status === "warning") || !!audit.freshness_warning;
  audit.status = hasError ? "error" : hasWarning ? "warning" : "ok";

  return audit;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenFromQuery = searchParams.get("token");
  const cronToken = process.env.BRIEFING_CRON_TOKEN;

  // Auth: query token (cron) OU bearer header
  const authHeader = req.headers.get("authorization");
  const tokenFromHeader = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  const provided = tokenFromQuery || tokenFromHeader;
  const isCron = !!(cronToken && provided === cronToken);

  // Auth: aceita (a) cron token via query/header OU (b) sessão master no painel
  if (!isCron) {
    const session = (await auth()) as {
      user?: { isMaster?: boolean; email?: string };
    } | null;
    if (!session?.user?.isMaster) {
      return NextResponse.json(
        { error: "forbidden_master_or_token_required" },
        { status: 403 }
      );
    }
  }

  // Lista de propriedades a auditar — vem de BRIEFING_PROPERTIES (mesmo formato
  // do briefing diário) pra evitar redundância.
  let properties: { id: string; name: string }[] = [];
  try {
    const raw = process.env.BRIEFING_PROPERTIES || "[]";
    properties = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "invalid_briefing_properties_env" },
      { status: 500 }
    );
  }

  if (properties.length === 0) {
    return NextResponse.json(
      { error: "no_properties_configured", hint: "Configure BRIEFING_PROPERTIES no .env" },
      { status: 500 }
    );
  }

  const auditDate = yesterdayISO();
  const startedAt = Date.now();

  // Audita propriedades em paralelo (são chamadas independentes)
  const propertyAudits = await Promise.all(
    properties.map((p) => auditProperty(p.id, p.name, auditDate))
  );

  const okCount = propertyAudits.filter((p) => p.status === "ok").length;
  const warningCount = propertyAudits.filter((p) => p.status === "warning").length;
  const errorCount = propertyAudits.filter((p) => p.status === "error").length;

  const needsAttention: string[] = [];
  for (const p of propertyAudits) {
    for (const c of p.comparisons) {
      if (c.status === "warning" || c.status === "error") {
        needsAttention.push(
          `[${p.name}] ${c.label}: ${Object.entries(c.variance_pct).map(([k, v]) => `${k}=${v}%`).join(", ")} — ${c.status.toUpperCase()}`
        );
      }
    }
    if (p.freshness_warning) {
      needsAttention.push(`[${p.name}] Freshness: ${p.freshness_warning}`);
    }
    for (const err of p.errors) {
      needsAttention.push(`[${p.name}] ERROR: ${err}`);
    }
  }

  const report: AuditReport = {
    audit_at: new Date().toISOString(),
    audit_date: auditDate,
    properties: propertyAudits,
    summary: {
      ok_count: okCount,
      warning_count: warningCount,
      error_count: errorCount,
      needs_attention: needsAttention,
    },
  };

  // Se for cron e tiver problemas, dispara email digest via Resend
  let emailSent = false;
  let emailError: string | null = null;
  if (isCron && (warningCount > 0 || errorCount > 0)) {
    try {
      const resendKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM || "Suno Analytics <onboarding@resend.dev>";
      const to = process.env.BRIEFING_EMAIL_TO;
      if (resendKey && to) {
        const html = renderAuditEmail(report);
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: to.split(",").map((s) => s.trim()),
            subject: `🔍 Auditoria GA4 ${auditDate} — ${errorCount} erro(s), ${warningCount} alerta(s)`,
            html,
          }),
        });
        if (r.ok) {
          emailSent = true;
        } else {
          const t = await r.text();
          emailError = `Resend ${r.status}: ${t.slice(0, 200)}`;
        }
      } else {
        emailError = "RESEND_API_KEY ou BRIEFING_EMAIL_TO não configurado";
      }
    } catch (e) {
      emailError = (e as Error).message;
    }
  }

  return NextResponse.json({
    ...report,
    elapsed_ms: Date.now() - startedAt,
    email_sent: emailSent,
    email_error: emailError,
  });
}

// ====================================================================
// Email digest (HTML simples, sem dependência externa)
// ====================================================================
function renderAuditEmail(report: AuditReport): string {
  const { audit_date, properties, summary } = report;
  const sevColor = (s: "ok" | "warning" | "error" | "skipped") =>
    s === "error" ? "#dc2626" : s === "warning" ? "#f59e0b" : s === "skipped" ? "#94a3b8" : "#10b981";
  const sevEmoji = (s: "ok" | "warning" | "error" | "skipped") =>
    s === "error" ? "🔴" : s === "warning" ? "🟡" : s === "skipped" ? "⚪" : "🟢";

  const propertyBlocks = properties
    .map((p) => {
      const compRows = p.comparisons
        .map(
          (c) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:12px;">
            ${sevEmoji(c.status)} <strong>${c.label}</strong>
            <div style="color:#64748b;margin-top:4px;font-size:11px;">${c.explanation}</div>
            <div style="color:#475569;margin-top:6px;font-family:monospace;font-size:11px;">
              ${Object.entries(c.values).map(([k, v]) => `${k}: <strong>${v.toLocaleString("pt-BR")}</strong>`).join(" · ")}
            </div>
            <div style="color:${sevColor(c.status)};margin-top:4px;font-family:monospace;font-size:11px;font-weight:bold;">
              ${Object.entries(c.variance_pct).map(([k, v]) => `${k}: ${v}%`).join(" · ")}
            </div>
          </td>
        </tr>`
        )
        .join("");

      return `
        <div style="margin:16px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:${sevColor(p.status)}15;padding:12px 16px;border-bottom:1px solid #e2e8f0;">
            <strong style="color:${sevColor(p.status)};font-size:14px;">
              ${sevEmoji(p.status)} ${p.name}
            </strong>
            <span style="color:#64748b;font-size:11px;margin-left:8px;">property ${p.id}</span>
            ${p.freshness_warning ? `<div style="color:#f59e0b;font-size:11px;margin-top:4px;">⏰ ${p.freshness_warning}</div>` : ""}
          </div>
          <table style="width:100%;border-collapse:collapse;">${compRows}</table>
        </div>`;
    })
    .join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#f8fafc;">
      <h1 style="color:#0f172a;margin:0 0 8px 0;">🔍 Auditoria GA4 — ${audit_date}</h1>
      <p style="color:#64748b;margin:0 0 20px 0;">
        🟢 ${summary.ok_count} ok · 🟡 ${summary.warning_count} alertas · 🔴 ${summary.error_count} erros
      </p>
      ${
        summary.needs_attention.length > 0
          ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;margin-bottom:16px;">
             <strong style="color:#9a3412;">⚠ Itens que precisam de atenção (${summary.needs_attention.length}):</strong>
             <ul style="color:#7c2d12;font-size:12px;margin:8px 0 0 16px;padding:0;">
               ${summary.needs_attention.slice(0, 10).map((a) => `<li style="margin-bottom:4px;">${a}</li>`).join("")}
             </ul>
           </div>`
          : `<div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:12px;margin-bottom:16px;">
             <strong style="color:#166534;">✅ Nenhum problema detectado nas propriedades.</strong>
           </div>`
      }
      ${propertyBlocks}
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;text-align:center;">
        Suno Analytics · auditoria automática diária às 23:59 BRT
      </p>
    </div>
  `;
}
