"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, AlertCircle, CheckCircle2, ArrowUpRight, Activity,
  TrendingDown, Filter, ExternalLink, Lightbulb, Info, Layers,
} from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";
import { SkeletonBlock, DataErrorCard } from "@/components/data-status";

/**
 * LP Analyzer — análise focada em conversão de Landing Pages ativas
 *
 * Detecta automaticamente todas as LPs ativas (com tráfego) nos hostnames
 * configurados por propriedade (lp.*, lp2.*), pré-filtrando pelo GA4
 * server-side via inListFilter. Calcula taxa de captação de lead via
 * regra de negócio Suno: conv = generate_lead ÷ sessions (NÃO purchase,
 * porque LP Suno é captação, não checkout).
 *
 * Sugestões de melhoria são HEURÍSTICAS hardcoded baseadas em sinais:
 * bounce alto, sessão curta, scroll baixo, conv abaixo da mediana do
 * hostname. NÃO usa IA (escolha do usuário pra evitar dependência de API
 * externa). Cada heurística aponta o ângulo a investigar — não é
 * prescrição absoluta, é direção de ataque pra teste A/B.
 */

// Mapa property → hostnames de LP. Quando a property é trocada no header,
// o componente refetch automaticamente com a lista correta de hostnames.
// IMPORTANTE: o match é por substring no displayName da property (case-insensitive)
// porque o nome exato muda entre Web/Mobile/App. Ex: "Suno Research – Web" e
// "Suno Research – Mobile" ambos resolvem pra mesmo hostnameSet.
const LP_HOSTS_BY_PROPERTY: Array<{ match: string; hosts: string[]; label: string }> = [
  {
    match: "suno",
    hosts: ["lp.suno.com.br", "lp2.suno.com.br"],
    label: "LPs Suno (WordPress + GreatPages)",
  },
  {
    match: "status",
    hosts: ["lp.statusinvest.com.br", "lp2.statusinvest.com.br"],
    label: "LPs Statusinvest (WordPress + GreatPages)",
  },
];

function resolveLPHosts(propertyName: string | null | undefined): { hosts: string[]; label: string } | null {
  if (!propertyName) return null;
  const lower = propertyName.toLowerCase();
  for (const cfg of LP_HOSTS_BY_PROPERTY) {
    if (lower.includes(cfg.match)) {
      return { hosts: cfg.hosts, label: cfg.label };
    }
  }
  return null;
}

type LPRow = {
  host: string;
  path: string;
  url: string;
  users: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;
  avgSessionDuration: number;
  bounceRate: number;
  leadCount: number;
  leadConvRate: number;
};

type Diagnosis = {
  level: "ok" | "atencao" | "critico";
  signals: string[];
  suggestions: string[];
};

/**
 * Heurísticas de diagnóstico — gera sinais e sugestões por LP.
 *
 * Regras (todas baseadas em benchmarks comuns de CRO pra LP de captação):
 * - Bounce > 60% → match conteúdo × fonte
 * - Sessão < 30s → primeira dobra não convence
 * - Sessão 30-90s → dúvida no CTA
 * - Engajamento < 40% → distração ou anxiety
 * - Conv < 50% da mediana do hostname → underperformer
 * - Conv > 150% da mediana → benchmark interno (melhor LP)
 * - Sessions < 100 → volume insuficiente pra conclusão estatística
 */
