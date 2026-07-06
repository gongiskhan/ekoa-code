/** Billing domain contract (ch03 §3.8.21): usage, history, credits, overage, and platform admin. */
import { z } from 'zod';
import { Id, listResponse, itemsResponse, PaginationQuery } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const BillingUsage = z
  .object({
    tokensUsed: z.number(),
    tokenLimit: z.number().nullable(),
    balanceUsd: z.number(),
    overageEnabled: z.boolean(),
  })
  .passthrough();
export type BillingUsage = z.infer<typeof BillingUsage>;

export const BillingHistoryEntry = z
  .object({
    id: Id,
    type: z.string(),
    amountUsd: z.number(),
    createdAt: z.string(),
    description: z.string().optional(),
  })
  .passthrough();
export type BillingHistoryEntry = z.infer<typeof BillingHistoryEntry>;

export const AdminUsageRow = z
  .object({
    userId: Id,
    tokensUsed: z.number(),
    tokenLimit: z.number().nullable(),
    balanceUsd: z.number().optional(),
    overageEnabled: z.boolean().optional(),
  })
  .passthrough();
export type AdminUsageRow = z.infer<typeof AdminUsageRow>;

export const BillingHistoryResponse = listResponse(BillingHistoryEntry);
export type BillingHistoryResponse = z.infer<typeof BillingHistoryResponse>;

export const BillingBreakdownRow = z.object({
  agentType: z.string(),
  tokens: z.number(),
  percentage: z.number(),
});
export type BillingBreakdownRow = z.infer<typeof BillingBreakdownRow>;

export const BillingBreakdownResponse = itemsResponse(BillingBreakdownRow);
export type BillingBreakdownResponse = z.infer<typeof BillingBreakdownResponse>;

export const PurchaseCreditsRequest = z.object({ amountUsd: z.number() });
export type PurchaseCreditsRequest = z.infer<typeof PurchaseCreditsRequest>;

export const PurchaseCreditsResponse = z.object({
  success: z.boolean(),
  newBalance: z.number(),
});
export type PurchaseCreditsResponse = z.infer<typeof PurchaseCreditsResponse>;

export const ToggleOverageRequest = z.object({ enabled: z.boolean() });
export type ToggleOverageRequest = z.infer<typeof ToggleOverageRequest>;

export const ToggleOverageResponse = z.object({ overageEnabled: z.boolean() });
export type ToggleOverageResponse = z.infer<typeof ToggleOverageResponse>;

export const AdminGlobalOverageRequest = z.object({ enabled: z.boolean() });
export type AdminGlobalOverageRequest = z.infer<typeof AdminGlobalOverageRequest>;

export const AdminGlobalOverageResponse = z.object({ globalOverageEnabled: z.boolean() });
export type AdminGlobalOverageResponse = z.infer<typeof AdminGlobalOverageResponse>;

export const AdminUsageResponse = itemsResponse(AdminUsageRow);
export type AdminUsageResponse = z.infer<typeof AdminUsageResponse>;

export const AdminResetUsageResponse = z.object({
  userId: Id,
  tokensUsed: z.number(),
});
export type AdminResetUsageResponse = z.infer<typeof AdminResetUsageResponse>;

export const AdminSetLimitRequest = z.object({ tokenLimit: z.number().nullable() });
export type AdminSetLimitRequest = z.infer<typeof AdminSetLimitRequest>;

export const AdminSetLimitResponse = z.object({
  userId: Id,
  tokenLimit: z.number().nullable(),
});
export type AdminSetLimitResponse = z.infer<typeof AdminSetLimitResponse>;

export const billingEndpoints: DomainDescriptorMap = {
  getUsage: {
    method: 'GET',
    path: '/api/v1/billing/usage',
    auth: 'user',
    response: BillingUsage,
  },
  getHistory: {
    method: 'GET',
    path: '/api/v1/billing/history',
    auth: 'user',
    query: PaginationQuery,
    response: BillingHistoryResponse,
  },
  getBreakdown: {
    method: 'GET',
    path: '/api/v1/billing/breakdown',
    auth: 'super-admin',
    response: BillingBreakdownResponse,
  },
  purchaseCredits: {
    method: 'POST',
    path: '/api/v1/billing/credits',
    auth: 'user',
    request: PurchaseCreditsRequest,
    response: PurchaseCreditsResponse,
  },
  toggleOverage: {
    method: 'PUT',
    path: '/api/v1/billing/overage',
    auth: 'user',
    request: ToggleOverageRequest,
    response: ToggleOverageResponse,
  },
  adminGlobalOverage: {
    method: 'PUT',
    path: '/api/v1/billing/admin/overage',
    auth: 'super-admin',
    request: AdminGlobalOverageRequest,
    response: AdminGlobalOverageResponse,
  },
  adminListUsage: {
    method: 'GET',
    path: '/api/v1/billing/admin/usage',
    auth: 'super-admin',
    response: AdminUsageResponse,
  },
  adminResetUsage: {
    method: 'POST',
    path: '/api/v1/billing/admin/usage/:userId/reset',
    auth: 'super-admin',
    response: AdminResetUsageResponse,
  },
  adminSetLimit: {
    method: 'PUT',
    path: '/api/v1/billing/admin/limits/:userId',
    auth: 'super-admin',
    request: AdminSetLimitRequest,
    response: AdminSetLimitResponse,
  },
};
