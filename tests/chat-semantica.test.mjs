/**
 * tests/chat-semantica.test.mjs
 *
 * Testa o contrato semântico do chat contra o módulo COMPILADO, não contra uma
 * cópia das regras. Cada caso aqui existe porque o chat já publicou, ou podia
 * publicar, um número errado com cara de certo.
 *
 * Roda com: node --test tests/chat-semantica.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Importa o módulo COMPILADO (mesma convenção de tests/contrato-ga4.test.mjs).
// O import de tipo em chat-semantica.ts é apagado no emit, então o .js sai
// sem dependência e roda no node puro.
const bu = await import("./.build/bu.js");
const sem = await import("./.build/chat-semantica.js");

// =====================================================================
// 1. O DEFEITO QUE ESTAVA NO AR: colisão de substring na resolução de B.U.
// =====================================================================

test("Suno Advisory resolve para consultoria, NAO para research", () => {
  // O mapa antigo do chat fazia propertyName.includes("suno"), e
  // "Suno Advisory" contém "suno". A Consultoria recebia hosts da Research.
  const p = bu.resolveBU("Suno Advisory");
  assert.equal(p.key, "consultoria");
  assert.deepEqual(p.lpHosts, ["lp.sunoconsultoria.com.br"]);
});

test("os hosts da Research incluem lps. e NAO incluem lp2.statusinvest", () => {
  const p = bu.resolveBU("Suno Research – Web");
  assert.ok(p.lpHosts.includes("lps.suno.com.br"), "lps.suno.com.br ficou de fora do mapa antigo");
  assert.ok(!p.lpHosts.includes("lp2.statusinvest.com.br"));
});

test("Status usa lps.statusinvest.com.br, nao lp2.", () => {
  const p = bu.resolveBU("Statusinvest - Web");
  assert.ok(p.lpHosts.includes("lps.statusinvest.com.br"));
  assert.ok(!p.lpHosts.includes("lp2.statusinvest.com.br"), "lp2.statusinvest.com.br nao existe");
});

test("FIIs tem host de LP, nao cai em lista vazia", () => {
  const p = bu.resolveBU("Fiis - Web");
  assert.deepEqual(p.lpHosts, ["lp.fiis.com.br"]);
});

// =====================================================================
// 2. REGRA DE CONVERSÃO POR B.U. — o chat fixava generate_lead + cta_click
// =====================================================================

test("Consultoria declara divisor 2 e ausencia de CTA", () => {
  const p = bu.resolveBU("Suno Advisory");
  const txt = sem.regraDeConversao(p);
  assert.match(txt, /LeadQualificadoConsultoria/);
  assert.match(txt, /LeadDesqualificadoConsultoria/);
  assert.match(txt, /duplicado|divisor 2/i);
});

test("Research declara cta_click; Consultoria nao", () => {
  assert.match(sem.regraDeConversao(bu.resolveBU("Suno Research – Web")), /cta_click/);
  assert.doesNotMatch(sem.regraDeConversao(bu.resolveBU("Suno Advisory")), /cta_click/);
});

test("Funds declara que NAO TEM medicao", () => {
  const txt = sem.regraDeConversao(bu.resolveBU("FundsExplorer - Web"));
  assert.match(txt, /NÃO TEM medição|NAO TEM medicao/i);
});

// =====================================================================
// 3. O CONTRATO VIAJA JUNTO DO NÚMERO
// =====================================================================

test("envelope devolve dado e contrato separados", () => {
  const e = sem.envelope({ x: 1 }, sem.contratoDeEventos("30 dias", null));
  assert.deepEqual(e.dado, { x: 1 });
  assert.equal(e.contrato.unidade, "evento");
});

test("contrato de LP da FIIs carrega a suspensao de conversao", () => {
  const p = bu.resolveBU("Fiis - Web");
  const c = sem.contratoDeLandingPages(p, "30 dias", null, null);
  const temAlerta = c.ressalvas.some((r) => /SUSPENSA/i.test(r));
  assert.ok(temAlerta, "a suspensao da FIIs precisa aparecer nas ressalvas");
  assert.ok(c.naoServePara.some((r) => /conversão|conversao/i.test(r)));
});

test("contrato de LP sem bloqueio NAO proibe citar conversao", () => {
  const p = bu.resolveBU("Suno Research – Web");
  const c = sem.contratoDeLandingPages(p, "30 dias", null, null);
  assert.ok(!c.naoServePara.some((r) => /citar qualquer número de conversão/i.test(r)));
});

test("quebra por dimensao sempre traz a ressalva de cardinalidade", () => {
  const comQuebra = sem.contratoDeEventos("30 dias", "pagePath");
  const semQuebra = sem.contratoDeEventos("30 dias", null);
  assert.ok(comQuebra.ressalvas.includes(sem.RESSALVA_CARDINALIDADE));
  assert.ok(!semQuebra.ressalvas.includes(sem.RESSALVA_CARDINALIDADE));
});

test("evento nunca pode ser apresentado como pessoa", () => {
  const c = sem.contratoDeEventos("30 dias", null);
  assert.equal(c.unidade, "evento");
  assert.ok(c.naoServePara.some((r) => /PESSOAS/i.test(r)));
});

// =====================================================================
// 4. RESSALVA DE JANELA — só aparece quando a janela realmente cruza o evento
// =====================================================================

test("janela que cruza a enxurrada de bot da Research acusa", () => {
  const p = bu.resolveBU("Suno Research – Web");
  const r = sem.ressalvasDaJanela(p, "2026-09-01", "2026-09-30");
  assert.equal(r.length, 1);
  assert.match(r[0], /bot/i);
});

test("janela POSTERIOR a enxurrada nao acusa", () => {
  const p = bu.resolveBU("Suno Research – Web");
  assert.deepEqual(sem.ressalvasDaJanela(p, "2026-10-01", "2026-10-31"), []);
});

test("janela que toca so o ultimo dia da enxurrada ainda acusa", () => {
  const p = bu.resolveBU("Suno Research – Web");
  // 29/09 é o último dia afetado: a borda tem que pegar.
  assert.equal(sem.ressalvasDaJanela(p, "2026-09-29", "2026-10-15").length, 1);
});

test("a enxurrada e da Research, entao o Status nao acusa", () => {
  const p = bu.resolveBU("Statusinvest - Web");
  assert.deepEqual(sem.ressalvasDaJanela(p, "2026-09-01", "2026-09-30"), []);
});

test("sem janela declarada nao inventa ressalva", () => {
  const p = bu.resolveBU("Suno Research – Web");
  assert.deepEqual(sem.ressalvasDaJanela(p, null, null), []);
});

// =====================================================================
// 5. REGRAS DO PROMPT — se sumirem daqui, somem do comportamento
// =====================================================================

test("as regras do contrato cobrem unidade, escopo, soma e base da taxa", () => {
  const r = sem.regrasDoContrato();
  assert.match(r, /unidade/i);
  assert.match(r, /escopo/i);
  assert.match(r, /NUNCA some linhas/i);
  assert.match(r, /base/i);
  assert.match(r, /naoServePara/);
});

test("receita do GA4 e declarada inutilizavel", () => {
  assert.match(sem.RESSALVA_RECEITA_GA4, /313,63|1\.185/);
  assert.match(sem.RESSALVA_RECEITA_GA4, /Zeus/);
});

test("contrato do Clarity proibe comparar volume com o GA4", () => {
  const c = sem.contratoDeClarity("1 dia");
  assert.ok(c.naoServePara.some((r) => /GA4/.test(r)));
  assert.ok(c.ressalvas.some((r) => /1 DIA|1 dia/.test(r)));
});
