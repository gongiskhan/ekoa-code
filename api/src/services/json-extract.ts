/**
 * Lenient first-JSON-object extraction from model text output. Strips markdown code
 * fences, then balanced-brace-scans (string/escape aware) for the first complete
 * object and JSON.parses it. Returns null for anything unusable — callers own the
 * "no JSON" decision (a structured failure, never a throw).
 *
 * Homed in services/ because multiple agent surfaces parse model JSON this way
 * (automation planner/vision, brand research); services/ is importable by all of them.
 */
export function parseFirstJsonObject(text: string): unknown {
  if (!text) return null;
  const fenceless = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```\s*$/g, '');
  const start = fenceless.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < fenceless.length; i++) {
    const ch = fenceless[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;

  try {
    return JSON.parse(fenceless.slice(start, end + 1));
  } catch {
    return null;
  }
}
