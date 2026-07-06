/**
 * Thin wrapper around window.__ekoa.fetch() for app-data persistence.
 */

function ekoaFetch(path, init) {
  if (typeof window === 'undefined' || !window.__ekoa || typeof window.__ekoa.fetch !== 'function') {
    return Promise.reject(new Error('Ekoa runtime not available'));
  }
  return window.__ekoa.fetch(path, init);
}

export async function listAll(collection) {
  const res = await ekoaFetch('/api/app-data/' + collection);
  if (!res.ok) throw new Error('Falha ao carregar ' + collection);
  return res.json();
}

export async function createItem(collection, body) {
  const res = await ekoaFetch('/api/app-data/' + collection, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Falha ao criar registo');
  return res.json();
}

export async function updateItem(collection, id, patch) {
  const res = await ekoaFetch('/api/app-data/' + collection + '/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Falha ao actualizar registo');
  return res.json();
}

export async function deleteItem(collection, id) {
  const res = await ekoaFetch('/api/app-data/' + collection + '/' + id, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Falha ao remover registo');
  return true;
}
