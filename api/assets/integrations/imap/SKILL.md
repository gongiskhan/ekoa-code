---
description: Polling email listener — fires an automation each time a new IMAP message arrives.
---

# IMAP

Polling integration for mailboxes that expose IMAP. The listener supervisor calls `fetch_messages` every 60 s by default, normalises the response with the field paths in `listenerConfig`, and enqueues one event per new message. The cursor (`next_uid`) is advanced only after every message in the batch has been enqueued, so a crash mid-poll re-fetches the same window on next start.

## NOT AVAILABLE IN THIS VERSION

The generic user-defined listener rail above is wired and tested — but the **IMAP protocol transport is deferred**. The integration-action executor runs HTTP-backed and automation-backed actions only, and IMAP is a stateful TCP protocol, so `fetch_messages` declares `"transport": "imap"` and every call is refused with a coded `unsupported_transport` error. A listener on this integration therefore **fails on every tick** (recorded on the listener's failure counter, with exponential backoff) rather than quietly reporting an empty mailbox.

For a working email listener today, connect **Microsoft 365** or **Google Workspace** — those poll through the platform source (`platform-poll.ts`) with OAuth refresh in core.

Shipping IMAP means adding an IMAP transport to the executor (an `imap`-protocol client behind the same action contract); nothing else on the rail has to change. See `docs/decisions.md` (2A-S4).

## Connecting (when the transport ships)

1. Set `host`, `port`, `username`, `password`, optionally `folder` (defaults to INBOX).
2. Recommend an app-specific password for accounts with 2FA (Gmail: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)).

## Available events

- `message.received` — quando chegar uma mensagem nova
