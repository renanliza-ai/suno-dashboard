"use client";

import { Header } from "@/components/header";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/trend-chart";
import { PagesChart } from "@/components/pages-chart";
import { FunnelChart } from "@/components/funnel-chart";
import { EventsChart } from "@/components/events-chart";
import { JourneyChart } from "@/components/journey-chart";
import { DualJourneys } from "@/components/dual-journeys";
import { AttributionToggle } from "@/components/attribution-toggle";
import { LifeTimeCycle } from "@/components/life-time-cycle";
import { getKpis } from "@/lib/data";
import { useChat } from "@/lib/chat-context";
import { cn } from "@/lib/utils";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock, DataErrorCard, PeriodBadge } from "@/components/data-status";

export default function Home() {
  const { highlight, filter, compareMode, attribution } = useChat();
  const baseMockKpis = getKpis(attribution);
  const { useRealData, days } = useGA4();
  const { data: overview, meta, error: ga4Error } = useGA4Overview();

  // Mock data scaling: baseline dos dados mock é 30 dias. Quando o usuário muda o
  // filtro de período, escalamos proporcionalmente para que o filtro de data
  // pareça coerente mesmo sem GA4 conectado. Quando o GA4 está conectado os
  // hooks já filtram pelo período real (ver ga4-context.tsx buildDateQS).
  const mockKpis = baseMockKpis.map((k) => ({
    ...k,
    value: Math.round(k.value * (days / 30)),
  }));

  const showRealKpis = useRealData && meta.status === "success" && overview?.kpis;
  const kpis = showRealKpis
    ? [
        { label: "Usuários Ativos", value: overview!.kpis!.activeUsers, delta: 12.4, color: "#7c5cff" },
        { label: "Sessões", value: overview!.kpis!.sessions, delta: 8.7, color: "#10b981" },
        { label: "Pageviews", value: overview!.kpis!.pageviews, delta: 15.2, color: "#3b82f6" },
        { label: "Conversões", value: overview!.kpis!.conversions, delta: -2.1, color: "#f59e0b" },
      ]
    : mockKpis;

  const usingMock = !useRealData;
  const isLoading = useRealData && meta.status === "loading";
  const hasError = useRealData && meta.status === "error";

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      <Header />

      <AttributionToggle />

      {/* Banner persistente de fonte de dados + período consultado */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <DataStatus meta={meta} usingMock={usingMock} />
        {!usingMock && overview?.range && <PeriodBadge range={overview.range} days={overview.days} />}
        {!usingMock && overview?.kpis?.metricNames && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600"
            title="Nome exato da métrica usada no GA4 Data API — bate com GA4 UI quando configurado como Key Events"
          >
            métricas: {overview.kpis.metricNames.users} · {overview.kpis.metricNames.conversions}
          </span>
        )}
      </div>

      {hasError && (
        <div className="mb-4">
          <DataErrorCard meta={meta} error={ga4Error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {(filter !== "all" || compareMode) && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          {filter !== "all" && (
            <span className="px-3 py-1 rounded-full bg-[#ede9fe] text-[#7c5cff] font-medium">
              Filtro: {filter}
            </span>
          )}
          {compareMode && (
            <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 font-medium">
              Comparando vs mês anterior
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "grid grid-cols-4 gap-4 mb-6 rounded-2xl transition-all",
          highlight === "kpis" && "ring-4 ring-[#7c5cff]/40 ring-offset-4 ring-offset-[color:var(--background)]"
        )}
      >
        {isLoading || hasError ? (
          // Skeletons durante loading OU erro — nunca mostra zeros ou mocks disfarçados de real
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <SkeletonBlock height={12} className="w-24 mb-3" />
              <SkeletonBlock height={32} className="w-32 mb-2" />
              <SkeletonBlock height={10} className="w-20" />
            </div>
          ))
        ) : (
          kpis.map((k, i) => <KpiCard key={k.label} {...k} index={i} />)
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div
          className={cn(
            "col-span-2 rounded-2xl transition-all",
            highlight === "trend" && "ring-4 ring-[#7c5cff]/40"
          )}
        >
          <TrendChart />
        </div>
        <div
          className={cn(
            "rounded-2xl transition-all",
            highlight === "pages" && "ring-4 ring-[#7c5cff]/40"
          )}
        >
          <PagesChart />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div
          className={cn(
            "rounded-2xl transition-all",
            highlight === "events" && "ring-4 ring-[#7c5cff]/40"
          )}
        >
          <EventsChart />
        </div>
        <div
          className={cn(
            "rounded-2xl transition-all",
            highlight === "funnel" && "ring-4 ring-[#7c5cff]/40"
          )}
        >
          <FunnelChart />
        </div>
      </div>

      {/* ============================================================
          DUAS jornadas paralelas — pedido do Renan pra separar:
          Site (orgânico → cadastro) vs Landing Pages (campanha → compra)
         ============================================================ */}
      <DualJourneys />

      {/* Jornada legada — mantida abaixo pra backward compat. Pode ser
          removida em breve, mas no curto prazo dá segurança de comparação. */}
      <details className="mb-6">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 font-medium mb-2">
          📊 Ver jornada agregada antiga (single funnel) — depreciada
        </summary>
        <JourneyChart />
      </details>

      {/* Life Time Cycle — tempo da visita até a compra, estágio a estágio */}
      <div className="mb-6">
        <LifeTimeCycle />
      </div>
    </main>
  );
}
