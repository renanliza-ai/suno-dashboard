"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Alertas de qualidade de coleta — 100% data-driven a partir dos eventos reais
 * do GA4 (useGA4Overview). Detecta padrões que sujam a medição:
 *
 *   1. Eventos de TESTE em producao (teste/test/debug/dummy) com volume alto
 *   2. Nomes DUPLICADOS/inconsistentes (page_view vs pageview, *_oficial)
 *
 * Nao inventa nada: se nao houver evento suspeito, mostra "tudo limpo".
 */

type EventRow = { name: string; value: number };

// Pares canonicos que costumam aparecer duplicados por migracao inacabada.
const DUP_PAIRS: [string, string][] = [
  ["page_view", "pageview"],
  ["view_item", "view_item_oficial"],
  ["add_to_cart", "add_to_cart_oficial"],
];

const TEST_RE = /^(teste|test|debug|dummy|xxx|asdf)$|_teste|_test$/i;

export function TrackingQaAlerts() {
  const { useRealData } = useGA4();
  const { data: overview, meta } = useGA4Overview();

  if (!useRealData || meta.status !== "success" || !overview?.events) return null;

  const events: EventRow[] = overview.events.map((e) => ({ name: e.name, value: e.value }));
  const byName = new Map(events.map((e) => [e.name, e.value]));

  type Alert = { severity: "critical" | "warning"; title: string; detail: string };
  const alerts: Alert[] = [];

  // 1. Eventos de teste em producao
  for (const e of events) {
    if (TEST_RE.test(e.name) && e.value > 0) {
      alerts.push({
        severity: "critical",
        title: `Evento de teste em produção: "${e.name}"`,
        detail: `${formatNumber(e.value)} disparos no período. Evento de teste/debug não deveria rodar em produção - infla a coleta e polui relatórios. Caçar a tag/gatilho no GTM e desativar.`,
      });
    }
  }

  // 2. Nomes duplicados/inconsistentes
  for (const [a, b] of DUP_PAIRS) {
    const va = byName.get(a);
    const vb = byName.get(b);
    if (va && vb && va > 0 && vb > 0) {
      alerts.push({
        severity: "warning",
        title: `Evento duplicado: "${a}" e "${b}"`,
        detail: `Os dois disparam (${formatNumber(va)} vs ${formatNumber(vb)}). Mesmo conceito com dois nomes quebra funil e relatório. Padronizar num nome só no GTM e descontinuar o outro.`,
      });
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-[color:var(--border)] bg-white p-5">
      <h3 className="text-base font-semibold flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-amber-600" />
        Qualidade de coleta
        <span className="text-[10px] font-mono text-[color:var(--muted-foreground)] bg-[color:var(--muted)] px-1.5 py-0.5 rounded">
          auto · GA4 real
        </span>
      </h3>
      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 size={15} /> Nenhum evento de teste ou nome duplicado detectado nesta property.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-xl border p-3 text-xs ${
                a.severity === "critical"
                  ? "bg-red-50 border-red-200 text-red-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle size={13} /> {a.title}
              </p>
              <p className="mt-1 leading-relaxed">{a.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
