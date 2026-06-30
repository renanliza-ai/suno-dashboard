"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";
import { ProposalCard } from "@/components/proposal-card";
import { ProposalDetailsModal } from "@/components/proposal-details-modal";
import { SkeletonBlock, DataErrorCard } from "@/components/data-status";
import type { Proposal, LPData, SourceBreakdownRow } from "@/lib/cro-types";
import { buildCroBriefHtml } from "@/lib/cro-playbook";

/**
 * CROProposalsBoard — orquestrador da feature CRO Automation.
 *
 * Faz 3 fetches em sequência ao montar / quando property/range muda:
 *  1. /api/ga4/landing-pages?comparePreviousPeriod=true → LPs + período anterior + sources
 *  2. /api/cro/proposal-state?propertyId → states KV (aceito/descartado)
 *  3. POST /api/cro/lp-proposals → aplica motor heurístico, retorna propostas
 *
 * Renderiza até 10 cards prioritários (ordenados por critério do motor).
 * Cards aceitos abrem modal pra criar task Monday + persistir KV.
 *
 * Spec: docs/superpowers/specs/2026-06-04-cro-automation-design.md (3.3, 5)
 */

// Mesma resolução de hostnames do LP Analyzer. Pode centralizar em /lib depois.
const LP_HOSTS_BY_PROPERTY: Array<{ match: string; hosts: string[] }> = [
  { match: "suno", hosts: ["lp.suno.com.br", "lp2.suno.com.br"] },
  { match: "status", hosts: ["lp.statusinvest.com.br", "lp2.statusinvest.com.br"] },
];

function resolveLPHosts(name: string | null | undefined): string[] | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const cfg of LP_HOSTS_BY_PROPERTY) {
    if (lower.includes(cfg.match)) return cfg.hosts;
  }
  return null;
}

const MAX_VISIBLE_CARDS = 10;

