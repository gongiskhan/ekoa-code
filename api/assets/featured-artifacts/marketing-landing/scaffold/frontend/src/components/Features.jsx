const FEATURES = [
  {
    title: 'Captação multicanal',
    description:
      'Reúna leads de formulários, redes sociais e campanhas pagas num único repositório, com atribuição automática à origem correta.',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 7h18l-2 12H5L3 7Z" />
        <path d="M8 7V5a4 4 0 0 1 8 0v2" />
      </svg>
    ),
  },
  {
    title: 'Qualificação assistida',
    description:
      'Regras simples e pontuação automática separam contactos quentes de curiosidades, libertando a sua equipa para o que importa.',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
      </svg>
    ),
  },
  {
    title: 'Painéis em tempo real',
    description:
      'Visualize o desempenho de cada campanha, canal e mensagem com gráficos que se atualizam em segundos, sem exportar relatórios.',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 17V11" />
        <path d="M12 17V7" />
        <path d="M16 17V13" />
      </svg>
    ),
  },
  {
    title: 'Automatismos sem código',
    description:
      'Crie sequências de seguimento, lembretes e envios condicionais arrastando blocos. Nenhuma linha de código necessária.',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 12h4l3 8 4-16 3 8h2" />
      </svg>
    ),
  },
  {
    title: 'Integração com o seu stack',
    description:
      'Ligações nativas com correio, CRM, agenda e ferramentas de mensagens. Os dados fluem nos dois sentidos, sem intervenção manual.',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </svg>
    ),
  },
  {
    title: 'Privacidade por defeito',
    description:
      'Conformidade com o RGPD, registo de consentimentos e exportação de dados. A sua marca permanece em controlo total dos contactos.',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4Z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

export default function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <header className="section-head">
          <span className="eyebrow">Funcionalidades</span>
          <h2>Tudo o que precisa, num só sítio.</h2>
          <p>
            Os módulos essenciais para uma operação de marketing moderna, sem
            integrações frágeis nem exportações intermináveis.
          </p>
        </header>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <article className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
