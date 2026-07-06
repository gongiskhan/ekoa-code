const LOGOS = [
  {
    name: 'Northwind',
    svg: (
      <svg viewBox="0 0 140 28" width="120" height="24" aria-label="Northwind">
        <g fill="currentColor">
          <path d="M4 22 L4 6 L8 6 L16 18 L16 6 L20 6 L20 22 L16 22 L8 10 L8 22 Z" />
          <text
            x="26"
            y="19"
            style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}
          >
            NORTHWIND
          </text>
        </g>
      </svg>
    ),
  },
  {
    name: 'Lumen',
    svg: (
      <svg viewBox="0 0 130 28" width="110" height="24" aria-label="Lumen">
        <g fill="currentColor">
          <circle cx="14" cy="14" r="8" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }} />
          <circle cx="14" cy="14" r="3" />
          <text
            x="30"
            y="19"
            style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 500, letterSpacing: '0.06em' }}
          >
            lumen.io
          </text>
        </g>
      </svg>
    ),
  },
  {
    name: 'Atrium',
    svg: (
      <svg viewBox="0 0 130 28" width="110" height="24" aria-label="Atrium">
        <g fill="currentColor">
          <path d="M4 22 L14 4 L24 22 L20 22 L17 16 L11 16 L8 22 Z M12.5 13 L15.5 13 L14 10 Z" />
          <text
            x="30"
            y="19"
            style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}
          >
            ATRIUM
          </text>
        </g>
      </svg>
    ),
  },
  {
    name: 'Quadra',
    svg: (
      <svg viewBox="0 0 130 28" width="110" height="24" aria-label="Quadra">
        <g fill="currentColor">
          <rect x="4" y="6" width="16" height="16" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }} />
          <rect x="9" y="11" width="6" height="6" />
          <text
            x="28"
            y="19"
            style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}
          >
            Quadra
          </text>
        </g>
      </svg>
    ),
  },
  {
    name: 'Vela',
    svg: (
      <svg viewBox="0 0 130 28" width="110" height="24" aria-label="Vela">
        <g fill="currentColor">
          <path d="M4 22 L14 4 L14 22 Z" />
          <path d="M16 8 L24 16 L16 16 Z" />
          <text
            x="30"
            y="19"
            style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 500, fontStyle: 'italic', letterSpacing: '0.04em' }}
          >
            vela
          </text>
        </g>
      </svg>
    ),
  },
  {
    name: 'Stratos',
    svg: (
      <svg viewBox="0 0 140 28" width="120" height="24" aria-label="Stratos">
        <g fill="currentColor">
          <path d="M4 14 Q14 6 24 14 Q14 22 4 14 Z" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }} />
          <circle cx="14" cy="14" r="2" />
          <text
            x="30"
            y="19"
            style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em' }}
          >
            STRATOS
          </text>
        </g>
      </svg>
    ),
  },
];

export default function TrustStrip() {
  return (
    <section className="trust">
      <div className="container">
        <p className="trust-label">A confiança de equipas em crescimento</p>
        <div className="trust-logos">
          {LOGOS.map((logo) => (
            <span key={logo.name} className="trust-logo">
              {logo.svg}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
