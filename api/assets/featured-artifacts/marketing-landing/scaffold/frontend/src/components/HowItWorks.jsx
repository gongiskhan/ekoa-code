const STEPS = [
  {
    title: 'Ligue as suas fontes',
    description:
      'Em minutos, ligue o formulário do site, as redes sociais e o correio comercial. Os contactos começam a chegar de imediato.',
  },
  {
    title: 'Defina regras de qualificação',
    description:
      'Indique o que torna um contacto promissor. A plataforma pontua cada lead e encaminha os melhores para a sua equipa de vendas.',
  },
  {
    title: 'Acompanhe e ajuste',
    description:
      'Veja o que funciona em painéis ao vivo. Ajuste mensagens, canais e públicos sem esperar pelo fim do mês para tomar decisões.',
  },
];

export default function HowItWorks() {
  return (
    <section className="section how" id="how">
      <div className="container">
        <header className="section-head">
          <span className="eyebrow">Como funciona</span>
          <h2>Três passos para resultados consistentes.</h2>
          <p>
            Comece com o que tem hoje e amplie no ritmo da sua equipa, sem
            projetos longos de implementação.
          </p>
        </header>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title}>
              <div className="step-number">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
