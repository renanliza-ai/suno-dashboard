"use client";

import { Sparkles, Send, X, Minimize2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Info, ArrowRight, Lightbulb, Target, FileSpreadsheet, FileText, FileDown, RotateCcw } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat, RichBlock } from "@/lib/chat-context";
import type { ReportTemplateId } from "@/lib/report-templates";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { formatNumber } from "@/lib/utils";
import { downloadReport } from "@/lib/export-utils";
import { resolveReport } from "@/lib/report-templates";
import { useGA4 } from "@/lib/ga4-context";
import { useSession } from "next-auth/react";

const contextSuggestions: Record<string, string[]> = {
  "/": [
    "📊 Como estamos hoje de sessões no site?",
    "🛒 Como estão as vendas hoje?",
    "🏆 Quais são as melhores campanhas dos últimos 7 dias?",
    "🎣 Quantos leads capturei nas últimas 24 horas?",
  ],
  "/live": ["📡 Qual canal traz mais tráfego agora?", "🔥 Top páginas em tempo real", "🏠 Voltar ao dashboard"],
  "/midia": ["🏆 Quais são as melhores campanhas dos últimos 7 dias?", "📱 Por dispositivo", "📄 Top páginas com receita"],
  "/seo": ["🔍 Top termos orgânicos", "📈 Páginas com melhor CTR", "✨ Oportunidades de Parte 2"],
  "/cro": ["💡 Recomendações prioritárias", "🛒 Analisa o checkout", "🎣 Lead funnel"],
  "/tracking": ["🚨 Eventos críticos", "❓ Tem evento faltando?", "🏷️ UTMs fora do padrão"],
  "/conversoes": ["📉 Por que abandono cresceu?", "💸 Receita por evento", "🔁 Taxa de recuperação"],
};

function formatInline(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-black/30 px-1 py-0.5 rounded text-[10px] font-mono">$1</code>');
}

function SeverityIcon({ severity }: { severity: string }) {
  const map = {
    info: <Info size={12} />,
    success: <CheckCircle2 size={12} />,
    warning: <AlertTriangle size={12} />,
    danger: <AlertTriangle size={12} />,
  };
  return map[severity as keyof typeof map] || <Info size={12} />;
}

