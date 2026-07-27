/**
 * cofre/store.ts — the Cofre's repositories, reachable ONLY through this module.
 *
 * `FIXED-14` claims "a repository layer that cannot express an unscoped query". The discovery gate
 * found that claim is weaker than the docs say: the scoped classes are instantiated in a couple of
 * modules, `OrgScoped` is used by none, and at least one module re-implements the scoping predicate
 * by hand. The Cofre is the module that makes the claim true — items and grants are owner-scoped
 * structurally, and nothing outside `api/src/cofre/` may reach the raw store handles.
 *
 * Credentials are OWNER-scoped, not org-visible. A credential is not a document: there is no
 * "shared with the org" state to opt into by accident, so the visibility field is fixed private and
 * an org-admin cannot read another user's credential. (Existence may still surface in Registo
 * metadata, which is ids-only.)
 */
import { Store, type Doc } from '../data/store.js';
import { OwnerVisibilityScoped } from '../data/scoped.js';
import type { CofreItemDoc, CofreGrantDoc } from './types.js';

const itemsStore = new Store<Doc>('cofre_items');
const grantsStore = new Store<Doc>('cofre_grants');

/** Items, owner-scoped. Reads go through `getVisible`/`listVisible`; there is no unscoped path. */
export const cofreItems = new OwnerVisibilityScoped<CofreItemDoc>(itemsStore as never);

/** Grants, owner-scoped by the same rule — a grant is as sensitive as the item it opens. */
export const cofreGrants = new OwnerVisibilityScoped<CofreGrantDoc>(grantsStore as never);
