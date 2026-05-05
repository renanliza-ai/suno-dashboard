"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Target,
  MapPin,
  DollarSign,
  BookOpen,
  Smartphone,
  Heart,
  AlertTriangle,
  Sparkles,
  GraduationCap,
  Briefcase,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Modal do ICP Suno — Ideal Customer Profile.
 * Usado na aba Audiência para que o time comercial e marketing
 * tenham uma referência compartilhada de "quem é o cliente ideal".
 */
export type ICPBlock = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  items: { label: string; value: string }[];
  color: string;
};

const icpBlocks: ICPBlock[] = [
  {
    icon: UserCheck,
    title: "Demografia",
    color: "from-purple-500 to-purple-600",
    items: [
      { label: "Idade", value: "32–55 anos (sweet spot 38–48)" },
      { label: "Gênero", value: "68% masculino · 32% feminino" },
      { label: "Estado civil", value: "Casado(a), geralmente com filhos" },
      { label: "Escolaridade", value: "Superior completo ou pós" },
    ],
  },
  {
    icon: MapPin,
    title: "Geografia",
    color: "from-blue-500 to-cyan-500",
    items: [
      { label: "Região", value: "Sudeste (SP, RJ, MG) + Sul (RS, PR, SC)" },
      { label: "Cidades-alvo", value: "Capitais + interior de alta renda" },
      { label: "Fuso horário", value: "BRT — foco em horário comercial + pré-abertura B3" },
    ],
  },
  {
    icon: DollarSign,
    title: "Financeiro",
    color: "from-emerald-500 to-teal-600",
    items: [
      { label: "Renda mensal", value: "R$ 10k–40k (individual)" },
      { label: "Patrimônio", value: "R$ 100k–2M investíveis" },
      { label: "Perfil investidor", value: "Moderado a arrojado" },
      { label: "Ticket Suno", value: "R$ 29–199/mês (Premium é 72% do LTV)" },
    ],
  },
  {
    icon: Briefcase,
    title: "Profissão",
    color: "from-amber-500 to-orange-500",
    items: [
      { label: "Ocupação", value: "CLT sênior, liberais, empreendedores" },
      { label: "Setores top", value: "TI, medicina, direito, engenharia, finanças" },
      { label: "Cargo", value: "Gerente+, sócios, consultores" },
    ],
  },
  {
    icon: BookOpen,
    title: "Comportamento de consumo",
    color: "from-pink-500 to-rose-500",
    items: [
      { label: "Pesquisa", value: "Lê 2+ newsletters financeiras por semana" },
      { label: "Consumo de conteúdo", value: "YouTube (Suno + concorrentes), LinkedIn, podcasts" },
      { label: "Decisão de compra", value: "Cauteloso — avalia 2–4 semanas antes de assinar" },
      { label: "Social proof", value: "Valoriza analistas reconhecidos e histórico" },
    ],
  },
  {
    icon: Smartphone,
    title: "Tecnologia",
    color: "from-indigo-500 to-violet-500",
    items: [
      { label: "Device", value: "62% mobile (iOS > Android) · 38% desktop" },
      { label: "Browser", value: "Chrome e Safari dominam" },
      { label: "Hábito", value: "Checa mercado 2–3x/dia pelo celular" },
    ],
  },
  {
    icon: Heart,
    title: "Motivações",
    color: "from-red-500 to-pink-600",
    items: [
      { label: "Principal", value: "Construir renda passiva via dividendos e FIIs" },
      { label: "Aspiracional", value: "Independência financeira aos 55–60" },
      { label: "Emocional", value: "Controle sobre o próprio dinheiro, fugir de taxas de banco" },
    ],
  },
  {
    icon: AlertTriangle,
    title: "Dores / Objeções",
    color: "from-yellow-500 to-orange-600",
    items: [
      { label: "Principais dores", value: "Falta de tempo para analisar ações individualmente" },
      { label: "Medo", value: "Comprar 'o papel errado' e perder dinheiro" },
      { label: "Objeção Suno", value: "\"Preciso mesmo pagar assinatura?\" — combatida com track record" },
    ],
  },
];

const antiIcp = [
  "Estudantes sem renda investível",
  "Day-traders puros (perfil especulativo, não casa com dividendos)",
  "Quem busca 'enriquecer rápido' — churn > 3x maior",
  "Pessoas sem conta em corretora",
];

// ---------- Personas: avatar dinâmico por gênero + faixa etária ----------
type Gender = "male" | "female";
type AgeBand = "young" | "sweet" | "mature"; // 28-37, 38-48, 49-60

