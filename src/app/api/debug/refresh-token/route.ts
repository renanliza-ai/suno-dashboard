import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/debug/refresh-token
 *
 * 🔒 ENDPOINT MASTER-ONLY E TEMPORÁRIO.
 *
 * Lê o cookie de sessão NextAuth diretamente do request, decodifica com o
 * AUTH_SECRET e devolve o refresh_token Google OAuth.
 *
 * Diferente da versão anterior, agora usa o NextRequest real (não fake) e
 * tenta múltiplas combinações de cookieName/salt pra cobrir dev e produção.
 */
export async function GET(req: NextRequest) {
  const session = (await auth()) as {
    user?: { isMaster?: boolean; email?: string };
  } | null;

  // Gate: só master
  if (!session?.user?.isMaster) {
    return NextResponse.json({ error: "forbidden_master_only" }, { status: 403 });
  }

  // Lê todos os cookies disponíveis no request (NextRequest tem .cookies nativo)
  const allCookies = req.cookies.getAll();
  const cookieNames = allCookies.map((c) => c.name);

  // Identifica qual cookie de sessão está presente (production usa prefixo __Secure-)
  const possibleCookies = [
    "__Secure-authjs.session-token",
    "authjs.session-token",
  ];

  let foundCookieName: string | null = null;
  let cookieValue: string | null = null;
  for (const name of possibleCookies) {
    const c = req.cookies.get(name);
    if (c?.value) {
      foundCookieName = name;
      cookieValue = c.value;
      break;
    }
  }

  // Se cookie está chunkificado (NextAuth divide cookies grandes em .0, .1, etc.)
  if (!cookieValue) {
    const chunks: { name: string; value: string }[] = [];
    for (const c of allCookies) {
      if (/(__Secure-)?authjs\.session-token\.\d+/.test(c.name)) {
        chunks.push(c);
      }
    }
    if (chunks.length > 0) {
      chunks.sort((a, b) => {
        const an = Number(a.name.split(".").pop());
        const bn = Number(b.name.split(".").pop());
        return an - bn;
      });
      cookieValue = chunks.map((c) => c.value).join("");
      foundCookieName = chunks[0].name.replace(/\.\d+$/, "");
    }
  }

  if (!cookieValue) {
    return NextResponse.json({
      error: "session_cookie_not_found",
      diagnostico: {
        cookiesPresentes: cookieNames,
        hasAuthSecret: Boolean(process.env.AUTH_SECRET),
      },
    });
  }

  // Tenta decodificar com diferentes salts
  const saltsToTry = [
    foundCookieName!, // salt padrão = cookieName
    "authjs.session-token",
    "__Secure-authjs.session-token",
  ];

  type DecodedToken = {
    refreshToken?: string;
    accessTokenExpires?: number;
    isMaster?: boolean;
    [key: string]: unknown;
  };
  let decoded: DecodedToken | null = null;
  let usedSalt: string | null = null;
  let lastError: string | null = null;

  for (const salt of saltsToTry) {
    try {
      const result = await decode({
        token: cookieValue,
        secret: process.env.AUTH_SECRET || "",
        salt,
      });
      if (result) {
        decoded = result as unknown as DecodedToken;
        usedSalt = salt;
        break;
      }
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  return NextResponse.json({
    user: session.user.email,
    refreshToken: decoded?.refreshToken || "(NÃO ENCONTRADO — veja diagnóstico abaixo)",
    accessTokenExpires: decoded?.accessTokenExpires
      ? new Date(decoded.accessTokenExpires * 1000).toISOString()
      : null,
    diagnostico: {
      cookieEncontrado: foundCookieName,
      saltUsado: usedSalt,
      cookiesPresentes: cookieNames,
      hasAuthSecret: Boolean(process.env.AUTH_SECRET),
      tokenKeysFound: decoded ? Object.keys(decoded) : null,
      lastDecodeError: lastError,
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
