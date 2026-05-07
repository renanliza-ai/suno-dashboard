"use client";

import {
  LayoutDashboard,
  BarChart3,
  Users,
  Target,
  Settings,
  FileText,
  Zap,
  TrendingUp,
  Radar,
  Crown,
  Activity,
  MessageSquare,
  Search,
  Megaphone,
  AlertTriangle,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SunoLogo } from "./suno-logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

type NavItem = { icon: typeof LayoutDashboard; label: string; href: string; description?: string };

// =====================================================================
// Estrutura agrupada por OBJETIVO do usuário (não por nome técnico)
// Aquisição → Comportamento → Master
// =====================================================================
const dashboardItem: NavItem = {
  icon: LayoutDashboard,
  label: "Dashboard",
  href: "/",
  description: "Visão geral",
};

const aquisicaoNav: NavItem[] = [
  { icon: Search, label: "SEO", href: "/seo", description: "Tráfego orgânico (Search Console)" },
  { icon: Megaphone, label: "Mídia Paga", href: "/midia", description: "Campanhas, ROAS, ROI" },
  { icon: Users, label: "Audiência", href: "/audiencia", description: "Demografia + ICP" },
];

const comportamentoNav: NavItem[] = [
  { icon: FileText, label: "Páginas", href: "/paginas", description: "Top páginas + Web Vitals" },
  { icon: Zap, label: "Eventos", href: "/eventos", description: "Eventos GA4" },
  { icon: Target, label: "Conversões", href: "/conversoes", description: "Funil + objetivos" },
];

const masterNav: NavItem[] = [
  { icon: AlertTriangle, label: "Anomalias", href: "/anomalias", description: "Detector D-1 vs baseline 14d" },
  { icon: ShieldCheck, label: "Auditoria", href: "/auditoria", description: "Audit GA4 — métricas vs painel nativo" },
  { icon: Tag, label: "Auditoria UTM", href: "/auditoria-utm", description: "GA4 vs PowerBI/sunocode — UTMs e atribuição" },
  { icon: TrendingUp, label: "CRO", href: "/cro", description: "Recomendações + experimentos" },
  { icon: Radar, label: "Tracking", href: "/tracking", description: "UTM + GTM + CAPI" },
  { icon: MessageSquare, label: "Copiloto Log", href: "/copiloto-log", description: "Histórico do chat" },
];

function NavLink({ item, pathname, masterAccent = false }: { item: NavItem; pathname: string; masterAccent?: boolean }) {
  const Icon = item.icon;
  const isActive = pathname === item.href;
  return (
    <Link
      href={item.href}
      className={cn(
        "w-11 h-11 rounded-xl flex items-center justify-center transition-all group relative",
        isActive
          ? masterAccent
            ? "bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700"
            : "bg-[#ede9fe] text-[#7c5cff]"
          : masterAccent
            ? "text-[color:var(--muted-foreground)] hover:bg-amber-50 hover:text-amber-600"
            : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
      )}
    >
      <Icon size={20} />
      {/* Tooltip com nome + descrição (UX: usuário entende o que tem ali) */}
      <span className="absolute left-14 px-2.5 py-1.5 rounded-md bg-[color:var(--foreground)] text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-30 flex flex-col gap-0.5 max-w-[240px]">
        <span className="font-bold flex items-center gap-1">
          {masterAccent && <Crown size={10} className="text-amber-400" />}
          {item.label}
        </span>
        {item.description && (
          <span className="text-[10px] font-normal text-white/70 whitespace-normal">{item.description}</span>
        )}
      </span>
    </Link>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="relative w-11 h-2 my-1 mx-auto group flex items-center justify-center">
      <div className="h-px w-8 bg-[color:var(--border)]" />
      {/* Mostra label do grupo no hover */}
      <span className="absolute left-14 px-2 py-1 rounded-md bg-[color:var(--foreground)] text-white text-[10px] font-bold uppercase tracking-wider whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-30">
        {children}
      </span>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isMaster = Boolean((session?.user as { isMaster?: boolean } | undefined)?.isMaster);
  const liveActive = pathname === "/live";

  return (
    <aside className="fixed left-0 top-0 h-screen w-20 bg-white border-r border-[color:var(--border)] flex flex-col items-center py-6 z-20">
      <Link href="/">
        <SunoLogo size={44} variant="mark" className="shadow-lg shadow-black/20 rounded-xl" />
      </Link>

      {/* LIVE — sempre destacado em cima */}
      <Link
        href="/live"
        className={cn(
          "mt-6 w-14 h-14 rounded-2xl flex flex-col items-center justify-center transition-all group relative shadow-md",
          liveActive
            ? "bg-gradient-to-br from-red-500 to-pink-600 text-white shadow-red-500/40"
            : "bg-gradient-to-br from-red-50 to-pink-50 text-red-600 hover:shadow-red-500/30 hover:scale-105"
        )}
      >
        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        <Activity size={18} />
        <span className="text-[9px] font-bold mt-0.5 tracking-wide">LIVE</span>
        <span className="absolute left-16 px-2 py-1 rounded-md bg-[color:var(--foreground)] text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-30">
          Comportamento ao vivo
        </span>
      </Link>

      <nav className="mt-6 flex flex-col gap-1.5 flex-1">
        {/* Dashboard sempre primeiro (visão geral) */}
        <NavLink item={dashboardItem} pathname={pathname} />

        {/* GRUPO: Aquisição */}
        <GroupLabel>Aquisição</GroupLabel>
        {aquisicaoNav.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {/* GRUPO: Comportamento */}
        <GroupLabel>Comportamento</GroupLabel>
        {comportamentoNav.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {/* GRUPO: Master (oculto para não-masters) */}
        {isMaster && (
          <>
            <div className="h-px w-8 bg-[color:var(--border)] my-2 mx-auto" />
            <div className="flex items-center justify-center mb-1">
              <Crown size={11} className="text-amber-500" />
            </div>
            {masterNav.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} masterAccent />
            ))}
          </>
        )}
      </nav>

      <Link
        href="/configuracoes"
        className="w-11 h-11 rounded-xl flex items-center justify-center text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] transition group relative"
        title="Configurações"
      >
        <Settings size={20} />
        <span className="absolute left-14 px-2 py-1 rounded-md bg-[color:var(--foreground)] text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg z-30">
          Configurações
        </span>
      </Link>
    </aside>
  );
}