const personaPresets: Record<Gender, Record<AgeBand, {
  emoji: string;
  name: string;
  age: number;
  occupation: string;
  location: string;
  income: string;
  goal: string;
  bio: string;
  bg: string;
}>> = {
  male: {
    young: {
      emoji: "🧑🏻‍💻",
      name: "Lucas Albuquerque",
      age: 32,
      occupation: "Engenheiro de software sênior",
      location: "São Paulo — SP",
      income: "R$ 14k/mês",
      goal: "Construir reserva financeira + começar FIIs",
      bio: "CLT em tech, 2 anos investindo por conta. Quer sair do CDB e diversificar — mas tem medo de 'comprar errado'.",
      bg: "from-blue-500 to-indigo-600",
    },
    sweet: {
      emoji: "👨🏻‍💼",
      name: "Rafael Monteiro",
      age: 43,
      occupation: "Gerente comercial / sócio",
      location: "Rio de Janeiro — RJ",
      income: "R$ 22k/mês",
      goal: "Renda passiva via dividendos · aposentadoria aos 58",
      bio: "Casado, 2 filhos. Já possui R$ 450k investidos em bancos. Busca analistas independentes pra sair da 'carteirada do gerente'.",
      bg: "from-[#7c5cff] to-[#5b3dd4]",
    },
    mature: {
      emoji: "👨🏻‍🦳",
      name: "Carlos Eduardo Pinho",
      age: 56,
      occupation: "Médico autônomo",
      location: "Belo Horizonte — MG",
      income: "R$ 38k/mês",
      goal: "Preservar patrimônio + viver de dividendos",
      bio: "R$ 1.6M investíveis. Perfil conservador-moderado. Valoriza histórico e analistas reconhecidos — não quer promessa mirabolante.",
      bg: "from-slate-600 to-slate-800",
    },
  },
  female: {
    young: {
      emoji: "👩🏻‍💻",
      name: "Juliana Ribeiro",
      age: 34,
      occupation: "Product manager",
      location: "Curitiba — PR",
      income: "R$ 16k/mês",
      goal: "Independência financeira aos 50 · sair do tesouro",
      bio: "Solteira, mora sozinha. Consome conteúdo financeiro em podcasts. Ainda cautelosa — testa produto gratuito antes de assinar.",
      bg: "from-pink-500 to-rose-600",
    },
    sweet: {
      emoji: "👩🏻‍💼",
      name: "Mariana Castelo",
      age: 45,
      occupation: "Advogada sócia",
      location: "São Paulo — SP",
      income: "R$ 28k/mês",
      goal: "Construir renda passiva pra pausar carreira aos 55",
      bio: "Casada, 1 filho. R$ 680k investidos. Gosta de relatórios diretos e reuniões curtas — não quer aula, quer recomendação clara.",
      bg: "from-fuchsia-500 to-purple-600",
    },
    mature: {
      emoji: "👩🏻‍🦳",
      name: "Helena Nogueira",
      age: 58,
      occupation: "Empresária / ex-executiva",
      location: "Porto Alegre — RS",
      income: "R$ 45k/mês",
      goal: "Viver de dividendos · legado familiar",
      bio: "Viúva, 2 filhos adultos. Patrimônio R$ 2.1M. Prioriza dividendos mensais previsíveis e acompanha 2 analistas há 5+ anos.",
      bg: "from-amber-500 to-orange-600",
    },
  },
};

