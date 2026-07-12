---
name: using-integrations
description: How to call connected integrations (email, calendar, files, etc.) and gracefully handle missing credentials
---

# Using Integrations

This base ships the integrations client as part of the protocol client at
`frontend/src/lib/protocol-client.ts`: `callIntegration<T>()`, built over the
generic `action(app, intent, params)` envelope. Always use it for any
cross-service call - Gmail send, Calendar list, Drive read, Slack post, etc.
Never call an external API directly.

## The contract

```ts
import { callIntegration } from './lib/protocol-client';

const result = await callIntegration('email', 'send', {
  to: 'a@b.com',
  subject: '...',
  body: '...',
});

if (result.ok) {
  // result.data - the integration's typed response
} else if (result.status === 'needs_integration') {
  // No connected provider for this category.
  // result.integration - category that's missing ('email', 'calendar', …)
  // result.options     - provider keys the user can pick from
  // result.message     - short human-readable explanation
  // Render <IntegrationNeededBoundary /> in this branch.
}
```

The two outcomes are exhaustive. There is no other shape.

## Categories

Closed enum - pick the closest match, never invent one:

`email | calendar | files-storage | payments | external-api | spreadsheets | crm | sms | maps`

## The IntegrationNeededBoundary

Shipped at `frontend/src/lib/IntegrationNeededBoundary.jsx`. Render it when a call returns `needs_integration`:

```jsx
import { callIntegration } from './lib/protocol-client';
import { IntegrationNeededBoundary } from './lib/IntegrationNeededBoundary';

function SendEmailButton({ to, body }) {
  const [needed, setNeeded] = useState(null);

  async function send() {
    const r = await callIntegration('email', 'send', { to, body });
    if (!r.ok && r.status === 'needs_integration') setNeeded(r);
    // else if (r.ok) continue
  }

  if (needed) {
    return <IntegrationNeededBoundary category={needed.integration} options={needed.options} message={needed.message} />;
  }
  return <button onClick={send}>Enviar</button>;
}
```

The boundary surfaces a "Ligar à {provider}" CTA that deep-links to `/integrations`. After the user connects, the component re-renders and the next call succeeds.

## The generic action envelope

For platform server-actions that are not integrations, use `action` directly:

```ts
import { action } from './lib/protocol-client';
const data = await action('some.app', 'some.intent', { ...params }); // throws ActionFailed on error
```

## What NOT to do

- Do not assume an integration is connected. Always handle `needs_integration`.
- Do not hard-code provider names ("Gmail", "Outlook") into business logic. Use the category; the helper picks the connected provider.
- Do not store integration credentials in app-data. The platform holds them; you only receive a typed response.
