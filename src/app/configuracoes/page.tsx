"use client";

import { motion } from "framer-motion";
import { Settings, CheckCircle2, AlertCircle, Bell, Shield, Database, Link as LinkIcon, User, ExternalLink, X, Copy } from "lucide-react";
import { accounts } from "@/lib/data";
import { AccountLogo } from "@/components/account-logo";
import { useState } from "react";

// ============================================================
// Instruções de cada integração — guia visual passo-a-passo
// ============================================================
type Integration = {
  title: string;
  desc: string;
  status: "Conectado" | "Pendente";
  icon: typeof Database;
  connected: boolean;
  envVars?: { name: string; description: string; example?: string }[];
  steps?: string[];
  docsUrl?: string;
};

const integrations: Integration[] = [
  {
    title: "Google Analytics 4",
    desc: "Propriedades GA4 via GMP-CLI",
    status: "Conectado",
    icon: Database,
    connected: true,
  },
  {
    title: "Google Ads",
    desc: "Campanhas e custos",
    status: "Pendente",
    icon: LinkIcon,
    connected: false,
    envVars: [
      { name: "GOOGLE_ADS_CLIENT_ID", description: "OAuth Client ID do Google Cloud Console" },
      { name: "GOOGLE_ADS_CLIENT_SECRET", description: "OAuth Client Secret" },
      { name: "GOOGLE_ADS_REFRESH_TOKEN", description: "Refresh Token gerado via OAuth flow (uma vez só)" },
      { name: "GOOGLE_ADS_DEVELOPER_TOKEN", description: "Developer Token aprovado pela Google (Ads → Tools → API Center)" },
      { name: "GOOGLE_ADS_PROPERTY_1_NAME", description: "Nome exato da propriedade (ex: Suno Research – Web)" },
      { name: "GOOGLE_ADS_PROPERTY_1_CUSTOMER_ID", description: "Customer ID sem traços (XXX-XXX-XXXX → XXXXXXXXXX)", example: "1234567890" },
      { name: "GOOGLE_ADS_PROPERTY_1_LOGIN_CUSTOMER_ID", description: "Opcional — Manager Account (MCC) ID se você acessa via MCC" },
    ],
    steps: [
      "Solicite o Developer Token em https://ads.google.com → Tools → API Center (pode levar 1-3 dias úteis)",
      "Crie OAuth no Google Cloud Console: APIs & Services → Credentials → OAuth 2.0 Client ID (tipo: Desktop App)",
      "Gere o Refresh Token usando o OAuth Playground ou script local",
      "Pegue o Customer ID no canto superior direito do Google Ads (formato XXX-XXX-XXXX)",
      "Adicione TODAS as variáveis no Vercel Settings → Environment Variables",
      "Force redeploy SEM cache pra pegar as novas vars",
    ],
    docsUrl: "https://developers.google.com/google-ads/api/docs/oauth/cloud-project",
  },
  {
    title: "Meta Ads",
    desc: "Facebook + Instagram",
    status: "Pendente",
    icon: LinkIcon,
    connected: false,
    envVars: [
      { name: "META_ADS_PROPERTY_1_NAME", description: "Nome exato da propriedade (ex: Suno Research – Web)" },
      { name: "META_ADS_PROPERTY_1_AD_ACCOUNT_ID", description: "Ad Account ID sem prefixo act_ (10-15 dígitos)", example: "1234567890" },
      { name: "META_ADS_PROPERTY_1_TOKEN", description: "System User Token com permissão ads_read (pode reusar o token do CAPI)" },
    ],
    steps: [
      "Acesse https://business.facebook.com/settings/ad-accounts e copie o ID da conta de anúncios",
      "Garanta que o System User Token (mesmo do CAPI) tem permissão ads_read e ads_management — Business Settings → System Users",
      "Atribua a conta de anúncios ao System User com 'Manage Ads'",
      "Adicione as 3 variáveis no Vercel Environment Variables",
      "Force redeploy. A integração Meta Ads ativa automaticamente em /midia",
    ],
    docsUrl: "https://developers.facebook.com/docs/marketing-api/insights",
  },
  {
    title: "Google Tag Manager",
    desc: "Containers e tags",
    status: "Conectado",
    icon: Shield,
    connected: true,
  },
  {
    title: "Search Console",
    desc: "Queries orgânicas",
    status: "Pendente",
    icon: LinkIcon,
    connected: false,
    envVars: [
      { name: "GSC_SITE_URL", description: "URL da propriedade no Search Console (ex: sc-domain:suno.com.br ou https://suno.com.br/)" },
    ],
    steps: [
      "Acesse https://search.google.com/search-console e selecione a propriedade",
      "Garanta que a Service Account do GMP-CLI tem permissão de leitura na propriedade",
      "Adicione GSC_SITE_URL no Vercel (formato: sc-domain:exemplo.com OU https://exemplo.com/ com a barra final)",
      "Redeploy. A aba /seo passa a mostrar dados reais",
    ],
    docsUrl: "https://developers.google.com/webmaster-tools/v1/searchanalytics/query",
  },
  {
    title: "BigQuery",
    desc: "Export raw GA4",
    status: "Pendente",
    icon: Database,
    connected: false,
    envVars: [
      { name: "GCP_PROJECT_ID", description: "ID do projeto Google Cloud onde está o dataset" },
      { name: "BIGQUERY_DATASET_ID", description: "Nome do dataset (ex: analytics_123456789)" },
      { name: "GOOGLE_APPLICATION_CREDENTIALS_JSON", description: "JSON inteiro da Service Account (cole como string)" },
    ],
    steps: [
      "Ative o link GA4 → BigQuery em Admin → BigQuery Linking (dentro do GA4)",
      "Aguarde 24h pro primeiro export dos dados raw",
      "Crie Service Account no GCP com role BigQuery Data Viewer",
      "Adicione as 3 variáveis no Vercel (o JSON da SA inteiro como string)",
      "Redeploy. Endpoints raw passam a estar disponíveis em /api/bigquery/*",
    ],
    docsUrl: "https://cloud.google.com/bigquery/docs/quickstarts/quickstart-client-libraries",
  },
];

