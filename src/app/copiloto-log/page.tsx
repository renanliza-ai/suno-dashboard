"use client";

import { Header } from "@/components/header";
import { MasterGuard } from "@/components/master-guard";
import { Dialog } from "@/components/dialog";
import { motion } from "framer-motion";
import { MessageSquare, TrendingUp, Users, Clock, Download, Trash2, Search, Crown, Sparkles, Activity, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getChatLog, clearChatLog, type ChatLogEntry } from "@/lib/chat-context";
import { formatNumber } from "@/lib/utils";

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

const intentLabels: Record<string, string> = {
  drop_analysis: "Diagnóstico de queda",
  best_channel: "Melhor canal",
  worst_channel: "Pior canal",
  lead_funnel: "Funil de lead",
  checkout_abandon: "Abandono checkout",
  upsell: "Up-sell / Cross-sell",
  realtime: "Realtime",
  reports: "Relatórios",
  compare: "Comparação",
  anomaly: "Anomalias",
  recommendations: "Recomendações",
  cohort: "Cohort",
  device_mobile: "Mobile",
  device_desktop: "Desktop",
  channel_organic: "Orgânico",
  channel_paid: "Pago",
  pages_top: "Top páginas",
  events_analysis: "Eventos",
  attribution_last: "Last Click",
  attribution_assisted: "Assistida",
  attribution_explain: "Atribuição (explicação)",
  journey: "Jornada",
  revenue: "Receita",
  reset: "Reset",
  help: "Ajuda",
  unknown: "Não categorizado",
};

// Perguntas de exemplo para popular a visão quando o log estiver vazio (demo/onboarding)
const demoLog: ChatLogEntry[] = [
  { id: "d1", text: "Por que as conversões caíram essa semana?", timestamp: Date.now() - 1000 * 60 * 18, userEmail: "renan.liza@suno.com.br", userName: "Renan Liza", account: "Suno Research", page: "/", intent: "drop_analysis" },
  { id: "d2", text: "Qual campanha tem o melhor ROAS?", timestamp: Date.now() - 1000 * 60 * 45, userEmail: "marketing@suno.com.br", userName: "Time Marketing", account: "Suno Research", page: "/relatorios", intent: "best_channel" },
  { id: "d3", text: "Me leva para o realtime", timestamp: Date.now() - 1000 * 60 * 60 * 2, userEmail: "lider.midia@suno.com.br", userName: "Líder Mídia", account: "Suno Asset", page: "/", intent: "realtime" },
  { id: "d4", text: "Tem alguma anomalia nos dados?", timestamp: Date.now() - 1000 * 60 * 60 * 3, userEmail: "renan.liza@suno.com.br", userName: "Renan Liza", account: "Suno Research", page: "/", intent: "anomaly" },
  { id: "d5", text: "Onde está o maior gargalo?", timestamp: Date.now() - 1000 * 60 * 60 * 5, userEmail: "produto@suno.com.br", userName: "Produto", account: "Suno Consultoria", page: "/cro", intent: "drop_analysis" },
  { id: "d6", text: "Analisa o checkout", timestamp: Date.now() - 1000 * 60 * 60 * 8, userEmail: "renan.liza@suno.com.br", userName: "Renan Liza", account: "Suno Research", page: "/conversoes", intent: "checkout_abandon" },
  { id: "d7", text: "Recomendações prioritárias", timestamp: Date.now() - 1000 * 60 * 60 * 10, userEmail: "cmo@suno.com.br", userName: "CMO", account: "Suno Research", page: "/cro", intent: "recommendations" },
  { id: "d8", text: "Mobile está convertendo pior?", timestamp: Date.now() - 1000 * 60 * 60 * 22, userEmail: "lider.midia@suno.com.br", userName: "Líder Mídia", account: "Suno Asset", page: "/", intent: "device_mobile" },
  { id: "d9", text: "Lead funnel por canal", timestamp: Date.now() - 1000 * 60 * 60 * 26, userEmail: "crm@suno.com.br", userName: "CRM", account: "Suno Research", page: "/", intent: "lead_funnel" },
  { id: "d10", text: "Como está o up-sell?", timestamp: Date.now() - 1000 * 60 * 60 * 30, userEmail: "renan.liza@suno.com.br", userName: "Renan Liza", account: "Suno Research", page: "/", intent: "upsell" },
  { id: "d11", text: "Tráfego orgânico está crescendo?", timestamp: Date.now() - 1000 * 60 * 60 * 36, userEmail: "seo@suno.com.br", userName: "SEO", account: "Status Invest", page: "/relatorios", intent: "channel_organic" },
  { id: "d12", text: "Explica atribuição assistida", timestamp: Date.now() - 1000 * 60 * 60 * 40, userEmail: "cmo@suno.com.br", userName: "CMO", account: "Suno Research", page: "/", intent: "attribution_explain" },
];

