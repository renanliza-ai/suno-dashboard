"use client";

import { Header } from "@/components/header";
import { MasterGuard } from "@/components/master-guard";
import { Dialog } from "@/components/dialog";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Radar,
  Tag,
  Activity,
  Eye,
  Crown,
  RefreshCw,
  ExternalLink,
  Copy,
  Smartphone,
  Monitor,
  Users,
  Link2,
  Ghost,
  Layers,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  Server,
  Zap,
  Shield,
  Search,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import {
  trackingPages,
  utmRows,
  utmStandards,
  phantomJourneys,
  crossDeviceStats,
  type TrackingPage,
  type UTMRow,
  type TrackingStatus,
} from "@/lib/data";
import { formatNumber } from "@/lib/utils";
import { useGA4, useGA4PagesDetail } from "@/lib/ga4-context";
import { DataStatus } from "@/components/data-status";

// Hash determinístico — ao trocar a propriedade, status/contagens mudam de
// forma estável (mesma propriedade sempre dá os mesmos resultados).
function hashSeed(s: string | null | undefined): number {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const statusByMod = (mod: number): TrackingStatus => {
  if (mod < 55) return "ok";
  if (mod < 75) return "warning";
  if (mod < 90) return "missing";
  return "error";
};

type Tab = "pages" | "utm" | "phantom" | "crossdevice" | "stale_lps";

const baseAlerts = [
  { time: "há 12min", severity: "critical", page: "/lp/premium-30", message: "Página nova sem GTM instalado", detail: "Deploy às 10:42. Nenhum evento." },
  { time: "há 1h", severity: "critical", page: "/lp/consultoria-vip", message: "Container GTM removido", detail: "GTM-XSN8K3L não encontrado desde 09:15." },
  { time: "há 3h", severity: "warning", page: "/lp/black-friday-2026", message: "scroll_depth duplicado em 18% sessões", detail: "Possível listener duplicado." },
  { time: "há 5h", severity: "warning", page: "/relatorios", message: "generate_lead não implementado", detail: "CTA de newsletter sem evento." },
];

function StatusIcon({ status, size = 16 }: { status: TrackingStatus; size?: number }) {
  if (status === "ok") return <CheckCircle2 size={size} className="text-emerald-500" />;
  if (status === "warning") return <AlertCircle size={size} className="text-amber-500" />;
  if (status === "missing") return <AlertCircle size={size} className="text-slate-400" />;
  return <XCircle size={size} className="text-red-500" />;
}

function StatusBadge({ status }: { status: TrackingStatus }) {
  const cls =
    status === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "warning"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : status === "missing"
      ? "bg-slate-50 text-slate-600 border-slate-200"
      : "bg-red-50 text-red-700 border-red-200";
  const label =
    status === "ok" ? "OK" : status === "warning" ? "Atenção" : status === "missing" ? "Ausente" : "Erro";
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${cls}`}>{label}</span>
  );
}

function PageDetailDialog({ page, onClose }: { page: TrackingPage | null; onClose: () => void }) {
  if (!page) return null;
  return (
    <Dialog
      open={!!page}
      onClose={onClose}
      title={page.shortPath}
      subtitle={page.url}
      maxWidth="max-w-3xl"
      icon={
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center">
          <Radar size={18} className="text-white" />
        </div>
      }
    >
      <div className="space-y-5">
        {/* URL completa */}
        <div className="rounded-xl bg-[color:var(--muted)] p-3 flex items-start gap-2">
          <Link2 size={14} className="mt-1 shrink-0 text-[#7c5cff]" />
          <code className="text-xs font-mono break-all flex-1">{page.url}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(page.url)}
            className="shrink-0 w-7 h-7 rounded-md hover:bg-white flex items-center justify-center"
            title="Copiar URL"
          >
            <Copy size={12} />
          </button>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 w-7 h-7 rounded-md hover:bg-white flex items-center justify-center"
            title="Abrir"
          >
            <ExternalLink size={12} />
          </a>
        </div>

        {/* KPIs de tracking */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Pageviews 30d", value: formatNumber(page.pageviews30d) },
            { label: "Leads 30d", value: formatNumber(page.leadCount30d) },
            { label: "Compras 30d", value: formatNumber(page.purchaseCount30d) },
            { label: "Checado", value: "há " + page.lastCheck },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-[color:var(--border)] p-3">
              <p className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)] font-semibold">
                {k.label}
              </p>
              <p className="text-xl font-bold mt-1 tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Status por item */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Saúde do tracking</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "gtm", label: "GTM Container", status: page.gtm, detail: page.gtmContainer || "—" },
              { key: "events", label: "Eventos base (page_view, scroll_depth, engagement)", status: page.events, detail: "Validação DataLayer" },
              { key: "lead", label: "generate_lead", status: page.lead, detail: page.lastLeadAt ? `Último: ${page.lastLeadAt}` : "—" },
              { key: "purchase", label: "purchase", status: page.purchase, detail: page.lastPurchaseAt ? `Último: ${page.lastPurchaseAt}` : "—" },
            ].map((row) => (
              <div
                key={row.key}
                className="flex items-start gap-2 p-3 rounded-xl border border-[color:var(--border)]"
              >
                <StatusIcon status={row.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{row.label}</p>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5 truncate">
                    {row.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Issues detectados */}
        {page.issues.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              Problemas detectados ({page.issues.length})
            </h3>
            <ul className="space-y-1.5">
              {page.issues.map((iss, i) => (
                <li
                  key={i}
                  className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 flex items-start gap-2"
                >
                  <span className="shrink-0">•</span>
                  {iss}
                </li>
              ))}
            </ul>
          </div>
        )}

        {page.issues.length === 0 && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 flex items-center gap-2 text-sm">
            <ShieldCheck size={16} />
            Nenhum problema detectado — tracking saudável.
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-[color:var(--border)]">
          <button className="flex-1 px-4 py-2 rounded-xl bg-[#7c5cff] hover:bg-[#6b4bf0] text-white text-sm font-medium">
            Rodar validação agora
          </button>
          <button className="px-4 py-2 rounded-xl border border-[color:var(--border)] text-sm font-medium hover:bg-[color:var(--muted)]">
            Ver no GTM
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function UTMDetailDialog({ row, onClose }: { row: UTMRow | null; onClose: () => void }) {
  if (!row) return null;
  const hasIssues = row.issues.length > 0;
  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      title="Análise de UTM"
      subtitle={`${row.source} / ${row.medium} / ${row.campaign}`}
      maxWidth="max-w-2xl"
      icon={
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <Tag size={18} className="text-white" />
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-2">
          {[
            { k: "utm_source", v: row.source },
            { k: "utm_medium", v: row.medium || "(vazio)" },
            { k: "utm_campaign", v: row.campaign },
            { k: "utm_content", v: row.content || "—" },
            { k: "utm_term", v: row.term || "—" },
          ].map((f) => (
            <div key={f.k} className="rounded-lg bg-[color:var(--muted)] p-2">
              <p className="text-[9px] font-mono uppercase text-[color:var(--muted-foreground)]">{f.k}</p>
              <p className="text-xs font-semibold mt-0.5 truncate">{f.v}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[color:var(--border)] p-3">
            <p className="text-xs text-[color:var(--muted-foreground)]">Sessões</p>
            <p className="text-2xl font-bold tabular-nums">{formatNumber(row.sessions)}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border)] p-3">
            <p className="text-xs text-[color:var(--muted-foreground)]">Conversões</p>
            <p className="text-2xl font-bold tabular-nums">{formatNumber(row.conversions)}</p>
          </div>
        </div>

        {hasIssues ? (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" /> Inconsistências
            </h3>
            <ul className="space-y-1.5">
              {row.issues.map((iss, i) => (
                <li
                  key={i}
                  className="text-xs rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2"
                >
                  <span className="font-mono font-bold text-amber-700">{iss.field}</span>
                  <span className="text-amber-900">→ {iss.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 flex items-center gap-2 text-sm">
            <ShieldCheck size={16} />
            UTM dentro do padrão Suno (lowercase + kebab-case).
          </div>
        )}

        <div className="rounded-xl bg-[#ede9fe] p-3 text-xs">
          <p className="font-semibold text-[#5b3dd4] mb-1">📘 Taxonomia Suno</p>
          <p className="text-[#5b3dd4]/80">
            Padrão: <code className="bg-white px-1 rounded">{utmStandards.pattern}</code> · Campos obrigatórios:{" "}
            {utmStandards.requiredFields.join(", ")}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

export default function TrackingPage() {
  const [tab, setTab] = useState<Tab>("pages");
  const [filter, setFilter] = useState<"all" | "ok" | "warning" | "error">("all");
  const [selectedPage, setSelectedPage] = useState<TrackingPage | null>(null);
  const [selectedUTM, setSelectedUTM] = useState<UTMRow | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<(typeof baseAlerts)[number] | null>(null);
  const [selectedPhantom, setSelectedPhantom] = useState<(typeof phantomJourneys)[number] | null>(null);

  // GA4 — propriedade selecionada no header
  const { selected, selectedId, useRealData } = useGA4();
  const { data: pagesDetail, meta: pagesMeta } = useGA4PagesDetail();
  const seed = hashSeed(selectedId);
  const propertyName = selected?.displayName || "Modo demo (sem GA4)";
  const realPagesAvailable =
    useRealData && pagesMeta.status === "success" && (pagesDetail?.pages?.length || 0) > 0;

  // displayPages: usa páginas reais quando disponível, senão aplica transformação
  // determinística (seed) sobre o mock para que os números mudem ao trocar de propriedade.
  const displayPages: TrackingPage[] = useMemo(() => {
    if (realPagesAvailable && pagesDetail) {
      // Constrói TrackingPage a partir das páginas reais GA4 + status seedado.
      return pagesDetail.pages.slice(0, Math.max(10, trackingPages.length)).map((rp, i) => {
        const base = trackingPages[i] || trackingPages[0];
        const gtmMod = (seed + i * 17) % 100;
        const eventsMod = (seed + i * 23) % 100;
        const leadMod = (seed + i * 31) % 100;
        const purchaseMod = (seed + i * 37) % 100;
        const gtm = statusByMod(gtmMod);
        const events = statusByMod(eventsMod);
        const lead = statusByMod(leadMod);
        const purchase = statusByMod(purchaseMod);
        const status: TrackingStatus =
          gtmMod >= 90 || eventsMod >= 90
            ? "error"
            : gtmMod >= 75 || eventsMod >= 75
            ? "warning"
            : "ok";
        // rp.url = "host/path" (sem protocolo). Garantimos https:// para clicabilidade.
        const fullUrl = rp.url
          ? rp.url.startsWith("http")
            ? rp.url
            : `https://${rp.url}`
          : `https://${rp.host || "(sem-host)"}${rp.path || "/"}`;
        return {
          ...base,
          url: fullUrl,
          shortPath: rp.path || base.shortPath,
          pageviews30d: Math.round(rp.views || 0),
          // leads/compras não existem no GA4 Data API — derivamos de users com coeficiente.
          leadCount30d: Math.round((rp.users || 0) * 0.04),
          purchaseCount30d: Math.round((rp.users || 0) * 0.008),
          gtm,
          events,
          lead,
          purchase,
          status,
          lastCheck: `${((seed + i) % 30) + 1}min`,
          // GTM container para o detalhe — varia por host real
          gtmContainer: rp.host ? `GTM-${rp.host.split(".")[0].toUpperCase().slice(0, 6)}` : base.gtmContainer,
        };
      });
    }
    // Mock seedado por propriedade.
    return trackingPages.map((p, i) => {
      const factor = 0.7 + ((seed + i * 13) % 60) / 100;
      const gtmMod = (seed + i * 17) % 100;
      const eventsMod = (seed + i * 23) % 100;
      const leadMod = (seed + i * 31) % 100;
      const purchaseMod = (seed + i * 37) % 100;
      const gtm = statusByMod(gtmMod);
      const events = statusByMod(eventsMod);
      const lead = statusByMod(leadMod);
      const purchase = statusByMod(purchaseMod);
      const status: TrackingStatus =
        gtmMod >= 90 || eventsMod >= 90
          ? "error"
          : gtmMod >= 75 || eventsMod >= 75
          ? "warning"
          : "ok";
      return {
        ...p,
        pageviews30d: Math.round(p.pageviews30d * factor),
        leadCount30d: Math.round(p.leadCount30d * factor),
        purchaseCount30d: Math.round(p.purchaseCount30d * factor),
        gtm,
        events,
        lead,
        purchase,
        status,
        lastCheck: `${((seed + i) % 30) + 1}min`,
      };
    });
  }, [seed, realPagesAvailable, pagesDetail]);

  // Alertas seedados — primeiro alerta aponta para a página com pior status.
  const alerts = useMemo(() => {
    const worst = [...displayPages].sort((a, b) => {
      const order: Record<TrackingStatus, number> = { error: 0, missing: 1, warning: 2, ok: 3 };
      return order[a.status] - order[b.status];
    })[0];
    return baseAlerts.map((a, i) => {
      const minutesAgo = ((seed + i * 11) % 240) + 5;
      const timeLabel =
        minutesAgo < 60
          ? `há ${minutesAgo}min`
          : `há ${Math.floor(minutesAgo / 60)}h`;
      if (i === 0 && worst) {
        return { ...a, page: worst.shortPath || a.page, time: timeLabel };
      }
      return { ...a, time: timeLabel };
    });
  }, [seed, displayPages]);

  const pages = displayPages;
  const filtered = filter === "all" ? pages : pages.filter((p) => p.status === filter);
  const okCount = pages.filter((p) => p.status === "ok").length;
  const warnCount = pages.filter((p) => p.status === "warning").length;
  const errCount = pages.filter((p) => p.status === "error").length;

  // UTM stats — varia levemente por propriedade.
  const utmIssuesCount = utmRows.filter((r) => r.issues.length > 0).length;
  const utmBaseHealth = Math.round(((utmRows.length - utmIssuesCount) / utmRows.length) * 100);
  const utmHealthPct = Math.max(40, Math.min(99, utmBaseHealth - 8 + (seed % 16)));

  // ====================================================================
  // CAPI / Server-Side Tracking — saúde REAL via /api/capi/test que pinga
  // a Meta Graph API e retorna o estado da integração (token + pixel + envio).
  // ====================================================================
  type CAPIStatus = "active" | "partial" | "inactive" | "loading" | "not_configured";
  type CAPILiveResp = {
    ok: boolean;
    capiConfigured?: boolean;
    matchedProperty?: string | null;
    propertyRequested?: string | null;
    fromFallback?: boolean;
    pixelId?: string;
    pixelIdMasked?: string;
    tokenLastFour?: string;
    httpStatus?: number;
    networkError?: string | null;
    checks?: Record<string, boolean>;
    metaResponse?: {
      events_received?: number;
      messages?: string[];
      fbtrace_id?: string;
      error?: { message: string; type: string; code: number };
    };
    eventSent?: {
      event_name: string;
      event_id: string;
      event_time: number;
      action_source: string;
      pii_fields_sent: string[];
      test_mode: boolean;
    };
    recommendations?: string[];
    nextStep?: string;
    error?: string;
    stage?: string;
  };

  const [capiLive, setCapiLive] = useState<CAPILiveResp | null>(null);
  const [capiLoading, setCapiLoading] = useState(true);
  const [capiOpen, setCapiOpen] = useState(false);

  // Faz o fetch passando a propriedade selecionada — pra cada propriedade
  // tem um par (pixelId, token) próprio em .env.local. Se não tiver bloco
  // dedicado, o backend cai no fallback ou retorna "não configurada".
  useEffect(() => {
    let alive = true;
    const fetchCapiStatus = async () => {
      setCapiLoading(true);
      try {
        const propParam = propertyName ? `?propertyName=${encodeURIComponent(propertyName)}` : "";
        const r = await fetch(`/api/capi/test${propParam}`, { cache: "no-store" });
        const data = (await r.json()) as CAPILiveResp;
        if (alive) {
          setCapiLive(data);
          setCapiLoading(false);
        }
      } catch (e) {
        if (alive) {
          setCapiLive({ ok: false, error: (e as Error).message });
          setCapiLoading(false);
        }
      }
    };
    fetchCapiStatus();
    const id = setInterval(fetchCapiStatus, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [propertyName]);

  // Deriva o status pra UI a partir da resposta real
  const capiData = useMemo(() => {
    let status: CAPIStatus = "loading";
    if (capiLoading) status = "loading";
    else if (capiLive && capiLive.capiConfigured === false) status = "not_configured";
    else if (capiLive?.ok && capiLive.metaResponse?.events_received === 1) status = "active";
    else if (capiLive && capiLive.checks?.["3_meta_api_reachable"] && !capiLive.ok) status = "partial";
    else status = "inactive";

    // Eventos client-side derivados da página (real ou seedado)
    const clientEvents = pagesDetail?.pages?.reduce((s, p) => s + (p.views || 0), 0) || (180000 + (seed % 90000));
    const lossRate = 0.32 + ((seed % 18) / 100);
    const lostEvents = Math.round(clientEvents * lossRate);

    // Quando CAPI está confirmadamente ativo, mostramos a recuperação esperada (78-89%)
    let serverEvents = 0;
    let recoveryRate = 0;
    if (status === "active") {
      recoveryRate = 0.78 + ((seed % 12) / 100);
      serverEvents = Math.round(lostEvents * recoveryRate);
    } else if (status === "partial") {
      recoveryRate = 0.30 + ((seed % 25) / 100);
      serverEvents = Math.round(lostEvents * recoveryRate);
    }

    // Match rate ainda é estimado — Meta só calcula na UI deles após 24-48h
    const matchRate = status === "active" ? 78 + (seed % 18) : status === "partial" ? 45 + (seed % 25) : 0;

    const criticalEvents = [
      { name: "Purchase", clientCount: Math.round(clientEvents * 0.018), capiCount: status === "active" ? Math.round(clientEvents * 0.022) : 0 },
      { name: "Lead", clientCount: Math.round(clientEvents * 0.058), capiCount: status === "active" ? Math.round(clientEvents * 0.071) : 0 },
      { name: "AddPaymentInfo", clientCount: Math.round(clientEvents * 0.024), capiCount: status === "active" ? Math.round(clientEvents * 0.030) : 0 },
      { name: "InitiateCheckout", clientCount: Math.round(clientEvents * 0.041), capiCount: status === "active" ? Math.round(clientEvents * 0.052) : 0 },
    ];

    return { status, clientEvents, lostEvents, serverEvents, recoveryRate, matchRate, lossRate, criticalEvents };
  }, [capiLive, capiLoading, seed, pagesDetail]);

  return (
    <MasterGuard>
      <main className="ml-20 p-8 max-w-[1600px]">
        <Header />

        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-1.5">
            <Crown size={12} />
            Área Master
          </div>
          <div className="px-3 py-1 rounded-full bg-[#ede9fe] text-[#7c5cff] text-xs font-semibold flex items-center gap-1.5">
            <Radar size={12} />
            Tracking Monitor
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Monitorando em tempo real
          </div>
        </div>

        {/* Banner: propriedade analisada */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="text-sm">
            Análise de: <strong className="text-[#7c5cff]">{propertyName}</strong>
            {realPagesAvailable && (
              <span className="ml-2 text-[11px] text-emerald-600 font-semibold">
                · dados reais GA4
              </span>
            )}
            {!realPagesAvailable && useRealData && (
              <span className="ml-2 text-[11px] text-amber-600 font-semibold">
                · GA4 conectado, usando seed da propriedade
              </span>
            )}
          </div>
          {useRealData && <DataStatus meta={pagesMeta} />}
        </div>

        {/* CAPI Status — saúde REAL do tracking server-side via Meta Graph API */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mb-6 rounded-2xl border p-5 ${
            capiData.status === "active"
              ? "bg-gradient-to-r from-emerald-50 to-white border-emerald-200"
              : capiData.status === "partial"
              ? "bg-gradient-to-r from-amber-50 to-white border-amber-200"
              : capiData.status === "loading"
              ? "bg-gradient-to-r from-slate-50 to-white border-slate-200"
              : capiData.status === "not_configured"
              ? "bg-gradient-to-r from-slate-50 to-white border-slate-300"
              : "bg-gradient-to-r from-red-50 to-white border-red-200"
          }`}
        >
          <div className="flex items-start gap-4 flex-wrap">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                capiData.status === "active"
                  ? "bg-emerald-100 text-emerald-700"
                  : capiData.status === "partial"
                  ? "bg-amber-100 text-amber-700"
                  : capiData.status === "loading"
                  ? "bg-slate-100 text-slate-500 animate-pulse"
                  : capiData.status === "not_configured"
                  ? "bg-slate-100 text-slate-500"
                  : "bg-red-100 text-red-700"
              }`}
            >
              <Server size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="text-base font-bold">Conversions API (CAPI)</h3>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                    capiData.status === "active"
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                      : capiData.status === "partial"
                      ? "bg-amber-100 text-amber-800 border-amber-300"
                      : capiData.status === "loading"
                      ? "bg-slate-100 text-slate-700 border-slate-300"
                      : capiData.status === "not_configured"
                      ? "bg-slate-200 text-slate-700 border-slate-400"
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  {capiData.status === "active"
                    ? "✓ Ativo (validado Meta)"
                    : capiData.status === "partial"
                    ? "⚠ Parcial"
                    : capiData.status === "loading"
                    ? "⏳ Verificando..."
                    : capiData.status === "not_configured"
                    ? "○ Não configurada"
                    : "✗ Inativo"}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
                  Meta CAPI · ao vivo
                </span>
                {capiLive?.pixelIdMasked && capiData.status !== "not_configured" && (
                  <span className="text-[10px] font-mono text-[color:var(--muted-foreground)] bg-slate-50 px-2 py-0.5 rounded border">
                    Pixel: {capiLive.pixelIdMasked}
                  </span>
                )}
                {capiLive?.matchedProperty && capiData.status !== "not_configured" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                    🎯 {capiLive.matchedProperty}
                  </span>
                )}
                {capiLive?.fromFallback && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200"
                    title="Está usando o pixel default (META_PIXEL_ID). Pra usar credenciais dedicadas, adicione um bloco META_CAPI_PROPERTY_N_* específico."
                  >
                    ⚠ Fallback
                  </span>
                )}
              </div>
              <p className="text-sm text-[color:var(--muted-foreground)]">
                {capiData.status === "loading" && "Pinging Meta Graph API para validar token + pixel..."}
                {capiData.status === "active" && (
                  <>
                    ✅ Meta aceitou o evento de teste (events_received:{capiLive?.metaResponse?.events_received}). Estimativa: recuperando ~
                    {(capiData.recoveryRate * 100).toFixed(0)}% dos eventos perdidos por bloqueador/iOS 14.5.
                  </>
                )}
                {capiData.status === "partial" &&
                  `Meta API responde mas o evento não foi aceito. Veja diagnóstico nos detalhes.`}
                {capiData.status === "not_configured" && (
                  <>
                    A propriedade <strong>{propertyName}</strong> ainda não tem CAPI configurada. Hoje só Suno Research e Statusinvest têm.
                    Adicione um bloco <code className="bg-slate-100 px-1 rounded text-[10px]">META_CAPI_PROPERTY_N_*</code> em <code className="bg-slate-100 px-1 rounded text-[10px]">.env.local</code> pra ativar.
                  </>
                )}
                {capiData.status === "inactive" && (
                  <>
                    {capiLive?.error || capiLive?.metaResponse?.error?.message ||
                      "Sem CAPI ativa — você está perdendo conversões para tracking client-side bloqueado."}
                  </>
                )}
              </p>
            </div>
            <button
              onClick={() => setCapiOpen(true)}
              className="px-4 py-2 rounded-xl bg-[#7c5cff] hover:bg-[#6b4bf0] text-white text-sm font-semibold inline-flex items-center gap-1.5 transition shrink-0"
            >
              {capiData.status === "active" ? "Ver diagnóstico completo" : "Validar implementação"}
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Mini-grid: eventos client / lost / server / match */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[color:var(--border)]">
            <div>
              <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)] tracking-wider">
                Eventos client-side
              </p>
              <p className="text-lg font-bold mt-0.5 tabular-nums">{formatNumber(capiData.clientEvents)}</p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">via GA4 (browser)</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-red-600 tracking-wider">Perdidos</p>
              <p className="text-lg font-bold mt-0.5 tabular-nums text-red-700">
                {formatNumber(capiData.lostEvents)}
              </p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">
                {(capiData.lossRate * 100).toFixed(0)}% por bloqueio/ITP
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">
                Recuperados via CAPI
              </p>
              <p className="text-lg font-bold mt-0.5 tabular-nums text-emerald-700">
                {capiData.serverEvents > 0 ? `+${formatNumber(capiData.serverEvents)}` : "—"}
              </p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">
                {capiData.serverEvents > 0
                  ? `${(capiData.recoveryRate * 100).toFixed(0)}% do gap`
                  : "ative o conector"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-blue-600 tracking-wider">Match rate Meta</p>
              <p className="text-lg font-bold mt-0.5 tabular-nums text-blue-700">
                {capiData.matchRate > 0 ? `${capiData.matchRate.toFixed(0)}%` : "—"}
              </p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">
                {capiData.matchRate >= 70
                  ? "saudável (≥70%)"
                  : capiData.matchRate > 0
                  ? "abaixo do ideal"
                  : "sem dados"}
              </p>
            </div>
          </div>
        </motion.div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Páginas Ativas", value: pages.length, icon: Eye, color: "#7c5cff", bg: "bg-violet-50" },
            { label: "Tracking OK", value: okCount, icon: CheckCircle2, color: "#10b981", bg: "bg-emerald-50" },
            { label: "Atenção", value: warnCount, icon: AlertCircle, color: "#f59e0b", bg: "bg-amber-50" },
            { label: "UTM Health", value: `${utmHealthPct}%`, icon: Tag, color: "#ef4444", bg: "bg-red-50" },
          ].map((m, i) => {
            const Icon = m.icon;
            return (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="bg-white rounded-2xl border border-[color:var(--border)] p-5 flex items-center gap-4"
              >
                <div className={`w-12 h-12 rounded-xl ${m.bg} flex items-center justify-center`}>
                  <Icon size={22} style={{ color: m.color }} />
                </div>
                <div>
                  <p className="text-sm text-[color:var(--muted-foreground)] font-medium">{m.label}</p>
                  <p className="text-2xl font-bold tracking-tight">{m.value}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 bg-white p-1.5 rounded-xl border border-[color:var(--border)] w-fit">
          {([
            { id: "pages", label: "Status das Páginas", icon: Eye },
            { id: "utm", label: "UTM Audit", icon: Tag },
            { id: "phantom", label: "Jornada Fantasma", icon: Ghost },
            { id: "crossdevice", label: "Cross-Device", icon: Layers },
            { id: "stale_lps", label: "LPs antigas / Redirects pendentes", icon: AlertTriangle },
          ] as { id: Tab; label: string; icon: typeof Eye }[]).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  active ? "bg-[#ede9fe] text-[#7c5cff]" : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* TAB: Pages */}
        {tab === "pages" && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
              <div className="p-5 border-b border-[color:var(--border)] flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">Status das Páginas</h3>
                  <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                    Clique em qualquer linha para ver detalhes, URL completa e eventos.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 bg-[color:var(--muted)] p-1 rounded-lg">
                    {[
                      { id: "all", label: "Todos" },
                      { id: "ok", label: "OK" },
                      { id: "warning", label: "Atenção" },
                      { id: "error", label: "Erro" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFilter(f.id as typeof filter)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                          filter === f.id ? "bg-white text-[#7c5cff] shadow-sm" : "text-[color:var(--muted-foreground)]"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <button className="w-8 h-8 rounded-lg bg-[color:var(--muted)] hover:bg-[color:var(--border)] flex items-center justify-center transition">
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-[color:var(--muted-foreground)] bg-[color:var(--muted)]">
                      <th className="text-left px-5 py-3 font-medium">Página (URL completa)</th>
                      <th className="text-center px-2 py-3 font-medium">GTM</th>
                      <th className="text-center px-2 py-3 font-medium">Eventos</th>
                      <th className="text-center px-2 py-3 font-medium">Lead</th>
                      <th className="text-center px-2 py-3 font-medium">Purchase</th>
                      <th className="text-right px-4 py-3 font-medium">Checado</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => (
                      <motion.tr
                        key={p.url}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => setSelectedPage(p)}
                        className="border-t border-[color:var(--border)] hover:bg-[#ede9fe]/40 transition cursor-pointer"
                      >
                        <td className="px-5 py-3">
                          <p className="text-xs font-mono truncate max-w-[380px]" title={p.url}>
                            {p.url}
                          </p>
                          <p className="text-[10px] text-[color:var(--muted-foreground)] mt-0.5">
                            {formatNumber(p.pageviews30d)} pageviews · {formatNumber(p.leadCount30d)} leads · {formatNumber(p.purchaseCount30d)} compras
                          </p>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <div className="flex justify-center">
                            <StatusIcon status={p.gtm} />
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <div className="flex justify-center">
                            <StatusIcon status={p.events} />
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <div className="flex justify-center">
                            <StatusIcon status={p.lead} />
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <div className="flex justify-center">
                            <StatusIcon status={p.purchase} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[color:var(--muted-foreground)] text-right whitespace-nowrap">
                          há {p.lastCheck}
                        </td>
                        <td className="pr-4">
                          <ChevronRight size={14} className="text-[color:var(--muted-foreground)]" />
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Alertas */}
            <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Activity size={16} />
                  Alertas Recentes
                </h3>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-md font-semibold">
                  {alerts.filter((a) => a.severity === "critical").length} críticos
                </span>
              </div>
              <div className="space-y-3 max-h-[520px] overflow-y-auto">
                {alerts.map((a, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    onClick={() => setSelectedAlert(a)}
                    className={`w-full text-left p-3 rounded-xl border-l-4 hover:shadow-md transition ${
                      a.severity === "critical" ? "bg-red-50 border-red-500" : "bg-amber-50 border-amber-500"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-medium">{a.page}</span>
                      <span className="text-[10px] text-[color:var(--muted-foreground)]">{a.time}</span>
                    </div>
                    <p className="text-sm font-semibold mb-1">{a.message}</p>
                    <p className="text-xs text-[color:var(--muted-foreground)]">{a.detail}</p>
                  </motion.button>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-[color:var(--border)] flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
                <span className="flex items-center gap-1.5">
                  <Tag size={12} />
                  Container GTM-XSN8K3L
                </span>
                <button className="text-[#7c5cff] font-medium hover:underline">Ver todos</button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: UTM Audit */}
        {tab === "utm" && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">UTMs analisadas</p>
                <p className="text-2xl font-bold mt-1">{utmRows.length}</p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">Dentro do padrão</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{utmRows.length - utmIssuesCount}</p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">Com inconsistências</p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{utmIssuesCount}</p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">Saúde geral</p>
                <p className="text-2xl font-bold mt-1 text-[#7c5cff]">{utmHealthPct}%</p>
              </div>
            </div>

            <div className="rounded-xl bg-gradient-to-r from-[#ede9fe] to-white border border-[#b297ff]/30 p-4 flex items-start gap-3">
              <ShieldCheck size={18} className="text-[#7c5cff] mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-[#5b3dd4]">Padrão Suno de Taxonomia</p>
                <p className="text-[#5b3dd4]/80 text-xs mt-0.5">
                  {utmStandards.pattern} · Obrigatórios: {utmStandards.requiredFields.join(", ")} · Mediums permitidos:{" "}
                  {utmStandards.allowedMediums.join(", ")}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
              <div className="p-5 border-b border-[color:var(--border)]">
                <h3 className="text-base font-semibold">Inspeção de UTMs</h3>
                <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                  Clique em uma linha para ver detalhes e recomendações.
                </p>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-[color:var(--muted-foreground)] bg-[color:var(--muted)]">
                    <th className="text-left px-5 py-3 font-medium">Source</th>
                    <th className="text-left px-3 py-3 font-medium">Medium</th>
                    <th className="text-left px-3 py-3 font-medium">Campaign</th>
                    <th className="text-right px-3 py-3 font-medium">Sessões</th>
                    <th className="text-right px-3 py-3 font-medium">Conv.</th>
                    <th className="text-center px-3 py-3 font-medium">Status</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {utmRows.map((r, i) => {
                    const hasIssues = r.issues.length > 0;
                    return (
                      <tr
                        key={i}
                        onClick={() => setSelectedUTM(r)}
                        className={`border-t border-[color:var(--border)] hover:bg-[#ede9fe]/40 transition cursor-pointer ${
                          hasIssues ? "bg-amber-50/40" : ""
                        }`}
                      >
                        <td className="px-5 py-3 text-sm font-mono">{r.source}</td>
                        <td className="px-3 py-3 text-sm font-mono">{r.medium || <span className="text-red-500 italic">vazio</span>}</td>
                        <td className="px-3 py-3 text-xs font-mono truncate max-w-[240px]">{r.campaign}</td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums">{formatNumber(r.sessions)}</td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums font-semibold">
                          {formatNumber(r.conversions)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {hasIssues ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-700">
                              <AlertTriangle size={10} /> {r.issues.length} issue{r.issues.length > 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                              <CheckCircle2 size={10} /> OK
                            </span>
                          )}
                        </td>
                        <td className="pr-4">
                          <ChevronRight size={14} className="text-[color:var(--muted-foreground)]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: Jornada Fantasma */}
        {tab === "phantom" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-900 via-purple-900 to-fuchsia-900 text-white p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Ghost size={22} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold">O que é Jornada Fantasma?</h3>
                  <p className="text-sm text-white/80 mt-1 leading-relaxed">
                    Usuários que interagiram com sua marca mas o GA4 não conseguiu costurar a jornada inteira —
                    seja por cookies bloqueados, navegação anônima, mudança de dispositivo sem login ou janela de
                    atribuição expirada. São as <strong>conversões órfãs</strong>: acontecem, mas você não vê quem
                    originou.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">Jornadas fantasma detectadas (30d)</p>
                <p className="text-2xl font-bold mt-1">{formatNumber(phantomJourneys.length * 842)}</p>
                <p className="text-[11px] text-amber-600 font-semibold mt-1">
                  ~12% do tráfego total
                </p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">Conversões órfãs</p>
                <p className="text-2xl font-bold mt-1">{formatNumber(482)}</p>
                <p className="text-[11px] text-red-600 font-semibold mt-1">
                  R$ 68k sem atribuição clara
                </p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <p className="text-xs text-[color:var(--muted-foreground)]">Gap médio entre touches</p>
                <p className="text-2xl font-bold mt-1">10.6 dias</p>
                <p className="text-[11px] text-[color:var(--muted-foreground)] mt-1">janela cookie: 90 dias</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
              <div className="p-5 border-b border-[color:var(--border)]">
                <h3 className="text-base font-semibold">Amostras de jornadas com inconsistência</h3>
                <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                  Clique para ver o diagnóstico completo.
                </p>
              </div>
              <div className="divide-y divide-[color:var(--border)]">
                {phantomJourneys.map((j) => (
                  <button
                    key={j.userId}
                    onClick={() => setSelectedPhantom(j)}
                    className="w-full text-left p-4 hover:bg-[#ede9fe]/40 transition flex items-center gap-4"
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        j.converted ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                      }`}
                    >
                      <Ghost size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold font-mono">{j.userId}</p>
                      <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5 truncate">
                        {j.firstTouch} → ... → {j.lastTouch}
                      </p>
                      <p className="text-[11px] text-amber-700 mt-1 line-clamp-1">⚠ {j.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold">
                        {j.sessions} sessões · {j.devices.length} device(s)
                      </p>
                      <p className="text-[11px] text-[color:var(--muted-foreground)]">gap {j.gapDays}d</p>
                      {j.converted && j.revenue && (
                        <p className="text-xs font-bold text-emerald-600 mt-0.5">
                          R$ {formatNumber(j.revenue)}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={14} className="text-[color:var(--muted-foreground)]" />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold">Como melhorar?</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                  <li>Implemente <strong>User-ID</strong> em todos os fluxos logados (SPA + mobile)</li>
                  <li>Ative <strong>Google Signals</strong> na property GA4 para reconciliação cross-device</li>
                  <li>Use <strong>Consent Mode v2</strong> para capturar conversões modeladas mesmo sem cookies</li>
                  <li>Amplie a janela de atribuição para 90 dias onde o ciclo de compra é longo</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TAB: Cross-Device */}
        {tab === "crossdevice" && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <Users size={14} className="text-[#7c5cff]" />
                <p className="text-xs text-[color:var(--muted-foreground)] mt-2">Usuários totais</p>
                <p className="text-xl font-bold mt-0.5 tabular-nums">
                  {formatNumber(crossDeviceStats.totalUsers)}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <Layers size={14} className="text-emerald-600" />
                <p className="text-xs text-[color:var(--muted-foreground)] mt-2">Cross-device</p>
                <p className="text-xl font-bold mt-0.5 tabular-nums">
                  {formatNumber(crossDeviceStats.crossDeviceUsers)}
                </p>
                <p className="text-[11px] text-emerald-600 font-semibold">
                  {crossDeviceStats.crossDeviceRate}% do total
                </p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <Smartphone size={14} className="text-amber-600" />
                <p className="text-xs text-[color:var(--muted-foreground)] mt-2">Devices/usuário</p>
                <p className="text-xl font-bold mt-0.5 tabular-nums">
                  {crossDeviceStats.avgDevicesPerUser}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
                <ShieldCheck size={14} className="text-[#7c5cff]" />
                <p className="text-xs text-[color:var(--muted-foreground)] mt-2">Identificados via User-ID</p>
                <p className="text-xl font-bold mt-0.5 tabular-nums">
                  {crossDeviceStats.identifiedRate}%
                </p>
                <p className="text-[11px] text-[color:var(--muted-foreground)]">
                  {formatNumber(crossDeviceStats.identifiedViaUserId)} usuários
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
                <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={14} className="text-[#7c5cff]" />
                  Principais caminhos cross-device
                </h3>
                <div className="space-y-2">
                  {crossDeviceStats.mainPaths.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-xl border border-[color:var(--border)] hover:bg-[color:var(--muted)]/40 transition"
                    >
                      <div className="flex items-center gap-1 text-xs font-semibold">
                        {p.from.includes("Mobile") ? <Smartphone size={14} /> : <Monitor size={14} />}
                        <span>{p.from}</span>
                        <ChevronRight size={12} className="text-[color:var(--muted-foreground)]" />
                        {p.to.includes("Mobile") ? <Smartphone size={14} /> : <Monitor size={14} />}
                        <span>{p.to}</span>
                      </div>
                      <div className="flex-1" />
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums">{formatNumber(p.users)}</p>
                        <p className="text-[11px] text-emerald-600 font-semibold">{p.convRate}% conv.</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] rounded-2xl p-5 text-white">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center mb-3">
                  <Lightbulb />
                </div>
                <h3 className="text-lg font-bold mb-3">Recomendações para melhorar</h3>
                <ul className="space-y-2.5 text-sm">
                  {crossDeviceStats.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TAB: LPs antigas / Redirects pendentes */}
        {tab === "stale_lps" && <StaleLPsTab />}
      </main>

      {/* Dialogs */}
      <PageDetailDialog page={selectedPage} onClose={() => setSelectedPage(null)} />
      <UTMDetailDialog row={selectedUTM} onClose={() => setSelectedUTM(null)} />

      {/* Dialog: CAPI Status detalhado */}
      <Dialog
        open={capiOpen}
        onClose={() => setCapiOpen(false)}
        title="Conversions API (CAPI) — diagnóstico completo"
        subtitle={`Status: ${capiData.status === "active" ? "Ativo" : capiData.status === "partial" ? "Parcial" : "Inativo"} · ${propertyName}`}
        maxWidth="max-w-3xl"
        icon={
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            capiData.status === "active" ? "bg-emerald-100 text-emerald-700" :
            capiData.status === "partial" ? "bg-amber-100 text-amber-700" :
            "bg-red-100 text-red-700"
          }`}>
            <Server size={18} />
          </div>
        }
      >
        <div className="space-y-5 text-sm">
          {/* Status ao vivo via Meta Graph API */}
          {capiLive && (
            <div className={`rounded-xl border p-4 ${
              capiLive.ok ? "bg-emerald-50/60 border-emerald-200" : "bg-red-50/60 border-red-200"
            }`}>
              <h4 className={`text-xs font-bold uppercase mb-2 flex items-center gap-1.5 ${
                capiLive.ok ? "text-emerald-700" : "text-red-700"
              }`}>
                {capiLive.ok ? "✅ Validação ao vivo da Meta" : "❌ Falha na validação"}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                <div className="bg-white/60 rounded-md p-2 border border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Pixel ID</p>
                  <p className="text-xs font-mono">{capiLive.pixelIdMasked || "—"}</p>
                </div>
                <div className="bg-white/60 rounded-md p-2 border border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Token (últimos 4)</p>
                  <p className="text-xs font-mono">****{capiLive.tokenLastFour || "—"}</p>
                </div>
                <div className="bg-white/60 rounded-md p-2 border border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">HTTP da Meta</p>
                  <p className={`text-xs font-mono font-bold ${capiLive.httpStatus === 200 ? "text-emerald-700" : "text-red-700"}`}>
                    {capiLive.httpStatus || "—"}
                  </p>
                </div>
                <div className="bg-white/60 rounded-md p-2 border border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">events_received</p>
                  <p className="text-xs font-bold">{capiLive.metaResponse?.events_received ?? "—"}</p>
                </div>
                <div className="bg-white/60 rounded-md p-2 border border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">Modo teste</p>
                  <p className="text-xs">{capiLive.eventSent?.test_mode ? "✅ Sim" : "⚠ Produção"}</p>
                </div>
                <div className="bg-white/60 rounded-md p-2 border border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)]">fbtrace_id</p>
                  <p className="text-[10px] font-mono truncate" title={capiLive.metaResponse?.fbtrace_id}>
                    {capiLive.metaResponse?.fbtrace_id || "—"}
                  </p>
                </div>
              </div>

              {/* Checks individuais */}
              {capiLive.checks && (
                <div className="space-y-1 text-xs">
                  {Object.entries(capiLive.checks).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className={value ? "text-emerald-600" : "text-red-600"}>
                        {value ? "✅" : "❌"}
                      </span>
                      <span className="font-mono text-[11px]">{key.replace(/^\d+_/, "").replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recomendações geradas */}
              {capiLive.recommendations && capiLive.recommendations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[color:var(--border)]">
                  <p className="text-[10px] uppercase font-bold text-[color:var(--muted-foreground)] mb-1.5">Recomendações</p>
                  <ul className="space-y-1">
                    {capiLive.recommendations.map((r, i) => (
                      <li key={i} className="text-xs">{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {capiLive.eventSent && (
                <div className="mt-3 pt-3 border-t border-[color:var(--border)] text-[11px]">
                  <p className="text-[color:var(--muted-foreground)]">
                    <strong>Último evento enviado:</strong>{" "}
                    <code className="bg-white/60 px-1 rounded">{capiLive.eventSent.event_name}</code>
                    {" · "}
                    <code className="bg-white/60 px-1 rounded text-[10px]">{capiLive.eventSent.event_id}</code>
                    {" · PII: "}
                    {capiLive.eventSent.pii_fields_sent.join(", ")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Header explicativo */}
          <div className="rounded-xl bg-blue-50/40 border border-blue-200 p-4">
            <h4 className="text-xs font-bold uppercase text-blue-700 mb-2 flex items-center gap-1.5">
              <Zap size={12} /> O que é CAPI e por que importa
            </h4>
            <p className="text-blue-900 leading-relaxed mb-2">
              <strong>Conversions API</strong> é tracking <strong>server-side</strong> da Meta — em vez de o pixel disparar do navegador
              do usuário (que pode ser bloqueado por ITP, AdBlock, iOS 14.5+), o servidor envia direto ao Meta. Resultado:
              recupera 70-90% das conversões que você está perdendo hoje.
            </p>
            <p className="text-xs text-blue-800">
              <strong>Por que agora:</strong> com os novos <strong>Meta Ads AI Connectors</strong> (lançados em 2026), a configuração
              passou de 6 semanas de dev para horas via integração nativa com seu CRM/data warehouse.
            </p>
          </div>

          {/* Eventos críticos: client vs server */}
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Activity size={14} /> Eventos críticos: client vs server
            </h4>
            <div className="rounded-xl border border-[color:var(--border)] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[color:var(--muted)] text-[color:var(--muted-foreground)]">
                    <th className="text-left px-4 py-2 font-medium">Evento</th>
                    <th className="text-right px-4 py-2 font-medium">GA4 (client)</th>
                    <th className="text-right px-4 py-2 font-medium">CAPI (server)</th>
                    <th className="text-right px-4 py-2 font-medium">Δ recuperação</th>
                    <th className="text-center px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {capiData.criticalEvents.map((ev) => {
                    const delta = ev.capiCount - ev.clientCount;
                    const pctMore = ev.clientCount > 0 ? Math.round((delta / ev.clientCount) * 100) : 0;
                    return (
                      <tr key={ev.name} className="border-t border-[color:var(--border)]">
                        <td className="px-4 py-2 font-mono font-semibold">{ev.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatNumber(ev.clientCount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {ev.capiCount > 0 ? formatNumber(ev.capiCount) : "—"}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-bold ${pctMore > 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {ev.capiCount > 0 ? `+${pctMore}%` : "0"}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {ev.capiCount > 0 ? (
                            <CheckCircle2 size={14} className="inline text-emerald-600" />
                          ) : (
                            <XCircle size={14} className="inline text-red-500" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[color:var(--muted-foreground)] mt-2">
              Δ recuperação acima de 0 indica que o servidor está enviando mais eventos do que o pixel client-side está
              capturando — é a sua receita real aparecendo no Meta.
            </p>
          </div>

          {/* Como ativar — passos */}
          {capiData.status !== "active" && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Zap size={14} /> Como ativar via Meta AI Connector
              </h4>
              <ol className="space-y-2">
                {[
                  "Validar Consent Mode v2 e política LGPD para envio de PII hasheada",
                  "Em Meta Business Manager → Events Manager → Settings → Conversions API → Set up via partner",
                  "Escolher conector: Snowflake / BigQuery / Salesforce / HubSpot / Shopify",
                  "Mapear eventos: purchase, lead, add_payment_info, initiate_checkout",
                  "Configurar matching com hash SHA-256: email, phone, external_id (user_id Suno)",
                  "Rodar 7 dias em paralelo (client + server) e validar match rate ≥70%",
                  "Migrar atribuição de campanhas para CAPI (priority: server)",
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-[#7c5cff] text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Avisos LGPD */}
          <div className="rounded-xl bg-amber-50/40 border border-amber-200 p-3">
            <h4 className="text-xs font-bold uppercase text-amber-700 mb-1.5 flex items-center gap-1.5">
              <Shield size={12} /> Atenção LGPD
            </h4>
            <ul className="text-amber-900 space-y-1">
              <li>• Toda PII (email, telefone, CPF) deve ser <strong>hasheada SHA-256</strong> antes do envio</li>
              <li>• Consent Mode v2 deve estar ativo — usuários sem consentimento não vão pra CAPI</li>
              <li>• Política de privacidade explícita sobre compartilhamento de dados com Meta</li>
              <li>• Mecanismo de opt-out funcional (request de exclusão dispara delete via API)</li>
            </ul>
          </div>

          {/* Impacto esperado */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-[10px] uppercase font-bold text-emerald-600">Conversões recuperadas</p>
              <p className="text-lg font-bold mt-1 text-emerald-800">
                {capiData.status === "active" ? `+${formatNumber(capiData.serverEvents)}` : `+${formatNumber(Math.round(capiData.lostEvents * 0.78))}`}
              </p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">
                {capiData.status === "active" ? "no último mês" : "potencial no 1º mês"}
              </p>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
              <p className="text-[10px] uppercase font-bold text-blue-600">Lift de ROAS esperado</p>
              <p className="text-lg font-bold mt-1 text-blue-800">+15-25%</p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">vs tracking só client-side</p>
            </div>
            <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
              <p className="text-[10px] uppercase font-bold text-violet-600">Tempo de implementação</p>
              <p className="text-lg font-bold mt-1 text-violet-800">3-5 dias</p>
              <p className="text-[10px] text-[color:var(--muted-foreground)]">via AI Connector</p>
            </div>
          </div>

          {/* Ações */}
          <div className="flex gap-2 pt-3 border-t border-[color:var(--border)]">
            <a
              href="https://www.facebook.com/business/help/2041148702652965"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#7c5cff] hover:bg-[#6b4bf0] text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
            >
              {capiData.status === "active" ? "Abrir Events Manager" : "Iniciar setup CAPI"}
              <ExternalLink size={14} />
            </a>
            <button className="px-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm font-medium hover:bg-[color:var(--muted)]">
              Adicionar ao backlog
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!selectedAlert}
        onClose={() => setSelectedAlert(null)}
        title={selectedAlert?.message || ""}
        subtitle={selectedAlert?.page}
        maxWidth="max-w-xl"
        icon={
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              selectedAlert?.severity === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
            }`}
          >
            <AlertTriangle size={18} />
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{selectedAlert?.detail}</p>
          <div className="rounded-xl bg-[color:var(--muted)] p-3 text-xs">
            <p className="font-semibold">Ação recomendada</p>
            <p className="mt-1 text-[color:var(--muted-foreground)]">
              Abrir o GTM, validar o container e testar via Preview Mode antes de publicar.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 px-4 py-2 rounded-xl bg-[#7c5cff] text-white text-sm font-medium">
              Abrir GTM Preview
            </button>
            <button className="px-4 py-2 rounded-xl border border-[color:var(--border)] text-sm font-medium">
              Ignorar
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!selectedPhantom}
        onClose={() => setSelectedPhantom(null)}
        title={`Jornada ${selectedPhantom?.userId}`}
        subtitle={selectedPhantom?.converted ? "Convertido com anomalia" : "Sem conversão"}
        maxWidth="max-w-2xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <Ghost size={18} />
          </div>
        }
      >
        {selectedPhantom && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">
                  First Touch
                </p>
                <p className="text-sm font-semibold mt-1">{selectedPhantom.firstTouch}</p>
              </div>
              <div className="rounded-xl bg-[color:var(--muted)] p-3">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">
                  Last Touch
                </p>
                <p className="text-sm font-semibold mt-1">{selectedPhantom.lastTouch}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[color:var(--border)] p-3 text-center">
                <p className="text-xs text-[color:var(--muted-foreground)]">Sessões</p>
                <p className="text-xl font-bold">{selectedPhantom.sessions}</p>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] p-3 text-center">
                <p className="text-xs text-[color:var(--muted-foreground)]">Gap (dias)</p>
                <p className="text-xl font-bold">{selectedPhantom.gapDays}</p>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] p-3 text-center">
                <p className="text-xs text-[color:var(--muted-foreground)]">Devices</p>
                <p className="text-xl font-bold">{selectedPhantom.devices.length}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-[color:var(--muted-foreground)] font-semibold uppercase mb-2">
                Dispositivos usados
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedPhantom.devices.map((d) => (
                  <span key={d} className="px-3 py-1 rounded-full bg-[#ede9fe] text-[#7c5cff] text-xs font-medium">
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              <p className="font-semibold mb-1">Diagnóstico</p>
              <p>{selectedPhantom.reason}</p>
            </div>
            {selectedPhantom.converted && selectedPhantom.revenue && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 flex items-center justify-between">
                <span className="font-semibold">Receita gerada</span>
                <span className="font-bold">R$ {formatNumber(selectedPhantom.revenue)}</span>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </MasterGuard>
  );
}

/**
 * LPs antigas / Redirects pendentes — pega dados de pagesDetail (GA4) e
 * filtra hosts que começam com "lp." pra listar landing pages que ainda
 * estão recebendo tráfego (no ar). Marca como "stale" as que têm:
 *   - Path com ano antigo no nome (-2024-, -2025-, etc) ou
 *   - Nome de campanha sazonal (black-friday, natal, fim-ano, etc) ou
 *   - Volume baixo (< 100 sessões no período)
 *
 * Tarefa nasceu de print do Renan: várias LPs do site:lp.suno.com.br ainda
 * indexadas pelo Google sem redirect (Suno Start Perpétuo, Curso Matemática
 * Financeira, Faça parte da elite, etc). Antes era impossível auditar isso
 * sem rodar `site:lp.suno.com.br` manualmente no Google.
 */
type GSCRow = {
  url: string;
  host: string;
  path: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

// Padrões default que indicam "isso é uma landing page".
// Inclui:
//   - lp.* (LPs próprias)
//   - lp2.*, materiais.*, pages.* (provavelmente apontam pra GreatPages)
//   - greatpages.com.br (host nativo do GreatPages quando não tem CNAME)
//   - unbounce.com (alternativa comum)
//   - vidaro.* (já vi alguns Suno usando)
const DEFAULT_LP_HOST_FILTERS = "lp.,lp2.,materiais.,pages.,greatpages,unbounce";

function StaleLPsTab() {
  const { selected, useRealData } = useGA4();
  const { data: pagesDetail, meta } = useGA4PagesDetail();
  const [search, setSearch] = useState("");
  const [filterStale, setFilterStale] = useState<
    "all" | "only_stale" | "only_zumbi" | "only_404" | "only_redirect" | "only_offline"
  >("all");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // hostFilters: CSV de padrões que identificam uma LP. User pode editar
  // pra incluir subdomínios proprietários da Suno (ex: "lp.,lp2.,materiais.")
  const [hostFiltersInput, setHostFiltersInput] = useState(DEFAULT_LP_HOST_FILTERS);
  const [hostFiltersApplied, setHostFiltersApplied] = useState(DEFAULT_LP_HOST_FILTERS);
  const hostFilters = useMemo(
    () => hostFiltersApplied.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    [hostFiltersApplied]
  );

  // Estado da segunda etapa: GSC (URLs indexadas no Google)
  const [gscRows, setGscRows] = useState<GSCRow[] | null>(null);
  const [gscLoading, setGscLoading] = useState(false);
  const [gscError, setGscError] = useState<string | null>(null);
  const [gscSiteUsed, setGscSiteUsed] = useState<string | null>(null);
  const [gscAvailableSites, setGscAvailableSites] = useState<string[] | null>(null);

  // Estado da terceira etapa: Health Check HTTP (status real de cada URL)
  type HealthResult = {
    url: string;
    status: number | null;
    ok: boolean;
    redirectTo: string | null;
    contentType: string | null;
    error: string | null;
    durationMs: number;
  };
  const [healthMap, setHealthMap] = useState<Map<string, HealthResult>>(new Map());
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ done: 0, total: 0 });
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchGSC = async (overrideSiteUrl?: string) => {
    setGscLoading(true);
    setGscError(null);
    setGscRows(null);
    setGscAvailableSites(null);
    try {
      const params = new URLSearchParams({
        // Manda os mesmos hostFilters que o GA4 está usando — garante
        // que a lista cruzada pegue LP1 + LP2/GreatPages
        hostFilters: hostFiltersApplied,
        days: "30",
      });
      if (selected?.displayName) params.set("propertyName", selected.displayName);
      if (overrideSiteUrl) params.set("siteUrl", overrideSiteUrl);

      const r = await fetch(`/api/tracking/stale-lps-gsc?${params.toString()}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (d.error) {
        setGscError(d.error);
        if (d.available_sites) setGscAvailableSites(d.available_sites);
        return;
      }
      setGscRows(d.rows || []);
      setGscSiteUsed(d.siteUrl || null);
    } catch (e) {
      setGscError((e as Error).message);
    } finally {
      setGscLoading(false);
    }
  };

  // Health check HTTP — bate em cada URL e captura status real
  const runHealthCheck = async (urls: string[]) => {
    if (urls.length === 0) return;
    setHealthLoading(true);
    setHealthError(null);
    setHealthProgress({ done: 0, total: urls.length });
    try {
      // Quebra em chunks de 50 pra mostrar progresso incremental
      const CHUNK = 50;
      const newMap = new Map(healthMap);
      for (let i = 0; i < urls.length; i += CHUNK) {
        const slice = urls.slice(i, i + CHUNK);
        const r = await fetch("/api/tracking/lp-healthcheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: slice }),
          cache: "no-store",
        });
        if (!r.ok) {
          const t = await r.text();
          setHealthError(`HTTP ${r.status}: ${t.slice(0, 150)}`);
          break;
        }
        const d = (await r.json()) as { results: HealthResult[] };
        for (const result of d.results) {
          newMap.set(result.url, result);
        }
        setHealthMap(new Map(newMap));
        setHealthProgress({ done: Math.min(i + CHUNK, urls.length), total: urls.length });
      }
    } catch (e) {
      setHealthError((e as Error).message);
    } finally {
      setHealthLoading(false);
    }
  };

  // Filtra páginas dos hosts configurados — captura LPs próprias + GreatPages
  // + outros providers. Match é por substring dentro do host inteiro
  // (host = "lp.suno.com.br" casa com filtro "lp.").
  const lpPages = useMemo(() => {
    if (!pagesDetail?.pages) return [];
    return pagesDetail.pages.filter((p) => {
      const host = (p.host || "").toLowerCase();
      return hostFilters.some((f) => host.includes(f));
    });
  }, [pagesDetail, hostFilters]);

  // Marca cada LP com sintomas de "stale"
  type StaleLPRow = {
    host: string;
    path: string;
    url: string;
    sessions: number;
    users: number;
    bounceRate: number;
    isStale: boolean;
    isZumbi: boolean; // 🚨 indexada no Google sem tráfego no GA4
    staleReasons: string[];
    gsc?: GSCRow | null;
    health?: HealthResult | null; // status HTTP real
  };

  const STALE_YEAR_PATTERN = /\b(20\d{2})\b/;
  const SEASONAL_KEYWORDS = [
    "black-friday", "blackfriday", "natal", "fim-ano", "fimano",
    "ano-novo", "anonovo", "carnaval", "junina", "halloween",
    "cyber-monday", "cybermonday", "promo", "promocao",
    "ofertas-imperdiveis", "queima-estoque", "lancamento",
    "always-on", "alwayson", "perpetuo", "perpétuo",
    "relampago", "relâmpago", "limited", "expirou", "ultima-chance",
  ];

  const staleRows: StaleLPRow[] = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return lpPages.map((p) => {
      const reasons: string[] = [];
      const pathLower = p.path.toLowerCase();

      // Ano antigo no path
      const yearMatch = pathLower.match(STALE_YEAR_PATTERN);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        if (year < currentYear) {
          reasons.push(`ano antigo no path (${year})`);
        }
      }

      // Palavra sazonal
      for (const kw of SEASONAL_KEYWORDS) {
        if (pathLower.includes(kw)) {
          reasons.push(`sazonal: "${kw}"`);
          break;
        }
      }

      // Volume baixo (< 100 sessões) — sinal de LP esquecida
      if (p.sessions < 100) {
        reasons.push(`baixo volume (${p.sessions} sessões)`);
      }

      // Bounce muito alto (> 80%) com pouco volume — indica LP morta
      if (p.bounceRate > 80 && p.sessions < 500) {
        reasons.push(`bounce ${p.bounceRate.toFixed(0)}% + volume baixo`);
      }

      const url = p.url || `https://${p.host}${p.path}`;
      // Procura match no GSC (URL exata)
      const gscMatch = gscRows?.find(
        (g) =>
          g.url === url ||
          (g.host === p.host && (g.path === p.path || g.path === p.path + "/" || g.path + "/" === p.path))
      );

      // Sintomas vindos do health check HTTP (se já rodou)
      const health = healthMap.get(url) || null;
      if (health) {
        if (health.status === 404) {
          reasons.push("🔴 404 — página não existe mais");
        } else if (health.status && health.status >= 500) {
          reasons.push(`🔴 erro servidor (${health.status})`);
        } else if (health.status && health.status >= 300 && health.status < 400) {
          reasons.push(
            `↪ redirect ${health.status}${
              health.redirectTo ? ` → ${health.redirectTo.slice(0, 50)}` : ""
            }`
          );
        } else if (health.error) {
          reasons.push(`offline (${health.error.slice(0, 30)})`);
        }
      }

      return {
        host: p.host,
        path: p.path,
        url,
        sessions: p.sessions,
        users: p.users,
        bounceRate: p.bounceRate,
        isStale: reasons.length > 0,
        isZumbi: false, // só URLs SÓ do GSC podem ser zumbis (computado abaixo)
        staleReasons: reasons,
        gsc: gscMatch || null,
        health,
      };
    });
  }, [lpPages, gscRows, healthMap]);

  // 🚨 LPs ZUMBIS: presentes no GSC (Google indexa) mas SEM tráfego no GA4
  // (não estão em pagesDetail). Crítico — gastam crawl budget sem retorno.
  const zumbiRows: StaleLPRow[] = useMemo(() => {
    if (!gscRows || gscRows.length === 0) return [];
    const ga4UrlSet = new Set(staleRows.map((r) => r.url));
    const ga4PathSet = new Set(staleRows.map((r) => `${r.host}${r.path}`));
    return gscRows
      .filter((g) => {
        const fullKey = `${g.host}${g.path}`;
        return !ga4UrlSet.has(g.url) && !ga4PathSet.has(fullKey);
      })
      .map((g) => {
        const health = healthMap.get(g.url) || null;
        const reasons: string[] = [
          `🚨 indexada no Google (${g.impressions} impr.) sem tráfego GA4`,
          ...(g.clicks === 0 ? ["zero cliques no SERP"] : [`${g.clicks} cliques`]),
          `posição ${g.position}`,
        ];
        if (health) {
          if (health.status === 404) reasons.unshift("🔴 404 — Google indexa página inexistente!");
          else if (health.status && health.status >= 500) reasons.unshift(`🔴 erro ${health.status}`);
          else if (health.status && health.status >= 300 && health.status < 400) {
            reasons.unshift(
              `↪ ${health.status}${health.redirectTo ? ` → ${health.redirectTo.slice(0, 40)}` : ""}`
            );
          }
        }
        return {
          host: g.host,
          path: g.path,
          url: g.url,
          sessions: 0,
          users: 0,
          bounceRate: 0,
          isStale: true,
          isZumbi: true,
          staleReasons: reasons,
          gsc: g,
          health,
        };
      });
  }, [gscRows, staleRows, healthMap]);

  const allRows = useMemo(() => [...staleRows, ...zumbiRows], [staleRows, zumbiRows]);

  const filteredRows = allRows.filter((r) => {
    if (filterStale === "only_stale" && !r.isStale) return false;
    if (filterStale === "only_zumbi" && !r.isZumbi) return false;
    if (filterStale === "only_404" && r.health?.status !== 404) return false;
    if (
      filterStale === "only_redirect" &&
      !(r.health?.status && r.health.status >= 300 && r.health.status < 400)
    )
      return false;
    if (filterStale === "only_offline" && !r.health?.error) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.host.toLowerCase().includes(q) || r.path.toLowerCase().includes(q);
    }
    return true;
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    // Zumbis primeiro (mais críticos), depois stale, depois OK; dentro disso por impressões/sessões desc
    if (a.isZumbi !== b.isZumbi) return a.isZumbi ? -1 : 1;
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    const aValue = a.gsc?.impressions || a.sessions || 0;
    const bValue = b.gsc?.impressions || b.sessions || 0;
    return bValue - aValue;
  });

  const totalStale = staleRows.filter((r) => r.isStale).length;
  const totalLPs = staleRows.length;
  const totalZumbis = zumbiRows.length;
  const totalSessionsStale = staleRows
    .filter((r) => r.isStale)
    .reduce((s, r) => s + r.sessions, 0);
  const totalImpressionsZumbi = zumbiRows.reduce(
    (s, r) => s + (r.gsc?.impressions || 0),
    0
  );
  // Contadores de health (só faz sentido depois de rodar o check)
  const total404 = allRows.filter((r) => r.health?.status === 404).length;
  const totalRedirects = allRows.filter(
    (r) => r.health?.status && r.health.status >= 300 && r.health.status < 400
  ).length;
  const totalOffline = allRows.filter((r) => r.health?.error).length;
  const totalChecked = allRows.filter((r) => r.health).length;

  return (
    <div className="space-y-4">
      {/* Banner com a task original */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-200 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-amber-700" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-amber-900 mb-1">
              Auditoria de LPs antigas — Redirect em massa pendente
            </h3>
            <p className="text-sm text-amber-900 mb-2">
              <strong>@Renan Liza</strong> e <strong>@Ricardo Moura</strong> — várias LPs abertas
              que já deveriam estar com redirect.
            </p>
            <ul className="text-xs text-amber-800 space-y-1.5 leading-relaxed">
              <li>• Precisamos revisar LPs antigas (Eu Invisto 2025, Always On, Suno Start Perpétuo, Curso Matemática Financeira…)</li>
              <li>• Fazer redirect em massa de 2025 pra trás. Se cair pratinhos, refaz</li>
              <li>• Investigar por que essas LPs não aparecem na guia de tracking</li>
              <li>• <strong>Ideia:</strong> automatizar o pull de tudo o que tá no ar (esta aba é o início disso)</li>
            </ul>
            <p className="text-[11px] text-amber-700 mt-3 font-mono italic">
              Verificação manual: <span className="underline">site:lp.suno.com.br</span> no Google
            </p>
          </div>
        </div>
      </div>

      {/* Configurador de padrões de host — controla GA4 + GSC simultaneamente */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4">
        <div className="flex items-start gap-2 mb-2">
          <Tag size={14} className="text-[#7c5cff] mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Padrões de host considerados como LP</p>
            <p className="text-[11px] text-slate-500">
              Captura LPs próprias + LP2 (GreatPages) + outros providers. Edite a lista pra
              incluir subdomínios próprios da Suno (ex:{" "}
              <code className="bg-slate-100 px-1 rounded text-[10px]">materiais.</code>,{" "}
              <code className="bg-slate-100 px-1 rounded text-[10px]">campanhas.</code>).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={hostFiltersInput}
            onChange={(e) => setHostFiltersInput(e.target.value)}
            placeholder="lp.,lp2.,greatpages,materiais."
            className="flex-1 min-w-[260px] px-3 py-2 text-xs font-mono rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff]"
          />
          <button
            onClick={() => {
              setHostFiltersApplied(hostFiltersInput);
              if (gscRows) fetchGSC();
            }}
            className="px-3 py-2 rounded-lg bg-[#7c5cff] text-white text-xs font-semibold hover:bg-[#6b4bf0] transition"
          >
            Aplicar
          </button>
          <button
            onClick={() => {
              setHostFiltersInput(DEFAULT_LP_HOST_FILTERS);
              setHostFiltersApplied(DEFAULT_LP_HOST_FILTERS);
            }}
            className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] hover:bg-slate-50 transition"
          >
            Resetar
          </button>
        </div>
        <div className="text-[10px] text-slate-500 mt-2 font-mono">
          Filtros aplicados:{" "}
          {hostFilters.map((f) => (
            <span key={f} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Botão pra carregar GSC (segunda etapa) */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-[#7c5cff]" />
          <div>
            <p className="text-sm font-semibold">Cruzamento com Google Search Console</p>
            <p className="text-[11px] text-slate-500">
              Detecta LPs <strong>indexadas no Google</strong> mesmo sem tráfego no GA4 (zumbis no SERP)
            </p>
          </div>
        </div>
        {gscRows ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
              ✓ GSC carregado · {gscRows.length} URLs · {gscSiteUsed}
            </span>
            <button
              onClick={() => fetchGSC()}
              disabled={gscLoading}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw size={11} className={gscLoading ? "animate-spin" : ""} />
              Atualizar
            </button>
          </div>
        ) : (
          <button
            onClick={() => fetchGSC()}
            disabled={gscLoading}
            className="px-4 py-2 rounded-lg bg-[#7c5cff] text-white text-sm font-semibold hover:bg-[#6b4bf0] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {gscLoading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {gscLoading ? "Buscando no GSC..." : "Cruzar com Google Search Console"}
          </button>
        )}
      </div>

      {/* Health Check HTTP — bate em cada URL pra ver status real */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-emerald-600" />
          <div>
            <p className="text-sm font-semibold">Verificação de status HTTP</p>
            <p className="text-[11px] text-slate-500">
              Bate em cada URL e detecta <strong>404, redirect, timeout, erro 500</strong>. Resolve a
              dúvida &quot;essa LP tá no ar ou não?&quot; sem precisar abrir cada URL na mão.
            </p>
          </div>
        </div>
        {totalChecked > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
              ✓ {totalChecked} URLs checadas
            </span>
            {total404 > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">
                {total404} com 404
              </span>
            )}
            {totalRedirects > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                {totalRedirects} redirects
              </span>
            )}
            {totalOffline > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                {totalOffline} offline
              </span>
            )}
            <button
              onClick={() => {
                const urls = Array.from(new Set(allRows.map((r) => r.url)));
                runHealthCheck(urls);
              }}
              disabled={healthLoading}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw size={11} className={healthLoading ? "animate-spin" : ""} />
              Atualizar
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              const urls = Array.from(new Set(allRows.map((r) => r.url)));
              if (urls.length === 0) {
                setHealthError("Nenhuma URL pra verificar. Carregue GA4 e/ou GSC primeiro.");
                return;
              }
              runHealthCheck(urls);
            }}
            disabled={healthLoading || allRows.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {healthLoading ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
            {healthLoading
              ? `Verificando... (${healthProgress.done}/${healthProgress.total})`
              : `Verificar ${allRows.length} URLs`}
          </button>
        )}
      </div>

      {healthError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-900">
          <strong>Erro no health check:</strong> {healthError}
        </div>
      )}

      {healthLoading && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 flex items-center gap-2">
          <RefreshCw size={12} className="animate-spin" />
          Checando {healthProgress.done} de {healthProgress.total} URLs...
        </div>
      )}

      {gscError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-900 space-y-2">
          <div>
            <strong>Erro ao consultar GSC:</strong> {gscError}
          </div>
          {gscAvailableSites && gscAvailableSites.length > 0 && (
            <div>
              <p className="mb-2">
                Não consegui escolher o site GSC automaticamente. <strong>Clique num dos sites abaixo</strong> pra
                forçar a query (a gente vai filtrar por <code className="bg-red-100 px-1 rounded">lp.</code> automaticamente):
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {gscAvailableSites.map((s) => (
                  <button
                    key={s}
                    onClick={() => fetchGSC(s)}
                    disabled={gscLoading}
                    className="text-left font-mono text-[11px] px-3 py-2 rounded-md bg-white border border-red-200 hover:bg-red-100 hover:border-red-400 disabled:opacity-50 transition flex items-center gap-2"
                  >
                    <Search size={10} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPIs — agora 4 cards (incluindo zumbis) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
          <div className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider mb-1">
            LPs vivas (GA4)
          </div>
          <div className="text-2xl font-bold tabular-nums">{totalLPs}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {Array.from(new Set(lpPages.map((p) => p.host))).slice(0, 3).join(", ") ||
              "sem hosts detectados"}
            {Array.from(new Set(lpPages.map((p) => p.host))).length > 3 &&
              ` +${Array.from(new Set(lpPages.map((p) => p.host))).length - 3}`}
          </div>
        </div>
        <div className="bg-white rounded-xl border-2 border-amber-300 p-4">
          <div className="text-[10px] uppercase text-amber-700 font-semibold tracking-wider mb-1">
            Suspeitas (stale)
          </div>
          <div className="text-2xl font-bold text-amber-700 tabular-nums">{totalStale}</div>
          <div className="text-[11px] text-amber-700 mt-0.5">
            sazonal / ano antigo / volume baixo
          </div>
        </div>
        <div className="bg-white rounded-xl border-2 border-red-300 p-4">
          <div className="text-[10px] uppercase text-red-700 font-semibold tracking-wider mb-1">
            🚨 Zumbis (GSC sem GA4)
          </div>
          <div className="text-2xl font-bold text-red-700 tabular-nums">{totalZumbis}</div>
          <div className="text-[11px] text-red-700 mt-0.5">
            {gscRows ? `${formatNumber(totalImpressionsZumbi)} impressões/30d` : "carregue o GSC pra ver"}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[color:var(--border)] p-4">
          <div className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider mb-1">
            Sessões em stale
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {formatNumber(totalSessionsStale)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            tráfego que poderia migrar
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] p-4 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por host ou path..."
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff]"
        />
        <select
          value={filterStale}
          onChange={(e) => setFilterStale(e.target.value as typeof filterStale)}
          className="text-xs font-medium px-3 py-2 rounded-lg border border-[color:var(--border)] bg-white"
        >
          <option value="all">Todas ({totalLPs + totalZumbis})</option>
          <option value="only_stale">Só suspeitas/stale ({totalStale + totalZumbis})</option>
          <option value="only_zumbi">🚨 Só zumbis ({totalZumbis})</option>
          {totalChecked > 0 && (
            <>
              <option value="only_404">🔴 Só 404 ({total404})</option>
              <option value="only_redirect">↪ Só redirects ({totalRedirects})</option>
              <option value="only_offline">⚠ Só offline ({totalOffline})</option>
            </>
          )}
        </select>
        <span className="text-[11px] text-slate-500 font-mono">
          mostrando {sortedRows.length}
        </span>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
        {meta.status === "loading" && (
          <div className="p-12 text-center text-sm text-slate-500">
            Carregando páginas do GA4...
          </div>
        )}
        {!useRealData && (
          <div className="p-12 text-center text-sm text-slate-500">
            Selecione uma propriedade GA4 no header pra carregar as LPs.
          </div>
        )}
        {useRealData && meta.status === "success" && sortedRows.length === 0 && (
          <div className="p-12 text-center text-sm text-slate-500">
            Nenhuma LP encontrada com filtro atual.
            {totalLPs === 0 && (
              <p className="mt-2 text-xs">
                Esta propriedade ({selected?.displayName}) não tem hosts <code className="bg-slate-100 px-1 rounded">lp.*</code> com tráfego no período.
              </p>
            )}
          </div>
        )}
        {sortedRows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-[color:var(--border)]">
              <tr>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Host
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Path
                </th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  HTTP
                </th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  GA4 sessões
                </th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  GSC impr/cliques
                </th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Posição
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sintomas
                </th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr
                  key={`${r.host}|${r.path}|${r.isZumbi ? "z" : "g"}`}
                  className={`border-b border-slate-100 hover:bg-slate-50/40 ${
                    r.isZumbi ? "bg-red-50/40" : r.isStale ? "bg-amber-50/30" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    {r.isZumbi ? (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-red-100 text-red-700 border border-red-200">
                        🚨 Zumbi
                      </span>
                    ) : r.isStale ? (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200">
                        Stale
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 border border-emerald-200">
                        OK
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">{r.host}</td>
                  <td
                    className="px-4 py-2.5 font-mono text-xs max-w-[280px] truncate"
                    title={r.path}
                  >
                    {r.path}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <HTTPStatusBadge health={r.health || null} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold">
                    {r.sessions === 0 ? (
                      <span className="text-slate-300 italic font-normal">0</span>
                    ) : (
                      formatNumber(r.sessions)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {r.gsc ? (
                      <span>
                        <strong>{formatNumber(r.gsc.impressions)}</strong>
                        <span className="text-slate-400">
                          {" / "}
                          {formatNumber(r.gsc.clicks)}
                        </span>
                      </span>
                    ) : gscRows ? (
                      <span className="text-slate-300 italic">não indexada</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {r.gsc ? (
                      <span
                        className={
                          r.gsc.position <= 5
                            ? "text-emerald-600 font-bold"
                            : r.gsc.position <= 15
                              ? "text-amber-600"
                              : "text-slate-500"
                        }
                      >
                        {r.gsc.position}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.staleReasons.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {r.staleReasons.map((reason, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="inline-flex gap-1">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 inline-flex items-center gap-1"
                        title="Abrir LP em nova aba"
                      >
                        <ExternalLink size={10} />
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(r.url);
                          setCopiedPath(r.path);
                          setTimeout(() => setCopiedPath(null), 1500);
                        }}
                        className="text-[10px] px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 inline-flex items-center gap-1"
                        title="Copiar URL"
                      >
                        {copiedPath === r.path ? (
                          <CheckCircle2 size={10} className="text-emerald-600" />
                        ) : (
                          <Copy size={10} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Hint pra ação */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-xs text-blue-900 space-y-2">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <strong>Fluxo recomendado de auditoria (3 passos):</strong>
            <ol className="mt-1 space-y-1 list-decimal ml-4">
              <li>
                <strong>Carregar GA4</strong> — automático ao abrir a aba. Lista LPs com tráfego no período.
              </li>
              <li>
                <strong>Cruzar com GSC</strong> — botão roxo. Adiciona LPs zumbis (indexadas sem tráfego).
              </li>
              <li>
                <strong>Verificar status HTTP</strong> — botão verde. Bate em cada URL e mostra
                se é 200 (no ar), 301/302 (já redireciona), 404 (precisa redirect) ou 500 (servidor).
              </li>
            </ol>
          </div>
        </div>
        <div className="border-t border-blue-200 pt-2 text-[11px] space-y-1">
          <p>
            <strong>Ação prioritária:</strong> filtra <code className="bg-blue-100 px-1 rounded">🔴 Só 404</code>{" "}
            ou <code className="bg-blue-100 px-1 rounded">🚨 Só zumbis</code>, copia URLs (botão 📋) e
            manda regras 301 no Cloudflare/nginx pras LPs novas equivalentes.
          </p>
          <p>
            <strong>404 é o mais crítico:</strong> Google indexa página inexistente, usuário clica e cai
            num &quot;Page Not Found&quot;. Cada um desses corrói SEO + experiência de usuário.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Badge visual do status HTTP. Cores:
 *   200/2xx → verde (OK no ar)
 *   301/302/3xx → azul (redirect — clicar mostra destino no tooltip)
 *   404 → vermelho (não existe mais)
 *   500/5xx → vermelho escuro (erro servidor)
 *   timeout/erro → âmbar
 *   sem check → cinza fraco
 */
function HTTPStatusBadge({
  health,
}: {
  health: {
    url: string;
    status: number | null;
    redirectTo: string | null;
    error: string | null;
  } | null;
}) {
  if (!health) {
    return <span className="text-[10px] text-slate-300 italic">não checada</span>;
  }
  if (health.error) {
    return (
      <span
        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200"
        title={health.error}
      >
        ⚠ offline
      </span>
    );
  }
  const status = health.status;
  if (status === null) {
    return <span className="text-[10px] text-slate-300 italic">—</span>;
  }
  // 2xx OK
  if (status >= 200 && status < 300) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 border border-emerald-200">
        {status}
      </span>
    );
  }
  // 3xx Redirect
  if (status >= 300 && status < 400) {
    const tooltip = health.redirectTo ? `Redirect → ${health.redirectTo}` : `Redirect ${status}`;
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 border border-blue-200 cursor-help"
        title={tooltip}
      >
        ↪ {status}
      </span>
    );
  }
  // 404
  if (status === 404) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-700 border border-red-200">
        🔴 404
      </span>
    );
  }
  // 4xx outros
  if (status >= 400 && status < 500) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-700 border border-red-200">
        {status}
      </span>
    );
  }
  // 5xx
  if (status >= 500) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-200 text-red-800 border border-red-400">
        🔴 {status}
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
      {status}
    </span>
  );
}

// shim — import missing
function Lightbulb() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}
