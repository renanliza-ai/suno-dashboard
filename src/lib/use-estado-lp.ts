"use client";

import { useEffect, useMemo, useState } from "react";
import type { EstadoLP } from "@/lib/lp-estado";

/**
 * Hook que pergunta ao servidor quais LPs ainda estão no ar.
 *
 * Fica em arquivo próprio porque a aba de Landing Pages e a de CRO precisam da
 * MESMA resposta: se cada uma tivesse a sua, as duas telas responderiam
 * diferente sobre a mesma LP, que é o defeito mais caro que este painel já
 * teve (a aba de LP obedecia `blocked` e a de banner não).
 *
 * Roda em rodadas porque a rota trabalha por orçamento de tempo: 210 LPs a duas
 * batidas HTTP cada não cabem nos 60s da Vercel. O cache de 12h faz a segunda
 * visita ser instantânea.
 */
export function useEstadoLP(paginas: { host: string; path: string }[]) {
  const [mapa, setMapa] = useState<Record<string, { estado: EstadoLP; apta: boolean; destino: string | null; destinoSemBarra: string | null }>>({});
  const [verificando, setVerificando] = useState(false);
  const [pendentes, setPendentes] = useState(0);
  /** Acumulador vivo durante a varredura; `pendentes` recebe o valor no fim. */
  const [, setNaoVerificadas] = useState(0);

  // Chave estável: sem isso o efeito redispara a cada render e a tela entra em
  // laço de requisição.
  const assinatura = useMemo(
    () => paginas.map((p) => `${p.host}${p.path}`).sort().join("|"),
    [paginas]
  );

  useEffect(() => {
    const lista = assinatura ? paginas : [];
    if (!lista.length) return;
    let cancelado = false;

    (async () => {
      setVerificando(true);
      setNaoVerificadas(0);
      let semResposta = 0;

      /**
       * ⚠️ FATIA, E A FATIA É PEQUENA. Mandar a lista inteira era o defeito.
       *
       * Medido em 01/10/2026: com o filtro "Só LPs no ar" ligado a tela passava
       * as 151 linhas de uma vez, e a rota devolvia 504 em 8 de 8 chamadas, ao
       * longo de 8 minutos. O `.catch` devolvia null, o laço dava `break` na
       * PRIMEIRA rodada e o mapa congelava no que tinha sido verificado antes,
       * com o filtro desligado. O filtro então decidia sobre 20 das 151 linhas:
       * escondia 6 LPs, as de maior volume, e deixava 54 aposentadas na tela.
       *
       * Em pedaços de 30 as mesmas 151 fecharam o mapa inteiro sem nenhum 504.
       */
      const TAMANHO_FATIA = 30;
      for (let i = 0; i < lista.length && !cancelado; i += TAMANHO_FATIA) {
        const fatia = lista.slice(i, i + TAMANHO_FATIA);

        /**
         * ⚠️ FALHA DE UMA FATIA NÃO ENCERRA O TRABALHO. Antes encerrava, e
         * pior: encerrava CALADO, porque `pendentes` nunca chegava e a tela
         * mostrava o indicador sumindo como se tivesse concluído.
         */
        let resposta: {
          resultados?: { host: string; path: string; estado: EstadoLP; apta: boolean; destino: string | null; destinoSemBarra: string | null }[];
          pendentes?: number;
        } | null = null;
        for (let tentativa = 0; tentativa < 2 && !resposta && !cancelado; tentativa++) {
          try {
            const r = await fetch("/api/lp/estado", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paginas: fatia }),
            });
            // ⚠️ `r.ok` ANTES do .json(): o corpo de um 504 da Vercel não é
            // JSON, então o .json() estourava e a falha virava exceção muda.
            if (!r.ok) continue;
            resposta = await r.json();
          } catch {
            resposta = null;
          }
        }

        if (cancelado) break;
        if (!resposta?.resultados) {
          // A fatia não foi verificada. Fica declarada e o laço SEGUE.
          semResposta += fatia.length;
          setNaoVerificadas(semResposta);
          continue;
        }

        const m: Record<string, { estado: EstadoLP; apta: boolean; destino: string | null; destinoSemBarra: string | null }> = {};
        for (const x of resposta.resultados) {
          m[chave(x.host, x.path)] = {
            estado: x.estado, apta: x.apta,
            destino: x.destino ?? null, destinoSemBarra: x.destinoSemBarra ?? null,
          };
        }
        // Pinta a tabela a cada fatia, em vez de deixar a tela muda por minutos.
        setMapa((atual) => ({ ...atual, ...m }));
        // O que a própria rota não conseguiu terminar dentro do orçamento dela.
        semResposta += resposta.pendentes || 0;
        setNaoVerificadas(semResposta);
      }

      if (!cancelado) {
        setPendentes(semResposta);
        setVerificando(false);
      }
    })();

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  /**
   * `completo` é o que a tela precisa saber antes de ESCONDER qualquer linha.
   * Filtro que decide com mapa pela metade é pior que filtro desligado: ele
   * esconde justamente as primeiras linhas, que são as de maior volume.
   */
  const completo = !verificando && pendentes === 0 && Object.keys(mapa).length >= paginas.length;

  return { mapa, verificando, pendentes, completo };
}

export function chave(host: string, path: string): string {
  return `${host}${path.replace(/\/+$/, "")}`.toLowerCase();
}
