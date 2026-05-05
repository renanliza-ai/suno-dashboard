import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/debug/refresh-token
 *
 * 🔒 ENDPOINT MASTER-ONLY E TEMPORÁRIO.
 *
 * Retorna o refresh_token Google OAuth da sessão do usuário logado.
 * Em produção, NextAuth v5 usa cookie name `__Secure-authjs.session-token`
 * (com prefixo Secure por causa do HTTPS), enquanto dev usa `authjs.session-token`.
 * Este endpoint tenta ambos os salts para funcionar nos dois ambientes.
 */
export async function GET() {
  const session = (await auth()) as {
    user?: { isMaster?: boolean; email?: string };
  } | null;

  // Gate: só master
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  const { getToken } = await import("next-auth/jwt");
  const { headers } = await import("next/headers");
  const reqHeaders = await headers();
  const cookieHeader = reqHeaders.get("cookie") || "";
  const fakeReq = {
    headers: {
      get: (name: string) => (name.toLowerCase() === "cookie" ? cookieHeader : null),
    },
  } as unknown as Request;

  // Tenta os 2 salts possíveis (production usa o "__Secure-" prefix)
  const salts = ["__Secure-authjs.session-token", "authjs.session-token"];
  let token: { refreshToken?: string; accessTokenExpires?: number; isMaster?: boolean } | null = null;
  let usedSalt: string | null = null;
  for (const salt of salts) {
    try {
      const t = (await getToken({
        req: fakeReq as unknown as Parameters<typeof getToken>[0]["req"],
        secret: process.env.AUTH_SECRET,
        salt,
      })) as { refreshToken?: string; accessTokenExpires?: number; isMaster?: boolean } | null;
      if (t) {
        token = t;
        usedSalt = salt;
        break;
      }
    } catch {
      // tenta o próximo
    }
  }

  // Diagnóstico: se ainda não achou, mostra os cookies disponíveis pra debug
  const cookieNames = cookieHeader
    .split(";")
    .map((c) => c.trim().split("=")[0])
    .filter(Boolean);

  return NextResponse.json({
    user: session.user.email,
    refreshToken: token?.refreshToken || "(NÃO ENCONTRADO — veja diagnóstico abaixo)",
    accessTokenExpires: token?.accessTokenExpires
      ? new Date(token.accessTokenExpires * 1000).toISOString()
      : null,
    diagnostico: {
      saltUsado: usedSalt,
      cookiesPresentes: cookieNames,
      hasAuthSecret: Boolean(process.env.AUTH_SECRET),
      tokenKeysFound: token ? Object.keys(token) : null,
    },
    instructions: [
      "1. Copia o valor de `refreshToken` (sem aspas)",
      "2. Cola em BRIEFING_REFRESH_TOKEN nas Environment Variables da Vercel",
      "3. Marca para Production environment",
      "4. Redeploy o projeto",
      "5. APAGA este arquivo do repo: src/app/api/debug/refresh-token/route.ts",
    ],
  });
}
