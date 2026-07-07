import type { VerticalProfile } from './index';

/**
 * The generic (default) profile is intentionally empty. Every field is absent,
 * so `useVerticalProfile()`'s `profile ?? locale` merge falls through to the
 * locale value for everything — i.e. the base Ekoa product presents itself.
 * The core ships generic; a vertical is opt-in (see cortex EKOA_VERTICAL).
 */
export const generic: VerticalProfile = {};
