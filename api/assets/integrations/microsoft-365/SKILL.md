---
name: microsoft-365
description: Use this integration to interact with Microsoft 365 services including Outlook, OneDrive, SharePoint, and Calendar via the Microsoft Graph API. Suitable for email management, scheduling, file storage, and site discovery.
---

# Microsoft 365

Connects to Microsoft 365 via OAuth 2.0 and the Microsoft Graph API to interact with Outlook mail, Calendar, OneDrive, and SharePoint on behalf of the authenticated user.

## Security Model

All actions are executed through the Ekoa Integration Proxy. OAuth tokens are managed by the platform and are never exposed to the AI agent or logged anywhere. Credentials are decrypted only at execution time.

## Available Actions

### list_emails

List email messages from the user's Outlook mailbox. Supports OData filtering, search, and sorting.

**Arguments:**
- `$top` (number, optional): Maximum number of messages to return (default 10, max 1000)
- `$filter` (string, optional): OData filter expression (e.g. `isRead eq false`)
- `$orderby` (string, optional): OData sort expression (e.g. `receivedDateTime desc`)
- `$search` (string, optional): Free-text search across subject, body, and addresses

**When to use:** When the user wants to check their Outlook inbox, search for specific messages, or find unread mail.

### read_email

Read the full content of a specific Outlook message by its ID. Returns subject, from, body, attachments metadata, and other headers.

**Arguments:**
- `messageId` (string, required): The Outlook message ID to read

**When to use:** After listing emails, when the user wants to read the full content of a specific message.

### send_email

Send an email from the authenticated user's Outlook account. Accepts structured fields for subject, body, and recipients.

**Arguments:**
- `subject` (string, required): Email subject line
- `body` (string, required): Email body content (plain text or HTML)
- `bodyContentType` (string, optional): Body content type -- `Text` or `HTML` (default `Text`)
- `toRecipients` (string, required): Comma-separated email addresses of recipients
- `ccRecipients` (string, optional): Comma-separated email addresses of CC recipients

**When to use:** When the user wants to compose and send an email via Outlook.

### list_events

List upcoming events from the user's Outlook calendar.

**Arguments:**
- `startDateTime` (string, optional): Lower bound for event start time as ISO 8601 timestamp (e.g. `2025-01-01T00:00:00Z`)
- `endDateTime` (string, optional): Upper bound for event end time as ISO 8601 timestamp
- `$top` (number, optional): Maximum number of events to return (default 10)
- `$orderby` (string, optional): OData sort expression (e.g. `start/dateTime`)

**When to use:** When the user wants to check their calendar, find upcoming meetings, or look for schedule availability.

### create_event

Create a new event on the user's Outlook calendar.

**Arguments:**
- `subject` (string, required): Title of the event
- `body` (string, optional): Description or notes for the event
- `startDateTime` (string, required): Event start as ISO 8601 timestamp (e.g. `2025-06-15T09:00:00`)
- `endDateTime` (string, required): Event end as ISO 8601 timestamp
- `timeZone` (string, required): IANA time zone (e.g. `America/New_York`)
- `attendees` (string, optional): Comma-separated email addresses of attendees
- `location` (string, optional): Location of the event

**When to use:** When the user wants to schedule a meeting, block time, or create a calendar event.

### list_files

List files and folders in the root of the user's OneDrive. Supports OData filtering and sorting.

**Arguments:**
- `$top` (number, optional): Maximum number of items to return (default 20)
- `$orderby` (string, optional): OData sort expression (e.g. `lastModifiedDateTime desc`, `name`)
- `$filter` (string, optional): OData filter expression

**When to use:** When the user wants to browse their OneDrive files, find recent documents, or list folder contents.

### create_file

Create or overwrite a file in the root of the user's OneDrive. Suitable for small files up to 4 MB.

**Arguments:**
- `filename` (string, required): Name of the file to create (e.g. `report.txt`, `data.csv`)
- `content` (string, required): File content as a string
- `contentType` (string, optional): MIME type (e.g. `text/plain`, `text/csv`, `application/json`)

**When to use:** When the user wants to save a file to their OneDrive, export data to a file, or create a new document.

### list_sites

List SharePoint sites accessible to the authenticated user. Supports search by name.

**Arguments:**
- `$search` (string, optional): Search query to find sites by name or description
- `$top` (number, optional): Maximum number of sites to return (default 10)

**When to use:** When the user wants to discover available SharePoint sites or find a specific site for collaboration.

## Notes

- Microsoft Graph uses OData query parameters (`$top`, `$filter`, `$orderby`, `$search`, `$select`) for filtering and pagination.
- The `send_email` action accepts structured fields (subject, body, recipients) unlike Gmail which requires raw RFC 2822 encoding.
- Calendar events require an explicit `timeZone` parameter. Use IANA time zone identifiers.
- The `create_file` action uses PUT semantics -- it will overwrite an existing file with the same name. Use for files up to 4 MB; larger files require a resumable upload session.
- SharePoint `list_sites` searches across all sites the user has access to. Use the returned site ID for further operations.
