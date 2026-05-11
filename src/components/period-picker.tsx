"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";

/**
 * Period Picker estilo Google Analytics — layout 2 colunas com presets
 * detalhados à esquerda e calendário custom à direita.
 *
 * Presets convertidos pra ranges absolutos:
 *   - Hoje / Ontem (1 dia)
 *   - Últimos 7/14/28/30/90 dias
 *   - Este mês (1º até hoje)
 *   - Mês passado (mês completo anterior)
 *   - Esta semana (segunda até hoje)
 *   - Personalizado (inputs de data)
 */

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1));
}

function endOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0));
}

function startOfWeekMonday(d: Date) {
  const day = d.getUTCDay(); // 0 (dom) - 6 (sab)
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday;
}

/** Constrói os presets dinamicamente (datas absolutas baseadas em hoje) */
function buildPresets(): { id: string; label: string; getRange: () => { startDate: string; endDate: string } }[] {
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const yesterday = new Date(todayUTC);
  yesterday.setUTCDate(todayUTC.getUTCDate() - 1);

  const ndaysAgo = (n: number) => {
    const d = new Date(todayUTC);
    d.setUTCDate(todayUTC.getUTCDate() - n);
    return d;
  };

  return [
    {
      id: "today",
      label: "Hoje",
      getRange: () => ({ startDate: toISO(todayUTC), endDate: toISO(todayUTC) }),
    },
    {
      id: "yesterday",
      label: "Ontem",
      getRange: () => ({ startDate: toISO(yesterday), endDate: toISO(yesterday) }),
    },
    {
      id: "last7",
      label: "Últimos 7 dias",
      getRange: () => ({ startDate: toISO(ndaysAgo(7)), endDate: toISO(yesterday) }),
    },
    {
      id: "last14",
      label: "Últimos 14 dias",
      getRange: () => ({ startDate: toISO(ndaysAgo(14)), endDate: toISO(yesterday) }),
    },
    {
      id: "last28",
      label: "Últimos 28 dias",
      getRange: () => ({ startDate: toISO(ndaysAgo(28)), endDate: toISO(yesterday) }),
    },
    {
      id: "last30",
      label: "Últimos 30 dias",
      getRange: () => ({ startDate: toISO(ndaysAgo(30)), endDate: toISO(yesterday) }),
    },
    {
      id: "last90",
      label: "Últimos 90 dias",
      getRange: () => ({ startDate: toISO(ndaysAgo(90)), endDate: toISO(yesterday) }),
    },
    {
      id: "thisweek",
      label: "Esta semana (seg–hoje)",
      getRange: () => ({
        startDate: toISO(startOfWeekMonday(todayUTC)),
        endDate: toISO(todayUTC),
      }),
    },
    {
      id: "thismonth",
      label: "Este mês",
      getRange: () => ({
        startDate: toISO(startOfMonth(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth())),
        endDate: toISO(todayUTC),
      }),
    },
    {
      id: "lastmonth",
      label: "Mês passado",
      getRange: () => {
        const lm = new Date(todayUTC);
        lm.setUTCMonth(lm.getUTCMonth() - 1);
        return {
          startDate: toISO(startOfMonth(lm.getUTCFullYear(), lm.getUTCMonth())),
          endDate: toISO(endOfMonth(lm.getUTCFullYear(), lm.getUTCMonth())),
        };
      },
    },
    {
      id: "thisyear",
      label: "Este ano",
      getRange: () => ({
        startDate: toISO(new Date(Date.UTC(todayUTC.getUTCFullYear(), 0, 1))),
        endDate: toISO(todayUTC),
      }),
    },
    {
      id: "last365",
      label: "Últimos 12 meses",
      getRange: () => ({ startDate: toISO(ndaysAgo(365)), endDate: toISO(yesterday) }),
    },
  ];
}

/** Detecta qual preset corresponde ao range atual (pra destacar o ativo) */
function detectActivePreset(
  customRange: { startDate: string; endDate: string } | null,
  presets: ReturnType<typeof buildPresets>
): string | null {
  if (!customRange) return null;
  for (const p of presets) {
    const r = p.getRange();
    if (r.startDate === customRange.startDate && r.endDate === customRange.endDate) {
      return p.id;
    }
  }
  return null;
}

