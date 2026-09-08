"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info, Ban } from "lucide-react";
import { useGA4, useComunicacaoSpaces, type SpaceRow } from "@/lib/ga4-context";
import { DataStatus, PeriodBadge, SkeletonBlock, DataErrorCard } from "@/components/data-status";
import { CollapsibleNote, ShowMore, BotaoExportar, baixarCsv } from "@/components/ui-collapse";

/**
 * Visão compartilhada das abas Banners e Pop-ups.
 *
 * ⚠️ O QUE ESTA TELA DELIBERADAMENTE NÃO MOSTRA
 *
 * Não existe "CTR por banner" nem ranking de criativa. Auditoria de 08/09/2026
 * em todas as properties: nenhuma dimensão do GA4 identifica a criativa, porque
 * o dataLayer de banner não envia o objeto `promotion`. O identificador mais
 * fino disponível é o ESPAÇO, que vive em `sessionMedium`, e `sessionMedium` é
 * dimensão de SESSÃO: conta quem ENTROU clicando, nunca quem viu.
 *
 * Então o eixo desta tela é CLIQUE e CONVERSÃO A JUSANTE por espaço, que
 * responde melhor a pergunta de negócio do que CTR: qual espaço traz gente que
 * converte. O par exibição/clique aparece em bloco separado, só onde existe de
 * fato, e sempre com o aviso de validação.
 */

type SortKey =
  | "sessions"
  | "engagementRate"
  | "leads"
  | "leadRate"
  | "checkoutStarts"
  | "checkoutRate"
  | "purchases"
  | "purchaseRate";

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "-" : nf.format(n));
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `${n.toString().replace(".", ",")}%`;

