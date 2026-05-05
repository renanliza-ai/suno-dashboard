import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";
import { SunoLogo } from "@/components/suno-logo";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0b0815]">
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] blur-3xl opacity-40" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[#b297ff] to-[#7c5cff] blur-3xl opacity-30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#0b0815_70%)]" />

      <div className="relative w-full max-w-md px-6">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-10 shadow-2xl shadow-purple-500/20">
          <div className="flex flex-col items-center text-center">
            <SunoLogo size={64} variant="mark" className="rounded-2xl shadow-lg shadow-black/30" />
            <h1 className="text-3xl font-bold text-white mt-6 tracking-tight">
              Suno <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#b297ff] to-[#7c5cff]">Analytics</span>
            </h1>
            <p className="text-white/60 text-sm mt-2">
              Entre com sua conta Google corporativa para acessar o painel
            </p>
          </div>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="w-full bg-white hover:bg-gray-50 text-gray-900 font-semibold py-3.5 px-5 rounded-xl flex items-center justify-center gap-3 shadow-lg transition active:scale-[0.98]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20">
                <path fill="#4285F4" d="M19.6 10.23c0-.82-.1-1.42-.25-2.05H10v3.72h5.5c-.15.96-.74 2.31-2.04 3.22l-.02.12 2.96 2.3.2.02c1.87-1.75 2.96-4.32 2.96-7.33z" />
                <path fill="#34A853" d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.15-2.45c-.84.59-1.97 1-3.47 1-2.64 0-4.88-1.74-5.68-4.15l-.12.01-3.08 2.38-.04.11C2.72 17.75 6.09 20 10 20z" />
                <path fill="#FBBC05" d="M4.32 11.98c-.21-.63-.33-1.3-.33-2s.12-1.37.32-2l-.01-.13-3.12-2.42-.1.05C.5 6.84 0 8.36 0 9.98c0 1.62.5 3.14 1.08 4.5l3.24-2.5z" />
                <path fill="#EA4335" d="M10 3.83c1.88 0 3.15.81 3.87 1.49l2.83-2.76C14.96.99 12.7 0 10 0 6.09 0 2.72 2.25 1.08 5.5l3.23 2.5C5.12 5.58 7.36 3.83 10 3.83z" />
              </svg>
              Continuar com Google
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/10 text-center">
            <p className="text-[11px] text-white/40">
              Acesso restrito ao grupo Suno · Master e líderes de projeto
            </p>
          </div>
        </div>

        <p className="text-center text-[10px] text-white/30 mt-6 font-mono">
          powered by NextAuth · Google OAuth 2.0 · GA4 Analytics API
        </p>
      </div>
    </main>
  );
}
