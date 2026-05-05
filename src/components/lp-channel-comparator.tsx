"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  X,
  BarChart3,
  Users,
  Activity,
  Loader2,
  AlertCircle,
  Info,
  Target,
  TrendingDown,
  Download,
  FileText,
  FileSpreadsheet,
  ChevronDown,
} from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import {
  useGA4LPChannels,
  useGA4,
  type LPBreakdownDimension,
} from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Comparativo de Landing Pages × Dimensão (canal, fonte, campanha, etc.).
 *
 * Métricas exibidas:
 *   - Users
 *   - Sessões
 *   - Sessões engajadas
 *   - Bounce rate (média ponderada)
 *   - Conversões (key events)
 *
 * Sobre filtragem por audiência custom (ex.: "SUNO"):
 * a Data API v1 do GA4 NÃO permite filtrar por nome de audiência custom em
 * queries normais. Caminhos pra ativar:
 *   1. Audience Export no GA4 admin → ID nas chamadas runReport
 *   2. Custom Dimension de usuário gravando o nome via dataLayer
 * Por isso o seletor abaixo cobre as dimensões padrão GA4 que ajudam a chegar
 * perto do mesmo recorte (ex.: "campaign" pra campanhas marcadas).
 */

const CHANNEL_COLORS: Record<string, string> = {
  Direct: "#64748b",
  "Organic Search": "#10b981",
  "Paid Search": "#3b82f6",
  "Organic Social": "#a855f7",
  "Paid Social": "#ec4899",
  Email: "#f59e0b",
  Referral: "#06b6d4",
  Display: "#6366f1",
  Video: "#ef4444",
  Affiliates: "#14b8a6",
  Audio: "#f97316",
  SMS: "#84cc16",
  "Push Notifications": "#8b5cf6",
  "(not set)": "#94a3b8",
  Unassigned: "#94a3b8",
};

function colorFor(label: string): string {
  if (CHANNEL_COLORS[label]) return CHANNEL_COLORS[label];
  // Hash simples pra atribuir cor estável a labels custom
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  const palette = [
    "#7c5cff",
    "#10b981",
    "#3b82f6",
    "#a855f7",
    "#ec4899",
    "#f59e0b",
    "#06b6d4",
    "#6366f1",
    "#ef4444",
    "#14b8a6",
  ];
  return palette[Math.abs(h) % palette.length];
}

const DIMENSION_OPTIONS: {
  value: LPBreakdownDimension;
  label: string;
  description: string;
}[] = [
  { value: "channel", label: "Canal padrão", description: "Direct, Organic Search, Paid Search, etc." },
  { value: "sourceMedium", label: "Fonte / Meio", description: "google / cpc, facebook / paid_social..." },
  { value: "source", label: "Fonte", description: "google, facebook, instagram, direct..." },
  { value: "medium", label: "Meio", description: "cpc, organic, email, social..." },
  { value: "campaign", label: "Campanha", description: "Nome da campanha (utm_campaign)" },
  { value: "deviceCategory", label: "Dispositivo", description: "desktop, mobile, tablet" },
  { value: "country", label: "País", description: "Brasil, EUA, Portugal..." },
];

