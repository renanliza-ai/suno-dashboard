import { getAnomalies } from "@/lib/ga4-server";
import { buildAnomaliesEmailHTML, buildAnomaliesEmailText } from "@/lib/anomalies-email";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/anomalies/send-daily-briefing
 *
 * Endpoint chamado por cron externo (cron-job.org / Vercel Cron / Windows Task
 * Scheduler) toda manhã às 8h. Gera o briefing de anomalias do dia anterior
 * para cada propriedade configurada e envia e-mail via Resend.
 *
 * 🔒 AUTENTICAÇÃO: requer header `Authorization: Bearer <BRIEFING_CRON_TOKEN>`.
 * Esse token é independente do login OAuth (cron não pode usar Google login).
 *
 * Configuração necessária em .env.local:
 *   RESEND_API_KEY            — chave da API Resend (resend.com)
 *   RESEND_FROM               — e-mail remetente (ex.: noreply@suno.com.br)
 *   BRIEFING_EMAIL_TO         — destinatário(s) separados por vírgula
 *   BRIEFING_PROPERTIES       — JSON: [{"id":"339551432","name":"Suno Research"}, ...]
 *   BRIEFING_CRON_TOKEN       — token secreto pra autenticar o cron
 *   BRIEFING_PANEL_URL        — URL pública do painel (ex.: https://painel.suno.com.br/anomalias)
 *   BRIEFING_ACCESS_TOKEN     — Google OAuth access token de uma service account
 *                                 (necessário pq cron não tem sessão de usuário)
 */

export async function POST(req: NextRequest) {
  return runBriefing(req);
}
// Suporte GET pra cron-job.org (que só aceita GET por padrão)
export async function GET(req: NextRequest) {
  return runBriefing(req);
}

async function runBriefing(req: NextRequest) {
  const expectedToken = process.env.BRIEFING_CRON_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "BRIEFING_CRON_TOKEN não configurado em .env.local" },
      { status: 500 }
    );
  }

  // Validação do token — header Bearer OU query param `token`
  const authHeader = req.headers.get("authorization");
  const tokenFromHeader = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const tokenFromQuery = req.nextUrl.searchParams.get("token");
  const token = tokenFromHeader || tokenFromQuery;

  if (!token || token !== expectedToken) {
    return NextResponse.json(
      { error: "unauthorized — token inválido ou ausente" },
      { status: 401 }
    );
  }

  // Validações de config
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM;
  const toEmails = process.env.BRIEFING_EMAIL_TO;
  const propertiesJson = process.env.BRIEFING_PROPERTIES;
  const panelUrl = process.env.BRIEFING_PANEL_URL || "http://localhost:3000/anomalias";

  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY ausente" }, { status: 500 });
  if (!fromEmail) return NextResponse.json({ error: "RESEND_FROM ausente" }, { status: 500 });
  if (!toEmails) return NextResponse.json({ error: "BRIEFING_EMAIL_TO ausente" }, { status: 500 });
  if (!propertiesJson) {
    return NextResponse.json({ error: "BRIEFING_PROPERTIES ausente" }, { status: 500 });
  }

  let properties: { id: string; name: string }[];
  try {
    properties = JSON.parse(propertiesJson);
    if (!Array.isArray(properties)) throw new Error("não é array");
  } catch (e) {
    return NextResponse.json(
      { error: `BRIEFING_PROPERTIES inválido: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);
  const recipientList = toEmails.split(",").map((e) => e.trim()).filter(Boolean);
  const results: { property: string; status: "sent" | "error"; detail?: string; messageId?: string }[] = [];

  // Pra cada propriedade, gera anomalias + envia e-mail
  for (const prop of properties) {
    try {
      const { data, error } = await getAnomalies(prop.id, 14, { dayOfWeekAware: true });
      if (error || !data) {
        results.push({ property: prop.name, status: "error", detail: error || "no_data" });
        continue;
      }

      const html = buildAnomaliesEmailHTML(data, { propertyName: prop.name, panelUrl });
      const text = buildAnomaliesEmailText(data, prop.name);

      // Conta anomalias críticas pra subject linha
      const criticals = [...data.macro, ...data.byChannel, ...data.byCampaign].filter(
        (a) => a.severity === "critical"
      ).length;
      const subjectPrefix = criticals > 0 ? `🔴 ${criticals} crítica(s) · ` : "📊 ";
      const subject = `${subjectPrefix}Briefing ${prop.name} · ${data.date}`;

      const { data: mailData, error: mailError } = await resend.emails.send({
        from: fromEmail,
        to: recipientList,
        subject,
        html,
        text,
      });

      if (mailError) {
        results.push({ property: prop.name, status: "error", detail: JSON.stringify(mailError) });
      } else {
        results.push({ property: prop.name, status: "sent", messageId: mailData?.id });
      }
    } catch (e) {
      results.push({ property: prop.name, status: "error", detail: (e as Error).message });
    }
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  return NextResponse.json({
    ok: sentCount > 0,
    sentCount,
    totalCount: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