export function SpacesView({
  kind,
  title,
  icon,
  subtitle,
}: {
  kind: "banner" | "popup";
  title: string;
  icon: React.ReactNode;
  subtitle: string;
}) {
  const { useRealData, periodLabel, customRange, days } = useGA4();
  const { data, meta, error, loading } = useComunicacaoSpaces(kind);
  const [sortKey, setSortKey] = useState<SortKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  const PASSO = 10;
  const [visiveis, setVisiveis] = useState(PASSO);

  const hasPurchase = data?.bu.conversionModel === "captacao_venda";

  const rows = useMemo(() => {
    const base = data?.spaces || [];
    const get = (r: SpaceRow, k: SortKey): number => {
      const v = r[k];
      return typeof v === "number" ? v : -1;
    };
    return [...base].sort((a, b) => {
      const d = get(a, sortKey) - get(b, sortKey);
      return sortDesc ? -d : d;
    });
  }, [data, sortKey, sortDesc]);

  const rowsVisiveis = useMemo(() => rows.slice(0, visiveis), [rows, visiveis]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      onClick={() => toggleSort(k)}
      className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] cursor-pointer select-none hover:text-[color:var(--foreground)] whitespace-nowrap"
    >
      {children}
      {sortKey === k && <span className="ml-1 text-[#7c5cff]">{sortDesc ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center">
          {icon}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <DataStatus meta={meta} usingMock={!useRealData} label="GA4" compact />
        <PeriodBadge range={customRange} days={days} compact />
      </div>
      <p className="text-sm text-[color:var(--muted-foreground)] mb-6">{subtitle}</p>

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
          <SkeletonBlock height={280} />
        </div>
      )}

      {/* B.U. bloqueada: mostra o motivo, nunca número.
          Auditoria de 08/09/2026: esta tela só tratava `error`, então a rota
          publicava 17 leads da FIIs sem nenhuma forma de a UI avisar. */}
      {useRealData && !loading && data?.blocked && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900 mb-1">
                {data.bu.label}: dado não confiável, número não publicado
              </p>
              <p className="text-sm text-amber-800 leading-relaxed">{data.blocked}</p>
            </div>
          </div>
        </div>
      )}

      {useRealData && !loading && data && !data.blocked && (
        <>
          {/* Criativas nomeadas, só onde o dataLayer de promoção está populado */}
          {data.creatives && data.creatives.rows.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 mb-4">
              <p className="font-semibold text-emerald-900 mb-1">
                Criativas nomeadas nesta B.U. ({data.creatives.coveragePct}% de cobertura)
              </p>
              <p className="text-xs text-emerald-800 mb-3">{data.creatives.note}</p>
              <div className="rounded-xl bg-white border border-emerald-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-100/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                        Promoção
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                        Criativa
                      </th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                        Sessões
                      </th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.creatives.rows.map((c, i) => (
                      <tr key={`${c.promotion}|${c.creative}|${i}`} className="border-t border-emerald-100">
                        <td className="px-3 py-2">{c.promotion}</td>
                        <td className="px-3 py-2 text-[color:var(--muted-foreground)]">{c.creative}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(c.sessions)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(c.sharePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-emerald-800 mt-2">
                {fmt(data.creatives.notSetSessions)} sessões de promoção chegaram sem nome no dataLayer e
                não aparecem nesta lista.
              </p>
            </div>
          )}

          {/* O QUE NÃO DÁ PRA MEDIR — em cima, não escondido no rodapé */}
          <CollapsibleNote
            tone="bloqueio"
            title={`O que NÃO dá para medir em ${kind === "banner" ? "banner" : "pop-up"} hoje`}
            summary={`Não há ranking de criativa individual nem CTR por espaço. ${data.limitations.length} limitações medidas. Clique para ler.`}
            badge={`${data.limitations.length} limitações`}
          >
            <div className="flex items-start gap-2.5">
              <Ban size={16} className="text-red-600 shrink-0 mt-0.5" />
              <ul className="space-y-1.5">
                {data.limitations.map((l, i) => (
                  <li key={i} className="text-xs text-red-800 leading-relaxed flex gap-1.5">
                    <span className="shrink-0">•</span>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CollapsibleNote>

          {/* KPIs */}
          {data.strategyNote && (
            <div className="rounded-2xl border border-[color:var(--border)] bg-white p-3 mb-4">
              <p className="text-xs text-[color:var(--muted-foreground)] leading-relaxed">
                <b className="text-[color:var(--foreground)]">Duas estratégias, duas métricas.</b>{" "}
                {data.strategyNote}
              </p>
            </div>
          )}

          <div
            className="grid grid-cols-2 md:grid-cols-3 lg:[grid-template-columns:repeat(var(--kpis),minmax(0,1fr))] gap-3 mb-5"
            style={{ ["--kpis" as string]: hasPurchase ? 5 : 3 }}
          >
            <Kpi label="Espaços ativos" value={fmt(data.totals.spaces)} />
            <Kpi label="Sessões geradas" value={fmt(data.totals.sessions)} sub="entraram clicando" />
            <Kpi label="Leads · estratégia A" value={fmt(data.totals.leads)} sub="captação" accent />
            {hasPurchase && (
              <Kpi
                label="Checkout · estratégia B"
                value={fmt(data.totals.checkoutStarts)}
                sub="chegou ao checkout"
                accent
              />
            )}
            {hasPurchase && <Kpi label="Compras" value={fmt(data.totals.purchases)} sub="fim do funil" />}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-[color:var(--border)] bg-white p-8 text-center">
              <p className="font-semibold mb-1">
                Nenhum espaço de {kind === "banner" ? "banner" : "pop-up"} em {data.bu.label}
              </p>
              <p className="text-sm text-[color:var(--muted-foreground)]">
                Não há sessão com <code className="text-xs bg-[color:var(--muted)] px-1 rounded">utm_medium</code> de{" "}
                {kind === "banner" ? "banner" : "pop-up"} nesta propriedade e período. Se a veiculação existe,
                falta marcar a UTM do espaço.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold">Cliques e conversão por espaço</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[color:var(--muted-foreground)]">{periodLabel}</span>
                  <BotaoExportar
                    onClick={() =>
                      baixarCsv(
                        `espacos-${kind}-${data.bu.key}-${data.range.startDate}-a-${data.range.endDate}`,
                        ["Espaco","Grafias somadas","Tipo","Sessoes","Sessoes engajadas","% engajamento","Leads (A)","% lead","Chegou ao checkout (B)","% checkout","Compras","% compra"],
                        rows.map((r) => [r.space, r.rawMediums.join(" | "), r.kind, r.sessions, r.engagedSessions, r.engagementRate, r.leads, r.leadRate, r.checkoutStarts, r.checkoutRate, r.purchases, r.purchaseRate])
                      )
                    }
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[color:var(--muted)] border-b border-[color:var(--border)]">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          Espaço
                        </th>
                        <Th k="sessions">Sessões</Th>
                        <Th k="engagementRate">% engaj.</Th>
                        <Th k="leads">Leads (A)</Th>
                        <Th k="leadRate">% lead</Th>
                        {hasPurchase && (
                          <>
                            <Th k="checkoutStarts">Checkout (B)</Th>
                            <Th k="checkoutRate">% checkout</Th>
                            <Th k="purchases">Compras</Th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rowsVisiveis.map((r) => (
                        <tr
                          key={r.space}
                          className="border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--muted)]/40"
                        >
                          <td className="px-3 py-2.5">
                            <span className="font-medium">{r.space}</span>
                            {r.rawMediums.length > 1 && (
                              <span
                                className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold"
                                title={`Grafias somadas nesta linha: ${r.rawMediums.join(", ")}`}
                              >
                                {r.rawMediums.length} grafias
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(r.sessions)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.engagementRate)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                            {fmt(r.leads)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.leadRate)}</td>
                          {hasPurchase && (
                            <>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#7c5cff]">
                                {fmt(r.checkoutStarts)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.checkoutRate)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted-foreground)]">
                                {fmt(r.purchases)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ShowMore
                  shown={rowsVisiveis.length}
                  total={rows.length}
                  step={PASSO}
                  onShowMore={() => setVisiveis((v) => v + PASSO)}
                  onShowAll={() => setVisiveis(rows.length)}
                  onReset={() => setVisiveis(PASSO)}
                />
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mt-3 leading-relaxed">
                Leitura: <b>Leads (A)</b> e <b>Checkout (B)</b> são as duas estratégias, e cada
                espaço deve ser cobrado pela que ele serve. Espaço que manda gente para LP de captação
                não converte em checkout, e isso não é falha dele. A coluna Sessões é o CLIQUE, porque
                uma sessão com esse <code>utm_medium</code> é uma sessão que entrou por aquele espaço. Não existe contagem de
                exibição nesse eixo, por isso não há CTR aqui. Ordene por % lead ou % compra para achar o
                espaço que traz gente que converte, não só volume.
              </p>
            </>
          )}

          {/* Par exibição/clique, só onde existe */}
          {data.impressions && (
            <div className="mt-8">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h2 className="font-bold">Exibição e clique por página · {data.impressions.label}</h2>
                <code className="text-[10px] bg-[color:var(--muted)] px-1.5 py-0.5 rounded">
                  {data.impressions.viewEvent} / {data.impressions.clickEvent}
                </code>
              </div>

              {data.impressions.warning && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-amber-900 mb-1">
                        CTR não confiável nesta fonte. Não use como meta.
                      </p>
                      <p className="text-xs text-amber-800 leading-relaxed">{data.impressions.warning}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[color:var(--border)] bg-white overflow-hidden">
                <div className="overflow-x-auto max-h-[520px]">
                  <table className="w-full text-sm">
                    <thead className="bg-[color:var(--muted)] border-b border-[color:var(--border)] sticky top-0">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          Página
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          Exibições
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          Cliques
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          Razão
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.impressions.pages.map((p) => (
                        <tr
                          key={p.path}
                          className="border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--muted)]/40"
                        >
                          <td className="px-3 py-2 max-w-[420px] truncate" title={p.path}>
                            {p.path}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(p.views)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(p.clicks)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {p.implausible ? (
                              <span
                                className="text-red-600 font-bold"
                                title="Mais cliques que exibições: impossível num funil saudável. É defeito de disparo, não desempenho."
                              >
                                {pct(p.ctr)} ⚠
                              </span>
                            ) : (
                              pct(p.ctr)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mt-2">
                Linhas marcadas com ⚠ têm mais clique que exibição, o que é impossível. Trate como defeito
                de medição, não como desempenho.
              </p>
            </div>
          )}

          {data.caveats.length > 0 && (
            <div className="mt-6 rounded-2xl border border-[color:var(--border)] bg-white p-4">
              <div className="flex items-start gap-2.5">
                <Info size={15} className="text-[#7c5cff] shrink-0 mt-0.5" />
                <ul className="space-y-1">
                  {data.caveats.map((c, i) => (
                    <li key={i} className="text-xs text-[color:var(--muted-foreground)]">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </main>
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
