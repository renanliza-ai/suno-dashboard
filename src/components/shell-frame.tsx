"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { FloatingChat } from "./floating-chat";
import { PeriodPicker } from "./period-picker";

// Rotas que renderizam o componente <Header/> (que já inclui PeriodPicker inline).
// Nas demais, exibimos o picker fixo no topo direito como fallback.
//
// IMPORTANTE: toda rota nova que usar <Header/> deve ser adicionada aqui pra
// evitar duplicação visual de date range (1 no header + 1 no fallback global).
const ROUTES_WITH_INLINE_HEADER = new Set([
  "/",
  "/anomalias",
  "/audiencia",
  "/auditoria",
  "/conversoes",
  "/copiloto-log",
  "/cro",
  "/seo",
  "/tracking",
]);

export function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) return <>{children}</>;

  const hasInlinePicker = ROUTES_WITH_INLINE_HEADER.has(pathname);

  return (
    <>
      <Sidebar />
      {!hasInlinePicker && (
        // Fallback global: páginas que não usam o componente Header ganham
        // o PeriodPicker fixado no topo direito, fora do fluxo do h1.
        <div className="fixed top-6 right-6 z-40">
          <PeriodPicker />
        </div>
      )}
      {children}
      <FloatingChat />
    </>
  );
}
