/**
 * Template variable interpolation shared across step executors.
 *
 * Supported placeholders:
 *   {{input.<name>}}            — value from automation.inputs at runtime
 *   {{capture.<name>}}          — value from prior-step captures (e.g. lastScreenshot, extractedInputs)
 *   {{integration.<key>.<f>}}   — credential field from a connected integration (resolved by callers
 *                                  that have integration context, e.g. api_call executor)
 *   {{event.<dot.path>}}        — value from a trigger event payload (webhook/listener runs only).
 *                                  Supports nested dot paths, e.g. {{event.data.object.id}}.
 *
 * Callers that don't need integration/event interpolation can pass undefined.
 *
 * CREDENTIAL BOUNDARY: `inputs.credentials` is the engine's credential
 * channel (integration-launched runs with passCredentials). NOTHING under it
 * may ever be substituted into a template — templates feed step descriptions
 * (vision prompts), argv, URLs, and logs. Any `{{input.credentials...}}`
 * reference, with or without a sub-path, is redacted to the empty string.
 *
 * Ported as-is from the old Cortex automation family (carryover-audit A8): pure, zero-import.
 */

export function applyArgsTemplate(
  template: Record<string, string>,
  inputs: Record<string, unknown>,
  captures?: Record<string, string>,
  integrations?: Record<string, Record<string, string>>,
  event?: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = interpolate(v, inputs, captures, integrations, event);
  }
  return out;
}

export function interpolate(
  template: string,
  inputs: Record<string, unknown>,
  captures?: Record<string, string>,
  integrations?: Record<string, Record<string, string>>,
  event?: unknown,
): string {
  return template
    // Redaction FIRST: any reference under input.credentials (flat, dotted
    // path, or bracket-indexed) becomes '' before the generic input pass
    // below can see it. See the credential-boundary note in the header.
    .replace(/\{\{\s*input\.credentials\s*(?:[.[][^}]*)?\}\}/g, '')
    .replace(/\{\{\s*input\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
      // Belt-and-braces: unreachable for 'credentials' after the redaction
      // pass, kept so a future regex tweak can't silently reopen the hole.
      if (name === 'credentials') return '';
      const v = inputs[name];
      return v == null ? '' : String(v);
    })
    .replace(/\{\{\s*capture\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
      const v = captures?.[name];
      return v == null ? '' : v;
    })
    .replace(/\{\{\s*integration\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, key, field) => {
      const v = integrations?.[key]?.[field];
      return v == null ? '' : v;
    })
    .replace(/\{\{\s*event\.([a-zA-Z0-9_.[\]]+)\s*\}\}/g, (_, path: string) => {
      if (event == null) return '';
      const v = readPath(event, path);
      return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
}

/**
 * Read a dot/bracket path from a deeply-nested object. Supports both
 * `a.b.c` and `a.b[0].c` forms. Returns undefined for any missing leg.
 */
function readPath(root: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
