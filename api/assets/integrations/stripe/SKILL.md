---
description: Receive Stripe payment events as automation triggers, with auto-registered webhook endpoints.
---

# Stripe

This integration declares Stripe's HMAC-signed webhook protocol and a pair of HTTP actions used by the trigger system to provision / tear down webhook endpoints on the connected Stripe account.

Triggers fire when Stripe POSTs an event (e.g. `payment_intent.succeeded`) to `/hooks/<triggerId>`. The webhook handler verifies `Stripe-Signature` against the per-trigger HMAC secret (constant-time HMAC-SHA-256 of `<timestamp>.<rawBody>`), with a 300-second timestamp tolerance to block replay attacks.

Dedup key: the event `id` field (e.g. `evt_1NXxYy...`) — Stripe sends duplicates on retry and the queue's `UNIQUE(trigger_id, dedup_key)` collapses them.

## Connecting

1. Get a secret key from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys). Use a test-mode key (`sk_test_...`) when wiring up the automation; flip to live (`sk_live_...`) once you've verified it works.
2. Paste it into the Stripe integration connection form.

## Creating a trigger

When you pick a Stripe event from the trigger picker, the system calls `register_webhook` against your account with the `/hooks/<triggerId>` URL and the events you selected. Stripe returns a webhook endpoint id (`we_xxx`) we store in `registrationMeta` for later teardown via `unregister_webhook`.

If the secret key lacks scope (older restricted keys) or the call hits a transient 5xx, the trigger falls back to manual setup — the UI shows the URL + secret for copy-paste into the Stripe dashboard.

## Available events

- `payment_intent.succeeded` — pagamento concluído com sucesso
- `payment_intent.payment_failed` — pagamento falhou
- `charge.refunded` — pagamento reembolsado
- `customer.created` — cliente criado
- `invoice.paid` — fatura paga
