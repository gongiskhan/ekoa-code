/*
 * Abertura rápida do Núcleo (Ctrl+K / Cmd+K) - paleta de pesquisa app-local
 * sobre clientes e processos da espinha partilhada, com navegação por teclado
 * (setas + Enter) e ligações fundas para /clientes/:id e /processos/:id.
 *
 * Vive FORA da camada partilhada (widgets/pages são locais ao Núcleo). Reutiliza
 * a mesma dobra de acentos (fold) da pesquisa global para que "marilia" encontre
 * "Marília". O atalho usa SEMPRE modificador (Ctrl/Cmd), pelo que nunca rouba
 * teclas a quem está a escrever num campo de texto.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, useDebounced } from '../shared.js';
import { SearchInput } from '../components/ui.jsx';
import { IconUserCircle, IconFolder } from '../components/Icons.jsx';
import { fold } from './widgets.jsx';

const MAX_POR_TIPO = 6;

export default function QuickOpen() {
  const navigate = useNavigate();
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebounced(query, 120);

  // Atalho global: Ctrl+K / Cmd+K abre (e alterna); Escape fecha.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ao abrir: limpa a pesquisa anterior (a caixa foca-se por autoFocus, porque
  // o SearchInput partilhado não encaminha refs).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
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
      .slice(0, MAX_POR_TIPO)
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
      .slice(0, MAX_POR_TIPO)
      .map((p) => ({
        kind: 'processo',
        id: p.id,
        primary: p.numeroProcesso || 'Sem número',
        secondary: [nomePorId.get(p.clienteId), p.tribunal].filter(Boolean).join(' · '),
        to: `/processos/${p.id}`,
      }));
    return [...cli, ...prc];
  }, [debounced, clientes, processos]);

  // O índice activo nunca aponta para fora da lista corrente.
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results]);

  const go = (to) => {
    setOpen(false);
    navigate(to);
  };

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const alvo = results[activeIndex];
      if (alvo) go(alvo.to);
    }
  };

  if (!open) return null;

  const term = debounced.trim();

  return (
    <div
      data-testid="quick-open-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        className="card"
        data-testid="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Abertura rápida"
        style={{ width: 'min(560px, 92vw)', padding: 'var(--sp-3, 0.75rem)', boxShadow: 'var(--shadow-2, 0 10px 30px rgba(0,0,0,0.2))' }}
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          onKeyDown={onInputKeyDown}
          placeholder="Ir para cliente ou processo…"
          data-testid="quick-open-input"
          aria-label="Abertura rápida: pesquisar clientes e processos"
          autoFocus
        />
        <div
          role="listbox"
          aria-label="Resultados da abertura rápida"
          style={{ marginTop: 'var(--sp-2, 0.5rem)', maxHeight: 340, overflowY: 'auto' }}
        >
          {!term ? (
            <p className="text-small text-subtle" data-testid="quick-open-hint" style={{ margin: 0, padding: 'var(--sp-3, 0.75rem)' }}>
              Escreva para pesquisar clientes e processos. Setas para navegar, Enter para abrir, Esc para fechar.
            </p>
          ) : results.length === 0 ? (
            <p className="text-small text-subtle" data-testid="quick-open-vazio" style={{ margin: 0, padding: 'var(--sp-3, 0.75rem)' }}>
              Sem resultados para "{term}".
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.kind}-${r.id}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                data-testid="quick-open-result"
                data-kind={r.kind}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => go(r.to)}
                style={{
                  display: 'flex', width: '100%', textAlign: 'left', gap: 'var(--sp-3, 0.75rem)',
                  alignItems: 'center', padding: 'var(--sp-3, 0.75rem)',
                  background: i === activeIndex ? 'var(--accent-weak, #eaeff4)' : 'transparent',
                  border: 0, borderRadius: 'var(--r-1, 0.375rem)', cursor: 'pointer',
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
      </div>
    </div>
  );
}
