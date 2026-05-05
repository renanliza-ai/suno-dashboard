"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import {
  FileText,
  ArrowUpDown,
  ExternalLink,
  Eye,
  Users,
  Clock,
  LogOut,
  TrendingUp,
  X,
  LogIn,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { allPages } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Overview, useGA4PagesDetail } from "@/lib/ga4-context";
import { LandingPagesSection } from "@/components/landing-pages-section";
import { MasterOnly } from "@/components/master-only";
import { LPChannelComparator } from "@/components/lp-channel-comparator";
import {
  DataStatus,
  PeriodBadge,
  SkeletonBlock,
  DataErrorCard,
} from "@/components/data-status";

type SortKey = "views" | "users" | "avgTime" | "bounceRate" | "exitRate" | "entry";
type PageRow = {
  path: string;
  host: string;
  views: number;
  users: number;
  avgTime: number;
  bounceRate: number;
  exitRate: number;
  entry: number;
};

export default function PaginasPage() {
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PageRow | null>(null);

  const { useRealData } = useGA4();
  const { data: overview, meta, error: ga4Error } = useGA4Overview();
  // Dataset rico: host + path + views + users + avgTime + bounceRate + entries
  const { data: pagesDetail, meta: detailMeta } = useGA4PagesDetail();

  const usingMock = !useRealData;
  const isLoading = useRealData && (meta.status === "loading" || detailMeta.status === "loading");
  const hasError = useRealData && meta.status === "error";
  const showReal =
    useRealData &&
    (detailMeta.status === "success" || detailMeta.status === "partial") &&
    pagesDetail?.pages &&
    pagesDetail.pages.length > 0;

  // Fonte unificada — real GA4 (detalhado) ou fallback (overview simples) ou mock
  const pageRows: PageRow[] = useMemo(() => {
    if (showReal) {
      return pagesDetail!.pages.map((p) => ({
        host: p.host,
        path: p.path || "(sem path)",
        views: p.views,
        users: p.users,
        avgTime: p.avgSessionDuration,
        bounceRate: p.bounceRate,
        exitRate: p.exitRate,
        entry: p.entries,
      }));
    }
    // fallback: overview antigo (só views + users)
    if (
      useRealData &&
      (meta.status === "success" || meta.status === "partial") &&
      overview?.pages &&
      overview.pages.length > 0
    ) {
      return overview.pages.map((p) => ({
        host: "",
        path: p.name || "(sem path)",
        views: p.value,
        users: p.users,
        avgTime: 0,
        bounceRate: 0,
        exitRate: 0,
        entry: 0,
      }));
    }
    return (allPages as Omit<PageRow, "host">[]).map((p) => ({ ...p, host: "" }));
  }, [showReal, pagesDetail, useRealData, meta.status, overview]);

  const rows = [...pageRows]
    .filter((p) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      // Busca em path, host e URL completa (host + path) — user reclamou que busca
      // não trazia resultado porque só olhava o path.
      return (
        p.path.toLowerCase().includes(q) ||
        (p.host && p.host.toLowerCase().includes(q)) ||
        (p.host && `${p.host}${p.path}`.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      const diff = (b[sortKey] as number) - (a[sortKey] as number);
      return sortDesc ? diff : -diff;
    });

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  // KPIs agregados — agora sempre calculados (real via pages-detail OU mock)
  const totalViews = pageRows.reduce((s, p) => s + p.views, 0);
  const totalUsers = pageRows.reduce((s, p) => s + p.users, 0);
  // Média ponderada por views para tempo e rejeição (mais representativa que média simples)
  const totalWeight = pageRows.reduce((s, p) => s + p.views, 0);
  const avgTime =
    totalWeight > 0
      ? Math.round(
          pageRows.reduce((s, p) => s + p.avgTime * p.views, 0) / totalWeight
        )
      : 0;
  const avgBounce =
    totalWeight > 0
      ? Number(
          (
            pageRows.reduce((s, p) => s + p.bounceRate * p.views, 0) / totalWeight
          ).toFixed(1)
        )
      : 0;

  const headers: { key: SortKey; label: string; fmt: (v: number) => string; realAvailable: boolean }[] = [
    { key: "views", label: "Visualizações", fmt: formatNumber, realAvailable: true },
    { key: "users", label: "Usuários Únicos", fmt: formatNumber, realAvailable: true },
    {
      key: "avgTime",
      label: "Tempo Médio",
      fmt: (v) => (v === 0 ? "—" : `${Math.floor(v / 60)}m ${v % 60}s`),
      realAvailable: true, // agora vem do pages-detail (averageSessionDuration)
    },
    { key: "bounceRate", label: "Rejeição", fmt: (v) => (v === 0 ? "—" : `${v.toFixed(1)}%`), realAvailable: true },
    { key: "exitRate", label: "Saída", fmt: (v) => (v === 0 ? "—" : `${v.toFixed(1)}%`), realAvailable: true },
    { key: "entry", label: "Entradas", fmt: (v) => (v === 0 ? "—" : formatNumber(v)), realAvailable: true },
  ];

  // Top 8 para o chart
  const chartData = [...pageRows]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8)
    .map((p) => ({
      name: p.path.length > 22 ? `…${p.path.slice(-20)}` : p.path,
      fullPath: p.path,
      views: p.views,
      users: p.users,
    }));

  const COLORS = ["#7c5cff", "#8b6dff", "#9a7eff", "#a98fff", "#b8a0ff", "#c7b1ff", "#d6c2ff", "#e5d3ff"];

  return (
    <main className="ml-20 p-8 max-w-[1600px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30">
            <FileText size={20} className="text-white" />
          </span>
          Páginas
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Performance detalhada de cada página · entrada, saída, engajamento
        </p>
      </motion.div>

      {/* Data trust banner */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <DataStatus meta={meta} usingMock={usingMock} />
        {showReal && overview?.range && <PeriodBadge range={overview.range} days={overview.days} />}
        {showReal && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700"
            title="Views, usuários, tempo médio, rejeição e entradas são puxados diretamente do GA4 Data API (hostName + pagePath)."
          >
            ✓ métricas completas GA4 · host + path
          </span>
        )}
      </div>

      {hasError && (
        <div className="mb-4">
          <DataErrorCard meta={meta} error={ga4Error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* Landing Pages (ex: GreatPages) — sempre no topo quando há GA4 conectado */}
      {useRealData && <LandingPagesSection />}

      {/* Comparativo LP × Canal — ferramenta dedicada pra analisar várias LPs lado a lado */}
      <LPChannelComparator />

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {isLoading || hasError ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <SkeletonBlock height={12} className="w-24 mb-3" />
              <SkeletonBlock height={32} className="w-32 mb-2" />
              <SkeletonBlock height={10} className="w-20" />
            </div>
          ))
        ) : (
          <>
            <KpiCard
              label="Pageviews"
              value={formatNumber(totalViews)}
              icon={Eye}
              color="#7c5cff"
              sub={`${pageRows.length} páginas`}
            />
            <KpiCard
              label="Usuários Únicos"
              value={formatNumber(totalUsers)}
              icon={Users}
              color="#10b981"
              sub="somados (pode ter sobreposição)"
            />
            <KpiCard
              label="Tempo Médio"
              value={avgTime === 0 ? "—" : `${Math.floor(avgTime / 60)}m ${avgTime % 60}s`}
              icon={Clock}
              color="#3b82f6"
              sub="ponderado por views"
              disabled={avgTime === 0}
            />
            <KpiCard
              label="Rejeição Média"
              value={avgBounce === 0 ? "—" : `${avgBounce}%`}
              icon={LogOut}
              color="#f59e0b"
              sub="ponderado por views"
              disabled={avgBounce === 0}
            />
          </>
        )}
      </div>

      {/* Top pages chart */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp size={16} className="text-[#7c5cff]" />
                Top páginas por visualização
              </h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                As 8 páginas mais acessadas no período
              </p>
            </div>
          </div>
          {isLoading ? (
            <SkeletonBlock height={280} />
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tickFormatter={formatNumber} fontSize={11} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} stroke="#475569" />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => formatNumber(Number(value))}
                  />
                  <Bar dataKey="views" radius={[0, 6, 6, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Insights panel — MASTER ONLY (insights/recomendações ficam só no perfil Renan) */}
        <MasterOnly>
          <div className="bg-gradient-to-br from-[#ede9fe] to-white rounded-2xl border border-[#ddd6fe] p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <LogIn size={16} className="text-[#7c5cff]" />
              Insights
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 uppercase tracking-wider">
                Master
              </span>
            </h3>
            <div className="space-y-3 text-xs">
              <InsightBlock
                title="Página mais acessada"
                value={chartData[0]?.fullPath || "—"}
                detail={chartData[0] ? `${formatNumber(chartData[0].views)} views` : ""}
              />
              <InsightBlock
                title="Página de maior engajamento"
                value={[...pageRows].sort((a, b) => b.avgTime - a.avgTime)[0]?.path || "—"}
                detail={(() => {
                  const t = [...pageRows].sort((a, b) => b.avgTime - a.avgTime)[0]?.avgTime || 0;
                  return t === 0 ? "—" : `${Math.floor(t / 60)}m ${t % 60}s`;
                })()}
              />
              <InsightBlock
                title="Top entrada"
                value={[...pageRows].sort((a, b) => b.entry - a.entry)[0]?.path || "—"}
                detail={`${formatNumber([...pageRows].sort((a, b) => b.entry - a.entry)[0]?.entry || 0)} entradas`}
              />
            </div>
          </div>
        </MasterOnly>
      </div>

      {/* Search + Host filter */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar por host, path ou URL (ex: greatpages, /carteira)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[260px] px-3 py-2 text-sm rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff]"
        />
        {showReal && pagesDetail && pagesDetail.hosts.length > 1 && (
          <select
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs bg-white border border-[color:var(--border)] rounded-lg px-2 py-2 outline-none focus:border-[#7c5cff] cursor-pointer"
            title="Filtrar por host (subdomínio/domínio)"
          >
            <option value="">Todos os hosts ({pagesDetail.hosts.length})</option>
            {pagesDetail.hosts.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        )}
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-[11px] text-[color:var(--muted-foreground)] hover:text-red-500"
          >
            limpar
          </button>
        )}
        <span className="text-[10px] text-[color:var(--muted-foreground)] font-mono">
          {rows.length} de {pageRows.length} páginas
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--muted)]/50 border-b border-[color:var(--border)]">
            <tr>
              {showReal && (
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                  Host
                </th>
              )}
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                Página
              </th>
              {headers.map((h) => (
                <th key={h.key} className="text-right px-4 py-3">
                  <button
                    onClick={() => toggle(h.key)}
                    className="flex items-center gap-1 ml-auto text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider hover:text-[#7c5cff]"
                    title={
                      showReal && !h.realAvailable
                        ? "Métrica não disponível nesta rota do GA4 Data API"
                        : ""
                    }
                  >
                    {h.label}
                    {showReal && !h.realAvailable && (
                      <span className="text-amber-500 text-[9px]">◇</span>
                    )}
                    <ArrowUpDown size={10} className={sortKey === h.key ? "text-[#7c5cff]" : ""} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-[color:var(--border)]">
                  <td colSpan={showReal ? 8 : 7} className="px-4 py-3">
                    <SkeletonBlock height={20} />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showReal ? 8 : 7}
                  className="px-4 py-8 text-center text-xs text-[color:var(--muted-foreground)]"
                >
                  Nenhuma página corresponde ao filtro.
                  {search && (
                    <div className="mt-1 text-[11px]">
                      Busca: <span className="font-mono">&quot;{search}&quot;</span> — tente outro termo ou limpar filtro.
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((p, i) => (
                <motion.tr
                  key={`${p.host}|${p.path}|${i}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.02 }}
                  onClick={() => setSelected(p)}
                  className="border-b border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 cursor-pointer"
                >
                  {showReal && (
                    <td className="px-4 py-3">
                      <span
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#ede9fe] text-[#5b3dd4]"
                        title={p.host}
                      >
                        {p.host.length > 24 ? `${p.host.slice(0, 22)}…` : p.host}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{p.path}</span>
                      <ExternalLink size={10} className="text-[color:var(--muted-foreground)]" />
                    </div>
                  </td>
                  {headers.map((h) => (
                    <td key={h.key} className="text-right px-4 py-3 tabular-nums text-xs">
                      {h.fmt(p[h.key] as number)}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <PageDetailModal
            page={selected}
            onClose={() => setSelected(null)}
            showReal={Boolean(showReal)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
  disabled,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
  sub?: string;
  disabled?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-2xl border border-[color:var(--border)] p-5 ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
          {label}
        </div>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <Icon size={14} className="" style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: disabled ? "#94a3b8" : undefined }}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-[color:var(--muted-foreground)] mt-1">{sub}</div>
      )}
    </motion.div>
  );
}

function InsightBlock({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="p-3 rounded-xl bg-white/70 border border-white">
      <div className="text-[10px] uppercase tracking-wider text-[#7c5cff] font-bold mb-0.5">
        {title}
      </div>
      <div className="font-mono text-[11px] truncate">{value}</div>
      <div className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5">{detail}</div>
    </div>
  );
}

function PageDetailModal({
  page,
  onClose,
  showReal,
}: {
  page: PageRow;
  onClose: () => void;
  showReal: boolean;
}) {
  const stats = [
    { label: "Visualizações", value: formatNumber(page.views), icon: Eye, color: "#7c5cff" },
    { label: "Usuários Únicos", value: formatNumber(page.users), icon: Users, color: "#10b981" },
    {
      label: "Tempo Médio",
      value: page.avgTime ? `${Math.floor(page.avgTime / 60)}m ${page.avgTime % 60}s` : "—",
      icon: Clock,
      color: "#3b82f6",
    },
    {
      label: "Rejeição",
      value: page.bounceRate ? `${page.bounceRate}%` : "—",
      icon: LogOut,
      color: "#f59e0b",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
      >
        <div className="p-6 bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] text-white rounded-t-2xl relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} />
          </button>
          <div className="text-xs uppercase tracking-wider opacity-80 mb-1">Detalhes da página</div>
          <div className="font-mono text-lg font-bold break-all pr-10">{page.path}</div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="p-4 rounded-xl border border-[color:var(--border)]">
                <div className="flex items-center gap-2 mb-1">
                  <s.icon size={14} style={{ color: s.color }} />
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                    {s.label}
                  </span>
                </div>
                <div className="text-xl font-bold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Recomendações — MASTER ONLY */}
          <MasterOnly>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
                Recomendações
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">Master</span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-700">
                {page.bounceRate > 50 && !showReal && (
                  <li>• Rejeição alta ({page.bounceRate}%) — revisar primeiro dobra e CTA.</li>
                )}
                {page.avgTime < 60 && page.avgTime > 0 && (
                  <li>• Tempo baixo ({page.avgTime}s) — conteúdo pode não estar retendo.</li>
                )}
                {page.entry > 0 && page.users > 0 && page.entry / page.users > 0.5 && (
                  <li>• É landing importante — priorizar em testes A/B.</li>
                )}
                <li>• Ver jornada completa desta URL em Conversões → funil.</li>
                <li>• Verificar tracking em Tracking para confirmar eventos críticos.</li>
              </ul>
            </div>
          </MasterOnly>

          {showReal && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              ⓘ Tempo médio, rejeição, saída e entradas não estão na rota de overview do GA4 Data API. Para análise completa, abra o GA4 UI em <strong>Reports → Pages and screens</strong>.
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
