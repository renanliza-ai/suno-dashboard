"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Ban, Beaker, ChevronDown, ExternalLink,
  FlaskConical, Search, Wrench, Info, Scale, LayoutTemplate,
  Image as ImageIcon, MessageSquare,
} from "lucide-react";
import { classificarComunicacao, type PecaComunicacao } from "@/lib/cro-comunicacao";
import { useGA4 } from "@/lib/ga4-context";
import { DataStatus, SkeletonBlock } from "@/components/data-status";
import { clarityLinksFor } from "@/lib/clarity";
import { escopoDaPagina } from "@/lib/cro-gates";

/**
 * Aba de CRO, reconstruída em 15/09/2026.
 *
 * ⚠️ O QUE FOI REMOVIDO, E POR QUÊ
 *
 * A versão anterior tinha 2.893 linhas e quatro motores disputando a tela. A
 * maior parte do que ela mostrava era GERADA, não medida:
 *
 *   const lcp = 1.6 + (p.bounceRate/100)*2.4 + ((seed>>3)%10)/20;  // "LCP 3.4s"
 *   const roiBoost = (seed + i*7) % 6;                              // "ROI 1:14"
 *   const baseRoas = 3.6 + ((seed % 18)/10);                        // "ROAS 4.2x"
 *
 * E as evidências eram frases fixas no código: "Scrollmap do Clarity mostra que
 * 70% param antes do botão", "correlação r=0.72", "Cohort 2025: +12pp", e um
 * "Hotjar form analytics" de uma ferramenta que a Suno não usa.
 *
 * O Renan não conseguia gerar hipótese porque não havia evidência real embaixo
 * do card. Esta versão só mostra o que foi medido, e cada número vem com fonte,
 * amostra e janela. Onde não há dado, a tela diz o que falta.
 *
 * A página antiga está preservada em `_page-legado.tsx.bak` no mesmo diretório.
 */

/**
 * Rótulo da superfície de página.
 *
 * ⚠️ NASCEU DE UM DEFEITO REAL, em 22/09/2026. A tela chamava de "LP" TODA
 * página com achado. O time abriu uma tarefa sobre
 * `statusinvest.com.br/acoes/cmig4` rotulada "LP", que é a página de cotação da
 * CMIG4, e não landing page nenhuma. O número do achado estava certo (359 erros
 * de script, confirmados no Clarity), mas o rótulo errado fez o card inteiro
 * parecer inventado.
 *
 * O painel já tinha a função certa em `cro-gates.ts` e simplesmente não a usava
 * aqui. Rótulo errado não é detalhe cosmético: é o que faz quem recebe a tarefa
 * duvidar do dado que está do lado.
 */
function rotuloDePagina(url: string): string {
  try {
    const u = new URL(url);
    switch (escopoDaPagina(u.hostname, u.pathname)) {
      case "lp": return "LP";
      case "institucional": return "Institucional";
      case "checkout": return "Checkout";
      case "logado": return "Área logada";
      default: return "Página";
    }
  } catch {
    return "Página";
  }
}

type Evidencia = { fonte: string; valor: string; amostra: string; janela: string };
type Classificacao =
  | "corrigir" | "investigar" | "testar" | "decidir" | "sem_volume" | "validar_medicao";
type Superficie = "pagina" | "banner" | "popup";
type Achado = {
  id: string; superficie: Superficie; pagina: string; titulo: string;
  evidencias: Evidencia[]; hipotese: string;
  classificacao: Classificacao; porque: string;
  proximoPasso: string[]; prioridade: number;
  teste?: {
    baseline: number; efeitoMinimoPp: number; amostraPorVariante: number;
    sessoesPorDia: number; diasNecessarios: number; viavel: boolean; motivo: string;
  } | null;
};
type Resposta = {
  bu: { key: string; label: string };
  janela: string; dias: number;
  clarity: { conectado: boolean; motivo?: string; envVar?: string | null; detalhe?: string; paginas?: number };
  ga4?: { eventos: string[]; recorte: string; erro: string | null };
  achados: Achado[];
  semVolume: { url: string; pageViews: number }[];
  totais: { achados: number; corrigir: number; investigar: number; testar: number; validar: number };
  piso: number;
  limitacoes?: string[];
  error?: string;
};

