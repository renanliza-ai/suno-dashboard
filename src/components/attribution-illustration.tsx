"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/lib/chat-context";
import {
  Search,
  MousePointerClick,
  ShoppingCart,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  RefreshCw,
  Users,
  Share2,
  Heart,
  Info,
} from "lucide-react";

/**
 * Ilustração da jornada conforme o modelo de atribuição ativo:
 *   - last-click  → Funil linear (5 etapas verticais)
 *   - assisted    → Flywheel circular (modelo de força contínua)
 *
 * Facilita o entendimento do time sobre qual lente de análise está ativa.
 */
export function AttributionIllustration() {
  const { attribution } = useChat();
  const isLast = attribution === "last-click";

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      {/* Header contextual */}
      <div
        className={`p-5 border-b border-[color:var(--border)] transition-colors ${
          isLast
            ? "bg-gradient-to-r from-[#ede9fe] to-[#dbeafe]"
            : "bg-gradient-to-r from-emerald-50 to-teal-50"
        }`}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div
              className={`text-[10px] font-bold uppercase tracking-wider ${
                isLast ? "text-[#5b3ed6]" : "text-emerald-700"
              }`}
            >
              Modelo ativo
            </div>
            <h3 className="text-base font-bold mt-0.5 flex items-center gap-2">
              {isLast ? "Funil · Last Click" : "Flywheel · Conversão Assistida"}
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  isLast
                    ? "bg-[#7c5cff] text-white"
                    : "bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
                }`}
              >
                {isLast ? "LINEAR" : "CIRCULAR"}
              </span>
            </h3>
            <p className="text-xs text-slate-600 mt-1 max-w-xl">
              {isLast
                ? "Atribui 100% da conversão ao último canal clicado. Simples, mas ignora a jornada completa."
                : "Distribui crédito entre todos os touchpoints. Mostra quem abre, assiste e fecha a venda — modelo Suno usa desde 2024."}
            </p>
          </div>
          <div
            className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg font-semibold border ${
              isLast
                ? "bg-white border-[#c4b5fd]/40 text-[#5b3ed6]"
                : "bg-white border-emerald-200 text-emerald-700"
            }`}
          >
            <Info size={12} />
            Use o toggle acima para alternar
          </div>
        </div>
      </div>

      <div className="p-6">
        <AnimatePresence mode="wait">
          {isLast ? <FunnelLastClick key="funnel" /> : <FlywheelAssisted key="flywheel" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------- FUNIL LAST CLICK ------------------------- */
const funnelSteps = [
  { icon: Search, label: "Descoberta", sub: "Ads, SEO, social", pct: 100, color: "#a78bfa" },
  { icon: MousePointerClick, label: "Clique", sub: "LP / anúncio", pct: 72, color: "#8b5cf6" },
  { icon: ShoppingCart, label: "Checkout", sub: "begin_checkout", pct: 38, color: "#7c5cff" },
  { icon: CheckCircle2, label: "Compra", sub: "purchase", pct: 14, color: "#5b3dd4" },
];

function FunnelLastClick() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-center"
    >
      {/* SVG do funil */}
      <div className="relative w-full max-w-md mx-auto">
        <svg viewBox="0 0 400 340" className="w-full h-auto">
          {funnelSteps.map((step, i) => {
            const topWidth = 400 - i * 60;
            const bottomWidth = 400 - (i + 1) * 60;
            const y = i * 75;
            const points = `${(400 - topWidth) / 2},${y} ${
              (400 + topWidth) / 2
            },${y} ${(400 + bottomWidth) / 2},${y + 75} ${
              (400 - bottomWidth) / 2
            },${y + 75}`;
            return (
              <motion.polygon
                key={step.label}
                points={points}
                fill={step.color}
                opacity={0.85}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 0.85, y: 0 }}
                transition={{ delay: 0.1 + i * 0.1, type: "spring", damping: 22 }}
              />
            );
          })}
          {/* Labels dentro do funil */}
          {funnelSteps.map((step, i) => (
            <motion.text
              key={`t-${step.label}`}
              x={200}
              y={i * 75 + 45}
              textAnchor="middle"
              className="fill-white font-bold"
              fontSize="18"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.1 }}
            >
              {step.pct}%
            </motion.text>
          ))}
        </svg>
      </div>

      {/* Legenda passo-a-passo */}
      <div className="space-y-2 min-w-[240px]">
        {funnelSteps.map((step, i) => {
          const Icon = step.icon;
          const drop = i > 0 ? funnelSteps[i - 1].pct - step.pct : 0;
          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.1 }}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0"
                style={{ background: step.color }}
              >
                <Icon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{step.label}</div>
                <div className="text-[11px] text-slate-500">{step.sub}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold tabular-nums">{step.pct}%</div>
                {drop > 0 && (
                  <div className="text-[10px] text-red-500 font-semibold">-{drop}pp</div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="lg:col-span-2 rounded-xl bg-gradient-to-r from-[#ede9fe] to-[#dbeafe] border border-[#c4b5fd]/40 p-3 text-xs text-slate-700 flex items-start gap-2"
      >
        <Sparkles size={14} className="text-[#5b3ed6] mt-0.5 shrink-0" />
        <span>
          <strong>Leitura:</strong> só o último clique leva o crédito. Simples de reportar, mas
          subvaloriza canais que <em>originam</em> a jornada (SEO orgânico, conteúdo, indicação).
        </span>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------- FLYWHEEL ASSISTIDA ------------------------- */
const flywheelSteps = [
  { icon: Users, label: "Atrair", sub: "Conteúdo + ads", angle: 0, color: "#10b981" },
  { icon: MousePointerClick, label: "Engajar", sub: "Newsletter + YouTube", angle: 72, color: "#14b8a6" },
  { icon: Heart, label: "Converter", sub: "Assinatura Premium", angle: 144, color: "#06b6d4" },
  { icon: TrendingUp, label: "Encantar", sub: "Área logada + resultado", angle: 216, color: "#0ea5e9" },
  { icon: Share2, label: "Advogar", sub: "Indicações + NPS", angle: 288, color: "#6366f1" },
];

function FlywheelAssisted() {
  const radius = 110;
  const center = 160;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-center"
    >
      {/* SVG do flywheel */}
      <div className="relative mx-auto">
        <motion.svg
          viewBox="0 0 320 320"
          width={320}
          height={320}
          className="drop-shadow-md"
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        >
          {/* Círculo de fundo */}
          <circle
            cx={center}
            cy={center}
            r={radius + 20}
            fill="none"
            stroke="url(#flywheelGrad)"
            strokeWidth={2}
            strokeDasharray="4 6"
            opacity={0.4}
          />
          <defs>
            <linearGradient id="flywheelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>

          {/* Setas conectando */}
          {flywheelSteps.map((s, i) => {
            const next = flywheelSteps[(i + 1) % flywheelSteps.length];
            const a1 = ((s.angle - 90) * Math.PI) / 180;
            const a2 = ((next.angle - 90) * Math.PI) / 180;
            const x1 = center + Math.cos(a1) * radius;
            const y1 = center + Math.sin(a1) * radius;
            const x2 = center + Math.cos(a2) * radius;
            const y2 = center + Math.sin(a2) * radius;
            return (
              <motion.path
                key={`arc-${i}`}
                d={`M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`}
                fill="none"
                stroke={s.color}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.5}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay: 0.1 + i * 0.1, duration: 0.5 }}
              />
            );
          })}

          {/* Nós (círculos por etapa) */}
          {flywheelSteps.map((s, i) => {
            const a = ((s.angle - 90) * Math.PI) / 180;
            const x = center + Math.cos(a) * radius;
            const y = center + Math.sin(a) * radius;
            return (
              <motion.circle
                key={`node-${s.label}`}
                cx={x}
                cy={y}
                r={26}
                fill={s.color}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15 + i * 0.08, type: "spring" }}
              />
            );
          })}
        </motion.svg>

        {/* Labels contra-rotacionados (não giram com o SVG) */}
        <div className="absolute inset-0 pointer-events-none">
          {flywheelSteps.map((s, i) => {
            const a = ((s.angle - 90) * Math.PI) / 180;
            const x = center + Math.cos(a) * radius;
            const y = center + Math.sin(a) * radius;
            const Icon = s.icon;
            return (
              <motion.div
                key={`label-${s.label}`}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="absolute flex items-center justify-center"
                style={{
                  left: x - 14,
                  top: y - 14,
                  width: 28,
                  height: 28,
                }}
              >
                <Icon size={16} className="text-white" />
              </motion.div>
            );
          })}
        </div>

        {/* Centro: velocidade */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
            Velocidade
          </div>
          <div className="text-2xl font-bold bg-gradient-to-r from-emerald-600 to-indigo-600 bg-clip-text text-transparent">
            2.8x
          </div>
          <div className="text-[10px] text-slate-500">vs last-click</div>
        </motion.div>
      </div>

      {/* Legenda */}
      <div className="space-y-2">
        {flywheelSteps.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0"
                style={{ background: s.color }}
              >
                <Icon size={15} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold">{s.label}</div>
                <div className="text-[11px] text-slate-500">{s.sub}</div>
              </div>
              <RefreshCw size={12} className="text-slate-300" />
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="lg:col-span-2 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 p-3 text-xs text-slate-700 flex items-start gap-2"
      >
        <Sparkles size={14} className="text-emerald-600 mt-0.5 shrink-0" />
        <span>
          <strong>Leitura:</strong> cada canal alimenta o próximo. O Flywheel mostra que
          <strong> conteúdo orgânico e indicação</strong> sustentam a máquina de aquisição — mesmo
          quando não levam o crédito final.
        </span>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------- TOP CAMPANHAS ASSISTIDAS ------------------------- */
export type AssistedCampaign = {
  name: string;
  role: "opener" | "influencer" | "closer";
  assistedConversions: number;
  directConversions: number;
  assistRatio: number; // assisted / total
  channel: string;
  revenue: number;
};

const assistedCampaigns: AssistedCampaign[] = [
  {
    name: "YouTube · Dividendos para Iniciantes",
    role: "opener",
    assistedConversions: 1842,
    directConversions: 312,
    assistRatio: 0.85,
    channel: "Orgânico",
    revenue: 284000,
  },
  {
    name: "Meta · Retargeting Premium-30",
    role: "closer",
    assistedConversions: 643,
    directConversions: 1421,
    assistRatio: 0.31,
    channel: "Paid Social",
    revenue: 512800,
  },
  {
    name: "Newsletter Suno Semanal",
    role: "influencer",
    assistedConversions: 1203,
    directConversions: 189,
    assistRatio: 0.86,
    channel: "Email",
    revenue: 198400,
  },
  {
    name: "Google Ads · Brand 'suno'",
    role: "closer",
    assistedConversions: 287,
    directConversions: 1104,
    assistRatio: 0.21,
    channel: "Paid Search",
    revenue: 398200,
  },
  {
    name: "LinkedIn · Conteúdo Fundador",
    role: "opener",
    assistedConversions: 724,
    directConversions: 81,
    assistRatio: 0.9,
    channel: "Orgânico",
    revenue: 112000,
  },
  {
    name: "Podcast Inteligência Financeira",
    role: "influencer",
    assistedConversions: 518,
    directConversions: 62,
    assistRatio: 0.89,
    channel: "Parceria",
    revenue: 78400,
  },
];

const roleMeta: Record<
  AssistedCampaign["role"],
  { label: string; emoji: string; color: string; explain: string }
> = {
  opener: {
    label: "Abre jornada",
    emoji: "🚀",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    explain: "Primeiro touchpoint — trouxe o usuário ao ecossistema",
  },
  influencer: {
    label: "Influencia",
    emoji: "✨",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    explain: "Touchpoint intermediário — nutre e mantém o interesse",
  },
  closer: {
    label: "Fecha venda",
    emoji: "🎯",
    color: "bg-purple-50 text-purple-700 border-purple-200",
    explain: "Último clique — converte no momento da compra",
  },
};

export function TopAssistedCampaigns() {
  const { attribution } = useChat();
  if (attribution !== "assisted") return null;

  const formatNum = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
  const formatBRL = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

  const maxTotal = Math.max(
    ...assistedCampaigns.map((c) => c.assistedConversions + c.directConversions)
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-6"
    >
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-600" />
            Top campanhas que mais ajudaram a converter
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cruza conversões <strong>assistidas</strong> (touchpoint na jornada) com
            conversões <strong>diretas</strong> (last-click) — revela quem o funil esconde
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          {Object.entries(roleMeta).map(([k, v]) => (
            <span
              key={k}
              className={`px-2 py-0.5 rounded-full font-semibold border ${v.color}`}
              title={v.explain}
            >
              {v.emoji} {v.label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {[...assistedCampaigns]
          .sort((a, b) => b.assistedConversions - a.assistedConversions)
          .map((c, i) => {
            const total = c.assistedConversions + c.directConversions;
            const assistedPct = (c.assistedConversions / total) * 100;
            const directPct = 100 - assistedPct;
            const widthPct = (total / maxTotal) * 100;
            const role = roleMeta[c.role];
            return (
              <motion.div
                key={c.name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="group grid grid-cols-12 gap-3 items-center p-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:shadow-sm transition"
              >
                <div className="col-span-4 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${role.color}`}
                    >
                      {role.emoji} {role.label}
                    </span>
                  </div>
                  <div className="text-sm font-semibold mt-1 truncate">{c.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{c.channel}</div>
                </div>

                {/* Barra dupla assistida vs direta */}
                <div className="col-span-5">
                  <div
                    className="flex h-3 rounded-full overflow-hidden bg-slate-100"
                    style={{ width: `${Math.max(widthPct, 20)}%` }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${assistedPct}%` }}
                      transition={{ delay: 0.2 + i * 0.05, duration: 0.6 }}
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-500"
                      title={`${assistedPct.toFixed(0)}% assistidas`}
                    />
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${directPct}%` }}
                      transition={{ delay: 0.3 + i * 0.05, duration: 0.6 }}
                      className="h-full bg-gradient-to-r from-purple-400 to-[#7c5cff]"
                      title={`${directPct.toFixed(0)}% diretas`}
                    />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {formatNum(c.assistedConversions)} assistidas
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#7c5cff]" />
                      {formatNum(c.directConversions)} diretas
                    </span>
                  </div>
                </div>

                <div className="col-span-2 text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Lift assistido
                  </div>
                  <div className="text-sm font-bold text-emerald-600 tabular-nums">
                    {(c.assistRatio * 100).toFixed(0)}%
                  </div>
                </div>

                <div className="col-span-1 text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Receita
                  </div>
                  <div className="text-sm font-bold tabular-nums">{formatBRL(c.revenue)}</div>
                </div>
              </motion.div>
            );
          })}
      </div>

      <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 text-xs text-slate-700 flex items-start gap-2">
        <Sparkles size={14} className="text-emerald-600 mt-0.5 shrink-0" />
        <span>
          <strong>Insight:</strong> campanhas com alto <em>lift assistido</em> (orgânico, newsletter,
          podcast) seriam zeradas num modelo last-click. Priorize orçamento nelas pra sustentar o
          topo do flywheel — sem elas, os canais de fechamento (Meta retargeting, Google Brand) não
          têm quem converter.
        </span>
      </div>
    </motion.div>
  );
}
