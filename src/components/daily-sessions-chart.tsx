"use client";

import { motion } from "framer-motion";
import { TrendingUp, Loader2 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Gráfico de linhas diário — sessões + usuários por dia.
 * Respeita o range do calendário do header (days/customRange) automaticamente
 * via useGA4Overview, que já consome o GA4Context.
 */
export function DailySessionsChart() {
  const { useRealData, days, customRange } = useGA4();
  const { data, meta } = useGA4Overview();

  const isLoading = useRealData && meta.status === "loading";
  const trend = data?.trend || [];

  // GA4 Data API retorna `date` como YYYYMMDD (sem hífens). Tratamos os dois
  // formatos pra resiliência (ex.: se algum dia trocarmos pra runReport com
  // dateHourMinute, o formato muda).
  const chartData = trend.map((t) => {
    const raw = t.date || "";
    let label = raw;
    if (/^\d{8}$/.test(raw)) {
      label = `${raw.slice(6, 8)}/${raw.slice(4, 6)}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [, mm, dd] = raw.split("-");
      label = `${dd}/${mm}`;
    }
    return {
      label,
      sessoes: t.sessoes,
      usuarios: t.usuarios,
      dateRaw: raw,
    };
  });

  const totalSessions = trend.reduce((s, t) => s + t.sessoes, 0);
  const totalUsers = trend.reduce((s, t) => s + t.usuarios, 0);

  const periodLabel = customRange
    ? `${customRange.startDate} → ${customRange.endDate}`
    : `Últimos ${days} dias`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp size={16} className="text-[#7c5cff]" />
            Sessões por dia
          </h3>
          <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
            {periodLabel} · respeita o calendário do header
          </p>
        </div>
        {!isLoading && trend.length > 0 && (
          <div className="flex gap-4 text-right">
            <div>
              <div className="text-[10px] uppercase text-[color:var(--muted-foreground)] tracking-wider">
                Sessões
              </div>
              <div className="text-lg font-bold tabular-nums text-[#7c5cff]">
                {formatNumber(totalSessions)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[color:var(--muted-foreground)] tracking-wider">
                Usuários
              </div>
              <div className="text-lg font-bold tabular-nums text-[#10b981]">
                {formatNumber(totalUsers)}
              </div>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="h-[280px] flex items-center justify-center text-[color:var(--muted-foreground)] text-sm gap-2">
          <Loader2 size={16} className="animate-spin" />
          Carregando série diária do GA4...
        </div>
      ) : !useRealData ? (
        <div className="h-[280px] flex items-center justify-center text-[color:var(--muted-foreground)] text-sm">
          Selecione uma propriedade GA4 no header pra ver a série diária.
        </div>
      ) : trend.length === 0 ? (
        <div className="h-[280px] flex items-center justify-center text-[color:var(--muted-foreground)] text-sm">
          Sem dados de tráfego no período selecionado.
        </div>
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="dscSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label"
                fontSize={11}
                stroke="#94a3b8"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                fontSize={11}
                stroke="#94a3b8"
                tickLine={false}
                axisLine={false}
                tickFormatter={formatNumber}
              />
              <Tooltip
                contentStyle={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value, name) => [
                  formatNumber(Number(value)),
                  name === "sessoes" ? "Sessões" : "Usuários",
                ]}
                labelFormatter={(l) => `Dia: ${l}`}
              />
              <Area
                type="monotone"
                dataKey="sessoes"
                stroke="#7c5cff"
                strokeWidth={2.5}
                fill="url(#dscSessions)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="usuarios"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
