export default function Customers() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">03 &middot; Clientes</div>
      <h1>O ciclo comercial encurtou e a retencao subiu em todos os segmentos.</h1>

      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Clientes activos</span>
          <span className="kpi-value">842</span>
          <span className="kpi-delta up">&uarr; 9,2% face a Q2</span>
          <span className="kpi-detail">Crescimento equilibrado entre PME e clientes corporativos.</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Retencao a 12 meses</span>
          <span className="kpi-value">96,8%</span>
          <span className="kpi-delta up">&uarr; 1,4 p.p. face a Q2</span>
          <span className="kpi-detail">Reflecte o efeito directo do plano de sucesso do cliente.</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Receita por cliente</span>
          <span className="kpi-value">8,1 k&euro;</span>
          <span className="kpi-delta up">&uarr; 6,1% face a Q2</span>
          <span className="kpi-detail">Adopcao de modulos premium em 28% da base instalada.</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Tempo medio ate venda</span>
          <span className="kpi-value">42 dias</span>
          <span className="kpi-delta down">&darr; 11 dias face a Q2</span>
          <span className="kpi-detail">Sequenciamento comercial revisto e novo material de demonstracao.</span>
        </div>
      </div>

      <p className="slide-lead">
        A reorganizacao da area de sucesso do cliente por verticais industriais consolidou-se ao longo
        do trimestre e ja se reflecte nos indicadores chave.
      </p>
    </section>
  );
}