const ESTILO: Record<Classificacao, { rotulo: string; icone: typeof Wrench; classe: string; explica: string }> = {
  validar_medicao: {
    rotulo: "Validar medição", icone: AlertTriangle,
    classe: "bg-violet-50 text-violet-800 border-violet-200",
    explica: "O número pode estar errado. Confirmar antes de decidir qualquer coisa em cima dele.",
  },
  corrigir: {
    rotulo: "Corrigir", icone: Wrench,
    classe: "bg-red-50 text-red-800 border-red-200",
    explica: "É defeito, não hipótese. Corrige e confere na janela seguinte, sem A/B.",
  },
  investigar: {
    rotulo: "Investigar", icone: Search,
    classe: "bg-amber-50 text-amber-800 border-amber-200",
    explica: "O dado mostra QUE tem problema, não ONDE. Falta um corte antes de desenhar teste.",
  },
  decidir: {
    rotulo: "Decidir", icone: Scale,
    classe: "bg-sky-50 text-sky-800 border-sky-200",
    explica: "O experimento já rodou sozinho. Não há o que testar, há o que trocar.",
  },
  testar: {
    rotulo: "Testar", icone: FlaskConical,
    classe: "bg-emerald-50 text-emerald-800 border-emerald-200",
    explica: "Hipótese clara, volume suficiente e teste que cabe no calendário.",
  },
  sem_volume: {
    rotulo: "Sem volume", icone: Ban,
    classe: "bg-slate-50 text-slate-600 border-slate-200",
    explica: "Amostra pequena demais para a taxa significar alguma coisa.",
  },
};

const nf = new Intl.NumberFormat("pt-BR");

/**
 * Destino no Monday para tarefa aceita nesta aba.
 *
 * Board indicado pelo Renan em 15/09/2026:
 * https://suno.monday.com/boards/18407955812
 *
 * ⚠️ Board ID não é segredo, está na URL que qualquer pessoa do time abre. Por
 * isso fica no código, com a variável de ambiente por cima quando existir, em
 * vez de exigir configuração para funcionar.
 *
 * O grupo vem da CLASSIFICAÇÃO, não de um destino único: os oito grupos deste
 * board separam por natureza do trabalho, e jogar tudo em "Growth / CRO" faria
 * o board perder exatamente a organização que ele tem. Os nomes abaixo foram
 * lidos do board em 15/09/2026, não supostos.
 *
 * A resolução no Monday é POR NOME de propósito: sobrevive a mudança de ID, e
 * quando o nome não existe a rota devolve a lista de grupos disponíveis em vez
 * de enfiar a tarefa no primeiro grupo calada.
 */
const MONDAY_BOARD_CRO = "18407955812";

const MONDAY_GRUPO_POR_CLASSE: Record<Classificacao, string> = {
  // Medição quebrada é problema de dado, não de interface nem de hipótese.
  validar_medicao: "📊 Analytics",
  // Elemento morto e erro de JavaScript são defeito para o time de tecnologia.
  corrigir: "⚙️ Tech / Features",
  // Ainda não se sabe o que testar: o trabalho é de análise.
  investigar: "📈 Growth / CRO",
  testar: "📈 Growth / CRO",
  // Trocar a peça que perdeu o experimento natural é trabalho de mídia e criativo.
  decidir: "🎯 Aquisição",
  sem_volume: "📈 Growth / CRO",
};

/** As três superfícies que a aba cobre. */
const SUPERFICIES: { chave: Superficie | "todas"; rotulo: string; icone: typeof Wrench }[] = [
  { chave: "todas", rotulo: "Tudo", icone: Beaker },
  { chave: "pagina", rotulo: "Landing pages", icone: LayoutTemplate },
  { chave: "banner", rotulo: "Banners", icone: ImageIcon },
  { chave: "popup", rotulo: "Pop-ups", icone: MessageSquare },
];

