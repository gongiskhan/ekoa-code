export default function Product() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">04 &middot; Lancamentos de produto</div>
      <h1>Tres entregas com impacto directo no ciclo financeiro do cliente.</h1>

      <div className="launches">
        <article className="launch-card">
          <span className="launch-date">Julho 2026</span>
          <span className="launch-name">Painel comercial unificado</span>
          <p className="launch-desc">
            Vista consolidada de pipeline, conversao e previsao, com integracao directa ao registo
            de actividades. Adoptada por 71% da equipa comercial nas primeiras quatro semanas.
          </p>
          <span className="launch-tag">Entrega completa</span>
        </article>

        <article className="launch-card">
          <span className="launch-date">Agosto 2026</span>
          <span className="launch-name">Exportacao SAF-T automatizada</span>
          <p className="launch-desc">
            Geracao mensal automatica do ficheiro SAF-T com validacao previa, eliminando uma tarefa
            recorrente da equipa financeira da maioria dos clientes.
          </p>
          <span className="launch-tag">Receita recorrente</span>
        </article>

        <article className="launch-card">
          <span className="launch-date">Setembro 2026</span>
          <span className="launch-name">Modulo de tesouraria</span>
          <p className="launch-desc">
            Previsao de tesouraria a doze semanas com cenarios, importacao de saldos bancarios e
            alertas configuraveis. Em piloto pago em catorze clientes.
          </p>
          <span className="launch-tag">Beta restrito</span>
        </article>
      </div>
    </section>
  );
}
