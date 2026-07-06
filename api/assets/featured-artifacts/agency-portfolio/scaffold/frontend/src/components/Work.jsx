const COLOR_PRIMARY = 'var(--color-primary, #0F766E)';
const COLOR_ACCENT = 'var(--color-accent, #14B8A6)';
const COLOR_TEXT = 'var(--color-text, #0F172A)';
const COLOR_BG = 'var(--color-bg, #FFFFFF)';
const COLOR_INFO = 'var(--color-info, #2563EB)';
const COLOR_WARNING = 'var(--color-warning, #D97706)';
const COLOR_SURFACE_MUTED = 'var(--color-surface-muted, #F1F5F9)';

function CoverEditorial() {
  return (
    <svg className="work-cover" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Capa: Editorial Sereno">
      <rect width="480" height="320" style={{ fill: COLOR_SURFACE_MUTED }} />
      <rect x="40" y="40" width="180" height="240" style={{ fill: COLOR_TEXT }} />
      <text
        x="60"
        y="100"
        style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}
      >
        Sereno
      </text>
      <line x1="60" y1="120" x2="200" y2="120" style={{ stroke: COLOR_ACCENT, strokeWidth: 2 }} />
      <text x="60" y="150" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 10, letterSpacing: '0.1em', opacity: 0.7 }}>
        EDIÇÃO N.º 04
      </text>
      <text x="60" y="260" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 11, opacity: 0.6 }}>
        Outono · 2024
      </text>
      <circle cx="340" cy="160" r="80" style={{ fill: 'none', stroke: COLOR_PRIMARY, strokeWidth: 1 }} />
      <circle cx="340" cy="160" r="40" style={{ fill: COLOR_PRIMARY }} />
      <circle cx="340" cy="160" r="14" style={{ fill: COLOR_BG }} />
    </svg>
  );
}

function CoverApp() {
  return (
    <svg className="work-cover" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Capa: Mosaico App">
      <rect width="480" height="320" style={{ fill: COLOR_PRIMARY }} />
      <g opacity="0.4">
        <circle cx="100" cy="60" r="60" style={{ fill: COLOR_ACCENT }} />
        <circle cx="380" cy="260" r="80" style={{ fill: COLOR_BG }} />
      </g>
      <rect x="160" y="40" width="160" height="240" rx="22" style={{ fill: COLOR_TEXT }} />
      <rect x="170" y="56" width="140" height="48" rx="6" style={{ fill: 'rgba(255,255,255,0.08)' }} />
      <rect x="180" y="68" width="60" height="6" rx="3" style={{ fill: COLOR_BG, opacity: 0.85 }} />
      <rect x="180" y="84" width="100" height="4" rx="2" style={{ fill: COLOR_BG, opacity: 0.5 }} />
      <rect x="170" y="116" width="140" height="36" rx="6" style={{ fill: 'rgba(255,255,255,0.06)' }} />
      <rect x="170" y="160" width="140" height="36" rx="6" style={{ fill: 'rgba(255,255,255,0.06)' }} />
      <rect x="170" y="204" width="140" height="36" rx="6" style={{ fill: 'rgba(255,255,255,0.06)' }} />
      <rect x="180" y="260" width="120" height="12" rx="6" style={{ fill: COLOR_ACCENT }} />
    </svg>
  );
}

function CoverPackaging() {
  return (
    <svg className="work-cover" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Capa: Packaging Casa do Verde">
      <rect width="480" height="320" style={{ fill: COLOR_BG }} />
      <rect x="0" y="0" width="240" height="320" style={{ fill: COLOR_SURFACE_MUTED }} />
      <rect x="60" y="80" width="120" height="180" rx="4" style={{ fill: COLOR_PRIMARY }} />
      <rect x="60" y="80" width="120" height="40" style={{ fill: COLOR_TEXT }} />
      <text x="120" y="106" textAnchor="middle" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 12, fontWeight: 700, letterSpacing: '0.16em' }}>
        CASA DO VERDE
      </text>
      <text x="120" y="180" textAnchor="middle" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 22, fontWeight: 700, fontStyle: 'italic' }}>
        Origem
      </text>
      <text x="120" y="200" textAnchor="middle" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 9, letterSpacing: '0.16em', opacity: 0.7 }}>
        AZEITE BIOLÓGICO
      </text>
      <text x="120" y="240" textAnchor="middle" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 8, opacity: 0.6 }}>
        500ml · Alentejo
      </text>
      <rect x="290" y="80" width="120" height="180" rx="4" style={{ fill: COLOR_TEXT }} />
      <rect x="290" y="80" width="120" height="40" style={{ fill: COLOR_ACCENT }} />
      <text x="350" y="106" textAnchor="middle" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 12, fontWeight: 700, letterSpacing: '0.16em' }}>
        CASA DO VERDE
      </text>
      <text x="350" y="180" textAnchor="middle" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 22, fontWeight: 700, fontStyle: 'italic' }}>
        Reserva
      </text>
    </svg>
  );
}

