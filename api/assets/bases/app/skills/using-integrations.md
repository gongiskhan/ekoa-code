---
name: using-integrations
description: How integrations work for an app build - platform-executed capabilities, the visitor M365 Graph proxy, and the needs-integration UI state
---

# Using Integrations

An app **never calls an external service directly** - no OAuth, no API keys, no
generic client-side action envelope. There are exactly two sanctioned paths.

## 1. Platform-executed capabilities (the primary path)

Cross-service actions (send an email, create a calendar event, post to Slack,
read a sheet) are declared as `integration.call` capabilities in the app's
`MANIFEST.md` and **executed by the platform** - automations and agents invoke
them over the data layer, not the app's frontend. Declare what you use in
`external_dependencies.integrations`; the platform resolves credentials and the
connected provider.

The frontend's job is the UI and the app-data it owns (`./lib/jsonStore`). When
a user action needs a capability whose integration is not connected, render the
needs-integration state (below) to route them to `/integrations`.

Before you author an `integration.call` capability for a configured integration, load its
knowledge with the `load_context` tool (name `integration-<key>`, e.g. `integration-slack`): it
describes that integration's actions, their arguments, and its common errors. Declare the
integrations you use in `external_dependencies.integrations` of the MANIFEST.md.

## 2. The visitor's Microsoft 365 (the only in-app integration call)

The signed-in visitor's own Microsoft 365 is reachable through the Graph proxy,
using their delegated SSO session:

```ts
import { graphFetch, RuntimeUnavailable } from './lib/protocol-client';

try {
  const res = await graphFetch('me/messages?$top=10'); // path relative to the Graph root
  if (res.status === 401 || res.status === 403) {
    // The visitor has not granted Microsoft 365 - render the needs-integration state.
  } else if (res.ok) {
    const data = await res.json();
  }
} catch (err) {
  if (err instanceof RuntimeUnavailable) {
    // No served-app runtime (standalone preview) - show a neutral fallback.
  }
}
```

`graphFetch` acts as the VISITOR (SSO identity), never as the workspace account.
Do not use it to identify the visitor - use `whoami()` / `getCurrentUser()` for that.

## The needs-integration UI state

Shipped at `frontend/src/lib/IntegrationNeededBoundary.jsx`. Render it when a
capability the UI depends on has no connected integration (e.g. a `graphFetch`
returns 401/403, or a required provider is absent):

```jsx
import { graphFetch } from './lib/protocol-client';
import { IntegrationNeededBoundary } from './lib/IntegrationNeededBoundary';

function InboxButton() {
  const [needed, setNeeded] = useState(null);

  async function load() {
    const r = await graphFetch('me/messages');
    if (r.status === 401 || r.status === 403) {
      setNeeded({ category: 'email', options: ['microsoft-365'], message: 'Ligue o Microsoft 365 para ver o email.' });
    }
    // else use the data
  }

  if (needed) {
    return <IntegrationNeededBoundary category={needed.category} options={needed.options} message={needed.message} />;
  }
  return <button onClick={load}>Carregar email</button>;
}
```

The boundary surfaces a "Ligar à {provider}" CTA that deep-links to `/integrations`.

## Categories

Use the closed enum when labelling a needed integration, never invent one:

`email | calendar | files-storage | payments | external-api | spreadsheets | crm | sms | maps`

## What NOT to do

- Do not call an external API directly from the app, and do not install an SDK or handle credentials. The platform holds them.
- Do not assume an integration is connected. Handle the not-connected state.
- Do not hard-code provider names into business logic. Declare the capability; the platform picks the connected provider.
