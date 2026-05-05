"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Users, Eye, Zap, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import {
  realtimeActiveByMinute,
  realtimeTopPages,
  realtimeByDevice,
  realtimeBySource,
  realtimeTopEvents,
} from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4Realtime } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock } from "@/components/data-status";

const deviceColors: Record<string, string> = {
  desktop: "#7c5cff",
  mobile: "#10b981",
  tablet: "#f59e0b",
  smart_tv: "#3b82f6",
};

const countryFlag: Record<string, string> = {
  Brazil: "🇧🇷",
  "United States": "🇺🇸",
  Portugal: "🇵🇹",
  Argentina: "🇦🇷",
  Mexico: "🇲🇽",
  Spain: "🇪🇸",
  Chile: "🇨🇱",
  Colombia: "🇨🇴",
};

export default function LivePage() {
  const { useRealData } = useGA4();
  const { data: rt, meta, error } = useGA4Realtime(30000);

  // Fallback para dados simulados quando não houver GA4 conectado
  const [activeUsers, setActiveUsers] = useState(347);
  const [pulse, setPulse] = useState(0);
  const [series, setSeries] = useState(realtimeActiveByMinute);

  // Tick simulado só quando NÃO temos dados reais
  useEffect(() => {
    if (useRealData) return; // dados reais cuidam do refresh via polling
    const tick = setInterval(() => {
      setActiveUsers((v) => {
        const delta = Math.floor(Math.random() * 20 - 10);
        return Math.max(150, Math.min(600, v + delta));
      });
      setPulse((p) => p + 1);
      setSeries((prev) => {
        const next = [
          ...prev.slice(1),
          { minute: "now", users: Math.floor(activeUsers + Math.random() * 40 - 20) },
        ];
        return next.map((d, i) => ({
          ...d,
          minute: i === next.length - 1 ? "agora" : `-${next.length - 1 - i}m`,
        }));
      });
    }, 3000);
    return () => clearInterval(tick);
  }, [activeUsers, useRealData]);

  // Quando dados reais chegam, empurra no series e pulsa
  useEffect(() => {
    if (!useRealData || !rt) return;
    setActiveUsers(rt.active);
    setPulse((p) => p + 1);
    setSeries((prev) => {
      const next = [...prev.slice(1), { minute: "agora", users: rt.active }];
      return next.map((d, i) => ({
        ...d,
        minute: i === next.length - 1 ? "agora" : `-${next.length - 1 - i}m`,
      }));
    });
  }, [rt, useRealData]);

  const showingReal = useRealData && meta.status === "success" && rt;
  const isLoadingReal = useRealData && meta.status === "loading" && !rt;

  // Fonte de dados final (real > mock)
  const displayPages = showingReal
    ? rt!.pages.map((p) => ({ path: p.path || "(sem path)", users: p.users, trend: "flat" as const }))
    : realtimeTopPages;

  const totalDeviceUsers = showingReal
    ? rt!.devices.reduce((s, d) => s + d.value, 0) || 1
    : 100;
  const displayDevices = showingReal
    ? rt!.devices.map((d) => ({
        name: d.name || "desconhecido",
        value: Math.round((d.value / totalDeviceUsers) * 100),
        color: deviceColors[d.name] || "#7c5cff",
      }))
    : realtimeByDevice;

  // Top 10 localizações (estado/cidade) — substitui a lista de países por granularidade BR.
  const displayLocations = showingReal && rt!.locations && rt!.locations.length > 0
    ? rt!.locations.map((l) => ({
        country: l.country || "—",
        region: l.region || "—",
        city: l.city || "—",
        users: l.users,
        flag: countryFlag[l.country] || "🌎",
      }))
    : [
        { country: "Brazil", region: "São Paulo", city: "São Paulo", users: 182, flag: "🇧🇷" },
        { country: "Brazil", region: "Rio de Janeiro", city: "Rio de Janeiro", users: 96, flag: "🇧🇷" },
        { country: "Brazil", region: "Minas Gerais", city: "Belo Horizonte", users: 54, flag: "🇧🇷" },
        { country: "Brazil", region: "Rio Grande do Sul", city: "Porto Alegre", users: 41, flag: "🇧🇷" },
        { country: "Brazil", region: "Paraná", city: "Curitiba", users: 38, flag: "🇧🇷" },
        { country: "Brazil", region: "Santa Catarina", city: "Florianópolis", users: 26, flag: "🇧🇷" },
        { country: "Brazil", region: "Distrito Federal", city: "Brasília", users: 22, flag: "🇧🇷" },
        { country: "Brazil", region: "Bahia", city: "Salvador", users: 19, flag: "🇧🇷" },
        { country: "Brazil", region: "Pernambuco", city: "Recife", users: 14, flag: "🇧🇷" },
        { country: "Brazil", region: "Ceará", city: "Fortaleza", users: 11, flag: "🇧🇷" },
      ];

  const displayEvents = showingReal && rt!.events && rt!.events.length > 0
    ? rt!.events.map((e) => ({ event: e.event, count: e.count }))
    : realtimeTopEvents;

  const displaySources = showingReal && rt!.platforms && rt!.platforms.length > 0
    ? rt!.platforms.map((s) => ({ source: s.source || "(desconhecido)", users: s.users }))
    : realtimeBySource;

  return (
    <main className="ml-20 p-8 max-w-[1600px]">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="absolute inset-0 w-3 h-3 rounded-full bg-red-500 animate-ping" />
          </div>
          <span className="text-xs font-bold text-red-600 uppercase tracking-wider">
            Ao vivo · Atualiza a cada {showingReal ? "30s" : "3s"}
          </span>
          <DataStatus meta={meta} usingMock={!useRealData} />
          {showingReal && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600"
              title="GA4 Data API · runRealtimeReport"
            >
              runRealtimeReport · últimos 30 min
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Comportamento ao vivo</h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          {showingReal
            ? "Dados reais do GA4 Realtime API · últimos 30 minutos"
            : "Veja o que está acontecendo no site agora · últimos 30 minutos"}
        </p>
      </motion.div>

      {useRealData && error && meta.status === "error" && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
          Não foi possível consultar GA4 Realtime: <span className="font-mono">{error}</span>
        </div>
      )}

      {/* Dica de debug quando o Realtime está zerado ou muito baixo */}
      {showingReal && rt!.active < 3 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <strong>Só {rt!.active} usuário(s) ativo(s)?</strong> Se você acabou de fazer um teste e não aparece aqui, verifique:
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              <li>Você selecionou a <strong>propriedade GA4 correta</strong> (cheque a sidebar)?</li>
              <li>O site tem a <strong>tag GA4 instalada</strong>? Abra o DevTools → Network e filtre por <code className="bg-white/60 px-1 rounded">collect</code></li>
              <li>Seu navegador tem <strong>bloqueador de anúncios/tracking</strong>? Eles impedem o hit chegar no GA4</li>
              <li>Realtime tem <strong>atraso de 30s–2min</strong> — aguarde e recarregue</li>
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4 mb-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="col-span-12 lg:col-span-5 relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a0b2e] via-[#2d1b4e] to-[#1a0b2e] text-white p-6 shadow-xl"
        >
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-gradient-to-br from-red-500/30 to-pink-500/20 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-gradient-to-br from-purple-500/20 to-transparent blur-3xl" />

          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={16} className="text-red-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-red-300">
                Usuários ativos agora
              </span>
            </div>

            {isLoadingReal ? (
              <SkeletonBlock height={72} className="w-40 bg-white/10" />
            ) : (
              <motion.div
                key={pulse}
                initial={{ scale: 0.95, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="text-7xl font-bold tracking-tight bg-gradient-to-br from-white to-purple-200 bg-clip-text text-transparent"
              >
                {activeUsers}
              </motion.div>
            )}

            <div className="flex items-center gap-3 mt-3 text-sm">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <TrendingUp size={14} />
                <span className="font-semibold">+12%</span>
              </div>
              <span className="text-purple-200/70">vs média das últimas 24h</span>
            </div>

            <div className="mt-6 h-32">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f87171" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="minute" hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(26,11,46,0.95)",
                      border: "1px solid rgba(248,113,113,0.3)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "white",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="users"
                    stroke="#f87171"
                    strokeWidth={2}
                    fill="url(#liveGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] text-purple-200/60 mt-1 flex justify-between">
              <span>-30 min</span>
              <span>agora</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="col-span-12 lg:col-span-4 bg-white rounded-2xl border border-[color:var(--border)] p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Eye size={16} className="text-[#7c5cff]" />
            <h3 className="text-sm font-semibold">Páginas visitadas · últimos 30 min</h3>
            {showingReal && (
              <span className="ml-auto text-[9px] font-mono text-emerald-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                unifiedPagePathScreen
              </span>
            )}
          </div>
          <div className="space-y-2">
            {isLoadingReal && [...Array(6)].map((_, i) => (
              <SkeletonBlock key={i} height={20} />
            ))}
            {!isLoadingReal && displayPages.length === 0 && (
              <div className="text-xs text-[color:var(--muted-foreground)] py-4 text-center">
                Sem pageviews nos últimos 30 min.
              </div>
            )}
            {!isLoadingReal && displayPages.slice(0, 8).map((p, i) => {
              const trend = "trend" in p ? (p as { trend: string }).trend : "flat";
              const TIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
              const trendColor =
                trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-gray-400";
              return (
                <motion.div
                  key={`${p.path}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.04 }}
                  className="flex items-center gap-3 py-1.5"
                >
                  <span className="text-[10px] text-[color:var(--muted-foreground)] font-mono w-4">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-xs font-mono truncate">{p.path}</span>
                  <TIcon size={12} className={trendColor} />
                  <span className="text-sm font-bold tabular-nums w-10 text-right">{p.users}</span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="col-span-12 lg:col-span-3 bg-white rounded-2xl border border-[color:var(--border)] p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-[#7c5cff]" />
            <h3 className="text-sm font-semibold">Dispositivos · últimos 30 min</h3>
          </div>
          <div className="space-y-3">
            {isLoadingReal && [...Array(3)].map((_, i) => <SkeletonBlock key={i} height={24} />)}
            {!isLoadingReal && displayDevices.map((d) => (
              <div key={d.name}>
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span className="font-medium capitalize">{d.name}</span>
                  <span className="font-bold">{d.value}%</span>
                </div>
                <div className="h-2 bg-[color:var(--muted)] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${d.value}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full rounded-full"
                    style={{ background: d.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-dashed border-[color:var(--border)]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-[color:var(--muted-foreground)] uppercase tracking-wider font-semibold">
                Top 10 · Estado / Cidade
              </div>
              <span className="text-[9px] text-[color:var(--muted-foreground)]">30 min</span>
            </div>
            {displayLocations.length === 0 && (
              <div className="text-[11px] text-[color:var(--muted-foreground)] py-2 text-center">
                Sem tráfego geolocalizado nos últimos 30 min.
              </div>
            )}
            <div className="space-y-1">
              {displayLocations.slice(0, 10).map((l, i) => {
                const max = displayLocations[0]?.users || 1;
                const pct = (l.users / max) * 100;
                return (
                  <motion.div
                    key={`${l.region}-${l.city}-${i}`}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.03 }}
                    className="relative"
                  >
                    <div className="flex items-center justify-between text-[11px] py-0.5 relative z-10">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="text-[9px] font-mono text-[color:var(--muted-foreground)] w-4">
                          {i + 1}
                        </span>
                        <span className="truncate">
                          <span className="font-semibold text-[color:var(--foreground)]">
                            {l.city}
                          </span>
                          <span className="text-[color:var(--muted-foreground)]"> · {l.region}</span>
                        </span>
                      </span>
                      <span className="font-bold tabular-nums">{l.users}</span>
                    </div>
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-[#ede9fe] to-transparent -z-0"
                      style={{ width: `${pct}%` }}
                    />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="col-span-12 lg:col-span-6 bg-white rounded-2xl border border-[color:var(--border)] p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-[#7c5cff]" />
            <h3 className="text-sm font-semibold">Eventos disparados nos últimos 30min</h3>
            {showingReal && (
              <span className="text-[9px] font-mono text-emerald-600 ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                eventName · runRealtimeReport
              </span>
            )}
          </div>
          <div className="space-y-2">
            {displayEvents.length === 0 && (
              <div className="text-xs text-[color:var(--muted-foreground)] py-4 text-center">
                Nenhum evento disparado nos últimos 30 min.
              </div>
            )}
            {displayEvents.map((e, i) => {
              const max = displayEvents[0]?.count || 1;
              const pct = (e.count / max) * 100;
              return (
                <div key={`${e.event}-${i}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-[color:var(--foreground)]">{e.event}</span>
                    <span className="text-sm font-bold tabular-nums">{formatNumber(e.count)}</span>
                  </div>
                  <div className="h-1.5 bg-[color:var(--muted)] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                      className="h-full rounded-full bg-gradient-to-r from-[#7c5cff] to-[#b297ff]"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="col-span-12 lg:col-span-6 bg-white rounded-2xl border border-[color:var(--border)] p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-[#7c5cff]" />
            <h3 className="text-sm font-semibold">
              {showingReal ? "Plataforma em tempo real" : "Origem do tráfego em tempo real"}
            </h3>
            {showingReal && (
              <span
                className="text-[9px] font-mono text-[color:var(--muted-foreground)] ml-auto"
                title="Realtime API não expõe sessionSource — usamos dimension platform (web/android/ios). Para origem de canal, veja painel 30d."
              >
                platform · realtime
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            {displaySources.length === 0 && (
              <div className="text-xs text-[color:var(--muted-foreground)] py-4 text-center">
                Sem tráfego nos últimos 30 min.
              </div>
            )}
            {displaySources.map((s, i) => {
              const max = displaySources[0]?.users || 1;
              const pct = (s.users / max) * 100;
              return (
                <motion.div
                  key={`${s.source}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.05 }}
                  className="flex items-center gap-3"
                >
                  <span className="text-xs font-medium w-32 truncate capitalize">{s.source}</span>
                  <div className="flex-1 h-6 bg-[color:var(--muted)] rounded-md overflow-hidden relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7 }}
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-md"
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-[11px] font-bold text-[color:var(--foreground)]">
                      {s.users}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {!useRealData && (
        <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
            <Activity size={14} className="text-white" />
          </div>
          <div className="text-xs text-amber-900">
            <strong>Visualização simulada.</strong> Conecte uma propriedade GA4 na lateral para ver dados reais via{" "}
            <code className="bg-white/60 px-1 rounded">runRealtimeReport</code> — usuários ativos, páginas, dispositivos e países atualizam a cada 30s.
          </div>
        </div>
      )}
    </main>
  );
}
