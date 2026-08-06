/* Hooks de dados partilhados pelas páginas. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { listar, listarPartilhada } from './ekoa.js';

/** Leitura reativa de uma coleção POR-APP com refresh manual. */
export function useColecao(nome) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listar(nome));
    } catch (err) {
      setError(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [nome]);
  useEffect(() => { refresh(); }, [refresh]);
  return { items, loading, error, refresh };
}

/** Leitura da coleção PARTILHADA (espinha da conta). */
export function useColecaoPartilhada(nome) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listarPartilhada(nome));
    } finally {
      setLoading(false);
    }
  }, [nome]);
  useEffect(() => { refresh(); }, [refresh]);
  return { items, loading, refresh };
}

/** A base COMUM de clientes do espaço de trabalho (partilhada; só leitura). */
export function useClientes() {
  return useColecaoPartilhada('clientes');
}

/* Definições da app (linha única) - carregadas no arranque pelo App e
 * partilhadas por contexto. */
export const DefinicoesContext = createContext({
  definicoes: null,
  atualizarDefinicoes: async () => {},
  recarregarDefinicoes: async () => {},
});

export function useDefinicoes() {
  return useContext(DefinicoesContext);
}

/** Debounce simples para caixas de pesquisa. */
export function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}
