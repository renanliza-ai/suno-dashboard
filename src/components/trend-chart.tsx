"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getTrendData } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useChat } from "@/lib/chat-context";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock, PeriodBadge } from "@/components/data-status";

export function TrendChart() {
  const { attribution } = useChat();
  const { useRealData } = useGA4();
  const { data: overview, meta } = useGA4Overview();
  const showReal = useRealData && meta.status === "success" && overview?.trend;
  const trendData = showReal
    ? overview!.trend!.map((d) => {
        const raw = d.date;
        const label = raw.length === 8 ? `${raw.slice(6, 8)}/${raw.slice(4, 6)}` : raw;
        return { date: label, sessoes: d.sessoes, usuarios: d.usuarios };
      })
    : useRealData
      ? []
      : getTrendData(attribution);
  const usingMock = !useRealData;
  const showSkeleton = useRealData && (meta.status === "loading" || meta.status === "error");

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 col-span-2">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            Tendência de Tráfego
            <DataStatus meta={meta} usingMock={usingMock} compact />
            {showReal && overview?.range && (
              <PeriodBadge range={overview.range} days={overview.days} compact />
            )}
          </h3>
          <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">Sessões e usuários ativos</p>
        </div>
      </div>

      {showSkeleton ? (
        <SkeletonBlock height={280} />
      ) : (
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradSessoes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#7c5cff" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#7c5cff" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradUsuarios" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b6b80" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b6b80" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatNumber(v)}
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid #eceaf4",
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
              fontSize: 12,
            }}
            formatter={(v) => formatNumber(Number(v))}
          />
          <Area type="monotone" dataKey="sessoes" stroke="#7c5cff" strokeWidth={2.5} fill="url(#gradSessoes)" name="Sessões" />
          <Area type="monotone" dataKey="usuarios" stroke="#10b981" strokeWidth={2.5} fill="url(#gradUsuarios)" name="Usuários" />
        </AreaChart>
      </ResponsiveContainer>
      )}

      <div className="flex gap-6 mt-4 pt-4 border-t border-[color:var(--border)]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#7c5cff]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">Sessões</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">Usuários</span>
        </div>
      </div>
    </div>
  );
}
