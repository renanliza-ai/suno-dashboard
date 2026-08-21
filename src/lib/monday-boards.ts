/**
 * Quadros do Monday usados pelo painel.
 *
 * O id do quadro nao e segredo, ele aparece na URL para qualquer pessoa com
 * acesso. Fica em constante nomeada aqui, e nao espalhado em componente, para
 * existir um lugar unico quando o quadro mudar.
 *
 * Sobrescrever em producao pela variavel MONDAY_CRO_BOARD_ID no servidor,
 * quando quiser trocar de quadro sem novo deploy.
 */

/**
 * Tracker de testes. Destino de toda proposta de CRO aceita no painel.
 * https://suno.monday.com/boards/18407955812
 *
 * Definido pelo Renan em 21/08/2026. Antes disso tudo caia no board padrao do
 * MONDAY_BOARD_ID, junto com alerta de varredura de saude, e o time perdia a
 * tarefa de teste no meio do resto.
 */
export const MONDAY_BOARD_TRACKER_TESTES = "18407955812";
