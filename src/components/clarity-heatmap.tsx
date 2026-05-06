"use client";

import { motion } from "framer-motion";
import { Flame, ExternalLink, Info, MousePointerClick, Eye, Activity } from "lucide-react";
import { useGA4, useGA4PagesDetail } from "@/lib/ga4-context";
import { formatNumber } from "@/lib/utils";

/**
 * Microsoft Clarity launcher (não embed direto).
 *
 * Por que NÃO um iframe: clarity.microsoft.com responde com
 * X-Frame-Options: DENY → impossível embedar. Em vez disso, montamos
 * um painel com deep-links pra cada página do GA4, abrindo o heatmap
 * específico em nova aba.
 *
 * Como configurar:
 *   1. Crie projeto em https://clarity.microsoft.com/
 *   2. Pegue o Project ID em Settings → Setup
 *   3. Adicione no .env.local (e Vercel):
 *      NEXT_PUBLIC_CLARITY_PROJECT_<NOME_PROPRIEDADE_NORMALIZADO>=xxx
 *      // ex: NEXT_PUBLIC_CLARITY_PROJECT_STATUSINVESTWEB=ic1rhluxfu
 */
function normalizeKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * ⚠ Next.js só inlina `process.env.NEXT_PUBLIC_FOO` quando o acesso é
 * **literal** (string estática). Acesso dinâmico via process.env[var]
 * volta undefined no client. Por isso construímos um mapa estático
 * abaixo, com cada chave acessada literalmente.
 *
 * Pra adicionar uma propriedade: copie a linha e ajuste o normalize key.
 */
const CLARITY_ID_MAP: Record<string, string | undefined> = {
  STATUSINVESTWEB: process.env.NEXT_PUBLIC_CLARITY_PROJECT_STATUSINVESTWEB,
  SUNORESEARCHWEB: process.env.NEXT_PUBLIC_CLARITY_PROJECT_SUNORESEARCHWEB,
  SUNOADVISORY: process.env.NEXT_PUBLIC_CLARITY_PROJECT_SUNOADVISORY,
};

function resolveClarityId(propertyName: string | null | undefined): string | null {
  if (propertyName) {
    const key = normalizeKey(propertyName);
    const perProp = CLARITY_ID_MAP[key];
    if (perProp) return perProp;
  }
  return process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || null;
}

/**
 * Monta a URL do heatmap específico de uma página no Clarity.
 * Formato: clarity.microsoft.com/projects/view/{id}/heatmaps?url={fullUrl}
 */
function buildHeatmapUrl(projectId: string, fullUrl: string): string {
  return `https://clarity.microsoft.com/projects/view/${projectId}/heatmaps?url=${encodeURIComponent(fullUrl)}`;
}
function buildRecordingsUrl(projectId: string, fullUrl: string): string {
  return `https://clarity.microsoft.com/projects/view/${projectId}/recordings?url=${encodeURIComponent(fullUrl)}`;
}

