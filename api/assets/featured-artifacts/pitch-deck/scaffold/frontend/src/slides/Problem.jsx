export default function Problem() {
  return (
    <section className="slide content-slide">
      <div className="slide-eyebrow">01 &middot; Problema</div>
      <h1>As PME industriais perdem 12% de capacidade produtiva todas as semanas.</h1>

      <p className="slide-lead">
        A causa nao e tecnica &mdash; e organizativa. A informacao sobre turnos, paragens e materiais
        vive em folhas paralelas que nunca chegam a sincronizar.
      </p>

      <ul>
        <li>
          <span className="bullet">1</span>
          <span>Folhas de calculo desactualizadas circulam entre encarregados, qualidade e direccao.</span>
        </li>
        <li>
          <span className="bullet">2</span>
          <span>Paragens nao planeadas demoram horas a ser comunicadas e dias a ser analisadas.</span>
        </li>
        <li>
          <span className="bullet">3</span>
          <span>O custo real por unidade nao e conhecido a tempo de corrigir o plano da semana.</span>
        </li>
        <li>
          <span className="bullet">4</span>
          <span>O ERP existente nao foi pensado para o chao de fabrica e ninguem o usa la.</span>
        </li>
      </ul>
    </section>
  );
}
