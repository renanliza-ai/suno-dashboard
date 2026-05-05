"use client";

import { motion } from "framer-motion";
import { Settings, CheckCircle2, AlertCircle, Bell, Shield, Database, Link as LinkIcon, User } from "lucide-react";
import { accounts } from "@/lib/data";
import { AccountLogo } from "@/components/account-logo";

export default function ConfiguracoesPage() {
  return (
    <main className="ml-20 p-8 max-w-[1600px]">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Settings size={20} className="text-white" />
          </span>
          Configurações
        </h1>
        <p className="text-[color:var(--muted-foreground)] mt-1">
          Contas conectadas, permissões e integrações
        </p>
      </motion.div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 bg-white rounded-2xl border border-[color:var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Database size={14} className="text-[#7c5cff]" />
                Contas Google Analytics conectadas
              </h3>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
                {accounts.length} propriedades · acesso master
              </p>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 uppercase tracking-wider">
              GMP-CLI · OAuth ativo
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {accounts.map((a, i) => (
              <motion.div
                key={a}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-3 p-3 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)]/30 transition"
              >
                <AccountLogo account={a} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a}</div>
                  <div className="text-[10px] text-[color:var(--muted-foreground)]">GA4 · sincronizado</div>
                </div>
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <User size={14} className="text-[#7c5cff]" />
              <h3 className="text-sm font-semibold">Conta</h3>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#7c5cff] to-[#b297ff] flex items-center justify-center text-white font-bold">R</div>
              <div>
                <div className="text-sm font-semibold">Renan Liza</div>
                <div className="text-[10px] text-[color:var(--muted-foreground)]">Master · Suno Research</div>
              </div>
            </div>
            <button className="w-full text-xs px-3 py-1.5 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--muted)] transition">
              Gerenciar perfil
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-[color:var(--border)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Bell size={14} className="text-[#7c5cff]" />
              <h3 className="text-sm font-semibold">Alertas</h3>
            </div>
            {[
              { label: "Quedas de conversão ≥ 10%", on: true },
              { label: "Eventos críticos ausentes", on: true },
              { label: "Anomalias de tráfego", on: true },
              { label: "Relatório semanal por email", on: false },
            ].map((a) => (
              <label key={a.label} className="flex items-center gap-2 py-1.5 cursor-pointer">
                <div className={`w-8 h-4 rounded-full transition relative ${a.on ? "bg-[#7c5cff]" : "bg-[color:var(--muted)]"}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition ${a.on ? "left-4" : "left-0.5"}`} />
                </div>
                <span className="text-xs">{a.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { title: "Google Analytics 4", desc: "Propriedades GA4 via GMP-CLI", status: "Conectado", icon: Database, connected: true },
          { title: "Google Ads", desc: "Campanhas e custos", status: "Pendente", icon: LinkIcon, connected: false },
          { title: "Meta Ads", desc: "Facebook + Instagram", status: "Pendente", icon: LinkIcon, connected: false },
          { title: "Google Tag Manager", desc: "Containers e tags", status: "Conectado", icon: Shield, connected: true },
          { title: "Search Console", desc: "Queries orgânicas", status: "Pendente", icon: LinkIcon, connected: false },
          { title: "BigQuery", desc: "Export raw GA4", status: "Pendente", icon: Database, connected: false },
        ].map((int, i) => {
          const Icon = int.icon;
          return (
            <motion.div
              key={int.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-white rounded-2xl border border-[color:var(--border)] p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${int.connected ? "bg-emerald-50 text-emerald-600" : "bg-[color:var(--muted)] text-[color:var(--muted-foreground)]"}`}>
                  <Icon size={16} />
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${int.connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {int.status}
                </span>
              </div>
              <h4 className="text-sm font-semibold">{int.title}</h4>
              <p className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">{int.desc}</p>
              <button className={`mt-3 w-full text-xs px-3 py-1.5 rounded-lg font-semibold transition ${int.connected ? "bg-[color:var(--muted)] text-[color:var(--muted-foreground)]" : "bg-[#7c5cff] text-white hover:bg-[#9b7fff]"}`}>
                {int.connected ? "Gerenciar" : "Conectar"}
              </button>
            </motion.div>
          );
        })}
      </div>
    </main>
  );
}
