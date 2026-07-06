export default function Highlights() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">01 &middot; Destaques do trimestre</div>
      <h1>Quatro indicadores fundamentais bateram a meta acordada.</h1>

      <div className="highlights">
        <div className="highlight-item">
          <span className="marker" />
          <div className="copy">
            <h3>Receita acima do plano em 8%</h3>
            <p>A facturacao consolidada atingiu 6,82 milhoes de euros, com a maior contribuicao a vir da expansao em clientes existentes.</p>
          </div>
        </div>

        <div className="highlight-item">
          <span className="marker" />
          <div className="copy">
            <h3>Margem bruta estabilizada em 64,1%</h3>
            <p>Apesar da pressao de custos energeticos, a margem manteve-se gracas a renegociacao de tres contratos de fornecimento.</p>
          </div>
        </div>

        <div className="highlight-item">
          <span className="marker" />
          <div className="copy">
            <h3>NPS medio de 68, em subida</h3>
            <p>Subida de oito pontos face ao trimestre anterior. A area de suporte concluiu a reorganizacao por verticais.</p>
          </div>
        </div>

        <div className="highlight-item">
          <span className="marker" />
          <div className="copy">
            <h3>Tres lancamentos planeados entregues no prazo</h3>
            <p>Painel comercial, exportacao SAF-T e modulo de tesouraria entraram em producao sem incidentes registados.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
