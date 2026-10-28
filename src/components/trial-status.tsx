"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock, PlayCircle, Timer } from "lucide-react";
import type { TrialResposta } from "@/app/api/area-logada/trial/route";

/**
 * Trial de 7 dias do Status Invest.
 *
 * A funcionalidade subiu em 27/10/2026. No primeiro dia houve 1 ativação, então
 * esta tela nasce com base minúscula de propósito: é melhor existir desde o dia
 * 1 e crescer junto do que aparecer depois, quando ninguém mais lembra como era
 * o começo.
 *
 * Pizza com DUAS fatias é quase sempre pior que duas barras, mas aqui a pergunta
 * é de COMPOSIÇÃO de um todo fechado (todo trial ou está correndo ou já venceu),
 * que é exatamente o caso em que a pizza funciona. Com rótulo direto e número
 * absoluto ao lado, nunca só o percentual.
 */

const COR = { andamento: "#2a78d6", vencido: "#77776f" };

const int = (v: number) => v.toLocaleString("pt-BR");

/** Fatia de pizza em SVG. Sem dependência nova para duas fatias. */
function fatia(cx: number, cy: number, r: number, de: number, ate: number) {
  const p = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [x1, y1] = p(de);
  const [x2, y2] = p(ate);
  const grande = ate - de > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function Pizza({ andamento, vencido }: { andamento: number; vencido: number }) {
  const total = andamento + vencido;
  if (total === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center text-[12.5px] text-slate-400">
        Nenhuma ativação na janela
      </div>
    );
  }
  const partes = [
    { rotulo: "Em andamento", v: andamento, cor: COR.andamento },
    { rotulo: "Vencido", v: vencido, cor: COR.vencido },
  ].filter((p) => p.v > 0);

  let ang = -Math.PI / 2;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 150 150" className="h-[150px] w-[150px] shrink-0">
        {partes.map((p) => {
          const de = ang;
          const ate = ang + (p.v / total) * Math.PI * 2;
          ang = ate;
          // Fatia única vira círculo: o arco de 360° não fecha em SVG.
          if (partes.length === 1) {
            return <circle key={p.rotulo} cx="75" cy="75" r="62" fill={p.cor} />;
          }
          return <path key={p.rotulo} d={fatia(75, 75, 62, de, ate)} fill={p.cor} stroke="#fff" strokeWidth="2" />;
        })}
        <circle cx="75" cy="75" r="34" fill="#fff" />
        <text x="75" y="71" textAnchor="middle" className="fill-slate-900 text-[19px] font-semibold tabular-nums">
          {int(total)}
        </text>
        <text x="75" y="87" textAnchor="middle" className="fill-slate-400 text-[9px]">
          {total === 1 ? "ativação" : "ativações"}
        </text>
      </svg>
      <div className="space-y-2.5">
        {partes.map((p) => (
          <div key={p.rotulo} className="flex items-baseline gap-2 text-[13px]">
            <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: p.cor }} />
            <span className="text-slate-600">{p.rotulo}</span>
            <b className="tabular-nums text-slate-900">{int(p.v)}</b>
            <span className="text-[11.5px] text-slate-400">
              {total ? `${Math.round((p.v / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrialStatus({
  propertyId,
  propertyName,
  inicio,
  fim,
}: {
  propertyId: string | null;
  propertyName: string;
  inicio: string;
  fim: string;
}) {
  const [dados, setDados] = useState<TrialResposta | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!propertyId) return;
    let vivo = true;
    setCarregando(true);
    const qs = new URLSearchParams({ propertyId, propertyName, inicio, fim });
    fetch(`/api/area-logada/trial?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => vivo && setDados(j as TrialResposta))
      .catch((e) =>
        vivo &&
        setDados({ ok: false, motivo: "erro_ga4", explicacao: (e as Error).message, avisos: [] })
      )
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [propertyId, propertyName, inicio, fim]);

  if (carregando) return <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />;
  if (!dados) return null;

  // Property sem a feature: não renderiza seção nenhuma, para não poluir a aba
  // das outras B.U.s com um bloco vazio.
  if (!dados.ok && dados.motivo === "property_sem_trial") return null;

  if (!dados.ok) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-[13px] text-amber-900">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <AlertTriangle size={14} /> Não consegui ler o trial
        </div>
        {dados.explicacao}
      </div>
    );
  }

  const maxDia = Math.max(...dados.ativacoesPorDia.map((d) => d.pessoas), 1);
  const [andamento, vencido] = [dados.status[0]?.pessoas || 0, dados.status[1]?.pessoas || 0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <Timer size={14} className="text-blue-600" />
            Situação dos trials de {dados.diasDeTrial} dias
          </div>
          <Pizza andamento={andamento} vencido={vencido} />
          <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500">
            Quem ativou depois de <b className="tabular-nums">{dados.status[0]?.desde}</b> ainda está nos{" "}
            {dados.diasDeTrial} dias. Antes disso, já completou.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <PlayCircle size={14} className="text-blue-600" />
            Ativações por dia
          </div>
          <div className="flex h-32 items-end gap-[3px]">
            {dados.ativacoesPorDia.map((d) => (
              <div key={d.dia} className="group relative flex flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-[2px]"
                  style={{
                    height: `${Math.max((d.pessoas / maxDia) * 100, d.pessoas ? 6 : 1)}%`,
                    background: d.pessoas ? COR.andamento : "#e6e6e2",
                  }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11.5px] shadow-lg group-hover:block">
                  <b className="text-slate-900">
                    {d.dia.slice(8)}/{d.dia.slice(5, 7)}
                  </b>
                  <span className="ml-2 text-slate-600">{int(d.pessoas)} ativação(ões)</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-slate-400">
            <span>
              {dados.ativacoesPorDia[0]?.dia.slice(8)}/{dados.ativacoesPorDia[0]?.dia.slice(5, 7)}
            </span>
            <span>
              {dados.ativacoesPorDia.at(-1)?.dia.slice(8)}/{dados.ativacoesPorDia.at(-1)?.dia.slice(5, 7)}
            </span>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-[12px] font-medium text-slate-600">Da oferta até a ativação</div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
              {dados.funilDaOferta.map((f) => (
                <span key={f.evento} className="flex items-baseline gap-1.5">
                  <span className="text-slate-500">
                    {f.evento === "trial_offer_impression"
                      ? "Viu a oferta"
                      : f.evento === "trial_offer_click"
                        ? "Clicou"
                        : "Ativou"}
                  </span>
                  <b className="tabular-nums text-slate-900">{int(f.pessoas)}</b>
                  <span className="text-[11px] text-slate-400">pessoas</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {dados.avisos.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
          {dados.avisos.map((a, i) => (
            <li key={i} className={a.startsWith("⚠️") ? "font-medium text-amber-800" : ""}>
              <Clock size={11} className="mr-1 inline opacity-50" />
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
