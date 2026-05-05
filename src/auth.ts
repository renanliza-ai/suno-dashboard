import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// IMPORTANTE: defina MASTER_EMAILS no .env (lista separada por vírgula) para
// controlar quem tem acesso às abas master (CRO, Tracking, Copiloto Log).
// Se a variável estiver vazia, NINGUÉM é master — evita vazar CRO pra usuários comuns.
const masterEmails = (process.env.MASTER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope:
            "openid email profile " +
            "https://www.googleapis.com/auth/analytics.readonly " +
            "https://www.googleapis.com/auth/webmasters.readonly",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Primeiro login: salva tokens e calcula expiração
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        // Google retorna expires_at (epoch segundos) e/ou expires_in (segundos até expirar)
        const expiresAt =
          (account.expires_at as number | undefined) ??
          (account.expires_in ? Math.floor(Date.now() / 1000) + (account.expires_in as number) : undefined);
        token.accessTokenExpires = expiresAt;
      }
      if (profile?.email) {
        // SEGURANÇA: se MASTER_EMAILS não estiver configurado, NINGUÉM é master.
        // Isso garante que CRO/Tracking/Copiloto Log fiquem ocultos por padrão.
        token.isMaster =
          masterEmails.length > 0 && masterEmails.includes(profile.email.toLowerCase());
      }

      // Token ainda válido? (60s de buffer)
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = token.accessTokenExpires as number | undefined;
      if (exp && nowSec < exp - 60) {
        return token;
      }

      // Precisa renovar via refresh_token
      if (!token.refreshToken) return { ...token, error: "no_refresh_token" };
      try {
        const params = new URLSearchParams({
          client_id: process.env.AUTH_GOOGLE_ID || "",
          client_secret: process.env.AUTH_GOOGLE_SECRET || "",
          grant_type: "refresh_token",
          refresh_token: token.refreshToken as string,
        });
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const refreshed = (await res.json()) as {
          access_token?: string;
          expires_in?: number;
          refresh_token?: string;
          error?: string;
        };
        if (!res.ok || !refreshed.access_token) {
          return { ...token, error: refreshed.error || "refresh_failed" };
        }
        return {
          ...token,
          accessToken: refreshed.access_token,
          accessTokenExpires: Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 3600),
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          error: undefined,
        };
      } catch (e) {
        return { ...token, error: e instanceof Error ? e.message : "refresh_error" };
      }
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { isMaster?: boolean }).isMaster = Boolean(token.isMaster);
      }
      (session as { accessToken?: string; authError?: string }).accessToken =
        token.accessToken as string | undefined;
      (session as { accessToken?: string; authError?: string }).authError =
        token.error as string | undefined;
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = !!auth?.user;
      const isLogin = nextUrl.pathname === "/login";
      if (isLogin) return loggedIn ? Response.redirect(new URL("/", nextUrl)) : true;
      return loggedIn;
    },
  },
  session: { strategy: "jwt" },
});
