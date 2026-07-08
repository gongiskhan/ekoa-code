// Auth domain contract (ch03 §3.8.1, §3.2 auth-class table + token lifecycle).
import { z } from 'zod';
import { OkResponse, Role } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

// `.strict()`, NOT `.passthrough()`: AuthUser is a RESPONSE shape (`/auth/me`, `login.user`,
// `devicePoll.user`). Passthrough would let a secret-bearing field (`passwordHash`, a reset
// token) validate as a legal AuthUser body; strict makes the contract itself forbid any field
// not listed here, so the contract test catches a future leak (ch09 §9.3 invariant 2). The
// server already whitelists these fields explicitly (auth/service.ts `view()`); this makes the
// guard structural, not disciplinary.
export const AuthUser = z
  .object({
    id: z.string(),
    username: z.string(),
    role: Role,
    orgId: z.string(),
    active: z.boolean(),
    passwordChangeRequired: z.boolean().optional(),
    preferences: z.record(z.unknown()).optional(),
  })
  .strict();
export type AuthUser = z.infer<typeof AuthUser>;

export const LoginRequest = z.object({
  username: z.string(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  user: AuthUser,
  passwordChangeRequired: z.boolean(),
  expiresIn: z.number(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const ChangePasswordRequest = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const RefreshResponse = z.object({
  token: z.string(),
  expiresIn: z.number(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const DeviceStartResponse = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  interval: z.number(),
  expiresIn: z.number(),
});
export type DeviceStartResponse = z.infer<typeof DeviceStartResponse>;

export const DevicePollRequest = z.object({
  deviceCode: z.string(),
});
export type DevicePollRequest = z.infer<typeof DevicePollRequest>;

export const DevicePollResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('slow_down') }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
  z.object({
    status: z.literal('approved'),
    token: z.string(),
    user: AuthUser,
    expiresIn: z.number(),
  }),
]);
export type DevicePollResponse = z.infer<typeof DevicePollResponse>;

export const DeviceApproveRequest = z.object({
  userCode: z.string(),
  deny: z.boolean().optional(),
});
export type DeviceApproveRequest = z.infer<typeof DeviceApproveRequest>;

export const LogoutRequest = z.object({
  userId: z.string().optional(),
});
export type LogoutRequest = z.infer<typeof LogoutRequest>;

export const authEndpoints = {
  login: {
    method: 'POST',
    path: '/api/v1/auth/login',
    auth: 'public',
    request: LoginRequest,
    response: LoginResponse,
  },
  changePassword: {
    method: 'POST',
    path: '/api/v1/auth/password',
    auth: 'user',
    request: ChangePasswordRequest,
    response: OkResponse,
  },
  me: {
    method: 'GET',
    path: '/api/v1/auth/me',
    auth: 'user',
    response: AuthUser,
  },
  refresh: {
    method: 'POST',
    path: '/api/v1/auth/refresh',
    auth: 'user',
    response: RefreshResponse,
  },
  deviceStart: {
    method: 'POST',
    path: '/api/v1/auth/device',
    auth: 'public',
    response: DeviceStartResponse,
  },
  devicePoll: {
    method: 'POST',
    path: '/api/v1/auth/device/poll',
    auth: 'public',
    request: DevicePollRequest,
    response: DevicePollResponse,
  },
  deviceApprove: {
    method: 'POST',
    path: '/api/v1/auth/device/approve',
    auth: 'user',
    request: DeviceApproveRequest,
    response: OkResponse,
  },
  logout: {
    // Base middleware gate is `user` (self-logout is the common case, ch03 §3.8.1 lists
    // `user` first). The `{ userId }` admin variant requires elevation — super-admin
    // anywhere, org-admin scoped to its own org — which the G2 handler MUST enforce
    // (a static auth class cannot express "user for self, admin for others").
    method: 'POST',
    path: '/api/v1/auth/logout',
    auth: 'user',
    request: LogoutRequest,
    response: OkResponse,
  },
} as const satisfies DomainDescriptorMap;
