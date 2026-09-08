/* Reproduz a corrupção do cookie _ga no checkout.
   Hipótese registrada: o checkout prefixa "GA1.1." no _ga a cada carregamento,
   e o valor vai acumulando até não ser mais reconhecido pelo GA4. Consequência:
   a sessão de origem se perde e a venda cai em (not set).

   Método: abro uma página da Suno para o GA4 criar o cookie, anoto o valor, e
   depois carrego o checkout várias vezes lendo o cookie a cada volta. Se a
   hipótese estiver certa, o valor cresce a cada carga.

   Não compro nada e não preencho dado de ninguém: só carrego páginas. */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const ORIGEM = 'https://www.suno.com.br/';
const CHECKOUT = process.env.CHECKOUT_URL || 'https://checkout.suno.com.br/';
const CARGAS = 6;

const nav = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const pg = await nav.newPage();
await pg.setViewport({ width: 1280, height: 900 });

async function lerGa() {
  const cks = await pg.cookies();
  const ga = cks.find((c) => c.name === '_ga');
  if (!ga) return null;
  const v = ga.value;
  return {
    valor: v,
    tamanho: v.length,
    /* quantas vezes o prefixo GA1.1. aparece: 1 é o normal */
    prefixos: (v.match(/GA1\.1\./g) || []).length,
    dominio: ga.domain,
    valido: /^GA1\.\d\.\d+\.\d+$/.test(v),
  };
}

function mostrar(rot, g) {
  if (!g) { console.log(`  ${rot.padEnd(24)} (sem cookie _ga)`); return; }
  const corte = g.valor.length > 62 ? g.valor.slice(0, 59) + '...' : g.valor;
  console.log(`  ${rot.padEnd(24)} ${String(g.prefixos).padStart(2)}x GA1.1. | ${String(g.tamanho).padStart(4)} chars | ${g.valido ? 'formato VÁLIDO  ' : 'formato QUEBRADO'} | ${corte}`);
}

console.log(`origem : ${ORIGEM}`);
console.log(`checkout: ${CHECKOUT}\n`);

try {
  await pg.goto(ORIGEM, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 4000));
} catch (e) { console.log(`  [!] não consegui abrir a origem: ${String(e.message).slice(0, 70)}`); }
const inicial = await lerGa();
mostrar('depois da origem', inicial);

for (let i = 1; i <= CARGAS; i++) {
  try {
    await pg.goto(CHECKOUT, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 3500));
  } catch (e) {
    console.log(`  carga ${i}: não abriu (${String(e.message).slice(0, 60)})`);
    continue;
  }
  mostrar(`checkout, carga ${i}`, await lerGa());
}

const fim = await lerGa();
console.log('\n======== veredito');
if (!inicial || !fim) console.log('  não consegui ler o cookie nos dois momentos: inconclusivo.');
else if (fim.prefixos > 1 || !fim.valido) {
  console.log(`  CONFIRMADO: o _ga saiu de ${inicial.prefixos}x GA1.1. (${inicial.tamanho} chars) para ${fim.prefixos}x (${fim.tamanho} chars).`);
  console.log('  Com o cookie fora do formato, o GA4 não reconhece o visitante e a');
  console.log('  venda perde a sessão de origem.');
} else {
  console.log(`  NÃO reproduzi: o cookie continua íntegro (${fim.prefixos}x GA1.1., formato válido).`);
  console.log('  Ou já foi corrigido, ou o defeito depende de um caminho que eu não percorri');
  console.log('  (checkout com produto no carrinho, por exemplo).');
}
await nav.close();
