"use client";

import { Header } from "@/components/header";
import { Dialog } from "@/components/dialog";
import { motion } from "framer-motion";
import {
  Search,
  TrendingUp,
  MousePointerClick,
  Eye,
  BarChart3,
  Sparkles,
  Lightbulb,
  ArrowUpRight,
  ExternalLink,
  Target,
  AlertCircle,
  CheckCircle2,
  Globe,
  ChevronRight,
} from "lucide-react";
import { useState, useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import {
  useGSC,
  useGSCOverview,
  useGSCQueries,
  useGSCPages,
  type GSCQuery,
} from "@/lib/gsc-context";
import { MasterOnly, useIsMaster } from "@/components/master-only";

const PERIOD_OPTIONS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "3 meses" },
  { value: 180, label: "6 meses" },
];

export default function SEOPage() {
  const isMaster = useIsMaster();
  const { sites, selectedSite, selectedSiteUrl, setSelectedSiteUrl, loading: sitesLoading, error: sitesError } = useGSC();
  const [days, setDays] = useState(90);
  const { data: overview, loading: overviewLoading, error: overviewError } = useGSCOverview(days);
  const { queries, loading: queriesLoading } = useGSCQueries(days, 100);
  const { pages, loading: pagesLoading } = useGSCPages(days, 50);

  const [filterOpportunity, setFilterOpportunity] = useState<"all" | "low_ctr" | "part_2_candidate">("all");
  const [selectedQuery, setSelectedQuery] = useState<GSCQuery | null>(null);

  const filteredQueries = useMemo(() => {
    if (filterOpportunity === "all") return queries;
    return queries.filter((q) => q.opportunity === filterOpportunity);
  }, [queries, filterOpportunity]);

  const part2Candidates = useMemo(() => {
    return queries.filter((q) => q.opportunity === "part_2_candidate").slice(0, 5);
  }, [queries]);

  const lowCTRTerms = useMemo(() => {
    return queries.filter((q) => q.opportunity === "low_ctr").length;
  }, [queries]);

  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === days)?.label || `${days} dias`;

  // Cria insight no CRO via localStorage (consumido pela página /cro futuramente)
  function createPart2Insight(q: GSCQuery) {
    if (typeof window === "undefined") return;
    const KEY = "suno:cro:seo-insights:v1";
    const insight = {
      id: `seo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      source: "seo",
      query: q.query,
      topPage: q.topPage,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: q.ctr,
      position: q.position,
      createdAt: Date.now(),
      acted: false,
    };
    try {
      const existing = window.localStorage.getItem(KEY);
      const arr = existing ? JSON.parse(existing) : [];
      arr.push(insight);
      window.localStorage.setItem(KEY, JSON.stringify(arr));
      // Toast simples
      alert(`✅ Insight criado no CRO:\n\n"Criar conteúdo Parte 2 a partir de '${q.query}'"\n\nAbra a aba CRO para ver e atribuir ao backlog.`);
    } catch {
      alert("Erro ao salvar insight. Tenta de novo.");
    }
  }

  return (
    <main className="ml-20 p-8 max-w-[1600px]">
      <Header />

      {/* Pills de contexto */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="px-3 py-1 rounded-full bg-gradient-to-r from-blue-100 to-indigo-100 border border-blue-200 text-blue-800 text-xs font-semibold flex items-center gap-1.5">
          <Search size={12} />
          SEO · Google Search Console
        </div>
        <div className="px-3 py-1 rounded-full bg-[#ede9fe] text-[#7c5cff] text-xs font-semibold flex items-center gap-1.5">
          <Globe size={12} />
          Aquisição orgânica
        </div>
      </div>

      {/* Seletor de site GSC + período */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-6 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-[color:var(--muted-foreground)]" />
          <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">
            Propriedade GSC:
          </span>
        </div>
        {sitesLoading ? (
          <span className="text-sm text-[color:var(--muted-foreground)]">Carregando...</span>
        ) : sitesError ? (
          <div className="flex-1 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            <span>
              {sitesError.includes("auth") || sitesError.includes("scope")
                ? "Você precisa relogar com Google e aceitar o escopo do Search Console."
                : sitesError}
            </span>
          </div>
        ) : sites.length === 0 ? (
          <div className="flex-1 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            <span>
              Nenhuma propriedade GSC encontrada. Adicione seu e-mail como usuário em
              <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="underline ml-1">
                search.google.com/search-console
              </a>
              .
            </span>
          </div>
        ) : (
          <select
            value={selectedSiteUrl || ""}
            onChange={(e) => setSelectedSiteUrl(e.target.value)}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-[color:var(--border)] bg-white focus:outline-none focus:border-[#7c5cff]"
          >
            {sites.map((s) => (
              <option key={s.siteUrl} value={s.siteUrl}>
                {s.siteUrl}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-1.5 bg-[color:var(--muted)] p-1 rounded-lg">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => setDays(p.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                days === p.value
                  ? "bg-white text-[#7c5cff] shadow-sm"
                  : "text-[color:var(--muted-foreground)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs — clicks/impressions/ctr/position */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          {
            label: "Cliques orgânicos",
            value: overview?.kpis ? formatNumber(overview.kpis.clicks) : "—",
            icon: MousePointerClick,
            color: "#7c5cff",
            bg: "bg-violet-50",
          },
          {
            label: "Impressões",
            value: overview?.kpis ? formatNumber(overview.kpis.impressions) : "—",
            icon: Eye,
            color: "#3b82f6",
            bg: "bg-blue-50",
          },
          {
            label: "CTR médio",
            value: overview?.kpis ? `${overview.kpis.ctr.toFixed(2)}%` : "—",
            icon: TrendingUp,
            color: "#10b981",
            bg: "bg-emerald-50",
          },
          {
            label: "Posição média",
            value: overview?.kpis ? overview.kpis.position.toFixed(1) : "—",
            icon: BarChart3,
            color: "#f59e0b",
            bg: "bg-amber-50",
          },
        ].map((m, i) => {
          const Icon = m.icon;
          return (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl border border-[color:var(--border)] p-5 flex items-center gap-4"
            >
              <div className={`w-12 h-12 rounded-xl ${m.bg} flex items-center justify-center`}>
                <Icon size={22} style={{ color: m.color }} />
              </div>
              <div>
                <p className="text-sm text-[color:var(--muted-foreground)] font-medium">{m.label}</p>
                <p className="text-2xl font-bold tracking-tight">
                  {overviewLoading ? <span className="text-base text-[color:var(--muted-foreground)]">carregando…</span> : m.value}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {overviewError && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} />
          <span>Erro ao buscar overview: {overviewError}</span>
        </div>
      )}

      {/* Card destaque: Oportunidades de Conteúdo Parte 2 — MASTER ONLY */}
      <MasterOnly>
        {part2Candidates.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white p-6 mb-6 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white blur-3xl opacity-10" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                  <Lightbulb size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    {part2Candidates.length} oportunidades de conteúdo Parte 2 detectadas
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-300 text-amber-900 uppercase tracking-wider">
                      Master
                    </span>
                  </h3>
                  <p className="text-sm text-white/80">
                    Termos com posição 4-15 e bom volume — bons candidatos a artigos derivados.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                {part2Candidates.map((q) => (
                  <div
                    key={q.query}
                    className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/15 hover:bg-white/15 transition"
                  >
                    <p className="text-sm font-semibold leading-tight mb-2 line-clamp-2">{q.query}</p>
                    <div className="flex items-center gap-3 text-[11px] text-white/80 mb-3">
                      <span>{formatNumber(q.clicks)} cliques</span>
                      <span>·</span>
                      <span>posição {q.position}</span>
                      <span>·</span>
                      <span>{q.ctr.toFixed(1)}% CTR</span>
                    </div>
                    <button
                      onClick={() => createPart2Insight(q)}
                      className="w-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-2 rounded-lg transition flex items-center justify-center gap-1.5"
                    >
                      <Sparkles size={12} /> Criar Parte 2 no CRO
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </MasterOnly>

      {/* Tabela: Top termos de busca */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden mb-6">
        <div className="p-5 border-b border-[color:var(--border)] flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              Top termos de busca orgânica
              <span className="text-xs text-[color:var(--muted-foreground)] font-normal">· {periodLabel}</span>
            </h3>
            <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
              Clique em um termo para ver detalhes e criar Parte 2 no CRO.
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-[color:var(--muted)] p-1 rounded-lg">
            {[
              { id: "all", label: `Todos (${queries.length})` },
              { id: "part_2_candidate", label: `Parte 2 (${part2Candidates.length})` },
              { id: "low_ctr", label: `CTR baixo (${lowCTRTerms})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterOpportunity(f.id as typeof filterOpportunity)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  filterOpportunity === f.id ? "bg-white text-[#7c5cff] shadow-sm" : "text-[color:var(--muted-foreground)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[color:var(--muted-foreground)] bg-[color:var(--muted)]">
                <th className="text-left px-5 py-3 font-medium">Termo</th>
                <th className="text-right px-3 py-3 font-medium">Cliques</th>
                <th className="text-right px-3 py-3 font-medium">Impressões</th>
                <th className="text-right px-3 py-3 font-medium">CTR</th>
                <th className="text-right px-3 py-3 font-medium">Posição</th>
                <th className="text-left px-3 py-3 font-medium">Página de destino</th>
                <th className="text-center px-3 py-3 font-medium">Sinal</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {queriesLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-sm text-[color:var(--muted-foreground)]">
                    Carregando termos do Search Console…
                  </td>
                </tr>
              )}
              {!queriesLoading && filteredQueries.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-sm text-[color:var(--muted-foreground)]">
                    Nenhum termo nesse filtro. Tente "Todos" ou um período maior.
                  </td>
                </tr>
              )}
              {filteredQueries.slice(0, 50).map((q, i) => (
                <tr
                  key={q.query}
                  onClick={() => setSelectedQuery(q)}
                  className="border-t border-[color:var(--border)] hover:bg-[#ede9fe]/40 transition cursor-pointer"
                >
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium truncate max-w-[280px]" title={q.query}>
                      {q.query}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatNumber(q.clicks)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatNumber(q.impressions)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{q.ctr.toFixed(2)}%</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${
                        q.position <= 3
                          ? "bg-emerald-100 text-emerald-700"
                          : q.position <= 10
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {q.position.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs font-mono truncate max-w-[200px]">
                    {q.topPage ? (
                      <a
                        href={q.topPage}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[#7c5cff] hover:underline inline-flex items-center gap-1"
                        title={q.topPage}
                      >
                        {(() => {
                          try { return new URL(q.topPage).pathname; } catch { return q.topPage; }
                        })()}
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span className="text-[color:var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {q.opportunity === "part_2_candidate" && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200">
                        Parte 2
                      </span>
                    )}
                    {q.opportunity === "low_ctr" && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200">
                        CTR baixo
                      </span>
                    )}
                    {!q.opportunity && (
                      <CheckCircle2 size={12} className="text-emerald-500 inline" />
                    )}
                  </td>
                  <td className="pr-4">
                    <ChevronRight size={14} className="text-[color:var(--muted-foreground)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top páginas orgânicas */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden mb-6">
        <div className="p-5 border-b border-[color:var(--border)]">
          <h3 className="text-base font-semibold">Páginas com melhor performance orgânica</h3>
          <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
            URLs com mais cliques vindo do Google · {periodLabel}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[color:var(--muted-foreground)] bg-[color:var(--muted)]">
                <th className="text-left px-5 py-3 font-medium">#</th>
                <th className="text-left px-3 py-3 font-medium">Página</th>
                <th className="text-right px-3 py-3 font-medium">Cliques</th>
                <th className="text-right px-3 py-3 font-medium">Impressões</th>
                <th className="text-right px-3 py-3 font-medium">CTR</th>
                <th className="text-right px-3 py-3 font-medium">Posição</th>
              </tr>
            </thead>
            <tbody>
              {pagesLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-sm text-[color:var(--muted-foreground)]">
                    Carregando páginas…
                  </td>
                </tr>
              )}
              {!pagesLoading && pages.slice(0, 20).map((p, i) => (
                <tr key={p.url} className="border-t border-[color:var(--border)] hover:bg-[color:var(--muted)]/40 transition">
                  <td className="px-5 py-3 text-xs text-[color:var(--muted-foreground)]">{i + 1}</td>
                  <td className="px-3 py-3 text-xs font-mono truncate max-w-[400px]">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#7c5cff] hover:underline inline-flex items-center gap-1"
                      title={p.url}
                    >
                      {p.path}
                      <ExternalLink size={10} />
                    </a>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatNumber(p.clicks)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatNumber(p.impressions)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{p.ctr.toFixed(2)}%</td>
                  <td className="px-3 py-3 text-right tabular-nums">{p.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Diálogo de detalhes do termo */}
      <Dialog
        open={!!selectedQuery}
        onClose={() => setSelectedQuery(null)}
        title={selectedQuery?.query}
        subtitle={`${selectedQuery?.clicks || 0} cliques · ${selectedQuery?.impressions || 0} impressões`}
        maxWidth="max-w-2xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center">
            <Search size={18} />
          </div>
        }
      >
        {selectedQuery && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Cliques</p>
                <p className="text-xl font-bold mt-1">{formatNumber(selectedQuery.clicks)}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Impressões</p>
                <p className="text-xl font-bold mt-1">{formatNumber(selectedQuery.impressions)}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">CTR</p>
                <p className="text-xl font-bold mt-1">{selectedQuery.ctr.toFixed(2)}%</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Posição</p>
                <p className="text-xl font-bold mt-1">{selectedQuery.position.toFixed(1)}</p>
              </div>
            </div>

            {selectedQuery.topPage && (
              <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-3">
                <p className="text-xs font-bold uppercase text-blue-700 mb-1.5">Página principal</p>
                <a
                  href={selectedQuery.topPage}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-mono text-blue-900 hover:underline break-all flex items-start gap-1.5"
                >
                  {selectedQuery.topPage}
                  <ExternalLink size={12} className="mt-0.5 shrink-0" />
                </a>
              </div>
            )}

            {selectedQuery.opportunity === "part_2_candidate" && (
              <div className="rounded-xl bg-violet-50 border border-violet-200 p-4">
                <h4 className="text-sm font-bold text-violet-900 mb-1.5 flex items-center gap-2">
                  <Sparkles size={14} /> Oportunidade detectada: Parte 2
                </h4>
                <p className="text-xs text-violet-800 leading-relaxed">
                  Esse termo está em posição {selectedQuery.position.toFixed(1)} com {formatNumber(selectedQuery.clicks)} cliques.
                  Bom candidato a um <strong>artigo derivado/Parte 2</strong> que captura tráfego do mesmo cluster semântico.
                </p>
              </div>
            )}

            {selectedQuery.opportunity === "low_ctr" && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                <h4 className="text-sm font-bold text-amber-900 mb-1.5 flex items-center gap-2">
                  <Target size={14} /> Oportunidade: CTR baixo no top 10
                </h4>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Posição {selectedQuery.position.toFixed(1)} é boa, mas o CTR de {selectedQuery.ctr.toFixed(2)}% está abaixo
                  do esperado. Reescrever <strong>title + meta description</strong> tende a aumentar o CTR em 30-60% sem mexer no conteúdo.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-[color:var(--border)]">
              {isMaster && (
                <button
                  onClick={() => {
                    createPart2Insight(selectedQuery);
                    setSelectedQuery(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#7c5cff] hover:bg-[#6b4bf0] text-white text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Sparkles size={14} /> Criar Parte 2 no CRO
                </button>
              )}
              {selectedQuery.topPage && (
                <a
                  href={selectedQuery.topPage}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm font-medium hover:bg-[color:var(--muted)] flex items-center gap-2"
                >
                  <ArrowUpRight size={14} /> Abrir página
                </a>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </main>
  );
}
