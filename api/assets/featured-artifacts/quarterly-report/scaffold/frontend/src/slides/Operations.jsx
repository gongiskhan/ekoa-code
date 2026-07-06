export default function Operations() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">05 &middot; Operacoes</div>
      <h1>Indicadores operacionais dentro dos limites acordados, com estabilizacao da equipa.</h1>

      <div className="ops">
        <div className="ops-block">
          <h3>Plataforma</h3>
          <div className="ops-row"><span className="ops-label">Disponibilidade do servico</span><span className="ops-value">99,98%</span></div>
          <div className="ops-row"><span className="ops-label">Tempo medio de resposta da API</span><span className="ops-value">142 ms</span></div>
          <div className="ops-row"><span className="ops-label">Incidentes criticos</span><span className="ops-value">0</span></div>
          <div className="ops-row"><span className="ops-label">Vulnerabilidades resolvidas</span><span className="ops-value">28</span></div>
        </div>

        <div className="ops-block">
          <h3>Pessoas</h3>
          <div className="ops-row"><span className="ops-label">Efectivos no final do trimestre</span><span className="ops-value">128</span></div>
          <div className="ops-row"><span className="ops-label">Contratacoes concluidas</span><span className="ops-value">11</span></div>
          <div className="ops-row"><span className="ops-label">Rotatividade voluntaria (anualizada)</span><span className="ops-value">6,4%</span></div>
          <div className="ops-row"><span className="ops-label">Indice de satisfacao interna</span><span className="ops-value">8,2 / 10</span></div>
        </div>
      </div>
    </section>
  );
}
