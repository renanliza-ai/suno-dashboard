/* A venda 2260465 (01/09/2026 11:27, R$ 1.236,20) foi paga no checkout mas se
   perdeu na relatoria. Procuro no GA4 pelo transactionId para responder duas
   perguntas: o purchase chegou? Se chegou, com que origem?

   Não busco por e-mail nem por nome. O GA4 não guarda esse tipo de dado, e
   cruzar dado pessoal de cliente com relatório não é o caminho. O transactionId
   identifica a venda e não é dado pessoal.

   Uso o refresh_token de cron que o painel já tem. Nada de credencial é
   impresso na saída. */
import { config } from 'dotenv';
/* o painel usa .env.local, que o dotenv não lê por padrão */
config({ path: '.env.local' });

const TRANSACAO = '2260465';
const DIA = '2026-09-01';
const DADOS = 'https://analyticsdata.googleapis.com/v1beta';
const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';

const refresh = process.env.BRIEFING_REFRESH_TOKEN;
const id = process.env.AUTH_GOOGLE_ID;
const secret = process.env.AUTH_GOOGLE_SECRET;
if (!refresh || !id || !secret) {
  console.log('[X] faltam credenciais de cron no .env (BRIEFING_REFRESH_TOKEN / AUTH_GOOGLE_*)');
  process.exit(1);
}

const tk = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh }).toString(),
  signal: AbortSignal.timeout(60000),
}).then((r) => r.json()).catch(() => null);
if (!tk || !tk.access_token) { console.log('[X] não consegui autenticar no Google'); process.exit(1); }
const H = { Authorization: `Bearer ${tk.access_token}`, 'Content-Type': 'application/json' };
console.log('autenticado\n');

/* propriedades visíveis */
const resumo = await fetch(`${ADMIN}/accountSummaries?pageSize=200`, { headers: H, signal: AbortSignal.timeout(90000) }).then((r) => r.json()).catch(() => ({}));
const props = [];
for (const c of (resumo.accountSummaries || [])) {
  for (const p of (c.propertySummaries || [])) {
    props.push({ id: String(p.property || '').replace('properties/', ''), nome: p.displayName });
  }
}
console.log(`propriedades acessíveis: ${props.length}`);
props.forEach((p) => console.log(`  ${p.id.padEnd(12)} ${p.nome}`));

async function consultar(prop, corpo) {
  const r = await fetch(`${DADOS}/properties/${prop}:runReport`, { method: 'POST', headers: H, body: JSON.stringify(corpo), signal: AbortSignal.timeout(90000) });
  const j = await r.json();
  if (!r.ok) return { erro: (j.error && j.error.message) || `HTTP ${r.status}` };
  return { linhas: j.rows || [] };
}

console.log(`\n======== procurando a transação ${TRANSACAO} em ${DIA}`);
let achou = false;
for (const p of props) {
  const r = await consultar(p.id, {
    dateRanges: [{ startDate: DIA, endDate: DIA }],
    dimensions: [{ name: 'transactionId' }, { name: 'sessionSource' }, { name: 'sessionMedium' },
      { name: 'sessionCampaignName' }, { name: 'sessionDefaultChannelGroup' }, { name: 'firstUserSource' }],
    metrics: [{ name: 'purchaseRevenue' }, { name: 'transactions' }],
    dimensionFilter: { filter: { fieldName: 'transactionId', stringFilter: { matchType: 'CONTAINS', value: TRANSACAO } } },
    limit: 20,
  });
  if (r.erro) { console.log(`  ${p.nome}: ${r.erro.slice(0, 70)}`); continue; }
  if (!r.linhas.length) continue;
  achou = true;
  console.log(`\n  >>> ACHEI em ${p.nome} (${p.id})`);
  for (const l of r.linhas) {
    const d = l.dimensionValues.map((x) => x.value);
    const m = l.metricValues.map((x) => x.value);
    console.log(`      transação      : ${d[0]}`);
    console.log(`      sessionSource  : ${d[1]}`);
    console.log(`      sessionMedium  : ${d[2]}`);
    console.log(`      campanha       : ${d[3]}`);
    console.log(`      canal          : ${d[4]}`);
    console.log(`      1ª origem      : ${d[5]}`);
    console.log(`      receita        : ${m[0]}  |  transações: ${m[1]}`);
  }
}
if (!achou) console.log('  a transação NÃO aparece em nenhuma propriedade.');

/* contexto do dia: quantas compras chegaram e quantas sem origem */
console.log(`\n======== todas as compras de ${DIA}, por origem`);
for (const p of props) {
  const r = await consultar(p.id, {
    dateRanges: [{ startDate: DIA, endDate: DIA }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'transactions' }, { name: 'purchaseRevenue' }],
    limit: 30,
  });
  if (r.erro || !r.linhas.length) continue;
  const comVenda = r.linhas.filter((l) => Number(l.metricValues[0].value) > 0);
  if (!comVenda.length) continue;
  const total = comVenda.reduce((s, l) => s + Number(l.metricValues[0].value), 0);
  const receita = comVenda.reduce((s, l) => s + Number(l.metricValues[1].value), 0);
  console.log(`\n  ${p.nome}: ${total} transações, R$ ${receita.toFixed(2)}`);
  comVenda.sort((a, b) => Number(b.metricValues[0].value) - Number(a.metricValues[0].value));
  for (const l of comVenda) {
    const d = l.dimensionValues.map((x) => x.value);
    const m = l.metricValues.map((x) => x.value);
    const perdida = /not set|\(none\)|^\(direct\)$/i.test(d[0]) || /not set/i.test(d[1]);
    console.log(`     ${perdida ? '[!]' : '   '} ${String(m[0]).padStart(3)}x  R$ ${Number(m[1]).toFixed(2).padStart(10)}  ${d[0]} | ${d[1]} / ${d[2]}`);
  }
}
