export default function Solution() {
  return (
    <section className="slide content-slide">
      <div className="slide-eyebrow">02 &middot; Solucao</div>
      <h1>Um sistema operacional para turnos de producao, projectado para o chao de fabrica.</h1>

      <p className="slide-lead">
        A Lumera capta o turno como evento &mdash; planeado, executado, medido &mdash; e devolve a direccao um
        painel actualizado ao minuto, sem reescrita manual.
      </p>

      <ul>
        <li>
          <span className="bullet">A</span>
          <span>Planeamento semanal arrastavel, validado contra capacidade real de cada linha.</span>
        </li>
        <li>
          <span className="bullet">B</span>
          <span>Registo de paragem em tres toques no terminal, classificada e atribuida automaticamente.</span>
        </li>
        <li>
          <span className="bullet">C</span>
          <span>OEE, custo por unidade e desvios face ao plano calculados em tempo real.</span>
        </li>
        <li>
          <span className="bullet">D</span>
          <span>Integracoes prontas para ERP (Primavera, SAP, Microsoft) e leitores de codigo de barras.</span>
        </li>
      </ul>
    </section>
  );
}
