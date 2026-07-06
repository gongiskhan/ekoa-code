export default function Competition() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">07 &middot; Competicao</div>
      <h1>Diferenciamo-nos onde os ERP grandes nao chegam &mdash; o chao de fabrica.</h1>

      <table className="compare">
        <thead>
          <tr>
            <th>Capacidade</th>
            <th>Lumera</th>
            <th>ERP tradicional</th>
            <th>Folhas + Whatsapp</th>
            <th>MES enterprise</th>
          </tr>
        </thead>
        <tbody>
          <tr className="us">
            <td>Implementacao em 3 semanas</td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-partial">Parcial</span></td>
            <td><span className="mark-no">Nao</span></td>
          </tr>
          <tr className="us">
            <td>Terminal optimizado para chao de fabrica</td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-partial">Parcial</span></td>
          </tr>
          <tr className="us">
            <td>OEE em tempo real, sem reescrita manual</td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-yes">Sim</span></td>
          </tr>
          <tr className="us">
            <td>Preco previsivel por linha</td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-no">Nao</span></td>
          </tr>
          <tr className="us">
            <td>Integracao com ERP existente</td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-yes">Sim</span></td>
            <td><span className="mark-no">Nao</span></td>
            <td><span className="mark-partial">Parcial</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
