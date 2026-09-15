#!/usr/bin/env node
/**
 * GUARDA 3 · o que está no ar é o que eu acabei de escrever?
 *
 * Uso:
 *   npm run guarda:deploy           espera até 5 min o deploy alcançar o HEAD
 *   npm run guarda:deploy -- --agora   não espera, só responde sim ou não
 *
 * POR QUE EXISTE
 * Em 15/09/2026, na mesma sessão, três baterias de validação rodaram contra um
 * deploy que ainda não tinha subido. Numa delas a quebra por país voltou com
 * China e Brasil IDÊNTICOS, e só deu para perceber porque a coincidência era
 * absurda. Se os números tivessem vindo apenas parecidos, a conclusão errada
 * teria sido publicada.
 *
 * Havia memória avisando exatamente isso, e ela foi ignorada três vezes.
 * Lembrete não resolve. Este script sai com código 1 e trava a rotina.
 *
 * Não usa credencial: lê /api/build-info, que a própria aplicação expõe com o
 * SHA que a Vercel injetou no build.
 *
 * @forma-observada: o contrato de /api/build-info é definido em
 *   src/app/api/build-info/route.ts, escrito no MESMO commit que este script.
 *   Campos lidos aqui: `sha`, `integracoesVistas`, `ambiente`. Se a rota mudar,
 *   este script precisa mudar junto: não há como o contrato divergir sem que os
 *   dois arquivos apareçam no mesmo diff.
 */

import { execSync } from "node:child_process";

const URL_PADRAO = process.env.PAINEL_URL || "https://suno-dashboard-painel.vercel.app";
const ESPERA_MAX_MS = 5 * 60 * 1000;
const INTERVALO_MS = 15 * 1000;

const semEspera = process.argv.includes("--agora");

function shaLocal() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function pendenciasLocais() {
  try {
    const s = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    return s ? s.split("\n").length : 0;
  } catch {
    return 0;
  }
}

async function shaNoAr() {
  try {
    const r = await fetch(`${URL_PADRAO}/api/build-info?cb=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    const j = await r.json();
    return { sha: j.sha, integracoes: j.integracoesVistas || [], ambiente: j.ambiente };
  } catch (e) {
    return { erro: e.message };
  }
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const local = shaLocal();
  if (!local) {
    console.error("✗ Não consegui ler o HEAD local. Estou num repositório git?");
    process.exitCode = 1; return;
  }

  const sujo = pendenciasLocais();
  if (sujo > 0) {
    console.log(`⚠ ${sujo} arquivo(s) alterado(s) sem commit. O que está no ar NUNCA vai incluí-los.`);
  }

  const inicio = Date.now();
  let tentativa = 0;

  while (true) {
    tentativa++;
    const r = await shaNoAr();

    if (r.erro) {
      console.error(`✗ Não consegui ler ${URL_PADRAO}/api/build-info: ${r.erro}`);
      console.error("  Se a rota ainda não existe no deploy ativo, publique-a antes de usar esta guarda.");
      process.exitCode = 1; return;
    }

    if (r.sha === local) {
      console.log(`✓ No ar: ${local.slice(0, 7)} (${r.ambiente}). Bate com o HEAD local.`);
      if (r.integracoes.length) {
        console.log(`  Integrações vistas no runtime: ${r.integracoes.join(", ")}`);
      } else {
        console.log("  Nenhuma variável de integração no runtime.");
      }
      process.exitCode = 0; return;
    }

    const msg =
      `✗ O ar está em ${String(r.sha).slice(0, 7)} e o HEAD local é ${local.slice(0, 7)}. ` +
      `NÃO valide contra produção agora: o resultado seria do código antigo.`;

    if (semEspera || Date.now() - inicio > ESPERA_MAX_MS) {
      console.error(msg);
      if (!semEspera) console.error(`  Esperei ${Math.round((Date.now() - inicio) / 1000)}s e o deploy não alcançou.`);
      process.exitCode = 1; return;
    }

    if (tentativa === 1) console.log(`… esperando o deploy alcançar ${local.slice(0, 7)}`);
    await dorme(INTERVALO_MS);
  }
})();
