function Nav() {
  return (
    <nav className="nav">
      <div className="container">
        <div className="nav-inner">
          <div className="nav-brand">
            <svg
              className="nav-brand-mark"
              width="28"
              height="28"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="16" cy="16" r="14" style={{ stroke: 'currentColor', strokeWidth: 2 }} />
              <path
                d="M9 22 L16 9 L23 22"
                style={{ stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }}
              />
              <line
                x1="12"
                y1="18"
                x2="20"
                y2="18"
                style={{ stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}
              />
            </svg>
            <span>Atelier Tinta</span>
          </div>
          <ul className="nav-links">
            <li><a href="#work">Trabalhos</a></li>
            <li><a href="#about">Atelier</a></li>
            <li><a href="#services">Serviços</a></li>
            <li><a href="#team">Equipa</a></li>
            <li><a href="#contact">Contacto</a></li>
          </ul>
          <a className="btn btn-primary" href="#contact">Iniciar projeto</a>
        </div>
      </div>
    </nav>
  );
}

const STATS = [
  { value: '12 anos', label: 'A construir marcas' },
  { value: '84', label: 'Projetos entregues' },
  { value: '9', label: 'Países atendidos' },
  { value: '3', label: 'Prémios europeus' },
];

export default function Hero() {
  return (
    <>
      <Nav />
      <section className="hero">
        <div className="container">
          <div className="hero-inner">
            <div>
              <span className="section-eyebrow">Atelier de marca digital</span>
              <h1 className="hero-headline">
                Construímos marcas com <em>voz própria</em> e produtos com forma cuidada.
              </h1>
            </div>
            <div className="hero-meta">
              <span className="hero-meta-label">Lisboa · Porto · Berlim</span>
              <p className="hero-meta-text">
                Identidades, sites e produtos digitais para empresas que se
                recusam a parecer iguais às outras. Trabalhamos próximo, com
                método claro e respeito pelo seu tempo.
              </p>
            </div>
          </div>
          <div className="hero-stats">
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="hero-stat-value">{s.value}</div>
                <div className="hero-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
