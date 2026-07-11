/**
 * Grayscale brand-color guard (ch05 §5.6.4 safety net). After the agent returns
 * its picks, reject a neutral/grayscale primary or secondary: a gray primary
 * spread over the org's real palette reads as "research succeeded but picked
 * nothing", the exact failure this defends against. The rendered/CSS candidates
 * are already neutral-filtered, so this only catches a hallucinated gray.
 */

/**
 * True when the hex is neutral (black, white, or low-saturation gray). Used to
 * prevent grayscale from being selected as primary/secondary.
 */
export function isGrayscale(hex: string): boolean {
  if (!hex || typeof hex !== 'string') return false;
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return false;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return false;

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  if ((r < 15 && g < 15 && b < 15) || (r > 240 && g > 240 && b > 240)) return true;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation < 0.15;
}

export interface BrandColors {
  primaryColor?: unknown;
  secondaryColor?: unknown;
  accentColor?: unknown;
}

/**
 * Replace a grayscale primary/secondary with a distinctive alternative, mutating
 * and returning the input. Primary: promote a non-gray accent, else a non-gray
 * secondary, else drop it (null) so the caller's "no usable primary" guard trips
 * rather than persisting a gray. Secondary grayscale is dropped to null (never a
 * fabricated default - the merge keeps any prior value).
 */
export function sanitizeBrandColors<T extends BrandColors>(branding: T): T {
  if (!branding) return branding;

  const primary = branding.primaryColor;
  if (typeof primary === 'string' && isGrayscale(primary)) {
    const accent = branding.accentColor;
    const secondary = branding.secondaryColor;
    if (typeof accent === 'string' && !isGrayscale(accent)) {
      branding.primaryColor = accent;
      branding.accentColor = primary;
    } else if (typeof secondary === 'string' && !isGrayscale(secondary)) {
      branding.primaryColor = secondary;
      branding.secondaryColor = primary;
    } else {
      branding.primaryColor = null;
    }
  }

  const secondaryNow = branding.secondaryColor;
  if (typeof secondaryNow === 'string' && isGrayscale(secondaryNow)) {
    branding.secondaryColor = null;
  }

  return branding;
}
