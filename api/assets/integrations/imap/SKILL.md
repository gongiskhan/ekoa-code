---
description: Polling email listener — fires an automation each time a new IMAP message arrives.
---

# IMAP

Polling integration for mailboxes that expose IMAP. The listener supervisor calls `fetch_messages` every 60 s by default, normalises the response with the field paths in `listenerConfig`, and enqueues one event per new message. The cursor (`next_uid`) is advanced only after every message in the batch has been enqueued, so a crash mid-poll re-fetches the same window on next start.

## Scope in v1

This config declares the listener shape (poll interval, cursor field, dedup field). The `pollAction.httpConfig` is a **placeholder** — the integration-action-executor currently only supports HTTP-backed actions, and IMAP is a stateful TCP protocol. A real IMAP transport (likely via a separate `imap-poll` tool that wraps an IMAP client) is needed before this listener actually fires.

Treat this skill as the contract the listener-supervisor expects to see; the IMAP transport is follow-up work.

## Connecting (when the transport ships)

1. Set `host`, `port`, `username`, `password`, optionally `folder` (defaults to INBOX).
2. Recommend an app-specific password for accounts with 2FA (Gmail: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)).

## Available events

- `message.received` — quando chegar uma mensagem nova
