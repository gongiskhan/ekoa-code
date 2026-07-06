const AVATAR_PALETTE = [
  { bg: 'var(--color-primary, #0F766E)', fg: 'var(--color-bg, #FFFFFF)' },
  { bg: 'var(--color-accent, #14B8A6)', fg: 'var(--color-bg, #FFFFFF)' },
  { bg: 'var(--color-info, #2563EB)', fg: 'var(--color-bg, #FFFFFF)' },
];

function Avatar({ initials, index }) {
  const palette = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
  return (
    <svg
      className="testimonial-avatar"
      viewBox="0 0 44 44"
      role="img"
      aria-label={`Avatar de ${initials}`}
    >
      <circle cx="22" cy="22" r="22" style={{ fill: palette.bg }} />
      <text
        x="22"
        y="27"
        textAnchor="middle"
        style={{
          fill: palette.fg,
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {initials}
      </text>
    </svg>
  );
}

const TESTIMONIALS = [
  {
    text: 'Tínhamos os leads dispersos por três ferramentas diferentes e demorávamos uma semana a perceber o que estava a converter. Hoje, a equipa abre um painel de manhã e sabe exatamente onde investir o esforço do dia.',
    name: 'Mariana Antunes',
    role: 'Diretora de marketing, Northwind',
    initials: 'MA',
  },
  {
    text: 'A qualificação automática poupou-nos contratar uma pessoa. Os comerciais recebem agora apenas contactos com intenção real e a taxa de fecho subiu mais de quarenta por cento em dois trimestres.',
    name: 'Rui Carvalho',
    role: 'Chefe de vendas, Atrium',
    initials: 'RC',
  },
  {
    text: 'O que mais me surpreendeu foi a velocidade de adoção. Em duas semanas, toda a equipa estava a usar a plataforma sem formação formal. A documentação é clara e a interface não precisa de manual.',
    name: 'Sofia Lemos',
    role: 'Co-fundadora, Quadra',
    initials: 'SL',
  },
];

const QuoteMark = () => (
  <svg
    className="testimonial-quote-mark"
    viewBox="0 0 32 32"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M10 8 C5 10 2 14 2 20 C2 24 5 27 9 27 C12 27 14 25 14 22 C14 19 12 17 9 17 C8.5 17 8 17 7.5 17.2 C8 14 10 11.5 13 10.5 Z" />
    <path d="M24 8 C19 10 16 14 16 20 C16 24 19 27 23 27 C26 27 28 25 28 22 C28 19 26 17 23 17 C22.5 17 22 17 21.5 17.2 C22 14 24 11.5 27 10.5 Z" />
  </svg>
);

export default function Testimonials() {
  return (
    <section className="section" id="testimonials">
      <div className="container">
        <header className="section-head">
          <span className="eyebrow">Testemunhos</span>
          <h2>Equipas que cresceram com mais clareza.</h2>
          <p>
            Histórias reais de quem deixou as folhas de cálculo para trás.
          </p>
        </header>
        <div className="testimonials-grid">
          {TESTIMONIALS.map((t, i) => (
            <article className="testimonial" key={t.name}>
              <QuoteMark />
              <p className="testimonial-text">{t.text}</p>
              <div className="testimonial-author">
                <Avatar initials={t.initials} index={i} />
                <div>
                  <div className="testimonial-name">{t.name}</div>
                  <div className="testimonial-role">{t.role}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
