import { useCallback, useEffect, useState } from 'react';
import { listAll } from './api';

export function useData(collection) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAll(collection);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [collection]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, loading, error, reload, setItems };
}

export function useAllData(collections) {
  const key = collections.join('|');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(collections.map((c) => listAll(c).catch(() => [])));
      const next = {};
      collections.forEach((c, i) => {
        next[c] = Array.isArray(results[i]) ? results[i] : [];
      });
      setData(next);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