function CoverIdentity() {
  return (
    <svg className="work-cover" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Capa: Identidade Andante">
      <rect width="480" height="320" style={{ fill: COLOR_TEXT }} />
      <g style={{ stroke: COLOR_BG, strokeWidth: 0.6, fill: 'none', opacity: 0.18 }}>
        {[60, 120, 180, 240, 300, 360, 420].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="320" />
        ))}
      </g>
      <text x="240" y="170" textAnchor="middle" style={{ fill: COLOR_BG, fontFamily: 'var(--font-sans, system-ui)', fontSize: 108, fontWeight: 700, letterSpacing: '-0.04em' }}>
        andante
      </text>
      <text x="240" y="200" textAnchor="middle" style={{ fill: COLOR_ACCENT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 12, letterSpacing: '0.6em' }}>
        ESTÚDIO MUSICAL
      </text>
      <circle cx="240" cy="240" r="3" style={{ fill: COLOR_ACCENT }} />
    </svg>
  );
}

function CoverDashboard() {
  return (
    <svg className="work-cover" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Capa: Dashboard Voltis">
      <rect width="480" height="320" style={{ fill: COLOR_INFO, opacity: 0.92 }} />
      <rect x="40" y="40" width="400" height="240" rx="12" style={{ fill: COLOR_BG }} />
      <rect x="60" y="60" width="160" height="14" rx="2" style={{ fill: COLOR_TEXT }} />
      <rect x="60" y="80" width="80" height="6" rx="2" style={{ fill: COLOR_TEXT, opacity: 0.4 }} />
      <rect x="60" y="110" width="170" height="80" rx="6" style={{ fill: COLOR_SURFACE_MUTED }} />
      <rect x="240" y="110" width="170" height="80" rx="6" style={{ fill: COLOR_SURFACE_MUTED }} />
      <text x="76" y="138" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 11, opacity: 0.6 }}>
        Receita
      </text>
      <text x="76" y="170" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 22, fontWeight: 700 }}>
        €384k
      </text>
      <text x="256" y="138" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 11, opacity: 0.6 }}>
        Margem
      </text>
      <text x="256" y="170" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 22, fontWeight: 700 }}>
        38%
      </text>
      <polyline
        points="60,250 110,230 160,240 210,210 260,215 310,180 360,195 410,160"
        style={{ fill: 'none', stroke: COLOR_PRIMARY, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      />
      <circle cx="410" cy="160" r="5" style={{ fill: COLOR_BG, stroke: COLOR_PRIMARY, strokeWidth: 2 }} />
    </svg>
  );
}

function CoverExhibition() {
  return (
    <svg className="work-cover" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Capa: Exposição Travessia">
      <rect width="480" height="320" style={{ fill: COLOR_WARNING }} />
      <g style={{ fill: COLOR_BG, opacity: 0.95 }}>
        <rect x="60" y="60" width="6" height="200" />
        <rect x="80" y="80" width="6" height="160" />
        <rect x="100" y="100" width="6" height="120" />
        <rect x="120" y="120" width="6" height="80" />
      </g>
      <text x="170" y="120" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em' }}>
        Travessia
      </text>
      <text x="170" y="146" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 11, letterSpacing: '0.18em' }}>
        EXPOSIÇÃO ITINERANTE
      </text>
      <line x1="170" y1="170" x2="380" y2="170" style={{ stroke: COLOR_TEXT, strokeWidth: 1 }} />
      <text x="170" y="220" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 13, fontWeight: 600 }}>
        Lisboa · Porto · Coimbra
      </text>
      <text x="170" y="244" style={{ fill: COLOR_TEXT, fontFamily: 'var(--font-sans, system-ui)', fontSize: 11, opacity: 0.7 }}>
        Março a Novembro de 2025
      </text>
    </svg>
  );
}

const PROJECTS = [
  {
    name: 'Sereno',
    type: 'Revista impressa',
    year: '2024',
    cover: <CoverEditorial />,
  },
  {
    name: 'Mosaico',
    type: 'Aplicação móvel',
    year: '2024',
    cover: <CoverApp />,
  },
  {
    name: 'Casa do Verde',
    type: 'Embalagem',
    year: '2024',
    cover: <CoverPackaging />,
  },
  {
    name: 'Andante',
    type: 'Identidade visual',
    year: '2023',
    cover: <CoverIdentity />,
  },
  {
    name: 'Voltis',
    type: 'Produto digital',
    year: '2023',
    cover: <CoverDashboard />,
  },
  {
    name: 'Travessia',
    type: 'Exposição',
    year: '2023',
    cover: <CoverExhibition />,
  },
];

export default function Work() {
  return (
    <section className="section work" id="work">
      <div className="container">
        <header>
          <span className="section-eyebrow">Trabalhos seleccionados</span>
          <h2 className="section-title">Uma amostra do que fazemos.</h2>
          <p className="section-lede">
            Seis projetos recentes que mostram a amplitude do atelier: do
            impresso à aplicação móvel, da embalagem à exposição.
          </p>
        </header>
        <div className="work-grid" style={{ marginTop: 'var(--space-12, 3rem)' }}>
          {PROJECTS.map((p) => (
            <a className="work-card" href="#" key={p.name} tabIndex={0}>
              {p.cover}
              <div className="work-overlay">
                <div className="work-overlay-name">{p.name}</div>
                <div className="work-overlay-type">{p.type}</div>
              </div>
              <div className="work-meta">
                <span className="work-meta-name">{p.name}</span>
                <span>{p.year}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
