"use client";

import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users, MapPin, Heart, Monitor, UserCheck, Clock, Activity, Sparkles, Target } from "lucide-react";
import { useState, useMemo } from "react";
import { IcpModal } from "@/components/icp-modal";
import { PeriodPicker } from "@/components/period-picker";
import { audienceInterests, audienceCohorts } from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Overview, useGA4Audience } from "@/lib/ga4-context";
import { DataStatus } from "@/components/data-status";
import { MasterOnly } from "@/components/master-only";
import { Loader2 } from "lucide-react";

// ZERO MOCK (30/06): hashSeed/factor que escalavam dados de exemplo por
// propriedade foram REMOVIDOS. Sem dado real, as secoes ficam vazias.
export default function AudienciaPage() {
  const [icpOpen, setIcpOpen] = useState(false);

  // GA4 — propriedade do header
  const { selected, useRealData } = useGA4();
  const { data: overview, meta } = useGA4Overview();
  const { data: audienceReal, loading: audienceLoading } = useGA4Audience();
  const propertyName = selected?.displayName || "Sem GA4 conectado";

  // Cores fixas pra gênero (mantém visual estável)
  const genderColors: Record<string, string> = {
    Masculino: "#7c5cff",
    Feminino: "#ec4899",
    "Não informado": "#94a3b8",
    Male: "#7c5cff",
    Female: "#ec4899",
  };
  const realAge =
    audienceReal?.byAge && audienceReal.byAge.length > 0
      ? audienceReal.byAge.map((a) => ({ range: a.name, users: a.users, pct: a.pct }))
      : null;
  const realGender =
    audienceReal?.byGender && audienceReal.byGender.length > 0
      ? audienceReal.byGender.map((g) => ({
          name: g.name,
          value: g.pct,
          color: genderColors[g.name] || "#7c5cff",
        }))
      : null;
  const realState = audienceReal?.byState && audienceReal.byState.length > 0
    ? audienceReal.byState.map((s) => ({ state: s.name, users: s.users, pct: s.pct }))
    : null;
  const realBrowser = audienceReal?.byBrowser && audienceReal.byBrowser.length > 0
    ? audienceReal.byBrowser.map((b) => ({ name: b.name, pct: b.pct }))
    : null;
  const realOS = audienceReal?.byOS && audienceReal.byOS.length > 0
    ? audienceReal.byOS.map((o) => ({ name: o.name, pct: o.pct }))
    : null;

  // ZERO MOCK: so dado real do GA4; sem dado, listas vazias.
  const ageData = realAge || [];
  const genderData = realGender || [];
  const stateData = realState || [];
  const browserData = realBrowser || [];
  const osData = realOS || [];
  const isRealAudience = useRealData && !!audienceReal;

  const realTotal = useRealData && meta.status === "success" ? overview?.kpis?.activeUsers || 0 : 0;
  const referenceTotal = realTotal;

  // ZERO MOCK: DAU/WAU eram DERIVADOS por coeficiente inventado (8%/35% do MAU)
  // mesmo no modo real - removidos. So exibimos o que o GA4 entrega de fato:
  // usuarios ativos do periodo (MAU quando o range e 30d).
  const stats = useMemo(() => ({ mau: realTotal }), [realTotal]);

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Users size={20} className="text-white" />
            </span>
            Audiência
          </h1>
          <p className="text-[color:var(--muted-foreground)] mt-1">
            Demografia, geografia, interesses, tecnologia e coortes de retenção
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodPicker />
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setIcpOpen(true)}
            className="group relative overflow-hidden inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#5b3dd4] text-white font-semibold shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all"
          >
            <span className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition" />
            <Target size={16} className="relative z-10" />
            <span className="relative z-10 text-sm">Ver ICP Suno</span>
            <Sparkles
              size={12}
              className="relative z-10 opacity-80 group-hover:rotate-12 transition-transform"
            />
          </motion.button>
        </div>
      </motion.div>

      <IcpModal open={icpOpen} onClose={() => setIcpOpen(false)} />

      {/* Banner: propriedade analisada */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="text-sm">
          Análise de: <strong className="text-[#7c5cff]">{propertyName}</strong>
          {realTotal > 0 && (
            <span className="ml-2 text-[11px] text-emerald-600 font-semibold">
              · DAU/WAU/MAU calculados de dados reais GA4
            </span>
          )}
          {isRealAudience && (
            <span className="ml-2 text-[11px] text-emerald-600 font-semibold">
              · Demografia / geografia / tech reagem ao filtro de período
            </span>
          )}
          {audienceLoading && (
            <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Loader2 size={11} className="animate-spin" />
              Atualizando audiência...
            </span>
          )}
        </div>
        {useRealData && <DataStatus meta={meta} />}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          // ZERO MOCK: DAU/WAU/Stickiness exigem series diarias dedicadas - sem
          // fonte real plugada, mostram indisponivel (nada de coeficiente).
          { label: "DAU", value: "—", sub: "requer série diária (em breve)", icon: Activity },
          { label: "WAU", value: "—", sub: "requer série diária (em breve)", icon: Users },
          { label: "Usuários ativos", value: stats.mau > 0 ? formatNumber(stats.mau) : "—", sub: "no período selecionado", icon: Users },
          { label: "Stickiness", value: "—", sub: "DAU / MAU (em breve)", icon: Sparkles },
        ].map((k, i) => {
          const Icon = k.icon;
          return (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl border border-[color:var(--border)] p-5"
            >
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                <Icon size={11} /> {k.label}
              </div>
              <div className="text-3xl font-bold mt-2">{k.value}</div>
              <div className="text-[11px] text-[color:var(--muted-foreground)] mt-1">{k.sub}</div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <UserCheck size={14} className="text-[#7c5cff]" />
            Faixa Etária
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ageData} layout="vertical" margin={{ left: 0, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eceaf4" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#6b6b80" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
              <YAxis type="category" dataKey="range" tick={{ fontSize: 11, fill: "#6b6b80" }} axisLine={false} tickLine={false} width={50} />
              <Tooltip formatter={(v) => formatNumber(Number(v))} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Bar dataKey="users" fill="#7c5cff" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="text-[11px] text-[color:var(--muted-foreground)] mt-2">
            {isRealAudience && realAge ? (
              <>
                <strong className="text-[color:var(--foreground)]">Dominante:</strong>{" "}
                {realAge[0]?.range || "—"}
                {realAge[0]?.pct ? ` (${realAge[0].pct}%)` : ""}
              </>
            ) : (
              <>
                <strong className="text-[color:var(--foreground)]">Dominante:</strong> 25-44 anos
                (63.5%)
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Users size={14} className="text-[#7c5cff]" />
            Gênero
          </h3>
          <div className="relative">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={genderData} dataKey="value" innerRadius={50} outerRadius={75} paddingAngle={3}>
                  {genderData.map((g, i) => (
                    <Cell key={i} fill={g.color} stroke="none" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-bold">{formatNumber(referenceTotal)}</span>
              <span className="text-[10px] text-[color:var(--muted-foreground)]">usuários</span>
            </div>
          </div>
          <div className="space-y-1.5 mt-3">
            {genderData.map((g) => (
              <div key={g.name} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                <span className="flex-1">{g.name}</span>
                <span className="font-bold">{g.value}%</span>
              </div>
            ))}
            {isRealAudience && audienceReal?.meta && !audienceReal.meta.hasGender && (
              <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mt-1">
                ⚠ Gênero não disponível — ative Google Signals na propriedade GA4
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Heart size={14} className="text-[#7c5cff]" />
            Afinidade de Interesses
            <span className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" title="Dados de estudo estático do ICP Suno - não reagem ao período/property selecionados">
              Estudo estático · não é GA4
            </span>
          </h3>
          <div className="space-y-2">
            {audienceInterests.slice(0, 6).map((t, i) => (
              <motion.div
                key={t.category}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <div className="flex items-center justify-between mb-0.5 text-[11px]">
                  <span className="font-medium truncate">{t.category}</span>
                  <span className="font-bold tabular-nums">{t.affinity}</span>
                </div>
                <div className="h-1.5 bg-[color:var(--muted)] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${t.affinity}%` }}
                    transition={{ duration: 0.6 }}
                    className="h-full rounded-full bg-gradient-to-r from-pink-400 to-[#7c5cff]"
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <MapPin size={14} className="text-[#7c5cff]" />
            Distribuição por Estado
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {stateData.map((s, i) => (
              <motion.div
                key={s.state}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <div className="flex items-center justify-between mb-0.5 text-xs">
                  <span className="font-semibold font-mono">{s.state}</span>
                  <span className="text-[color:var(--muted-foreground)] tabular-nums">
                    {formatNumber(s.users)} ({s.pct}%)
                  </span>
                </div>
                <div className="h-1.5 bg-[color:var(--muted)] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      // Normaliza largura pelo maior estado da lista (não pelo total)
                      // pra que SP=40% não jogue todas outras pra microscopia
                      width: `${Math.min(100, (s.pct / (stateData[0]?.pct || 1)) * 100)}%`,
                    }}
                    transition={{ duration: 0.6, delay: i * 0.03 }}
                    className="h-full bg-gradient-to-r from-[#7c5cff] to-[#b297ff] rounded-full"
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
            <Monitor size={14} className="text-[#7c5cff]" />
            Tecnologia
          </h3>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-2">Browser</div>
            <div className="space-y-1.5">
              {browserData.map((b) => (
                <div key={b.name} className="flex items-center gap-2 text-[11px]">
                  <span className="w-16 font-medium">{b.name}</span>
                  <div className="flex-1 h-1.5 bg-[color:var(--muted)] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${b.pct}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full bg-[#7c5cff] rounded-full"
                    />
                  </div>
                  <span className="font-bold w-8 text-right">{b.pct}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-[color:var(--border)]">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold mb-2">Sistema</div>
            <div className="space-y-1.5">
              {osData.map((o) => (
                <div key={o.name} className="flex items-center gap-2 text-[11px]">
                  <span className="w-16 font-medium">{o.name}</span>
                  <div className="flex-1 h-1.5 bg-[color:var(--muted)] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${o.pct}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full bg-emerald-500 rounded-full"
                    />
                  </div>
                  <span className="font-bold w-8 text-right">{o.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-6">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Clock size={14} className="text-[#7c5cff]" />
          Retenção por Coorte
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" title="Dados de estudo estático - não reagem ao período/property selecionados">
            Estudo estático · não é GA4
          </span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[color:var(--border)]">
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">Coorte</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">Tamanho</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">S1</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">S2</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">S3</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">S4</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">S8</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">S12</th>
              </tr>
            </thead>
            <tbody>
              {audienceCohorts.map((c, i) => (
                <tr key={c.cohort} className="border-b border-[color:var(--border)]">
                  <td className="px-3 py-2 font-semibold">{c.cohort}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{formatNumber(c.size)}</td>
                  {[c.w1, c.w2, c.w3, c.w4, c.w8, c.w12].map((v, j) => {
                    const intensity = v / 100;
                    const bg = `rgba(124, 92, 255, ${intensity * 0.9})`;
                    const text = intensity > 0.5 ? "white" : "#2a1f4d";
                    return (
                      <td key={j} className="px-1 py-2">
                        <div
                          className="px-2 py-1 rounded-md text-center font-bold tabular-nums"
                          style={{ background: bg, color: text }}
                        >
                          {v}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <MasterOnly>
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-800 flex items-start gap-2">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 uppercase tracking-wider shrink-0">Master</span>
            <span><strong>Insight:</strong> Retenção de S4 estável em ~42-45% nos últimos 3 meses — saudável para finanças. Dez/25 teve retenção ruim (38%), possível efeito sazonal de férias.</span>
          </div>
        </MasterOnly>
      </div>
    </main>
  );
}
