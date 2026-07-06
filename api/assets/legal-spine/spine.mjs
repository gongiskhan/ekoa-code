/**
 * Legal Edition — the SHARED SPINE contract (v1).
 *
 * The pack's apps (Núcleo, Prazos, Caixa Citius, Honorários, …) are separate
 * artifacts that all read/write these collections in the ACCOUNT-SHARED
 * namespace (window.__ekoa.shared.* / ekoa.appData.shared.*). Because they are
 * built independently, the collection shapes are ONE versioned contract every
 * app honours — this module is copied into each app's scaffold and is the single
 * source of truth. Pure data + helpers, no I/O, no framework.
 *
 * Portugal conventions (NOT Brazil): NIF (não CPF), tribunal/comarca,
 * numeroProcesso, área, estado. Strings PT-PT.
 */

/** The seven shared spine collections, in dependency order (parents first). */
export const SPINE_COLLECTIONS = [
  'clientes',
  'processos',
  'prazos',
  'documentos',
  'eventos',
  'lancamentos',
  'tarefas',
];

/**
 * Field shapes (documentation; the store is schemaless). Required fields beyond
 * the platform-assigned id/createdAt/updatedAt are marked with `*`.
 *   clientes:    nome*, nif?, email?, telefone?, morada?, tipo?(particular|empresa), notas?
 *   processos:   clienteId* (FK), numeroProcesso?, tribunal?, comarca?, area?, estado?(ativo|arquivado|suspenso), advogadoResponsavel?, descricao?
 *   prazos:      processoId* (FK), titulo*, dataNotificacao?, regraAplicada?, dataLimite?, tipoContagem?(uteis|corridos), estado?(pendente|cumprido|expirado), responsavel?, showWork?
 *   documentos:  processoId* (FK), nome*, tipo?, url?, contentRef?
 *   eventos:     processoId* (FK), tipo*, titulo*, descricao?, data*, origem?, metadata?
 *   lancamentos: processoId* (FK), clienteId?, descricao*, horas?, valor?, taxaHora?, data*, faturado?  (NOTE: pré-faturas only — no AT fatura field)
 *   tarefas:     processoId? (FK, optional — standalone tasks allowed), titulo*, descricao?, estado?(aberta|concluida), responsavel?, dataLimite?
 */

/** Foreign keys: child collection -> [{ field, parent, optional? }]. */
export const SPINE_FKS = {
  processos: [{ field: 'clienteId', parent: 'clientes' }],
  prazos: [{ field: 'processoId', parent: 'processos' }],
  documentos: [{ field: 'processoId', parent: 'processos' }],
  eventos: [{ field: 'processoId', parent: 'processos' }],
  lancamentos: [{ field: 'processoId', parent: 'processos' }],
  tarefas: [{ field: 'processoId', parent: 'processos', optional: true }],
};

/**
 * Every spine collection lives in the SHARED namespace. An app's own private
 * UI state / drafts stay in its per-app data (window.__ekoa.*), never here.
 */
export const SHARED_COLLECTIONS = new Set(SPINE_COLLECTIONS);

/**
 * The seeding rule: only the Núcleo seeds the spine, and only when it is empty.
 * Satellites pass seedOnEmpty:false and never seed — they read what the Núcleo
 * wrote (or show empty until it has).
 */
export function shouldSeed(existingCount, seedOnEmpty) {
  return seedOnEmpty === true && existingCount === 0;
}

/**
 * Validate FK coherence + array shape of a seed dataset (the canonical seed, or
 * any candidate). Every non-optional child FK must reference an existing parent
 * row id within the same dataset. Returns { ok, errors }.
 */
export function validateSeed(seed) {
  const errors = [];
  const data = seed && typeof seed === 'object' ? seed : {};
  for (const col of SPINE_COLLECTIONS) {
    if (data[col] !== undefined && !Array.isArray(data[col])) {
      errors.push(`${col} must be an array`);
    }
  }
  for (const [child, fks] of Object.entries(SPINE_FKS)) {
    const rows = Array.isArray(data[child]) ? data[child] : [];
    for (const fk of fks) {
      const parentIds = new Set((Array.isArray(data[fk.parent]) ? data[fk.parent] : []).map((r) => r && r.id));
      for (const row of rows) {
        const v = row ? row[fk.field] : undefined;
        if (v == null) {
          if (!fk.optional) errors.push(`${child}.${row && row.id}: missing required FK ${fk.field}`);
          continue;
        }
        if (!parentIds.has(v)) errors.push(`${child}.${row.id}: FK ${fk.field}="${v}" references no ${fk.parent}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
