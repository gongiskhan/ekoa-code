import { describe, it, expect } from 'vitest';
import { isUserScopedSkill, type IntegrationSkillScoped } from '@/stores/integrations';

/**
 * `isUserScopedSkill` decides which tab an integration appears in on /integrations:
 * true -> "Minhas Integrações", false -> "Integrações da Plataforma".
 *
 * WHY THIS SUITE EXISTS. The predicate tested only the LEGACY disk-runtime `scope`
 * ('user:<id>'), which no longer appears on any payload the API returns: authored definitions
 * moved into the tenant-scoped store, and that projection emits `userCreated`/`visibility`/`id`
 * and never a `scope`. The predicate was therefore always false, with two user-visible effects
 * found by driving the real dashboard against a real integration:
 *
 *   1. "Minhas Integrações" showed its empty state ("Ainda não há integrações") even with a
 *      connected, working, user-built integration in the account;
 *   2. that private integration was rendered in "Integrações da Plataforma" - a tenant's own
 *      row labelled as something the platform ships.
 *
 * The fixtures below are the REAL shapes `GET /api/v1/integrations` returned for a shipped
 * package and for a builder-created one, so this cannot pass against an invented contract.
 */

const shipped = {
  key: 'slack',
  integrationKey: 'slack',
  displayName: 'Slack',
  userCreated: false,
} as unknown as IntegrationSkillScoped;

const authored = {
  id: '5a31be40e9d8f318b39a8863d7581e5dc24117cb3d61ce05bd375ca045a2e406',
  key: 'ntfy',
  integrationKey: 'ntfy',
  displayName: 'ntfy',
  visibility: 'private',
  userCreated: true,
} as unknown as IntegrationSkillScoped;

describe('isUserScopedSkill', () => {
  it('a builder-created definition is user-scoped, on `userCreated` alone', () => {
    // The regression: this object carries NO `scope`, because the current projection never emits
    // one. Before the fix it read as a platform integration.
    expect(authored.scope).toBeUndefined();
    expect(isUserScopedSkill(authored)).toBe(true);
  });

  it('a shipped package is NOT user-scoped', () => {
    expect(isUserScopedSkill(shipped)).toBe(false);
  });

  it('the LEGACY `scope` shape still works, so a list-skills payload keeps rendering', () => {
    expect(isUserScopedSkill({ ...shipped, scope: 'user:abc123' })).toBe(true);
    expect(isUserScopedSkill({ ...shipped, scope: 'global' })).toBe(false);
  });

  it('an absent `userCreated` is not treated as user-created', () => {
    // Fail closed towards "platform": a payload that says nothing must not silently move a
    // shipped package into the tenant's own tab.
    const { userCreated: _omitted, ...noFlag } = shipped as Record<string, unknown>;
    expect(isUserScopedSkill(noFlag as IntegrationSkillScoped)).toBe(false);
  });
});
