"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Tag,
  Search,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { MasterOnly } from "@/components/master-only";
import { useGA4 } from "@/lib/ga4-context";

type Diagnosis = { severity: "info" | "warning" | "error"; message: string };

type SourceMediumRow = {
  source: string;
  medium: string;
  sessions: number;
  users: number;
  conversions: number;
};

type CampaignRow = {
  campaign: string;
  source: string;
  medium: string;
  sessions: number;
  conversions: number;
};

type Variation = {
  canonical: string;
  variants: { name: string; sessions: number }[];
  totalSessions: number;
  variantCount: number;
};

type UTMAuditData = {
  filterPath: string;
  totalSessions: number;
  directNoneSessions: number;
  directNonePct: number;
  notSetSessions: number;
  notSetPct: number;
  sourceMedium: SourceMediumRow[];
  campaigns: CampaignRow[];
  pagesRaw: { url: string; sessions: number }[];
  sourceVariations: Variation[];
  mediumVariations: Variation[];
  diagnoses: Diagnosis[];
  range: { startDate: string; endDate: string };
  days: number;
};

export default function AuditoriaUTMPage() {
  return (
    <MasterOnly>
      <Content />
    </MasterOnly>
  );
}

function Content() {
  const { selectedId, selected, useRealData, days, customRange } = useGA4();
  const [pathFilter, setPathFilter] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [data, setData] = useState<UTMAuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAudit = async (path: string) => {
    if (!selectedId || !useRealData) {
      setError("Selecione uma propriedade GA4 no header.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        propertyId: selectedId,
        path,
        days: String(days),
      });
      if (customRange) {
        params.set("startDate", customRange.startDate);
        params.set("endDate", customRange.endDate);
      }
      const r = await fetch(`/api/audit/utm?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) {
        const t = await r.text();
        setError(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        return;
      }
      const d = await r.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      setData(d.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit(pathFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, days, customRange?.startDate, customRange?.endDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPathFilter(pathInput.trim());
    fetchAudit(pathInput.trim());
  };

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1400px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-700 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Tag size={20} className="text-white" />
          </span>
          Auditoria de UTMs
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 uppercase tracking-wider">
            Master
          </span>
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Investiga divergência entre source/medium do GA4 e PowerBI/sunocode.
          Detecta variações de naming, UTMs perdidas e (direct)/(none) acima do
          esperado. {selected?.displayName && <strong>{selected.displayName}</strong>}
        </p>
      </motion.div>

      {/* Search */}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-6 flex items-center gap-3"
      >
        <Search size={16} className="text-[color:var(--muted-foreground)] shrink-0" />
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          placeholder="Filtrar por path da LP (ex: webinario-status-alpha) — vazio = site todo"
          className="flex-1 px-2 py-2 text-sm outline-none bg-transparent"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition"
        >
          Auditar
        </button>
      </form>

      {/* Como interpretar — sempre visível */}
      <details className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6">
        <summary className="text-sm font-semibold cursor-pointer flex items-center gap-2 text-blue-900">
          <Info size={14} />
          Por que GA4 e PowerBI/sunocode divergem? (clica pra entender)
        </summary>
        <div className="mt-3 text-xs text-blue-900 space-y-2 leading-relaxed">
          <p>
            <strong>Os 2 sistemas medem coisas diferentes</strong>:
          </p>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              <strong>GA4</strong> mede a <em>aquisição da sessão</em> (last-click). Se um usuário entra
              com UTM hoje e volta direto amanhã pra comprar, GA4 atribui à 2ª sessão como (direct)/(none).
            </li>
            <li>
              <strong>Sunocode/PowerBI</strong> salva a URL no momento da conversão. Mesmo cenário acima:
              se a URL final do checkout tem o SunoCode, o BI atribui ao SNC original — independente de
              quanto tempo se passou.
            </li>
          </ul>
          <p>
            Por isso GA4 sempre vai ter mais (direct) e menos atribuição de canais. PowerBI/sunocode tende
            a inflar volume dos canais que primeiro tocaram o usuário.
          </p>
          <p>
            <strong>Qual é a verdade?</strong> Depende da pergunta. Para ROAS de mídia paga:
            GA4 (mais conservador). Para atribuir conversão final: sunocode (vê a URL real). Para
            decisões estratégicas: alinhar com a equipe qual modelo seguir e ser consistente.
          </p>
        </div>
      </details>

      {/* Loading / Error */}
      {loading && !data && (
        <div className="bg-white rounded-2xl border p-12 flex flex-col items-center gap-3 text-[color:var(--muted-foreground)]">
          <Loader2 size={32} className="animate-spin text-indigo-600" />
          <span className="text-sm">Auditando UTMs no GA4...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-red-700 text-sm mb-6">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Sessões totais"
              value={data.totalSessions.toLocaleString("pt-BR")}
              sub={data.filterPath ? `LP: ${data.filterPath}` : "site todo"}
              color="#7c5cff"
            />
            <KpiCard
              label="(direct)/(none)"
              value={`${data.directNonePct}%`}
              sub={`${data.directNoneSessions.toLocaleString("pt-BR")} sessões — UTM perdida`}
              color={data.directNonePct > 15 ? "#dc2626" : data.directNonePct > 7 ? "#f59e0b" : "#10b981"}
            />
            <KpiCard
              label="(not set)"
              value={`${data.notSetPct}%`}
              sub={`${data.notSetSessions.toLocaleString("pt-BR")} sessões — UTM malformada`}
              color={data.notSetPct > 5 ? "#f59e0b" : "#10b981"}
            />
            <KpiCard
              label="Canais com variações"
              value={String(data.sourceVariations.length + data.mediumVariations.length)}
              sub="naming inconsistente"
              color={data.sourceVariations.length + data.mediumVariations.length > 0 ? "#f59e0b" : "#10b981"}
            />
          </div>

          {/* Diagnoses */}
          <div className="space-y-2">
            {data.diagnoses.map((d, i) => (
              <DiagnosisRow key={i} diagnosis={d} />
            ))}
          </div>

          {/* Variations detected */}
          {(data.sourceVariations.length > 0 || data.mediumVariations.length > 0) && (
            <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
              <h3 className="text-sm font-semibold mb-1">Variações de naming detectadas</h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mb-4">
                Mesmo canal sendo gravado de jeitos diferentes — GA4 trata como canais separados,
                PowerBI/sunocode normaliza.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {data.sourceVariations.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                      SOURCE com variações
                    </div>
                    {data.sourceVariations.map((v) => (
                      <VariationCard key={v.canonical} variation={v} />
                    ))}
                  </div>
                )}
                {data.mediumVariations.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                      MEDIUM com variações
                    </div>
                    {data.mediumVariations.map((v) => (
                      <VariationCard key={v.canonical} variation={v} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tabela source/medium */}
          <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h3 className="text-sm font-semibold">Top 50 source / medium</h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                Idêntico ao que o GA4 nativo retorna pro mesmo período
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Source
                    </th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Medium
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Sessões
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Usuários
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Conversões
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      % do total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sourceMedium.map((sm, i) => {
                    const pct = data.totalSessions > 0 ? (sm.sessions / data.totalSessions) * 100 : 0;
                    const isProblematic =
                      (sm.source === "(direct)" && sm.medium === "(none)") ||
                      sm.source.includes("(not set)") ||
                      sm.medium.includes("(not set)");
                    return (
                      <tr
                        key={`${sm.source}|${sm.medium}|${i}`}
                        className={`border-b border-slate-100 hover:bg-slate-50/50 ${
                          isProblematic ? "bg-amber-50/30" : ""
                        }`}
                      >
                        <td className="px-4 py-2 font-mono text-xs">{sm.source}</td>
                        <td className="px-4 py-2 font-mono text-xs">{sm.medium}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs font-bold">
                          {sm.sessions.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">
                          {sm.users.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">
                          {sm.conversions.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela campanhas */}
          <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h3 className="text-sm font-semibold">Top campanhas</h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                Cruzamento campaign × source × medium
              </p>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 border-b sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Campanha
                    </th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Source / Medium
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Sessões
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Conversões
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.slice(0, 30).map((c, i) => (
                    <tr key={`${c.campaign}|${i}`} className="border-b border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs max-w-[300px] truncate" title={c.campaign}>
                        {c.campaign === "(not set)" ? (
                          <span className="text-slate-400 italic">(sem UTM)</span>
                        ) : (
                          c.campaign
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-[10px] text-slate-600">
                        {c.source} / {c.medium}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs font-bold">
                        {c.sessions.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs">
                        {c.conversions.toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* URLs raw — vê os UTMs como chegaram */}
          <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                URLs com query string raw
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                  o que CHEGOU antes do GA4 normalizar
                </span>
              </h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                Top 30 URLs com query string completa — você vê qual UTM realmente entrou
              </p>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 border-b sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      URL
                    </th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Sessões
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.pagesRaw.slice(0, 30).map((p, i) => (
                    <UrlRow key={i} url={p.url} sessions={p.sessions} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function KpiCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function DiagnosisRow({ diagnosis }: { diagnosis: Diagnosis }) {
  const cfg =
    diagnosis.severity === "error"
      ? { bg: "bg-red-50", border: "border-red-200", color: "text-red-900", Icon: AlertTriangle }
      : diagnosis.severity === "warning"
        ? { bg: "bg-amber-50", border: "border-amber-200", color: "text-amber-900", Icon: AlertTriangle }
        : { bg: "bg-blue-50", border: "border-blue-200", color: "text-blue-900", Icon: CheckCircle2 };
  const Icon = cfg.Icon;
  return (
    <div className={`${cfg.bg} ${cfg.border} border rounded-xl px-4 py-3 flex items-start gap-2`}>
      <Icon size={14} className={`${cfg.color} mt-0.5 shrink-0`} />
      <span className={`${cfg.color} text-xs leading-snug`}>{diagnosis.message}</span>
    </div>
  );
}

function VariationCard({ variation }: { variation: Variation }) {
  return (
    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/30 mb-2">
      <div className="text-[10px] font-mono text-slate-500 mb-1">
        canonical: <strong className="text-slate-700">{variation.canonical}</strong>
      </div>
      <div className="space-y-1">
        {variation.variants.map((v) => (
          <div key={v.name} className="flex justify-between text-xs">
            <span className="font-mono">{v.name}</span>
            <span className="font-bold tabular-nums">{v.sessions.toLocaleString("pt-BR")}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-amber-700 mt-1.5 font-semibold">
        {variation.variantCount} variações · {variation.totalSessions.toLocaleString("pt-BR")} sessões pulverizadas
      </div>
    </div>
  );
}

function UrlRow({ url, sessions }: { url: string; sessions: number }) {
  const [copied, setCopied] = useState(false);
  const hasUTM = /utm_|sunocode|snc/i.test(url);
  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50/50 ${!hasUTM ? "opacity-60" : ""}`}>
      <td className="px-4 py-2 font-mono text-[10px] max-w-[800px] truncate" title={url}>
        <button
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 hover:text-indigo-600 transition"
        >
          {copied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
          {url || <span className="italic text-slate-400">(vazia)</span>}
        </button>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-xs font-bold">
        {sessions.toLocaleString("pt-BR")}
      </td>
    </tr>
  );
}
