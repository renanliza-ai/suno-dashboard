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

      /**
       * FORMA do valor das variáveis do Clarity, nunca o valor.
       *
       * Existe por uma armadilha já vivida e documentada: o que o Clarity
       * mostra no Settings geral é ID de PROJETO (curto, ~10 caracteres). O
       * token da Data Export API é um JWT de cerca de 700 caracteres que começa
       * com "eyJ". Trocar um pelo outro devolve 401 e parece problema de
       * permissão.
       *
       * Comprimento e prefixo de três letras não são o segredo: são o suficiente
       * para dizer "isso é um JWT" ou "isso é um ID", e nada além. O valor em si
       * nunca sai daqui.
       *
       * ⚠️ E serve para um alerta mais grave: variável `NEXT_PUBLIC_*` é
       * embutida pelo Next.js no bundle do NAVEGADOR. Token em variável
       * NEXT_PUBLIC_ é token publicado.
       */
      formaDasVariaveisClarity: Object.keys(process.env)
        .filter((k) => /clarit/i.test(k))
        .sort()
        .map((k) => {
          const v = String(process.env[k] || "");
          const pareceJWT = v.startsWith("eyJ");
          const publica = k.startsWith("NEXT_PUBLIC_");
          return {
            nome: k,
            comprimento: v.length,
            pareceToken: pareceJWT,
            expostaNoNavegador: publica,
            veredito: pareceJWT
              ? publica
                ? "TOKEN EXPOSTO NO BUNDLE DO NAVEGADOR: rotacionar e mover para variável sem NEXT_PUBLIC_"
                : "token da Data Export API, no lugar certo"
              : v.length > 0 && v.length < 40
                ? "ID de projeto, não token. O ID é público por natureza e não serve para a Data Export API."
                : "valor não reconhecido",
          };
        }),
      agora: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
