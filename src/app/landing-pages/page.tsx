"use client";

import { useMemo, useState } from "react";
import { FileText, AlertTriangle, Info, ExternalLink, Search } from "lucide-react";
import { useGA4, useLPPerformance, type LPPerfRow } from "@/lib/ga4-context";
import { DataStatus, PeriodBadge, SkeletonBlock, DataErrorCard } from "@/components/data-status";
import { clarityLinksFor } from "@/lib/clarity";
import { LPChannelComparator } from "@/components/lp-channel-comparator";

/**
 * /landing-pages — desempenho de LP com a regra de conversão da B.U.
 *
 * Substitui a aba "Páginas", que misturava landing page com artigo do portal e
 * com área logada, e por isso ninguém usava.
 *
 * A regra de cada B.U. vem de src/lib/bu.ts, aplicada no servidor. Esta tela
 * não decide o que é lead: ela mostra o que a regra devolveu e DECLARA a
 * procedência do número (coluna "origem do lead"), porque na Consultoria o
 * generate_lead está duplicado e o lead real vem da soma dos MQLs.
 */

type SortKey =
  | "sessions"
  | "engagedSessions"
  | "engagementRate"
  | "leads"
  | "connectRate"
  | "qualified"
  | "qualificationRate"
  | "ctaClicks"
  | "ctaRate"
  | "bounceRate";

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : nf.format(n));
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `${n.toString().replace(".", ",")}%`;

const LEAD_SOURCE_LABEL: Record<string, string> = {
  mql: "soma dos MQLs",
  evento_bruto: "generate_lead",
  evento_dividido: "generate_lead ÷ 2",
  indisponivel: "não medido",
};

