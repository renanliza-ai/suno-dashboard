import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/build-info — qual commit está REALMENTE no ar.
 *
 * POR QUE EXISTE
 * Três vezes numa mesma sessão eu rodei bateria de validação contra um deploy
 * que ainda não tinha subido, e conclui coisa errada do resultado. Numa delas a
 * forense de China e Brasil voltou com números IDÊNTICOS, e só percebi porque
 * a coincidência era absurda demais. Se os números tivessem sido apenas
 * parecidos, eu teria publicado análise feita em cima de código que não estava
 * rodando.
 *
 * A memória do projeto já avisava sobre isso ("conferir o githubCommitSha do
 * deploy ativo antes de caçar bug") e eu ignorei. Lembrete não resolve, guarda
 * resolve: `npm run guarda:deploy` compara o que está aqui com o HEAD local e
 * falha se forem diferentes.
 *
 * As variáveis VERCEL_GIT_* são injetadas pela própria Vercel no build. Nenhuma
 * é segredo: commit, branch e mensagem são públicos no repositório.
 */
export async function GET() {
  return NextResponse.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      shaCurto: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      mensagem: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
      ambiente: process.env.VERCEL_ENV || "local",
      /**
       * Só o NOME das variáveis de integração que existem no runtime, nunca o
       * valor. Nome de variável não é segredo, token é. Serve para separar
       * "não configurei" de "configurei com outro nome" de "configurei só em
       * Preview", que de fora são indistinguíveis.
       */
      integracoesVistas: Object.keys(process.env)
        .filter((k) => /^(CLARITY|META|GOOGLE_ADS|GA4|ZEUS|WP)_/i.test(k))
        .sort(),
      agora: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
