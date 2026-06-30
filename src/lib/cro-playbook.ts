// src/lib/cro-playbook.ts
//
// Playbook CRO senior -> gera o corpo (HTML) da tarefa que vai pro Monday quando
// uma proposta e ACEITA no painel. Objetivo: briefing autoexplicativo pra analista
// junior operacionalizar sem abrir o painel.
//
// Regras de estilo (IMPORTANTES):
//  - NUNCA usar travessao/em-dash "—". Usar hifen "-" ou virgula.
//  - SEM link de painel (o time nao tem acesso a aba CRO). So o link da LP.
//  - HTML simples (Monday renderiza <b>,<br>,<ul>,<ol>,<li>,<i>,<u>,<a>).
//
// Cada tipo de diagnostico (rule_id) tem: onde atacar, foco, o teste (com
// ANTES -> DEPOIS pra hero/CTA, ou multiplas opcoes pra engajamento), como medir
// (metrica + meta + duracao) e passo a passo operacional.

import { Proposal } from "./cro-types";

function lpFull(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Converte markdown leve (**bold** e `code`) que vem nos textos das regras pra HTML.
function md(s: string): string {
  return (s || "")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

function li(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${md(i)}</li>`).join("")}</ul>`;
}
function ol(items: string[]): string {
  return `<ol>${items.map((i) => `<li>${md(i)}</li>`).join("")}</ol>`;
}

type Play = {
  ondeAtacar: string;
  foco: string;
  oTeste: string; // HTML
  comoMedir: string[];
  passos: string[];
  prontoQuando: string;
};

// Blocos reutilizaveis ---------------------------------------------------------

const HERO_ANTES_DEPOIS = `<u>ANTES -> DEPOIS (exemplo):</u><br>
<b>[HERO ATUAL]</b><br>
- Headline genérico, que não diz o benefício<br>
- CTA vago ("Saiba mais"), às vezes abaixo da dobra<br>
- Sem prova social visível de cara<br><br>
<b>[HERO VARIAÇÃO B - testar]</b><br>
- <b>Headline</b> = a promessa do anúncio, com número concreto (ex.: "A carteira que rendeu X% em 12 meses")<br>
- <b>Sub-headline</b> = pra quem é + prova (ex.: "Para quem quer renda passiva com FIIs, resultado auditado")<br>
- <b>CTA</b> específico, em 1ª pessoa e ACIMA DA DOBRA (ex.: "Quero a carteira" no lugar de "Saiba mais")<br>
- Incluir <b>1 selo de prova social no hero</b> (nº de assinantes ou rentabilidade)<br>`;

const MEDIR_CONV_NOTE =
  'Conversão da LP. ⚠️ Se for LP de <b>venda</b>, conversão = clique no CTA / checkout. Se for LP de <b>captura</b>, conversão = envio do formulário (generate_lead).';

const CLARITY_NOTE =
  "Apoio visual: Microsoft Clarity (mapa de calor + scroll) pra ver até onde o usuário rola e onde clica.";

const PASSO_PADRAO_FECHO = "Registre o resultado (vencedor + aprendizado) no Tracker de Testes.";

// Playbook por rule_id ---------------------------------------------------------

function buildPlay(p: Proposal): Play {
  switch (p.rule_id) {
    case "bounce-critical":
      return {
        ondeAtacar:
          "O <b>HERO</b> - a primeira dobra da LP (o que aparece sem rolar): headline, sub-headline, imagem e o CTA principal. É a primeira coisa que o visitante vê e onde ele decide ficar ou sair.",
        foco:
          'garantir <b>"message match"</b>: o hero precisa entregar exatamente a promessa que o anúncio fez. Se o anúncio promete uma coisa e o hero mostra outra, o visitante não se reconhece e sai.',
        oTeste: `Monte a <b>Variação B do hero</b>.<br>${HERO_ANTES_DEPOIS}`,
        comoMedir: [
          "<b>Métrica primária:</b> rejeição da LP -> meta: cair pelo menos 10 pontos (ex.: de 75% para 65% ou menos)",
          `<b>Secundária:</b> ${MEDIR_CONV_NOTE}`,
          "<b>Tempo do teste:</b> 7 a 14 dias, ou ~300 sessões por variação (o que vier primeiro)",
          CLARITY_NOTE,
        ],
        passos: [
          "Abra o anúncio (Meta/Google) que leva pra essa LP e anote a headline/promessa do anúncio.",
          "Abra a LP (link acima) e compare com o hero atual: onde a promessa some?",
          "Monte a Variação B no Great Pages (headline + sub + CTA conforme o exemplo).",
          "Suba como teste A/B 50/50 (ideal) ou publique e compare com o período anterior.",
          "Acompanhe rejeição + conversão por 7 a 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando:
          "Variação B no ar, dados coletados pelo período mínimo e decisão registrada (manteve A ou trocou para B).",
      };

    case "bounce-high":
      return {
        ondeAtacar:
          "A <b>primeira dobra</b> da LP, com atenção especial à posição do <b>CTA</b>. Rejeição moderada costuma ser CTA abaixo da dobra (usuário não vê) ou hero pouco atrativo.",
        foco:
          "deixar o CTA <b>visível sem rolar</b> e reforçar a headline da primeira dobra.",
        oTeste: `Monte a <b>Variação B</b> subindo o CTA e reforçando o hero.<br>${HERO_ANTES_DEPOIS}`,
        comoMedir: [
          "<b>Métrica primária:</b> rejeição da LP -> meta: cair para a faixa saudável (30% a 55%)",
          `<b>Secundária:</b> ${MEDIR_CONV_NOTE}`,
          "<b>Tempo do teste:</b> 7 a 14 dias",
          CLARITY_NOTE,
        ],
        passos: [
          "Abra a LP no celular e no desktop e veja se o CTA aparece SEM rolar.",
          "Se o CTA está abaixo da dobra, suba ele pra primeira tela.",
          "Reforce a headline da primeira dobra com o benefício principal.",
          "Suba A/B ou publique e compare com o período anterior.",
          "Acompanhe rejeição por 7 a 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Variação com CTA acima da dobra no ar e rejeição medida vs o período anterior.",
      };

    case "time-critical":
      return {
        ondeAtacar:
          "O <b>HERO</b> (primeira dobra). Sessão muito curta significa que o usuário sai antes de ler: a headline e a prova social inicial não estão convencendo nos primeiros segundos.",
        foco: "fisgar nos primeiros 5 segundos com benefício claro + prova social numérica.",
        oTeste: `Monte a <b>Variação B do hero</b> mais direta.<br>${HERO_ANTES_DEPOIS}`,
        comoMedir: [
          "<b>Métrica primária:</b> tempo médio de sessão -> meta: subir para mais de 60s",
          `<b>Secundária:</b> ${MEDIR_CONV_NOTE}`,
          "<b>Tempo do teste:</b> 7 a 14 dias",
          CLARITY_NOTE,
        ],
        passos: [
          "Abra a LP e cronometre: em 5s dá pra entender a oferta e pra quem é?",
          "Reescreva a headline com o benefício direto + um número de prova social.",
          "Garanta o CTA visível sem rolar.",
          "Suba A/B ou publique e compare.",
          "Acompanhe tempo médio + conversão por 7 a 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Variação B no ar e tempo médio medido vs o período anterior.",
      };

    case "time-short":
      return {
        ondeAtacar:
          "A <b>posição e a repetição do CTA</b> ao longo da página. O usuário lê parte do conteúdo mas sai antes de chegar no CTA: ele está longe demais.",
        foco: "encurtar o caminho até a ação e não depender de um único CTA no fim.",
        oTeste: `Escolha 1 ou 2 alavancas e teste:<br>
- <b>Opção 1:</b> mover o CTA principal pra mais cedo (logo após o hero).<br>
- <b>Opção 2:</b> repetir o CTA ao longo do scroll, após cada bloco de prova social.<br>
- <b>Opção 3:</b> adicionar um CTA fixo (sticky) no rodapé do mobile.<br>`,
        comoMedir: [
          "<b>Métrica primária:</b> cliques no CTA (e tempo médio de sessão)",
          `<b>Secundária:</b> ${MEDIR_CONV_NOTE}`,
          "<b>Tempo do teste:</b> 7 a 14 dias",
          CLARITY_NOTE + " Confirme em qual altura da página o usuário para de rolar.",
        ],
        passos: [
          "No Clarity, veja a profundidade média de scroll: onde a maioria para?",
          "Posicione um CTA ANTES desse ponto de abandono.",
          "Adicione CTAs intermediários após blocos-chave.",
          "Suba A/B ou publique e compare.",
          "Acompanhe cliques no CTA + conversão por 7 a 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "CTAs reposicionados no ar e cliques/conversão medidos vs o período anterior.",
      };

    case "engagement-low":
      return {
        ondeAtacar:
          "O <b>corpo da página</b> (depois do hero): blocos de conteúdo, provas, elementos interativos. Engajamento baixo = página estática demais, o usuário não tem motivo pra interagir.",
        foco: "dar motivo pra ficar e interagir, quebrando a parede de texto.",
        oTeste: `Escolha 1 ou 2 alavancas e teste (não precisa fazer todas de uma vez):<br>
- <b>Opção 1 - Escaneabilidade:</b> quebrar parede de texto em bullets, subtítulos e ícones; primeiro parágrafo curto com o benefício.<br>
- <b>Opção 2 - Elemento interativo:</b> vídeo curto (30 a 60s), calculadora ou FAQ em acordeão.<br>
- <b>Opção 3 - Prova social no meio:</b> depoimento, nº de assinantes ou print de resultado logo após o hero.<br>
- <b>Opção 4 - CTA intermediário:</b> não deixar o CTA só no fim; repetir a cada bloco-chave.<br>
- <b>Opção 5 - Ritmo visual:</b> uma imagem ou gráfico a cada ~2 blocos pra quebrar o texto.<br>`,
        comoMedir: [
          "<b>Métrica primária:</b> taxa de engajamento + profundidade de scroll (Clarity) -> meta: subir",
          "<b>Secundária:</b> cliques no CTA e tempo médio de sessão",
          "<b>Tempo do teste:</b> 7 a 14 dias",
          CLARITY_NOTE,
        ],
        passos: [
          "Abra a LP e leia como um visitante novo: onde dá vontade de sair?",
          "Escolha 1 ou 2 opções acima (comece pelas mais baratas: escaneabilidade + prova social).",
          "Implemente no Great Pages.",
          "Suba A/B ou publique e compare.",
          "Acompanhe engajamento + scroll por 7 a 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Alavanca(s) escolhida(s) no ar e engajamento/scroll medidos vs o período anterior.",
      };

    case "conv-vs-host-median":
    case "conv-below-median":
      return {
        ondeAtacar:
          "O <b>formulário e o CTA</b>, comparando com a LP que mais converte no mesmo site (host). A diferença de conversão geralmente está em atrito de formulário, copy do CTA ou proposta de valor.",
        foco: "copiar o que a LP campeã do host faz e reduzir atrito do formulário.",
        oTeste: `Teste replicando os elementos vencedores:<br>
- <b>Opção 1:</b> reduzir campos do formulário (testar 1 campo a menos por vez).<br>
- <b>Opção 2:</b> trocar a copy do botão do CTA por uma orientada a benefício (ex.: "Quero receber a carteira").<br>
- <b>Opção 3:</b> alinhar a proposta de valor do hero com a da LP campeã do host.<br>`,
        comoMedir: [
          `<b>Métrica primária:</b> taxa de conversão da LP -> meta: chegar perto da mediana do host. ${MEDIR_CONV_NOTE}`,
          "<b>Secundária:</b> taxa de início e de conclusão do formulário",
          "<b>Tempo do teste:</b> 7 a 14 dias (mude 1 elemento por vez pra saber o que funcionou)",
        ],
        passos: [
          "Identifique a LP que mais converte no mesmo site e abra lado a lado com esta.",
          "Liste as diferenças (campos do form, copy do CTA, ordem da prova social).",
          "Escolha UMA diferença e replique nesta LP.",
          "Suba A/B e compare.",
          "Acompanhe conversão por 7 a 14 dias e só então teste o próximo elemento.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Variação no ar, conversão medida vs a mediana do host e aprendizado registrado.",
      };

    case "tracking-broken":
      return {
        ondeAtacar:
          "O <b>tracking</b> da LP (não é design): o evento de conversão não está disparando. Antes de qualquer teste de copy, precisamos garantir que a conversão é medida.",
        foco: "confirmar e consertar o disparo do evento de conversão.",
        oTeste: `Isto é uma <b>auditoria de tracking</b>, não um teste A/B:<br>
- Verifique se o evento dispara ao enviar o formulário / clicar no CTA.<br>
- Se não dispara, é bug de GTM ou de formulário.<br>
- Se dispara com outro nome, alinhar a nomenclatura.<br>`,
        comoMedir: [
          "<b>Critério de sucesso:</b> o evento de conversão passa a disparar (visível no GA4 Tempo Real / DebugView)",
          "<b>Meta:</b> pelo menos 1% das sessões disparando o evento de conversão",
        ],
        passos: [
          "Abra a LP em janela anônima e complete o formulário / clique no CTA.",
          "Em outra aba, abra o GA4 -> Tempo Real e veja se o evento aparece.",
          "Se não aparecer, abra o GTM Preview e veja se a tag dispara.",
          "Corrija a tag/gatilho ou o nome do evento conforme o caso.",
          "Valide de novo no Tempo Real e só então considere a LP medível.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Evento de conversão disparando de forma consistente, confirmado no GA4.",
      };

    case "regression-week":
      return {
        ondeAtacar:
          "O que <b>mudou no período</b>: criativos de mídia, alteração da LP ou tracking. Não é um teste novo, é uma investigação de regressão.",
        foco: "achar a causa da queda e reverter, em vez de criar algo novo.",
        oTeste: `Investigue, em ordem:<br>
- <b>1. Tracking:</b> o evento de conversão ainda dispara? (cheque no GA4 Tempo Real). Se quebrou, é falso negativo: conserte e a conversão volta.<br>
- <b>2. LP:</b> alguém mexeu na página, no formulário ou no CTA no período?<br>
- <b>3. Mídia:</b> entraram criativos/origens novos que trazem tráfego pior?<br>`,
        comoMedir: [
          "<b>Métrica primária:</b> taxa de conversão da LP -> meta: voltar ao patamar do período anterior",
          "<b>Tempo:</b> avaliar em 7 dias após a correção",
        ],
        passos: [
          "Cheque o tracking primeiro (causa mais comum de queda súbita).",
          "Liste mudanças na LP no período (histórico do Great Pages).",
          "Cheque criativos/origens novos na mídia.",
          "Reverta a mudança que causou a queda ou ajuste o criativo.",
          "Acompanhe a conversão por 7 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Causa identificada, correção aplicada e conversão de volta ao patamar anterior.",
      };

    case "replicate-winner":
      return {
        ondeAtacar:
          "Esta LP é <b>campeã</b> do host. O trabalho é documentar por que ela ganha e levar isso pras LPs fracas.",
        foco: "transformar o que funciona aqui em padrão pras outras LPs.",
        oTeste: `Não é teste, é documentação + replicação:<br>
- Documente hero, CTA, copy do formulário e ordem de prova social desta LP.<br>
- Escolha 1 ou 2 LPs abaixo da mediana do host pra aplicar esses elementos.<br>`,
        comoMedir: [
          "<b>Métrica primária:</b> conversão das LPs-alvo (as que receberam os elementos) -> meta: subir",
          "<b>Tempo:</b> 14 dias após aplicar",
        ],
        passos: [
          "Faça um print/checklist dos elementos vencedores desta LP.",
          "Escolha 1 ou 2 LPs fracas do mesmo host.",
          "Aplique os elementos vencedores nelas.",
          "Acompanhe a conversão das LPs-alvo por 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Elementos documentados e aplicados em pelo menos 1 LP-alvo, com conversão medida.",
      };

    case "channel-mismatch":
      return {
        ondeAtacar:
          "O <b>match entre o criativo da origem dominante e o hero da LP</b>. A maior parte do tráfego vem de uma origem, mas a conversão está baixa: a mensagem do anúncio dessa origem pode não casar com a página.",
        foco: "alinhar o que o anúncio da origem dominante promete com o que a LP entrega.",
        oTeste: `Teste o alinhamento:<br>
- <b>Opção 1:</b> ajustar o hero da LP pra refletir o criativo da origem dominante.<br>
- <b>Opção 2:</b> criar uma LP dedicada pra essa origem (se o volume justificar).<br>`,
        comoMedir: [
          `<b>Métrica primária:</b> conversão do tráfego da origem dominante -> meta: subir. ${MEDIR_CONV_NOTE}`,
          "<b>Tempo:</b> 7 a 14 dias",
        ],
        passos: [
          "Abra o criativo da origem dominante e o hero da LP lado a lado.",
          "Liste onde a promessa do anúncio e o hero divergem.",
          "Ajuste o hero (ou crie LP dedicada) pra casar com o anúncio.",
          "Suba e compare a conversão dessa origem.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Hero alinhado ao criativo no ar e conversão da origem medida vs antes.",
      };

    default:
      return {
        ondeAtacar: "A LP indicada no link acima. Foque no hero e no CTA primeiro.",
        foco: "validar a hipótese com um teste A/B simples.",
        oTeste: md(p.acaoSugerida || "Montar uma variação e testar."),
        comoMedir: [
          `<b>Métrica primária:</b> conversão da LP. ${MEDIR_CONV_NOTE}`,
          "<b>Tempo do teste:</b> 7 a 14 dias",
        ],
        passos: [
          "Abra a LP no link acima.",
          md(p.acaoSugerida || "Monte a variação e suba."),
          "Acompanhe a métrica primária por 7 a 14 dias.",
          PASSO_PADRAO_FECHO,
        ],
        prontoQuando: "Variação no ar e métrica medida vs o período anterior.",
      };
  }
}

/**
 * Monta o corpo (HTML) da tarefa CRO pro Monday. Autoexplicativo, sem link de
 * painel, com o link da LP no topo. Sem travessao "—".
 */
export function buildCroBriefHtml(p: Proposal): string {
  const play = buildPlay(p);
  const url = lpFull(p.lp.url);
  const sinais = p.sinaisDetalhados && p.sinaisDetalhados.length > 0 ? li(p.sinaisDetalhados) : "";
  const bench =
    p.benchmarks && p.benchmarks.length > 0
      ? `<b>Benchmark de referência:</b>${li(p.benchmarks)}`
      : "";

  return [
    `<div><b>🆕 BRIEFING CRO - ${md(p.titulo)}</b><br><i>Tarefa autoexplicativa: tudo que você precisa está aqui. Não precisa abrir nenhum painel.</i></div><br>`,
    `<b>🔗 PÁGINA DO TESTE (abra aqui):</b><br><a href="${url}">${p.lp.url}</a><br><br>`,
    `<b>📊 O QUE OS DADOS MOSTRAM</b>${sinais}${bench}`,
    `<b>Por que isso importa:</b> ${md(p.hipotese)}<br><br>`,
    `<b>📍 ONDE ATACAR</b><br>${play.ondeAtacar}<br><br>`,
    `<b>🎯 FOCO:</b> ${play.foco}<br><br>`,
    `<b>🧪 O TESTE</b><br>${play.oTeste}<br>`,
    `<b>✅ COMO MEDIR O SUCESSO</b>${li(play.comoMedir)}`,
    `<b>🧰 PASSO A PASSO (operacional)</b>${ol(play.passos)}`,
    `<b>🚦 Pronto quando:</b> ${play.prontoQuando}`,
    `<br><br><i>- Briefing CRO gerado a partir dos dados reais da propriedade. Prioridade: ${p.priority} · Esforço: ${p.effort} · Impacto: ${md(p.impactoEstimado)}.</i>`,
  ].join("");
}