function RichRenderer({
  block,
  onAction,
  onDownload,
}: {
  block: RichBlock;
  onAction: (cmd: string) => void;
  onDownload: (reportId: ReportTemplateId, format: "xlsx" | "pdf" | "csv") => void;
}) {
  if (block.type === "insight") {
    const colors = {
      info: "from-blue-500/20 to-blue-600/5 border-blue-400/30 text-blue-100",
      success: "from-emerald-500/20 to-emerald-600/5 border-emerald-400/30 text-emerald-100",
      warning: "from-amber-500/20 to-orange-600/5 border-amber-400/30 text-amber-100",
      danger: "from-red-500/20 to-red-600/5 border-red-400/30 text-red-100",
    };
    return (
      <div className={`rounded-xl border bg-gradient-to-br ${colors[block.severity]} p-3`}>
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0">
            <SeverityIcon severity={block.severity} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold leading-tight">{block.title}</div>
            <div className="text-[11px] opacity-85 mt-1 leading-relaxed">{block.body}</div>
          </div>
        </div>
      </div>
    );
  }

  if (block.type === "metrics") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {block.items.map((m, i) => (
          <div key={i} className="rounded-lg bg-white/5 border border-white/10 p-2">
            <div className="text-[9px] uppercase tracking-wider text-white/50 font-semibold truncate">{m.label}</div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-bold">{m.value}</span>
              {m.delta && (
                <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${m.positive ? "text-emerald-400" : "text-red-400"}`}>
                  {m.positive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                  {m.delta}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (block.type === "recommendations") {
    const effortColor = { baixo: "text-emerald-300", médio: "text-amber-300", alto: "text-red-300" };
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/60 font-semibold">
          <Lightbulb size={11} className="text-amber-300" />
          Recomendações
        </div>
        {block.items.map((r, i) => (
          <div key={i} className="rounded-lg bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-400/20 p-2.5">
            <div className="text-[11px] font-semibold leading-snug">{r.title}</div>
            <div className="flex items-center gap-2 mt-1 text-[10px]">
              <span className="text-emerald-300 font-semibold flex items-center gap-1">
                <Target size={9} />
                {r.impact}
              </span>
              <span className="text-white/40">·</span>
              <span className={`font-semibold ${effortColor[r.effort]}`}>Esforço: {r.effort}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (block.type === "table") {
    return (
      <div className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-white/5">
              {block.columns.map((c, i) => (
                <th key={i} className="text-left px-2 py-1.5 font-semibold text-white/70">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="border-t border-white/5">
                {row.map((cell, j) => (
                  <td key={j} className={`px-2 py-1.5 ${j === 0 ? "font-mono text-[10px]" : "tabular-nums font-semibold"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "actions") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {block.items.map((a, i) => (
          <button
            key={i}
            onClick={() => onAction(a.command)}
            className="text-left px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] font-medium transition"
          >
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  if (block.type === "journey-step") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 p-2">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#7c5cff] to-[#b297ff] flex items-center justify-center text-[10px] font-bold shrink-0">
          →
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold">{block.stage}</div>
          <div className="text-[9px] font-mono text-white/50 truncate">{block.event}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-bold tabular-nums">{formatNumber(block.value)}</div>
          {block.issue && <div className="text-[9px] text-red-300 mt-0.5">⚠ {block.issue}</div>}
        </div>
      </div>
    );
  }

  if (block.type === "link") {
    return (
      <Link
        href={block.href}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#7c5cff]/30 to-[#b297ff]/20 border border-[#b297ff]/40 p-3 hover:from-[#7c5cff]/50 transition group"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold">{block.label}</div>
          {block.description && <div className="text-[10px] text-white/70 mt-0.5">{block.description}</div>}
        </div>
        <ArrowRight size={14} className="group-hover:translate-x-1 transition shrink-0" />
      </Link>
    );
  }

  if (block.type === "download") {
    const formats = block.formats ?? ["xlsx", "pdf", "csv"];
    const formatMeta: Record<"xlsx" | "pdf" | "csv", { label: string; Icon: typeof FileSpreadsheet; tint: string }> = {
      xlsx: { label: "Excel", Icon: FileSpreadsheet, tint: "from-emerald-500/25 to-emerald-600/10 border-emerald-400/40 hover:from-emerald-500/40" },
      pdf: { label: "PDF", Icon: FileText, tint: "from-red-500/25 to-red-600/10 border-red-400/40 hover:from-red-500/40" },
      csv: { label: "CSV", Icon: FileDown, tint: "from-sky-500/25 to-sky-600/10 border-sky-400/40 hover:from-sky-500/40" },
    };
    return (
      <div className="rounded-xl bg-gradient-to-br from-[#7c5cff]/20 to-[#b297ff]/10 border border-[#b297ff]/40 p-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7c5cff] to-[#b297ff] flex items-center justify-center shrink-0">
            <FileDown size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold leading-tight">{block.label}</div>
            <div className="text-[10px] text-white/70 mt-0.5 leading-relaxed">{block.description}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {formats.map((f) => {
            const meta = formatMeta[f];
            const Icon = meta.Icon;
            return (
              <button
                key={f}
                onClick={() => onDownload(block.reportId, f)}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg bg-gradient-to-br ${meta.tint} border text-[10px] font-semibold transition`}
              >
                <Icon size={14} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (block.type === "welcome-card") {
    const toneColor: Record<string, string> = {
      positive: "text-emerald-300",
      warning: "text-amber-300",
      danger: "text-red-300",
      neutral: "text-white/80",
    };
    return (
      <div className="space-y-2.5">
        <div className="rounded-xl bg-gradient-to-br from-[#7c5cff]/30 via-[#b297ff]/15 to-transparent border border-[#b297ff]/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-white/60 font-semibold mb-2">
            📡 Radar de {block.accountName}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {block.radar.map((r, i) => (
              <div key={i} className="rounded-lg bg-black/20 border border-white/10 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-white/50 font-semibold truncate">{r.label}</div>
                <div className={`text-sm font-bold tabular-nums mt-0.5 ${toneColor[r.tone || "neutral"]}`}>{r.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-white/60 font-semibold flex items-center gap-1.5">
          <Sparkles size={10} className="text-[#b297ff]" />
          Por onde começar
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {block.quickStarts.map((q, i) => (
            <button
              key={i}
              onClick={() => onAction(q.command)}
              className="text-left px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 transition group"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-base">{q.emoji}</span>
                <span className="text-[11px] font-semibold leading-tight">{q.title}</span>
              </div>
              <div className="text-[9px] text-white/50 mt-0.5 leading-snug">{q.subtitle}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === "quick-start") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {block.items.map((q, i) => (
          <button
            key={i}
            onClick={() => onAction(q.command)}
            className="text-left px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 transition"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-base">{q.emoji}</span>
              <span className="text-[11px] font-semibold leading-tight">{q.title}</span>
            </div>
            <div className="text-[9px] text-white/50 mt-0.5 leading-snug">{q.subtitle}</div>
          </button>
        ))}
      </div>
    );
  }

  return null;
}

const TYPING_MESSAGES = [
  "analisando contexto…",
  "consultando GA4…",
  "cruzando métricas…",
  "destilando insights…",
  "buscando anomalias…",
];

// Biblioteca de comandos para autocomplete
const COMMAND_LIBRARY = [
  "Como estamos hoje de sessões no site?",
  "Como estão as vendas hoje?",
  "Quantas vendas nas últimas 24 horas?",
  "Quais são as melhores campanhas dos últimos 7 dias?",
  "Quantos leads capturei nas últimas 24 horas?",
  "Páginas com widget de WhatsApp da Research nos últimos 3 meses",
  "Acessos das páginas com WhatsApp",
  "Por que conversões caíram?",
  "Qual o maior gargalo da jornada?",
  "Melhor canal por ROAS",
  "Tem alguma anomalia nos dados?",
  "Analisa o checkout",
  "Recomendações prioritárias de CRO",
  "Top páginas por receita",
  "Top eventos críticos",
  "Baixar relatório executivo",
  "Baixar relatório de canais",
  "Baixar relatório de páginas",
  "Baixar relatório de eventos",
  "Baixar diagnóstico de funil",
  "Baixar relatório de campanhas",
  "Baixar perfil de audiência",
  "Baixar recomendações de CRO",
  "Baixar relatório de anomalias",
  "Gerar relatório em Excel",
  "Gerar relatório em PDF",
  "Comparar período atual vs anterior",
  "Por dispositivo",
  "Lead funnel",
];

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const [showSuggest, setShowSuggest] = useState(false);
  const { messages, sendMessage, toast, navigateTo, consumeNavigate, attribution, filter, resetChat } = useChat();
  const { selected } = useGA4();
  const { data: session } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  useEffect(() => {
    if (navigateTo) {
      router.push(navigateTo);
      consumeNavigate();
    }
  }, [navigateTo, router, consumeNavigate]);

  // Cicla mensagens do typing indicator enquanto "thinking"
  useEffect(() => {
    if (!thinking) return;
    const id = setInterval(() => {
      setThinkingIdx((i) => (i + 1) % TYPING_MESSAGES.length);
    }, 700);
    return () => clearInterval(id);
  }, [thinking]);

  const handleSend = (text: string) => {
    const msg = text.trim();
    if (!msg) return;
    setThinking(true);
    setThinkingIdx(0);
    sendMessage(msg);
    setInput("");
    setShowSuggest(false);
    setTimeout(() => setThinking(false), 650);
  };

  const handleDownload = (reportId: ReportTemplateId, format: "xlsx" | "pdf" | "csv") => {
    const userFirstName = (session?.user?.name || "Renan").split(" ")[0];
    const accountName = selected?.displayName || "Suno";
    const pkg = resolveReport(reportId, accountName, "últimos 30 dias");
    downloadReport(format, { ...pkg.meta, generatedBy: `Copiloto Suno · ${userFirstName}` }, pkg.sheets);
  };

  // Typeahead — filtra biblioteca por substring case-insensitive
  const autocompleteMatches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (q.length < 2) return [];
    return COMMAND_LIBRARY.filter((c) => c.toLowerCase().includes(q)).slice(0, 4);
  }, [input]);

  const lastMsg = messages[messages.length - 1];
  const dynamicSuggestions =
    lastMsg?.role === "assistant" && lastMsg.followUps?.length
      ? lastMsg.followUps
      : contextSuggestions[pathname] || contextSuggestions["/"];

  const contextLabel = `${pathname === "/" ? "Dashboard" : pathname.slice(1)} · ${attribution === "last-click" ? "Last Click" : "Assistida"}${filter !== "all" ? ` · ${filter}` : ""}`;

  return (
    <>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 20, x: "-50%" }}
            className="fixed bottom-24 left-1/2 z-[60] bg-[#0f0f1a] text-white px-5 py-3 rounded-xl shadow-2xl border border-white/10 flex items-center gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
            <span className="text-sm font-medium">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 200 }}
            className="fixed bottom-6 right-6 w-[440px] h-[640px] z-50 rounded-2xl overflow-hidden shadow-2xl shadow-black/30 flex flex-col"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#1a1333] via-[#2a1f4d] to-[#3a2670]" />
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-[#7c5cff] blur-3xl opacity-30" />
            <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-[#b297ff] blur-3xl opacity-20" />

            <div className="relative flex items-center justify-between p-4 border-b border-white/10 text-white">
              <div className="flex items-center gap-3">
                <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#b297ff] flex items-center justify-center">
                  <Sparkles size={16} />
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#2a1f4d]" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    Copiloto Analítico
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-400 to-orange-500 text-white font-bold uppercase tracking-wider">Pro</span>
                  </h3>
                  <p className="text-[10px] text-white/60 font-mono truncate">ctx: {contextLabel}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (confirm("Reiniciar a conversa? O histórico atual será apagado.")) resetChat();
                  }}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition"
                  title="Reiniciar conversa"
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition"
                  title="Minimizar"
                >
                  <Minimize2 size={14} />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="relative flex-1 overflow-y-auto p-4 space-y-3 text-white">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm space-y-2.5 ${
                      m.role === "user"
                        ? "bg-[#7c5cff] text-white"
                        : "bg-white/10 backdrop-blur-sm border border-white/10"
                    }`}
                  >
                    <div
                      className="whitespace-pre-line leading-snug"
                      dangerouslySetInnerHTML={{ __html: formatInline(m.content) }}
                    />
                    {m.rich?.map((b, j) => (
                      <RichRenderer key={j} block={b} onAction={handleSend} onDownload={handleDownload} />
                    ))}
                  </div>
                </motion.div>
              ))}
              {thinking && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-3.5 py-2.5 flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b297ff] animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b297ff] animate-bounce" style={{ animationDelay: "120ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b297ff] animate-bounce" style={{ animationDelay: "240ms" }} />
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={thinkingIdx}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.25 }}
                        className="text-[11px] italic text-white/70"
                      >
                        {TYPING_MESSAGES[thinkingIdx]}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="relative p-3 border-t border-white/10 bg-black/30 backdrop-blur-md">
              <AnimatePresence>
                {showSuggest && autocompleteMatches.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="absolute bottom-full left-3 right-3 mb-2 bg-[#1a1333]/95 backdrop-blur-md border border-[#b297ff]/40 rounded-xl overflow-hidden shadow-2xl"
                  >
                    <div className="text-[9px] uppercase tracking-wider text-white/50 font-semibold px-3 pt-2 pb-1 flex items-center gap-1">
                      <Sparkles size={9} className="text-[#b297ff]" />
                      Sugestões inteligentes
                    </div>
                    {autocompleteMatches.map((s) => (
                      <button
                        key={s}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSend(s);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[12px] text-white hover:bg-white/10 transition flex items-center gap-2"
                      >
                        <ArrowRight size={10} className="text-[#b297ff] shrink-0" />
                        <span className="truncate">{s}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {dynamicSuggestions.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/20 border border-white/10 text-white transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus-within:border-[#b297ff] transition">
                <Sparkles size={13} className="text-white/40" />
                <input
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setShowSuggest(true);
                  }}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend(input);
                    if (e.key === "Escape") setShowSuggest(false);
                  }}
                  placeholder="Pergunte algo profundo sobre seus dados..."
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/40"
                />
                <button
                  onClick={() => handleSend(input)}
                  disabled={!input.trim()}
                  className="w-8 h-8 rounded-lg bg-[#7c5cff] hover:bg-[#9b7fff] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition"
                >
                  <Send size={13} className="text-white" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full z-40 flex items-center justify-center shadow-2xl shadow-purple-500/40 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #7c5cff 0%, #b297ff 50%, #7c5cff 100%)",
        }}
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X size={24} className="text-white" />
            </motion.div>
          ) : (
            <motion.div key="spark" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
              <Sparkles size={24} className="text-white" />
            </motion.div>
          )}
        </AnimatePresence>
        {!open && <span className="absolute inset-0 rounded-full border-2 border-white/30 animate-ping" />}
        {!open && messages.length > 1 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-[#ef4444] text-white text-[10px] font-bold flex items-center justify-center px-1.5 border-2 border-white">
            {messages.filter((m) => m.role === "assistant").length}
          </span>
        )}
      </motion.button>
    </>
  );
}
