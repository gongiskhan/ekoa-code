export default function Ask() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">10 &middot; Pedido</div>
      <h1 className="ask-headline">
        Procuramos <span className="amount">3,2 M&euro;</span> para acelerar uma janela de tres anos.
      </h1>

      <div className="allocation">
        <div className="allocation-row">
          <span className="label">Equipa comercial em Iberia</span>
          <div className="bar"><div className="bar-fill" style={{ width: '38%' }} /></div>
          <span className="value">38%</span>
        </div>

        <div className="allocation-row">
          <span className="label">Produto &mdash; manutencao e IA</span>
          <div className="bar"><div className="bar-fill" style={{ width: '32%' }} /></div>
          <span className="value">32%</span>
        </div>

        <div className="allocation-row">
          <span className="label">Operacoes &mdash; implementacao e suporte</span>
          <div className="bar"><div className="bar-fill" style={{ width: '18%' }} /></div>
          <span className="value">18%</span>
        </div>

        <div className="allocation-row">
          <span className="label">Fundo de seguranca para 12 meses</span>
          <div className="bar"><div className="bar-fill" style={{ width: '12%' }} /></div>
          <span className="value">12%</span>
        </div>
      </div>

      <p className="slide-lead">
        Com esta ronda chegamos a 3,8 milhoes de euros de ARR ate ao fim de 2027, com cobertura
        iberica e equipa preparada para uma serie B.
      </p>
    </section>
  );
}