export function LPChannelComparator({ initialUrls = [] }: { initialUrls?: string[] }) {
  const { selected, useRealData } = useGA4();
  const [pendingUrls, setPendingUrls] = useState<string[]>(initialUrls);
  const [submittedUrls, setSubmittedUrls] = useState<string[]>(initialUrls);
  const [inputValue, setInputValue] = useState("");
  const [breakdownDimension, setBreakdownDimension] =
    useState<LPBreakdownDimension>("channel");
  const [showAudienceNote, setShowAudienceNote] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Ref na raiz do componente — html-to-image captura tudo dentro daqui
  const captureRef = useRef<HTMLDivElement>(null);
  // Ref no menu de export pra fechar quando clicar fora
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Fecha o menu quando clica fora dele
  useEffect(() => {
    if (!exportMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setExportMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [exportMenuOpen]);
  const { results, loading, error } = useGA4LPChannels(
    submittedUrls,
    undefined,
    breakdownDimension
  );

  const dimMeta =
    DIMENSION_OPTIONS.find((d) => d.value === breakdownDimension) || DIMENSION_OPTIONS[0];

  function addUrl() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (pendingUrls.includes(trimmed)) {
      setInputValue("");
      return;
    }
    if (pendingUrls.length >= 20) {
      alert("Limite de 20 URLs por comparação.");
      return;
    }
    setPendingUrls([...pendingUrls, trimmed]);
    setInputValue("");
  }

  function removeUrl(url: string) {
    setPendingUrls(pendingUrls.filter((u) => u !== url));
  }

  function compare() {
    setSubmittedUrls([...pendingUrls]);
  }

  // Universo de labels (canais ou outra dim) que aparecem em qualquer LP
  // Declarado ANTES das funções de export para serem acessível nelas.
  const allLabels = Array.from(
    new Set(results.flatMap((r) => r.byChannel.map((c) => c.label)))
  ).sort();

  /**
   * Helper: gera o slug do nome de arquivo padrão.
   */
  function buildFileSlug(): string {
    const propertySlug = (selected?.displayName || "demo")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const dateSlug = new Date().toISOString().slice(0, 10);
    return `comparativo-lps-${propertySlug}-${breakdownDimension}-${dateSlug}`;
  }

  /**
   * Exporta a área do comparador como PDF (A4 paisagem) — converte primeiro pra
   * PNG via html-to-image e depois encaixa a imagem em uma ou mais páginas A4.
   *
   * Vantagem do PDF vs PNG: zoom infinito sem perda, abre em qualquer device,
   * é o formato esperado pra relatórios formais.
   */
  async function handleExportPDF() {
    if (!captureRef.current) return;
    setExporting(true);
    try {
      // Aguarda 50ms pra animações framer-motion settle
      await new Promise((r) => setTimeout(r, 50));

      const dataUrl = await toPng(captureRef.current, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
        filter: (node) => {
          if (node instanceof HTMLElement) {
            return !node.hasAttribute("data-export-hide");
          }
          return true;
        },
      });

      // Cria PDF A4 paisagem (formato relatório)
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth(); // 297mm
      const pageHeight = pdf.internal.pageSize.getHeight(); // 210mm
      const margin = 8;

      // Carrega a imagem pra calcular proporções
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = dataUrl;
      });

      // Largura total disponível
      const availableWidth = pageWidth - margin * 2;
      // Mantém proporção
      const ratio = availableWidth / img.width;
      const totalHeight = img.height * ratio;
      const availableHeight = pageHeight - margin * 2;

      if (totalHeight <= availableHeight) {
        // Cabe em 1 página
        pdf.addImage(dataUrl, "PNG", margin, margin, availableWidth, totalHeight, undefined, "FAST");
      } else {
        // Quebra em múltiplas páginas — desenha a mesma imagem deslocando o Y
        // até cobrir todo o conteúdo.
        let renderedHeight = 0;
        let pageIndex = 0;
        while (renderedHeight < totalHeight) {
          if (pageIndex > 0) pdf.addPage();
          const yOffset = margin - renderedHeight;
          pdf.addImage(dataUrl, "PNG", margin, yOffset, availableWidth, totalHeight, undefined, "FAST");
          renderedHeight += availableHeight;
          pageIndex++;
          // Limite de segurança (10 páginas) — relatório nunca deve precisar de mais
          if (pageIndex > 10) break;
        }
      }

      // Footer leve com data e nome da property
      const propertyName = selected?.displayName || "Modo demo";
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        `${propertyName} · Quebrado por: ${dimMeta.label} · Gerado em ${new Date().toLocaleString("pt-BR")}`,
        margin,
        pageHeight - 4
      );

      pdf.save(`${buildFileSlug()}.pdf`);
    } catch (e) {
      console.error("Erro ao exportar PDF:", e);
      alert("Erro ao gerar PDF. Tenta de novo em 2s — se persistir, me avisa.");
    } finally {
      setExporting(false);
    }
  }

  /**
   * Exporta a comparação como Excel (.xlsx) com 3 sheets:
   *   1. "Resumo"        — uma linha por LP com totais (5 métricas)
   *   2. "Detalhado"     — uma linha por LP × dimensão (analítico, ideal pra pivot)
   *   3. "Cruzado"       — tabela pivotada: rows = dimensão, cols = LP, célula = users
   *
   * Quem abre o Excel já consegue manipular sem precisar do painel.
   */
  function handleExportExcel() {
    if (results.length === 0) return;

    const propertyDisplay = selected?.displayName || "Demo";
    const fileName = `${buildFileSlug()}.xlsx`;

    const wb = XLSX.utils.book_new();

    // --- SHEET 1: Resumo ---
    const summaryRows: (string | number)[][] = [
      [`Comparativo de Landing Pages — ${propertyDisplay}`],
      [`Quebrado por: ${dimMeta.label} (${dimMeta.description})`],
      [`Gerado em: ${new Date().toLocaleString("pt-BR")}`],
      [""],
      [
        "#",
        "Landing Page",
        "Users",
        "Sessões",
        "Sessões engajadas",
        "Taxa engajamento (%)",
        "Bounce rate (%)",
        "Conversões",
        "Conv. / 1k sessões",
      ],
    ];
    results.forEach((r, i) => {
      const engRate = r.totalSessions > 0 ? (r.totalEngagedSessions / r.totalSessions) * 100 : 0;
      const convPer1k = r.totalSessions > 0 ? (r.totalConversions / r.totalSessions) * 1000 : 0;
      summaryRows.push([
        i + 1,
        r.url,
        r.totalUsers,
        r.totalSessions,
        r.totalEngagedSessions,
        Number(engRate.toFixed(1)),
        r.avgBounceRate,
        r.totalConversions,
        Number(convPer1k.toFixed(2)),
      ]);
    });
    // Linha de total
    const totalUsers = results.reduce((s, r) => s + r.totalUsers, 0);
    const totalSessions = results.reduce((s, r) => s + r.totalSessions, 0);
    const totalEngaged = results.reduce((s, r) => s + r.totalEngagedSessions, 0);
    const totalConv = results.reduce((s, r) => s + r.totalConversions, 0);
    summaryRows.push([""]);
    summaryRows.push([
      "",
      "TOTAL",
      totalUsers,
      totalSessions,
      totalEngaged,
      totalSessions > 0 ? Number(((totalEngaged / totalSessions) * 100).toFixed(1)) : 0,
      "—",
      totalConv,
      totalSessions > 0 ? Number(((totalConv / totalSessions) * 1000).toFixed(2)) : 0,
    ]);

    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    // Ajusta largura das colunas
    summaryWs["!cols"] = [
      { wch: 4 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 16 },
      { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, summaryWs, "Resumo");

    // --- SHEET 2: Detalhado (formato long, ideal pra pivot table) ---
    const detailedRows: (string | number)[][] = [
      [
        "Landing Page",
        dimMeta.label,
        "Users",
        "Sessões",
        "Sessões engajadas",
        "Bounce rate (%)",
        "Conversões",
      ],
    ];
    for (const r of results) {
      if (!r.matched) {
        detailedRows.push([r.url, "(sem dados no período)", 0, 0, 0, 0, 0]);
        continue;
      }
      for (const c of r.byChannel) {
        detailedRows.push([
          r.url,
          c.label,
          c.users,
          c.sessions,
          c.engagedSessions,
          c.bounceRate,
          c.conversions,
        ]);
      }
    }
    const detailedWs = XLSX.utils.aoa_to_sheet(detailedRows);
    detailedWs["!cols"] = [
      { wch: 60 }, { wch: 24 }, { wch: 10 }, { wch: 10 },
      { wch: 16 }, { wch: 14 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, detailedWs, "Detalhado");

    // --- SHEET 3: Cruzado (pivotada — rows = dimensão, cols = LP, células = users) ---
    const lpHeaders = results.map((r) => {
      try {
        return new URL(r.url).pathname.split("/").filter(Boolean).pop() || r.url;
      } catch {
        return r.url.slice(-40);
      }
    });
    const crossRows: (string | number)[][] = [
      [`Tabela cruzada: ${dimMeta.label} × LP — métrica: USERS`],
      [""],
      [dimMeta.label, ...lpHeaders, "Total"],
    ];
    for (const lbl of allLabels) {
      const row: (string | number)[] = [lbl];
      let rowTotal = 0;
      for (const r of results) {
        const c = r.byChannel.find((x) => x.label === lbl);
        const users = c?.users || 0;
        row.push(users);
        rowTotal += users;
      }
      row.push(rowTotal);
      crossRows.push(row);
    }
    // Total por LP
    crossRows.push([""]);
    const totalRow: (string | number)[] = ["TOTAL"];
    let grandTotal = 0;
    for (const r of results) {
      totalRow.push(r.totalUsers);
      grandTotal += r.totalUsers;
    }
    totalRow.push(grandTotal);
    crossRows.push(totalRow);

    const crossWs = XLSX.utils.aoa_to_sheet(crossRows);
    crossWs["!cols"] = [
      { wch: 24 },
      ...results.map(() => ({ wch: 14 })),
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, crossWs, "Cruzado (Users)");

    // --- SHEET 4: Cruzado por Conversões (pra apresentações de mídia) ---
    const crossConvRows: (string | number)[][] = [
      [`Tabela cruzada: ${dimMeta.label} × LP — métrica: CONVERSÕES`],
      [""],
      [dimMeta.label, ...lpHeaders, "Total"],
    ];
    for (const lbl of allLabels) {
      const row: (string | number)[] = [lbl];
      let rowTotal = 0;
      for (const r of results) {
        const c = r.byChannel.find((x) => x.label === lbl);
        const conv = c?.conversions || 0;
        row.push(conv);
        rowTotal += conv;
      }
      row.push(rowTotal);
      crossConvRows.push(row);
    }
    crossConvRows.push([""]);
    const totalConvRow: (string | number)[] = ["TOTAL"];
    let grandConv = 0;
    for (const r of results) {
      totalConvRow.push(r.totalConversions);
      grandConv += r.totalConversions;
    }
    totalConvRow.push(grandConv);
    crossConvRows.push(totalConvRow);

    const crossConvWs = XLSX.utils.aoa_to_sheet(crossConvRows);
    crossConvWs["!cols"] = [
      { wch: 24 },
      ...results.map(() => ({ wch: 14 })),
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, crossConvWs, "Cruzado (Conv.)");

    XLSX.writeFile(wb, fileName);
  }

  return (
    <div
      ref={captureRef}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6"
    >
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2 flex-wrap">
            <BarChart3 size={16} className="text-[#7c5cff]" />
            Comparativo de Landing Pages
          </h3>
          <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
            Cole até 20 URLs (ou paths). Mostra users, sessões, engajamento, rejeição e conversões por <strong>{dimMeta.label.toLowerCase()}</strong> em cada LP.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected && (
            <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-slate-50 text-slate-600 border border-slate-200">
              Property: {selected.displayName}
            </span>
          )}
          {/* Botão único de export com menu suspenso (PDF / Excel) */}
          <div data-export-hide className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={exporting || results.length === 0}
              title={
                results.length === 0
                  ? "Faça uma comparação primeiro pra ter o que exportar"
                  : "Exportar (escolha o formato)"
              }
              className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#7c5cff] to-[#5b3dd4] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {exporting ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Exportando…
                </>
              ) : (
                <>
                  <Download size={12} /> Exportar
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${exportMenuOpen ? "rotate-180" : ""}`}
                  />
                </>
              )}
            </button>

            {/* Menu suspenso */}
            <AnimatePresence>
              {exportMenuOpen && !exporting && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-[color:var(--border)] overflow-hidden z-50"
                >
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleExportPDF();
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#ede9fe] transition flex items-start gap-2.5 group border-b border-[color:var(--border)]"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 group-hover:bg-red-100 transition">
                      <FileText size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">PDF</p>
                      <p className="text-[10px] text-[color:var(--muted-foreground)] leading-snug">
                        Visual completo · pra apresentações e relatórios formais
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleExportExcel();
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#ede9fe] transition flex items-start gap-2.5 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 transition">
                      <FileSpreadsheet size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">Excel (.xlsx)</p>
                      <p className="text-[10px] text-[color:var(--muted-foreground)] leading-snug">
                        4 abas: Resumo · Detalhado · Cruzado por Users · Cruzado por Conv.
                      </p>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Seletor de dimensão (origem do breakdown) — visível na exportação como
          texto fixo "Quebrado por: <dim>" pra dar contexto à imagem */}
      <div className="flex items-end gap-3 flex-wrap mb-3">
        {/* Versão "imagem-friendly" — só texto. Aparece na exportação. */}
        <div className="flex-1 min-w-[260px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] block mb-1">
            Quebra por dimensão GA4
          </span>
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#ede9fe] border border-[#c4b5fd] text-sm font-semibold text-[#5b3dd4]">
            {dimMeta.label}
            <span className="text-[10px] font-normal text-[#7c5cff] italic">{dimMeta.description}</span>
          </div>
        </div>
        {/* Controles interativos — somem na exportação */}
        <div data-export-hide className="flex items-center gap-2">
          <select
            value={breakdownDimension}
            onChange={(e) => setBreakdownDimension(e.target.value as LPBreakdownDimension)}
            className="text-sm font-medium px-3 py-2 rounded-lg border border-[color:var(--border)] bg-white focus:outline-none focus:border-[#7c5cff]"
          >
            {DIMENSION_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                Trocar para: {d.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowAudienceNote((v) => !v)}
            className="text-xs text-[#7c5cff] hover:underline inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[color:var(--border)]"
            title="Como filtrar por audiência custom (ex.: SUNO)"
          >
            <Info size={12} /> Audiência?
          </button>
        </div>
      </div>

      {/* Aviso sobre audiência custom — escondido na exportação */}
      {showAudienceNote && (
        <div data-export-hide className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <p className="font-semibold mb-1 flex items-center gap-1.5">
            <Info size={12} /> Audiência custom "SUNO" — não disponível direto na Data API
          </p>
          <p className="mb-2">
            A GA4 Data API v1 não permite filtrar por nome de audiência custom em queries normais. Pra ligar:
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>
              <strong>Audience Export</strong>: GA4 → Admin → Audiences → na audiência "SUNO" → "Export". Anota o ID e me manda — eu faço a integração via <code className="bg-amber-100 px-1 rounded">runReport</code> com <code className="bg-amber-100 px-1 rounded">audienceExportId</code>.
            </li>
            <li>
              <strong>Custom Dimension de usuário</strong> (recomendado): grave o nome da audiência no <code className="bg-amber-100 px-1 rounded">dataLayer</code> ou via API server-side. Aí vira uma dimensão filtrável aqui.
            </li>
            <li>
              <strong>Workaround imediato</strong>: se a audiência "SUNO" tem origem em UTMs específicas (ex.: <code className="bg-amber-100 px-1 rounded">utm_source=suno</code>), use o seletor "Fonte" acima e busque por "suno".
            </li>
          </ol>
        </div>
      )}

      {/* Input de URL — escondido na exportação (controle interativo) */}
      <div data-export-hide className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addUrl();
            }
          }}
          placeholder="Cole uma URL (https://...) ou path (/cl/lp-x) e aperte Enter"
          className="flex-1 min-w-[260px] px-3 py-2 text-sm rounded-lg border border-[color:var(--border)] focus:outline-none focus:border-[#7c5cff] font-mono"
        />
        <button
          onClick={addUrl}
          disabled={!inputValue.trim()}
          className="px-3 py-2 rounded-lg bg-[#ede9fe] text-[#7c5cff] text-sm font-semibold hover:bg-[#ddd6fe] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Plus size={14} /> Adicionar
        </button>
        <button
          onClick={compare}
          disabled={pendingUrls.length === 0 || loading}
          className="px-4 py-2 rounded-lg bg-[#7c5cff] text-white text-sm font-semibold hover:bg-[#6b4bf0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
          {loading ? "Consultando GA4..." : "Comparar"}
        </button>
      </div>

      {/* Chips das URLs pendentes */}
      {pendingUrls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {pendingUrls.map((url) => (
            <span
              key={url}
              className="text-[11px] px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 font-mono inline-flex items-center gap-1.5"
            >
              <span className="truncate max-w-[280px]">{url}</span>
              <button
                onClick={() => removeUrl(url)}
                className="text-slate-400 hover:text-red-500 transition"
                aria-label="Remover URL"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Estados */}
      {!useRealData && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} />
          Selecione uma propriedade GA4 no header pra usar o comparador (precisa de dados reais).
        </div>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} />
          Erro ao consultar GA4: {error}
        </div>
      )}

      {/* Resultados */}
      {results.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4 mt-4"
        >
          {/* Tabela resumo com 5 métricas */}
          <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[color:var(--muted-foreground)] bg-[color:var(--muted)]">
                  <th className="text-left px-3 py-2 font-medium">Landing Page</th>
                  <th className="text-right px-3 py-2 font-medium" title="Total de usuários únicos">
                    <Users size={11} className="inline mr-1" /> Users
                  </th>
                  <th className="text-right px-3 py-2 font-medium" title="Total de sessões">
                    <Activity size={11} className="inline mr-1" /> Sessões
                  </th>
                  <th className="text-right px-3 py-2 font-medium" title="Sessões engajadas (>10s ou ≥1 conversão ou ≥2 pageviews)">
                    Engajadas
                  </th>
                  <th className="text-right px-3 py-2 font-medium" title="Taxa de rejeição (média ponderada)">
                    <TrendingDown size={11} className="inline mr-1" /> Bounce
                  </th>
                  <th className="text-right px-3 py-2 font-medium" title="Conversões (key events)">
                    <Target size={11} className="inline mr-1" /> Conv.
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.url} className="border-t border-[color:var(--border)]">
                    <td className="px-3 py-3 text-xs font-mono truncate max-w-[300px]" title={r.url}>
                      {r.matched ? (
                        <a
                          href={r.url.startsWith("http") ? r.url : "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#7c5cff] hover:underline"
                        >
                          {r.url}
                        </a>
                      ) : (
                        <span className="text-slate-400 italic">
                          {r.url}{" "}
                          <span className="ml-2 text-amber-600">(sem dados)</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">
                      {formatNumber(r.totalUsers)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatNumber(r.totalSessions)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatNumber(r.totalEngagedSessions)}
                      <span className="text-[10px] text-[color:var(--muted-foreground)] ml-1">
                        (
                        {r.totalSessions > 0
                          ? ((r.totalEngagedSessions / r.totalSessions) * 100).toFixed(0)
                          : 0}
                        %)
                      </span>
                    </td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums font-semibold ${
                        r.avgBounceRate > 60
                          ? "text-red-600"
                          : r.avgBounceRate > 40
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }`}
                    >
                      {r.avgBounceRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-700">
                      {formatNumber(r.totalConversions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards detalhados por LP — barras horizontais por dimensão escolhida */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r) => (
              <div
                key={r.url}
                className="p-4 rounded-xl border border-[color:var(--border)] bg-gradient-to-br from-slate-50 to-white"
              >
                <p className="text-xs font-mono truncate mb-2 font-semibold" title={r.url}>
                  {(() => {
                    try {
                      return new URL(r.url).pathname;
                    } catch {
                      return r.url;
                    }
                  })()}
                </p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">
                      Users
                    </p>
                    <p className="text-sm font-bold tabular-nums">
                      {formatNumber(r.totalUsers)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">
                      Sessões
                    </p>
                    <p className="text-sm font-bold tabular-nums">
                      {formatNumber(r.totalSessions)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[color:var(--muted-foreground)]">
                      Conv.
                    </p>
                    <p className="text-sm font-bold tabular-nums text-emerald-700">
                      {formatNumber(r.totalConversions)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 text-[11px] mb-3 pb-3 border-b border-[color:var(--border)]">
                  <span className="text-[color:var(--muted-foreground)]">
                    Engaj:{" "}
                    <strong className="text-slate-700">
                      {r.totalSessions > 0
                        ? ((r.totalEngagedSessions / r.totalSessions) * 100).toFixed(0)
                        : 0}
                      %
                    </strong>
                  </span>
                  <span className="text-[color:var(--muted-foreground)]">
                    Bounce:{" "}
                    <strong
                      className={
                        r.avgBounceRate > 60
                          ? "text-red-600"
                          : r.avgBounceRate > 40
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }
                    >
                      {r.avgBounceRate.toFixed(1)}%
                    </strong>
                  </span>
                </div>

                {/* Barras horizontais por dimensão */}
                {r.matched ? (
                  <div className="space-y-1.5">
                    {r.byChannel.map((c) => {
                      const pct = r.totalUsers > 0 ? (c.users / r.totalUsers) * 100 : 0;
                      return (
                        <div key={c.label} className="text-[11px]">
                          <div className="flex items-center justify-between mb-0.5 gap-2">
                            <span className="font-medium truncate flex items-center" title={c.label}>
                              <span
                                className="inline-block w-2 h-2 rounded-full mr-1.5 shrink-0"
                                style={{ background: colorFor(c.label) }}
                              />
                              <span className="truncate">{c.label}</span>
                            </span>
                            <span className="tabular-nums text-[color:var(--muted-foreground)] shrink-0">
                              {formatNumber(c.users)} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                background: colorFor(c.label),
                              }}
                            />
                          </div>
                          <div className="flex gap-2 mt-0.5 text-[9px] text-[color:var(--muted-foreground)]">
                            <span>Sess: {formatNumber(c.sessions)}</span>
                            <span>·</span>
                            <span>Bounce: {c.bounceRate.toFixed(0)}%</span>
                            <span>·</span>
                            <span className="text-emerald-700 font-semibold">
                              Conv: {formatNumber(c.conversions)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Nenhuma sessão encontrada nessa LP no período. Confira: URL escrita certo? Período tem dados?
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Tabela cruzada — útil pra comparar lado a lado */}
          {allLabels.length > 0 && results.length >= 2 && (
            <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[color:var(--muted)]">
                    <th className="text-left px-3 py-2 font-semibold">{dimMeta.label}</th>
                    {results.map((r) => (
                      <th
                        key={r.url}
                        className="text-right px-3 py-2 font-semibold truncate max-w-[180px]"
                        title={r.url}
                      >
                        {(() => {
                          try {
                            return (
                              new URL(r.url).pathname.split("/").filter(Boolean).pop() || "/"
                            );
                          } catch {
                            return r.url.slice(-20);
                          }
                        })()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allLabels.map((lbl) => (
                    <tr key={lbl} className="border-t border-[color:var(--border)]">
                      <td className="px-3 py-2 font-medium">
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1.5"
                          style={{ background: colorFor(lbl) }}
                        />
                        {lbl}
                      </td>
                      {results.map((r) => {
                        const c = r.byChannel.find((x) => x.label === lbl);
                        return (
                          <td
                            key={r.url}
                            className="px-3 py-2 text-right tabular-nums"
                            title={
                              c
                                ? `Users: ${c.users} · Sess: ${c.sessions} · Engaj: ${c.engagedSessions} · Bounce: ${c.bounceRate.toFixed(1)}% · Conv: ${c.conversions}`
                                : ""
                            }
                          >
                            {c ? (
                              <span>
                                <strong>{formatNumber(c.users)}</strong>
                                <span className="text-[color:var(--muted-foreground)]">
                                  {" "}
                                  · {formatNumber(c.sessions)}s · {c.bounceRate.toFixed(0)}% · {formatNumber(c.conversions)}c
                                </span>
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[color:var(--border)] bg-[color:var(--muted)]/40">
                    <td className="px-3 py-2 font-bold">Total</td>
                    {results.map((r) => (
                      <td key={r.url} className="px-3 py-2 text-right tabular-nums font-bold">
                        {formatNumber(r.totalUsers)} users · {formatNumber(r.totalConversions)} conv
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
              <p className="text-[10px] text-[color:var(--muted-foreground)] px-3 py-2 italic">
                Cada célula: <strong>users</strong> · sessões · bounce · conversões. Hover pra detalhes.
              </p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
