"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock,
  Database,
  Info,
} from "lucide-react";
import { MasterOnly } from "@/components/master-only";

type AuditComparison = {
  set: string;
  label: string;
  values: Record<string, number>;
  variance_pct: Record<string, number>;
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
  audit_date: string;
  properties: PropertyAudit[];
  summary: {
    ok_count: number;
    warning_count: number;
    error_count: number;
    needs_attention: string[];
  };
  elapsed_ms?: number;
  email_sent?: boolean;
  email_error?: string | null;
};

export default function AuditoriaPage() {
  return (
    <MasterOnly>
      <AuditoriaContent />
    </MasterOnly>
  );
}

function AuditoriaContent() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      // Endpoint aceita sessão master automaticamente (cookie httpOnly do NextAuth)
      // OU bearer token (usado pelo cron). UI só precisa fetch direto.
      const r = await fetch("/api/audit/data-quality", { cache: "no-store" });
      if (!r.ok) {
        const t = await r.text();
        setError(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return;
      }
      const data = (await r.json()) as AuditReport;
      setReport(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1400px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <ShieldCheck size={20} className="text-white" />
            </span>
            Auditoria de Dados
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 uppercase tracking-wider">
              Master
            </span>
          </h1>
          <p className="text-[color:var(--muted-foreground)] mt-1">
            Compara as métricas que o painel mostra com o que o GA4 nativo retorna ·
            Detecta sampling, divergência de métrica/dimensão e dados ainda em
            processamento. Roda automaticamente todo dia às 23:59 BRT.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Rodar auditoria agora
        </button>
      </motion.div>

      {/* Mapeamento de métricas — visível sempre */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5 mb-6">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Info size={14} className="text-blue-600" />
          Mapeamento — o que cada card do painel significa em termos de GA4
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <MappingRow
            label="Usuários Ativos"
            metric="totalUsers"
            note="Conta qualquer user que disparou evento. GA4 UI mostra activeUsers (sessões engajadas) — pequena diferença é normal."
          />
          <MappingRow
            label="Sessões"
            metric="sessions"
            note="Mesma métrica usada no GA4 UI. 1 sessão = visita com 30min sem inatividade."
          />
          <MappingRow
            label="Pageviews"
            metric="screenPageViews"
            note="Renomeado em GA4. Conta page_view + screen_view (apps)."
          />
          <MappingRow
            label="Conversões"
            metric="keyEvents (com fallback p/ conversions)"
            note="GA4 trocou nome de 'conversion' pra 'key event' em jul/24. Eventos podem estar marcados em só uma das duas."
          />
          <MappingRow
            label="Bounce Rate"
            metric="bounceRate × 100"
            note="GA4 retorna 0-1 (decimal). Multiplicamos por 100 pra mostrar %."
          />
          <MappingRow
            label="Engaged Sessions"
            metric="engagedSessions"
            note="Sessão > 10s OU com conversão OU com 2+ pageviews."
          />
          <MappingRow
            label="Canal (Aquisição)"
            metric="sessionDefaultChannelGroup"
            note="Atribuição last-click por sessão. GA4 'Acquisition Overview' usa firstUserDefaultChannelGroup (atribuição first-touch) — números são DIFERENTES."
          />
          <MappingRow
            label="Receita"
            metric="totalRevenue / purchaseRevenue"
            note="Disparado pelo evento purchase. Soma 'value' do parâmetro do evento."
          />
        </div>
      </div>

      {/* Status loading/error */}
      {loading && !report && (
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-12 flex flex-col items-center gap-3 text-[color:var(--muted-foreground)]">
          <Loader2 size={32} className="animate-spin text-emerald-600" />
          <span className="text-sm">Rodando auditoria nas propriedades...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 text-red-700 text-sm">
          <strong>Erro ao rodar auditoria:</strong>
          <pre className="mt-2 text-xs font-mono whitespace-pre-wrap">{error}</pre>
          <p className="mt-2 text-xs">
            Provável causa: <code className="bg-red-100 px-1 rounded">NEXT_PUBLIC_BRIEFING_CRON_TOKEN</code> não está
            setado, ou o endpoint exige token e ele não foi passado. Em produção, configure essa env var na Vercel.
          </p>
        </div>
      )}

      {report && (
        <>
          {/* Summary card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              icon={CheckCircle2}
              label="OK"
              value={report.summary.ok_count}
              total={report.properties.length}
              color="#10b981"
            />
            <SummaryCard
              icon={AlertTriangle}
              label="Alertas (>5%)"
              value={report.summary.warning_count}
              total={report.properties.length}
              color="#f59e0b"
            />
            <SummaryCard
              icon={XCircle}
              label="Erros (>15%)"
              value={report.summary.error_count}
              total={report.properties.length}
              color="#dc2626"
            />
            <SummaryCard
              icon={Clock}
              label="Auditado"
              value={report.audit_date}
              total={`${(report.elapsed_ms || 0) / 1000}s`}
              color="#7c5cff"
              isText
            />
          </div>

          {/* Needs attention */}
          {report.summary.needs_attention.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-amber-900">
                <AlertTriangle size={14} />
                Precisa de atenção ({report.summary.needs_attention.length})
              </h3>
              <ul className="space-y-1.5 text-xs text-amber-900">
                {report.summary.needs_attention.map((a, i) => (
                  <li key={i} className="font-mono leading-snug">• {a}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-property cards */}
          <div className="space-y-4">
            {report.properties.map((p) => (
              <PropertyAuditCard key={p.id} audit={p} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function MappingRow({ label, metric, note }: { label: string; metric: string; note: string }) {
  return (
    <div className="p-3 rounded-lg border border-[color:var(--border)] bg-slate-50/50">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-slate-800">{label}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
          {metric}
        </span>
      </div>
      <p className="text-[11px] text-slate-600 leading-snug">{note}</p>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  total,
  color,
  isText,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: number | string;
  total: number | string;
  color: string;
  isText?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
          {label}
        </div>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
        {!isText && (
          <span className="text-sm text-[color:var(--muted-foreground)] font-normal ml-1">
            / {total}
          </span>
        )}
      </div>
      {isText && (
        <div className="text-[10px] text-[color:var(--muted-foreground)] mt-1">
          em {total}
        </div>
      )}
    </div>
  );
}

function PropertyAuditCard({ audit }: { audit: PropertyAudit }) {
  const sevColor =
    audit.status === "error"
      ? "#dc2626"
      : audit.status === "warning"
        ? "#f59e0b"
        : audit.status === "skipped"
          ? "#94a3b8"
          : "#10b981";
  const SevIcon =
    audit.status === "error" ? XCircle : audit.status === "warning" ? AlertTriangle : CheckCircle2;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden"
    >
      <div
        className="px-5 py-3 flex items-center justify-between border-b border-[color:var(--border)]"
        style={{ background: `${sevColor}10` }}
      >
        <div className="flex items-center gap-2">
          <SevIcon size={16} style={{ color: sevColor }} />
          <strong className="text-sm" style={{ color: sevColor }}>
            {audit.name}
          </strong>
          <span className="text-[10px] font-mono text-[color:var(--muted-foreground)]">
            property {audit.id}
          </span>
        </div>
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: `${sevColor}20`, color: sevColor }}
        >
          {audit.status}
        </span>
      </div>

      {audit.freshness_warning && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-start gap-2">
          <Clock size={12} className="mt-0.5 shrink-0" />
          <span>{audit.freshness_warning}</span>
        </div>
      )}

      {audit.errors.length > 0 && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-200 text-red-700 text-xs">
          <strong>Erros técnicos:</strong>
          <ul className="mt-1 ml-4 list-disc">
            {audit.errors.map((e, i) => (
              <li key={i} className="font-mono">{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="divide-y divide-[color:var(--border)]">
        {audit.comparisons.map((c, i) => (
          <ComparisonRow key={i} comp={c} />
        ))}
      </div>
    </motion.div>
  );
}

function ComparisonRow({ comp }: { comp: AuditComparison }) {
  const sevColor =
    comp.status === "error" ? "#dc2626" : comp.status === "warning" ? "#f59e0b" : "#10b981";
  const SevIcon =
    comp.status === "error" ? XCircle : comp.status === "warning" ? AlertTriangle : CheckCircle2;

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2 flex-1">
          <SevIcon size={14} className="mt-0.5 shrink-0" style={{ color: sevColor }} />
          <div className="flex-1">
            <div className="text-sm font-semibold">{comp.label}</div>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-1 leading-snug">
              {comp.explanation}
            </p>
          </div>
        </div>
      </div>

      <div className="ml-6 grid grid-cols-2 gap-3 mt-2">
        {/* Valores */}
        <div className="text-xs space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-1">
            Valores comparados
          </div>
          {Object.entries(comp.values).map(([k, v]) => (
            <div key={k} className="flex justify-between font-mono">
              <span className="text-slate-500">{k}:</span>
              <strong className="text-slate-800">{Number(v).toLocaleString("pt-BR")}</strong>
            </div>
          ))}
        </div>

        {/* Variâncias */}
        <div className="text-xs space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-1">
            Variância
          </div>
          {Object.entries(comp.variance_pct).map(([k, v]) => {
            const status = v >= 15 ? "error" : v >= 5 ? "warning" : "ok";
            const color = status === "error" ? "#dc2626" : status === "warning" ? "#f59e0b" : "#10b981";
            return (
              <div key={k} className="flex justify-between font-mono">
                <span className="text-slate-500">{k}:</span>
                <strong style={{ color }}>{v}%</strong>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
