/**
 * Webhook signature verifiers (ch09 invariant 9). Pure, zero-persistence. Raw-body HMAC with
 * the provider's algorithm; timing-safe compares; the hub-challenge (Meta-style) handshake.
 * The secret is decrypted only at verify time by the caller and passed in as cleartext.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Timing-safe string compare (equal length required; unequal lengths are never equal). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type WebhookAlgorithm = 'hmac-sha256-hex' | 'hmac-sha1-hex' | 'hmac-sha256-base64';

/** Verify a raw-body HMAC signature. `signature` is the header value the provider sent. */
export function verifyHmac(algorithm: WebhookAlgorithm, secret: string, rawBody: Buffer, signature: string): boolean {
  let expected: string;
  let algoPrefix: string; // the ONLY prefix this algorithm accepts (defense against sha-family confusion)
  switch (algorithm) {
    case 'hmac-sha256-hex':
      expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      algoPrefix = 'sha256';
      break;
    case 'hmac-sha1-hex':
      expected = createHmac('sha1', secret).update(rawBody).digest('hex');
      algoPrefix = 'sha1';
      break;
    case 'hmac-sha256-base64':
      expected = createHmac('sha256', secret).update(rawBody).digest('base64');
      algoPrefix = 'sha256';
      break;
    default:
      return false;
  }
  // Strip ONLY this algorithm's own prefix (e.g. GitHub's "sha256=") — a mismatched `sha1=`/
  // `sha999=` prefix on a sha256 trigger is rejected, not stripped, so a captured signature can't
  // be replayed with a varied prefix to dodge dedup (belt-and-braces with body-hash dedup).
  let provided = signature;
  const eq = signature.indexOf('=');
  if (eq > 0 && /^sha\d+$/.test(signature.slice(0, eq))) {
    if (signature.slice(0, eq) !== algoPrefix) return false;
    provided = signature.slice(eq + 1);
  }
  return safeEqual(expected, provided);
}

/** Meta-style GET hub-challenge handshake: echo hub.challenge iff the verify token matches. */
export function hubChallenge(query: Record<string, unknown>, expectedToken: string): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && typeof token === 'string' && safeEqual(token, expectedToken) && typeof challenge === 'string') {
    return challenge;
  }
  return null;
}
