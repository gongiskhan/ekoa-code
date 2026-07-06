const LINKS = [
  { label: 'Funcionalidades', href: '#features' },
  { label: 'Preços', href: '#pricing' },
  { label: 'Perguntas', href: '#faq' },
  { label: 'Privacidade', href: '#' },
  { label: 'Contacto', href: '#' },
];

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <div className="footer-brand">
            <svg
              className="footer-brand-mark"
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
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span>A sua marca</span>
          </div>
          <ul className="footer-links">
            {LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
          <div className="footer-copy">© {year} A sua marca. Todos os direitos reservados.</div>
        </div>
      </div>
    </footer>
  );
}
