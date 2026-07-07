/** Settings domain contract (ch03 §3.8.5): merged org + per-user settings view. */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

/** Per-user integration toggles surfaced in the merged view. */
export const IntegrationSettings = z
  .object({ pipedreamEnabled: z.boolean() })
  .passthrough();
export type IntegrationSettings = z.infer<typeof IntegrationSettings>;

/** Per-user build toggle (rides `user_settings`, not org settings; ch03 §3.8.5). */
export const BuildSettings = z.object({ verifyBuilds: z.boolean() }).passthrough();
export type BuildSettings = z.infer<typeof BuildSettings>;

/** Per-user memory toggle (rides `user_settings`, not org settings; ch03 §3.8.19). */
export const MemorySettings = z.object({ autoExtract: z.boolean() }).passthrough();
export type MemorySettings = z.infer<typeof MemorySettings>;

/** Merged view: org settings plus the caller's per-user toggles (ch03 §3.8.5). */
export const PlatformSettings = z
  .object({
    integration: IntegrationSettings,
    build: BuildSettings,
    memory: MemorySettings,
  })
  .passthrough();
export type PlatformSettings = z.infer<typeof PlatformSettings>;

/** Deep-partial patch of org settings; never touches the per-user toggles (ch03 §3.8.5). */
export const PlatformSettingsPatch = z
  .object({
    integration: z.object({ pipedreamEnabled: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough();
export type PlatformSettingsPatch = z.infer<typeof PlatformSettingsPatch>;

/** Per-user settings patch: only the two `user_settings` toggles (ch03 §3.8.5, Amendment 2). */
export const UserSettingsPatch = z
  .object({
    build: z.object({ verifyBuilds: z.boolean().optional() }).optional(),
    memory: z.object({ autoExtract: z.boolean().optional() }).optional(),
  })
  .passthrough();
export type UserSettingsPatch = z.infer<typeof UserSettingsPatch>;

export const settingsEndpoints = {
  get: {
    method: 'GET',
    path: '/api/v1/settings',
    auth: 'user',
    response: PlatformSettings,
  },
  update: {
    method: 'PATCH',
    path: '/api/v1/settings',
    auth: 'org-admin',
    request: PlatformSettingsPatch,
    response: PlatformSettings,
  },
  updateMe: {
    method: 'PATCH',
    path: '/api/v1/settings/me',
    auth: 'user',
    request: UserSettingsPatch,
    response: PlatformSettings,
  },
} as const satisfies DomainDescriptorMap;
