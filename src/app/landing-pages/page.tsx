"use client";

import { useMemo, useState } from "react";
import { FileText, AlertTriangle, Info, ExternalLink, Search } from "lucide-react";
import { useGA4, useLPPerformance, type LPPerfRow } from "@/lib/ga4-context";
import { DataStatus, PeriodBadge, SkeletonBlock, DataErrorCard } from "@/components/data-status";
import { clarityLinksFor } from "@/lib/clarity";
import { LPChannelComparator } from "@/components/lp-channel-comparator";
import { CollapsibleNote, ShowMore, BotaoExportar, baixarCsv } from "@/components/ui-collapse";

/**
 * /landing-pages — desempenho de LP com a regra de conversão da B.U.
 *
 * Substitui a aba "Páginas", que misturava landing page com artigo do portal e
 * com área logada, e por isso ninguém usava.
 *
 * A regra de cada B.U. vem de src/lib/bu.ts, aplicada no servidor. Esta tela
 * não decide o que é lead: ela mostra o que a regra devolveu e DECLARA a
 * procedência do número (coluna "origem do lead"), porque na Consultoria o
 * generate_lead está duplicado e o lead real vem da soma dos MQLs.
 */

type SortKey =
  | "sessions"
  | "engagedSessions"
  | "engagementRate"
  | "leads"
  | "connectRate"
  | "qualified"
  | "qualificationRate"
  | "ctaClicks"
  | "checkoutStarts"
  | "purchases";

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : nf.format(n));
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `${n.toString().replace(".", ",")}%`;

const LEAD_SOURCE_LABEL: Record<string, string> = {
  mql: "soma dos MQLs",
  evento_bruto: "generate_lead",
  evento_dividido: "generate_lead ÷ 2",
  indisponivel: "não medido",
};

