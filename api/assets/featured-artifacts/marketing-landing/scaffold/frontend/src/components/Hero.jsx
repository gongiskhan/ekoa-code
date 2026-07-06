export default function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-grid">
          <div>
            <span className="eyebrow">Plataforma de crescimento</span>
            <h1>Transforme visitantes em clientes com clareza e ritmo.</h1>
            <p className="hero-subhead">
              Reúna captação, qualificação e medição num único fluxo. Veja os
              resultados de cada campanha em tempo real, sem perder a sua
              equipa em folhas de cálculo.
            </p>
            <div className="hero-ctas">
              <a className="btn btn-primary" href="#cta">
                Começar agora
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </a>
              <a className="btn btn-secondary" href="#how">
                Ver demonstração
              </a>
            </div>
            <div className="hero-meta">
              <svg
                className="hero-meta-check"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Avaliação gratuita de 14 dias. Sem cartão de crédito.</span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual-bar">
              <span className="hero-visual-dot" />
              <span className="hero-visual-dot" />
              <span className="hero-visual-dot" />
            </div>
            <svg
              className="hero-chart"
              viewBox="0 0 480 280"
              role="img"
              aria-label="Gráfico ilustrativo de crescimento"
            >
              <defs>
                <linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    style={{ stopColor: 'var(--color-primary, #0F766E)', stopOpacity: 0.35 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: 'var(--color-primary, #0F766E)', stopOpacity: 0 }}
                  />
                </linearGradient>
              </defs>
              <g style={{ stroke: 'var(--color-border, #E2E8F0)', strokeWidth: 1 }}>
                <line x1="40" y1="40" x2="460" y2="40" />
                <line x1="40" y1="100" x2="460" y2="100" />
                <line x1="40" y1="160" x2="460" y2="160" />
                <line x1="40" y1="220" x2="460" y2="220" />
              </g>
              <path
                d="M40 200 L120 170 L200 145 L280 110 L360 75 L440 50 L440 220 L40 220 Z"
                style={{ fill: 'url(#grad-area)' }}
              />
              <path
                d="M40 200 L120 170 L200 145 L280 110 L360 75 L440 50"
                style={{
                  fill: 'none',
                  stroke: 'var(--color-primary, #0F766E)',
                  strokeWidth: 2.5,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }}
              />
              {[
                { x: 120, y: 170 },
                { x: 200, y: 145 },
                { x: 280, y: 110 },
                { x: 360, y: 75 },
                { x: 440, y: 50 },
              ].map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="4"
                  style={{
                    fill: 'var(--color-bg, #FFFFFF)',
                    stroke: 'var(--color-primary, #0F766E)',
                    strokeWidth: 2,
                  }}
                />
              ))}
              <g
                style={{
                  fill: 'var(--color-text-subtle, #64748B)',
                  fontFamily: 'var(--font-sans, system-ui, sans-serif)',
                  fontSize: 11,
                }}
              >
                <text x="40" y="260">Jan</text>
                <text x="120" y="260">Fev</text>
                <text x="200" y="260">Mar</text>
                <text x="280" y="260">Abr</text>
                <text x="360" y="260">Mai</text>
                <text x="430" y="260">Jun</text>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
