function Avatar({ palette, initials }) {
  return (
    <svg
      className="team-avatar"
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Avatar de ${initials}`}
    >
      <rect width="200" height="200" style={{ fill: palette.bg }} />
      <circle cx="100" cy="84" r="36" style={{ fill: palette.skin }} />
      <path
        d="M40 200 C40 150 60 130 100 130 C140 130 160 150 160 200 Z"
        style={{ fill: palette.body }}
      />
      <text
        x="100"
        y="190"
        textAnchor="middle"
        style={{
          fill: palette.ink,
          fontFamily: 'var(--font-sans, system-ui)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.16em',
        }}
      >
        {initials}
      </text>
    </svg>
  );
}

const MEMBERS = [
  {
    name: 'Inês Bordalo',
    role: 'Sócia · Direção criativa',
    initials: 'IB',
    palette: {
      bg: 'var(--color-primary, #0F766E)',
      skin: 'var(--color-surface-muted, #F1F5F9)',
      body: 'var(--color-text, #0F172A)',
      ink: 'var(--color-bg, #FFFFFF)',
    },
  },
  {
    name: 'Tomás Nogueira',
    role: 'Sócio · Direção de produto',
    initials: 'TN',
    palette: {
      bg: 'var(--color-accent, #14B8A6)',
      skin: 'var(--color-bg, #FFFFFF)',
      body: 'var(--color-primary, #0F766E)',
      ink: 'var(--color-bg, #FFFFFF)',
    },
  },
  {
    name: 'Joana Maciel',
    role: 'Designer sénior',
    initials: 'JM',
    palette: {
      bg: 'var(--color-text, #0F172A)',
      skin: 'var(--color-surface-muted, #F1F5F9)',
      body: 'var(--color-accent, #14B8A6)',
      ink: 'var(--color-bg, #FFFFFF)',
    },
  },
  {
    name: 'André Pestana',
    role: 'Engenheiro frontend',
    initials: 'AP',
    palette: {
      bg: 'var(--color-warning, #D97706)',
      skin: 'var(--color-bg, #FFFFFF)',
      body: 'var(--color-text, #0F172A)',
      ink: 'var(--color-bg, #FFFFFF)',
    },
  },
];

export default function Team() {
  return (
    <section className="section" id="team">
      <div className="container">
        <header>
          <span className="section-eyebrow">Equipa</span>
          <h2 className="section-title">Quem está atrás do trabalho.</h2>
          <p className="section-lede">
            Um núcleo permanente de quatro pessoas, complementado por uma rede
            de colaboradores escolhidos para cada projeto.
          </p>
        </header>
        <div className="team-grid">
          {MEMBERS.map((m) => (
            <article className="team-card" key={m.name}>
              <Avatar palette={m.palette} initials={m.initials} />
              <h3 className="team-name">{m.name}</h3>
              <p className="team-role">{m.role}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
