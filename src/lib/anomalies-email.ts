import type { AnomaliesResponse, Anomaly, AnomalyMetric, AnomalySeverity } from "./ga4-server";

/**
 * Gera o HTML do e-mail diário de briefing de anomalias.
 * Design pensado pra inbox: tabela única, sem JS, max-width 640px (padrão e-mail).
 * Cores inline (clientes de e-mail tipo Outlook ignoram CSS externo).
 */

const METRIC_LABELS: Record<AnomalyMetric, string> = {
  users: "Usuários únicos",
  sessions: "Sessões",
  engagedSessions: "Sessões engajadas",
  leads: "Leads",
  purchases: "Vendas",
  revenue: "Receita",
};

const SEVERITY_COLOR: Record<AnomalySeverity, { bg: string; border: string; text: string }> = {
  critical: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  attention: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
  normal: { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" },
  low_volume: { bg: "#f8fafc", border: "#e2e8f0", text: "#64748b" },
};

const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  critical: "🔴 Crítico",
  attention: "🟡 Atenção",
  normal: "🟢 Normal",
  low_volume: "○ Volume baixo",
};

function fmt(n: number, metric: AnomalyMetric): string {
  if (metric === "revenue") {
    if (n >= 1000) return `R$ ${(n / 1000).toFixed(1)}k`;
    return `R$ ${n.toFixed(0)}`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toLocaleString("pt-BR");
}

function deltaColor(direction: string, severity: AnomalySeverity): string {
  if (severity === "critical" && direction === "down") return "#dc2626";
  if (severity === "critical" && direction === "up") return "#059669";
  if (severity === "attention" && direction === "down") return "#d97706";
  if (severity === "attention" && direction === "up") return "#059669";
  if (direction === "up") return "#059669";
  if (direction === "down") return "#dc2626";
  return "#64748b";
}

function arrowIcon(direction: string): string {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "→";
}

function buildKpiCard(a: Anomaly): string {
  const colors = SEVERITY_COLOR[a.severity];
  const dColor = deltaColor(a.direction, a.severity);
  return `
    <td valign="top" style="padding: 6px;" width="33%">
      <table cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #ffffff; border: 2px solid ${colors.border}; border-radius: 12px;">
        <tr>
          <td style="padding: 12px;">
            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 4px;">
              ${METRIC_LABELS[a.metric]}
            </div>
            <div style="font-size: 22px; font-weight: 700; color: #0f0f1a; line-height: 1; margin-bottom: 6px;">
              ${fmt(a.current, a.metric)}
            </div>
            <div style="font-size: 13px; font-weight: 700; color: ${dColor}; margin-bottom: 4px;">
              ${arrowIcon(a.direction)} ${a.delta > 0 ? "+" : ""}${a.delta.toFixed(1)}%
            </div>
            <div style="font-size: 10px; color: #6b7280;">
              vs ${fmt(a.baseline, a.metric)}
            </div>
            <div style="display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 6px; background: ${colors.bg}; color: ${colors.text}; font-size: 9px; font-weight: 700;">
              ${SEVERITY_LABEL[a.severity]}
            </div>
          </td>
        </tr>
      </table>
    </td>
  `;
}

function buildAnomalyTable(rows: Anomaly[], levelLabel: string): string {
  if (rows.length === 0) {
    return `<p style="color: #6b7280; font-size: 13px; padding: 16px; background: #f8fafc; border-radius: 8px;">✅ Nenhuma anomalia significativa em ${levelLabel.toLowerCase()}.</p>`;
  }
  const tableRows = rows
    .slice(0, 10)
    .map((a) => {
      const colors = SEVERITY_COLOR[a.severity];
      const dColor = deltaColor(a.direction, a.severity);
      const segDisplay = a.segment === "(not set)" ? "<i style='color:#94a3b8;'>(não definido)</i>" : a.segment;
      return `
        <tr style="background: ${a.severity === "critical" ? "#fef2f2" : a.severity === "attention" ? "#fffbeb" : "#ffffff"};">
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-family: ui-monospace, monospace; font-size: 11px; max-width: 220px; word-break: break-word;">
            ${segDisplay}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #475569;">
            ${METRIC_LABELS[a.metric]}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; text-align: right; font-weight: 700;">
            ${fmt(a.current, a.metric)}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; text-align: right; color: #6b7280;">
            ${fmt(a.baseline, a.metric)}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; text-align: right; font-weight: 700; color: ${dColor};">
            ${arrowIcon(a.direction)} ${a.delta > 0 ? "+" : ""}${a.delta.toFixed(1)}%
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; background: ${colors.bg}; color: ${colors.text}; font-size: 9px; font-weight: 700; border: 1px solid ${colors.border};">
              ${SEVERITY_LABEL[a.severity]}
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
  return `
    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f1f5f9;">
          <th align="left" style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">${levelLabel}</th>
          <th align="left" style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Métrica</th>
          <th align="right" style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Atual</th>
          <th align="right" style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Baseline</th>
          <th align="right" style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Δ</th>
          <th align="center" style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">Severidade</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    ${rows.length > 10 ? `<p style="margin: 8px 0; font-size: 11px; color: #6b7280; text-align: center;">+${rows.length - 10} anomalias adicionais — abra o painel para ver todas.</p>` : ""}
  `;
}

export function buildAnomaliesEmailHTML(
  data: AnomaliesResponse,
  options: { propertyName: string; panelUrl?: string }
): string {
  const { propertyName, panelUrl = "http://localhost:3000/anomalias" } = options;
  const dateBR = new Date(data.date + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const macroCritical = data.macro.filter((a) => a.severity === "critical").length;
  const channelCritical = data.byChannel.filter((a) => a.severity === "critical").length;
  const campaignCritical = data.byCampaign.filter((a) => a.severity === "critical").length;

  // Briefing — formata o markdown simplificado pra HTML (** → <strong>)
  const briefingHTML = data.briefing
    .map(
      (line) =>
        `<li style="margin-bottom: 8px; line-height: 1.5;">${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`
    )
    .join("");

  // KPIs em linhas de 3 colunas
  const macroCards = data.macro;
  const macroRows: string[] = [];
  for (let i = 0; i < macroCards.length; i += 3) {
    const slice = macroCards.slice(i, i + 3);
    macroRows.push(`<tr>${slice.map(buildKpiCard).join("")}</tr>`);
  }

  const filteredChannels = data.byChannel.filter(
    (a) => a.severity === "critical" || a.severity === "attention"
  );
  const filteredCampaigns = data.byCampaign.filter(
    (a) => a.severity === "critical" || a.severity === "attention"
  );

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Briefing diário · ${propertyName}</title>
</head>
<body style="margin: 0; padding: 0; background: #f7f7fb; font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f0f1a;">
  <div style="max-width: 720px; margin: 0 auto; padding: 24px 16px;">

    <!-- Cabeçalho com gradient -->
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #5b21b6 50%, #1e1b4b 100%); border-radius: 16px; padding: 24px; color: #ffffff; margin-bottom: 16px;">
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; margin-bottom: 4px;">
        📊 BRIEFING DIÁRIO · ${propertyName}
      </div>
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">
        Anomalias do dia · ${dateBR}
      </h1>
      <p style="margin: 0; font-size: 13px; opacity: 0.85;">
        Comparando ontem (D-1) contra mediana dos últimos ${data.baselineDays} dias${
          data.dayOfWeekAware
            ? ` <span style="background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">⚙ Day-of-week aware</span>`
            : ""
        }
      </p>
      ${
        macroCritical + channelCritical + campaignCritical > 0
          ? `<div style="margin-top: 12px;">
              ${macroCritical > 0 ? `<span style="display: inline-block; padding: 4px 10px; background: rgba(239, 68, 68, 0.25); color: #fecaca; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; font-size: 11px; font-weight: 700; margin-right: 6px;">🔴 ${macroCritical} crítico macro</span>` : ""}
              ${channelCritical > 0 ? `<span style="display: inline-block; padding: 4px 10px; background: rgba(245, 158, 11, 0.25); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px; font-size: 11px; font-weight: 700; margin-right: 6px;">🟡 ${channelCritical} canal</span>` : ""}
              ${campaignCritical > 0 ? `<span style="display: inline-block; padding: 4px 10px; background: rgba(249, 115, 22, 0.25); color: #fed7aa; border: 1px solid rgba(249, 115, 22, 0.4); border-radius: 6px; font-size: 11px; font-weight: 700;">🟠 ${campaignCritical} campanha</span>` : ""}
            </div>`
          : `<div style="margin-top: 12px;"><span style="display: inline-block; padding: 4px 10px; background: rgba(16, 185, 129, 0.25); color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 6px; font-size: 11px; font-weight: 700;">🟢 Nenhuma anomalia crítica</span></div>`
      }
    </div>

    <!-- Briefing em texto natural -->
    <div style="background: #ffffff; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 12px 0; font-size: 16px; color: #1e1b4b;">🎯 O que olhar primeiro</h2>
      <ul style="margin: 0; padding-left: 20px; color: #1f2937; font-size: 14px;">
        ${briefingHTML}
      </ul>
    </div>

    <!-- Macro KPIs (cards 3 cols) -->
    <h2 style="margin: 16px 0 12px 0; font-size: 14px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
      Visão Macro · 6 métricas
    </h2>
    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 16px;">
      ${macroRows.join("")}
    </table>

    <!-- Por Canal -->
    <h2 style="margin: 16px 0 12px 0; font-size: 14px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
      Por Canal · ${filteredChannels.length} anomalias (críticas + atenção)
    </h2>
    ${buildAnomalyTable(filteredChannels, "Canal")}

    <!-- Por Campanha -->
    <h2 style="margin: 24px 0 12px 0; font-size: 14px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
      Por Campanha · ${filteredCampaigns.length} anomalias (críticas + atenção)
    </h2>
    ${buildAnomalyTable(filteredCampaigns, "Campanha")}

    <!-- CTA pra abrir o painel -->
    <div style="margin: 24px 0; text-align: center;">
      <a href="${panelUrl}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #7c5cff, #5b3dd4); color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700;">
        Abrir painel completo →
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 16px; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 4px 0;">
        <strong>Algoritmo:</strong> classifica como crítico se |Δ| &gt; 25%, atenção entre 10-25%, normal &lt; 10%.
      </p>
      <p style="margin: 0 0 4px 0;">
        Volume baixo (baseline &lt; 50) ignorado para evitar falso positivo. ${
          data.dayOfWeekAware
            ? `<strong>Day-of-week aware:</strong> baseline filtrada pra dias da mesma semana.`
            : ""
        }
      </p>
      <p style="margin: 0;">
        Gerado por Suno Analytics · ${new Date().toLocaleString("pt-BR")}
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Versão texto-puro do briefing (fallback pra clients que bloqueiam HTML).
 */
export function buildAnomaliesEmailText(
  data: AnomaliesResponse,
  propertyName: string
): string {
  const lines: string[] = [];
  lines.push(`Briefing diário · ${propertyName} · ${data.date}`);
  lines.push(`Comparando D-1 vs mediana ${data.baselineDays}d${data.dayOfWeekAware ? " (day-of-week aware)" : ""}`);
  lines.push("");
  lines.push("===== O QUE OLHAR PRIMEIRO =====");
  for (const b of data.briefing) {
    lines.push(`- ${b.replace(/\*\*/g, "")}`);
  }
  lines.push("");
  lines.push("===== MACRO =====");
  for (const a of data.macro) {
    const arrow = a.direction === "up" ? "↑" : a.direction === "down" ? "↓" : "→";
    lines.push(`${a.metricLabel}: ${fmt(a.current, a.metric)} (${arrow}${a.delta > 0 ? "+" : ""}${a.delta.toFixed(1)}%) — baseline ${fmt(a.baseline, a.metric)} [${a.severity}]`);
  }
  return lines.join("\n");
}
