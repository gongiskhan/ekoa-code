// notifications — the per-user push channel (ch03 §3.6.4). The fourth sanctioned SSE
// stream (CONV-4). Defined in §3.6.4 rather than a §3.8 resource table, so it lives here.
import type { DomainDescriptorMap } from './descriptor.js';
import { NotificationEvent } from './events.js';

export { NotificationEvent };

export const notificationsEndpoints: DomainDescriptorMap = {
  events: {
    method: 'GET',
    path: '/api/v1/notifications/events',
    auth: 'token-query',
    response: NotificationEvent,
    kind: 'sse',
  },
};
