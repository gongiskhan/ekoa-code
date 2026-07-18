DESIGN: clean

> Verdict history: `issues` (initial, 6 findings) -> `issues` (re-audit of `2d5399f`, 5 closed, finding 2
> regressed + 2 new) -> **`clean`** (re-audit 2 of `fcaaa83`, all closed). The audit trail below is kept
> in full and in order; the current verdict is the `## Re-audit 2` section at the end.

# S4b design audit - `/settings/api-keys`

Run `20260717-071930-d1244839`. Judged the LIVE page (real UI login, admin) at desktop 1440x900 and
narrow 390x844, against the platform's own conventions as exhibited by `/settings/devices` (sibling
settings page) and `/users` (the direct analogue: entity list + status + destructive row action).

Evidence in this folder. Driver: `design-audit-driver.mjs` (standalone, re-runnable, not part of the
e2e suite). Geometry below is measured from the live DOM, not eyeballed.

| Screenshot | State |
|---|---|
| `design-desktop.png` | 1440x900, list as first met |
| `design-desktop-show-once.png` | show-once panel after minting |
| `design-desktop-revoke-confirm.png` | inline revoke confirm open |
| `design-desktop-list-mixed.png` | list with active + revoked rows |
| `design-mobile.png` | 390x844, list |
| `design-mobile-show-once.png` | 390x844, show-once panel |
| `design-mobile-revoke-confirm.png` | 390x844, inline revoke confirm open |
| `design-mobile-list-mixed.png` | 390x844, mixed list |
| `reference-devices-desktop.png` / `-mobile.png` | sibling settings page |
| `reference-users-table-desktop.png` | canonical platform data table |

Verdict is **issues**: six findings, two of them structural (the table escapes its card in a state
reachable at both widths; the narrow viewport hides the primary action). The show-once panel - the
part the rubric weights most - is the strongest thing on the page and passes.

---

## 1. Visual hierarchy - PASS (one note)

`PageHeader icon={KeyRound} title description` matches `/settings/devices` exactly (same component,
same teal-600 icon, same `font-display text-2xl` title, same `text-sm text-neutral-500` description).
Card grouping is sensible and correct: mint form / show-once / list, in flow order, show-once
appearing between mint and list so it lands where the eye already is.

Note (not an issue): the show-once heading is `text-base font-semibold` - byte-identical to the list
card's "As suas chaves". The one irreversible moment carries the same heading weight as the routine
list; it is differentiated only by its border. It still reads as distinct (see §3), so this passes,
but the heading is not doing any of that work.

## 2. Spacing + alignment - ISSUE (mint form), rest PASS

**Issue 3 (below): the mint form is an orphan.** Measured at 1440 (`design-desktop.png`):

```
mintCard   w=672   (max-w-2xl)
mintInput  w=192   <- intrinsic, not filled
mintButton w=108.7
dead space to the right of the button: 439px
```

`Input` renders `w-full` (`fieldClasses`) but is dropped into `<div className="flex items-end gap-2">`
with no `wrapperClassName="flex-1"`. Its wrapper is therefore a shrink-to-fit flex item, so `w-full`
resolves against the input's intrinsic ~192px and the form occupies 233 of 672 available px. The card
reads as unfinished - two thirds empty. `reference-devices-desktop.png` is the platform's answer: the
input **fills** its card and the actions sit on their own row beneath it.

Baseline alignment itself is **correct**: `items-end` bottom-aligns input and button at y=257
(button h=36 vs input h=38, tops differ by 2px). That is the right call given the label sits above
the input. Not a finding.

Card gaps are uniform **32px** and match the sibling. Note: every `mt-4` on this page is inert -
Tailwind v4's `space-y-8` puts `margin-block-end: 32px` on non-last children (measured
`cardMargins: [{mt:0,mb:32},{mt:16,mb:0}]`), and the list card's own 16px `mt-4` collapses against
that 32px. Zero visual impact; the author's intended 16px grouping simply never happens. Dead code,
observation only.

