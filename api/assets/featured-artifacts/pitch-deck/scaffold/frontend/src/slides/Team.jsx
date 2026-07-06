export default function Team() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">08 &middot; Equipa</div>
      <h1>Quatro fundadores, vinte anos de experiencia em chao de fabrica e produto.</h1>

      <div className="team-grid">
        <div className="team-card">
          <div className="team-avatar">SM</div>
          <span className="team-name">Sofia Mendes</span>
          <span className="team-role">CEO</span>
          <p className="team-bio">
            Ex-COO da Vilfer Plasticos. Lancou tres unidades fabris, sentou-se na consulta com mais
            de 60 directores industriais.
          </p>
        </div>

        <div className="team-card">
          <div className="team-avatar">RC</div>
          <span className="team-name">Rui Castanheira</span>
          <span className="team-role">CTO</span>
          <p className="team-bio">
            Construiu o nucleo de execucao da Critical Manufacturing. Lidera arquitectura, dados e
            integracoes com ERP.
          </p>
        </div>

        <div className="team-card">
          <div className="team-avatar">IT</div>
          <span className="team-name">Ines Teixeira</span>
          <span className="team-role">Head of Product</span>
          <p className="team-bio">
            Ex-Outsystems. Faz a ponte entre operadores e direccao &mdash; cada release passa por uma
            fabrica antes de chegar a producao.
          </p>
        </div>

        <div className="team-card">
          <div className="team-avatar">PA</div>
          <span className="team-name">Pedro Almeida</span>
          <span className="team-role">VP Sales</span>
          <p className="team-bio">
            Vinte anos a vender software industrial. Conhece a queixa antes do CFO a articular &mdash; e
            sabe como responder.
          </p>
        </div>
      </div>
    </section>
  );
}