export default function CROPage() {
  const { selectedId, selected, useRealData } = useGA4();
  const propertyName = selected?.displayName || "";
  const [data, setData] = useState<Resposta | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Classificacao | "todos">("todos");
  const [superficie, setSuperficie] = useState<Superficie | "todas">("todas");
  const [aberto, setAberto] = useState<string | null>(null);

  /** Achados de banner e pop-up, calculados a partir da aba de Comunicação. */
  const [comunicacao, setComunicacao] = useState<{ achados: Achado[]; erro: string | null; pecas: number } | null>(null);

  /**
   * Achados que cruzam a fricção medida com o CONTEÚDO da página.
   *
   * Fecha a lacuna que fazia o Clarity dizer "15% de dead click" sem dizer em
   * quê. Só roda para páginas que JÁ têm fricção medida: a página nunca vira
   * achado sozinha, senão a aba viraria uma lista de opiniões sobre LPs que
   * talvez não tenham problema nenhum.
   */
  const [conteudo, setConteudo] = useState<{
    achados: Achado[];
    naoLegiveis: number;
    lidas: number;
    aviso: string | null;
  } | null>(null);
  const [lendoConteudo, setLendoConteudo] = useState(false);

  /**
   * Estado real de cada LP no servidor.
   *
   * Pedido do Renan em 15/09/2026, depois de aposentar dezenas de LPs antigas
   * com 301 para o institucional: o GA4 é histórico e continuava mostrando
   * essas páginas como se ainda fossem alvo de trabalho.
   */
  const [estadoLPs, setEstadoLPs] = useState<Record<string, { estado: string; apta: boolean }>>({});
  const [higienizar, setHigienizar] = useState(true);
  const [verificando, setVerificando] = useState(false);

  /**
   * Tarefas no Monday, por achado.
   *
   * Voltou a pedido do Renan em 15/09/2026. A versão anterior da aba tinha
   * isso, mas amarrado em cards cujo impacto e ROI eram gerados por hash do
   * nome da property. Religado aqui em cima de achado medido.
   *
   * ⚠️ O payload NÃO preenche iceScore, impacto em R$ nem esforço. A rota do
   * Monday aceita os três, e a versão antiga os mandava inventados. Não medimos
   * nenhum deles, então vão vazios: campo ausente na tarefa é honesto, campo
   * preenchido com palpite vira decisão de prioridade errada duas semanas
   * depois.
   */
  const [tarefas, setTarefas] = useState<Record<string, { estado: "criando" | "ok" | "erro"; url?: string; msg?: string }>>({});

  useEffect(() => {
    if (!useRealData || !selectedId || !propertyName) {
      setData(null);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setErro(null);
    const p = new URLSearchParams({ propertyId: selectedId, propertyName, days: "3" });
    fetch(`/api/cro/evidence?${p.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Resposta) => {
        if (cancelado) return;
        if (d.error) { setErro(d.error); setData(null); return; }
        setData(d);
      })
      .catch((e) => { if (!cancelado) setErro((e as Error).message); })
      .finally(() => { if (!cancelado) setLoading(false); });

    // Tarefas já criadas nesta property, para o botão não oferecer duplicata
    // depois de um F5.
    fetch(`/api/cro/proposal-state?propertyId=${selectedId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { entries?: { proposalKey: string; state?: { mondayUrl?: string } }[] }) => {
        if (cancelado || !d.entries) return;
        const m: Record<string, { estado: "ok"; url?: string }> = {};
        for (const e of d.entries) {
          if (e.state?.mondayUrl) m[e.proposalKey] = { estado: "ok", url: e.state.mondayUrl };
        }
        if (Object.keys(m).length) setTarefas((t) => ({ ...m, ...t }));
      })
      .catch(() => { /* sem persistência não impede criar tarefa */ });

    return () => { cancelado = true; };
  }, [selectedId, propertyName, useRealData]);

  /**
   * Banners e pop-ups.
   *
   * Consome `/api/comunicacao/spaces`, que já entrega o grão espaço × peça com
   * a taxonomia normalizada e as armadilhas de escopo do GA4 resolvidas. Montar
   * outra consulta aqui duplicaria essa lógica e as duas divergiriam na primeira
   * mudança. O motor `classificarComunicacao` é puro, então roda no cliente.
   */
  useEffect(() => {
    if (!useRealData || !selectedId || !propertyName) { setComunicacao(null); return; }
    let cancelado = false;
    const p = new URLSearchParams({ propertyId: selectedId, propertyName, kind: "todos", days: "14" });
    fetch(`/api/comunicacao/spaces?${p.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: {
        error?: string; blocked?: string | null; range?: { startDate: string; endDate: string };
        bu?: { conversionModel?: string };
        spaces?: {
          space: string; kind: "banner" | "popup"; bannerName: string; named: boolean;
          sessions: number; leads: number; accounts: number | null;
          checkoutStarts: number | null; purchases: number | null;
        }[];
      }) => {
        if (cancelado) return;
        if (d.error || !d.spaces?.length) {
          setComunicacao({ achados: [], erro: d.error || d.blocked || null, pecas: 0 });
          return;
        }
        // Regra universal Suno: venda mede a compra, captação mede o lead.
        const venda = d.bu?.conversionModel === "captacao_venda";
        const janela = d.range ? `${d.range.startDate} a ${d.range.endDate}` : "últimos 14 dias";
        const linhas = d.spaces;
        const para = (r: (typeof linhas)[number]): PecaComunicacao => ({
          espaco: r.space,
          peca: r.bannerName,
          nomeada: r.named,
          cliques: r.sessions,
          conversoes: venda ? r.purchases || 0 : r.leads || 0,
          eventoConversao: venda ? "compras" : "leads",
          sinaisTotais:
            (r.purchases || 0) + (r.checkoutStarts || 0) + (r.leads || 0) + (r.accounts || 0),
        });
        const achados: Achado[] = [];
        for (const sup of ["banner", "popup"] as const) {
          const pecas = linhas.filter((r) => r.kind === sup).map(para);
          if (!pecas.length) continue;
          achados.push(...(classificarComunicacao(pecas, sup, janela, 14).achados as Achado[]));
        }
        setComunicacao({ achados, erro: null, pecas: linhas.length });
      })
      .catch((e) => { if (!cancelado) setComunicacao({ achados: [], erro: (e as Error).message, pecas: 0 }); });
    return () => { cancelado = true; };
  }, [selectedId, propertyName, useRealData]);

  /**
   * Verifica no SERVIDOR quais LPs dos achados ainda estão no ar.
   *
   * Roda em rodadas porque a rota trabalha por orçamento de tempo: 210 LPs a
   * duas batidas cada não cabem nos 60s da Vercel. Cada rodada aproveita o
   * cache da anterior, então a segunda chamada é quase instantânea.
   */
  useEffect(() => {
    const urls = Array.from(
      new Set((data?.achados || []).filter((a) => a.superficie === "pagina").map((a) => a.pagina))
    );
    if (!urls.length) return;
    let cancelado = false;
    const paginas = urls
      .map((u) => { try { const x = new URL(u); return { host: x.host, path: x.pathname }; } catch { return null; } })
      .filter((x): x is { host: string; path: string } => x !== null);
    if (!paginas.length) return;

    async function rodar() {
      setVerificando(true);
      for (let rodada = 0; rodada < 6 && !cancelado; rodada++) {
        const r = await fetch("/api/lp/estado", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paginas }),
        }).then((x) => x.json()).catch(() => null);
        if (cancelado || !r?.resultados) break;
        const m: Record<string, { estado: string; apta: boolean }> = {};
        for (const x of r.resultados as { host: string; path: string; estado: string; apta: boolean }[]) {
          m[`${x.host}${x.path.replace(/\/+$/, "")}`.toLowerCase()] = { estado: x.estado, apta: x.apta };
        }
        setEstadoLPs((atual) => ({ ...atual, ...m }));
        if (!r.pendentes) break;
      }
      if (!cancelado) setVerificando(false);
    }
    rodar();
    return () => { cancelado = true; };
  }, [data]);

  /**
   * Lê o conteúdo das páginas que já acusaram fricção.
   *
   * Roda depois de `data` porque depende dos achados de página existirem: a
   * entrada aqui é a lista de URLs com problema medido, não o inventário de LPs.
   */
  useEffect(() => {
    const deFriccao = (data?.achados || []).filter((a) => a.superficie === "pagina");
    if (!deFriccao.length) { setConteudo(null); return; }
    let cancelado = false;

    // Uma entrada por URL, com a fricção que ela acusou.
    const porUrl = new Map<string, { url: string; pageViews: number; deadRate: number | null; rageRate: number | null; quickbackRate: number | null; conversoes: number; objetivo: "captacao" | "venda" | "indefinido" }>();
    for (const a of deFriccao) {
      if (!/^https?:\/\//.test(a.pagina)) continue;
      const atual = porUrl.get(a.pagina) || {
        url: a.pagina, pageViews: 0, deadRate: null, rageRate: null, quickbackRate: null,
        conversoes: 0, objetivo: "indefinido" as const,
      };
      // As taxas vêm no texto da evidência do Clarity; o motor de conteúdo só
      // precisa saber QUAL fricção disparou, então a marca vem do id do achado.
      if (a.id.startsWith("dead:")) atual.deadRate = 100;
      if (a.id.startsWith("rage:")) atual.rageRate = 100;
      if (a.id.startsWith("quick:")) atual.quickbackRate = 100;
      porUrl.set(a.pagina, atual);
    }
    const paginas = Array.from(porUrl.values()).slice(0, 60);
    if (!paginas.length) { setConteudo(null); return; }

    setLendoConteudo(true);
    fetch("/api/cro/conteudo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paginas, janela: data?.janela }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setConteudo(d); })
      .catch(() => { if (!cancelado) setConteudo(null); })
      .finally(() => { if (!cancelado) setLendoConteudo(false); });

    return () => { cancelado = true; };
  }, [data]);

  const todosAchados = useMemo(
    () =>
      [...(data?.achados || []), ...(comunicacao?.achados || []), ...(conteudo?.achados || [])].sort(
        (a, b) => b.prioridade - a.prioridade
      ),
    [data, comunicacao, conteudo]
  );

  /** LP que o servidor já disse que não recebe mais tráfego. */
  const estadoDe = (a: Achado): string | null => {
    if (a.superficie !== "pagina") return null;
    try {
      const x = new URL(a.pagina);
      return estadoLPs[`${x.host}${x.pathname.replace(/\/+$/, "")}`.toLowerCase()]?.estado ?? null;
    } catch { return null; }
  };
  const aposentada = (a: Achado) => {
    const e = estadoDe(a);
    return e === "aposentada" || e === "fora";
  };
  const removidasPorHigiene = useMemo(
    () => todosAchados.filter(aposentada).length,
    [todosAchados, estadoLPs]
  );

  const visiveis = useMemo(
    () =>
      todosAchados.filter(
        (a) =>
          (filtro === "todos" || a.classificacao === filtro) &&
          (superficie === "todas" || a.superficie === superficie) &&
          (!higienizar || !aposentada(a))
      ),
    [todosAchados, filtro, superficie, higienizar, estadoLPs]
  );

  const totaisVisiveis = useMemo(() => {
    const base = todosAchados.filter(
      (a) => (superficie === "todas" || a.superficie === superficie) && (!higienizar || !aposentada(a))
    );
    const c = (k: Classificacao) => base.filter((a) => a.classificacao === k).length;
    return {
      achados: base.length,
      validar: c("validar_medicao"), corrigir: c("corrigir"),
      decidir: c("decidir"), investigar: c("investigar"), testar: c("testar"),
    };
  }, [todosAchados, superficie, higienizar, estadoLPs]);

  /**
   * Cria a tarefa no Monday a partir do achado.
   *
   * O payload é fiel ao que foi medido e NADA além. Em particular ficam de fora
   * iceScore, impact e effort, que a rota aceita e a versão antiga da aba
   * mandava inventados (o ICE saía de hash do nome da property). Campo ausente
   * na tarefa é honesto; campo com palpite vira prioridade errada duas semanas
   * depois, quando ninguém lembra de onde o número veio.
   */
  async function criarTarefa(a: Achado) {
    if (!selectedId) return;
    const atual = tarefas[a.id]?.estado;
    if (atual === "criando" || atual === "ok") return;
    setTarefas((t) => ({ ...t, [a.id]: { estado: "criando" } }));

    const est = ESTILO[a.classificacao];
    const lk = clarityLinksFor(propertyName, a.pagina);

    // A classificação define a urgência: defeito medido vem antes de hipótese.
    const priority =
      a.classificacao === "corrigir" || a.classificacao === "validar_medicao"
        ? ("Alta" as const)
        : ("Média" as const);

    const evidencia = a.evidencias
      .map((ev) => `${ev.fonte} · ${ev.janela} · ${ev.amostra} → ${ev.valor}`)
      .join("\n");

    const insight = {
      title: `[${est.rotulo}] ${a.titulo}`,
      pageUrl: a.pagina,
      pageRef: a.pagina.replace(/^https?:\/\//, ""),
      framework: `Triagem CRO · ${est.rotulo}`,
      description: a.porque,
      hypothesis: a.hipotese,
      evidence: evidencia,
      steps: a.proximoPasso,
      priority,
      propertyName,
      primaryKPI: a.teste
        ? `Conversão da página, hoje em ${a.teste.baseline.toFixed(2).replace(".", ",")}%`
        : undefined,
      testWindow: a.teste
        ? `${a.teste.diasNecessarios} dias, ${nf.format(a.teste.amostraPorVariante)} sessões por variante. ${a.teste.motivo}`
        : undefined,
      rollback: a.teste
        ? `Promover só com ganho de ${a.teste.efeitoMinimoPp.toFixed(2).replace(".", ",")} ponto percentual ou mais. Abaixo disso, manter A.`
        : undefined,
      clarityLinks: { heatmaps: lk.heatmaps, recordings: lk.recordings, filterHint: lk.filterHint },
    };

    try {
      const r = await fetch("/api/monday/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insight,
          sourceLink: a.pagina,
          boardId: MONDAY_BOARD_CRO,
          groupName: MONDAY_GRUPO_POR_CLASSE[a.classificacao],
        }),
      });
      const d = await r.json();
      if (!d.ok) {
        setTarefas((t) => ({ ...t, [a.id]: { estado: "erro", msg: d.message || d.error || "falhou" } }));
        return;
      }
      setTarefas((t) => ({ ...t, [a.id]: { estado: "ok", url: d.item?.url } }));

      // Persiste para o botão não oferecer duplicata depois de um F5.
      fetch("/api/cro/proposal-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedId,
          proposalKey: a.id,
          status: "accepted",
          mondayItemId: d.item?.id,
          mondayUrl: d.item?.url,
          snapshot: { title: a.titulo, page: a.pagina, classificacao: a.classificacao },
        }),
      }).catch(() => {
        /* a tarefa já existe no Monday; persistir é conveniência, não requisito */
      });
    } catch (err) {
      setTarefas((t) => ({ ...t, [a.id]: { estado: "erro", msg: (err as Error).message } }));
    }
  }

  const links = clarityLinksFor(propertyName);

  return (
    <main className="ml-0 md:ml-20 p-4 md:p-8 max-w-[1400px]">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#5b3dd4] flex items-center justify-center">
          <Beaker size={20} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">CRO</h1>
        <DataStatus
          meta={{
            status: loading ? "loading" : erro ? "error" : data ? "success" : "idle",
            propertyId: selectedId || null,
            propertyName: propertyName || null,
            fetchedAt: data ? Date.now() : null,
          }}
          usingMock={!useRealData}
          label="Clarity + GA4"
          compact
        />
        {data?.janela && (
          <span className="text-xs px-2 py-1 rounded-lg bg-[color:var(--muted)] text-[color:var(--muted-foreground)]">
            {data.janela}
          </span>
        )}
      </div>
      <p className="text-sm text-[color:var(--muted-foreground)] mb-6">
        Evidência de usabilidade do Clarity cruzada com conversão do GA4. Cada achado vem com a
        fonte, o número, a amostra e a janela, e é classificado em <b>corrigir</b>, <b>investigar</b>{" "}
        ou <b>testar</b>. Nem todo achado vira teste, e dizer isso é parte do método.
      </p>

      {!useRealData && (
        <div className="rounded-2xl border-2 border-dashed border-[color:var(--border)] p-8 text-center">
          <p className="font-semibold mb-1">Sem conexão com o GA4</p>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Selecione uma propriedade no seletor acima.
          </p>
        </div>
      )}

      {useRealData && loading && (
        <div className="space-y-3">
          <SkeletonBlock height={92} />
          <SkeletonBlock height={220} />
          <SkeletonBlock height={220} />
        </div>
      )}

      {useRealData && erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-900 mb-1">Não foi possível carregar</p>
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      {/* Clarity não conectado: diz exatamente o que falta, não inventa dado */}
      {useRealData && !loading && data && !data.clarity.conectado && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-amber-900 mb-1">
                Clarity não conectado em {data.bu.label}
              </p>
              <p className="text-sm text-amber-800 leading-relaxed mb-3">{data.clarity.detalhe}</p>
              {data.clarity.envVar && (
                <div className="text-xs text-amber-900 bg-amber-100/60 rounded-lg p-3 space-y-1">
                  <p className="font-semibold">Para ligar:</p>
                  <p>
                    1. No Clarity, abrir <b>Settings &gt; Data Export</b> do projeto desta B.U. e gerar
                    um token de API.
                  </p>
                  <p>
                    2. Criar a variável <code className="bg-white px-1 rounded">{data.clarity.envVar}</code>{" "}
                    no ambiente do painel com esse token.
                  </p>
                  <p className="text-amber-700">
                    O token é credencial: ele vai direto do Clarity para a variável de ambiente, nunca
                    para o código nem para o chat.
                  </p>
                </div>
              )}
              {links.dashboard && (
                <a href={links.dashboard} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-amber-900 hover:underline">
                  Abrir o Clarity desta B.U. <ExternalLink size={13} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {useRealData && !loading && data && data.clarity.conectado && (
        <>
          {/* Superfície: landing page, banner ou pop-up */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {SUPERFICIES.map((s) => {
              const Icone = s.icone;
              const n = s.chave === "todas"
                ? todosAchados.filter((a) => !higienizar || !aposentada(a)).length
                : todosAchados.filter((a) => a.superficie === s.chave && (!higienizar || !aposentada(a))).length;
              const ativo = superficie === s.chave;
              return (
                <button key={s.chave} onClick={() => setSuperficie(s.chave)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
                    ativo
                      ? "bg-[#7c5cff] text-white border-[#7c5cff]"
                      : "bg-white text-[color:var(--muted-foreground)] border-[color:var(--border)] hover:border-[#7c5cff]/40"
                  }`}>
                  <Icone size={13} /> {s.rotulo}
                  <span className={`tabular-nums ${ativo ? "opacity-90" : "opacity-60"}`}>{n}</span>
                </button>
              );
            })}
            <label className="ml-auto inline-flex items-center gap-2 text-xs text-[color:var(--muted-foreground)] cursor-pointer">
              <input type="checkbox" checked={higienizar} onChange={(e) => setHigienizar(e.target.checked)}
                className="rounded border-[color:var(--border)]" />
              Só LPs no ar
              {verificando && <span className="text-[10px] opacity-60">verificando…</span>}
              {!verificando && removidasPorHigiene > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {removidasPorHigiene} fora
                </span>
              )}
            </label>
          </div>

          {/* Contagem por classificação, que é o resumo que importa */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {(["validar_medicao", "corrigir", "decidir", "investigar", "testar"] as Classificacao[]).map((c) => {
              const n = c === "validar_medicao" ? totaisVisiveis.validar
                : c === "corrigir" ? totaisVisiveis.corrigir
                : c === "decidir" ? totaisVisiveis.decidir
                : c === "investigar" ? totaisVisiveis.investigar
                : totaisVisiveis.testar;
              const e = ESTILO[c];
              const Icone = e.icone;
              return (
                <button key={c} onClick={() => setFiltro(filtro === c ? "todos" : c)}
                  className={`text-left rounded-2xl border p-4 transition ${e.classe} ${filtro === c ? "ring-2 ring-offset-1 ring-current" : "hover:brightness-95"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icone size={14} />
                    <span className="text-[11px] font-bold uppercase tracking-wider">{e.rotulo}</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{n}</p>
                  <p className="text-[11px] mt-0.5 leading-snug opacity-80">{e.explica}</p>
                </button>
              );
            })}
          </div>

          {filtro !== "todos" && (
            <button onClick={() => setFiltro("todos")}
              className="text-xs font-semibold text-[#7c5cff] hover:underline mb-3">
              ← ver todos os {totaisVisiveis.achados} achados
            </button>
          )}

          {comunicacao?.erro && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
              Banners e pop-ups não entraram nesta lista: {comunicacao.erro}
            </p>
          )}

          {visiveis.length === 0 ? (
            <div className="rounded-2xl border border-[color:var(--border)] bg-white p-8 text-center">
              <p className="font-semibold mb-1">Nenhum achado nesta classificação</p>
              <p className="text-sm text-[color:var(--muted-foreground)]">
                Nada passou dos limiares na janela medida. Isso é resultado, não falta de dado.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visiveis.map((a) => {
                const e = ESTILO[a.classificacao];
                const Icone = e.icone;
                const expandido = aberto === a.id;
                const tarefa = tarefas[a.id];
                // Banner e pop-up não têm URL: o Clarity é por página, então
                // link dali seria link quebrado com cara de atalho útil.
                const lk = a.superficie === "pagina"
                  ? clarityLinksFor(propertyName, a.pagina)
                  : { recordings: "", heatmaps: "", filterHint: "" };
                const est = estadoDe(a);
                return (
                  <div key={a.id} className="rounded-2xl border border-[color:var(--border)] bg-white overflow-hidden">
                    <button onClick={() => setAberto(expandido ? null : a.id)} className="w-full text-left p-4 hover:bg-[color:var(--muted)]/30">
                      <div className="flex items-start gap-3">
                        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${e.classe}`}>
                          <Icone size={11} /> {e.rotulo}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm">
                            {a.titulo}
                            {tarefa?.estado === "ok" && (
                              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                no Monday
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[color:var(--muted-foreground)] truncate mt-0.5" title={a.pagina}>
                            <span className="font-semibold text-[10px] uppercase tracking-wider mr-1.5 opacity-70">
                              {a.superficie === "pagina" ? rotuloDePagina(a.pagina) : a.superficie === "banner" ? "Banner" : "Pop-up"}
                            </span>
                            {a.pagina}
                          </p>
                          {/* Estado da LP no servidor. Achado sobre página que
                              não recebe mais tráfego é trabalho jogado fora. */}
                          {est && est !== "no_ar" && (
                            <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              est === "no_ar_com_vazamento"
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                            }`}>
                              {est === "no_ar_com_vazamento"
                                ? "no ar, mas a URL sem barra final vai para o institucional"
                                : est === "aposentada"
                                  ? "aposentada: o endereço redireciona"
                                  : est === "fora"
                                    ? "fora do ar (404)"
                                    : "estado não verificado"}
                            </span>
                          )}
                          {/* A evidência fica VISÍVEL sem precisar abrir: é o que
                              sustenta o card, não um detalhe secundário. */}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {a.evidencias.map((ev, i) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-[color:var(--muted)] text-[color:var(--foreground)]">
                                <b>{ev.fonte}</b> · {ev.valor} <span className="text-[color:var(--muted-foreground)]">({ev.amostra})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <ChevronDown size={16} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform ${expandido ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {expandido && (
                      <div className="border-t border-[color:var(--border)] p-4 space-y-4 bg-[color:var(--muted)]/20">
                        <Bloco titulo="Hipótese">
                          <p className="text-sm leading-relaxed">{a.hipotese}</p>
                        </Bloco>
                        <Bloco titulo={`Por que "${e.rotulo}" e não outra coisa`}>
                          <p className="text-sm leading-relaxed text-[color:var(--muted-foreground)]">{a.porque}</p>
                        </Bloco>
                        <Bloco titulo="Próximo passo">
                          <ol className="space-y-1.5">
                            {a.proximoPasso.map((p, i) => (
                              <li key={i} className="text-sm flex gap-2">
                                <span className="shrink-0 w-5 h-5 rounded-full bg-[#7c5cff]/10 text-[#7c5cff] text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                                <span className="leading-relaxed">{p}</span>
                              </li>
                            ))}
                          </ol>
                        </Bloco>
                        <Bloco titulo="Evidência completa">
                          <div className="space-y-1.5">
                            {a.evidencias.map((ev, i) => (
                              <p key={i} className="text-xs">
                                <b>{ev.fonte}</b> · {ev.janela} · {ev.amostra} → {ev.valor}
                              </p>
                            ))}
                          </div>
                        </Bloco>
                        {/* Tarefa no Monday, a partir do achado medido */}
                        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[color:var(--border)] mt-1 pt-3">
                          {tarefa?.estado === "ok" ? (
                            <>
                              <span className="text-xs font-semibold text-emerald-700">Tarefa criada</span>
                              {tarefa.url && (
                                <a href={tarefa.url} target="_blank" rel="noopener noreferrer"
                                   className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c5cff] hover:underline">
                                  Abrir no Monday <ExternalLink size={12} />
                                </a>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={(ev) => { ev.stopPropagation(); criarTarefa(a); }}
                              disabled={tarefa?.estado === "criando"}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#7c5cff] text-white hover:bg-[#6a4ae0] disabled:opacity-50 disabled:cursor-wait"
                            >
                              {tarefa?.estado === "criando" ? "Criando…" : "Criar tarefa no Monday"}
                            </button>
                          )}
                          {tarefa?.estado === "erro" && (
                            <span className="text-xs text-red-700">Falhou: {tarefa.msg}</span>
                          )}
                          <span className="text-[11px] text-[color:var(--muted-foreground)]">
                            Vai para <b>{MONDAY_GRUPO_POR_CLASSE[a.classificacao]}</b> com a evidência, a
                            hipótese e os passos. Sem ICE, sem impacto em R$ e sem esforço, porque nenhum
                            dos três é medido aqui.
                          </span>
                        </div>

                        {lk.recordings && (
                          <div className="flex flex-wrap gap-3 pt-1">
                            <a href={lk.recordings} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c5cff] hover:underline">
                              Gravações no Clarity <ExternalLink size={12} />
                            </a>
                            {lk.heatmaps && (
                              <a href={lk.heatmaps} target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c5cff] hover:underline">
                                Heatmap <ExternalLink size={12} />
                              </a>
                            )}
                            <span className="text-[11px] text-[color:var(--muted-foreground)]">{lk.filterHint}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sinal fraco: existe, mas separado, com o motivo */}
          {data.semVolume.length > 0 && (
            <details className="mt-6 rounded-2xl border border-[color:var(--border)] bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                {data.semVolume.length} páginas ficaram de fora por falta de volume
              </summary>
              <p className="text-xs text-[color:var(--muted-foreground)] mt-2 mb-3 leading-relaxed">
                Abaixo de {nf.format(data.piso)} pageviews na janela a taxa não é confiável. Sem esse
                piso, uma página com 1 visita e 1 rage click apareceria com 100% e lideraria o ranking.
              </p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {data.semVolume.map((s) => (
                  <p key={s.url} className="text-xs flex justify-between gap-3">
                    <span className="truncate text-[color:var(--muted-foreground)]" title={s.url}>{s.url}</span>
                    <span className="shrink-0 tabular-nums">{nf.format(s.pageViews)} pv</span>
                  </p>
                ))}
              </div>
            </details>
          )}

          {data.limitacoes && data.limitacoes.length > 0 && (
            <div className="mt-6 rounded-2xl border border-[color:var(--border)] bg-white p-4">
              <div className="flex items-start gap-2.5">
                <Info size={15} className="text-[#7c5cff] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-2">
                    O que esta aba não consegue medir
                  </p>
                  <ul className="space-y-1.5">
                    {data.limitacoes.map((l, i) => (
                      <li key={i} className="text-xs text-[color:var(--muted-foreground)] leading-relaxed flex gap-1.5">
                        <span className="shrink-0">•</span><span>{l}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted-foreground)] mb-1.5">
        {titulo}
      </p>
      {children}
    </div>
  );
}
