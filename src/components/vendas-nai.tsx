"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Lock, ShoppingCart, TrendingUp, Repeat, Receipt } from "lucide-react";
import { CLASSIFICACOES, type NaiVendas, type ClassificacaoVenda } from "@/lib/nai-vendas";

/**
 * Seção "Vendas da área logada" da aba /area-logada.
 *
 * POR QUE ELA EXISTE E AINDA ASSIM PODE APARECER VAZIA
 * Receita da NAI só existe no Zeus: o `purchase` do GA4 dispara ZERO vezes em
 * `investidor.suno.com.br`, porque não há ambiente de venda lá. Enquanto o
 * painel não tiver credencial do Zeus, esta seção mostra EXATAMENTE o que falta
 * em vez de um zero. Zero com cara de "não vendeu" já escondeu uma B.U. inteira
 * nesta casa.
 *
 * Cor segue a classificação, em ordem fixa, nunca o ranking do dia. A paleta
 * foi validada (categórica, 4 slots) nos modos claro e escuro.
 */

const COR: Record<ClassificacaoVenda, string> = {
  "Aquisição · Compra": "#2a78d6",
  "Renovação · Upgrade": "#eb6834",
  "Renovação · Compra": "#1baf7a",
  "Renovação · Renovação": "#eda100",
  Outras: "#77776f",
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const int = (v: number) => v.toLocaleString("pt-BR");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Tile({ label, value, icon: Icon, cor }: { label: string; value: string; icon: typeof ShoppingCart; cor: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
        <Icon size={13} style={{ color: cor }} />
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

/** Estado em que a fonte não existe. É informativo de propósito, não um erro mudo. */
function SemFonte({ dados }: { dados: Extract<NaiVendas, { ok: false }> }) {
  const Icone = dados.motivo === "sem_credencial" ? Lock : AlertTriangle;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Icone size={15} />
        {dados.motivo === "sem_credencial"
          ? "A visão está pronta, a fonte ainda não"
          : dados.motivo === "periodo_invalido"
            ? "Período fora do que o Zeus tem"
            : "A consulta ao Zeus falhou"}
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-amber-900/90">{dados.explicacao}</p>
      <ul className="space-y-1.5 text-[12.5px] text-amber-900/80">
        {dados.oQueFalta.map((passo, i) => (
          <li key={i} className="flex gap-2">
            <span className="select-none text-amber-700">{i + 1}.</span>
            <span>{passo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras empilhadas por dia. Sem eixo duplo: ticket tem lugar próprio. */
function BarrasPorDia({ dados }: { dados: Extract<NaiVendas, { ok: true }> }) {
  const max = Math.max(...dados.porDia.map((d) => d.receita), 1);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-[13px] font-semibold text-slate-700">Receita por dia, por classificação</div>
      <div className="flex h-44 items-end gap-[3px]">
        {dados.porDia.map((d) => (
          <div key={d.dia} className="group relative flex flex-1 flex-col justify-end" style={{ height: "100%" }}>
            {CLASSIFICACOES.filter((c) => (d.porClassificacao[c]?.receita || 0) > 0).map((c) => (
              <div
                key={c}
                style={{
                  height: `${((d.porClassificacao[c]?.receita || 0) / max) * 100}%`,
                  background: COR[c],
                  marginBottom: 2,
                }}
                className="w-full rounded-[2px]"
              />
            ))}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11.5px] shadow-lg group-hover:block">
              <div className="mb-1 font-semibold text-slate-900">{d.dia.slice(8)}/{d.dia.slice(5, 7)}</div>
              {CLASSIFICACOES.filter((c) => (d.porClassificacao[c]?.vendas || 0) > 0).map((c) => (
                <div key={c} className="flex justify-between gap-4 text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: COR[c] }} />
                    {c}
                  </span>
                  <b className="tabular-nums text-slate-900">
                    {brl(d.porClassificacao[c]!.receita)} · {d.porClassificacao[c]!.vendas}
                  </b>
                </div>
              ))}
              <div className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 text-slate-600">
                <span>ticket do dia</span>
                <b className="tabular-nums text-slate-900">{d.ticket == null ? "—" : brl(d.ticket)}</b>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-slate-400">
        <span>{dados.porDia[0]?.dia.slice(8)}/{dados.porDia[0]?.dia.slice(5, 7)}</span>
        <span>
          {dados.porDia[dados.porDia.length - 1]?.dia.slice(8)}/
          {dados.porDia[dados.porDia.length - 1]?.dia.slice(5, 7)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
        {CLASSIFICACOES.map((c) => {
          const v = dados.porDia.reduce((a, d) => a + (d.porClassificacao[c]?.vendas || 0), 0);
          const r = dados.porDia.reduce((a, d) => a + (d.porClassificacao[c]?.receita || 0), 0);
          if (!v) return null;
          return (
            <span key={c} className="flex items-center gap-1.5 text-slate-600">
              <i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: COR[c] }} />
              {c}
              <b className="tabular-nums text-slate-900">{brl(r)}</b>
              <em className="not-italic text-slate-400">{int(v)} vendas</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function VendasNai({ inicio, fim }: { inicio?: string; fim?: string }) {
  const [dados, setDados] = useState<NaiVendas | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    const qs = new URLSearchParams();
    if (inicio) qs.set("inicio", inicio);
    if (fim) qs.set("fim", fim);
    fetch(`/api/area-logada/vendas?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => vivo && setDados(j as NaiVendas))
      .catch((e) =>
        vivo &&
        setDados({
          ok: false,
          motivo: "erro_zeus",
          explicacao: `A rota não respondeu: ${(e as Error).message}`,
          oQueFalta: ["Recarregar a página. Se persistir, olhar o log da função no Vercel."],
          contrato: { fonte: "—", unidade: "—", ressalvas: [], naoServePara: [] },
        })
      )
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [inicio, fim]);

  if (carregando) {
    return <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />;
  }
  if (!dados) return null;

  return (
    <div className="space-y-4">
      {!dados.ok ? (
        <SemFonte dados={dados} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Receita bruta" value={brl(dados.totais.receita)} icon={TrendingUp} cor="#1baf7a" />
            <Tile label="Vendas" value={int(dados.totais.vendas)} icon={ShoppingCart} cor="#2a78d6" />
            <Tile label="Ticket médio" value={brl(dados.totais.ticket)} icon={Receipt} cor="#7c5cff" />
            <Tile label="Receita de renovação" value={pct(dados.totais.receitaRenovacaoPct)} icon={Repeat} cor="#eb6834" />
          </div>

          <BarrasPorDia dados={dados} />

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-slate-700">
              Produto vendido, receita bruta e ticket médio
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="px-4 py-2 text-left font-semibold">Produto</th>
                  <th className="px-4 py-2 text-right font-semibold">Vendas</th>
                  <th className="px-4 py-2 text-right font-semibold">Receita bruta</th>
                  <th className="px-4 py-2 text-right font-semibold">Ticket médio</th>
                  <th className="px-4 py-2 text-right font-semibold">% da receita</th>
                </tr>
              </thead>
              <tbody>
                {dados.porProduto.map((p) => (
                  <tr key={p.produto} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-left font-medium text-slate-800">{p.produto}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{int(p.vendas)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(p.receita)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(p.ticket)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{pct(p.participacaoReceita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500">
              Não some a coluna de vendas: um pedido com itens de dois produtos conta uma vez em cada linha. O total
              correto é {int(dados.totais.vendas)}.
            </p>
          </div>
        </>
      )}

      {dados.contrato.ressalvas.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
          <summary className="cursor-pointer text-[12.5px] font-medium text-slate-600">
            Como ler estes números ({dados.contrato.ressalvas.length} ressalvas) · fonte: {dados.contrato.fonte}
          </summary>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-slate-600">
            {dados.contrato.ressalvas.map((r, i) => (
              <li key={i} className={r.startsWith("⚠️") ? "font-medium text-amber-800" : ""}>
                {r}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
