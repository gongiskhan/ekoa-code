/**
 * services/portal-forms.ts — pure HTML helpers for a server-side form login: read the hidden
 * inputs (and the form's POST target) out of a login page so they can be echoed back verbatim, and
 * a conservative "does this still look like a login page" detector for success/failure classifying.
 *
 * Pure and dependency-free — no DOM, no network. Tolerant of attribute order and quote style. This
 * is a SEPARATE, self-contained parser from `legal/portal-html.ts` (which serves the metadata-only
 * CITIUS sync rail and lives at a higher tier `integrations/` cannot import). Keeping a small,
 * independently-tested copy here avoids a cross-tier import and keeps the two rails decoupled.
 */

/** The Latin-1 named HTML entities ASP.NET emits for accented text (ç, ã, á, …) plus the common
 *  punctuation. Not exhaustive of HTML5's thousands of names — the set a Portuguese court/WebForms
 *  page actually uses. Numeric entities (&#nnn; / &#xNN;) are handled separately and cover the rest. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Ccedil: 'Ç',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Euml: 'Ë', Iacute: 'Í', Igrave: 'Ì', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ', Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü',
  ordf: 'ª', ordm: 'º', deg: '°', laquo: '«', raquo: '»', middot: '·', hellip: '…',
  ndash: '–', mdash: '—', euro: '€', copy: '©', reg: '®', trade: '™',
};

/** Decode HTML entities: numeric (&#nnn; / &#xNN;) and the Latin-1 named set above. `&amp;` last. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([A-Za-z]+);/g, (whole, name: string) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? (NAMED_ENTITIES[name] as string) : whole,
    );
}

/** Read one attribute's value off a tag's attribute string, tolerant of quote style and order. */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

/**
 * Every `<input type="hidden">` on the page as name -> value, entity-decoded. A browser re-submits
 * all of these verbatim; a WebForms POST that drops `__VIEWSTATE`/`__EVENTVALIDATION` is rejected.
 * Inputs without a name, or with an empty name, are skipped.
 */
export function parseHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  for (const tag of inputs) {
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    if (type !== 'hidden') continue;
    const name = attr(tag, 'name');
    if (!name) continue;
    out[decodeEntities(name)] = decodeEntities(attr(tag, 'value') ?? '');
  }
  return out;
}

/** The first `<form>`'s `action`, entity-decoded, or null when the page declares none. */
export function parseFormAction(html: string): string | null {
  const form = /<form\b[^>]*>/i.exec(html);
  if (!form) return null;
  const action = attr(form[0], 'action');
  return action ? decodeEntities(action) : null;
}

/**
 * A conservative "this is (still) a login page" probe used to classify a POST result: a portal that
 * REJECTS credentials re-renders the login form (HTTP 200), so a password field surviving the POST
 * is the failure signature. Looks for a password input OR a well-known login control id/name — not
 * a substring of arbitrary body text, so a page that merely links to "iniciar sessão" is not a
 * false positive.
 */
export function looksLikeLoginForm(html: string): boolean {
  if (/<input\b[^>]*\btype\s*=\s*["']?password["']?/i.test(html)) return true;
  return /\b(?:id|name)\s*=\s*["'][^"']*(?:txtUserPass|txtUserName|ImBtnLogin|Palavra-passe)[^"']*["']/i.test(html);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text content of the element whose id is exactly `id`, tags stripped and entity-decoded, or ''. */
export function textOfId(html: string, id: string): string {
  const m = new RegExp(`id="${escapeRe(id)}"[^>]*>([\\s\\S]*?)</`, 'i').exec(html);
  if (!m || m[1] === undefined) return '';
  return decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Extract the data rows of an ASP.NET DataGrid / GridView by the STABLE per-cell control-id pattern
 * `<...gridIdContains...>_ctl<NN>_<FieldSuffix>` that ASP.NET emits for named template columns. This
 * is generic (any ASP.NET grid whose cells carry named controls) and declarative — the caller passes
 * `gridIdContains` (a substring that identifies the grid, e.g. `dgNotificacoes`) and `fields`
 * (outputKey → the cell-control id suffix, e.g. `{ ato: 'NomeActo', data: 'DataElaboracao' }`). Returns
 * one object per data row, in document order, each carrying the declared fields plus `_row` (the ctl
 * index). Rows are discovered from whichever field appears — declare a field that is on every row
 * (e.g. the act name) first. Header rows (ctl00/ctl01, which carry no named cell controls) are
 * naturally excluded because they have none of the field ids.
 */
export function parseAspNetGridRows(
  html: string,
  gridIdContains: string,
  fields: Record<string, string>,
): Array<Record<string, string>> {
  const suffixes = Object.values(fields);
  if (suffixes.length === 0) return [];
  const discover = new RegExp(
    `id="([^"]*${escapeRe(gridIdContains)}[^"]*_ctl(\\d+)_)(?:${suffixes.map(escapeRe).join('|')})"`,
    'gi',
  );
  // Preserve document order and de-dupe by the row prefix.
  const seen = new Set<string>();
  const prefixes: Array<{ prefix: string; ctl: string }> = [];
  for (const m of html.matchAll(discover)) {
    const prefix = m[1];
    const ctl = m[2];
    if (prefix === undefined || ctl === undefined || seen.has(prefix)) continue;
    seen.add(prefix);
    prefixes.push({ prefix, ctl });
  }
  return prefixes.map(({ prefix, ctl }) => {
    const row: Record<string, string> = { _row: ctl };
    for (const [key, suffix] of Object.entries(fields)) row[key] = textOfId(html, prefix + suffix);
    return row;
  });
}
