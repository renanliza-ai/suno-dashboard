"use client";

import { Header } from "@/components/header";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/trend-chart";
import { PagesChart } from "@/components/pages-chart";
// FunnelChart e EventsChart removidos do dashboard a pedido do Renan
// — informação ficou redundante com DualJourneys (que mostra funis
// detalhados Site + LP) e Event Explorer em /eventos (que faz a
// análise interativa com dimensões/métricas).
import { JourneyChart } from "@/components/journey-chart";
import { DualJourneys } from "@/components/dual-journeys";
import { LifeTimeCycle } from "@/components/life-time-cycle";
import { useChat } from "@/lib/chat-context";
import { cn } from "@/lib/utils";
import { useGA4, useGA4Overview } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock, DataErrorCard, PeriodBadge } from "@/components/data-status";

export default function Home() {
  const { highlight, filter, compareMode } = useChat();
  const { useRealData } = useGA4();
  const { data: overview, meta, error: ga4Error } = useGA4Overview();

  // POLITICA ZERO MOCK (30/06): este painel nao renderiza numero fabricado em
  // NENHUM estado. Ou dado real do GA4, ou skeleton, ou erro explicito, ou
  // estado vazio pedindo conexao. O antigo mockKpis/getKpis foi removido.
  const showRealKpis = useRealData && (meta.status === "success" || meta.status === "partial") && overview?.kpis;
  // Deltas vs período anterior calculados no servidor. Quando indisponíveis (cache
  // antigo, erro parcial, range muito longo etc), passamos null → KpiCard omite o badge.
  const realDeltas = overview?.kpis?.deltas;
  const kpis = showRealKpis
    ? [
        {
          label: "Usuários Ativos",
          value: overview!.kpis!.activeUsers,
          delta: typeof realDeltas?.activeUsers === "number" ? realDeltas.activeUsers : null,
          color: "#7c5cff",
        },
        {
          label: "Sessões",
          value: overview!.kpis!.sessions,
          delta: typeof realDeltas?.sessions === "number" ? realDeltas.sessions : null,
          color: "#10b981",
        },
        {
          label: "Pageviews",
          value: overview!.kpis!.pageviews,
          delta: typeof realDeltas?.pageviews === "number" ? realDeltas.pageviews : null,
          color: "#3b82f6",
        },
        {
          label: "Conversões",
          value: overview!.kpis!.conversions,
          delta: typeof realDeltas?.conversions === "number" ? realDeltas.conversions : null,
          color: "#f59e0b",
        },
      ]
    : [];

  const usingMock = !useRealData;
  // KPIs indisponiveis com real LIGADO: fetch terminou (success/partial) mas veio
  // sem kpis. Antes esse caso caia silenciosamente no mockKpis com badge verde
  // (bug 30/06: 470,9k identicos em todas as properties). Agora vira erro visivel.
  const kpisUnavailable =
    useRealData && (meta.status === "success" || meta.status === "partial") && !overview?.kpis;
  const isLoading = useRealData && (meta.status === "loading" || meta.status === "idle");
  const hasError = useRealData && (meta.status === "error" || kpisUnavailable);
  const kpisError =
    ga4Error ||
    meta.sectionErrors?.kpis ||
    (kpisUnavailable ? "A resposta do GA4 veio sem os KPIs desta property/periodo." : null);

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      <Header />

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
          <DataErrorCard meta={meta} error={kpisError} onRetry={() => window.location.reload()} />
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
        {usingMock ? (
          // Sem property GA4 conectada: NADA de numero de exemplo. Pedimos conexao.
          <div className="col-span-4 bg-white rounded-2xl border border-dashed border-[color:var(--border)] p-8 text-center">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">
              Sem conexão com o GA4
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)] mt-1">
              Selecione uma property no header para carregar os dados reais. Este painel não
              exibe dados de exemplo.
            </div>
          </div>
        ) : isLoading || hasError ? (
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
