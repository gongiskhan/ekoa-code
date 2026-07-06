---
name: google-workspace
description: Use this integration to interact with Google Workspace services including Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets, and Google Tasks. Suitable for email management and triage, scheduling, file operations, document creation, and task management.
---

# Google Workspace

Connects to Google Workspace via OAuth 2.0 to interact with Gmail, Calendar, Drive, Docs, Sheets, and Tasks on behalf of the authenticated user.

## Security Model

All actions are executed through the Ekoa Integration Proxy. OAuth tokens are managed by the platform and are never exposed to the AI agent or logged anywhere. Credentials are decrypted only at execution time.

## Available Actions

### Gmail

#### list_emails

List email messages from the user's Gmail inbox. Returns message IDs and thread IDs. Use the `q` argument to filter with Gmail search syntax.

**Arguments:**
- `q` (string, optional): Gmail search query (e.g. `from:alice subject:report is:unread`)
- `maxResults` (number, optional): Maximum number of messages to return (default 10, max 500)

**When to use:** When the user wants to check their inbox, search for specific emails, or find messages matching criteria.

#### read_email

Read the full content of a specific Gmail message by its ID. Returns headers (From, To, Subject, Date) and the message body.

**Arguments:**
- `messageId` (string, required): The Gmail message ID to read
- `format` (string, optional): Response format -- `full`, `metadata`, or `minimal` (default `full`)

**When to use:** After listing emails, when the user wants to read the content of a specific message.

#### send_email

Send an email from the authenticated user's Gmail account. The message must be provided as a base64url-encoded RFC 2822 string.

**Arguments:**
- `raw` (string, required): Base64url-encoded RFC 2822 email message including To, From, Subject, and body

**When to use:** When the user wants to send an email. Construct the RFC 2822 message with proper headers (To, From, Subject, MIME-Version, Content-Type) and base64url-encode it.

#### modify_email

Add or remove labels on a Gmail message. This is the primary action for email triage.

**Arguments:**
- `messageId` (string, required): The Gmail message ID
- `addLabelIds` (array of strings, optional): Label IDs to add (e.g. `["STARRED", "IMPORTANT"]`)
- `removeLabelIds` (array of strings, optional): Label IDs to remove (e.g. `["UNREAD", "INBOX"]`)

**When to use:**
- Mark as read: `removeLabelIds: ["UNREAD"]`
- Archive (remove from inbox): `removeLabelIds: ["INBOX"]`
- Mark as read AND archive: `removeLabelIds: ["UNREAD", "INBOX"]`
- Star: `addLabelIds: ["STARRED"]`
- Mark as important: `addLabelIds: ["IMPORTANT"]`

#### batch_modify_emails

Bulk add/remove labels on multiple Gmail messages at once.

**Arguments:**
- `ids` (array of strings, required): Array of Gmail message IDs to modify
- `addLabelIds` (array of strings, optional): Label IDs to add
- `removeLabelIds` (array of strings, optional): Label IDs to remove

**When to use:** When the user wants to triage many emails at once (e.g. "mark all today's emails as read and archive them"). First use `list_emails` to get the IDs, then call this action with all IDs.

#### trash_email

Move a Gmail message to Trash.

**Arguments:**
- `messageId` (string, required): The Gmail message ID to trash

**When to use:** When the user wants to delete an email.

#### list_labels

List all Gmail labels including system labels (INBOX, UNREAD, STARRED, SPAM, TRASH, etc.) and user-created labels.

**Arguments:** None

**When to use:** To discover available label IDs before using `modify_email` or `batch_modify_emails`.

#### list_drafts

List draft emails in the user's account.

**Arguments:**
- `maxResults` (number, optional): Maximum drafts to return (default 20)

**When to use:** When the user wants to see their unsent draft emails.

### Calendar

#### list_events

List upcoming events from the user's primary Google Calendar. Results are ordered by start time.

**Arguments:**
- `timeMin` (string, optional): Lower bound for event start time as RFC 3339 timestamp (e.g. `2025-01-01T00:00:00Z`)
- `timeMax` (string, optional): Upper bound for event start time as RFC 3339 timestamp
- `maxResults` (number, optional): Maximum number of events to return (default 10, max 2500)
- `singleEvents` (boolean, optional): Expand recurring events into individual instances (default true)

**When to use:** When the user wants to check their calendar, find upcoming meetings, or look for schedule availability.

#### create_event

Create a new event on the user's primary Google Calendar.

**Arguments:**
- `summary` (string, required): Title of the event
- `description` (string, optional): Description or notes for the event
- `startDateTime` (string, required): Event start as RFC 3339 timestamp (e.g. `2025-06-15T09:00:00-05:00`)
- `endDateTime` (string, required): Event end as RFC 3339 timestamp
- `timeZone` (string, optional): IANA time zone (e.g. `America/New_York`). Defaults to calendar time zone.
- `attendees` (string, optional): Comma-separated email addresses of attendees

