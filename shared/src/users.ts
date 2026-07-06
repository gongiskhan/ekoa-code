/** Users domain contract (ch03 §3.8.2): user CRUD, role/activation, password reset. */
import { z } from 'zod';
import { OkResponse, itemsResponse, Role } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';
import { AuthUser } from './auth.js';

export const CreateUserRequest = z.object({
  username: z.string(),
  password: z.string(),
  role: Role,
  orgId: z.string().optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UserPatch = z.object({
  role: Role.optional(),
  active: z.boolean().optional(),
});
export type UserPatch = z.infer<typeof UserPatch>;

export const ResetPasswordRequest = z.object({
  newPassword: z.string(),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const UserListResponse = itemsResponse(AuthUser);
export type UserListResponse = z.infer<typeof UserListResponse>;

export const usersEndpoints: DomainDescriptorMap = {
  list: {
    method: 'GET',
    path: '/api/v1/users',
    auth: 'org-admin',
    response: UserListResponse,
  },
  create: {
    method: 'POST',
    path: '/api/v1/users',
    auth: 'super-admin',
    request: CreateUserRequest,
    response: AuthUser,
  },
  update: {
    method: 'PATCH',
    path: '/api/v1/users/:id',
    auth: 'org-admin',
    request: UserPatch,
    response: AuthUser,
  },
  remove: {
    method: 'DELETE',
    path: '/api/v1/users/:id',
    auth: 'super-admin',
    response: OkResponse,
  },
  resetPassword: {
    method: 'POST',
    path: '/api/v1/users/:id/password',
    auth: 'super-admin',
    request: ResetPasswordRequest,
    response: OkResponse,
  },
};
