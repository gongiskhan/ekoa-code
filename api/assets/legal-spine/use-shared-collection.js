/**
 * useSharedCollection — React hook over the ACCOUNT-SHARED namespace
 * (window.__ekoa.shared.*), the spine's client data layer. Parallel to the
 * ERP's per-app useCollection, but every app in the pack reads/writes the SAME
 * owner-scoped collections, so they share one Cliente→Processo spine.
 *
 * Seeding rule: ONLY the Núcleo passes { seedOnEmpty: true } (seeds the spine
 * once, when empty); satellites pass { seedOnEmpty: false } and never seed.
 *
 * React (useState/useEffect/useCallback) is expected on globalThis — the same
 * convention the artifact scaffold uses (globals.js). This file is copied into
 * each pack app's scaffold.
 */

const _seeding = {}; // collection -> in-flight seed promise (one pass per session)

function sharedHandle() {
  return (typeof window !== 'undefined' && window.__ekoa && window.__ekoa.shared)
    ? window.__ekoa.shared
    : null;
}

export function useSharedCollection(name, options) {
  options = options || {};
  const seed = Array.isArray(options.seed) ? options.seed : [];
  const seedOnEmpty = options.seedOnEmpty === true;
  const [rows, setRows] = useState(null); // null = loading

  const reload = useCallback(async () => {
    const h = sharedHandle();
    if (!h) { setRows([]); return; }
    // CRITICAL: seed ONLY after a SUCCESSFUL read proves the collection is empty.
    // A transient list() failure must NOT be treated as "empty" — otherwise the
    // Núcleo would re-seed the canonical data into an already-populated shared
    // spine on a mere network blip (duplicate rows). On read failure we show
    // empty and bail; the next reload retries without ever seeding blindly.
    let list;
    try {
      list = await h.list(name);
    } catch (_e) {
      setRows([]);
      return;
    }
    if (seedOnEmpty && (!list || list.length === 0) && seed.length) {
      if (!_seeding[name]) {
        _seeding[name] = (async () => {
          for (const row of seed) { await h.create(name, row); }
        })();
      }
      try { await _seeding[name]; } catch (_e) { /* surfaced on next reload */ }
      try { list = await h.list(name); } catch (_e) { list = []; }
    }
    setRows(list || []);
  }, [name, seedOnEmpty]);

  useEffect(() => { reload(); }, [reload]);

  return {
    rows: rows || [],
    loading: rows === null,
    reload,
    create: async (data) => { const h = sharedHandle(); const r = await h.create(name, data); await reload(); return r; },
    update: async (id, patch) => { const h = sharedHandle(); const r = await h.update(name, id, patch); await reload(); return r; },
    remove: async (id) => { const h = sharedHandle(); await h.delete(name, id); await reload(); },
  };
}
