/**
 * browser/capture.ts - the machine-side network recorder underneath discovery (slice P2.2).
 *
 * WHY THE CAPTURE HAPPENS HERE AND NOWHERE ELSE. The page lives on this machine, inside a persistent
 * authenticated profile. Cortex never sees the traffic, so the only place that can observe "which
 * private API does this portal's own UI call, and which header carries its session" is here. That
 * observation is the entire input to a compiled recipe: the first run watches the site talk to
 * itself, and every later run replays that conversation instead of re-driving the DOM.
 *
 * ── THE FIRST OF THE TWO REDACTION BOUNDARIES (trap T8) ──────────────────────────────────────
 *
 * A header VALUE never leaves this module. Not redacted - never constructed into anything that
 * leaves. `toWire()` builds `LocalBrowserCapture` frames whose shape has no field a value could
 * occupy, and the only place values exist at all is `live`, a per-origin map this module keeps in
 * memory so an injected replay can forward the header the site currently expects
 * (`headerValuesFor`). That map is dropped by `stop()` and by the lease's release, so it can never
 * outlive the authenticated jar it was read from.
 *
 * Bodies DO travel, because a response body is what teaches the shape a later replay must expect.
 * They pass an injected `redactBody` leg here (the daemon's outbound redactor, which knows the
 * credentials this machine was delivered) and the run's `SecretRegistry` on arrival hosted-side.
 * Two independent legs on purpose: this one knows what was DELIVERED to the machine, the hosted one
 * knows what the RUN resolved, and neither is a superset of the other.
 *
 * ── BOUNDS ARE NOT DECORATION ────────────────────────────────────────────────────────────────
 *
 * One page load on a real portal is hundreds of requests, some of them megabytes. The recorder is
 * bounded on three axes (exchanges, body chars, live header names) and reports `truncated` rather
 * than silently handing a learner a prefix it believes is whole. An unbounded recorder attached to
 * a long headed session is a memory leak on somebody's laptop.
 */
import type { LocalBrowserCapture } from '@ekoa/shared';

/** RFC 7230 token, bounded - the same grammar the recipe brands and the two stores re-prove. A key
 *  that is not a header name (an HTTP/2 pseudo-header, a mangled frame) is dropped, never forwarded. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

/** Per-body cap. A capture is evidence, not an archive, and it rides a websocket frame. Matches
 *  `MAX_CAPTURED_BODY_CHARS` hosted-side so a body is not truncated twice to two different lengths. */
export const MAX_CAPTURE_BODY_CHARS = 64 * 1024;

/** How many exchanges one armed lease may buffer before it starts dropping the OLDEST. Oldest-first
 *  because a discovery pass is driving toward a goal: the calls that matter are the ones nearest
 *  the outcome, and the page-load noise at the front is what a learner discards anyway. */
export const MAX_BUFFERED_EXCHANGES = 400;

/** How many distinct header names one origin may have live values remembered for. A page that sets
 *  a thousand header names is not a page a recipe can replay, and the map is the one place values
 *  exist. */
const MAX_LIVE_HEADER_NAMES = 64;

/** Only these resource types are recorded. A recipe replays the site's own API; recording every
 *  font, image and stylesheet would bury the signal and multiply the buffer by fifty. `document` is
 *  kept because a form POST that navigates IS the call on plenty of older portals. */
const RECORDED_RESOURCE_TYPES: ReadonlySet<string> = new Set(['xhr', 'fetch', 'document', 'websocket', 'other']);

/** The slice of Playwright's `Request` this module uses, as a structural type - so the unit lane
 *  drives the recorder with plain objects and no test needs a browser (`browser/types.ts` discipline). */
export interface CaptureRequest {
  url(): string;
  method(): string;
  resourceType(): string;
  headers(): Record<string, string>;
  postData(): string | null;
}

/** The slice of Playwright's `Response` this module uses. `text()` may reject (a body already
 *  consumed, a navigation that raced it); the recorder treats that as "no body", never as an error. */
export interface CaptureResponse {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  request(): CaptureRequest;
  text(): Promise<string>;
}

/** The slice of Playwright's `Page` this module attaches to. */
export interface CapturePage {
  on(event: 'response', handler: (response: CaptureResponse) => void): void;
  off?(event: 'response', handler: (response: CaptureResponse) => void): void;
  removeListener?(event: 'response', handler: (response: CaptureResponse) => void): void;
}

export interface NetworkRecorderDeps {
  /** The machine's outbound redactor leg. Default: identity, for a daemon with nothing delivered. */
  redactBody?: (text: string) => string;
  now?: () => number;
}

/**
 * One armed lease's recorder. Constructed by the tool executor when Cortex sends `captureOp:'start'`,
 * dropped on `stop` or on the lease's release.
 */
export class NetworkRecorder {
  private readonly buffered: LocalBrowserCapture[] = [];
  /** origin -> (lower-cased header name -> its CURRENT value). The one place values exist, and it
   *  never leaves this object: `toWire` cannot read it and the frame shape has no slot for it. */
  private readonly live = new Map<string, Map<string, string>>();
  private attachedTo: CapturePage | undefined;
  private handler: ((response: CaptureResponse) => void) | undefined;
  private readonly redactBody: (text: string) => string;

  constructor(deps: NetworkRecorderDeps = {}) {
    this.redactBody = deps.redactBody ?? ((t) => t);
  }

