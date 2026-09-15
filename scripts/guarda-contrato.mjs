#!/usr/bin/env node
/**
 * GUARDA 2 e 4 · este código supõe a forma de um dado que ninguém observou?
 *
 * Uso:
 *   npm run guarda:contrato              analisa o diff contra origin/main
 *   npm run guarda:contrato -- --tudo    analisa o projeto inteiro
 *
 * POR QUE EXISTE
 * Auditoria dos erros de 15/09/2026: quase nenhum foi de lógica ou de tipo.
 * Foram todos de SUPOR a forma de um dado externo em vez de olhar primeiro.
 *
 *   Li `subTotal` para toda métrica do Clarity. `Traffic` usa
 *   `totalSessionCount`, então o denominador saía ZERO em toda linha e a tela
 *   ficava vazia SEM ERRO NENHUM.
 *
 *   Reportei todos os eventos como ausentes porque supus que a linha da minha
 *   própria API tinha campo `label`. Era `dimension`.
 *
 * `tsc`, `npm run build` e o lint passaram limpos em cima dos dois. Tipo
 * declarado à mão para resposta externa não é verificação, é a mesma suposição
 * escrita duas vezes.
 *
 * O QUE ESTA GUARDA FAZ
 * Acha todo arquivo que fala com API externa e exige UMA das duas provas:
 *
 *   a) uma SONDA DE CONTRATO no próprio arquivo: algum caminho que devolva a
 *      forma crua da resposta (marcador `@sonda-contrato`), para conferir o
 *      nome real dos campos em dez segundos em vez de numa rodada inteira;
 *   b) a anotação `@forma-observada: <onde e quando eu vi a forma>`, quando a
 *      sonda não couber.
 *
 * E imprime, com os arquivos na mão, a única pergunta de revisão que pega esta
 * classe de erro. Revisão genérica não pega.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const TUDO = process.argv.includes("--tudo");

/** Chamada a host externo. Caminho relativo não conta: é a nossa própria API. */
const RE_FETCH_EXTERNO = /fetch\s*\(\s*[`"'][^`"')]*https?:\/\//i;
const RE_FETCH_TEMPLATE = /fetch\s*\(\s*`[^`]*\$\{[^}]*\}[^`]*`/;
const RE_URL_EXTERNA = /[`"']https?:\/\/(?!localhost)/i;

const RE_SONDA = /@sonda-contrato|amostraCrua|formaCrua/;
const RE_OBSERVADA = /@forma-observada:\s*\S/;

/** Receita do zero silencioso: ler campo externo com `|| 0` e depois dividir. */
const RE_COERCAO_ZERO = /(Number\s*\([^)]*\?\?\s*0|Number\s*\([^)]*\|\|\s*0|\?\?\s*0\s*\)|\|\|\s*0\s*\))/;

function arquivos() {
  if (TUDO) {
    return execSync('git ls-files "src/**/*.ts" "src/**/*.tsx" "scripts/**/*.mjs"', { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  }
  let base = "origin/main";
  try {
    execSync(`git rev-parse --verify ${base}`, { stdio: "ignore" });
  } catch {
    base = "HEAD~1";
  }
  // Três comandos SEPARADOS de propósito: encadear com ";" quebra no cmd.exe
  // do Windows, que não usa ";" como separador. Foi o primeiro defeito que
  // esta própria guarda pegou, nela mesma.
  const comandos = [
    `git diff --name-only ${base}...HEAD`,
    "git diff --name-only",
    "git diff --name-only --cached",
    // Arquivo NOVO ainda não rastreado não aparece em `git diff`, e é
    // justamente onde nasce um cliente de API externa. Sem esta linha a guarda
    // ignorava exatamente o caso que ela existe para pegar. Segundo defeito que
    // ela encontrou nela mesma.
    "git ls-files --others --exclude-standard",
  ];
  const saida = comandos
    .map((c) => {
      try {
        return execSync(c, { encoding: "utf8" });
      } catch {
        return "";
      }
    })
    .join("\n");

  return [...new Set(saida.split("\n").map((s) => s.trim()).filter(Boolean))]
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && existsSync(f));
}

const lista = arquivos();
if (lista.length === 0) {
  console.log("✓ Nada para analisar no diff.");
  process.exit(0);
}

const semProva = [];
const comCoercao = [];
let externos = 0;

for (const f of lista) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }

  const falaComExterno =
    RE_FETCH_EXTERNO.test(src) ||
    (RE_FETCH_TEMPLATE.test(src) && RE_URL_EXTERNA.test(src)) ||
    (/runReport\s*\(/.test(src) && /metricValues|dimensionValues/.test(src));

  if (!falaComExterno) continue;
  externos++;

  const temProva = RE_SONDA.test(src) || RE_OBSERVADA.test(src);
  if (!temProva) semProva.push(f);

  // Só sinaliza coerção quando o arquivo também faz divisão: `|| 0` sozinho é
  // inofensivo, `|| 0` virando denominador é o defeito.
  if (RE_COERCAO_ZERO.test(src) && /\/\s*[A-Za-z_$][\w$]*\s*\)?\s*\*\s*100|\/\s*base|\/\s*total/.test(src)) {
    comCoercao.push(f);
  }
}

console.log(`\nGuarda de contrato · ${lista.length} arquivo(s) no escopo, ${externos} falam com dado externo\n`);

let bloqueia = false;

if (semProva.length) {
  bloqueia = true;
  console.log("✗ Falam com dado externo e NÃO provam que a forma foi observada:\n");
  for (const f of semProva) console.log(`    ${f}`);
  console.log(`
  Resolva com UMA das duas:

  a) SONDA DE CONTRATO no arquivo. Um caminho que devolva a forma crua da
     resposta, com os nomes reais dos campos. Marque com "@sonda-contrato".
     Exemplo do que já existe no projeto: src/lib/clarity-api.ts devolve
     'amostraCrua' e a rota expõe em ?debug=1.

  b) ANOTAÇÃO, quando a sonda não couber:
     // @forma-observada: resposta conferida em 15/09/2026 via ?debug=1, campos
     //                   totalSessionCount (Traffic) e subTotal (fricção)
`);
}

if (comCoercao.length) {
  console.log("⚠ Coerção para zero alimentando divisão (receita do zero silencioso):\n");
  for (const f of comCoercao) console.log(`    ${f}`);
  console.log(`
  'Number(x ?? 0)' num campo externo que vira DENOMINADOR transforma "o campo
  mudou de nome" em "a tela está vazia", sem erro. Se todas as linhas saírem com
  denominador zero, falhe alto em vez de devolver lista vazia. Ver a guarda em
  src/lib/clarity-api.ts.
`);
}

if (!bloqueia && !comCoercao.length) {
  console.log("✓ Todo arquivo que fala com dado externo tem sonda ou anotação de forma observada.\n");
}

console.log("─".repeat(72));
console.log("A pergunta de revisão desta rotina, com os arquivos acima na mão:\n");
console.log("  Este código supõe a FORMA ou o ESTADO de algum dado que eu não");
console.log("  observei NESTA sessão?\n");
console.log("  Não vale a documentação da API, não vale o tipo que eu mesmo");
console.log("  escrevi, não vale a lembrança de outra vez. Vale ter olhado a");
console.log("  resposta crua agora.");
console.log("─".repeat(72) + "\n");

process.exit(bloqueia ? 1 : 0);
