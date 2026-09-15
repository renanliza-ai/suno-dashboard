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
      for (let rodada = 0; rodada < 8 && !cancelado; rodada++) {
        const r = await fetch("/api/lp/estado", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paginas: lista.slice(0, 600) }),
        })
          .then((x) => x.json())
          .catch(() => null);
        if (cancelado || !r?.resultados) break;
        const m: Record<string, { estado: EstadoLP; apta: boolean; destino: string | null; destinoSemBarra: string | null }> = {};
        for (const x of r.resultados as {
          host: string; path: string; estado: EstadoLP; apta: boolean;
          destino: string | null; destinoSemBarra: string | null;
        }[]) {
          m[chave(x.host, x.path)] = {
            estado: x.estado, apta: x.apta,
            destino: x.destino ?? null, destinoSemBarra: x.destinoSemBarra ?? null,
          };
        }
        setMapa((atual) => ({ ...atual, ...m }));
        setPendentes(r.pendentes || 0);
        if (!r.pendentes) break;
      }
      if (!cancelado) setVerificando(false);
    })();

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  return { mapa, verificando, pendentes };
}

export function chave(host: string, path: string): string {
  return `${host}${path.replace(/\/+$/, "")}`.toLowerCase();
}
