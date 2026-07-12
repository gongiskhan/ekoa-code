/**
 * Artifact type vocabulary (operator-run C1) — the scoping classifier's output,
 * persisted on every built artifact. Only `app` artifacts get the operator
 * assistant surface; `document`/`report` are print-shaped, `presentation` is a
 * deck, `landing` a marketing page. (The same output feeds the security block's
 * permission gate later — NO permission semantics live here.)
 */
import { z } from 'zod';

export const ArtifactType = z.enum(['app', 'document', 'report', 'presentation', 'landing']);
export type ArtifactType = z.infer<typeof ArtifactType>;
