/** Normalize what the user types to the device flow's exact `XXXX-XXXX` userCode shape
 *  (api/src/auth/device.ts `newUserCode`): uppercase, strip separators/noise, cap at 8
 *  characters, hyphen after the first 4. The approve match server-side is an exact string. */
export function normalizeUserCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
