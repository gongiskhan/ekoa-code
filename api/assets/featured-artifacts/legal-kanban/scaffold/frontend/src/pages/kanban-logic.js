/*
 * Lógica pura do Quadro de Tarefas - sem React, sem I/O. Testável a olho e
 * partilhada pelas duas páginas. A regra de arquitectura VINCULATIVA vive aqui:
 *
 *   - `tarefas.estado` é CANÓNICO (o Núcleo também o mostra). Os campos
 *     `kanbanColuna`/`kanbanOrdem` são de APRESENTAÇÃO e escritos SÓ por este app.
 *   - Um cartão SEM `kanbanColuna` renderiza na coluna cujo `estadoMap` coincide
 *     com o seu estado.
 *   - Uma coluna com `estadoMap` a null (ex.: "Em revisão") é uma coluna de pura
 *     apresentação: honra-se sempre o `kanbanColuna`, sem tocar no estado.
 *   - Uma coluna com `estadoMap` não-nulo só "fixa" o cartão enquanto o estado
 *     canónico continuar coerente; se o estado mudar noutro app, o cartão volta a
 *     ser colocado pelo estado (o quadro nunca mente sobre o estado real).
 */

import { diasRestantes } from '../shared.js';

/*
 * Quadro por omissão, EM MEMÓRIA, para quando ainda não existe nenhuma linha em
 * `kanban_boards`. Espelha a sementeira do Núcleo. NUNCA se persiste sem o
 * utilizador o pedir - é só a vista de arranque.
 */
export const DEFAULT_BOARD = {
  id: '__default__',
  nome: 'Quadro geral',
  colunas: [
    { id: 'aberta', nome: 'Por fazer', cor: 'neutral', estadoMap: 'aberta' },
    { id: 'em_curso', nome: 'Em curso', cor: 'accent', estadoMap: 'em_curso' },
    { id: 'revisao', nome: 'Em revisão', cor: 'warn', estadoMap: null },
    { id: 'concluida', nome: 'Concluído', cor: 'ok', estadoMap: 'concluida' },
  ],
};

/* Estados canónicos da tarefa (para o mapeamento de coluna e o editor de quadros). */
export const ESTADO_MAP_OPTIONS = [
  { value: '', label: 'Sem estado (só apresentação)' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_curso', label: 'Em curso' },
  { value: 'concluida', label: 'Concluída' },
];

/* Cores de coluna -> tom do distintivo partilhado (badge-*). */
export const COR_OPTIONS = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'accent', label: 'Destaque' },
  { value: 'warn', label: 'Aviso' },
  { value: 'ok', label: 'Concluído' },
  { value: 'alta', label: 'Urgente' },
  { value: 'info', label: 'Informação' },
];

const COR_TONE = {
  neutral: 'neutral',
  accent: 'info',
  warn: 'media',
  ok: 'ok',
  alta: 'alta',
  info: 'info',
  media: 'media',
  baixa: 'baixa',
};

export function corToTone(cor) {
  return COR_TONE[cor] || 'neutral';
}

/*
 * Resolve em que coluna um cartão deve aparecer, dado o conjunto de colunas.
 * Aplica a regra vinculativa acima. Devolve o id da coluna (ou o da primeira,
 * como último recurso, para nunca perder um cartão fora do quadro).
 */
export function columnIdFor(tarefa, colunas) {
  if (!Array.isArray(colunas) || colunas.length === 0) return null;
  const pinned = tarefa.kanbanColuna
    ? colunas.find((c) => c.id === tarefa.kanbanColuna)
    : null;
  if (pinned) {
    // Coluna de apresentação (sem estado): honra-se sempre.
    if (pinned.estadoMap == null) return pinned.id;
    // Coluna mapeada a estado: só se o estado canónico continuar coerente.
    if (pinned.estadoMap === tarefa.estado) return pinned.id;
  }
  const byEstado = colunas.find((c) => c.estadoMap === tarefa.estado);
  return (byEstado || colunas[0]).id;
}

/* Comparador de prazo: vencidos primeiro, depois por dias restantes; sem prazo no fim. */
function byPrazo(a, b) {
  const da = diasRestantes(a.prazo);
  const db = diasRestantes(b.prazo);
  const na = Number.isNaN(da) ? Infinity : da;
  const nb = Number.isNaN(db) ? Infinity : db;
  if (na !== nb) return na - nb;
  return String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt');
}

/*
 * Cartões de uma coluna, pela ordem de apresentação: primeiro os que o
 * utilizador arrumou nesta coluna (kanbanColuna === col.id, por kanbanOrdem),
 * depois os colocados automaticamente pelo estado (por prazo).
 */
export function columnCards(colId, tarefas, colunas) {
  const inCol = tarefas.filter((t) => columnIdFor(t, colunas) === colId);
  const isArranged = (t) => t.kanbanColuna === colId && Number.isFinite(t.kanbanOrdem);
  const arranged = inCol.filter(isArranged).sort((a, b) => a.kanbanOrdem - b.kanbanOrdem);
  const auto = inCol.filter((t) => !isArranged(t)).sort(byPrazo);
  return [...arranged, ...auto];
}

/*
 * Constrói o patch de movimento de um cartão para `col`, aplicando a regra:
 *   - escreve sempre kanbanColuna + kanbanOrdem (apresentação);
 *   - se a coluna mapeia um estado (estadoMap != null), sincroniza o estado
 *     canónico e carimba/limpa `concluidaEm` ao entrar/sair de 'concluida'.
 */
export function movePatch(tarefa, col, ordem) {
  const patch = { kanbanColuna: col.id, kanbanOrdem: ordem };
  if (col.estadoMap != null) {
    patch.estado = col.estadoMap;
    if (col.estadoMap === 'concluida') {
      patch.concluidaEm = new Date().toISOString();
    } else if (tarefa.estado === 'concluida') {
      patch.concluidaEm = null;
    }
  }
  return patch;
}

/*
 * Sequência de escritas para largar `tarefa` na coluna `col`, opcionalmente antes
 * do cartão `beforeId`. Só re-numera os cartões JÁ arrumados nesta coluna (os que
 * têm kanbanColuna === col.id) - nunca toca nos cartões colocados automaticamente
 * pelo estado, para não poluir a espinha semeada. Devolve um array de
 * `{ id, patch }` a persistir.
 */
export function planDrop(tarefa, col, tarefas, beforeId) {
  const arranged = tarefas
    .filter((t) => t.kanbanColuna === col.id && t.id !== tarefa.id)
    .sort((a, b) => (a.kanbanOrdem ?? 0) - (b.kanbanOrdem ?? 0));

  let insertAt = arranged.length;
  if (beforeId) {
    const i = arranged.findIndex((t) => t.id === beforeId);
    if (i >= 0) insertAt = i;
  }

  const next = [...arranged];
  next.splice(insertAt, 0, tarefa);

  const writes = [];
  next.forEach((c, i) => {
    if (c.id === tarefa.id) {
      writes.push({ id: c.id, patch: movePatch(tarefa, col, i) });
    } else if (c.kanbanOrdem !== i) {
      writes.push({ id: c.id, patch: { kanbanOrdem: i } });
    }
  });
  return writes;
}
