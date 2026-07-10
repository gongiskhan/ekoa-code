#!/usr/bin/env bash
# Walkthrough evidence source: the newest chat session's last assistant message,
# fetched from the real API (dev-only committed credentials; see notes.md).
set -euo pipefail
API=${EKOA_API_URL:-http://localhost:4111}
TOKEN=$(curl -s -X POST "$API/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"tmp12345"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
SID=$(curl -s "$API/api/v1/sessions" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; xs=[s for s in json.load(sys.stdin)["items"] if s.get("messageCount")]; xs.sort(key=lambda s: s["updatedAt"]); print(xs[-1]["id"])')
curl -s "$API/api/v1/sessions/$SID/messages" -H "Authorization: Bearer $TOKEN" | python3 -c '
import sys, json
ms = [m for m in json.load(sys.stdin)["items"] if m["role"] == "assistant"]
m = ms[-1]
print("sessionId: " + m["sessionId"])
print("messageId: " + m["id"])
print("role:      " + m["role"])
print("createdAt: " + m["createdAt"])
print("---")
print(m["content"])
'
