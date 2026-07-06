---
name: slack
description: Use this integration to send messages to Slack channels or retrieve a list of channels in the workspace. Ideal for notifications, alerts, and workflow updates.
---

# Slack

Connects to Slack via a Bot Token to send messages and list channels within a workspace.

## Security Model
All actions are executed through the Ekoa Integration Proxy. The Bot Token is stored encrypted on the company server and is never exposed to the AI or logged anywhere.

## Available Actions

### send_message
Sends a text message to a Slack channel. The bot must be invited to the channel before it can post.

**Arguments:**
- `channel` (string, required): The channel name (e.g. `#general`) or channel ID (e.g. `C012AB3CD`)
- `text` (string, required): The message text to send. Supports Slack markdown (bold with `*text*`, code with `` `code` ``)
- `username` (string, optional): Override the bot display name for this message. Defaults to the bot's configured name.

**Examples:**

Basic usage: