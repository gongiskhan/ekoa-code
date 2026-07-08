"use client";

import { FlaskConical } from "lucide-react";

/**
 * Per-build verification banner (Amendment 2, FC-505). Shown while the
 * verification stage runs (the build's `testing` phase). Copy is PT-PT verbatim
 * per §12.9.4 and points the reader at the platform settings toggle (FC-507).
 * Informational only; not dismissible. Rendered inside the dark builder output
 * panel, so it is styled for that surface.
 */
export function VerificationBanner() {
  return (
    <div
      data-testid="verification-banner"
      role="status"
      className="mx-3 mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
    >
      <FlaskConical size={15} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
      <p className="text-xs leading-relaxed text-amber-100/90">
        A testar a aplicação. Isto melhora a qualidade do resultado, mas torna a construção mais
        demorada e com maior custo. Pode desativar este comportamento nas definições da plataforma.
      </p>
    </div>
  );
}