**When to use:** When the user wants to schedule a meeting, block time, or create a calendar event.

#### update_event

Update an existing calendar event's details.

**Arguments:**
- `eventId` (string, required): The calendar event ID to update
- `summary` (string, optional): Updated event title
- `description` (string, optional): Updated event description
- `startDateTime` (string, optional): Updated start time (RFC 3339)
- `endDateTime` (string, optional): Updated end time (RFC 3339)
- `timeZone` (string, optional): IANA time zone

**When to use:** When the user wants to reschedule, rename, or modify an existing event.

#### delete_event

Delete a calendar event.

**Arguments:**
- `eventId` (string, required): The calendar event ID to delete

**When to use:** When the user wants to cancel or remove a calendar event.

### Drive

#### list_files

List files in the user's Google Drive. Supports search queries and sorting.

**Arguments:**
- `q` (string, optional): Drive search query (e.g. `name contains 'report'` or `mimeType='application/pdf'`)
- `pageSize` (number, optional): Maximum number of files to return (default 10, max 1000)
- `orderBy` (string, optional): Sort order (e.g. `modifiedTime desc`, `name`)

**When to use:** When the user wants to find files in their Drive, list recent documents, or search by name or type.

#### get_file

Get metadata for a specific file in Google Drive.

**Arguments:**
- `fileId` (string, required): The Drive file ID

**When to use:** When the user wants details about a specific file (name, type, size, last modified, link).

### Docs

#### create_doc

Create a new empty Google Doc with a given title. Returns the document ID and URL.

**Arguments:**
- `title` (string, required): Title of the new Google Doc

**When to use:** When the user wants to create a new document for writing or collaboration.

#### write_doc

Insert text into a Google Doc.

**Arguments:**
- `documentId` (string, required): The Google Doc document ID
- `text` (string, required): Text content to insert
- `index` (number, optional): Character index to insert at (default: 1 = start of doc)

**When to use:** When the user wants to write content into an existing Google Doc.

### Sheets

#### create_sheet

Create a new Google Sheets spreadsheet with a given title. Returns the spreadsheet ID and URL.

**Arguments:**
- `title` (string, required): Title of the new spreadsheet

**When to use:** When the user wants to create a new spreadsheet for data entry, tracking, or analysis.

#### read_sheet

Read values from a specific range in a Google Sheets spreadsheet.

**Arguments:**
- `spreadsheetId` (string, required): The spreadsheet ID
- `range` (string, required): The A1 notation range to read (e.g. `Sheet1!A1:C10`)

**When to use:** When the user wants to read data from a spreadsheet.

#### append_sheet

Append rows of data to a Google Sheets spreadsheet.

**Arguments:**
- `spreadsheetId` (string, required): The spreadsheet ID
- `range` (string, required): The A1 notation range (e.g. `Sheet1!A:C`)
- `values` (array, required): 2D array of values to append (e.g. `[["row1col1","row1col2"],["row2col1","row2col2"]]`)

**When to use:** When the user wants to add new rows of data to a spreadsheet.

### Tasks

#### list_task_lists

List all Google Tasks task lists.

**Arguments:** None

**When to use:** To discover available task lists and their IDs before working with tasks.

#### list_tasks

List tasks in a specific task list.

**Arguments:**
- `taskListId` (string, required): The task list ID (use `list_task_lists` to find it)
- `showCompleted` (boolean, optional): Whether to include completed tasks (default true)

**When to use:** When the user wants to see their tasks or check what needs to be done.

#### create_task

Create a new task in a task list.

**Arguments:**
- `taskListId` (string, required): The task list ID
- `title` (string, required): Task title
- `notes` (string, optional): Task notes/description
- `due` (string, optional): Due date as RFC 3339 timestamp

**When to use:** When the user wants to add a new task to their list.

#### complete_task

Mark a task as completed.

**Arguments:**
- `taskListId` (string, required): The task list ID
- `taskId` (string, required): The task ID to complete

**When to use:** When the user wants to mark a task as done.

## Notes

- The `list_emails` action returns only message IDs. Follow up with `read_email` to get the actual content.
- For email triage, the typical workflow is: `list_emails` -> get IDs -> `batch_modify_emails` with the desired label changes.
- Common label IDs: `INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, `SPAM`, `TRASH`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`.
- For `send_email`, the RFC 2822 message must include all required headers. Use base64url encoding (not standard base64).
- Calendar event times must include timezone information. Use RFC 3339 format consistently.
- Drive search queries follow Google Drive query syntax. Common filters: `mimeType`, `name contains`, `modifiedTime >`.
- Tasks require the `tasks` OAuth scope. Users who connected before this scope was added will need to disconnect and reconnect their Google Workspace integration.
