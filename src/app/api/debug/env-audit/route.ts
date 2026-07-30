import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/debug/env-audit — 🔒 master-only
 *
 * Mostra O QUE O DEPLOY EM EXECUÇÃO realmente enxerga de credenciais de mídia.
 * Criado porque o Renan subiu as vars de Meta "para todas as B.U.s" mas o
 * servidor só resolvia 3 entradas: precisamos ver a verdade do runtime, não a
 * expectativa do painel do Vercel.
 *
 * ⚠️ SEGURANÇA: nunca retorna VALOR de token/segredo. Apenas:
 *   - o NOME da variável
 *   - se está definida e o tamanho do valor (pra detectar valor vazio/truncado)
 *   - para nomes de property (não é segredo), o valor textual
 *   - resultado de um ping ao Meta por slot (token vivo / expirado), sem expor o token
 */

const SECRET_RE = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i;
const RELEVANT_RE = /^(META_|GOOGLE_ADS|GOOGLE_APPLICATION|CLARITY|NEXT_PUBLIC_CLARITY|MONDAY_|GEMINI|AUTH_GOOGLE|BRIEFING_|CRON_SECRET|HEALTH_ALERT)/i;

export async function GET() {
  const session = (await auth()) as { user?: { isMaster?: boolean } } | null;
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  // 1) Inventário de vars relevantes (nome + definida + tamanho; valor só se não for segredo)
  const inventory = Object.keys(process.env)
    .filter((k) => RELEVANT_RE.test(k))
    .sort()
    .map((k) => {
      const v = process.env[k] || "";
      const isSecret = SECRET_RE.test(k);
      return {
        name: k,
        defined: v.length > 0,
        length: v.length,
        value: isSecret ? null : v, // nome de property/ID não é segredo
      };
    });

  // 2) Slots de Meta Ads: o que existe e o que falta
  type Slot = {
    slot: number;
    propertyName: string | null;
    hasAccountId: boolean;
    accountId: string | null;
    hasToken: boolean;
    tokenLength: number;
    tokenStatus?: string;
    tokenExpiresHint?: string | null;
  };
  const slots: Slot[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = process.env[`META_ADS_PROPERTY_${i}_NAME`] || null;
    const acc = process.env[`META_ADS_PROPERTY_${i}_AD_ACCOUNT_ID`] || null;
    const tok = process.env[`META_ADS_PROPERTY_${i}_TOKEN`] || "";
    if (!name && !acc && !tok) continue;
    slots.push({
      slot: i,
      propertyName: name,
      hasAccountId: Boolean(acc),
      accountId: acc, // ID de conta de anúncios não é segredo
      hasToken: tok.length > 0,
      tokenLength: tok.length,
    });
  }

  // 3) Ping por slot: token vivo ou expirado (não expõe o token)
  await Promise.all(
    slots.map(async (s) => {
      const tok = process.env[`META_ADS_PROPERTY_${s.slot}_TOKEN`];
      if (!tok) {
        s.tokenStatus = "sem token";
        return;
      }
      try {
        const r = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${tok}`, { cache: "no-store" });
        const j = (await r.json()) as { error?: { message?: string; code?: number } };
        if (j.error) {
          s.tokenStatus = j.error.code === 190 ? "EXPIRADO/INVÁLIDO" : `erro ${j.error.code}`;
          // A mensagem da Meta traz a data de expiração — útil e não é segredo.
          s.tokenExpiresHint = j.error.message?.slice(0, 160) || null;
        } else {
          s.tokenStatus = "válido";
        }
      } catch (e) {
        s.tokenStatus = `falha de rede: ${(e as Error).message}`;
      }
    })
  );

  // 4) Google Ads: slots de customer id por property
  const googleSlots: { slot: number; propertyName: string | null; customerId: string | null }[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = process.env[`GOOGLE_ADS_PROPERTY_${i}_NAME`] || null;
    const cid = process.env[`GOOGLE_ADS_PROPERTY_${i}_CUSTOMER_ID`] || null;
    if (!name && !cid) continue;
    googleSlots.push({ slot: i, propertyName: name, customerId: cid });
  }

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      // Qual deployment está servindo — se a var nova não aparece, pode ser
      // deployment antigo (env só entra em build novo) ou ambiente errado.
      deployment: {
        vercelEnv: process.env.VERCEL_ENV || "(local)",
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
        region: process.env.VERCEL_REGION || null,
      },
      metaAdsSlots: slots,
      googleAdsSlots: googleSlots,
      metaGlobalFallback: {
        hasAccount: Boolean(process.env.META_ADS_AD_ACCOUNT_ID),
        hasToken: Boolean(process.env.META_ADS_ACCESS_TOKEN),
      },
      inventory,
      hint:
        "Se uma var que você salvou no Vercel NÃO aparece aqui: (1) foi salva em outro Environment (marque Production) ou (2) não houve redeploy depois de salvar (env só entra em build novo) ou (3) está em outro projeto Vercel. Se aparece mas o tokenStatus é EXPIRADO: gerar System User token com validade 'Nunca'.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
