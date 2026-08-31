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
 *   {{config.<key>}}            - a NON-SECRET config value of the integration that launched the
 *                                  run (`IntegrationConfig.publicConfigValues`, the projection
 *                                  stored in plaintext beside the ciphertext). This is how a
 *                                  package's own `configSchema` reaches an automation template:
 *                                  a per-tenant portal address, an account subdomain, a region.
 *
 * WHY `config.` AND NOT THE BARE `{{portal_url}}` THE HTTP PATH USES. In `httpConfig` a bare
 * placeholder means an ARG in some packages and a CONFIG FIELD in others (`action-consent.ts`
 * resolves bare names against `publicConfigValues`; the shipped citius package writes
 * `{{numeroProcesso}}` for an arg in the same file). That ambiguity is survivable in a URL template
 * whose vocabulary is small and fixed. It is not survivable HERE, where the same string is also fed
 * to a vision model AS AN INSTRUCTION: every other channel in this file is explicitly prefixed, and
 * a config value that silently resolved as an argument (or the reverse) would change what the model
 * is told to do. So it is prefixed, like its four siblings.
 *
 * SECRET FIELDS ARE NOT IN THIS CHANNEL AT ALL. `publicConfigValues` is built by dropping every key
 * the schema marks `secret` (`integrations/service.ts`, `publicValuesOf`), so there is no secret for
 * a `{{config...}}` reference to reach. The credential channel stays `inputs.credentials`, and that
 * one is redacted below.
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
  config?: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = interpolate(v, inputs, captures, integrations, event, config);
  }
  return out;
}

export function interpolate(
  template: string,
  inputs: Record<string, unknown>,
  captures?: Record<string, string>,
  integrations?: Record<string, Record<string, string>>,
  event?: unknown,
  config?: Record<string, string>,
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
    })
    .replace(/\{\{\s*config\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_, name: string) => {
      const v = config?.[name];
      return v == null ? '' : v;
    });
}

/**
 * Resolve the TEMPLATED TEXT OF ONE STEP for the run that is about to execute it.
 *
 * WHY THIS EXISTS, and it is a live defect rather than a nicety. Nothing interpolated a step's
 * `description`, `expectedOutcome` or `url` - anywhere in the engine. `engine.ts` passed
 * `step.description` straight to the vision resolver and `step.url` straight to `browser.act`, so a
 * template that said "introduzir o numero unico de processo '{{input.numeroProcesso}}'" instructed
 * the model to type those literal characters into the portal's search box, and a `navigate` step
 * could not be parameterised at all. Every shipped automation template naming an input in its prose
 * was affected (all four in the citius package). The failure is QUIET: the run completes, the model
 * does something plausible with the nonsense it was handed, and the answer is about the wrong thing.
 *
 * IT RETURNS A COPY, AND THE COPY IS FOR EXECUTION ONLY. The authored step keeps its placeholders,
 * because that array is what `persistRefinedSteps` writes back: resolving in place would bake one
 * run's arguments into the saved automation permanently, so the second run would search for the
 * first run's process number with nothing in the UI to explain why.
 *
 * THE CREDENTIAL BOUNDARY IS `interpolate`'s, unchanged and load-bearing here: `{{input.credentials}}`
 * and any path under it is redacted to the empty string before any substitution happens, so a step
 * description can never carry a decrypted secret into a model prompt, a URL, or a log.
 */
export function resolveStepTemplates<T extends { description?: string; expectedOutcome?: string; url?: string }>(
  step: T,
  inputs: Record<string, unknown>,
  config?: Record<string, string>,
  captures?: Record<string, string>,
): T {
  const sub = (v: string | undefined): string | undefined =>
    typeof v === 'string' && v.includes('{{') ? interpolate(v, inputs, captures, undefined, undefined, config) : v;
  const description = sub(step.description);
  const expectedOutcome = sub(step.expectedOutcome);
  const url = sub(step.url);
  // Identity when nothing moved: an untemplated step is the overwhelmingly common case and the
  // engine compares steps by reference in places, so allocating a copy per step per run buys nothing.
  if (description === step.description && expectedOutcome === step.expectedOutcome && url === step.url) return step;
  return {
    ...step,
    ...(description === undefined ? {} : { description }),
    ...(expectedOutcome === undefined ? {} : { expectedOutcome }),
    ...(url === undefined ? {} : { url }),
  };
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
