/* Auxiliares de acesso ao JsonStore via window.__ekoa.fetch(). */

import { useCallback, useEffect, useState } from 'react';

const PREFIX = '/api/app-data';

function ekoaFetch(input, init) {
  if (typeof window !== 'undefined' && window.__ekoa && typeof window.__ekoa.fetch === 'function') {
    return window.__ekoa.fetch(input, init);
  }
  return fetch(input, init);
}

export function useCollection(name) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ekoaFetch(`${PREFIX}/${name}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setItems(Array.isArray(body) ? body : []);
    } catch (err) {
      setError(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, loading, error, refresh };
}

export async function createItem(collection, payload) {
  const res = await ekoaFetch(`${PREFIX}/${collection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Falha ao criar registo (HTTP ${res.status}).`);
  return res.json();
}

export async function updateItem(collection, id, patch) {
  const res = await ekoaFetch(`${PREFIX}/${collection}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Falha ao actualizar registo (HTTP ${res.status}).`);
  return res.json();
}

export async function deleteItem(collection, id) {
  const res = await ekoaFetch(`${PREFIX}/${collection}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Falha ao remover registo (HTTP ${res.status}).`);
  return true;
}

/* Formatação numérica e de datas em PT-PT. */

const currencyFormatter = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const integerFormatter = new Intl.NumberFormat('pt-PT');

export function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return currencyFormatter.format(Number(value));
}

export function formatInteger(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return integerFormatter.format(Number(value));
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function formatDateTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}
