# Caixa Citius (mandatários) — SPECULATIVE fixtures

**These fixtures are SYNTHETIC and SPECULATIVE.** The authenticated Caixa Citius
*mandatários* inbox HTML has **never been observed** — no account exists to snapshot it.
Every file here was hand-authored to the known ASP.NET WebForms / ISO-8859-1 family that
the *public* Citius pages already use (see `api/src/legal/citius.ts` and
`insolvencia-watch.ts`), not captured from the live portal.

Because of that, the parser (`api/src/legal/citius-mandatarios.ts`) is **deliberately
liberal** — header-keyed column mapping (tolerant of reordered columns), quote/attribute-order
tolerant hidden-field extraction, and an honest `{ ok:false, error:'…indisponível' }` on any
page it does not positively recognise. When the first real-account snapshot arrives, the
expectation is a **fixture swap**, not a parser rewrite. All live-shape assumptions for the
mandatários flow are confined to that one module and this directory.

The files are stored as genuine **ISO-8859-1 (latin1) bytes** with a `charset=iso-8859-1`
meta tag, matching how the real portal serves them, so tests exercise the real charset-decode
path (`decodeHtml`).

## Files

| File | Purpose |
| --- | --- |
| `login.html` | Login form: `__VIEWSTATE` + `__VIEWSTATEGENERATOR` + `__EVENTVALIDATION` + `__EVENTTARGET` + `__EVENTARGUMENT` hidden state, the `#txtUserName` / `#txtUserPass` / `#ImBtnLogin` selectors, and a synthetic WAF-challenge script. Feeds `parseHiddenFields`. |
| `inbox-get-p1.html` | Inbox page 1, GET-addressable paging (`?page=N`). Two rows; one with an attached document link, one without. Each row carries a **per-row source id** (a hidden `<input value="…">` inside the processo cell) that `extractSourceId` reads and `notificacaoRef` uses verbatim as the dedup ref. |
| `inbox-get-p2.html` | Inbox page 2, GET paging, with **columns deliberately reordered** (Data before Processo) to prove header-keyed mapping. Row carries a per-row source id. |
| `inbox-postback.html` | Inbox with a WebForms `__doPostBack(...,'Page$N')` pager. Row carries a per-row source id. |
| `inbox-empty.html` | The real notifications table present (header row) with **zero data rows** — a genuinely empty inbox, which must parse to `ok:true rows:[]`, never an error. |
| `error.html` | An unavailable/maintenance page (no notifications table) — must parse to `ok:false 'indisponível'`. |

## Per-row source id and the dedup contract

Dedup keys each notification on `ref`. When a row exposes its **own stable id** — here a hidden
`<input value="…">`, and in the real portal possibly a select checkbox value, a `data-*` / row
id, or an open-notification link — `extractSourceId` captures it as `sourceId` and `ref` **is**
that id verbatim, so two *content-identical* notifications never collide. Only when a row exposes
**no** per-row id does `ref` fall back to a content hash of processo|data|tribunal|ato|documentoRef.

**Residual spike:** if the first real snapshot shows the portal exposes **no** per-row id, two
content-identical notifications would then share a ref and one would be silently dropped. That is
a pinned first-real-account risk (SPIKE #5 in `citius-mandatarios.ts`); its backstop is the
completeness reconciliation's **count-check** downstream (a dropped row surfaces as a count
mismatch), not this parser. Confirm the real per-row id shape and swap these fixtures accordingly.

## Guesses to confirm against the first real snapshot (first-real-account spike)

The exact column headers/order, the documento-cell shape (link vs icon vs token), the pager
markup (GET vs `__doPostBack`), the empty-inbox rendering (header-with-empty-template vs no
table at all), the **per-row source id** shape, the WAF challenge shape, and the session/cookie
lifetime are all **assumptions encoded here**. Confirm and adjust these fixtures once a real
account is available. See the `FIRST-REAL-ACCOUNT SPIKE` block in
`api/src/legal/citius-mandatarios.ts`.