function diagnose(p: LPRow, hostMedian: number): Diagnosis {
  const signals: string[] = [];
  const suggestions: string[] = [];
  let criticalCount = 0;
  let warnCount = 0;

  // Volume insuficiente
  if (p.sessions < 100) {
    signals.push(`Volume baixo (${p.sessions} sessões) — sem base estatística confiável`);
    suggestions.push("Aumentar investimento em mídia pra essa LP ou pausar se for teste");
  }

  // Bounce
  if (p.bounceRate > 0.7) {
    signals.push(`Rejeição muito alta (${(p.bounceRate * 100).toFixed(1)}%)`);
    suggestions.push("Revisar correspondência entre criativo/anúncio e hero da LP — provavelmente promessa diferente");
    criticalCount++;
  } else if (p.bounceRate > 0.55) {
    signals.push(`Rejeição alta (${(p.bounceRate * 100).toFixed(1)}%)`);
    suggestions.push("Testar nova versão do hero (headline + CTA visíveis acima da dobra)");
    warnCount++;
  }

  // Tempo
  if (p.avgSessionDuration < 30) {
    signals.push(`Sessão muito curta (${p.avgSessionDuration.toFixed(0)}s)`);
    suggestions.push("Primeira dobra não está convencendo. Revisar headline + prova social inicial");
    criticalCount++;
  } else if (p.avgSessionDuration < 90) {
    signals.push(`Sessão curta (${p.avgSessionDuration.toFixed(0)}s)`);
    suggestions.push("Usuário lê parte do conteúdo mas não chega no CTA. Mover CTA pra mais cedo ou repetir ao longo da página");
    warnCount++;
  }

  // Engajamento (engaged sessions / sessions)
  if (p.engagementRate < 0.4) {
    signals.push(`Engajamento baixo (${(p.engagementRate * 100).toFixed(1)}%)`);
    suggestions.push("Pouca interação com a página — testar variação com vídeo curto ou prova social mais forte");
    warnCount++;
  }

  // Conversão vs mediana do hostname (só se hostMedian > 0 e LP tem volume)
  if (hostMedian > 0 && p.sessions >= 100) {
    if (p.leadConvRate < hostMedian * 0.5 && p.leadConvRate >= 0) {
      signals.push(
        `Conversão ${(p.leadConvRate * 100).toFixed(2)}% — abaixo da metade da mediana do host (${(hostMedian * 100).toFixed(2)}%)`
      );
      suggestions.push(
        "Comparar formulário, CTA e proposta de valor com as melhores LPs deste mesmo host (benchmark interno)"
      );
      criticalCount++;
    } else if (p.leadConvRate > hostMedian * 1.5) {
      signals.push(
        `Conversão ${(p.leadConvRate * 100).toFixed(2)}% — 50% acima da mediana (${(hostMedian * 100).toFixed(2)}%)`
      );
      suggestions.push("Replicar elementos dessa LP nas demais (hero, CTA, copy do formulário)");
    } else if (p.leadConvRate < hostMedian * 0.75) {
      signals.push(
        `Conversão ${(p.leadConvRate * 100).toFixed(2)}% — abaixo da mediana (${(hostMedian * 100).toFixed(2)}%)`
      );
      suggestions.push("Testar variação de copy do CTA + reduzir campos do formulário");
      warnCount++;
    }
  }

  // Sem nenhum lead apesar de volume relevante
  if (p.sessions >= 500 && p.leadCount === 0) {
    signals.push(`${p.sessions} sessões e 0 leads — possível problema de tracking`);
    suggestions.push("Verificar se evento generate_lead está disparando nessa LP (testar manualmente)");
    criticalCount++;
  }

  // Se nada acionou, é saudável
  if (signals.length === 0) {
    signals.push("Performance dentro do esperado");
  }

  const level: Diagnosis["level"] =
    criticalCount >= 2 || (criticalCount >= 1 && warnCount >= 1) ? "critico" : criticalCount >= 1 || warnCount >= 2 ? "atencao" : "ok";

  return { level, signals, suggestions };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function LPAnalyzer() {
  const { selectedId, selected, useRealData, days, customRange } = useGA4();
  const [data, setData] = useState<{ pages: LPRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minSessions, setMinSessions] = useState(0);
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"sessions" | "leadConvRate" | "bounceRate">("sessions");
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);

  const lpConfig = resolveLPHosts(selected?.displayName);

  // Fetch automatica quando muda property/range. Anti race-condition: ignora
  // resposta cujo propertyId não bate com o currentSelectedId no momento do
  // settle do fetch.
  useEffect(() => {
    if (!selectedId || !useRealData || !lpConfig) {
      setData(null);
      setError(null);
      return;
    }
    const requestPropertyId = selectedId;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({
      propertyId: selectedId,
      hostsIn: lpConfig.hosts.join(","),
      leadEvent: "generate_lead",
      limit: "100",
    });
    if (customRange?.startDate && customRange?.endDate) {
      qs.set("startDate", customRange.startDate);
      qs.set("endDate", customRange.endDate);
    } else {
      qs.set("days", String(days));
    }

    fetch(`/api/ga4/landing-pages?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.propertyId && d.propertyId !== requestPropertyId) return;
        if (d.error) {
          setError(d.error);
          setData(null);
        } else {
          setData({ pages: d.pages || [] });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message || "erro ao carregar");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [selectedId, useRealData, days, customRange?.startDate, customRange?.endDate, lpConfig?.hosts.join(",")]);

  // Aplica filtros + calcula mediana por host
  const { rows, hostMedians, hostList } = useMemo(() => {
    if (!data) return { rows: [] as Array<LPRow & { diagnosis: Diagnosis }>, hostMedians: {} as Record<string, number>, hostList: [] as string[] };
    const pages = data.pages.filter((p) => p.sessions >= minSessions);
    // Hosts disponíveis (pra filtro)
    const hosts = Array.from(new Set(pages.map((p) => p.host))).sort();
    // Mediana de leadConvRate por host (só páginas com volume relevante)
    const medians: Record<string, number> = {};
    for (const h of hosts) {
      const convs = pages.filter((p) => p.host === h && p.sessions >= 100).map((p) => p.leadConvRate);
      medians[h] = median(convs);
    }
    // Filtro por host
    const filtered = hostFilter === "all" ? pages : pages.filter((p) => p.host === hostFilter);
    // Diagnóstico + ordenação
    let withDiag = filtered.map((p) => ({ ...p, diagnosis: diagnose(p, medians[p.host] || 0) }));
    if (showOnlyIssues) {
      withDiag = withDiag.filter((p) => p.diagnosis.level !== "ok");
    }
    withDiag.sort((a, b) => {
      if (sortKey === "sessions") return b.sessions - a.sessions;
      if (sortKey === "leadConvRate") return b.leadConvRate - a.leadConvRate;
      if (sortKey === "bounceRate") return b.bounceRate - a.bounceRate;
      return 0;
    });
    return { rows: withDiag, hostMedians: medians, hostList: hosts };
  }, [data, minSessions, hostFilter, sortKey, showOnlyIssues]);

  // Estado: property não tem hosts de LP configurados
  if (!lpConfig) {
    return (
      <div className="bg-white rounded-2xl border border-amber-200 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-900 mb-1">LP Analyzer — propriedade não mapeada</h3>
            <p className="text-sm text-amber-800">
              A propriedade <strong>{selected?.displayName || "(nenhuma)"}</strong> ainda não tem hostnames de LP configurados.
              Hosts conhecidos hoje: <code className="text-xs">lp.suno.com.br, lp2.suno.com.br, lp.statusinvest.com.br, lp2.statusinvest.com.br</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Estado: usuário desligou dados reais
  if (!useRealData) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <Info size={20} className="text-slate-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-slate-900 mb-1">LP Analyzer requer dados reais GA4</h3>
            <p className="text-sm text-slate-600">
              Ative <strong>"Dados reais"</strong> no header pra analisar suas LPs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[color:var(--border)] bg-gradient-to-r from-purple-50 via-white to-indigo-50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Sparkles size={18} className="text-[#7c5cff]" />
              LP Analyzer
              <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                Dados reais GA4
              </span>
            </h2>
            <p className="text-xs text-[color:var(--muted-foreground)] mt-1">
              Análise de LPs ativas em <strong>{lpConfig.label}</strong> · taxa de captação calculada via{" "}
              <code className="text-[11px]">generate_lead ÷ sessions</code>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
            <Layers size={14} />
            <span>{lpConfig.hosts.join(" + ")}</span>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="px-6 py-4 border-b border-[color:var(--border)] flex flex-wrap items-center gap-3 bg-slate-50/50">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider">
          <Filter size={13} /> Filtros
        </div>

        <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setHostFilter("all")}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              hostFilter === "all" ? "bg-[#ede9fe] text-[#7c5cff]" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Todos hosts
          </button>
          {hostList.map((h) => (
            <button
              key={h}
              onClick={() => setHostFilter(h)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                hostFilter === h ? "bg-[#ede9fe] text-[#7c5cff]" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {h}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label className="text-[color:var(--muted-foreground)]">Min. sessões:</label>
          <input
            type="range"
            min="0"
            max="1000"
            step="50"
            value={minSessions}
            onChange={(e) => setMinSessions(Number(e.target.value))}
            className="w-24 accent-[#7c5cff]"
          />
          <span className="font-semibold tabular-nums w-12">{minSessions}</span>
        </div>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as "sessions" | "leadConvRate" | "bounceRate")}
          className="px-2 py-1 text-xs rounded-md border border-slate-200 bg-white"
        >
          <option value="sessions">Ordenar por sessões</option>
          <option value="leadConvRate">Ordenar por conv. de lead</option>
          <option value="bounceRate">Ordenar por rejeição</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyIssues}
            onChange={(e) => setShowOnlyIssues(e.target.checked)}
            className="accent-[#7c5cff]"
          />
          Só com problemas
        </label>

        <div className="ml-auto text-xs text-[color:var(--muted-foreground)]">
          {rows.length} LP{rows.length !== 1 ? "s" : ""} encontrada{rows.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="p-6 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} height={70} />
          ))}
        </div>
      )}
      {error && !loading && (
        <div className="p-6">
          <DataErrorCard meta={{ status: "error", propertyId: selectedId, propertyName: selected?.displayName || null, fetchedAt: null }} error={error} />
        </div>
      )}

      {/* Lista */}
      {!loading && !error && rows.length === 0 && (
        <div className="p-12 text-center text-sm text-[color:var(--muted-foreground)]">
          Nenhuma LP encontrada com esses filtros nos últimos {days} dias.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <LPRow key={r.url} row={r} median={hostMedians[r.host] || 0} index={i} />
          ))}
        </div>
      )}

      {/* Legenda das heurísticas */}
      {!loading && !error && rows.length > 0 && (
        <div className="px-6 py-4 border-t border-[color:var(--border)] bg-slate-50/50">
          <div className="text-[11px] text-[color:var(--muted-foreground)] flex items-start gap-2">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              <strong>Como ler:</strong> as sugestões são heurísticas baseadas em padrões de CRO — não substituem teste A/B.
              Cada uma aponta o <em>ângulo a investigar</em>. Mediana do host é calculada só com LPs ≥100 sessões.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function LPRow({ row, median, index }: { row: LPRow & { diagnosis: Diagnosis }; median: number; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const levelStyle = {
    critico: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", icon: <AlertCircle size={14} className="text-rose-600" /> },
    atencao: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: <TrendingDown size={14} className="text-amber-600" /> },
    ok: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: <CheckCircle2 size={14} className="text-emerald-600" /> },
  }[row.diagnosis.level];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
      className="hover:bg-slate-50/50 transition cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="px-6 py-4 flex items-start gap-4">
        {/* Status icon */}
        <div className={`shrink-0 mt-1 w-7 h-7 rounded-lg ${levelStyle.bg} border ${levelStyle.border} flex items-center justify-center`}>
          {levelStyle.icon}
        </div>

        {/* URL + path */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-slate-900 truncate">{row.path}</span>
            <a
              href={`https://${row.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#7c5cff] hover:underline flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              abrir <ExternalLink size={10} />
            </a>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{row.host}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${levelStyle.bg} ${levelStyle.text}`}>
              {row.diagnosis.level === "critico" ? "Crítico" : row.diagnosis.level === "atencao" ? "Atenção" : "Saudável"}
            </span>
          </div>
          {/* Primeira linha de sinais sempre visível */}
          <div className="text-xs text-slate-600 mt-1">{row.diagnosis.signals[0]}</div>
        </div>

        {/* Métricas em colunas */}
        <div className="hidden md:flex items-center gap-6 text-right tabular-nums">
          <MetricCol label="Sessões" value={formatNumber(row.sessions)} />
          <MetricCol label="Rejeição" value={`${(row.bounceRate * 100).toFixed(1)}%`} highlight={row.bounceRate > 0.6 ? "warn" : undefined} />
          <MetricCol
            label="Tempo médio"
            value={row.avgSessionDuration < 60 ? `${row.avgSessionDuration.toFixed(0)}s` : `${(row.avgSessionDuration / 60).toFixed(1)}min`}
            highlight={row.avgSessionDuration < 30 ? "warn" : undefined}
          />
          <MetricCol label="Leads" value={formatNumber(row.leadCount)} />
          <MetricCol
            label="Conv. lead"
            value={`${(row.leadConvRate * 100).toFixed(2)}%`}
            highlight={median > 0 && row.leadConvRate < median * 0.75 ? "warn" : median > 0 && row.leadConvRate > median * 1.2 ? "good" : undefined}
          />
        </div>
      </div>

      {/* Expandido — sinais completos + sugestões */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="px-6 pb-5 ml-14 grid md:grid-cols-2 gap-4"
        >
          <div>
            <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Activity size={12} /> Sinais detectados
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-700">
              {row.diagnosis.signals.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-slate-400 mt-0.5">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          {row.diagnosis.suggestions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Lightbulb size={12} className="text-amber-500" /> Sugestões de teste
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-700">
                {row.diagnosis.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <ArrowUpRight size={11} className="shrink-0 mt-0.5 text-[#7c5cff]" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function MetricCol({ label, value, highlight }: { label: string; value: string; highlight?: "warn" | "good" }) {
  const color = highlight === "warn" ? "text-amber-700" : highlight === "good" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="min-w-[60px]">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}