## 3. The show-once panel - PASS

The best-executed part of the page, and it does read as the one irreversible moment
(`design-desktop-show-once.png`):

- `border-teal-600` lifts it off the two plain `border-line` cards around it - unmistakably distinct.
- The warning is visually distinct: `text-amber-700`, directly under the title, above the secret.
- The secret is legible: mono on `bg-neutral-100`, `flex-1`, with the copy button bottom-aligned.
- The config snippet is legible on the dark block: `bg-neutral-900` + `text-neutral-100` mono `text-xs`
  is high contrast and clearly a code block.
- The dismiss button reads as an acknowledgement ("Já guardei a chave"), not a dismissal. Good.

At 390 (`design-mobile-show-once.png`) the `pre` clips at the card's padding edge but is
`overflow-x-auto`, and the copy button is right there - acceptable degradation.

Observation: the border is brand-teal (the platform's success/accent tone) while the copy is a
warning. `ui/badge.tsx` defines `warning: amber` for exactly this semantic. A teal frame around
"Esta chave não volta a ser mostrada" is a slightly mixed signal. It works, so not an issue.

## 4. Table readability - ISSUE at both widths

### Issue 1 - the revoke confirm bursts the table out of its card (desktop AND narrow)

Measured, `1440x900`, confirm open (`design-desktop-revoke-confirm.png`):

```
card_clientW      670
table_scrollW     724     (630 when idle)
card_overflowX    visible <- nothing clips it
table_escapesCard true
overhang          73.3px past the card's right border
```

This is visible in the screenshot: the row separator lines run **past the card's rounded right
border** into the page background, and the "Cancelar" button renders **outside the card entirely**.
At 1440px. On a page whose card is only half full.

Cause is twofold. `revokeConfirm` is a 76-character sentence ("Revogar esta chave? As ferramentas que
a usam deixam de funcionar de imediato.") rendered inline inside a right-aligned `<td>`, where it
wraps into **nine ragged lines** and blows the row to 164px; and the hand-rolled `<table>` sits in a
`Card` with no overflow handling, so the surplus width has nowhere to go. Opening the confirm also
reflows every column (Nome 142.7 -> ~80, "Nunca usada" starts wrapping in every row) - the table
visibly jumps on click.

The platform already solved this: `useConfirm()` from `ui/confirm-dialog.tsx`, used by **10** modules
including `settings/platform`, `users`, `automations`, `memory`, `usage`. A destructive confirm is a
dialog here, not a paragraph in a table cell.

### Issue 2 - narrow viewport hides the primary action

Measured, `390x844` (`design-mobile.png`, `design-mobile-revoke-confirm.png`):

```
card_clientW             340
table_scrollW            546      <- 6 columns
table escapes card by    224.8px
shell_scrollW/clientW    591 / 390  -> shell_scrollsHorizontally: true
doc_scrollW/clientW      390 / 390  -> document itself does NOT overflow
```

The rubric's literal bar ("no horizontal overflow of the page itself") **passes** - `documentElement`
never overflows. But the defect is the same in practice: `PageShell` is `overflow-y-auto`, which
computes `overflow-x` to `auto`, so the surplus scrolls *the whole shell*. Consequences at 390px:

- `Estado` and `Revogar` are off-screen. The page's primary action is invisible and there is no scroll
  affordance on the card to hint otherwise.
- Reaching them drags the entire shell sideways: in `design-mobile-revoke-confirm.png` the PageHeader
  is scrolled to a bare "I", the description is cut, and the mint card is sliced in half - while the
  table's own content renders *outside* the list card's right border. `mintCard.x` measures **-177**.
- The confirm buttons themselves end up beyond the viewport, so the flow cannot be completed.

### Issue 4 - the table bypasses the platform's table primitive

`ui/table.tsx` (`Table/THead/TH/TBody/TR/TD`) is live convention - **5** consumers: `users`, `orgs`,
`usage`, `registo`, `pedidos`. `/settings/api-keys` is the only page in the product that hand-rolls a
`<table>` for a data list. Compare `reference-users-table-desktop.png` against `design-desktop.png`:

| | canonical (`ui/table`) | api-keys (hand-rolled) |
|---|---|---|
| container | `overflow-hidden rounded-xl border` - self-carding, clips overflow | raw `<table>` in a `Card`, `overflow: visible` |
| header | `bg-neutral-50` band, `text-[11px] font-semibold uppercase tracking-wider text-neutral-400` | no band, `text-sm font-medium text-neutral-500` sentence-case |
| rows | `divide-y divide-neutral-100` | `border-t border-neutral-200` |
| cells | `px-4 py-3` | `py-2 pr-3` |
| row action | `IconButton` ghost, icon-only | full-text `Button` + icon |

The two tables read as different products. Adopting `Table` also fixes Issues 1 and 2 for free - its
wrapper is `overflow-hidden`, so the table can never escape again.

Also ragged: row heights alternate 57 / 77 / 164px as labels wrap in the cramped 142px `Nome` column,
and the `Última utilização` header wraps to two lines while its five neighbours stay on one.
Content-driven, but the cause is six columns crammed into 632px.

## 5. States - ISSUE (status tone), rest PASS

Pass: the disabled mint button is visibly muted (50% opacity, `design-desktop.png` - "Criar chave"
greyed with an empty label field), `loading` swaps in a `Spinner` and the copy flips to "A criar...",
the revoke in-flight guard disables every other revoke, and the confirm affordance is understandable
in isolation - the sentence, the destructive `danger-ghost` "Revogar", the neutral "Cancelar".

### Issue 5 - status is bare text, not a Badge, and the tone is inverted

`design-desktop-list-mixed.png`. Two problems:

- **Not badges.** `Ativa` / `Revogada` are bare coloured `<span>`s. `ui/badge.tsx` is live convention
  with **15** consumers; `/users` - the direct analogue - uses `<Badge>` pills for exactly this column.
  Bare text next to the canonical pills reads as unstyled.
- **The tone is backwards.** Revoked keys shout in `text-red-600` while active keys whisper in
  `text-teal-700`. Revoked is an inert, *desired* terminal state the operator chose - not an error. A
  list of seven revoked keys is a wall of red that scans as "seven things are wrong here", pulling the
  eye to the least important rows and away from the live ones. `Badge` already has the right tones:
  `neutral` (grey) for retired, `success`/`brand` for active.

### Issue 6 - narrow: the mint button wraps

At 390 the button grows to **h=56** (two lines, "Criar / chave") against the input's h=38. `items-end`
bottom-aligns them, so the button towers 18px above the input - unbalanced (`design-mobile.png`).

## 6. PT-PT copy - PASS

Professional, correct, consistent with the sidebar and `/settings/devices`. No typos, no
anglicisms, correct accents and enclitics throughout ("Guarde a sua chave agora", "Esta chave não
volta a ser mostrada", "Defina estas variáveis de ambiente na máquina onde corre a ferramenta",
"Já guardei a chave", "Nunca usada"). Tone matches the sibling's register. `subtitle` correctly
discloses the billing consequence. `copyFailed` gives a real fallback instruction rather than an
apology. Nothing to fix.

Observation - **dates render US-format**: `Criada` shows `7/17/2026` on a PT-PT page (`fmt` calls
`new Date(iso).toLocaleDateString()` with no locale, so it follows the browser). Correct would be
`17/07/2026`. Per the rubric this is an **observation, not an issue**: `/users` - the closest sibling -
does the identical bare `toLocaleDateString()` at lines 714/718. But the platform is split: 10+
modules (`knowledge`, `privacy/ledger`, `privacy/approved-commands`, `billing-warning-banner`,
`SessionConnectPanel`) explicitly pass `'pt-PT'`. Worth a platform-wide sweep as its own change, not
this slice's to carry alone.

## 7. Emoji / icons - PASS

No emoji anywhere - source or rendered. Icons are lucide throughout (`KeyRound`, `Copy`, `Check`,
`ShieldOff`), consistently sized via the shared primitives: `h-5 w-5` teal-600 in `PageHeader`,
`h-4 w-4` via `Button`'s `icon` prop at `md`. Matches `/settings/devices` (`MonitorSmartphone`,
`Check`, `X`). Clean.

---

## Findings, ranked

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **high** | Revoke confirm bursts the table 73.3px out of its card at 1440; "Cancelar" and row borders render outside the card. 76-char sentence inline in a `<td>` wraps to 9 lines, row -> 164px, whole table reflows on click. Use `useConfirm()` (10 consumers). | `design-desktop-revoke-confirm.png` |
| 2 | **high** | At 390 the table overruns its card by 224.8px: `Estado` + `Revogar` off-screen with no affordance; reaching them scrolls the whole `PageShell` (591>390), dragging header and mint card away; confirm buttons unreachable. Document itself does not overflow. | `design-mobile.png`, `design-mobile-revoke-confirm.png` |
| 3 | **medium** | Mint form orphaned: 192px input in a 672px card, 439px dead space. `Input` needs `wrapperClassName="flex-1"`. Sibling fills its card. | `design-desktop.png` vs `reference-devices-desktop.png` |
| 4 | **medium** | Only page in the product hand-rolling a `<table>`; header/cell/row treatment unlike the 5 pages using `ui/table`. Adopting it also fixes 1 and 2 (`overflow-hidden`). | `design-desktop.png` vs `reference-users-table-desktop.png` |
| 5 | **medium** | Status is bare coloured text, not `Badge` (15 consumers; `/users` badges this exact column), and the tone is inverted - inert revoked rows shout red, live keys whisper teal. | `design-desktop-list-mixed.png` |
| 6 | **low** | At 390 the mint button wraps to two lines (h=56 vs input h=38), towering 18px above it. | `design-mobile.png` |

**Observations (no action required):** US date format (sibling `/users` does the same; platform split);
every `mt-4` inert under Tailwind v4 `space-y-8` (no visual impact); show-once border is brand-teal
where the copy implies the amber warning tone; `max-w-2xl` cards left-aligned in a `max-w-5xl` shell
(same as `/settings/devices`, consistent).

The single highest-leverage fix is adopting `ui/table` + `useConfirm()`: that closes 1, 2 and 4 at
once and pulls the page back onto the platform's rails.

---

# Re-audit (fix `2d5399f`)

Re-driven live at both widths. Driver: `re-design-audit-driver.mjs`. Screenshots `re-*.png`.
Zero console errors at both widths.

**Verdict stands at `issues`.** Five of six findings are genuinely closed, and the date observation
was fixed too - good work. But **finding 2 is not closed: it changed shape and got worse**, and the
same root cause now also bites at desktop. My own §4 advice ("adopting `Table` also fixes Issues 1
and 2 for free - its wrapper is `overflow-hidden`, so the table can never escape again") was half
wrong, and this is the correction: `overflow-hidden` stops the escape by *destroying* the overflow
rather than by making it fit. The table still does not fit its container.

## Closed

| # | Was | Now | Evidence |
|---|---|---|---|
| 1 | confirm burst the table 73.3px out of its card | platform `useConfirm()` danger dialog: 384x183, `centeredWithin: 0`, `withinViewport: true`, dimmed backdrop, red `Revogar` + neutral `Cancelar`. Nothing touches the table. | `re-design-desktop-revoke-dialog.png` |
| 3 | input 192px in a 672px card, 439px dead space | `wrapperClassName="flex-1"` - input **513.3px**, button 108.7px, together they fill the card to its padding edge | `re-design-desktop.png` |
| 5 | bare coloured text, tone inverted | `Badge` pills (`border-radius: 9999px`). Active = teal-50 bg / teal-700 + dot; revoked = neutral-100 / neutral-600. Tone correctly un-inverted - live keys now read louder than retired ones. | `re-design-desktop-list-mixed.png` |
| 6 | mint button wrapped to 2 lines at 390 (h=56) | `whitespace-nowrap` - **h=36** at both widths, bottom-aligned with the input | `re-design-mobile.png` |
| obs | `7/17/2026` (US) | **`17/07/2026`** under the PT locale | `re-design-desktop-list-mixed.png` |

**4 - partially closed.** The primitives *are* adopted and the chrome is now canonical, measured:
`thead` background neutral-50; `th` = `11px / 600 / uppercase / 0.55px tracking / neutral-400 /
padding 10px 16px`; `divide-y` rows. Side by side with `reference-users-table-desktop.png` it is now
the same product. The `hidden sm:table-cell` collapse of Criada/Última utilização works (6 headers at
1440 -> 4 at 390). What is *not* closed is the consequence below: adopting the primitive without
making the content fit it converted an overflow into a clip.

## Still open

### Finding 2 - NOT closed. The narrow viewport now hides the primary action outright.

Measured at 390x844, default state, no interaction:

```
wrap_clientW          340
table_scrollW         490      -> 150px of table has nowhere to go
wrap_overflowX        hidden   -> clipped, not scrolled
revoke button left    387.4    -> past the wrapper's right edge (366)
revoke_entirelyHidden TRUE
shell_scrollsHorizontally  false
doc_overflows              false
anyScrollableAncestor      null   -> nothing on the page scrolls horizontally
```

`re-design-mobile.png` is the proof: the `Ativa` row has **no Revogar button at all**. The rubric's
literal bar now passes - the document does not overflow, the shell no longer drags - but the page's
primary destructive action is simply not present at 390px, and there is no scrollbar, no fade, no
affordance suggesting anything was truncated. It reads as a read-only list.

Before the fix the shell scrolled: ugly, it dragged the header sideways, but the button was
*reachable*. Now it is not. `overflow-x: hidden` is scrollable **programmatically but not by any
user gesture** - no scrollbar, no touch panning. Verified:

```
wrap_overflowX  "hidden"   wrapCanScroll  true    (scrollW 490 > clientW 340)
before: revokeLeft 387.4   revokeVisibleToUser FALSE
scrollIntoView() -> wrapper scrolls 134px, revoke arrives at 253.4  (a keyboard Tab, or Playwright)
after:  firstColHeaderVisible FALSE   firstColLeft -109
```

So the only way a human reaches the button is Tab-focusing it - and when the wrapper scrolls to
reveal it, the `Nome` column is pushed to **x = -109**, clipped off the left. That is the state
captured in `re-design-mobile-list-mixed.png`: `NOME` gone, `CHAVE` cut to `_gk_...uvRI`. The
operator is then one click from an irreversible revoke **with the key's name off-screen** - and the
dialog says only "Revogar esta chave?" without naming it. That is a safety problem, not just a
layout one.

Note for the suite: the committed spec passes this because Playwright auto-scrolls elements into
view before clicking, which reaches a button a human cannot. A spec cannot catch this class of
defect; only the screenshot can.

### New at desktop - the same cause, smaller. The Revogar button is shaved at 1440.

```
wrap_clientW  670    table_scrollW  703   -> 33px over
table.right   978.1  clip at 945          -> 33.1px clipped
revoke button 851 -> 962.1                -> 17.1px past the clip
anyScrollableAncestor  null
```

Visible in `re-design-desktop-list-mixed.png` and behind the dialog in
`re-design-desktop-revoke-dialog.png`: the `Revogar` buttons are cut mid-shape at the card's right
border, losing their right padding and rounded corner - red slivers against the edge. This did not
happen before the fix (the old raw table was `overflow: visible`, so it escaped but stayed whole).
At 1440, on a card that is otherwise half empty.

**Root cause of both.** `ui/table` is dimensioned for the shells its five other consumers give it -
`/users` runs it in a `max-w-7xl` (~1362px) page and uses **icon-only `IconButton`** row actions.
Here the same primitive is squeezed into a `max-w-2xl` (672px) card while keeping a **full-text**
`Revogar` button: the action column measures 143.1px (111.1 button + 32 cell padding). Six columns
of `px-4` padding alone spend 192px. Needed 703 / available 670 at desktop; needed ~490 / available
340 at narrow.

**Fixes, cheapest first** (none require touching the shared primitive):

1. `IconButton` (icon-only, `label="Revogar"`) for the row action, exactly as `/users` does - the
   action column drops ~143 -> ~68, table ~703 -> ~628 < 670. Closes the desktop clip outright.
2. Narrow still needs ~415 in 340. Collapse `Chave` below `sm` too (the label already identifies the
   row), or drop to the platform's `ListRow` card-per-row below `sm`. Either keeps `Nome` on screen,
   which is what makes the revoke safe.
3. Widen the list container - the shell allows `max-w-5xl` (1024) and the list is capped at
   `max-w-2xl`. Helps desktop only; narrow is unaffected.

Do **not** answer this by switching `ui/table`'s wrapper to `overflow-x-auto`: that is a shared
primitive with five other consumers, and a horizontally-scrolling table would still hide `Nome`
during a destructive confirm.

### Minor, new - dialog copy stutters

`re-design-desktop-revoke-dialog.png`: title **Revogar**, body **"Revogar esta chave?** As
ferramentas que a usam deixam de funcionar de imediato.", confirm button **Revogar**. The word
appears three times in a 384x183 box. `revokeConfirm` was written as standalone inline text where
the leading question carried the whole prompt; as a dialog description under a `Revogar` title it
is redundant. Suggest title `Revogar chave`, description `As ferramentas que a usam deixam de
funcionar de imediato.` - and, per the safety point above, name the key in it.

## Re-audit findings, ranked

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 2 | **high** | At 390 the revoke button is entirely absent (`revoke_entirelyHidden: true`, left 387.4 vs clip 366) with nothing scrollable on the page. Reachable only by Tab, which clips `Nome` to x=-109 - an irreversible revoke with the key unnamed on screen and in the dialog. | `re-design-mobile.png`, `re-design-mobile-list-mixed.png` |
| 7 | **medium** | At 1440 the table is 33px wider than its card; `overflow-hidden` shaves 17.1px off every `Revogar` button, cutting its padding and corner. | `re-design-desktop-list-mixed.png` |
| 8 | **low** | Revoke dialog says "Revogar" three times and never names the key. | `re-design-desktop-revoke-dialog.png` |

Closing 2 and 7 is one change: icon-only row action (+ one more collapsed column below `sm`). The
rest of the page - dialog, mint form, badges, table chrome, dates, PT-PT copy, show-once panel - is
now at the platform's bar.

---

# Re-audit 2 (fix `fcaaa83`) - DESIGN: clean

All three residuals closed. Driver: `re2-design-audit-driver.mjs`. Screenshots `re2-*.png`.
Zero console errors at both viewports.

Both open findings were one root cause - "the content does not fit its container" - so this pass
measured the **tightest reachable states**, not just the two nominal viewports. That matters here:
the worst case is not 390 or 1440 but the `md` boundary at **768**, where all six columns switch on
while the card is still capped at `max-w-2xl`. Also probed the `sm` boundary and a `maxLength=64`
label, since the input permits one.

`table_scrollW` now equals `wrap_clientW` **exactly at every breakpoint** - the table fits its card
rather than being clipped into it:

| viewport | columns | card | table | over | clipped | revoke |
|---|---|---|---|---|---|---|
| 1440 | 6 | 670 | **670** | **0** | no | x 893-929, 16px inside the edge |
| 768 (`md` boundary, worst case) | 6 | 634 | **634** | **0** | no | inside |
| 767 | 4 | 670 | **670** | **0** | no | inside |
| 640 (`sm`) | 4 | 590 | **590** | **0** | no | inside |
| 390 | 3 (Nome/Estado/action) | 340 | **340** | **0** | no | x 313-349, inside |
| 390, 64-char label | 3 | 340 | **340** | **0** | no | inside |

At every width: `shell_scrollsH: false`, `doc_overflows: false`, `revoke_insideCard: true`, and a
centre-point hit test on the action returns `button` - the click lands on the control itself, nothing
overlaps or clips it.

## Findings closed

- **2 (high) - narrow hides the primary action.** CLOSED. At 390 the columns collapse to
  Nome / Estado / action and the revoke sits at x 313-349, fully inside the 340px card, tappable at
  36x36. `re2-design-mobile.png`: the red `ShieldOff` is plainly visible on every active row, card
  border intact, nothing clipped, nothing scrolls. The safety half is closed too - `Nome` now stays
  on screen while revoking, and both the `aria-label` ("Revogar chave-do-portatil-...") and the
  dialog name the key.
- **7 (medium) - desktop shave.** CLOSED. The icon-only `IconButton` drops the action column from
  143.1px to 68px: table 703 -> **670**, exactly its card. `re2-design-desktop-list-mixed.png` -
  the revoke icons sit 17px clear of the border, whole, with their padding and corner intact.
- **8 (low) - dialog never named the key.** CLOSED. Now reads
  "**re2-mrev-mroum9gi**: Revogar esta chave? As ferramentas que a usam deixam de funcionar de
  imediato." (`re2-design-mobile-revoke-dialog.png`), centred and within the viewport at both widths.

The `maxLength=64` edge case holds: the label wraps to four lines inside the `Nome` column, badge and
action keep their positions, nothing overflows (`re2-design-mobile-long-label.png`).

## Observations (logged, not blocking)

None of these is a defect; each is either a constraint the platform's own siblings share or a
preference. Recording them so they are decided rather than forgotten.

1. **Dialog still says "Revogar" three times** - title, body ("...: Revogar esta chave?"), confirm
   button. The substantive gap (naming the key) is closed and the copy is unambiguous; the
   redundancy is a preference. `title: "Revogar chave"` + description
   `"<label>: as ferramentas que a usam deixam de funcionar de imediato."` would read tighter.
2. **Row rhythm at desktop.** "Nunca usada" wraps to two lines in every row and "Última utilização"
   wraps in the header, while ~430px of page sits empty to the right of the `max-w-2xl` card
   (rows alternate 65/85px). It fits and is legible, and narrow settings cards are the sibling
   convention (`/settings/devices`), but no sibling puts a six-column table in one - `/users` gives
   its table a `max-w-7xl` shell. `max-w-4xl` on the list container would settle the rhythm without
   touching the mint card.
3. **No hover tooltip on the icon-only action.** `IconButton` sets `aria-label` but not `title`, so
   sighted mouse users get no text for the `ShieldOff` icon. Platform-wide - `/users` row actions are
   identical - so not this page's to fix alone.
4. **Revoke lost its spinner.** `IconButton` has no `loading` prop, so in-flight feedback is now the
   `disabled` 50% opacity rather than a spinner. Same constraint on every `/users` row action. The
   in-flight guard itself is intact (`disabled={revokingId !== null}`).
5. **Tap target 36x36** - under the 44x44 touch guideline, but above the platform's own bar
   (`/users` uses `size="sm"` = 28x28).

## Final state

Every rubric line passes. Hierarchy and `PageHeader` match the siblings; the mint form fills its card
with the input and button bottom-aligned; the show-once panel still reads as the one irreversible
moment (teal frame, amber warning, legible mono secret, high-contrast dark config block); the table
is canonical chrome that fits at every breakpoint and degrades by collapsing columns rather than
hiding the action; badges are correctly-toned pills; the destructive path is a centred dialog that
names its target; dates are `17/07/2026`; the PT-PT copy is professional throughout; no emoji, lucide
icons at consistent sizes. Three rounds, nine findings, all closed.
