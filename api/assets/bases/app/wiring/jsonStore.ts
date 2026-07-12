/**
 * Persistence wiring for the `app` base.
 *
 * Thin wrapper around the per-app JsonStore reachable at /api/app-data/.
 * Use one collection per logical noun. Documents auto-generate id/createdAt/updatedAt.
 */

type AnyRecord = Record<string, unknown>;

function ekoaFetch(): typeof fetch {
  if (typeof window === 'undefined') throw new Error('jsonStore can only run in a browser app');
  return window.__ekoa?.fetch ?? window.fetch.bind(window);
}

// The app-data API wraps every payload in `{ success, data }`. Unwrap to `data`
// so callers get the raw record(s), matching the injected
// `window.__ekoa.list/get/create/update/delete` helpers.
async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as { success?: boolean; data?: unknown; error?: string };
  if (!res.ok) throw new Error(json?.error || `Request failed: ${res.status}`);
  return json?.data as T;
}

export async function list<T extends AnyRecord = AnyRecord>(collection: string): Promise<T[]> {
  const res = await ekoaFetch()(`/api/app-data/${encodeURIComponent(collection)}`);
  const data = await unwrap<T[]>(res);
  return Array.isArray(data) ? data : [];
}

export async function get<T extends AnyRecord = AnyRecord>(collection: string, id: string): Promise<T | null> {
  const res = await ekoaFetch()(`/api/app-data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  return unwrap<T>(res);
}

export async function create<T extends AnyRecord = AnyRecord>(collection: string, data: AnyRecord): Promise<T> {
  const res = await ekoaFetch()(`/api/app-data/${encodeURIComponent(collection)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return unwrap<T>(res);
}

// The server registers PUT (shallow-merge) for updates - not PATCH.
export async function update<T extends AnyRecord = AnyRecord>(collection: string, id: string, patch: AnyRecord): Promise<T> {
  const res = await ekoaFetch()(`/api/app-data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<T>(res);
}

export async function remove(collection: string, id: string): Promise<void> {
  const res = await ekoaFetch()(`/api/app-data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) throw new Error(`remove ${collection}/${id} -> ${res.status}`);
}