export function CROProposalsBoard() {
  const { selectedId, selected, useRealData, days, customRange } = useGA4();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalProposal, setModalProposal] = useState<Proposal | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"accept" | "dismiss" | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const hosts = resolveLPHosts(selected?.displayName);

  // Cálculo de rangeDays usado pelo motor de impact
  const rangeDays = useMemo(() => {
    if (customRange?.startDate && customRange?.endDate) {
      const start = new Date(customRange.startDate);
      const end = new Date(customRange.endDate);
      return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    }
    return days;
  }, [customRange?.startDate, customRange?.endDate, days]);

  // Fetch principal — disparado quando property/range/realData mudam.
  // Anti race-condition: ignora respostas cujo propertyId ≠ atual.
  useEffect(() => {
    if (!selectedId || !useRealData || !hosts) {
      setProposals([]);
      return;
    }
    const ctrl = new AbortController();
    const requestPropertyId = selectedId;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1. LPs do GA4 + período anterior + breakdown sources
        const qs = new URLSearchParams({
          propertyId: selectedId,
          hostsIn: hosts.join(","),
          comparePreviousPeriod: "true",
          leadEvent: "generate_lead",
          ctaEvent: "cta_click",
          limit: "100",
        });
        if (customRange?.startDate && customRange?.endDate) {
          qs.set("startDate", customRange.startDate);
          qs.set("endDate", customRange.endDate);
        } else {
          qs.set("days", String(days));
        }
        const lpRes = await fetch(`/api/ga4/landing-pages?${qs.toString()}`, { signal: ctrl.signal });
        const lpData = await lpRes.json();
        if (lpData.propertyId && lpData.propertyId !== requestPropertyId) return;
        if (lpData.error) throw new Error(lpData.error);

        // 2. Estado KV — propostas já tratadas
        const stateRes = await fetch(
          `/api/cro/proposal-state?propertyId=${encodeURIComponent(selectedId)}`,
          { signal: ctrl.signal }
        );
        const stateData = await stateRes.json();
        const stateMap = new Map<string, { status: "accepted" | "dismissed"; mondayUrl?: string; decidedAt?: number }>();
        for (const e of stateData.entries || []) {
          stateMap.set(e.proposalKey, {
            status: e.state.status,
            mondayUrl: e.state.mondayUrl,
            decidedAt: e.state.decidedAt,
          });
        }

        // 3. POST pro motor de propostas
        const propRes = await fetch("/api/cro/lp-proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages: lpData.pages as LPData[],
            pagesPrevious: lpData.pagesPrevious as LPData[],
            sourceBreakdown: lpData.sourceBreakdown as SourceBreakdownRow[],
            rangeDays,
          }),
          signal: ctrl.signal,
        });
        const propData = await propRes.json();
        if (propData.error) throw new Error(propData.error);

        // 4. Merge state KV
        const merged = (propData.proposals as Proposal[]).map((p) => {
          const st = stateMap.get(p.proposal_key);
          if (st) {
            return { ...p, status: st.status, mondayUrl: st.mondayUrl, decidedAt: st.decidedAt };
          }
          return { ...p, status: "pending" as const };
        });

        setProposals(merged);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message || "erro");
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [selectedId, useRealData, days, customRange?.startDate, customRange?.endDate, hosts?.join(","), rangeDays]);

  // Split pending vs tratadas
  const { pending, treated } = useMemo(() => {
    const p: Proposal[] = [];
    const t: Proposal[] = [];
    for (const x of proposals) {
      if (x.status === "pending" || !x.status) p.push(x);
      else t.push(x);
    }
    return { pending: p, treated: t };
  }, [proposals]);

  const visibleCards = pending.slice(0, MAX_VISIBLE_CARDS);
  const remainingCount = pending.length - visibleCards.length;

  async function handleAccept(p: Proposal) {
    if (!selectedId) return;
    setActingKey(p.proposal_key);
    setActionType("accept");
    try {
      // 1. Cria task no Monday
      // Corpo da tarefa: briefing senior em HTML (autoexplicativo, com o link da
      // LP, SEM link de painel - o time nao tem acesso a aba CRO). Postado verbatim
      // no Monday via rawBody (a rota nao envolve em markdown nem adiciona rodape).
      const description = buildCroBriefHtml(p);

      const mondayRes = await fetch("/api/monday/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[CRO] ${p.lp.path} - ${p.titulo}`,
          description,
          rawBody: true,
        }),
      });
      const mondayData = await mondayRes.json();
      const mondayItemId = mondayData?.item?.id || mondayData?.itemId;
      const mondayUrl = mondayData?.item?.url || mondayData?.url;

      // 2. Persiste state KV
      await fetch("/api/cro/proposal-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedId,
          proposalKey: p.proposal_key,
          status: "accepted",
          mondayItemId,
          mondayUrl,
          snapshot: {
            leadConvRate: 0,
            bounceRate: 0,
            sessions: 0,
            avgSessionDuration: 0,
            sinaisDetalhados: p.sinaisDetalhados,
          },
        }),
      });

      // 3. Atualiza state local (fade card)
      setProposals((prev) =>
        prev.map((x) =>
          x.proposal_key === p.proposal_key
            ? { ...x, status: "accepted" as const, mondayUrl }
            : x
        )
      );
      if (modalProposal?.proposal_key === p.proposal_key) setModalProposal(null);
    } catch (e) {
      alert(`Falhou ao criar task: ${(e as Error).message}`);
    } finally {
      setActingKey(null);
      setActionType(null);
    }
  }

  async function handleDismiss(p: Proposal) {
    if (!selectedId) return;
    setActingKey(p.proposal_key);
    setActionType("dismiss");
    try {
      await fetch("/api/cro/proposal-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedId,
          proposalKey: p.proposal_key,
          status: "dismissed",
          snapshot: {
            leadConvRate: 0,
            bounceRate: 0,
            sessions: 0,
            avgSessionDuration: 0,
            sinaisDetalhados: p.sinaisDetalhados,
          },
        }),
      });
      setProposals((prev) =>
        prev.map((x) =>
          x.proposal_key === p.proposal_key ? { ...x, status: "dismissed" as const } : x
        )
      );
      if (modalProposal?.proposal_key === p.proposal_key) setModalProposal(null);
    } finally {
      setActingKey(null);
      setActionType(null);
    }
  }

  // Estados especiais
  if (!hosts) return null;
  if (!useRealData) return null;

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[color:var(--border)] bg-gradient-to-r from-violet-50 via-white to-indigo-50">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles size={18} className="text-[#7c5cff]" />
            Propostas CRO
            <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
              {loading ? "carregando..." : `${pending.length} pendente${pending.length !== 1 ? "s" : ""}`}
            </span>
          </h2>
          {treated.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs text-[color:var(--muted-foreground)] hover:text-slate-700 underline"
            >
              {showHistory ? "Ocultar" : "Ver"} histórico ({treated.length})
            </button>
          )}
        </div>
        <p className="text-xs text-[color:var(--muted-foreground)] mt-1">
          Propostas data-driven baseadas em 11 heurísticas sobre LPs ativas (≥100 sessões).
          Aceitar cria task no Monday automaticamente.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="p-6 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonBlock key={i} height={180} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="p-6">
          <DataErrorCard
            meta={{
              status: "error",
              propertyId: selectedId,
              propertyName: selected?.displayName || null,
              fetchedAt: null,
            }}
            error={error}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && pending.length === 0 && treated.length === 0 && (
        <div className="p-12 text-center text-sm text-[color:var(--muted-foreground)]">
          <span className="text-2xl">🎉</span>
          <div className="mt-2">Todas as LPs estão dentro dos parâmetros saudáveis.</div>
        </div>
      )}

      {/* Cards */}
      {!loading && !error && pending.length > 0 && (
        <div className="p-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleCards.map((p) => (
            <ProposalCard
              key={p.proposal_key}
              proposal={p}
              isAccepting={actingKey === p.proposal_key && actionType === "accept"}
              isDismissing={actingKey === p.proposal_key && actionType === "dismiss"}
              onAccept={() => handleAccept(p)}
              onDismiss={() => handleDismiss(p)}
              onOpenDetails={() => setModalProposal(p)}
            />
          ))}
        </div>
      )}

      {remainingCount > 0 && (
        <div className="px-6 py-3 border-t border-slate-100 text-center text-xs text-slate-500">
          +{remainingCount} propostas adicionais. Trate as visíveis primeiro.
        </div>
      )}

      {/* Histórico tratadas */}
      {showHistory && treated.length > 0 && (
        <div className="border-t border-slate-100 p-4 space-y-1.5 bg-slate-50/30">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Histórico (últimos 30 dias)
          </div>
          {treated.map((p) => (
            <ProposalCard
              key={p.proposal_key}
              proposal={p}
              onAccept={() => {}}
              onDismiss={() => {}}
              onOpenDetails={() => setModalProposal(p)}
            />
          ))}
        </div>
      )}

      {/* Modal de detalhes */}
      <ProposalDetailsModal
        proposal={modalProposal}
        open={!!modalProposal}
        onClose={() => setModalProposal(null)}
        onAccept={() => modalProposal && handleAccept(modalProposal)}
        onDismiss={() => modalProposal && handleDismiss(modalProposal)}
        isAccepting={!!modalProposal && actingKey === modalProposal.proposal_key && actionType === "accept"}
        isDismissing={!!modalProposal && actingKey === modalProposal.proposal_key && actionType === "dismiss"}
      />
    </div>
  );
}