export default function ConfiguracoesPage() {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);

  function copyEnvVar(name: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(name);
    }
  }

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1600px]">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {integrations.map((int, i) => {
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
              <button
                onClick={() => setSelectedIntegration(int)}
                className={`mt-3 w-full text-xs px-3 py-1.5 rounded-lg font-semibold transition ${int.connected ? "bg-[color:var(--muted)] text-[color:var(--muted-foreground)] hover:bg-slate-200" : "bg-[#7c5cff] text-white hover:bg-[#9b7fff]"}`}
              >
                {int.connected ? "Gerenciar" : "Conectar"}
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* MODAL DE INSTRUÇÕES DE INTEGRAÇÃO */}
      {selectedIntegration && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setSelectedIntegration(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-[color:var(--border)] flex items-start justify-between gap-4 sticky top-0 bg-white">
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${selectedIntegration.connected ? "bg-emerald-50 text-emerald-600" : "bg-violet-50 text-violet-600"}`}>
                  <selectedIntegration.icon size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2 flex-wrap">
                    {selectedIntegration.title}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${selectedIntegration.connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {selectedIntegration.status}
                    </span>
                  </h2>
                  <p className="text-sm text-[color:var(--muted-foreground)] mt-0.5">
                    {selectedIntegration.desc}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedIntegration(null)}
                className="text-slate-400 hover:text-slate-700 transition"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {selectedIntegration.connected && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-emerald-700 shrink-0 mt-0.5" />
                  <div className="text-sm text-emerald-900">
                    <strong>Integração já ativa.</strong> Pra desconectar ou reconfigurar, edite as variáveis de
                    ambiente na Vercel e faça redeploy.
                  </div>
                </div>
              )}

              {!selectedIntegration.connected && selectedIntegration.steps && (
                <div>
                  <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                    📋 Passo-a-passo
                  </h3>
                  <ol className="space-y-2 text-sm text-slate-700">
                    {selectedIntegration.steps.map((step, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="font-bold text-[#7c5cff] shrink-0">{idx + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {!selectedIntegration.connected && selectedIntegration.envVars && (
                <div>
                  <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                    🔑 Variáveis de ambiente necessárias
                  </h3>
                  <p className="text-xs text-slate-600 mb-3">
                    Adicione na Vercel em <strong>Settings → Environment Variables</strong>. Marque pra Production +
                    Preview + Development. Clique no nome pra copiar.
                  </p>
                  <div className="space-y-2">
                    {selectedIntegration.envVars.map((v) => (
                      <div
                        key={v.name}
                        className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs font-mono font-bold text-violet-700 break-all">
                            {v.name}
                          </code>
                          <button
                            onClick={() => copyEnvVar(v.name)}
                            className="shrink-0 text-[10px] font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white"
                            title="Copiar nome"
                          >
                            <Copy size={10} />
                            Copiar
                          </button>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{v.description}</p>
                        {v.example && (
                          <p className="text-[10px] font-mono text-slate-400 mt-1">
                            Exemplo: <code>{v.example}</code>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!selectedIntegration.connected && (
                <div className="rounded-xl bg-blue-50/60 border border-blue-200 p-4 text-sm text-blue-900">
                  <strong className="block mb-1">💡 Após configurar:</strong>
                  <p className="text-xs">
                    1. Vá em Vercel → seu projeto → Deployments → último deploy → 3 pontinhos → <strong>Redeploy</strong>
                    <br />
                    2. <strong>DESMARQUE</strong> "Use existing Build Cache"
                    <br />
                    3. Aguarde 1-2min e teste novamente. A integração ativa automaticamente.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                {selectedIntegration.docsUrl && (
                  <a
                    href={selectedIntegration.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition"
                  >
                    <ExternalLink size={12} />
                    Documentação oficial
                  </a>
                )}
                <a
                  href="https://vercel.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7c5cff] hover:bg-[#6b4fe0] text-white text-xs font-semibold transition"
                >
                  <ExternalLink size={12} />
                  Abrir Vercel Environment Variables
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
