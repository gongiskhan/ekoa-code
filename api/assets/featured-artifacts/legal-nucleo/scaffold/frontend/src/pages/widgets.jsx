/*
 * Widgets e ajudas locais do Núcleo (não são partilhados pela suite - vivem só
 * aqui). Distintivo de prazo (cores por urgência de data), distintivo de estado
 * de processo, e a pesquisa global (clientes + processos) com ligações fundas.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, SearchInput } from '../components/ui.jsx';
import { IconUserCircle, IconFolder } from '../components/Icons.jsx';
import { useSharedCollection, useDebounced, diasRestantes } from '../shared.js';

/*
 * Dobra de texto para pesquisa tolerante a acentos e maiúsculas: remove os
 * diacríticos (NFD + strip) e baixa a caixa. Aplicar a AMBOS os lados da
 * comparação para que "marilia" encontre "Marília".
 */
export function fold(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/* ---------- Vocabulário partilhado pelas páginas ---------- */

export const TIPOS = [
  { value: 'particular', label: 'Particular' },
  { value: 'empresa', label: 'Empresa' },
];

export const ESTADOS = [
  { value: 'ativo', label: 'Ativo', tone: 'ok' },
  { value: 'suspenso', label: 'Suspenso', tone: 'media' },
  { value: 'arquivado', label: 'Arquivado', tone: 'neutral' },
];

export const URGENCIAS = [
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

export const TAREFA_ESTADOS = [
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_curso', label: 'Em curso' },
  { value: 'concluida', label: 'Concluída' },
];

/*
 * Bases de licitude do tratamento de dados pessoais (art. 6.º, n.º 1, do RGPD).
 * Rótulos em PT-PT; os valores são estáveis para persistência.
 */
export const RGPD_BASES = [
  { value: 'consentimento', label: 'Consentimento do titular (al. a)' },
  { value: 'contrato', label: 'Execução de contrato (al. b)' },
  { value: 'obrigacao_legal', label: 'Cumprimento de obrigação legal (al. c)' },
  { value: 'interesses_vitais', label: 'Defesa de interesses vitais (al. d)' },
  { value: 'interesse_publico', label: 'Exercício de funções de interesse público (al. e)' },
  { value: 'interesse_legitimo', label: 'Interesse legítimo do responsável (al. f)' },
];

export function tipoLabel(tipo) {
  const found = TIPOS.find((t) => t.value === tipo);
  return found ? found.label : 'Particular';
}

export function estadoMeta(estado) {
  return ESTADOS.find((e) => e.value === estado) || { value: estado, label: estado || 'Sem estado', tone: 'neutral' };
}

export function rgpdBaseLabel(value) {
  const found = RGPD_BASES.find((b) => b.value === value);
  return found ? found.label : (value || '—');
}

/* Distintivo de estado do processo (usa os tons da suite). */
export function EstadoBadge({ estado, ...rest }) {
  const meta = estadoMeta(estado || 'ativo');
  return <Badge tone={meta.tone} {...rest}>{meta.label}</Badge>;
}

/*
 * Metadados de urgência de um prazo/tarefa a partir da data-limite: bucket
 * (vencido/hoje/semana/tarde), tom de cor e rótulo humano. Comparação só por
 * data (diasRestantes trata a meia-noite local).
 */
export function deadlineMeta(dateStr) {
  const dias = diasRestantes(dateStr);
  if (Number.isNaN(dias)) return { tone: 'neutral', label: 'Sem prazo', bucket: 'sem-data', dias: NaN };
  if (dias < 0) {
    const n = Math.abs(dias);
    return { tone: 'alta', label: `Vencido há ${n} ${n === 1 ? 'dia' : 'dias'}`, bucket: 'vencido', dias };
  }
  if (dias === 0) return { tone: 'media', label: 'Termina hoje', bucket: 'hoje', dias };
  if (dias <= 7) return { tone: 'info', label: dias === 1 ? 'Amanhã' : `Em ${dias} dias`, bucket: 'semana', dias };
  return { tone: 'neutral', label: `Em ${dias} dias`, bucket: 'tarde', dias };
}

/* Distintivo de prazo com a cor da urgência de data. */
export function DeadlineBadge({ date, ...rest }) {
  const meta = deadlineMeta(date);
  return <Badge tone={meta.tone} {...rest}>{meta.label}</Badge>;
}

/* ---------- Pesquisa global (clientes + processos) ---------- */

/*
 * Caixa de pesquisa transversal ao Núcleo: filtra clientes e processos do lado
 * do cliente (com atraso) e mostra um menu de resultados com ligações fundas
 * para /clientes/:id e /processos/:id. Fecha ao clicar fora ou com Escape.
 */
export function GlobalSearch({ placeholder = 'Pesquisar clientes e processos…' }) {
  const navigate = useNavigate();
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const debounced = useDebounced(query, 180);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const results = useMemo(() => {
    const term = fold(debounced.trim());
    if (!term) return [];
    const nomePorId = new Map(clientes.map((c) => [c.id, c.nome]));
    const cli = clientes
      .filter((c) => !c.arquivado)
      .filter((c) => (
        fold(c.nome).includes(term) ||
        fold(c.nif).includes(term) ||
        fold(c.email).includes(term)
      ))
      .slice(0, 6)
      .map((c) => ({
        kind: 'cliente',
        id: c.id,
        primary: c.nome || 'Sem nome',
        secondary: c.nif ? `NIF ${c.nif}` : (c.email || ''),
        to: `/clientes/${c.id}`,
      }));
    const prc = processos
      .filter((p) => (
        fold(p.numeroProcesso).includes(term) ||
        fold(p.tribunal).includes(term) ||
        fold(p.area).includes(term) ||
        fold(nomePorId.get(p.clienteId)).includes(term)
      ))
      .slice(0, 6)
      .map((p) => ({
        kind: 'processo',
        id: p.id,
        primary: p.numeroProcesso || 'Sem número',
        secondary: [nomePorId.get(p.clienteId), p.tribunal].filter(Boolean).join(' · '),
        to: `/processos/${p.id}`,
      }));
    return [...cli, ...prc];
  }, [debounced, clientes, processos]);

  const go = (to) => { setOpen(false); setQuery(''); navigate(to); };
  const term = debounced.trim();

  return (
    <div className="global-search" ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 460 }}>
      <SearchInput
        value={query}
        onChange={(v) => { setQuery(v); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        data-testid="global-search"
        aria-label="Pesquisa global"
      />
      {open && term ? (
        <div
          className="card"
          data-testid="global-search-menu"
          role="listbox"
          style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 40, padding: 0, maxHeight: 360, overflowY: 'auto' }}
        >
          {results.length === 0 ? (
            <div className="text-small text-subtle" style={{ padding: 'var(--sp-4, 1rem)' }}>
              Sem resultados para "{term}".
            </div>
          ) : (
            results.map((r) => (
              <button
                key={`${r.kind}-${r.id}`}
                type="button"
                role="option"
                data-testid="global-search-result"
                onClick={() => go(r.to)}
                style={{
                  display: 'flex', width: '100%', textAlign: 'left', gap: 'var(--sp-3, 0.75rem)',
                  alignItems: 'center', padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                  background: 'transparent', border: 0, borderTop: '1px solid var(--color-border)',
                }}
              >
                <span className="row-icon" aria-hidden="true">{r.kind === 'cliente' ? <IconUserCircle /> : <IconFolder />}</span>
                <span className="stack stack-1" style={{ minWidth: 0 }}>
                  <span className="text-strong">{r.primary}</span>
                  <span className="text-xs text-subtle">
                    {r.kind === 'cliente' ? 'Cliente' : 'Processo'}{r.secondary ? ` · ${r.secondary}` : ''}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
