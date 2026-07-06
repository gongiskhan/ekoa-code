const METHOD = [
  {
    title: 'Compreender',
    text:
      'Mergulhamos no contexto da sua marca, conversamos com clientes e mapeamos as fronteiras do território onde irá competir.',
  },
  {
    title: 'Esboçar',
    text:
      'Propomos várias direções, defendidas por argumentos. Nunca apresentamos uma única opção como se fosse a inevitável.',
  },
  {
    title: 'Refinar',
    text:
      'Iteramos com a sua equipa em sessões curtas e produtivas. O detalhe nasce do diálogo, não de revisões sucessivas por correio.',
  },
  {
    title: 'Entregar',
    text:
      'Sistemas de marca, manuais, ficheiros prontos para produção e formação para quem os irá usar no dia-a-dia.',
  },
];

export default function About() {
  return (
    <section className="section about" id="about">
      <div className="container">
        <div className="about-inner">
          <div>
            <span className="section-eyebrow">Atelier</span>
            <h2 className="section-title">Pensamento claro, execução paciente.</h2>
            <div className="about-body">
              <p>
                Somos um grupo pequeno de designers, programadores e
                investigadores que partilha o mesmo desconforto com a uniformização
                visual das marcas contemporâneas.
              </p>
              <p>
                Trabalhamos por projeto, em colaboração próxima com quem o
                idealiza. Recusamos o modelo de fábrica, em que decisões
                criativas saltam de mesa em mesa até perderem o brilho original.
              </p>
              <p>
                A cada projeto começamos pelo desconhecido — pelo que ainda não
                sabe, pelo que ainda não conseguiu articular. É aí que o
                trabalho ganha forma.
              </p>
            </div>
          </div>
          <div>
            <span className="section-eyebrow">Como trabalhamos</span>
            <div className="method-grid" style={{ marginTop: 'var(--space-6, 1.5rem)' }}>
              {METHOD.map((m, i) => (
                <div className="method-item" key={m.title}>
                  <div className="method-item-number">{String(i + 1).padStart(2, '0')}</div>
                  <div className="method-item-title">{m.title}</div>
                  <p className="method-item-text">{m.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
