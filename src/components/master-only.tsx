"use client";

import { useSession } from "next-auth/react";
import { ReactNode } from "react";

/**
 * Wrapper que esconde silenciosamente blocos de UI de usuários não-master.
 *
 * Diferente do <MasterGuard>, NÃO redireciona — apenas oculta.
 * Use para esconder painéis de Insights, Recomendações, Sugestões e qualquer
 * outro conteúdo que deva ficar restrito ao perfil master, dentro de uma
 * página que é compartilhada (ex.: /paginas, /eventos, /audiencia, /seo).
 *
 * Uso:
 *   <MasterOnly>
 *     <InsightsPanel />
 *   </MasterOnly>
 *
 * Com fallback opcional para usuários comuns:
 *   <MasterOnly fallback={<UpgradeCta />}>
 *     <RecommendationsPanel />
 *   </MasterOnly>
 */
export function MasterOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { data: session, status } = useSession();
  const isMaster = Boolean(
    (session?.user as { isMaster?: boolean } | undefined)?.isMaster
  );

  // Durante loading da sessão, não vaza o conteúdo (evita flash de
  // recomendações pra usuário comum nos primeiros milissegundos).
  if (status !== "authenticated" || !isMaster) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

/** Hook para uso programático fora de JSX (ex.: skip de hooks pesados). */
export function useIsMaster(): boolean {
  const { data: session, status } = useSession();
  if (status !== "authenticated") return false;
  return Boolean(
    (session?.user as { isMaster?: boolean } | undefined)?.isMaster
  );
}
