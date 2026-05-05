"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { topEvents } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock } from "@/components/data-status";

export function EventsChart() {
  const { useRealData, days, customRange } = useGA4();
  const { data: overview, meta } = useGA4Overview();
  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `${days} dias`;
  const showReal = useRealData && meta.status === "success" && overview?.events;
  const data = showReal
    ? overview!.events!.slice(0, 8).map((e) => ({ name: e.name, value: e.value }))
    : useRealData
      ? []
      : topEvents;
  const usingMock = !useRealData;
  const showSkeleton = useRealData && (meta.status === "loading" || meta.status === "error");

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6 relative">
      <div className="mb-4">
        <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
          Top Eventos
          <DataStatus meta={meta} usingMock={usingMock} compact />
        </h3>
        <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">Contagem por evento · {periodLabel}</p>
      </div>

      {showSkeleton ? (
        <SkeletonBlock height={260} />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
            <defs>
              <linearGradient id="gradBar" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7c5cff" />
                <stop offset="100%" stopColor="#b297ff" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "#6b6b80" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatNumber(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "#6b6b80" }}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip
              cursor={{ fill: "rgba(124,92,255,0.06)" }}
              contentStyle={{
                background: "white",
                border: "1px solid #eceaf4",
                borderRadius: 12,
                boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
                fontSize: 12,
              }}
              formatter={(v) => formatNumber(Number(v))}
            />
            <Bar dataKey="value" fill="url(#gradBar)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
