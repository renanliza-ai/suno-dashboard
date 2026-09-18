"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Info, Ban } from "lucide-react";
import { useGA4, useComunicacaoSpaces, type SpaceRow } from "@/lib/ga4-context";
import { DataStatus, PeriodBadge, SkeletonBlock, DataErrorCard } from "@/components/data-status";
import { CollapsibleNote, ShowMore, BotaoExportar, baixarCsv } from "@/components/ui-collapse";
import { avaliarTrafego, chaveDaPeca } from "@/lib/trafego-suspeito";

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
  | "accounts"
  | "checkoutStarts"
  | "purchases";

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
  const { useRealData, selected, periodLabel, customRange, days } = useGA4();
  const { data, meta, error, loading } = useComunicacaoSpaces(kind);
  const [sortKey, setSortKey] = useState<SortKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);
  const PASSO = 10;
  const [visiveis, setVisiveis] = useState(PASSO);

  const hasPurchase = data?.bu.conversionModel === "captacao_venda";
  // Só mostra a coluna de conta criada onde o evento existe de verdade na
  // property. Coluna zerada por ausência de evento parece desempenho ruim.
  const temConta = Boolean(data?.eventos?.contaCriada);

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

  /**
   * Tráfego inválido. NÃO altera número nenhum: o KPI segue mostrando o que o
   * GA4 devolveu, e isto só marca o que não deveria ser lido como audiência.
   */
  const trafego = useMemo(() => avaliarTrafego(rows), [rows]);

  /**
   * ESPAÇO EXPANDIDO (11/09/2026).
   *
   * O grão por peça resolveu a leitura individual mas criou um problema novo:
   * as 33 peças do banner.home ficam espalhadas pela ordenação global e pela
   * paginação de 10 em 10, então o badge "33 peças" prometia uma informação
   * que a tela não entregava. Clicar na linha agora abre o espaço INTEIRO.
   *
   * Tudo client-side de propósito: a rota já devolve todas as peças, então
   * abrir o detalhe não custa uma ida ao GA4.
   */
  const [espacoAberto, setEspacoAberto] = useState<string | null>(null);

  /** espaço -> todas as peças dele, já ordenadas por clique. */
  const pecasPorEspaco = useMemo(() => {
    const m = new Map<string, SpaceRow[]>();
    for (const r of data?.spaces || []) {
      const arr = m.get(r.space) || [];
      arr.push(r);
      m.set(r.space, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.sessions - a.sessions);
    return m;
  }, [data]);

  /** Soma do espaço, para o cabeçalho do detalhe. */
  const totalDoEspaco = (espaco: string) => {
    const arr = pecasPorEspaco.get(espaco) || [];
    return arr.reduce(
      (acc, r) => ({
        pecas: acc.pecas + 1,
        sessions: acc.sessions + r.sessions,
        engaged: acc.engaged + r.engagedSessions,
        leads: acc.leads + r.leads,
        accounts: acc.accounts + (r.accounts || 0),
        checkoutStarts: acc.checkoutStarts + (r.checkoutStarts || 0),
        ctaClicksAll: acc.ctaClicksAll + (r.ctaClicksAll || 0),
        purchases: acc.purchases + (r.purchases || 0),
      }),
      { pecas: 0, sessions: 0, engaged: 0, leads: 0, accounts: 0, checkoutStarts: 0, ctaClicksAll: 0, purchases: 0 }
    );
  };

  /** Colunas da tabela, para o colSpan do painel de detalhe não desalinhar. */
  const totalColunas = 5 + (temConta ? 1 : 0) + (hasPurchase ? 2 : 0);

  /**
   * Âncora do painel: a PRIMEIRA linha visível de cada espaço.
   *
   * Sem isso, um espaço que aparece em duas linhas visíveis (banner.leadmagnet
   * .home aparece duas vezes no topo, por exemplo) renderizaria o painel de
   * detalhe DUAS vezes, com o mesmo conteúdo, uma embaixo de cada linha.
   */
  const ancoraDoEspaco = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rowsVisiveis) {
      if (!m.has(r.space)) m.set(r.space, r.bannerName);
    }
    return m;
  }, [rowsVisiveis]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((v) => !v);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const Th = ({ k, children, hint }: { k: SortKey; children: React.ReactNode; hint?: string }) => (
    <th
      onClick={() => toggleSort(k)}
      title={hint}
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
            style={{ ["--kpis" as string]: 3 + (temConta ? 1 : 0) + (hasPurchase ? 2 : 0) }}
          >
            <Kpi
              label="Espaços ativos"
              value={fmt(data.totals.spaces)}
              sub={data.totals.pecas ? `${nf.format(data.totals.pecas)} peças` : undefined}
            />
            <Kpi label="Cliques" value={fmt(data.totals.sessions)} sub="entraram clicando" />
            <Kpi label="Leads" value={fmt(data.totals.leads)} sub="generate_lead" accent />
            {temConta && (
              <Kpi
                label="Conta criada"
                value={fmt(data.totals.accounts)}
                sub={data.eventos?.contaCriada || undefined}
                accent
              />
            )}
            {hasPurchase && (
              <Kpi
                label="Checkout"
                value={fmt(data.totals.checkoutStarts)}
                sub="chegou ao checkout"
                accent
              />
            )}
            {hasPurchase && <Kpi label="Compras" value={fmt(data.totals.purchases)} sub="fim do funil" />}
          </div>

          {/* Tráfego inválido: vem ANTES da integridade porque, quando aparece,
              é o fato mais importante da tela. Em 18/09/2026 duas peças
              responderam por 80% dos cliques da Research com 5% a 8% de
              engajamento e zero conversão, e o KPI de 969.794 foi lido como
              resultado de banner. */}
          {trafego.suspeitas.size > 0 && (
            <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-red-900 mb-1">
                    {trafego.pctSuspeito}% dos cliques desta janela têm sinal de tráfego inválido
                  </p>
                  <p className="text-xs text-red-800 leading-relaxed mb-2">
                    {trafego.suspeitas.size === 1 ? "Uma peça concentra" : `${trafego.suspeitas.size} peças concentram`}{" "}
                    <b>{fmt(trafego.sessoesSuspeitas)}</b> dos {fmt(trafego.sessoesTotais)} cliques, com
                    engajamento muito abaixo do resto e nenhuma conversão. Descontando{" "}
                    {trafego.suspeitas.size === 1 ? "ela" : "elas"}, o volume real da janela fica perto de{" "}
                    <b>{fmt(trafego.sessoesLimpas)}</b> cliques.
                  </p>
                  <ul className="space-y-1.5">
                    {Array.from(trafego.suspeitas.values()).map((s) => (
                      <li key={s.chave} className="text-[11px] text-red-900 bg-white/60 rounded-lg px-2.5 py-1.5">
                        <b className="font-mono">{s.chave.replace("||", " · ")}</b>
                        <br />
                        {s.motivo}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-red-700 mt-2 leading-relaxed">
                    Os números acima e na tabela seguem como o GA4 os entregou: nada foi descontado. O
                    aviso marca o que não deve ser lido como audiência, e a decisão de excluir é sua.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Integridade da quebra por peça. Só aparece quando NÃO fecha: se a
              soma das peças perder sessão para corte de linha do GA4, a tela
              diz quanto, em vez de mostrar uma tabela silenciosamente menor. */}
          {data.integridade && !data.integridade.fecha && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 mb-4">
              <p className="text-xs text-amber-900 leading-relaxed">
                <b>A quebra por peça não fecha com o total por espaço.</b> Os espaços somam{" "}
                {fmt(data.integridade.sessoesPorEspaco)} cliques e a soma das peças dá{" "}
                {fmt(data.integridade.sessoesPorPeca)}, diferença de{" "}
                {fmt(Math.abs(data.integridade.diferenca))}. Isso é corte de linha na API do GA4, não
                queda de tráfego. Use o total do KPI como número oficial e a tabela para ranquear.
              </p>
            </div>
          )}

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
                <h2 className="font-bold">Desempenho por peça</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[color:var(--muted-foreground)]">{periodLabel}</span>
                  <BotaoExportar
                    onClick={() =>
                      baixarCsv(
                        `pecas-${kind}-${data.bu.key}-${data.range.startDate}-a-${data.range.endDate}`,
                        ["Suspeita de trafego invalido","Espaco","Nome da peca","Tem nome","% do espaco","Pecas no espaco","Grafias somadas","Tipo","Cliques","Sessoes engajadas","% engajamento","Leads","Conta criada","Chegou ao checkout","Cliques de CTA (todos os destinos)","Compras"],
                        rows.map((r) => [trafego.suspeitas.has(chaveDaPeca(r.space, r.bannerName)) ? "SIM" : "nao", r.space, r.bannerName, r.named ? "sim" : "nao", r.sharePct, r.pecasNoEspaco, r.rawMediums.join(" | "), r.kind, r.sessions, r.engagedSessions, r.engagementRate, r.leads, r.accounts, r.checkoutStarts, r.ctaClicksAll, r.purchases]),
                        // Carimbo de conta em toda linha: o arquivo passa a dizer
                        // sozinho de qual property ele veio, sem depender do nome.
                        {
                          property: selected?.displayName || "(não identificada)",
                          propertyId: selected?.id || "-",
                          bu: data.bu.label,
                          periodo: `${data.range.startDate} a ${data.range.endDate}`,
                        }
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
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          <span
                            className="cursor-help"
                            title={data.bannerNameNote || "Nome da peça que roda neste espaço."}
                          >
                            Nome do {kind === "banner" ? "banner" : "pop-up"}
                            {data.bannerNameSource === "campaign" && (
                              <span className="ml-1 normal-case font-normal text-amber-600">(campanha)</span>
                            )}
                          </span>
                        </th>
                        <Th k="sessions" hint="Sessões que entraram por este espaço com esta peça. É o clique que levou para a LP: quem clicou e não carregou a página não entra.">
                          Cliques
                        </Th>
                        <Th k="engagementRate" hint="Sessões engajadas sobre cliques.">
                          % engaj.
                        </Th>
                        <Th k="leads" hint={`Captação de lead. Evento ${data.eventos?.leads || "generate_lead"}.`}>
                          Leads
                        </Th>
                        {temConta && (
                          <Th k="accounts" hint={`Evento ${data.eventos?.contaCriada || "lead_create_account"}.`}>
                            Conta criada
                          </Th>
                        )}
                        {hasPurchase && (
                          <>
                            <Th
                              k="checkoutStarts"
                              hint={
                                data.eventos?.ctaClickObservacao ||
                                "Chegada ao checkout (begin_checkout)."
                              }
                            >
                              Checkout
                            </Th>
                            <Th k="purchases" hint="Evento purchase na sessão que entrou por esta peça.">
                              Compras
                            </Th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rowsVisiveis.map((r) => {
                        const suspeita = trafego.suspeitas.get(chaveDaPeca(r.space, r.bannerName));
                        return (
                        <Fragment key={`${r.space}||${r.bannerName}`}>
                        <tr
                          onClick={() => setEspacoAberto((v) => (v === r.space ? null : r.space))}
                          title={suspeita ? suspeita.motivo : `Ver as ${r.pecasNoEspaco} peças de ${r.space}`}
                          className={`border-b border-[color:var(--border)] last:border-0 cursor-pointer ${
                            suspeita
                              ? "bg-red-50/70 hover:bg-red-50"
                              : espacoAberto === r.space
                              ? "bg-[#7c5cff]/[0.06]"
                              : "hover:bg-[color:var(--muted)]/40"
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block mr-1.5 text-[10px] text-[color:var(--muted-foreground)] transition-transform ${
                                espacoAberto === r.space ? "rotate-90" : ""
                              }`}
                            >
                              ▶
                            </span>
                            <span className="font-medium">{r.space}</span>
                            {r.pecasNoEspaco > 1 && (
                              <span
                                className="ml-2 text-[10px] text-[color:var(--muted-foreground)] underline decoration-dotted"
                                title={`Este espaço rodou ${r.pecasNoEspaco} peças distintas no período. Clique para ver todas.`}
                              >
                                {r.pecasNoEspaco} peças
                              </span>
                            )}
                            {r.rawMediums.length > 1 && (
                              <span
                                className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold"
                                title={`Grafias somadas nesta linha: ${r.rawMediums.join(", ")}`}
                              >
                                {r.rawMediums.length} grafias
                              </span>
                            )}
                          </td>
                          <PecaCell row={r} />
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                            {suspeita && (
                              <span
                                className="mr-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-600 text-white align-middle"
                                title={suspeita.motivo}
                              >
                                suspeito
                              </span>
                            )}
                            {fmt(r.sessions)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.engagementRate)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                            {fmt(r.leads)}
                          </td>
                          {temConta && (
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-sky-700">
                              {fmt(r.accounts)}
                            </td>
                          )}
                          {hasPurchase && (
                            <>
                              <td
                                className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#7c5cff]"
                                title={
                                  r.ctaClicksAll !== null
                                    ? `Chegada medida por begin_checkout. Nesta peça houve ${nf.format(r.ctaClicksAll)} cliques de CTA no total, mas o GA4 não permite separar os que iam para o checkout dos que iam para WhatsApp, download ou formulário.`
                                    : undefined
                                }
                              >
                                {fmt(r.checkoutStarts)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted-foreground)]">
                                {fmt(r.purchases)}
                              </td>
                            </>
                          )}
                        </tr>
                        {espacoAberto === r.space && ancoraDoEspaco.get(r.space) === r.bannerName && (
                          <tr className="border-b border-[color:var(--border)]">
                            <td colSpan={totalColunas} className="p-0">
                              <DetalheEspaco
                                espaco={r.space}
                                pecas={pecasPorEspaco.get(r.space) || []}
                                total={totalDoEspaco(r.space)}
                                temConta={temConta}
                                hasPurchase={hasPurchase}
                                pecaAtual={r.bannerName}
                                onFechar={() => setEspacoAberto(null)}
                              />
                            </td>
                          </tr>
                        )}
                        </Fragment>
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
                  onReset={() => setVisiveis(PASSO)}
                />
              </div>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mt-3 leading-relaxed">
Cada linha é uma <b>peça dentro de um espaço</b>, então duas peças do mesmo espaço
                aparecem separadas e dá para ver qual puxa o resultado.{" "}
                <b>Clique na linha</b> para abrir o espaço inteiro, com todas as peças dele e o total. <b>Cliques</b> é a sessão que
                entrou por aquele espaço com aquela UTM: não existe contagem de exibição nesse eixo, por
                isso não há CTR aqui.{" "}
                {data.eventos?.checkout && (
                  <>
                    <b>Checkout</b> mede <code>{data.eventos.checkout}</code>, ou seja quem CHEGOU no
                    checkout, e não o <code>cta_click</code> filtrado por destino: esse filtro não existe
                    no GA4 hoje, e o <code>cta_click</code> mistura checkout com WhatsApp, download e
                    formulário. O total bruto de cliques de CTA está no tooltip de cada linha e no CSV.
                  </>
                )}{" "}
                Espaço que manda gente para LP de captação não converte em checkout, e isso não é falha
                dele: cobre cada peça pela estratégia que ela serve.
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

/**
 * Painel do espaço inteiro, aberto ao clicar na linha.
 *
 * Existe porque o grão por peça, sozinho, quebrou a leitura de ESPAÇO: as 33
 * peças do banner.home ficam espalhadas pela ordenação global e pela paginação,
 * então o badge "33 peças" prometia algo que a tela não mostrava.
 *
 * Aqui o espaço aparece fechado: o total dele, todas as peças ordenadas por
 * clique, e o peso de cada uma. A peça da linha clicada fica destacada para não
 * perder a referência de onde a pessoa veio.
 */
function DetalheEspaco({
  espaco,
  pecas,
  total,
  temConta,
  hasPurchase,
  pecaAtual,
  onFechar,
}: {
  espaco: string;
  pecas: SpaceRow[];
  total: {
    pecas: number; sessions: number; engaged: number; leads: number;
    accounts: number; checkoutStarts: number; ctaClicksAll: number; purchases: number;
  };
  temConta: boolean;
  hasPurchase: boolean;
  pecaAtual: string;
  onFechar: () => void;
}) {
  const engajTotal = total.sessions > 0 ? Number(((total.engaged / total.sessions) * 100).toFixed(1)) : null;
  // Quanto do espaço chegou sem utm_campaign. É diagnóstico de marcação, não ruído.
  const semNome = pecas.filter((p) => !p.named).reduce((s, p) => s + p.sessions, 0);
  // União das grafias de TODAS as peças do espaço: peças diferentes podem ter
  // chegado com grafias diferentes do mesmo medium (bannergam e bannerGAM).
  const rawMediums = Array.from(new Set(pecas.flatMap((p) => p.rawMediums))).sort();
  const pctSemNome = total.sessions > 0 ? Number(((semNome / total.sessions) * 100).toFixed(1)) : 0;

  return (
    <div className="bg-[#7c5cff]/[0.04] border-t border-[#7c5cff]/20 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h3 className="font-bold text-sm">
            {espaco} · {total.pecas} peça{total.pecas === 1 ? "" : "s"} no período
          </h3>
          <p className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">
            {nf.format(total.sessions)} cliques · {pct(engajTotal)} engaj. · {nf.format(total.leads)} leads
            {temConta && <> · {nf.format(total.accounts)} contas</>}
            {hasPurchase && (
              <>
                {" "}· {nf.format(total.checkoutStarts)} checkout · {nf.format(total.purchases)} compras
              </>
            )}
            {rawMediums.length > 1 && <> · grafias somadas: {rawMediums.join(", ")}</>}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFechar();
          }}
          className="text-[11px] font-semibold text-[#7c5cff] hover:underline"
        >
          fechar
        </button>
      </div>

      {pctSemNome > 0 && (
        <p className="text-[11px] text-amber-700 mb-2">
          {pct(pctSemNome)} dos cliques deste espaço chegaram sem <code>utm_campaign</code>{" "}
          ({nf.format(semNome)}), então não dá para saber qual peça os gerou. Marcar a UTM resolve.
        </p>
      )}

      <div className="rounded-xl bg-white border border-[color:var(--border)] overflow-hidden">
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--muted)] sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  Peça
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  Cliques
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  % do espaço
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  % engaj.
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  Leads
                </th>
                {temConta && (
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    Conta criada
                  </th>
                )}
                {hasPurchase && (
                  <>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Checkout
                    </th>
                    <th
                      className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]"
                      title="Todos os cliques de CTA, de qualquer destino. O GA4 não permite isolar os que iam para o checkout."
                    >
                      Cliques CTA
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      Compras
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {pecas.map((p) => (
                <tr
                  key={p.bannerName}
                  className={`border-t border-[color:var(--border)] ${
                    p.bannerName === pecaAtual ? "bg-[#7c5cff]/[0.07]" : ""
                  }`}
                >
                  <td className="px-3 py-2 max-w-[420px]">
                    {p.named ? (
                      <span className="block text-xs truncate" title={p.bannerName}>
                        {p.bannerName}
                      </span>
                    ) : (
                      <span className="block text-xs italic text-amber-700">sem nome de campanha</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(p.sessions)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                    {pct(p.sharePct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(p.engagementRate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                    {fmt(p.leads)}
                  </td>
                  {temConta && (
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-sky-700">
                      {fmt(p.accounts)}
                    </td>
                  )}
                  {hasPurchase && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#7c5cff]">
                        {fmt(p.checkoutStarts)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                        {fmt(p.ctaClicksAll)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                        {fmt(p.purchases)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[color:var(--muted)]/60">
              <tr className="border-t-2 border-[color:var(--border)]">
                <td className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider">Total do espaço</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(total.sessions)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">100%</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(engajTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">
                  {fmt(total.leads)}
                </td>
                {temConta && (
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-sky-700">
                    {fmt(total.accounts)}
                  </td>
                )}
                {hasPurchase && (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-[#7c5cff]">
                      {fmt(total.checkoutStarts)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[color:var(--muted-foreground)]">
                      {fmt(total.ctaClicksAll)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(total.purchases)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Célula com o nome da peça. Agora cada peça é uma LINHA, então aqui não há
 * mais "dominante e o resto escondido no title": o que aparece é o nome desta
 * linha e o peso dela dentro do espaço.
 *
 * A linha sem nome de campanha é marcada visualmente em vez de escondida. Um
 * espaço cujo tráfego é quase todo "sem nome" é um espaço com UTM mal marcada,
 * e isso é informação acionável, não sujeira.
 */
function PecaCell({ row }: { row: SpaceRow }) {
  return (
    <td className="px-3 py-2.5 max-w-[300px]">
      {row.named ? (
        <span className="block text-xs font-medium truncate cursor-help" title={row.bannerName}>
          {row.bannerName}
        </span>
      ) : (
        <span
          className="block text-xs italic text-amber-700 cursor-help"
          title="Sessões que entraram por este espaço sem utm_campaign marcada. Continuam na tabela para o somatório fechar com o total do espaço, mas não há como saber qual peça as gerou."
        >
          sem nome de campanha
        </span>
      )}
      {row.sharePct !== null && (
        <span className="block text-[10px] text-[color:var(--muted-foreground)]">
          {row.sharePct.toString().replace(".", ",")}% do espaço
        </span>
      )}
    </td>
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
