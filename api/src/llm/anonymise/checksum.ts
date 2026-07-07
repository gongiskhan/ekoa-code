/**
 * llm/anonymise/checksum.ts - PT structured-ID checksum validators and the matching
 * format-preserving token generators (§17.4 (a), §17.5).
 *
 * Two rules bind every function here:
 *   1. Detection precision is near-certain: a candidate is treated as a real identifier ONLY
 *      when it passes its class checksum (§17.4 (a)). A checksum-invalid candidate is NOT a
 *      structured-ID hit (it may still be caught by the deny-list, §17.4 (b)).
 *   2. The checksum-collision rule (§17.5): a generated token NEVER carries a valid check
 *      digit. A fake NIF with a valid check digit could, by construction, be a live person's
 *      NIF; minting one would fabricate a real identifier. Every generator below produces a
 *      plausible format with a deliberately INVALID checksum. This same rule binds the test
 *      fixtures (§17.8) - the generator and the test data generator are held to it identically.
 */

const digits = (s: string): number[] => s.split('').map((c) => c.charCodeAt(0) - 48);

// --- NIF / NIPC (9 digits, mod-11 check digit) -------------------------------------------

/** The mod-11 control digit for the first 8 digits of a NIF/NIPC. */
function nifControl(first8: number[]): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += first8[i]! * (9 - i);
  const r = sum % 11;
  const c = 11 - r;
  return c >= 10 ? 0 : c;
}

/** True when a 9-digit string is a checksum-valid NIF/NIPC. */
export function isValidNif(s: string): boolean {
  if (!/^\d{9}$/.test(s)) return false;
  const d = digits(s);
  return nifControl(d.slice(0, 8)) === d[8];
}

// --- NISS (11 digits, weighted mod-10 check) ---------------------------------------------

const NISS_WEIGHTS = [29, 23, 19, 17, 13, 11, 7, 5, 3, 2];

/** The control digit for the first 10 digits of a NISS. */
function nissControl(first10: number[]): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += first10[i]! * NISS_WEIGHTS[i]!;
  const c = 9 - (sum % 10);
  return c < 0 ? 0 : c;
}

/** True when an 11-digit string is a checksum-valid NISS (starts 1 or 2). */
export function isValidNiss(s: string): boolean {
  if (!/^[12]\d{10}$/.test(s)) return false;
  const d = digits(s);
  return nissControl(d.slice(0, 10)) === d[10];
}

// --- IBAN PT (PT + 2 check + 21 BBAN, mod-97) --------------------------------------------

/** Mod-97 over the rearranged IBAN, letters mapped A=10..Z=35 (ISO 13616). */
function iban97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of code) remainder = (remainder * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/** True when a string is a well-formed, mod-97-valid Portuguese IBAN (25 chars). */
export function isValidIbanPt(s: string): boolean {
  if (!/^PT\d{23}$/.test(s)) return false;
  return iban97(s) === 1;
}

// --- Cartão de Cidadão document number (8 digits + control + 2 letters + control) --------
// Luhn-in-base-36 over the 12-char document number (e.g. "12345678 9 ZA4" without spaces).

function ccValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55; // A=10..Z=35
  return -1;
}

/** True when a 12-char CC document number passes the Luhn-base-36 check. */
export function isValidCc(s: string): boolean {
  const t = s.replace(/\s+/g, '').toUpperCase();
  if (!/^\d{8}\d[A-Z]{2}\d$/.test(t)) return false;
  let sum = 0;
  let second = false;
  for (let i = t.length - 1; i >= 0; i--) {
    let v = ccValue(t[i]!);
    if (v < 0) return false;
    if (second) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    second = !second;
  }
  return sum % 10 === 0;
}

// --- Format-preserving token generators (deliberately INVALID checksum, §17.5) -----------

/** Encode a per-session sequence into `n` digits (zero-padded, wraps). */
function seqDigits(seq: number, n: number): string {
  const s = String(Math.abs(seq) % Math.pow(10, n));
  return s.padStart(n, '0');
}

/** A NIF/NIPC-shaped token with a deliberately invalid control digit. */
export function makeNifToken(seq: number): string {
  const base = '2' + seqDigits(seq, 7); // 8 digits
  const good = nifControl(digits(base));
  const bad = (good + 1) % 10;
  return base + String(bad);
}

/** A NISS-shaped token (starts 2) with a deliberately invalid control digit. */
export function makeNissToken(seq: number): string {
  const base = '2' + seqDigits(seq, 9); // 10 digits
  const good = nissControl(digits(base));
  const bad = (good + 1) % 10;
  return base + String(bad);
}

/** A PT-IBAN-shaped token. Check digits '00' are never valid mod-97, so the token is
 *  structurally guaranteed invalid. */
export function makeIbanToken(seq: number): string {
  return 'PT00' + seqDigits(seq, 21);
}

/** A número-de-utente-shaped token (9 digits), invalid NIF-style control so it is never a
 *  real structured identifier. */
export function makeUtenteToken(seq: number): string {
  const base = '9' + seqDigits(seq, 7);
  const good = nifControl(digits(base));
  const bad = (good + 1) % 10;
  return base + String(bad);
}

/** A CC-document-shaped token with a deliberately invalid final control digit. */
export function makeCcToken(seq: number): string {
  const body = seqDigits(seq, 8) + '0' + 'ZZ';
  // find a final digit that makes the Luhn-base-36 check FAIL
  for (let d = 0; d < 10; d++) {
    if (!isValidCc(body + String(d))) return body + String(d);
  }
  return body + '0';
}

/** A CITIUS/processo-shaped reference token (format only, no checksum class). */
export function makeProcessoToken(seq: number): string {
  const n = seqDigits(seq, 4);
  return `${n}/00.0TZZZ`;
}
