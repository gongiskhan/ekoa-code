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
| `inbox-get-p1.html` | Inbox page 1, GET-addressable paging (`?page=N`). Two rows; one with an attached document link, one without. |
| `inbox-get-p2.html` | Inbox page 2, GET paging, with **columns deliberately reordered** (Data before Processo) to prove header-keyed mapping. |
| `inbox-postback.html` | Inbox with a WebForms `__doPostBack(...,'Page$N')` pager. |
| `inbox-empty.html` | The real notifications table present (header row) with **zero data rows** — a genuinely empty inbox, which must parse to `ok:true rows:[]`, never an error. |
| `error.html` | An unavailable/maintenance page (no notifications table) — must parse to `ok:false 'indisponível'`. |

## Guesses to confirm against the first real snapshot (first-real-account spike)

The exact column headers/order, the documento-cell shape (link vs icon vs token), the pager
markup (GET vs `__doPostBack`), the empty-inbox rendering (header-with-empty-template vs no
table at all), the WAF challenge shape, and the session/cookie lifetime are all **assumptions
encoded here**. Confirm and adjust these fixtures once a real account is available. See the
`FIRST-REAL-ACCOUNT SPIKE` block in `api/src/legal/citius-mandatarios.ts`.
