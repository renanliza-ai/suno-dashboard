"use client";

import { usePathname } from "next/navigation";
import { ReactNode, useState, useEffect } from "react";
import { Menu } from "lucide-react";
import Link from "next/link";
import { Sidebar } from "./sidebar";
import { FloatingChat } from "./floating-chat";
import { PeriodPicker } from "./period-picker";
import { SunoLogo } from "./suno-logo";

// Rotas que renderizam o componente <Header/> (que já inclui PeriodPicker inline).
// Nas demais, exibimos o picker fixo no topo direito como fallback.
const ROUTES_WITH_INLINE_HEADER = new Set([
  "/",
  "/anomalias",
  "/audiencia",
  "/auditoria",
  "/auditoria-utm",
  "/area-logada",
  "/conversoes",
  "/copiloto-log",
  "/cro",
  "/seo",
  "/tracking",
]);

export function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Fecha o menu mobile quando muda de rota
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (isLogin) return <>{children}</>;

  const hasInlinePicker = ROUTES_WITH_INLINE_HEADER.has(pathname);

  return (
    <>
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />

      {/* Mobile top bar — visible só em telas < md */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-[color:var(--border)] px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-[color:var(--muted)] transition"
          aria-label="Abrir menu"
        >
          <Menu size={22} />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <SunoLogo size={32} variant="mark" className="rounded-lg" />
        </Link>
        <div className="w-10" /> {/* placeholder pra centralizar logo */}
      </div>

      {!hasInlinePicker && (
        // Fallback global: páginas que não usam o componente Header ganham
        // o PeriodPicker fixado no topo direito (oculto em mobile pra não conflitar com topbar)
        <div className="hidden md:block fixed top-6 right-6 z-30">
          <PeriodPicker />
        </div>
      )}

      {/* Padding-top em mobile pra compensar topbar fixa */}
      <div className="pt-16 md:pt-0">{children}</div>

      <FloatingChat />
    </>
  );
}
