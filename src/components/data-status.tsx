"use client";

import { Database, AlertCircle, Loader2, Clock } from "lucide-react";
import type { GA4Meta } from "@/lib/ga4-context";

/**
 * Badge que aparece em cada gráfico/tabela mostrando a fonte dos dados.
 * Garante que o gerente sabe EXATAMENTE de onde vem cada número:
 *   - verde  → dados reais da property X, atualizados há Ys
 *   - azul   → carregando dados reais
 *   - vermelho → erro ao buscar, mostra mensagem + NÃO exibe números
 *   - amarelo → parcial (alguma seção retornou erro)
 *   - cinza  → demo/mock (nenhuma property selecionada)
 */
export function DataStatus({
  meta,
  usingMock,
  label,
  compact = false,
}: {
  meta?: GA4Meta;
  usingMock?: boolean;
  label?: string; // ex.: "Usuários Ativos", "Tendência de Tráfego"
  compact?: boolean;
}) {
  if (usingMock || !meta || meta.status === "idle") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${
          compact ? "text-[9px]" : "text-[10px]"
        } bg-slate-100 text-slate-600 border-slate-200`}
        title="Usando dados de demonstração. Selecione uma property GA4 no header para ver dados reais."
      >
        DEMO
      </span>
    );
  }

  if (meta.status === "loading") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${
          compact ? "text-[9px]" : "text-[10px]"
        } bg-blue-50 text-blue-700 border-blue-200`}
      >
        <Loader2 size={compact ? 8 : 10} className="animate-spin" />
        {label ? `Carregando ${label}...` : "Carregando GA4..."}
      </span>
    );
  }

  if (meta.status === "error") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${
          compact ? "text-[9px]" : "text-[10px]"
        } bg-red-50 text-red-700 border-red-200`}
        title={`Property ${meta.propertyName || meta.propertyId} retornou erro`}
      >
        <AlertCircle size={compact ? 8 : 10} />
        Erro GA4
      </span>
    );
  }

  if (meta.status === "partial") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${
          compact ? "text-[9px]" : "text-[10px]"
        } bg-amber-50 text-amber-700 border-amber-200`}
      >
        <AlertCircle size={compact ? 8 : 10} />
        Parcial
      </span>
    );
  }

  // success
  const fresh = meta.fetchedAt ? Math.max(0, Math.floor((Date.now() - meta.fetchedAt) / 1000)) : 0;
  const freshLabel = fresh < 60 ? `${fresh}s` : fresh < 3600 ? `${Math.floor(fresh / 60)}min` : `${Math.floor(fresh / 3600)}h`;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${
        compact ? "text-[9px]" : "text-[10px]"
      } bg-emerald-50 text-emerald-700 border-emerald-200`}
      title={`Dados reais de ${meta.propertyName} (${meta.propertyId}) · coletado há ${freshLabel}`}
    >
      <Database size={compact ? 8 : 10} />
      GA4 Real · {meta.propertyName?.slice(0, 22) || meta.propertyId}
      <span className="opacity-60 flex items-center gap-0.5 ml-1">
        <Clock size={compact ? 7 : 9} /> {freshLabel}
      </span>
    </span>
  );
}

/** Badge do período real consultado — facilita auditoria lado-a-lado com GA4 UI */
export function PeriodBadge({
  range,
  days,
  compact = false,
}: {
  range?: { startDate: string; endDate: string } | null;
  days?: number;
  compact?: boolean;
}) {
  if (!range) return null;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono border border-slate-200 bg-slate-50 text-slate-700 ${
        compact ? "text-[9px]" : "text-[10px]"
      }`}
      title={`Período exato consultado no GA4 Data API · use este intervalo no GA4 UI para comparar`}
    >
      {fmt(range.startDate)} → {fmt(range.endDate)}
      {days ? <span className="opacity-60">· {days}d</span> : null}
    </span>
  );
}

/** Skeleton pulsante para placeholder durante loading */
export function SkeletonBlock({ className = "", height = 40 }: { className?: string; height?: number }) {
  return (
    <div
      className={`animate-pulse bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100 bg-[length:200%_100%] rounded-lg ${className}`}
      style={{ height, animation: "shimmer 1.5s ease-in-out infinite" }}
    />
  );
}

/** Card de erro GA4 com retry + mensagem clara */
export function DataErrorCard({
  meta,
  error,
  onRetry,
}: {
  meta: GA4Meta;
  error: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
        <AlertCircle size={16} className="text-red-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-red-900">
          Não foi possível carregar dados da property
        </div>
        <div className="text-xs text-red-700 mt-0.5">
          <strong>{meta.propertyName}</strong> · ID {meta.propertyId}
        </div>
        <div className="text-[11px] text-red-600 font-mono mt-2 bg-white/60 rounded p-2 break-all">
          {error || "Erro desconhecido"}
        </div>
        <div className="text-[11px] text-red-700 mt-2">
          <strong>Nenhum número mock está sendo exibido nessa área</strong> — para não comprometer a confiança. Tente
          reconectar ao Google ou trocar de property no header.
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 px-3 py-1 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
