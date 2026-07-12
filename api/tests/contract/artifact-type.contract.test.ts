import { describe, it, expect } from 'vitest';
import { ArtifactType } from '@ekoa/shared';

/** operator-run C1 — the shared ArtifactType vocabulary (scoping classifier output,
 *  persisted on every built artifact; only 'app' gets the operator surface). */

describe('ArtifactType contract (C1)', () => {
  it('is exactly the five-type closed vocabulary', () => {
    expect(ArtifactType.options).toEqual(['app', 'document', 'report', 'presentation', 'landing']);
  });

  it('rejects anything outside the vocabulary', () => {
    for (const bad of ['App', 'apps', 'site', '', 'builder']) {
      expect(ArtifactType.safeParse(bad).success, bad).toBe(false);
    }
  });
});
