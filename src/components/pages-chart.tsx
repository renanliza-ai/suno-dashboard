"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { getTopPages } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useChat } from "@/lib/chat-context";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock } from "@/components/data-status";

const PAGE_COLORS = ["#7c5cff", "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export function PagesChart() {
  const { attribution } = useChat();
  const { useRealData, days, customRange } = useGA4();
  const { data: overview, meta } = useGA4Overview();
  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `Últimos ${days} dias`;
  const mockPages = getTopPages(attribution);
  const showReal = useRealData && meta.status === "success" && overview?.pages;
  const topPages = showReal
    ? overview!.pages!.slice(0, 6).map((p, i) => ({
        name: p.name,
        value: p.value,
        color: PAGE_COLORS[i % PAGE_COLORS.length],
      }))
    : useRealData
      ? []
      : mockPages;
  const usingMock = !useRealData;
  const showSkeleton = useRealData && (meta.status === "loading" || meta.status === "error");
  const total = topPages.reduce((s, p) => s + p.value, 0) || 1;

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
          Top Páginas
          <DataStatus meta={meta} usingMock={usingMock} compact />
        </h3>
        <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">{periodLabel}</p>
      </div>

      {showSkeleton ? (
        <>
          <SkeletonBlock height={200} />
          <div className="space-y-2 mt-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonBlock key={i} height={14} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={topPages} dataKey="value" innerRadius={60} outerRadius={85} paddingAngle={3}>
                  {topPages.map((p, i) => (
                    <Cell key={i} fill={p.color} stroke="none" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold">{formatNumber(total)}</span>
              <span className="text-xs text-[color:var(--muted-foreground)]">pageviews</span>
            </div>
          </div>

          <div className="space-y-2 mt-4">
            {topPages.map((p) => {
              const pct = ((p.value / total) * 100).toFixed(0);
              return (
                <div key={p.name} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  <span className="flex-1 truncate text-[color:var(--foreground)]">{p.name}</span>
                  <span className="text-[color:var(--muted-foreground)] text-xs font-medium">{pct}%</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
