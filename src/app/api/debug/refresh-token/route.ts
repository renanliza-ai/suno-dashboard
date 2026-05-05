import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/debug/refresh-token
 *
 * 🔒 ENDPOINT MASTER-ONLY E TEMPORÁRIO.
 *
 * Retorna o refresh_token Google OAuth da sessão do usuário logado, pra
 * configurar BRIEFING_REFRESH_TOKEN em ambientes de produção (cron).
 *
 * COMO USAR:
 * 1. Faça login em https://suno-dashboard-painel.vercel.app
 * 2. Acesse https://suno-dashboard-painel.vercel.app/api/debug/refresh-token
 * 3. Copie o campo `refreshToken` da resposta JSON
 * 4. Cole em BRIEFING_REFRESH_TOKEN no Vercel → Redeploy
 *
 * APÓS USAR: DELETE este arquivo do repo (medida de segurança).
 */
export async function GET() {
  const session = (await auth()) as {
    user?: { isMaster?: boolean; email?: string };
    accessToken?: string;
    // O refreshToken não vem no `session` por padrão, vamos usar o getToken cru
  } | null;

  // Gate: só master
  if (!session?.user?.isMaster) {
    return NextResponse.json(
      { error: "forbidden_master_only" },
      { status: 403 }
    );
  }

  // Lê o JWT raw via getToken pra acessar o refreshToken (não está exposto na session)
  const { getToken } = await import("next-auth/jwt");
  const { headers } = await import("next/headers");
  const reqHeaders = await headers();
  const cookieHeader = reqHeaders.get("cookie") || "";
  const fakeReq = {
    headers: {
      get: (name: string) => (name.toLowerCase() === "cookie" ? cookieHeader : null),
    },
  } as unknown as Request;

  const token = (await getToken({
    req: fakeReq as unknown as Parameters<typeof getToken>[0]["req"],
    secret: process.env.AUTH_SECRET,
    salt: "authjs.session-token",
  })) as { refreshToken?: string; accessTokenExpires?: number } | null;

  return NextResponse.json({
    user: session.user.email,
    refreshToken: token?.refreshToken || "(não encontrado — faça logout e login novamente)",
    accessTokenExpires: token?.accessTokenExpires
      ? new Date(token.accessTokenExpires * 1000).toISOString()
      : null,
    instructions: [
      "1. Copia o valor de `refreshToken` (sem aspas)",
      "2. Cola em BRIEFING_REFRESH_TOKEN nas Environment Variables da Vercel",
      "3. Marca para Production environment",
      "4. Redeploy o projeto",
      "5. APAGA este arquivo do repo: src/app/api/debug/refresh-token/route.ts",
    ],
  });
}
