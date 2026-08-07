"use client";

import { useEffect, useState } from "react";

/**
 * The keyboard modifier prefix used in shortcut hints, matched to the viewer's
 * platform: the Command glyph on Apple hardware (no separator, per Apple
 * convention - "⌘K"), "Ctrl+" everywhere else ("Ctrl+K"). Rendering ⌘ to a
 * Windows or Linux user names a key their keyboard does not have.
 *
 * Defaults to "Ctrl+" for SSR and first paint - the overwhelming majority - so
 * detection only ever upgrades to ⌘ on Apple machines and never flashes a wrong
 * glyph in the common case.
 */
export function useModKeyPrefix(): string {
  const [prefix, setPrefix] = useState("Ctrl+");
  useEffect(() => {
    const p = (navigator.platform || navigator.userAgent || "").toLowerCase();
    if (/mac|iphone|ipad|ipod/.test(p)) setPrefix("⌘");
  }, []);
  return prefix;
}
