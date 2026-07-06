---
name: using-integrations
description: How to call connected integrations (email, calendar, files, etc.) and gracefully handle missing credentials
---

# Using Integrations

This base provides a single helper: `callIntegration<T>()` (in `frontend/src/lib/integrations.ts`). Always use it for any cross-service call — Gmail send, Calendar list, Drive read, Slack post, etc.

## The contract

```ts
import { callIntegration } from './lib/integrations';

const result = await callIntegration('email', 'send', {
  to: 'a@b.com',
  subject: '...',
  body: '...',
});

if (result.ok) {
  // result.data — the integration's typed response
} else if (result.status === 'needs_integration') {
  // No connected provider for this category.
  // result.integration — category that's missing ('email', 'calendar', …)
  // result.options    — array of provider keys the user can pick from
  // result.message    — short human-readable explanation
  // Render <IntegrationNeededBoundary /> in this branch.
}
```

The two outcomes are exhaustive. There is no other shape.

## Categories

The orchestrator detects integrations from this closed enum:

`email | calendar | files-storage | payments | external-api | spreadsheets | crm | sms | maps`

Never invent a new category in your UI — pick the closest match.

## The IntegrationNeededBoundary

When you build any UI that triggers `callIntegration`, wrap the calling component (or render conditionally) with the boundary:

```jsx
import { IntegrationNeededBoundary } from './lib/integration-needed-boundary';

function SendEmailButton({ to, body }) {
  const [needed, setNeeded] = useState(null);

  async function send() {
    const r = await callIntegration('email', 'send', { to, body });
    if (!r.ok && r.status === 'needs_integration') setNeeded(r);
    else if (r.ok) // continue
  }

  if (needed) {
    return <IntegrationNeededBoundary category={needed.integration} options={needed.options} message={needed.message} />;
  }
  return <button onClick={send}>Send</button>;
}
```

The boundary surfaces a "Connect to {provider}" call-to-action that deep-links to `/integrations`. After the user connects, your component re-renders; clicking again succeeds.

## What to NOT do

- Do not assume an integration is connected. Always handle `needs_integration`.
- Do not hard-code provider names ("Gmail", "Outlook") into your business logic. Use the category. The user might have either Gmail or Outlook connected — the helper picks the right one.
- Do not store integration credentials in app-data. The platform handles credentials; you only ever receive a typed response.