export function ClarityHeatmap() {
  const { selected } = useGA4();
  const { data: pagesDetail } = useGA4PagesDetail();
  const projectId = resolveClarityId(selected?.displayName);

  // Top 8 páginas pra criar links de heatmap rápidos (filtra apenas as que
  // têm host válido — Clarity precisa de URL completa pra abrir o heatmap)
  const topPages = (pagesDetail?.pages || [])
    .filter((p) => p.host && p.path)
    .slice(0, 8);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Flame size={16} className="text-orange-500" />
            Mapas de calor — Microsoft Clarity
          </h3>
          <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
            Heatmaps + recordings de sessão para {selected?.displayName || "a propriedade selecionada"}
          </p>
        </div>
        {projectId && (
          <div className="flex gap-2">
            <a
              href={`https://clarity.microsoft.com/projects/view/${projectId}/dashboard`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition shadow-sm"
            >
              Abrir Clarity completo <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>

      {!projectId ? (
        <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-sm space-y-3">
          <div className="flex items-start gap-2 text-amber-900">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div>
              <strong>Clarity ainda não está configurado para esta propriedade.</strong>
              <p className="text-xs mt-1 text-amber-800">
                Adicione o Project ID no <code className="bg-amber-100 px-1 rounded">.env.local</code> + Vercel:
              </p>
            </div>
          </div>
          <pre className="p-2 bg-amber-100 rounded text-[10px] font-mono overflow-x-auto">
{`NEXT_PUBLIC_CLARITY_PROJECT_${normalizeKey(selected?.displayName || "PROPERTY")}=seu_id_aqui`}
          </pre>
        </div>
      ) : (
        <>
          {/* Atalhos principais — heatmap geral + recordings + dashboard */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <ShortcutCard
              icon={Flame}
              color="#f97316"
              title="Heatmap geral"
              description="Cliques + scroll do site todo"
              href={`https://clarity.microsoft.com/projects/view/${projectId}/heatmaps`}
            />
            <ShortcutCard
              icon={Eye}
              color="#7c5cff"
              title="Session recordings"
              description="Veja sessões reais gravadas"
              href={`https://clarity.microsoft.com/projects/view/${projectId}/recordings`}
            />
            <ShortcutCard
              icon={Activity}
              color="#10b981"
              title="Insights & Smart Events"
              description="Rage clicks, dead clicks, JS errors"
              href={`https://clarity.microsoft.com/projects/view/${projectId}/insights`}
            />
          </div>

          {/* Deep-links por página — clica numa página e abre o heatmap dela */}
          {topPages.length > 0 && (
            <div className="rounded-xl border border-[color:var(--border)] overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-[color:var(--border)] flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <MousePointerClick size={12} />
                  Heatmap por página (top 8 do GA4)
                </div>
                <span className="text-[10px] text-slate-500">
                  Clique em uma URL pra abrir o mapa de calor dela no Clarity
                </span>
              </div>
              <div className="divide-y divide-[color:var(--border)]">
                {topPages.map((p) => {
                  const fullUrl = `https://${p.host}${p.path}`;
                  return (
                    <div
                      key={`${p.host}|${p.path}`}
                      className="px-4 py-2.5 flex items-center gap-3 hover:bg-orange-50/30 transition group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">{p.path}</div>
                        <div className="text-[10px] text-[color:var(--muted-foreground)] flex items-center gap-2">
                          <span className="font-mono">{p.host}</span>
                          <span>· {formatNumber(p.views)} views</span>
                          <span>· {formatNumber(p.users)} users</span>
                        </div>
                      </div>
                      <a
                        href={buildHeatmapUrl(projectId, fullUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] px-2.5 py-1 rounded-md border border-orange-200 text-orange-700 bg-white hover:bg-orange-50 transition flex items-center gap-1 opacity-70 group-hover:opacity-100"
                        title={`Abrir heatmap de ${fullUrl} no Clarity`}
                      >
                        <Flame size={11} /> Heatmap
                      </a>
                      <a
                        href={buildRecordingsUrl(projectId, fullUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] px-2.5 py-1 rounded-md border border-purple-200 text-purple-700 bg-white hover:bg-purple-50 transition flex items-center gap-1 opacity-70 group-hover:opacity-100"
                        title={`Abrir recordings de ${fullUrl} no Clarity`}
                      >
                        <Eye size={11} /> Recordings
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600 flex items-start gap-1.5">
            <Info size={11} className="mt-0.5 shrink-0" />
            <span>
              Embed direto não é possível (a Microsoft bloqueia o iframe via X-Frame-Options).
              Os links acima abrem o Clarity em nova aba já filtrado pela URL escolhida —
              é a forma mais rápida de pular direto pro heatmap específico.
            </span>
          </div>
        </>
      )}
    </motion.div>
  );
}

function ShortcutCard({
  icon: Icon,
  color,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
  color: string;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group p-4 rounded-xl border border-[color:var(--border)] hover:border-orange-300 hover:shadow-md hover:-translate-y-0.5 transition bg-white"
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <Icon size={16} style={{ color }} />
        </div>
        <ExternalLink
          size={12}
          className="text-[color:var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition"
        />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] text-[color:var(--muted-foreground)] mt-0.5">{description}</div>
    </a>
  );
}
