"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Rocket, Search, ExternalLink, Filter, TrendingUp, AlertCircle, Globe } from "lucide-react";
import { useGA4LandingPages } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";
import { SkeletonBlock } from "@/components/data-status";

type SortKey = "sessions" | "users" | "engagedSessions" | "engagementRate";

/**
 * Seção de Landing Pages — mostra LPs com URL completa (hostName + path).
 * Crucial para visualizar LPs criadas em plataformas externas como GreatPages,
 * Unbounce, Wix etc, que rodam sob subdomínios diferentes do site principal.
 *
 * Filtros:
 *  - hostContains: busca por substring no hostName (ex: "greatpages")
 *  - source/medium: filtro global por origem/mídia (usa breakdown do backend)
 *  - search: busca livre no path ou URL
 */
export function LandingPagesSection() {
  const [hostFilter, setHostFilter] = useState("");
  const [hostAppliedFilter, setHostAppliedFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const { data, loading, error, meta } = useGA4LandingPages(hostAppliedFilter);

  const applyHostFilter = () => setHostAppliedFilter(hostFilter.trim());

  // Se houver filtro por source, agrega o breakdown por URL para substituir as
  // métricas da tabela (sessions/users só dessa origem).
  const rows = useMemo(() => {
    if (!data) return [];
    if (sourceFilter === "all") {
      return data.pages.filter(
        (p) =>
          !search ||
          p.path.toLowerCase().includes(search.toLowerCase()) ||
          p.host.toLowerCase().includes(search.toLowerCase())
      );
    }
    const [src, med] = sourceFilter.split("|");
    const byUrl = new Map<string, { sessions: number; users: number; host: string; path: string }>();
    for (const r of data.sourceBreakdown) {
      if (r.source !== src || r.medium !== med) continue;
      const existing = byUrl.get(r.url);
      if (existing) {
        existing.sessions += r.sessions;
        existing.users += r.users;
      } else {
        byUrl.set(r.url, { sessions: r.sessions, users: r.users, host: r.host, path: r.path });
      }
    }
    const filtered = Array.from(byUrl.entries()).map(([url, v]) => {
      const base = data.pages.find((p) => p.url === url);
      return {
        url,
        host: v.host,
        path: v.path,
        users: v.users,
        sessions: v.sessions,
        // engagedSessions/engagementRate não são granulares por source na API atual;
        // estimamos proporcionalmente com base na taxa de engajamento geral da LP.
        engagedSessions: base ? Math.round(v.sessions * base.engagementRate) : 0,
        engagementRate: base?.engagementRate ?? 0,
        avgSessionDuration: base?.avgSessionDuration ?? 0,
        bounceRate: base?.bounceRate ?? 0,
      };
    });
    return filtered.filter(
      (p) =>
        !search ||
        p.path.toLowerCase().includes(search.toLowerCase()) ||
        p.host.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, sourceFilter, search]);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const diff = (b[sortKey] as number) - (a[sortKey] as number);
        return sortDesc ? diff : -diff;
      }),
    [rows, sortKey, sortDesc]
  );

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const totalSessions = rows.reduce((s, p) => s + p.sessions, 0);
  const totalUsers = rows.reduce((s, p) => s + p.users, 0);
  const totalEngaged = rows.reduce((s, p) => s + p.engagedSessions, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-gradient-to-br from-[#faf5ff] via-white to-[#eff6ff] rounded-2xl border border-[#ddd6fe] overflow-hidden"
    >
      {/* Header */}
      <div className="p-5 border-b border-[color:var(--border)]/60 bg-white/60 backdrop-blur-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-md shadow-purple-500/30">
                <Rocket size={15} className="text-white" />
              </span>
              Landing Pages
              {data && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ede9fe] text-[#5b3dd4] font-bold">
                  {data.pages.length} URLs
                </span>
              )}
            </h2>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-1">
              Todas as LPs no ar por propriedade — inclui subdomínios externos (GreatPages, Unbounce etc).
              Filtre por <strong>hostName</strong> para ver só as LPs de uma plataforma.
            </p>
          </div>
          {meta.status === "success" && (
            <div className="flex items-center gap-2 text-[10px] font-mono text-[color:var(--muted-foreground)]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              hostName + landingPage + sessionSource/Medium
            </div>
          )}
        </div>

        {/* Host filter */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-white rounded-lg border border-[color:var(--border)] px-3 py-1.5 flex-1 min-w-[240px]">
            <Globe size={13} className="text-[#7c5cff]" />
            <input
              type="text"
              placeholder="Ex: greatpages, unbounce, lp. —  deixe vazio para ver todas"
              value={hostFilter}
              onChange={(e) => setHostFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyHostFilter()}
              className="flex-1 text-xs bg-transparent outline-none"
            />
            {hostAppliedFilter && (
              <button
                onClick={() => {
                  setHostFilter("");
                  setHostAppliedFilter("");
                }}
                className="text-[10px] text-[color:var(--muted-foreground)] hover:text-red-500"
              >
                limpar
              </button>
            )}
          </div>
          <button
            onClick={applyHostFilter}
            className="px-3 py-1.5 rounded-lg bg-[#7c5cff] text-white text-xs font-semibold hover:bg-[#9b7fff] transition flex items-center gap-1.5"
          >
            <Filter size={11} />
            Aplicar host
          </button>
          {hostAppliedFilter && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-[#ede9fe] text-[#5b3dd4] font-mono">
              host contém: &quot;{hostAppliedFilter}&quot;
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 p-5 bg-white/40">
        <StatCard label="LPs no ar" value={loading ? "—" : String(rows.length)} />
        <StatCard label="Sessões" value={loading ? "—" : formatNumber(totalSessions)} />
        <StatCard label="Usuários" value={loading ? "—" : formatNumber(totalUsers)} />
        <StatCard
          label="Sessões Engajadas"
          value={loading ? "—" : formatNumber(totalEngaged)}
          sub={totalSessions > 0 ? `${Math.round((totalEngaged / totalSessions) * 100)}%` : "—"}
        />
      </div>

      {/* Filtros secundários */}
      <div className="px-5 py-3 border-t border-[color:var(--border)]/60 flex flex-wrap items-center gap-3 bg-white/60">
        <div className="flex items-center gap-1.5 bg-white rounded-lg border border-[color:var(--border)] px-2.5 py-1.5 flex-1 min-w-[200px]">
          <Search size={12} className="text-[color:var(--muted-foreground)]" />
          <input
            placeholder="Filtrar por URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-xs bg-transparent outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter size={12} className="text-[#7c5cff]" />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-xs bg-white border border-[color:var(--border)] rounded-lg px-2 py-1.5 outline-none focus:border-[#7c5cff] cursor-pointer"
          >
            <option value="all">Todas as origens/mídias</option>
            {data?.topSources.map((s) => (
              <option key={`${s.source}|${s.medium}`} value={`${s.source}|${s.medium}`}>
                {s.source} / {s.medium} · {formatNumber(s.sessions)} sessões
              </option>
            ))}
          </select>
        </div>
        {sourceFilter !== "all" && (
          <button
            onClick={() => setSourceFilter("all")}
            className="text-[10px] text-[color:var(--muted-foreground)] hover:text-red-500"
          >
            limpar filtro de origem
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="p-0">
        {error && !loading && (
          <div className="p-5 text-xs text-red-700 bg-red-50 border-t border-red-200 flex items-center gap-2">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        {loading ? (
          <div className="p-5 space-y-2">
            {[...Array(5)].map((_, i) => (
              <SkeletonBlock key={i} height={28} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-xs text-[color:var(--muted-foreground)]">
            Nenhuma landing page encontrada para o filtro atual.
            {hostAppliedFilter && (
              <div className="mt-2 text-[11px]">
                Tente limpar o filtro de host ou ajustar a substring.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[color:var(--muted)]/60 border-t border-[color:var(--border)]/60">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                    Host
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                    URL completa
                  </th>
                  <SortTh label="Sessões" active={sortKey === "sessions"} desc={sortDesc} onClick={() => toggle("sessions")} />
                  <SortTh label="Usuários" active={sortKey === "users"} desc={sortDesc} onClick={() => toggle("users")} />
                  <SortTh
                    label="Sessões Engaj."
                    active={sortKey === "engagedSessions"}
                    desc={sortDesc}
                    onClick={() => toggle("engagedSessions")}
                  />
                  <SortTh
                    label="Taxa Engaj."
                    active={sortKey === "engagementRate"}
                    desc={sortDesc}
                    onClick={() => toggle("engagementRate")}
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 50).map((p, i) => {
                  const healthy = p.engagementRate >= 0.5;
                  return (
                    <motion.tr
                      key={`${p.url}-${i}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 10) * 0.02 }}
                      className="border-t border-[color:var(--border)]/50 hover:bg-[color:var(--muted)]/30"
                    >
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => {
                            setHostFilter(p.host);
                            setHostAppliedFilter(p.host);
                          }}
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#ede9fe] text-[#5b3dd4] hover:bg-[#ddd6fe] transition"
                          title={`Filtrar tabela por ${p.host}`}
                        >
                          {p.host.length > 22 ? `${p.host.slice(0, 20)}…` : p.host}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded bg-[#ede9fe] text-[#5b3dd4] text-[9px] font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <a
                            href={`https://${p.url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[11px] truncate hover:text-[#7c5cff] hover:underline"
                            title={`https://${p.url}`}
                          >
                            {p.url}
                          </a>
                          <ExternalLink size={10} className="text-[color:var(--muted-foreground)] shrink-0" />
                        </div>
                      </td>
                      <td className="text-right px-4 py-2.5 tabular-nums font-semibold">
                        {formatNumber(p.sessions)}
                      </td>
                      <td className="text-right px-4 py-2.5 tabular-nums">{formatNumber(p.users)}</td>
                      <td className="text-right px-4 py-2.5 tabular-nums">
                        {formatNumber(p.engagedSessions)}
                      </td>
                      <td className="text-right px-4 py-2.5 tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            healthy
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}
                        >
                          {healthy && <TrendingUp size={9} />}
                          {Math.round(p.engagementRate * 100)}%
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {sorted.length > 50 && (
          <div className="px-4 py-2 text-[10px] text-[color:var(--muted-foreground)] text-center border-t">
            Mostrando 50 de {sorted.length} · refine o filtro para ver mais específico
          </div>
        )}
      </div>
    </motion.section>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white border border-[color:var(--border)] px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-bold">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[9px] text-[color:var(--muted-foreground)]">{sub}</div>}
    </div>
  );
}

function SortTh({
  label,
  active,
  desc,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  return (
    <th className="text-right px-4 py-2.5">
      <button
        onClick={onClick}
        className={`text-[10px] font-bold uppercase tracking-wider ml-auto flex items-center gap-1 ${
          active ? "text-[#7c5cff]" : "text-[color:var(--muted-foreground)] hover:text-[#7c5cff]"
        }`}
      >
        {label}
        {active && <span className="text-[8px]">{desc ? "▼" : "▲"}</span>}
      </button>
    </th>
  );
}