export default function LandingPagesPage() {
  const { useRealData, selected, periodLabel, customRange, days } = useGA4();
  const [assetOnly, setAssetOnly] = useState(false);
  const { data, meta, error, loading } = useLPPerformance(assetOnly ? "/asset/" : "");

  // Aceita ?q= vindo do copiloto ("abrir a LP X"). Lido de window em vez de
  // useSearchParams para não exigir Suspense boundary no build.
  const [q, setQ] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [sortKey, setSortKey] = useState<SortKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);

  const isMQL = data?.bu.conversionModel === "mql";
  const hasCta = Boolean(data?.bu.ctaEvent);
  const isResearch = data?.bu.key === "research" || data?.bu.key === "asset";

  const rows = useMemo(() => {
    const base = data?.rows || [];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? base.filter((r) => r.path.toLowerCase().includes(needle)) : base;
    const get = (r: LPPerfRow, k: SortKey): number => {
      const v = r[k];
      return typeof v === "number" ? v : -1;
    };
    return [...filtered].sort((a, b) => {
      const d = get(a, sortKey) - get(b, sortKey);
      return sortDesc ? -d : d;
    });
  }, [data, q, sortKey, sortDesc]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const Th = ({ k, children, align = "right" }: { k: SortKey; children: React.ReactNode; align?: "left" | "right" }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2.5 text-${align} text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] cursor-pointer select-none hover:text-[color:var(--foreground)] whitespace-nowrap`}
      title="Ordenar"
    >
      {children}
      {sortKey === k && <span className="ml-1 text-[#7c5cff]">{sortDesc ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center">
          <FileText size={20} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Landing Pages</h1>
        <DataStatus meta={meta} usingMock={!useRealData} label="GA4" compact />
        <PeriodBadge range={customRange} days={days} compact />
      </div>
      <p className="text-sm text-[color:var(--muted-foreground)] mb-6">
        Desempenho por LP com a regra de conversão da B.U. Só hosts de landing page, sem portal e sem
        área logada. Thank Pages excluídas.
      </p>

      {/* ZERO MOCK: sem GA4, não inventa */}
      {!useRealData && (
        <div className="rounded-2xl border-2 border-dashed border-[color:var(--border)] p-8 text-center">
          <p className="font-semibold mb-1">Sem conexão com o GA4</p>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Selecione uma propriedade no seletor acima. Este painel não exibe dados de exemplo.
          </p>
        </div>
      )}

      {useRealData && error && <DataErrorCard meta={meta} error={error} />}

      {useRealData && loading && (
        <div className="space-y-3">
          <SkeletonBlock height={92} />
          <SkeletonBlock height={340} />
        </div>
      )}

      {/* B.U. sem dado confiável: mostra o motivo, não número */}
      {useRealData && !loading && data?.blocked && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900 mb-1">
                {data.bu.label}: não há dado de landing page confiável
              </p>
              <p className="text-sm text-amber-800 leading-relaxed">{data.blocked}</p>
              <p className="text-xs text-amber-700 mt-3">
                Esta aba prefere estado vazio a número que não sustenta. O texto acima é o que precisa
                ser instrumentado para a B.U. aparecer aqui.
              </p>
            </div>
          </div>
        </div>
      )}

      {useRealData && !loading && data && !data.blocked && (
        <>
          {/* Regra aplicada + ressalvas medidas */}
          <div className="rounded-2xl border border-[color:var(--border)] bg-white p-4 mb-4">
            <div className="flex items-start gap-2.5">
              <Info size={16} className="text-[#7c5cff] shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold mb-1">
                  Regra de {data.bu.label}:{" "}
                  {isMQL ? (
                    <span className="font-normal">
                      lead = <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.mqlEvents?.qualified}</code> +{" "}
                      <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.mqlEvents?.disqualified}</code>, sem checkout
                    </span>
                  ) : (
                    <span className="font-normal">
                      lead = <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.leadEvent}</code>
                      {hasCta && (
                        <>
                          {" "}e clique pro checkout ={" "}
                          <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.ctaEvent}</code>
                        </>
                      )}
                    </span>
                  )}
                </p>
                <p className="text-xs text-[color:var(--muted-foreground)] mb-2">
                  Hosts considerados: {data.lpHosts.join(", ")}
                </p>
                {data.caveats.length > 0 && (
                  <ul className="space-y-1 mt-2">
                    {data.caveats.map((c, i) => (
                      <li key={i} className="text-xs text-[color:var(--muted-foreground)] flex gap-1.5">
                        <span className="text-amber-500">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* KPIs */}
          {data.totals && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
              <Kpi label="Landing pages" value={fmt(data.totals.landingPages)} />
              <Kpi label="Sessões" value={fmt(data.totals.sessions)} />
              <Kpi
                label="Sessões engajadas"
                value={fmt(data.totals.engagedSessions)}
                sub={pct(data.totals.engagementRate)}
              />
              <Kpi
                label="Leads"
                value={fmt(data.totals.leads)}
                sub={LEAD_SOURCE_LABEL[data.rows[0]?.leadsSource || "indisponivel"]}
              />
              {isMQL ? (
                <>
                  <Kpi label="MQL (qualificados)" value={fmt(data.totals.qualified)} accent />
                  <Kpi
                    label="Taxa de qualificação"
                    value={pct(data.totals.qualificationRate)}
                    sub="MQL ÷ leads"
                    accent
                  />
                </>
              ) : (
                <>
                  <Kpi label="Connect rate" value={pct(data.totals.connectRate)} sub="leads ÷ sessões" />
                  {hasCta && (
                    <Kpi
                      label="Cliques pro checkout"
                      value={fmt(data.totals.ctaClicks)}
                      sub={pct(data.totals.ctaRate)}
                      accent
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filtrar por caminho da LP"
                className="pl-8 pr-3 py-2 text-sm rounded-xl border border-[color:var(--border)] bg-white w-[280px] outline-none focus:border-[#7c5cff]"
              />
            </div>
            {isResearch && (
              <button
                onClick={() => setAssetOnly((v) => !v)}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition ${
                  assetOnly
                    ? "bg-[#ede9fe] border-[#7c5cff] text-[#7c5cff]"
                    : "bg-white border-[color:var(--border)] text-[color:var(--muted-foreground)]"
                }`}
                title="O Suno Asset não tem property GA4 própria: vive dentro da Research em /asset/*"
              >
                Só Suno Asset (/asset/)
              </button>
            )}
            <span className="text-xs text-[color:var(--muted-foreground)] ml-auto">
              {rows.length} LP{rows.length === 1 ? "" : "s"} · {periodLabel}
            </span>
          </div>

          {/* Tabela */}
          <div className="rounded-2xl border border-[color:var(--border)] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--muted)] border-b border-[color:var(--border)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Landing page
                    </th>
                    <Th k="sessions">Sessões</Th>
                    <Th k="engagedSessions">Engajadas</Th>
                    <Th k="engagementRate">% engaj.</Th>
                    <Th k="leads">Leads</Th>
                    {isMQL ? (
                      <>
                        <Th k="qualified">MQL</Th>
                        <Th k="qualificationRate">% qualif.</Th>
                      </>
                    ) : (
                      <Th k="connectRate">Connect</Th>
                    )}
                    {hasCta && (
                      <>
                        <Th k="ctaClicks">CTA checkout</Th>
                        <Th k="ctaRate">% CTA</Th>
                      </>
                    )}
                    <Th k="bounceRate">Rejeição</Th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Clarity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
                        Nenhuma landing page com sessão neste período.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => {
                    const cl = clarityLinksFor(selected?.displayName || "", r.path);
                    return (
                      <tr key={r.url} className="border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--muted)]/40">
                        <td className="px-3 py-2.5 max-w-[340px]">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-[#7c5cff] flex items-center gap-1 truncate"
                            title={r.url}
                          >
                            <span className="truncate">{r.path}</span>
                            <ExternalLink size={11} className="shrink-0 opacity-40" />
                          </a>
                          <span className="text-[10px] text-[color:var(--muted-foreground)]">{r.host}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.sessions)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.engagedSessions)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.engagementRate)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(r.leads)}</td>
                        {isMQL ? (
                          <>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#7c5cff]">
                              {fmt(r.qualified)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {r.qualificationRate !== null ? (
                                <span
                                  className={
                                    r.qualificationRate >= 60
                                      ? "text-emerald-600 font-semibold"
                                      : r.qualificationRate < 35
                                        ? "text-red-600 font-semibold"
                                        : ""
                                  }
                                >
                                  {pct(r.qualificationRate)}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.connectRate)}</td>
                        )}
                        {hasCta && (
                          <>
                            <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.ctaClicks)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.ctaRate)}</td>
                          </>
                        )}
                        <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted-foreground)]">
                          {pct(r.bounceRate)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {cl.heatmaps ? (
                            <a
                              href={cl.heatmaps}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#7c5cff] hover:underline"
                              title={cl.filterHint}
                            >
                              mapa
                            </a>
                          ) : (
                            <span className="text-xs text-[color:var(--muted-foreground)]">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {data.meta?.truncated && (
            <p className="text-xs text-amber-700 mt-3">
              A consulta bateu o limite de linhas: existem mais landing pages do que as exibidas. Reduza o
              período ou use o filtro de caminho para ver a cauda.
            </p>
          )}

          {/* Comparador LP x canal — componente que já existia na aba Páginas.
              Semeado com as 3 LPs de maior volume para abrir útil. */}
          {rows.length > 0 && (
            <div className="mt-8">
              <h2 className="font-bold mb-3">Comparar LP por canal de origem</h2>
              <LPChannelComparator initialUrls={rows.slice(0, 3).map((r) => r.url)} />
            </div>
          )}

          <p className="text-[11px] text-[color:var(--muted-foreground)] mt-4 leading-relaxed">
            Nota metodológica: a sessão é atribuída à página de ENTRADA
            (<code>landingPagePlusQueryString</code>), não a qualquer página vista. Por isso o total desta
            aba não fecha com o total de sessões da propriedade, e é assim que deve ser: o denominador de
            conversão de LP é quem entrou por ela.
          </p>
        </>
      )}
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border p-4 ${
        accent ? "border-[#7c5cff]/40 ring-1 ring-[#7c5cff]/10" : "border-[color:var(--border)]"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-[#7c5cff]" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}
