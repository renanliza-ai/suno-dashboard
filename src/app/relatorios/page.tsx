import { redirect } from "next/navigation";

// Redirecionamento permanente: /relatorios foi renomeado para /midia em maio/2026
// para refletir melhor o conteúdo (campanhas pagas, ROAS, atribuição).
// Mantemos o redirect pra não quebrar bookmarks/links antigos.
export default function RelatoriosRedirect() {
  redirect("/midia");
}
