// Uploads domain contract (ch03 §3.8.22): raw-body binary upload endpoint.
import { z } from 'zod';
import { Id } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const UploadResult = z.object({
  uploadId: Id,
  displayName: z.string(),
  size: z.number(),
  folderRoot: z.string().optional(),
});
export type UploadResult = z.infer<typeof UploadResult>;

export const uploadsEndpoints: DomainDescriptorMap = {
  create: {
    method: 'POST',
    path: '/api/v1/uploads',
    auth: 'user',
    response: UploadResult,
    kind: 'binary',
  },
};
