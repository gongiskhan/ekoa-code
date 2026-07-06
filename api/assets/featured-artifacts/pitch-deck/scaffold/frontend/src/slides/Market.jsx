export default function Market() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">03 &middot; Oportunidade</div>
      <h1>Um mercado defensavel de 2,4 mil milhoes de euros na peninsula iberica.</h1>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <span className="stat-label">TAM &mdash; Europa</span>
          <span className="stat-value">18,6&nbsp;mil M&euro;</span>
          <span className="stat-detail">Software de operacoes industriais para PME, mercado europeu (Gartner, 2026).</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">SAM &mdash; Iberia</span>
          <span className="stat-value">2,4&nbsp;mil M&euro;</span>
          <span className="stat-detail">Empresas com 50 a 500 trabalhadores, focadas em transformacao continua.</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">SOM em 3 anos</span>
          <span className="stat-value">220&nbsp;M&euro;</span>
          <span className="stat-detail">Quota realista, assumindo expansao para Espanha no segundo ano de actividade.</span>
        </div>
      </div>

      <p className="slide-lead">
        A pressao regulatoria sobre rastreabilidade e os incentivos do PRR criam uma janela de tres anos
        para fixar o operador de referencia no segmento.
      </p>
    </section>
  );
}
