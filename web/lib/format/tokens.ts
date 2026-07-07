/**
 * Format a token count for compact display.
 * 1_500_000 -> "1.5M", 12_345 -> "12.3k", 999 -> "999".
 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return n.toLocaleString();
}