  /** Start listening. Idempotent per page: re-arming an already-armed recorder on the SAME page is a
   *  no-op rather than a second listener recording every exchange twice. */
  attach(page: CapturePage): void {
    if (this.attachedTo === page) return;
    this.detach();
    const handler = (response: CaptureResponse): void => {
      // The listener is synchronous and the body read is not, so the record is completed
      // asynchronously. A failure to read the body must never become an unhandled rejection on
      // somebody's daemon: it degrades to an exchange with no body, which is still a useful record.
      void this.record(response).catch(() => undefined);
    };
    page.on('response', handler);
    this.attachedTo = page;
    this.handler = handler;
  }

  /** Stop listening and FORGET the live header values. Called on `captureOp:'stop'` and on release. */
  detach(): void {
    const page = this.attachedTo;
    const handler = this.handler;
    if (page && handler) {
      const off = page.off?.bind(page) ?? page.removeListener?.bind(page);
      off?.('response', handler);
    }
    this.attachedTo = undefined;
    this.handler = undefined;
    this.live.clear();
  }

  /** Take everything buffered since the last drain. Draining EMPTIES: an exchange belongs to exactly
   *  one observation frame, so a step's captures are the ones its own act provoked. */
  drain(): LocalBrowserCapture[] {
    return this.buffered.splice(0, this.buffered.length);
  }

  /** How many exchanges are waiting. Exposed for the unit lane and the daemon's own diagnostics. */
  pending(): number {
    return this.buffered.length;
  }

  /**
   * The CURRENT value of each named header for `origin`, for an injected replay.
   *
   * This is the whole reason values are kept at all, and the reason the recipe can be valueless: the
   * recipe says "forward `x-csrf-token`", and the answer to "what is it right now?" is read here,
   * on the machine, from the live session. A name nobody has seen answers nothing - the replay then
   * sends the request without it rather than inventing one.
   */
  headerValuesFor(origin: string, names: readonly string[]): Record<string, string> {
    const forOrigin = this.live.get(origin);
    const out: Record<string, string> = {};
    if (!forOrigin) return out;
    for (const name of names) {
      const value = forOrigin.get(name.toLowerCase());
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  // --- internals ------------------------------------------------------------

  private async record(response: CaptureResponse): Promise<void> {
    const request = response.request();
    const resourceType = safe(() => request.resourceType(), 'other');
    if (!RECORDED_RESOURCE_TYPES.has(resourceType)) return;

    const url = safe(() => request.url(), '');
    if (url === '') return;
    const requestHeaders = safe(() => request.headers(), {} as Record<string, string>);
    this.remember(url, requestHeaders);

    const responseHeaders = safe(() => response.headers(), {} as Record<string, string>);
    const body = await response.text().catch(() => '');
    const requestBody = safe(() => request.postData(), null);

    const { text: responseBody, truncated: responseTruncated } = this.bound(body);
    const { text: sentBody, truncated: requestTruncated } = this.bound(requestBody ?? '');
    const truncated = responseTruncated || requestTruncated;

    const capture: LocalBrowserCapture = {
      method: safe(() => request.method(), 'GET'),
      url,
      requestHeaderNames: headerNamesOf(requestHeaders),
      responseHeaderNames: headerNamesOf(responseHeaders),
      status: safe(() => response.status(), 0),
      ...(sentBody !== '' ? { requestBody: sentBody } : {}),
      ...(responseBody !== '' ? { responseBody } : {}),
      ...(contentTypeOf(responseHeaders) !== undefined ? { contentType: contentTypeOf(responseHeaders)! } : {}),
      resourceType,
      ...(truncated ? { truncated } : {}),
    };
    this.push(capture);
  }

  /** Bounded FIFO: the buffer drops its OLDEST entry rather than refusing new ones. */
  private push(capture: LocalBrowserCapture): void {
    this.buffered.push(capture);
    while (this.buffered.length > MAX_BUFFERED_EXCHANGES) this.buffered.shift();
  }

  /** Remember the live header values for the request's origin. In memory, bounded, never emitted. */
  private remember(url: string, headers: Record<string, string>): void {
    const origin = originOf(url);
    if (!origin) return;
    let forOrigin = this.live.get(origin);
    if (!forOrigin) {
      forOrigin = new Map<string, string>();
      this.live.set(origin, forOrigin);
    }
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value !== 'string' || !HEADER_NAME_RE.test(name)) continue;
      const key = name.toLowerCase();
      if (!forOrigin.has(key) && forOrigin.size >= MAX_LIVE_HEADER_NAMES) continue;
      forOrigin.set(key, value);
    }
  }

  /** Redact, then cap. In that order: capping first could split a credential in half and leave a
   *  prefix the value-keyed redactor no longer matches. */
  private bound(raw: string): { text: string; truncated: boolean } {
    if (raw === '') return { text: '', truncated: false };
    const redacted = this.redactBody(raw);
    if (redacted.length <= MAX_CAPTURE_BODY_CHARS) return { text: redacted, truncated: false };
    return { text: redacted.slice(0, MAX_CAPTURE_BODY_CHARS), truncated: true };
  }
}

/** THE FUNCTION THAT DROPS THE VALUES: handed the whole header map, it returns the KEYS. Every path
 *  from a live header map to a wire frame goes through here. */
function headerNamesOf(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .filter((name) => HEADER_NAME_RE.test(name))
    .map((name) => name.toLowerCase())
    .sort();
}

function contentTypeOf(headers: Record<string, string>): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type' && typeof value === 'string') return value.split(';')[0]?.trim();
  }
  return undefined;
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
