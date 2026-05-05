"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

export function MasterGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isMaster = Boolean((session?.user as { isMaster?: boolean } | undefined)?.isMaster);

  useEffect(() => {
    if (status === "authenticated" && !isMaster) {
      router.replace("/");
    }
  }, [status, isMaster, router]);

  if (status === "loading") {
    return (
      <div className="ml-20 p-8 flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
        <Loader2 size={16} className="animate-spin" />
        Verificando permissões...
      </div>
    );
  }

  if (status === "authenticated" && !isMaster) {
    return (
      <div className="ml-20 p-8">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 flex gap-3">
          <ShieldAlert className="text-amber-600 shrink-0" size={22} />
          <div>
            <h2 className="font-semibold text-amber-900">Acesso restrito</h2>
            <p className="text-sm text-amber-800 mt-1">
              Esta área é exclusiva para administradores master. Redirecionando...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isMaster) return null;

  return <>{children}</>;
}
