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
  switch (algorithm) {
    case 'hmac-sha256-hex':
      expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      break;
    case 'hmac-sha1-hex':
      expected = createHmac('sha1', secret).update(rawBody).digest('hex');
      break;
    case 'hmac-sha256-base64':
      expected = createHmac('sha256', secret).update(rawBody).digest('base64');
      break;
    default:
      return false;
  }
  // Strip common signature prefixes (e.g. GitHub's "sha256=") before comparing.
  const provided = signature.includes('=') && /^sha\d+=/.test(signature) ? signature.split('=').slice(1).join('=') : signature;
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
