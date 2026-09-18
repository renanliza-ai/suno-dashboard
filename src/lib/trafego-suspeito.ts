/**
 * src/lib/trafego-suspeito.ts — marca peça com sinal de tráfego inválido.
 *
 * ⚠️ ESTA REGRA NÃO ALTERA NENHUM NÚMERO. Ela só sinaliza.
 *
 * Decisão deliberada: descontar tráfego suspeito do KPI seria o painel decidir
 * sozinho o que é real, e errar isso em silêncio é pior que mostrar o número
 * sujo com aviso. A tela mostra o total como veio do GA4, diz quanto dele é
 * suspeito, e deixa a decisão com quem lê.
 *
 * @forma-observada: calibrada em 18/09/2026 contra Suno Research – Web, aba de
 * banners, três janelas de 18 dias:
 *
 *   1-18/jul    6.028 cliques no total, banner.home com 918
 *   1-18/ago    9.121 cliques no total, banner.home com 1.359
 *   1-18/set  969.794 cliques no total, banner.home com 783.691
 *
 * Em setembro duas peças da mesma campanha somaram 777.164 cliques, 80% do
 * conjunto, com 8,3% e 5,2% de engajamento e ZERO compra. As peças legítimas da
 * mesma janela engajaram entre 21,3% e 94,9%, e as que converteram estavam
 * entre 54,6% e 73,3%. É essa distância que os limiares abaixo separam.
 */

export type PecaAvaliavel = {
  space: string;
  bannerName: string;
  sessions: number;
  engagementRate: number | null;
  leads: number;
  accounts: number | null;
  checkoutStarts: number | null;
  purchases: number | null;
};

export type Suspeita = {
  chave: string;
  motivo: string;
  sessoes: number;
};

/**
 * Engajamento abaixo do qual a peça destoa. Na medição de 18/09/2026 as
 * suspeitas ficaram entre 5,1% e 8,3% e a peça legítima mais fraca em 21,3%:
 * 15% passa no meio dessa folga, sem encostar em nenhum dos dois lados.
 */
const LIMIAR_ENGAJAMENTO = 15;

/**
 * Peso mínimo para a peça ser avaliada: precisa das DUAS condições.
 *
 * ⚠️ A primeira versão aceitava share OU volume, e a validação contra dado real
 * reprovou: em 1-18/ago, onde o conjunto inteiro tem 9.121 cliques, ela marcou
 * `_SNCE74BC112_ao---suno-one---banner-lead-magnet` com 821 cliques só porque
 * eram 9% do total. Essa MESMA peça em setembro tem 50.751 cliques, 73,3% de
 * engajamento e 17 conversões: é peça boa, num mês fraco.
 *
 * O aviso teria acusado 30,5% de tráfego inválido numa janela limpa. Alarme que
 * dispara sem incêndio ensina a ignorar alarme, então o piso absoluto passou a
 * ser obrigatório: sem 5.000 cliques a peça não é grande o bastante para o
 * problema que este aviso existe para pegar.
 */
const SHARE_MINIMO = 5;
const VOLUME_MINIMO = 5_000;

const conversoes = (p: PecaAvaliavel) =>
  (p.purchases || 0) + (p.checkoutStarts || 0) + (p.leads || 0) + (p.accounts || 0);

export function avaliarTrafego(pecas: PecaAvaliavel[]): {
  suspeitas: Map<string, Suspeita>;
  sessoesSuspeitas: number;
  sessoesTotais: number;
  pctSuspeito: number;
  sessoesLimpas: number;
} {
  const sessoesTotais = pecas.reduce((s, p) => s + p.sessions, 0);
  const suspeitas = new Map<string, Suspeita>();

  for (const p of pecas) {
    if (p.engagementRate === null) continue;
    const share = sessoesTotais > 0 ? (p.sessions / sessoesTotais) * 100 : 0;
    // As DUAS, não uma ou outra. Ver o comentário de VOLUME_MINIMO.
    if (p.sessions < VOLUME_MINIMO || share < SHARE_MINIMO) continue;
    if (p.engagementRate >= LIMIAR_ENGAJAMENTO) continue;

    // Terceira condição, e a mais importante: se a peça converteu, ela trouxe
    // gente de verdade, por pior que seja o engajamento. Sem isto a regra
    // marcaria banner de topo de funil que funciona.
    const conv = conversoes(p);
    const taxaConv = p.sessions > 0 ? (conv / p.sessions) * 100 : 0;
    if (taxaConv >= 0.01) continue;

    const chave = `${p.space}||${p.bannerName}`;
    suspeitas.set(chave, {
      chave,
      sessoes: p.sessions,
      motivo:
        `${p.sessions.toLocaleString("pt-BR")} cliques com ${String(p.engagementRate).replace(".", ",")}% de ` +
        `engajamento e nenhuma conversão. Peça com esse volume e esse comportamento não é audiência, é tráfego inválido.`,
    });
  }

  const sessoesSuspeitas = Array.from(suspeitas.values()).reduce((s, x) => s + x.sessoes, 0);
  return {
    suspeitas,
    sessoesSuspeitas,
    sessoesTotais,
    pctSuspeito: sessoesTotais > 0 ? Number(((sessoesSuspeitas / sessoesTotais) * 100).toFixed(1)) : 0,
    sessoesLimpas: sessoesTotais - sessoesSuspeitas,
  };
}

export const chaveDaPeca = (space: string, bannerName: string) => `${space}||${bannerName}`;
