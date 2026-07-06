export default function Challenges() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">06 &middot; Desafios e aprendizagens</div>
      <h1>Tres pontos de friccao identificados &mdash; tres respostas accionadas.</h1>

      <div className="lessons">
        <div className="lesson-col">
          <h3 className="challenge">Desafios</h3>
          <ul>
            <li>
              <span className="icon warn">!</span>
              <span>Atraso de duas semanas na entrega do modulo de tesouraria, causado por integracoes bancarias instaveis.</span>
            </li>
            <li>
              <span className="icon warn">!</span>
              <span>Aumento de 12% no custo de cloud face ao orcamento, concentrado nas regioes da Europa Central.</span>
            </li>
            <li>
              <span className="icon warn">!</span>
              <span>Volume de pedidos de suporte acima do esperado durante a transicao para o novo modelo de verticais.</span>
            </li>
          </ul>
        </div>

        <div className="lesson-col">
          <h3 className="learning">Resposta accionada</h3>
          <ul>
            <li>
              <span className="icon ok">+</span>
              <span>Camada de mediacao bancaria isolada em servico dedicado, com testes contratuais por parceiro.</span>
            </li>
            <li>
              <span className="icon ok">+</span>
              <span>Plano de optimizacao de cloud em curso, com meta de reducao de 15% ate Janeiro de 2027.</span>
            </li>
            <li>
              <span className="icon ok">+</span>
              <span>Reforco de tres pessoas no suporte de primeiro nivel e formacao continua por vertical.</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