function PersonaCard({ gender, age, onChangeGender, onChangeAge }: {
  gender: Gender;
  age: AgeBand;
  onChangeGender: (g: Gender) => void;
  onChangeAge: (a: AgeBand) => void;
}) {
  const p = personaPresets[gender][age];
  return (
    <motion.div
      key={`${gender}-${age}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${p.bg} opacity-10`} />
      <div className="relative grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 p-5">
        {/* Avatar */}
        <div className="flex flex-col items-center justify-center">
          <motion.div
            key={p.emoji}
            initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 200 }}
            className={`w-[160px] h-[160px] rounded-full bg-gradient-to-br ${p.bg} flex items-center justify-center shadow-xl shadow-black/10 border-4 border-white`}
          >
            <span className="text-[88px] leading-none select-none">{p.emoji}</span>
          </motion.div>
          <div className="mt-3 text-center">
            <div className="text-lg font-bold text-slate-900">{p.name}</div>
            <div className="text-xs text-slate-500">
              {p.age} anos · {gender === "male" ? "masculino" : "feminino"}
            </div>
          </div>
        </div>

        {/* Info + toggles */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5b3dd4] mb-2">
              Persona gerada pelas regras do ICP
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{p.bio}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white/80 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Ocupação</div>
              <div className="font-semibold text-slate-900">{p.occupation}</div>
            </div>
            <div className="rounded-lg bg-white/80 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Localização</div>
              <div className="font-semibold text-slate-900">{p.location}</div>
            </div>
            <div className="rounded-lg bg-white/80 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Renda</div>
              <div className="font-semibold text-emerald-700">{p.income}</div>
            </div>
            <div className="rounded-lg bg-white/80 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Objetivo</div>
              <div className="font-semibold text-slate-900">{p.goal}</div>
            </div>
          </div>

          {/* Controles */}
          <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {([
                { key: "male", label: "Masculino" },
                { key: "female", label: "Feminino" },
              ] as { key: Gender; label: string }[]).map((g) => (
                <button
                  key={g.key}
                  onClick={() => onChangeGender(g.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                    gender === g.key
                      ? "bg-white text-[#5b3dd4] shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {([
                { key: "young", label: "28–37" },
                { key: "sweet", label: "38–48 (sweet)" },
                { key: "mature", label: "49–60" },
              ] as { key: AgeBand; label: string }[]).map((a) => (
                <button
                  key={a.key}
                  onClick={() => onChangeAge(a.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                    age === a.key
                      ? "bg-white text-[#5b3dd4] shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function IcpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Default respeita a regra: 68% masculino, sweet spot 38–48.
  const [gender, setGender] = useState<Gender>("male");
  const [ageBand, setAgeBand] = useState<AgeBand>("sweet");

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", damping: 24, stiffness: 260 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header gradient */}
            <div className="relative bg-gradient-to-br from-[#7c5cff] via-[#6d4de0] to-[#5b3dd4] p-6 text-white">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
              >
                <X size={16} />
              </button>
              <div className="flex items-start gap-4">
                <motion.div
                  initial={{ rotate: -10, scale: 0.9 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ delay: 0.1, type: "spring" }}
                  className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-lg"
                >
                  <Target size={26} className="text-white" />
                </motion.div>
                <div className="flex-1">
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 }}
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-100"
                  >
                    <Sparkles size={12} /> Ideal Customer Profile
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-2xl font-bold mt-1"
                  >
                    O cliente ideal Suno
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 }}
                    className="text-sm text-purple-100 mt-1 max-w-2xl"
                  >
                    Perfil consolidado a partir de {">"}400k clientes ativos · usado por
                    marketing, produto e comercial para direcionar decisões
                  </motion.p>
                </div>
              </div>

              {/* Mini stats row */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-4 gap-3 mt-5"
              >
                {[
                  { label: "Idade média", value: "42 anos", icon: GraduationCap },
                  { label: "Renda", value: "R$ 18k/mês", icon: DollarSign },
                  { label: "LTV médio", value: "R$ 2.8k", icon: TrendingUp },
                  { label: "Retenção 12m", value: "78%", icon: Heart },
                ].map((s) => {
                  const Icon = s.icon;
                  return (
                    <div
                      key={s.label}
                      className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-purple-100 font-semibold">
                        <Icon size={10} /> {s.label}
                      </div>
                      <div className="text-lg font-bold mt-0.5">{s.value}</div>
                    </div>
                  );
                })}
              </motion.div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
              {/* Persona dinâmica — segue regra gênero + idade do ICP */}
              <PersonaCard
                gender={gender}
                age={ageBand}
                onChangeGender={setGender}
                onChangeAge={setAgeBand}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {icpBlocks.map((block, i) => {
                  const Icon = block.icon;
                  return (
                    <motion.div
                      key={block.title}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35 + i * 0.05 }}
                      className="bg-white rounded-2xl border border-slate-200 p-4 hover:shadow-md hover:border-[#7c5cff]/30 transition"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div
                          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${block.color} flex items-center justify-center text-white shadow-sm`}
                        >
                          <Icon size={16} />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">{block.title}</h3>
                      </div>
                      <ul className="space-y-1.5">
                        {block.items.map((it) => (
                          <li key={it.label} className="text-xs">
                            <span className="text-slate-500 font-medium">{it.label}:</span>{" "}
                            <span className="text-slate-800">{it.value}</span>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  );
                })}
              </div>

              {/* Anti-ICP */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-orange-50 p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-red-900">Anti-ICP · Quem NÃO é cliente ideal</h3>
                    <p className="text-[11px] text-red-700">Sinais de alto churn ou baixa propensão a assinar</p>
                  </div>
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {antiIcp.map((a) => (
                    <li
                      key={a}
                      className="text-xs text-red-900 bg-white/60 border border-red-200/60 rounded-lg px-3 py-1.5 font-medium"
                    >
                      {a}
                    </li>
                  ))}
                </ul>
              </motion.div>

              {/* Ações sugeridas */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.75 }}
                className="rounded-2xl border border-[#c4b5fd]/40 bg-gradient-to-br from-[#ede9fe] to-[#dbeafe] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-[#5b3ed6]" />
                  <h3 className="text-sm font-bold text-[#4c2fc0]">Como usar esse ICP no dia-a-dia</h3>
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-700">
                  <li className="bg-white/70 rounded-lg px-3 py-2">
                    <strong>Marketing:</strong> segmentar campanhas Meta/Google por idade 32–55 + renda + SE/Sul
                  </li>
                  <li className="bg-white/70 rounded-lg px-3 py-2">
                    <strong>Produto:</strong> priorizar features mobile-first (62% da audiência)
                  </li>
                  <li className="bg-white/70 rounded-lg px-3 py-2">
                    <strong>Conteúdo:</strong> foco em dividendos, FIIs, aposentadoria — evitar day-trade
                  </li>
                  <li className="bg-white/70 rounded-lg px-3 py-2">
                    <strong>Comercial:</strong> qualificar leads por renda + histórico em corretora
                  </li>
                </ul>
              </motion.div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 bg-white px-6 py-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                Atualizado trimestralmente · última revisão Q1/2026 · dados consolidados via GA4 + CRM
              </span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-[#7c5cff] text-white font-semibold hover:bg-[#6d4de0] transition"
              >
                Fechar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
