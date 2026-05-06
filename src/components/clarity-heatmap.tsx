"use client";

import { motion } from "framer-motion";
import { Flame, ExternalLink, Info } from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";

/**
 * Microsoft Clarity heatmap embed.
 *
 * Por property — busca o ID via env var `NEXT_PUBLIC_CLARITY_PROJECT_<NAME>`
 * (substituindo nome normalizado por _) ou cai pro `NEXT_PUBLIC_CLARITY_PROJECT_ID` global.
 *
 * Como configurar:
 *   1. Crie projeto em https://clarity.microsoft.com/
 *   2. Pegue o Project ID em Settings → Setup
 *   3. Adicione no .env.local (e Vercel):
 *      NEXT_PUBLIC_CLARITY_PROJECT_ID=seu_id_default
 *      // ou por property:
 *      NEXT_PUBLIC_CLARITY_PROJECT_STATUSINVEST=xxx
 *      NEXT_PUBLIC_CLARITY_PROJECT_SUNORESEARCH=yyy
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

export function ClarityHeatmap() {
  const { selected } = useGA4();
  const projectId = resolveClarityId(selected?.displayName);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[color:var(--border)] p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Flame size={16} className="text-orange-500" />
            Mapa de calor — Microsoft Clarity
          </h3>
          <p className="text-xs text-[color:var(--muted-foreground)] mt-0.5">
            Heatmaps + recordings de sessão para {selected?.displayName || "a propriedade selecionada"}
          </p>
        </div>
        {projectId && (
          <a
            href={`https://clarity.microsoft.com/projects/view/${projectId}/heatmaps`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition"
          >
            Abrir no Clarity <ExternalLink size={11} />
          </a>
        )}
      </div>

      {projectId ? (
        <div className="rounded-xl overflow-hidden border border-[color:var(--border)] bg-slate-50">
          <iframe
            src={`https://clarity.microsoft.com/projects/view/${projectId}/heatmaps`}
            className="w-full h-[600px]"
            title="Microsoft Clarity Heatmap"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
          <div className="px-4 py-2 text-[10px] text-[color:var(--muted-foreground)] bg-white border-t border-[color:var(--border)] flex items-center gap-1.5">
            <Info size={10} />
            Se a Microsoft bloquear o embed (X-Frame-Options), use o botão &quot;Abrir no Clarity&quot; acima.
          </div>
        </div>
      ) : (
        <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-sm space-y-3">
          <div className="flex items-start gap-2 text-amber-900">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div>
              <strong>Clarity ainda não está configurado para esta propriedade.</strong>
              <p className="text-xs mt-1 text-amber-800">
                Configure em 3 passos para ver heatmaps + session recordings aqui dentro:
              </p>
            </div>
          </div>
          <ol className="text-xs text-amber-900 space-y-1.5 list-decimal pl-5">
            <li>
              Crie um projeto em{" "}
              <a
                href="https://clarity.microsoft.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
              >
                clarity.microsoft.com
              </a>{" "}
              e instale o tracking script no site (via GTM ou direto no &lt;head&gt;).
            </li>
            <li>
              Copie o <code className="bg-amber-100 px-1 rounded">Project ID</code> em <em>Settings → Setup</em>.
            </li>
            <li>
              Adicione no <code className="bg-amber-100 px-1 rounded">.env.local</code> (e Vercel) uma das opções:
              <pre className="mt-1.5 p-2 bg-amber-100 rounded text-[10px] font-mono overflow-x-auto">
{`# Default (todas as properties):
NEXT_PUBLIC_CLARITY_PROJECT_ID=xxxxxxxx

# Por propriedade (mais granular — sobrescreve o default):
NEXT_PUBLIC_CLARITY_PROJECT_STATUSINVESTWEB=xxxxxxxx
NEXT_PUBLIC_CLARITY_PROJECT_SUNORESEARCHWEB=yyyyyyyy
NEXT_PUBLIC_CLARITY_PROJECT_SUNOADVISORY=zzzzzzzz`}
              </pre>
            </li>
          </ol>
          <a
            href="https://clarity.microsoft.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition"
          >
            Abrir Clarity <ExternalLink size={11} />
          </a>
        </div>
      )}
    </motion.div>
  );
}
