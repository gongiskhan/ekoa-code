const TIERS = [
  {
    name: 'Início',
    price: '19',
    unit: '/ mês',
    description:
      'Ideal para uma só pessoa a validar canais e mensagens iniciais.',
    features: [
      'Até 1.000 contactos',
      'Dois canais de captação',
      'Painéis essenciais',
      'Apoio por correio eletrónico',
    ],
    cta: 'Começar',
    recommended: false,
  },
  {
    name: 'Crescimento',
    price: '69',
    unit: '/ mês',
    description:
      'Para equipas pequenas que querem qualificar e automatizar com método.',
    features: [
      'Até 10.000 contactos',
      'Todos os canais e integrações',
      'Qualificação por pontuação',
      'Automatismos avançados',
      'Apoio prioritário',
    ],
    cta: 'Escolher Crescimento',
    recommended: true,
  },
  {
    name: 'Escala',
    price: '199',
    unit: '/ mês',
    description:
      'Para organizações com múltiplas equipas, marcas e mercados.',
    features: [
      'Contactos ilimitados',
      'Espaços de trabalho por marca',
      'Permissões granulares',
      'Apoio dedicado por telefone',
      'Acordo de nível de serviço',
    ],
    cta: 'Falar connosco',
    recommended: false,
  },
];

const Check = () => (
  <svg
    className="pricing-check"
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
);

export default function Pricing() {
  return (
    <section className="section pricing" id="pricing">
      <div className="container">
        <header className="section-head">
          <span className="eyebrow">Planos</span>
          <h2>Preços transparentes, sem surpresas.</h2>
          <p>
            Comece pequeno e cresça conforme os resultados. Pode mudar de plano
            a qualquer momento, sem penalizações.
          </p>
        </header>
        <div className="pricing-grid">
          {TIERS.map((tier) => (
            <article
              key={tier.name}
              className={
                tier.recommended
                  ? 'pricing-card pricing-card-recommended'
                  : 'pricing-card'
              }
            >
              {tier.recommended && (
                <span className="pricing-badge">Recomendado</span>
              )}
              <div className="pricing-tier">{tier.name}</div>
              <div className="pricing-price">
                <span>{tier.price}€</span>
                <span className="pricing-price-unit">{tier.unit}</span>
              </div>
              <p className="pricing-description">{tier.description}</p>
              <ul className="pricing-features">
                {tier.features.map((f) => (
                  <li key={f}>
                    <Check />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#cta"
                className={
                  tier.recommended
                    ? 'btn btn-primary pricing-cta'
                    : 'btn btn-secondary pricing-cta'
                }
              >
                {tier.cta}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
