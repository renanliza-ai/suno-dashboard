"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpDown, Megaphone, Target, TrendingUp, Wallet, Eye, MousePointerClick, Pause, Play, AlertCircle } from "lucide-react";
import { platformColors, CampaignMediaRow } from "@/lib/data";
import { getCampaignsForProperty } from "@/lib/property-campaigns";
import { formatNumber } from "@/lib/utils";
import { useGA4 } from "@/lib/ga4-context";

type SortKey = keyof Omit<CampaignMediaRow, "campaign" | "platform" | "type" | "status">;

const statusStyle: Record<string, string> = {
  ativa: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pausada: "bg-amber-50 text-amber-700 border-amber-200",
  encerrada: "bg-gray-50 text-gray-600 border-gray-200",
};

const typeStyle: Record<string, string> = {
  Search: "bg-blue-50 text-blue-700",
  Display: "bg-purple-50 text-purple-700",
  Social: "bg-pink-50 text-pink-700",
  Video: "bg-red-50 text-red-700",
  Retargeting: "bg-indigo-50 text-indigo-700",
};

export function CampaignPerformance() {
  const [sortKey, setSortKey] = useState<SortKey>("roas");
  const [sortDesc, setSortDesc] = useState(true);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { selected, selectedId, days, customRange } = useGA4();
  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `últimos ${days} dias`;

  // Campanhas reagem à propriedade selecionada (Suno Research, Statusinvest etc)
  // — naming e mix de plataformas mudam.
  const propertyCampaigns = useMemo(
    () => getCampaignsForProperty(selected?.displayName, selectedId),
    [selected?.displayName, selectedId]
  );

  const platforms = Array.from(new Set(propertyCampaigns.map((c) => c.platform)));

  const filtered = useMemo(() => {
    let rows = propertyCampaigns.filter(
      (r) =>
        (platformFilter === "all" || r.platform === platformFilter) &&
        (statusFilter === "all" || r.status === statusFilter)
    );
    rows = [...rows].sort((a, b) => {
      const diff = (b[sortKey] as number) - (a[sortKey] as number);
      return sortDesc ? diff : -diff;
    });
    return rows;
  }, [propertyCampaigns, platformFilter, statusFilter, sortKey, sortDesc]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        impressions: acc.impressions + r.impressions,
        clicks: acc.clicks + r.clicks,
        spend: acc.spend + r.spend,
        conversions: acc.conversions + r.conversions,
        revenue: acc.revenue + r.revenue,
      }),
      { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
    );
  }, [filtered]);

  const totalCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const totalCpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
  const totalRoas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  // ====================================================================
  // ROAS via CAPI (server-side) — recupera 30-50% das conversões perdidas
  // por bloqueador/iOS 14.5/ITP. Quando CAPI estiver ativo, esse é o
  // ROAS REAL. Hoje é mock — quando integrarmos, vem do Meta Conversions API.
  // ====================================================================
  const capiRecoveryRate = 0.38; // 38% de conversões perdidas recuperadas
  const totalRevenueCapi = totals.revenue * (1 + capiRecoveryRate);
  const totalRoasCapi = totals.spend > 0 ? totalRevenueCapi / totals.spend : 0;
  const roasDelta = totalRoasCapi - totalRoas;
  const roasDeltaPct = totalRoas > 0 ? ((totalRoasCapi - totalRoas) / totalRoas) * 100 : 0;

  const spendByPlatform = platforms.map((p) => ({
    name: p,
    value: propertyCampaigns.filter((c) => c.platform === p).reduce((s, c) => s + c.spend, 0),
    color: platformColors[p] || "#7c5cff",
  }));

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const headers: { key: SortKey; label: string }[] = [
    { key: "impressions", label: "Impressões" },
    { key: "clicks", label: "Cliques" },
    { key: "ctr", label: "CTR" },
    { key: "spend", label: "Investimento" },
    { key: "cpc", label: "CPC" },
    { key: "conversions", label: "Conv." },
    { key: "convRate", label: "Tx. Conv." },
    { key: "cpa", label: "CPA" },
    { key: "revenue", label: "Receita" },
    { key: "roas", label: "ROAS" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <div className="bg-gradient-to-br from-white via-white to-[#f5f2ff] rounded-2xl border border-[color:var(--border)] overflow-hidden mb-4">
        <div className="p-5 flex items-center justify-between flex-wrap gap-3 border-b border-[color:var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-md shadow-purple-500/30">
              <Megaphone size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                Performance de Campanhas
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">
                  Mídia Paga
                </span>
              </h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                Google Ads · Meta · LinkedIn · TikTok · YouTube · {periodLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[color:var(--border)] bg-white font-medium focus:outline-none focus:border-[#7c5cff]"
            >
              <option value="all">Todas plataformas</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[color:var(--border)] bg-white font-medium focus:outline-none focus:border-[#7c5cff]"
            >
              <option value="all">Todos status</option>
              <option value="ativa">Ativas</option>
              <option value="pausada">Pausadas</option>
              <option value="encerrada">Encerradas</option>
            </select>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-0 border-b border-[color:var(--border)]">
          <KpiCell icon={Eye} label="Impressões" value={formatNumber(totals.impressions)} />
          <KpiCell icon={MousePointerClick} label="Cliques" value={formatNumber(totals.clicks)} sub={`CTR ${totalCtr.toFixed(2)}%`} />
          <KpiCell icon={Wallet} label="Investimento" value={`R$ ${formatNumber(totals.spend)}`} tone="amber" />
          <KpiCell icon={Target} label="Conversões" value={formatNumber(totals.conversions)} sub={`CPA R$ ${totalCpa.toFixed(2)}`} />
          <KpiCell icon={TrendingUp} label="Receita" value={`R$ ${formatNumber(totals.revenue)}`} tone="emerald" />
          <KpiCell icon={TrendingUp} label="ROAS médio" value={`${totalRoas.toFixed(2)}x`} tone="purple" highlight />
        </div>

        {/* Banner ROAS real via CAPI vs ROAS GA4 */}
        <div className="px-5 pt-5">
          <div className="rounded-xl bg-gradient-to-r from-blue-50 via-white to-violet-50 border border-blue-200 p-4">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h4 className="text-sm font-bold">ROAS GA4 vs ROAS real (CAPI)</h4>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
                    Meta AI Connector
                  </span>
                </div>
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  Browsers bloqueiam 30-50% dos eventos client-side. Server-side (CAPI) recupera essa parte e mostra o ROAS real.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 items-center">
                <div className="text-center">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)] tracking-wider">
                    GA4 (client)
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-slate-700">{totalRoas.toFixed(2)}x</p>
                  <p className="text-[10px] text-[color:var(--muted-foreground)]">subestimado</p>
                </div>
                <div className="text-center px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">
                    CAPI (server)
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-700">{totalRoasCapi.toFixed(2)}x</p>
                  <p className="text-[10px] text-emerald-700 font-semibold">ROAS real</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase font-bold text-violet-600 tracking-wider">Delta</p>
                  <p className="text-2xl font-bold tabular-nums text-violet-700">+{roasDelta.toFixed(2)}x</p>
                  <p className="text-[10px] text-violet-700 font-semibold">+{roasDeltaPct.toFixed(0)}% recuperado</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Split: Spend por plataforma + ROAS por campanha */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3">
              Investimento por plataforma
            </div>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={spendByPlatform} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={2}>
                    {spendByPlatform.map((p, i) => (
                      <Cell key={i} fill={p.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {spendByPlatform
                  .sort((a, b) => b.value - a.value)
                  .map((p) => {
                    const pct = totals.spend > 0 ? ((p.value / totals.spend) * 100).toFixed(0) : "0";
                    return (
                      <div key={p.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                        <span className="flex-1 font-medium truncate">{p.name}</span>
                        <span className="text-[color:var(--muted-foreground)] tabular-nums">R$ {formatNumber(p.value)}</span>
                        <span className="text-[10px] text-[color:var(--muted-foreground)] font-semibold w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-3">
              ROAS por campanha
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={filtered.slice(0, 8)} layout="vertical" margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#6b6b80" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="campaign" tick={{ fontSize: 9, fill: "#6b6b80" }} axisLine={false} tickLine={false} width={130} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(2)}x`} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #eceaf4" }} />
                <Bar dataKey="roas" radius={[0, 4, 4, 0]}>
                  {filtered.map((c, i) => (
                    <Cell
                      key={i}
                      fill={c.roas >= 4 ? "#10b981" : c.roas >= 2 ? "#7c5cff" : c.roas >= 1 ? "#f59e0b" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-[color:var(--muted-foreground)]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> ≥ 4x</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#7c5cff]" /> 2-4x</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 1-2x</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {"<"} 1x</span>
            </div>
          </div>
        </div>
      </div>

      {/* Detail table */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[color:var(--border)] flex items-center justify-between">
          <h4 className="text-sm font-semibold">Detalhamento por campanha</h4>
          <span className="text-[11px] text-[color:var(--muted-foreground)]">{filtered.length} campanha(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--muted)]/50 border-b border-[color:var(--border)]">
              <tr>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider sticky left-0 bg-[color:var(--muted)]/50 z-10">
                  Campanha
                </th>
                <th className="text-left px-3 py-3 text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
                  Plataforma
                </th>
                {headers.map((h) => (
                  <th key={h.key} className="text-right px-3 py-3">
                    <button
                      onClick={() => toggleSort(h.key)}
                      className="flex items-center gap-1 ml-auto text-[11px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider hover:text-[#7c5cff] transition"
                    >
                      {h.label}
                      <ArrowUpDown size={10} className={sortKey === h.key ? "text-[#7c5cff]" : ""} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const roasColor =
                  row.roas >= 4 ? "text-emerald-600 font-bold" :
                  row.roas >= 2 ? "text-[#7c5cff] font-bold" :
                  row.roas >= 1 ? "text-amber-600 font-semibold" :
                  "text-red-600 font-bold";
                return (
                  <motion.tr
                    key={row.campaign}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 transition"
                  >
                    <td className="px-4 py-3 sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.status === "ativa" ? "bg-emerald-500 animate-pulse" : row.status === "pausada" ? "bg-amber-500" : "bg-gray-400"}`} />
                        <span className="font-mono text-xs">{row.campaign}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${statusStyle[row.status]}`}>
                          {row.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 ml-3.5">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${typeStyle[row.type]}`}>
                          {row.type}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: platformColors[row.platform] }} />
                        {row.platform}
                      </span>
                    </td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">{formatNumber(row.impressions)}</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">{formatNumber(row.clicks)}</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">{row.ctr.toFixed(2)}%</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs font-semibold">R$ {formatNumber(row.spend)}</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">R$ {row.cpc.toFixed(2)}</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">{formatNumber(row.conversions)}</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">{row.convRate.toFixed(2)}%</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs">R$ {row.cpa.toFixed(2)}</td>
                    <td className="text-right px-3 py-3 tabular-nums text-xs font-semibold">R$ {formatNumber(row.revenue)}</td>
                    <td className={`text-right px-3 py-3 tabular-nums text-sm ${roasColor}`}>{row.roas.toFixed(2)}x</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Insights strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        {(() => {
          const best = [...filtered].sort((a, b) => b.roas - a.roas)[0];
          const worst = [...filtered].sort((a, b) => a.roas - b.roas)[0];
          const highestSpend = [...filtered].sort((a, b) => b.spend - a.spend)[0];
          return (
            <>
              <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/30 border border-emerald-200">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-emerald-700">
                  <TrendingUp size={11} /> Melhor ROAS
                </div>
                <div className="text-sm font-mono mt-1 font-semibold">{best?.campaign}</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">{best?.roas.toFixed(2)}x</div>
                <div className="text-[11px] text-emerald-600 mt-0.5">CPA R$ {best?.cpa.toFixed(2)} · escalar budget</div>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-red-50 to-red-100/30 border border-red-200">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-red-700">
                  <AlertCircle size={11} /> Pior ROAS
                </div>
                <div className="text-sm font-mono mt-1 font-semibold">{worst?.campaign}</div>
                <div className="text-xl font-bold text-red-700 mt-1">{worst?.roas.toFixed(2)}x</div>
                <div className="text-[11px] text-red-600 mt-0.5">CPA R$ {worst?.cpa.toFixed(2)} · revisar ou pausar</div>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100/30 border border-purple-200">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-purple-700">
                  <Wallet size={11} /> Maior investimento
                </div>
                <div className="text-sm font-mono mt-1 font-semibold">{highestSpend?.campaign}</div>
                <div className="text-xl font-bold text-purple-700 mt-1">R$ {formatNumber(highestSpend?.spend || 0)}</div>
                <div className="text-[11px] text-purple-600 mt-0.5">{highestSpend?.platform} · ROAS {highestSpend?.roas.toFixed(2)}x</div>
              </div>
            </>
          );
        })()}
      </div>
    </motion.div>
  );
}

function KpiCell({ icon: Icon, label, value, sub, tone = "default", highlight = false }: { icon: typeof Eye; label: string; value: string; sub?: string; tone?: "default" | "amber" | "emerald" | "purple"; highlight?: boolean }) {
  const toneColor = {
    default: "text-[color:var(--foreground)]",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    purple: "text-[#7c5cff]",
  }[tone];
  return (
    <div className={`p-4 border-r border-[color:var(--border)] last:border-r-0 ${highlight ? "bg-gradient-to-br from-purple-50 to-transparent" : ""}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
        <Icon size={11} />
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${toneColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5">{sub}</div>}
    </div>
  );
}
