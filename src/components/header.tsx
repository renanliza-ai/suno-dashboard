"use client";

import { Bell, ChevronDown, Search, Check, LogOut, Crown, Database, Loader2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { AccountLogo } from "./account-logo";
import { motion, AnimatePresence } from "framer-motion";
import { useSession, signOut, signIn } from "next-auth/react";
import { useGA4 } from "@/lib/ga4-context";
import { RefreshCw } from "lucide-react";
import { PeriodPicker } from "./period-picker";

export function Header() {
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const { data: session } = useSession();
  const { properties, selected, selectedId, setSelectedId, loading, error, useRealData, refetch } = useGA4();
  const isAuthError = error?.includes("token_expired") || error?.includes("auth_") || error?.includes("no_session");

  const user = session?.user;
  // Default: não-master. Só abre UI master quando o token tiver isMaster=true.
  const isMaster = (user as { isMaster?: boolean } | undefined)?.isMaster ?? false;
  const firstName = user?.name?.split(" ")[0] || "Renan";
  const displayAccount = selected?.displayName || "Selecione uma propriedade";

  return (
    <header className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4">
        <motion.div
          key={selectedId || "none"}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", damping: 18, stiffness: 220 }}
          className="bg-white rounded-2xl border border-[color:var(--border)] p-2.5 shadow-sm"
        >
          <AccountLogo account={displayAccount} size={48} className="rounded-xl" />
        </motion.div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Bem-vindo, <span className="text-[#7c5cff]">{firstName}</span> 👋
          </h1>
          <p className="text-[color:var(--muted-foreground)] mt-1 flex items-center gap-2">
            Visualizando: <span className="font-medium text-[color:var(--foreground)]">{displayAccount}</span>
            {useRealData && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE GA4
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Period picker — controla o range de datas de todas as telas */}
        <PeriodPicker />

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Buscar..."
            className="bg-white pl-9 pr-4 py-2.5 rounded-xl border border-[color:var(--border)] text-sm w-56 focus:outline-none focus:ring-2 focus:ring-[#7c5cff]/30"
          />
        </div>

        <button className="relative w-11 h-11 rounded-xl bg-white border border-[color:var(--border)] flex items-center justify-center hover:bg-[color:var(--muted)] transition">
          <Bell size={18} />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#ef4444]" />
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-[color:var(--border)] hover:bg-[color:var(--muted)] transition min-w-[220px]"
          >
            <AccountLogo account={displayAccount} size={24} className="rounded-md flex-shrink-0" />
            <span className="text-sm font-medium flex-1 text-left truncate">{displayAccount}</span>
            {loading ? (
              <Loader2 size={14} className="animate-spin text-[color:var(--muted-foreground)]" />
            ) : (
              <ChevronDown size={16} className={`text-[color:var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
            )}
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-[color:var(--border)] shadow-xl shadow-black/5 py-2 z-30 max-h-[480px] overflow-y-auto"
              >
                <div className="px-3 py-2 text-[10px] font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Database size={11} />
                    GA4 Properties
                  </span>
                  {useRealData && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono normal-case">
                      {properties.length} conectadas
                    </span>
                  )}
                </div>

                {error && (
                  <div className="mx-2 my-1 p-2.5 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-700 space-y-2">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <span>
                        {isAuthError ? (
                          <>Sessão expirada no Google. Clique em <strong>Reconectar</strong> para renovar seu acesso ao GA4.</>
                        ) : (
                          <>Não consegui listar suas properties: {error.slice(0, 120)}</>
                        )}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {isAuthError ? (
                        <button
                          onClick={() => signIn("google", { callbackUrl: "/" })}
                          className="flex-1 px-2 py-1.5 rounded-md bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 transition flex items-center justify-center gap-1"
                        >
                          <RefreshCw size={11} /> Reconectar com Google
                        </button>
                      ) : (
                        <button
                          onClick={() => refetch()}
                          className="flex-1 px-2 py-1.5 rounded-md bg-white border border-red-200 text-red-700 text-[11px] font-semibold hover:bg-red-100 transition flex items-center justify-center gap-1"
                        >
                          <RefreshCw size={11} /> Tentar novamente
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {loading && (
                  <div className="px-3 py-4 text-xs text-[color:var(--muted-foreground)] flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Carregando properties do GA4...
                  </div>
                )}

                {!loading && !error && properties.length === 0 && (
                  <div className="px-3 py-4 text-xs text-[color:var(--muted-foreground)]">
                    Nenhuma property encontrada nesta conta Google.
                  </div>
                )}

                {properties.map((p) => {
                  const isActive = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedId(p.id);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition ${
                        isActive ? "bg-[#ede9fe]" : "hover:bg-[color:var(--muted)]"
                      }`}
                    >
                      <AccountLogo account={p.displayName} size={28} className="rounded-md flex-shrink-0" />
                      <div className="flex-1 text-left min-w-0">
                        <div className="font-medium truncate">{p.displayName}</div>
                        <div className="text-[10px] text-[color:var(--muted-foreground)] font-mono truncate">
                          {p.account} · {p.id}
                        </div>
                      </div>
                      {isActive && <Check size={14} className="text-[#7c5cff] shrink-0" />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative">
          <button
            onClick={() => setUserMenu(!userMenu)}
            className="flex items-center gap-3 bg-white px-3 py-2 rounded-xl border border-[color:var(--border)] hover:bg-[color:var(--muted)] transition"
          >
            <div className="relative">
              {user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name || "avatar"}
                  className="w-9 h-9 rounded-full ring-2 ring-white object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-400 via-fuchsia-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm ring-2 ring-white">
                  {firstName[0]}
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#10b981] border-2 border-white" />
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium leading-tight">{user?.name || "Renan Liza"}</p>
              <p className="text-xs flex items-center gap-1">
                {isMaster ? (
                  <>
                    <Crown size={10} className="text-amber-500" />
                    <span className="text-amber-600 font-semibold">Master</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span className="text-[#10b981]">Líder</span>
                  </>
                )}
              </p>
            </div>
          </button>

          <AnimatePresence>
            {userMenu && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl border border-[color:var(--border)] shadow-xl shadow-black/5 py-2 z-30"
              >
                {user?.email && (
                  <div className="px-3 py-2 border-b border-[color:var(--border)] mb-1">
                    <p className="text-xs text-[color:var(--muted-foreground)] truncate">{user.email}</p>
                    <p className="text-[10px] text-emerald-600 font-mono mt-0.5">● Conectado via Google</p>
                  </div>
                )}
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                >
                  <LogOut size={14} />
                  Sair
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
