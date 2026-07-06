export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand-block">
            <div className="footer-brand-title">Atelier Tinta</div>
            <p className="footer-brand-text">
              Estúdio de marca, produto digital e direção de arte. Lisboa,
              Porto e Berlim. Aceitamos novos projetos em cada trimestre.
            </p>
          </div>
          <div>
            <div className="footer-column-title">Atelier</div>
            <ul className="footer-list">
              <li><a href="#about">Sobre nós</a></li>
              <li><a href="#team">Equipa</a></li>
              <li><a href="#services">Serviços</a></li>
              <li><a href="#work">Trabalhos</a></li>
            </ul>
          </div>
          <div>
            <div className="footer-column-title">Contacto</div>
            <ul className="footer-list">
              <li><a href="mailto:atelier@exemplo.pt">atelier@exemplo.pt</a></li>
              <li><a href="tel:+351210000000">+351 210 000 000</a></li>
              <li><a href="#contact">Pedido de proposta</a></li>
            </ul>
          </div>
          <div>
            <div className="footer-column-title">Acompanhe</div>
            <ul className="footer-list">
              <li><a href="#">Boletim mensal</a></li>
              <li><a href="#">Instagram</a></li>
              <li><a href="#">LinkedIn</a></li>
              <li><a href="#">Behance</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-base">
          <div>© {year} Atelier Tinta. Todos os direitos reservados.</div>
          <div>Lisboa · Porto · Berlim</div>
        </div>
      </div>
    </footer>
  );
}
