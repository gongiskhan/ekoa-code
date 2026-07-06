export default function Roadmap() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">09 &middot; Roadmap</div>
      <h1>Doze meses ate transformar produto em plataforma.</h1>

      <div className="roadmap">
        <div className="roadmap-step current">
          <div className="dot" />
          <span className="when">Q1 2027</span>
          <span className="what">Modulo de manutencao preditiva</span>
          <span className="why">Reduz paragens nao planeadas em 30% nas fabricas piloto.</span>
        </div>

        <div className="roadmap-step">
          <div className="dot" />
          <span className="when">Q2 2027</span>
          <span className="what">Expansao para Espanha</span>
          <span className="why">Equipa comercial local em Barcelona, parceiro de implementacao validado.</span>
        </div>

        <div className="roadmap-step">
          <div className="dot" />
          <span className="when">Q3 2027</span>
          <span className="what">Plataforma de parceiros</span>
          <span className="why">Quinze integradores certificados, marketplace de modulos verticais.</span>
        </div>

        <div className="roadmap-step">
          <div className="dot" />
          <span className="when">Q4 2027</span>
          <span className="what">Camada de IA aplicada</span>
          <span className="why">Recomendacoes de plano a partir do historico real &mdash; primeiro vertical: textil.</span>
        </div>
      </div>
    </section>
  );
}