export default function LandingPagesPage() {
  const { useRealData, selected, periodLabel, customRange, days } = useGA4();
  const [assetOnly, setAssetOnly] = useState(false);
  const { data, meta, error, loading } = useLPPerformance(assetOnly ? "/asset/" : "");

  // Aceita ?q= vindo do copiloto ("abrir a LP X"). Lido de window em vez de
  // useSearchParams para não exigir Suspense boundary no build.
  const [q, setQ] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [objFilter, setObjFilter] = useState<"todos" | "captacao" | "venda" | "indefinido" | "alarme">("todos");
  const [sortKey, setSortKey] = useState<SortKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  // Tabela carrega 10 linhas e expande por clique. Pedido do Renan: a lista
  // completa empurrava tudo para baixo da dobra.
  const PASSO = 10;
  const [visiveis, setVisiveis] = useState(PASSO);

  const isMQL = data?.bu.conversionModel === "mql";
  const hasCta = Boolean(data?.bu.ctaEvent);
  const isResearch = data?.bu.key === "research" || data?.bu.key === "asset";
  // Quantidade de KPIs muda por B.U. (MQL tem 6, venda tem 7). A grade recebe o
  // número como CSS var para caber tudo numa linha só em telas largas, em vez
  // de quebrar o último card sozinho embaixo.
  const nKpis = 4 + (isMQL ? 2 : 1 + (hasCta ? 1 : 0) + (data?.totals?.checkoutStarts !== null && data?.totals?.checkoutStarts !== undefined ? 1 : 0));

  const rows = useMemo(() => {
    const base = data?.rows || [];
    const needle = q.trim().toLowerCase();
    let filtered = needle ? base.filter((r) => r.path.toLowerCase().includes(needle)) : base;
    if (objFilter === "alarme") filtered = filtered.filter((r) => r.mismatch);
    else if (objFilter !== "todos") filtered = filtered.filter((r) => r.objective === objFilter);
    const get = (r: LPPerfRow, k: SortKey): number => {
      const v = r[k];
      return typeof v === "number" ? v : -1;
    };
    return [...filtered].sort((a, b) => {
      const d = get(a, sortKey) - get(b, sortKey);
      return sortDesc ? -d : d;
    });
  }, [data, q, objFilter, sortKey, sortDesc]);

  // Volta para 10 sempre que o recorte muda, senão o usuário fica com uma
  // janela grande herdada de outro filtro e acha que a lista é maior.
  const rowsVisiveis = useMemo(() => rows.slice(0, visiveis), [rows, visiveis]);
  const resetPaginacao = () => setVisiveis(PASSO);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const Th = ({ k, children, align = "right" }: { k: SortKey; children: React.ReactNode; align?: "left" | "right" }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2.5 text-${align} text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] cursor-pointer select-none hover:text-[color:var(--foreground)] whitespace-nowrap`}
      title="Ordenar"
    >
      {children}
      {sortKey === k && <span className="ml-1 text-[#7c5cff]">{sortDesc ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center">
          <FileText size={20} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Landing Pages</h1>
        <DataStatus meta={meta} usingMock={!useRealData} label="GA4" compact />
        <PeriodBadge range={customRange} days={days} compact />
      </div>
      <p className="text-sm text-[color:var(--muted-foreground)] mb-6">
        Desempenho por LP com a regra de conversão da B.U. Só hosts de landing page, sem portal e sem
        área logada. Thank Pages excluídas.
      </p>

      {/* ZERO MOCK: sem GA4, não inventa */}
      {!useRealData && (
        <div className="rounded-2xl border-2 border-dashed border-[color:var(--border)] p-8 text-center">
          <p className="font-semibold mb-1">Sem conexão com o GA4</p>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Selecione uma propriedade no seletor acima. Este painel não exibe dados de exemplo.
          </p>
        </div>
      )}

      {useRealData && error && <DataErrorCard meta={meta} error={error} />}

      {useRealData && loading && (
        <div className="space-y-3">
          <SkeletonBlock height={92} />
          <SkeletonBlock height={340} />
        </div>
      )}

      {/* B.U. sem dado confiável: mostra o motivo, não número */}
      {useRealData && !loading && data?.blocked && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900 mb-1">
                {data.bu.label}: não há dado de landing page confiável
              </p>
              <p className="text-sm text-amber-800 leading-relaxed">{data.blocked}</p>
              <p className="text-xs text-amber-700 mt-3">
                Esta aba prefere estado vazio a número que não sustenta. O texto acima é o que precisa
                ser instrumentado para a B.U. aparecer aqui.
              </p>
            </div>
          </div>
        </div>
      )}

      {useRealData && !loading && data && !data.blocked && (
        <>
          {/* Regra aplicada + ressalvas medidas — recolhido por padrão */}
          <CollapsibleNote
            title={`Regra de ${data.bu.label} e ressalvas da medição`}
            summary={`lead = ${
              isMQL ? "MQL qualificado + desqualificado" : data.bu.leadEvent
            }${hasCta ? ", CTA = cta_click, checkout = begin_checkout" : ""}. ${
              data.caveats.length
            } ressalva${data.caveats.length === 1 ? "" : "s"} medida${
              data.caveats.length === 1 ? "" : "s"
            } sobre estes números. Clique para ler.`}
            badge={`${data.caveats.length} ressalvas`}
          >
            <div className="flex items-start gap-2.5">
              <Info size={16} className="text-[#7c5cff] shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold mb-1">
                  Regra de {data.bu.label}:{" "}
                  {isMQL ? (
                    <span className="font-normal">
                      lead = <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.mqlEvents?.qualified}</code> +{" "}
                      <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.mqlEvents?.disqualified}</code>, sem checkout
                    </span>
                  ) : (
                    <span className="font-normal">
                      lead = <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.leadEvent}</code>
                      {hasCta && (
                        <>
                          , engajamento com CTA ={" "}
                          <code className="text-xs bg-[color:var(--muted)] px-1 rounded">{data.bu.ctaEvent}</code>
                          {data.checkoutAttribution && (
                            <>
                              {" "}e chegada ao checkout ={" "}
                              <code className="text-xs bg-[color:var(--muted)] px-1 rounded">
                                {data.checkoutAttribution.event}
                              </code>
                            </>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </p>
                <p className="text-xs text-[color:var(--muted-foreground)] mb-2">
                  Hosts considerados: {data.lpHosts.join(", ")}
                </p>
                {data.checkoutAttribution && (
                  <div className="rounded-xl bg-[color:var(--muted)] p-2.5 mb-2">
                    <p className="text-xs font-semibold mb-0.5">
                      Duas colunas diferentes, não confunda
                    </p>
                    <p className="text-xs text-[color:var(--muted-foreground)] leading-relaxed">
                      <b>Cliques CTA</b> é o evento <code>cta_click</code>: mede engajamento com
                      qualquer CTA, inclusive WhatsApp, download e formulário.{" "}
                      <b>Chegou ao checkout</b> é o <code>begin_checkout</code> atribuído à landing
                      page de entrada, ou seja, quem de fato abriu o checkout. É esta a coluna de
                      intenção de compra.
                    </p>
                  </div>
                )}
                {data.caveats.length > 0 && (
                  <ul className="space-y-1 mt-2">
                    {data.caveats.map((c, i) => (
                      <li key={i} className="text-xs text-[color:var(--muted-foreground)] flex gap-1.5">
                        <span className="text-amber-500">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CollapsibleNote>

          {/* KPIs */}
          {data.totals && (
            <div
              className="grid grid-cols-2 md:grid-cols-4 lg:[grid-template-columns:repeat(var(--kpis),minmax(0,1fr))] gap-3 mb-5"
              style={{ ["--kpis" as string]: nKpis }}
            >
              <Kpi label="Landing pages" value={fmt(data.totals.landingPages)} />
              <Kpi label="Sessões" value={fmt(data.totals.sessions)} />
              <Kpi
                label="Sessões engajadas"
                value={fmt(data.totals.engagedSessions)}
                sub={pct(data.totals.engagementRate)}
              />
              <Kpi
                label="Leads"
                value={fmt(data.totals.leads)}
                sub={LEAD_SOURCE_LABEL[data.rows[0]?.leadsSource || "indisponivel"]}
              />
              {isMQL ? (
                <>
                  <Kpi label="MQL (qualificados)" value={fmt(data.totals.qualified)} accent />
                  <Kpi
                    label="Taxa de qualificação"
                    value={pct(data.totals.qualificationRate)}
                    sub="MQL ÷ leads"
                    accent
                  />
                </>
              ) : (
                <>
                  <Kpi label="Connect rate" value={pct(data.totals.connectRate)} sub="leads ÷ sessões" />
                  {hasCta && (
                    <Kpi
                      label="Cliques em CTA"
                      value={fmt(data.totals.ctaClicks)}
                      sub={`${pct(data.totals.ctaRate)} · todos os CTAs`}
                    />
                  )}
                  {data.totals.checkoutStarts !== null && (
                    <Kpi
                      label="Chegou ao checkout"
                      value={fmt(data.totals.checkoutStarts)}
                      sub={`${pct(data.totals.checkoutRate)} · begin_checkout`}
                      accent
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* REGRA DE OBJETIVO — o padrão da URL diz qual métrica cobrar */}
          {data.objectiveSummary && (
            <div className="rounded-2xl border border-[color:var(--border)] bg-white p-4 mb-5">
              <p className="font-semibold text-sm mb-2">
                Objetivo da LP define a conversão{" "}
                <span className="font-normal text-xs text-[color:var(--muted-foreground)]">
                  (regra universal Suno: o padrão da URL diz qual é)
                </span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-[color:var(--border)] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    Estratégia A · Captação de lead
                  </p>
                  <p className="text-xs text-[color:var(--muted-foreground)] mb-1.5">
                    Conversão = <code className="bg-[color:var(--muted)] px-1 rounded">generate_lead</code> ·
                    /cl/ /lm/ /ebook- /minicurso- /planilha- /whatsapp- /lista-vip-
                  </p>
                  <p className="text-sm">
                    <b className="text-lg tabular-nums">{data.objectiveSummary.captacao}</b> LPs ·{" "}
                    <b className="tabular-nums">{fmt(data.objectiveSummary.leadsDeCaptacao)}</b> leads em{" "}
                    {fmt(data.objectiveSummary.sessoesDeCaptacao)} sessões
                    {data.objectiveSummary.sessoesDeCaptacao > 0 && (
                      <>
                        {" "}
                        ({pct(
                          Number(
                            (
                              (data.objectiveSummary.leadsDeCaptacao /
                                data.objectiveSummary.sessoesDeCaptacao) *
                              100
                            ).toFixed(2)
                          )
                        )})
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    Estratégia B · Venda direta
                  </p>
                  <p className="text-xs text-[color:var(--muted-foreground)] mb-1.5">
                    Conversão = levar ao checkout · /pv/ /nossas-assinaturas /planos- /combo- /integracao-
                    /especial-
                  </p>
                  <p className="text-sm">
                    <b className="text-lg tabular-nums">{data.objectiveSummary.venda}</b> LPs ·{" "}
                    <b className="tabular-nums">{fmt(data.objectiveSummary.checkoutDeVenda)}</b> chegadas ao
                    checkout em {fmt(data.objectiveSummary.sessoesDeVenda)} sessões
                    {data.objectiveSummary.sessoesDeVenda > 0 && (
                      <>
                        {" "}
                        ({pct(
                          Number(
                            (
                              (data.objectiveSummary.checkoutDeVenda /
                                data.objectiveSummary.sessoesDeVenda) *
                              100
                            ).toFixed(2)
                          )
                        )})
                      </>
                    )}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mt-2.5">
                {data.objectiveSummary.indefinido} LP{data.objectiveSummary.indefinido === 1 ? "" : "s"} com
                padrão fora da lista oficial ficam sem métrica primária eleita, e a tabela mostra as duas.
                {data.objectiveSummary.inferidoPorDado > 0 && (
                  <> {data.objectiveSummary.inferidoPorDado} foram desambiguadas pelo dado (o /ao/ só é captação quando tem formulário).</>
                )}
                {data.objectiveSummary.comAlarme > 0 && (
                  <>
                    {" "}
                    <b className="text-red-600">
                      {data.objectiveSummary.comAlarme} LP{data.objectiveSummary.comAlarme === 1 ? "" : "s"} com
                      objetivo declarado e conversão zerada.
                    </b>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  resetPaginacao();
                }}
                placeholder="Filtrar por caminho da LP"
                className="pl-8 pr-3 py-2 text-sm rounded-xl border border-[color:var(--border)] bg-white w-[280px] outline-none focus:border-[#7c5cff]"
              />
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-[color:var(--border)] bg-white p-0.5">
              {([
                ["todos", "Todas"],
                ["captacao", "Captação"],
                ["venda", "Venda"],
                ["indefinido", "Indefinido"],
                ["alarme", "⚠ Alarme"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => {
                    setObjFilter(k);
                    resetPaginacao();
                  }}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition ${
                    objFilter === k
                      ? k === "alarme"
                        ? "bg-red-100 text-red-700"
                        : "bg-[#ede9fe] text-[#7c5cff]"
                      : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {isResearch && (
              <button
                onClick={() => setAssetOnly((v) => !v)}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition ${
                  assetOnly
                    ? "bg-[#ede9fe] border-[#7c5cff] text-[#7c5cff]"
                    : "bg-white border-[color:var(--border)] text-[color:var(--muted-foreground)]"
                }`}
                title="O Suno Asset não tem property GA4 própria: vive dentro da Research em /asset/*"
              >
                Só Suno Asset (/asset/)
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-[color:var(--muted-foreground)]">
                {rows.length} LP{rows.length === 1 ? "" : "s"} · {periodLabel}
              </span>
              <BotaoExportar
                onClick={() =>
                  baixarCsv(
                    `lps-${data.bu.key}-${data.range.startDate}-a-${data.range.endDate}`,
                    [
                      "Landing page",
                      "Host",
                      "Objetivo",
                      "Origem do objetivo",
                      "Sessoes",
                      "Sessoes engajadas",
                      "% engajamento",
                      "Leads",
                      "Origem do lead",
                      "MQL",
                      "% qualificacao",
                      "Cliques CTA",
                      "Chegou ao checkout",
                      "% checkout",
                      "Compras",
                      "% da meta",
                      "% rejeicao",
                      "Alarme",
                    ],
                    // Exporta a lista FILTRADA inteira, não só as linhas visíveis.
                    rows.map((r) => [
                      r.path,
                      r.host,
                      r.objective,
                      r.objectiveFrom,
                      r.sessions,
                      r.engagedSessions,
                      r.engagementRate,
                      r.leads,
                      r.leadsSource,
                      r.qualified,
                      r.qualificationRate,
                      r.ctaClicks,
                      r.checkoutStarts,
                      r.checkoutRate,
                      r.purchases,
                      r.primaryRate,
                      r.bounceRate,
                      r.mismatch,
                    ])
                  )
                }
              />
            </div>
          </div>

          {/* Tabela */}
          <div className="rounded-2xl border border-[color:var(--border)] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--muted)] border-b border-[color:var(--border)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Landing page
                    </th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Objetivo
                    </th>
                    <Th k="sessions">Sessões</Th>
                    <Th k="engagedSessions">Engajadas</Th>
                    <Th k="engagementRate">% engaj.</Th>
                    <Th k="leads">Leads</Th>
                    {isMQL ? (
                      <>
                        <Th k="qualified">MQL</Th>
                        <Th k="qualificationRate">% qualif.</Th>
                      </>
                    ) : (
                      <Th k="connectRate">Connect Rate</Th>
                    )}
                    {hasCta && (
                      <>
                        <Th k="ctaClicks">Cliques CTA</Th>
                        <Th k="checkoutStarts">Chegou checkout</Th>
                        <Th k="purchases">Compras</Th>
                      </>
                    )}
                    <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Clarity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-3 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
                        Nenhuma landing page com sessão neste período.
                      </td>
                    </tr>
                  )}
                  {rowsVisiveis.map((r) => {
                    const cl = clarityLinksFor(selected?.displayName || "", r.path);
                    return (
                      <tr key={r.url} className="border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--muted)]/40">
                        <td className="px-3 py-2.5 max-w-[340px]">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-[#7c5cff] flex items-center gap-1 truncate"
                            title={r.url}
                          >
                            <span className="truncate">{r.path}</span>
                            <ExternalLink size={11} className="shrink-0 opacity-40" />
                          </a>
                          <span className="text-[10px] text-[color:var(--muted-foreground)]">{r.host}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <ObjectiveBadge row={r} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.sessions)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.engagedSessions)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.engagementRate)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(r.leads)}</td>
                        {isMQL ? (
                          <>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#7c5cff]">
                              {fmt(r.qualified)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {r.qualificationRate !== null ? (
                                <span
                                  className={
                                    r.qualificationRate >= 60
                                      ? "text-emerald-600 font-semibold"
                                      : r.qualificationRate < 35
                                        ? "text-red-600 font-semibold"
                                        : ""
                                  }
                                >
                                  {pct(r.qualificationRate)}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.connectRate)}</td>
                        )}
                        {hasCta && (
                          <>
                            <td
                              className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted-foreground)]"
                              title="Todos os cliques em CTA da LP, incluindo WhatsApp, download e formulário. Não é só checkout."
                            >
                              {fmt(r.ctaClicks)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#7c5cff]">
                              {fmt(r.checkoutStarts)}
                            </td>
                            <td
                              className="px-3 py-2.5 text-right tabular-nums font-bold"
                              title="Compras atribuídas à sessão que ENTROU por esta LP. É influência de última sessão: compra feita numa sessão posterior é creditada à LP daquela sessão. Piso de influência, não total."
                            >
                              {r.purchases ? (
                                <span className="text-emerald-700">{fmt(r.purchases)}</span>
                              ) : (
                                <span className="text-[color:var(--muted-foreground)] font-normal">0</span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2.5 text-center">
                          {cl.heatmaps ? (
                            <a
                              href={cl.heatmaps}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#7c5cff] hover:underline"
                              title={cl.filterHint}
                            >
                              mapa
                            </a>
                          ) : (
                            <span className="text-xs text-[color:var(--muted-foreground)]">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ShowMore
              shown={rowsVisiveis.length}
              total={rows.length}
              step={PASSO}
              onShowMore={() => setVisiveis((v) => v + PASSO)}
              onShowAll={() => setVisiveis(rows.length)}
              onReset={resetPaginacao}
            />
          </div>

          {data.meta?.truncated && (
            <p className="text-xs text-amber-700 mt-3">
              A consulta bateu o limite de linhas: existem mais landing pages do que as exibidas. Reduza o
              período ou use o filtro de caminho para ver a cauda.
            </p>
          )}

          {/* Comparador LP x canal — componente que já existia na aba Páginas.
              Semeado com as 3 LPs de maior volume para abrir útil. */}
          {rows.length > 0 && (
            <div className="mt-8">
              <h2 className="font-bold mb-3">Comparar LP por canal de origem</h2>
              <LPChannelComparator initialUrls={rows.slice(0, 3).map((r) => r.url)} />
            </div>
          )}

          <p className="text-[11px] text-[color:var(--muted-foreground)] mt-4 leading-relaxed">
            Nota metodológica: a sessão é atribuída à página de ENTRADA
            (<code>landingPagePlusQueryString</code>), não a qualquer página vista. Por isso o total desta
            aba não fecha com o total de sessões da propriedade, e é assim que deve ser: o denominador de
            conversão de LP é quem entrou por ela.
          </p>
        </>
      )}
    </main>
  );
}

/**
 * Badge de objetivo da LP.
 *
 * Regra universal Suno: o padrão da URL declara o objetivo, e o objetivo declara
 * qual evento é a conversão. Mostrar as duas métricas com o mesmo peso para toda
 * LP era o que confundia captação com venda.
 */
function ObjectiveBadge({ row }: { row: LPPerfRow }) {
  const map = {
    captacao: { label: "Captação", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    venda: { label: "Venda", cls: "bg-[#ede9fe] text-[#7c5cff] border-[#7c5cff]/30" },
    indefinido: {
      label: "Indefinido",
      cls: "bg-[color:var(--muted)] text-[color:var(--muted-foreground)] border-[color:var(--border)]",
    },
  } as const;
  const m = map[row.objective];
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${m.cls}`}
        title={
          row.objectiveFrom === "url"
            ? "Objetivo declarado pelo padrão da URL."
            : row.objectiveFrom === "dado"
              ? "Padrão da URL não é conclusivo (ex: /ao/). Objetivo inferido pelo dado: registra generate_lead, então tem formulário."
              : "Padrão da URL fora da lista oficial. Nenhuma métrica foi eleita como meta."
        }
      >
        {m.label}
        {row.objectiveFrom === "dado" && <span className="opacity-60"> ·dado</span>}
      </span>
      {row.mismatch && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 cursor-help"
          title={row.mismatch}
        >
          ⚠
        </span>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border p-4 ${
        accent ? "border-[#7c5cff]/40 ring-1 ring-[#7c5cff]/10" : "border-[color:var(--border)]"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-[#7c5cff]" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}