export function PeriodPicker() {
  const { customRange, setCustomRange, periodLabel } = useGA4();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const presets = useMemo(() => buildPresets(), []);
  const activePresetId = useMemo(
    () => detectActivePreset(customRange, presets),
    [customRange, presets]
  );

  const [tempStart, setTempStart] = useState<string>(
    customRange?.startDate || presets[5].getRange().startDate
  );
  const [tempEnd, setTempEnd] = useState<string>(
    customRange?.endDate || presets[5].getRange().endDate
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (customRange) {
      setTempStart(customRange.startDate);
      setTempEnd(customRange.endDate);
    }
  }, [customRange?.startDate, customRange?.endDate]);

  const applyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    const r = preset.getRange();
    setCustomRange(r);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!tempStart || !tempEnd) return;
    if (tempStart > tempEnd) return;
    setCustomRange({ startDate: tempStart, endDate: tempEnd });
    setOpen(false);
  };

  const todayStr = toISO(new Date());

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[color:var(--border)] bg-white text-sm font-medium hover:border-[#7c5cff]/40 hover:shadow-sm transition"
        title="Selecionar período"
      >
        <Calendar className="w-4 h-4 text-[#7c5cff]" />
        <span className="text-[color:var(--foreground)] truncate max-w-[200px]">{periodLabel}</span>
        <ChevronDown
          className={`w-4 h-4 text-[color:var(--muted-foreground)] transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[520px] max-w-[calc(100vw-2rem)] bg-white border border-[color:var(--border)] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {/* Coluna esquerda — presets */}
            <div className="border-b sm:border-b-0 sm:border-r border-[color:var(--border)] p-3 bg-slate-50/30">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                Períodos rápidos
              </div>
              <div className="flex flex-col gap-0.5 max-h-[400px] overflow-y-auto">
                {presets.map((p) => {
                  const isActive = activePresetId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium text-left transition ${
                        isActive
                          ? "bg-[#7c5cff] text-white shadow-sm"
                          : "text-slate-700 hover:bg-white"
                      }`}
                    >
                      <span>{p.label}</span>
                      {isActive && <Check size={12} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Coluna direita — custom */}
            <div className="p-3">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Personalizado
              </div>
              <div className="space-y-2.5">
                <label className="block">
                  <span className="text-[10px] text-slate-500 font-medium">De</span>
                  <input
                    type="date"
                    value={tempStart}
                    max={tempEnd || todayStr}
                    onChange={(e) => setTempStart(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-[color:var(--border)] text-sm focus:outline-none focus:border-[#7c5cff]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-500 font-medium">Até</span>
                  <input
                    type="date"
                    value={tempEnd}
                    min={tempStart}
                    max={todayStr}
                    onChange={(e) => setTempEnd(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-[color:var(--border)] text-sm focus:outline-none focus:border-[#7c5cff]"
                  />
                </label>
                {tempStart && tempEnd && (
                  <div className="text-[10px] text-slate-500 font-mono bg-slate-50 rounded-md px-2 py-1.5">
                    {(() => {
                      const s = new Date(tempStart + "T00:00:00Z").getTime();
                      const e = new Date(tempEnd + "T00:00:00Z").getTime();
                      const days = Math.round((e - s) / 86_400_000) + 1;
                      return `${days} dia${days !== 1 ? "s" : ""}`;
                    })()}
                  </div>
                )}
              </div>

              <button
                onClick={applyCustom}
                disabled={!tempStart || !tempEnd || tempStart > tempEnd}
                className="w-full mt-3 px-3 py-2 rounded-md bg-[#7c5cff] text-white text-xs font-semibold hover:bg-[#6b4fe0] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Aplicar
              </button>
            </div>
          </div>

          {/* Rodapé com info do range atual */}
          {customRange && (
            <div className="border-t border-[color:var(--border)] px-4 py-2 bg-slate-50 text-[10px] text-slate-600 flex items-center justify-between flex-wrap gap-2">
              <span className="font-mono">
                {customRange.startDate} → {customRange.endDate}
              </span>
              <span className="text-slate-400">GA4 retorna dados até D-1 por padrão</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