export default function CopilotoLogPage() {
  const [log, setLog] = useState<ChatLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ChatLogEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const real = getChatLog();
    // Mistura real com demo, mantendo reais primeiro
    setLog([...real, ...demoLog]);
  }, []);

  const users = useMemo(() => {
    const set = new Set(log.map((e) => e.userEmail));
    return Array.from(set);
  }, [log]);

  const filtered = log.filter((e) => {
    if (userFilter !== "all" && e.userEmail !== userFilter) return false;
    if (search && !e.text.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Agregações
  const totalQuestions = log.length;
  const uniqueUsers = users.length;
  const last24h = log.filter((e) => Date.now() - e.timestamp < 1000 * 60 * 60 * 24).length;

  // Top intents
  const intentCounts = log.reduce<Record<string, number>>((acc, e) => {
    acc[e.intent] = (acc[e.intent] || 0) + 1;
    return acc;
  }, {});
  const topIntents = Object.entries(intentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Top usuários
  const userCounts = log.reduce<Record<string, { name: string; count: number }>>((acc, e) => {
    if (!acc[e.userEmail]) acc[e.userEmail] = { name: e.userName, count: 0 };
    acc[e.userEmail].count += 1;
    return acc;
  }, {});
  const topUsers = Object.entries(userCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  const handleExport = () => {
    const csv =
      "timestamp,user,email,account,page,intent,text\n" +
      filtered
        .map((e) =>
          [
            new Date(e.timestamp).toISOString(),
            JSON.stringify(e.userName),
            e.userEmail,
            JSON.stringify(e.account),
            e.page,
            e.intent,
            JSON.stringify(e.text),
          ].join(",")
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `suno-copiloto-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    clearChatLog();
    setLog(demoLog);
    setConfirmClear(false);
  };

  return (
    <MasterGuard>
      <main className="ml-20 p-8 max-w-[1600px]">
        <Header />

        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-1.5">
            <Crown size={12} /> Área Master
          </div>
          <div className="px-3 py-1 rounded-full bg-[#ede9fe] text-[#7c5cff] text-xs font-semibold flex items-center gap-1.5">
            <Sparkles size={12} /> Log do Copiloto
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[color:var(--border)] hover:bg-[color:var(--muted)] text-xs font-medium transition"
            >
              <Download size={12} /> Exportar CSV
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 text-xs font-medium transition"
            >
              <Trash2 size={12} /> Limpar log local
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Perguntas totais", value: formatNumber(totalQuestions), icon: MessageSquare, color: "#7c5cff", bg: "bg-violet-50" },
            { label: "Usuários únicos", value: uniqueUsers, icon: Users, color: "#10b981", bg: "bg-emerald-50" },
            { label: "Últimas 24h", value: last24h, icon: Clock, color: "#f59e0b", bg: "bg-amber-50" },
            { label: "Top intent", value: intentLabels[topIntents[0]?.[0]] || "—", icon: TrendingUp, color: "#3b82f6", bg: "bg-blue-50" },
          ].map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div
                key={k.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="bg-white rounded-2xl border border-[color:var(--border)] p-5 flex items-center gap-4"
              >
                <div className={`w-12 h-12 rounded-xl ${k.bg} flex items-center justify-center shrink-0`}>
                  <Icon size={22} style={{ color: k.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[color:var(--muted-foreground)] font-medium">{k.label}</p>
                  <p className="text-xl font-bold truncate">{k.value}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] overflow-hidden">
            <div className="p-5 border-b border-[color:var(--border)] flex items-center gap-3 flex-wrap">
              <div>
                <h3 className="text-base font-semibold">Perguntas feitas ao copiloto</h3>
                <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                  {filtered.length} registros · ordem cronológica
                </p>
              </div>
              <div className="ml-auto flex gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-[color:var(--muted)] rounded-lg px-2.5 py-1.5">
                  <Search size={12} className="text-[color:var(--muted-foreground)]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar texto..."
                    className="bg-transparent outline-none text-xs w-40"
                  />
                </div>
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="bg-[color:var(--muted)] rounded-lg px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="all">Todos usuários</option>
                  {users.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="divide-y divide-[color:var(--border)] max-h-[620px] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-[color:var(--muted-foreground)]">
                  Nenhuma pergunta registrada ainda.
                </div>
              ) : (
                filtered.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className="w-full text-left p-4 hover:bg-[#ede9fe]/40 transition flex items-start gap-3"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#ede9fe] text-[#7c5cff] flex items-center justify-center shrink-0">
                      <MessageSquare size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-2">“{e.text}”</p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[color:var(--muted-foreground)] flex-wrap">
                        <span className="font-semibold text-[color:var(--foreground)]">{e.userName}</span>
                        <span>·</span>
                        <span>{e.account}</span>
                        <span>·</span>
                        <span className="font-mono">{e.page}</span>
                        <span>·</span>
                        <span>{timeAgo(e.timestamp)}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[color:var(--muted)] shrink-0">
                      {intentLabels[e.intent] || e.intent}
                    </span>
                    <ChevronRight size={14} className="text-[color:var(--muted-foreground)] shrink-0 mt-1" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                <Activity size={14} className="text-[#7c5cff]" /> Top tópicos
              </h3>
              <div className="space-y-2.5">
                {topIntents.map(([intent, count], i) => {
                  const pct = (count / totalQuestions) * 100;
                  return (
                    <div key={intent}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium">{intentLabels[intent] || intent}</span>
                        <span className="tabular-nums font-bold">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[color:var(--muted)] overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ delay: i * 0.04 }}
                          className="h-full rounded-full bg-gradient-to-r from-[#7c5cff] to-[#b297ff]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                <Users size={14} className="text-[#7c5cff]" /> Quem pergunta mais
              </h3>
              <div className="space-y-2">
                {topUsers.map(([email, info], i) => (
                  <div
                    key={email}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-[color:var(--muted)]/60"
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7c5cff] to-[#b297ff] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{info.name}</p>
                      <p className="text-[10px] text-[color:var(--muted-foreground)] truncate">{email}</p>
                    </div>
                    <span className="text-xs font-bold text-[#7c5cff] tabular-nums shrink-0">
                      {info.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] p-5 text-white">
              <p className="text-xs font-semibold opacity-80 uppercase tracking-wider">💡 Dica master</p>
              <p className="text-sm leading-relaxed mt-2">
                Use este log para munir reuniões: quais dúvidas se repetem? O que merece virar dashboard
                permanente? Exporte o CSV e cruze com NPS para entender a saúde de quem opera.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Detalhe da pergunta"
        subtitle={selected ? `${selected.userName} · ${timeAgo(selected.timestamp)}` : ""}
        maxWidth="max-w-xl"
        icon={
          <div className="w-10 h-10 rounded-xl bg-[#ede9fe] text-[#7c5cff] flex items-center justify-center">
            <MessageSquare size={18} />
          </div>
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <blockquote className="rounded-xl bg-[color:var(--muted)] p-4 border-l-4 border-[#7c5cff] italic">
              “{selected.text}”
            </blockquote>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-[color:var(--muted)] p-2.5">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Usuário</p>
                <p className="font-semibold mt-0.5">{selected.userName}</p>
                <p className="text-[10px] font-mono text-[color:var(--muted-foreground)] truncate">{selected.userEmail}</p>
              </div>
              <div className="rounded-lg bg-[color:var(--muted)] p-2.5">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Conta</p>
                <p className="font-semibold mt-0.5">{selected.account}</p>
              </div>
              <div className="rounded-lg bg-[color:var(--muted)] p-2.5">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Página</p>
                <p className="font-mono mt-0.5 truncate">{selected.page}</p>
              </div>
              <div className="rounded-lg bg-[color:var(--muted)] p-2.5">
                <p className="text-[10px] uppercase font-semibold text-[color:var(--muted-foreground)]">Intent detectado</p>
                <p className="font-semibold mt-0.5">{intentLabels[selected.intent] || selected.intent}</p>
              </div>
            </div>
            <p className="text-[11px] text-[color:var(--muted-foreground)]">
              Timestamp: {new Date(selected.timestamp).toLocaleString("pt-BR")}
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Limpar log local?"
        subtitle="Apenas registros deste navegador serão apagados"
        maxWidth="max-w-md"
      >
        <div className="space-y-3 text-sm">
          <p className="text-[color:var(--muted-foreground)]">
            Os dados agregados de demonstração permanecem. Isso não afeta o GA4 nem dados do servidor.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium"
            >
              Sim, limpar
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="flex-1 px-4 py-2 rounded-xl border border-[color:var(--border)] text-sm font-medium"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Dialog>
    </MasterGuard>
  );
}
