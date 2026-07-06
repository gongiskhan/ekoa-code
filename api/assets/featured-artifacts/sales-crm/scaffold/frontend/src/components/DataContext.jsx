import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ekoaFetch = (typeof window !== 'undefined' && window.__ekoa && window.__ekoa.fetch)
  ? window.__ekoa.fetch
  : (input, init) => fetch(input, init);

const DataContext = createContext(null);

async function fetchCollection(collection) {
  try {
    const response = await ekoaFetch('/api/app-data/' + collection, { method: 'GET' });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  } catch (err) {
    console.warn('Falha a obter ' + collection, err);
    return [];
  }
}

async function createItem(collection, payload) {
  const response = await ekoaFetch('/api/app-data/' + collection, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Não foi possível guardar o registo.');
  return response.json();
}

async function patchItem(collection, id, patch) {
  const response = await ekoaFetch('/api/app-data/' + collection + '/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Não foi possível atualizar o registo.');
  return response.json();
}

async function deleteItem(collection, id) {
  const response = await ekoaFetch('/api/app-data/' + collection + '/' + id, { method: 'DELETE' });
  if (!response.ok) throw new Error('Não foi possível remover o registo.');
}

export function DataProvider({ children }) {
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, d, a] = await Promise.all([
        fetchCollection('contacts'),
        fetchCollection('deals'),
        fetchCollection('activities'),
      ]);
      setContacts(c);
      setDeals(d);
      setActivities(a);
    } catch (err) {
      setError(err && err.message ? err.message : 'Ocorreu um erro a carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addContact = useCallback(async (payload) => {
    const created = await createItem('contacts', payload);
    setContacts((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateContact = useCallback(async (id, patch) => {
    const updated = await patchItem('contacts', id, patch);
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
    return updated;
  }, []);

  const removeContact = useCallback(async (id) => {
    await deleteItem('contacts', id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addDeal = useCallback(async (payload) => {
    const created = await createItem('deals', payload);
    setDeals((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateDeal = useCallback(async (id, patch) => {
    const updated = await patchItem('deals', id, patch);
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    return updated;
  }, []);

  const removeDeal = useCallback(async (id) => {
    await deleteItem('deals', id);
    setDeals((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const addActivity = useCallback(async (payload) => {
    const created = await createItem('activities', payload);
    setActivities((prev) => [created, ...prev]);
    return created;
  }, []);

  const value = {
    contacts,
    deals,
    activities,
    loading,
    error,
    refresh,
    addContact,
    updateContact,
    removeContact,
    addDeal,
    updateDeal,
    removeDeal,
    addActivity,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData deve ser utilizado dentro de DataProvider.');
  return ctx;
}

export const STAGES = [
  { id: 'lead', label: 'Contacto inicial', tone: 'tone-info' },
  { id: 'qualified', label: 'Qualificado', tone: 'tone-accent' },
  { id: 'proposal', label: 'Proposta', tone: 'tone-warning' },
  { id: 'negotiation', label: 'Negociação', tone: 'tone-primary' },
  { id: 'won', label: 'Ganho', tone: 'tone-success' },
  { id: 'lost', label: 'Perdido', tone: 'tone-danger' },
];

export function stageMeta(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

export function formatCurrency(value, currency) {
  const amount = typeof value === 'number' ? value : Number(value) || 0;
  const cur = currency || 'EUR';
  try {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amount);
  } catch (err) {
    return amount.toFixed(0) + ' ' + cur;
  }
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  } catch (err) {
    return String(value);
  }
}

export function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch (err) {
    return String(value);
  }
}
