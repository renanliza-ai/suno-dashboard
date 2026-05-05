"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { useGA4 } from "@/lib/ga4-context";

const PRESETS: { label: string; days: number }[] = [
  { label: "Hoje", days: 1 },
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1A", days: 365 },
];

function todayISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1); // ontem (alinhado com GA4 UI)
  return d.toISOString().slice(0, 10);
}

function isoNDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function PeriodPicker() {
  const { days, setDays, customRange, setCustomRange, periodLabel } = useGA4();
  const [open, setOpen] = useState(false);
  const [tempStart, setTempStart] = useState<string>(customRange?.startDate || isoNDaysAgo(30));
  const [tempEnd, setTempEnd] = useState<string>(customRange?.endDate || todayISO());
  const ref = useRef<HTMLDivElement>(null);

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

  const applyCustom = () => {
    if (!tempStart || !tempEnd) return;
    if (tempStart > tempEnd) return;
    setCustomRange({ startDate: tempStart, endDate: tempEnd });
    setOpen(false);
  };

  const isCustom = !!customRange;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[color:var(--border)] bg-white text-sm font-medium hover:border-[#7c5cff]/40 hover:shadow-sm transition"
        title="Selecionar período"
      >
        <Calendar className="w-4 h-4 text-[#7c5cff]" />
        <span className="text-[color:var(--foreground)]">{periodLabel}</span>
        <ChevronDown className={`w-4 h-4 text-[color:var(--muted-foreground)] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-[color:var(--border)] rounded-xl shadow-2xl p-4 z-50">
          <div className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wide mb-2">
            Presets
          </div>
          <div className="grid grid-cols-5 gap-1 mb-4">
            {PRESETS.map((p) => {
              const active = !isCustom && days === p.days;
              return (
                <button
                  key={p.label}
                  onClick={() => {
                    setDays(p.days);
                    setOpen(false);
                  }}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition ${
                    active
                      ? "bg-[#7c5cff] text-white shadow-sm"
                      : "bg-[color:var(--muted)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]/80"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="text-xs font-semibold text-[color:var(--muted-foreground)] uppercase tracking-wide mb-2">
            Período personalizado
          </div>
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs text-[color:var(--muted-foreground)]">De</span>
              <input
                type="date"
                value={tempStart}
                max={tempEnd || todayISO()}
                onChange={(e) => setTempStart(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded-md border border-[color:var(--border)] text-sm focus:outline-none focus:border-[#7c5cff]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[color:var(--muted-foreground)]">Até</span>
              <input
                type="date"
                value={tempEnd}
                min={tempStart}
                max={todayISO()}
                onChange={(e) => setTempEnd(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded-md border border-[color:var(--border)] text-sm focus:outline-none focus:border-[#7c5cff]"
              />
            </label>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={applyCustom}
              disabled={!tempStart || !tempEnd || tempStart > tempEnd}
              className="flex-1 px-3 py-2 rounded-md bg-[#7c5cff] text-white text-sm font-medium hover:bg-[#6b4fe0] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Aplicar período
            </button>
            {isCustom && (
              <button
                onClick={() => {
                  setCustomRange(null);
                  setDays(30);
                  setOpen(false);
                }}
                className="px-3 py-2 rounded-md border border-[color:var(--border)] text-sm text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] transition"
              >
                Limpar
              </button>
            )}
          </div>

          <p className="text-[10px] text-[color:var(--muted-foreground)] mt-3 leading-relaxed">
            O GA4 considera dados até ontem por padrão — o período selecionado vale para todas as páginas.
          </p>
        </div>
      )}
    </div>
  );
}
