"use client";

// Minimal global error surface (no hooks, no providers): the framework default
// crashes at prerender under the hoisted dual-React layout (see next.config).
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="pt-PT">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Ocorreu um erro inesperado</h1>
          <button onClick={reset} style={{ padding: "8px 16px", cursor: "pointer" }}>
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
