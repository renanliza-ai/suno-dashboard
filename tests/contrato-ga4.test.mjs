// Exercita o MODULO REAL (compilado de src/lib/contrato-ga4.ts), nao uma copia.
// A pergunta que importa em cada caso: o motor DISPARA quando deve, e fica
// CALADO quando nao deve? Testar so o caminho feliz ja me enganou antes.
import {
  compararComBaseline,
  mesFechado,
  verificarTruncamento,
  verificarCobertura,
  verificarTaxaImpossivel,
  verificarIntegridade,
  verificarBloqueio,
  montarContrato,
} from "./.build/contrato-ga4.js";

let ok = 0;
let falhou = 0;
const t = (nome, condicao, detalhe = "") => {
  if (condicao) { ok++; console.log(`  OK     ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome} ${detalhe}`); }
};

console.log("\n1. mesFechado: tem que apontar o mes anterior, em UTC");
const m = mesFechado(new Date("2026-10-01T09:00:00Z"));
t("01/10/2026 -> setembro", m.startDate === "2026-09-01" && m.endDate === "2026-09-30", JSON.stringify(m));
t("rotulo 09/2026", m.rotulo === "09/2026", m.rotulo);
const m2 = mesFechado(new Date("2026-01-15T00:00:00Z"));
t("vira o ano certo", m2.startDate === "2025-12-01" && m2.endDate === "2025-12-31", JSON.stringify(m2));

console.log("\n2. Regressao: o caso real que aconteceu (141 linhas -> 22)");
const base = { linhas: 141, sessoes: 453888, conversao: 4165, gravadoEm: "2026-10-01T12:00:00Z", periodo: "09/2026" };
const quebrou = compararComBaseline({ aba: "landing-pages", atual: { linhas: 22, sessoes: 300000, conversao: 2742 }, baseline: base });
t("dispara na queda de linhas", quebrou.some((a) => a.id === "regressao:landing-pages:linhas"));
t("dispara na queda de conversao", quebrou.some((a) => a.id === "regressao:landing-pages:conversao"));
t("tudo marcado como quebra", quebrou.every((a) => a.severidade === "quebra"));
t("a evidencia traz os DOIS numeros", quebrou[0].evidencia.includes("141") && quebrou[0].evidencia.includes("22"));
t("diz que CAIU, nao so que mudou", quebrou[0].titulo.includes("CAIU"));

console.log("\n3. Regressao: tem que ficar CALADO no ruido normal do GA4");
const calado = compararComBaseline({ aba: "landing-pages", atual: { linhas: 141, sessoes: 457000, conversao: 4190 }, baseline: base });
t("1% de variacao nao dispara", calado.length === 0, `disparou ${calado.length}`);
const naBorda = compararComBaseline({ aba: "x", atual: { linhas: 141, sessoes: 453888, conversao: 4248 }, baseline: base });
t("1,99% (logo abaixo da borda) nao dispara", naBorda.length === 0, `disparou ${naBorda.length}`);
const passouBorda = compararComBaseline({ aba: "x", atual: { linhas: 141, sessoes: 453888, conversao: 4300 }, baseline: base });
t("3,2% dispara", passouBorda.length === 1);

console.log("\n4. Regressao: ALTA tambem e quebra (contagem em dobro passa por melhora)");
const subiu = compararComBaseline({ aba: "x", atual: { linhas: 141, sessoes: 453888, conversao: 8330 }, baseline: base });
t("dobro dispara", subiu.length === 1);
t("diz SUBIU", subiu[0].titulo.includes("SUBIU"));
t("orienta para contagem em dobro", subiu[0].comoCorrigir.includes("dobro"));

console.log("\n5. Truncamento");
t("linhas == limite e quebra", verificarTruncamento([{ nome: "q", linhas: 2000, limite: 2000 }])[0].severidade === "quebra");
t("95% do limite e alerta", verificarTruncamento([{ nome: "q", linhas: 1900, limite: 2000 }])[0].severidade === "alerta");
t("metade do limite fica calado", verificarTruncamento([{ nome: "q", linhas: 1000, limite: 2000 }]).length === 0);
t("limite zero nao quebra a funcao", verificarTruncamento([{ nome: "q", linhas: 0, limite: 0 }]).length === 0);

console.log("\n6. Cobertura acima de 100%");
t("105% dispara", verificarCobertura({ somaDaColuna: 105, totalNaProperty: 100, evento: "generate_lead" }).length === 1);
t("100,5% tolerado (arredondamento)", verificarCobertura({ somaDaColuna: 1005, totalNaProperty: 1000, evento: "x" }).length === 0);
t("89% fica calado", verificarCobertura({ somaDaColuna: 89, totalNaProperty: 100, evento: "x" }).length === 0);
t("total nulo nao quebra", verificarCobertura({ somaDaColuna: 50, totalNaProperty: null, evento: "x" }).length === 0);

console.log("\n7. Taxa impossivel");
t("taxa exibida sem ressalva dispara", verificarTaxaImpossivel([{ conversao: 10, sessoes: 5, taxa: 200, ressalva: null }]).length === 1);
t("com ressalva fica calado", verificarTaxaImpossivel([{ conversao: 10, sessoes: 5, taxa: null, ressalva: "motivo" }]).length === 0);
t("taxa normal fica calado", verificarTaxaImpossivel([{ conversao: 2, sessoes: 100, taxa: 2, ressalva: null }]).length === 0);

console.log("\n8. Integridade e bloqueio");
t("10% de diferenca e quebra", verificarIntegridade({ nome: "p", totalSemQuebra: 1000, somaDasPartes: 900, tolerancia: 0.005 })[0].severidade === "quebra");
t("1% e alerta", verificarIntegridade({ nome: "p", totalSemQuebra: 1000, somaDasPartes: 990, tolerancia: 0.005 })[0].severidade === "alerta");
t("0,4% fica calado", verificarIntegridade({ nome: "p", totalSemQuebra: 1000, somaDasPartes: 996, tolerancia: 0.005 }).length === 0);
t("B.U. bloqueada com linha dispara", verificarBloqueio({ bloqueada: true, linhas: 17 }).length === 1);
t("B.U. bloqueada com zero linha fica calado", verificarBloqueio({ bloqueada: true, linhas: 0 }).length === 0);

console.log("\n9. montarContrato: a unidade entra sozinha");
const c1 = montarContrato({ aba: "banners", bu: "x", unidadeDeLead: "eventos", assinatura: { linhas: 1, sessoes: 1, conversao: 1 }, achados: [] });
t("unidade em evento vira alerta", c1.achados.some((a) => a.id === "unidade-em-evento"));
t("alerta sozinho NAO reprova", c1.aprovado === true);
const c2 = montarContrato({ aba: "x", bu: "x", unidadeDeLead: "pessoas", assinatura: { linhas: 1, sessoes: 1, conversao: 1 }, achados: verificarBloqueio({ bloqueada: true, linhas: 5 }) });
t("quebra reprova", c2.aprovado === false);
t("pessoas nao levanta alerta de unidade", !c2.achados.some((a) => a.id === "unidade-em-evento"));

console.log(`\n${falhou === 0 ? "TUDO PASSOU" : "HOUVE FALHA"}: ${ok} ok, ${falhou} falhou`);
process.exit(falhou === 0 ? 0 : 1);
