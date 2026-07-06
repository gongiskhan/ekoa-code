const SERVICES = [
  {
    name: 'Identidade visual',
    description:
      'Sistemas de marca completos: nome, logótipo, paleta, tipografia, regras de aplicação e manual.',
  },
  {
    name: 'Produto digital',
    description:
      'Sites institucionais, plataformas e aplicações móveis, do conceito à entrega final em produção.',
  },
  {
    name: 'Direção de arte',
    description:
      'Conceitos editoriais, campanhas, fotografia e ilustração coordenadas a partir de uma só visão.',
  },
  {
    name: 'Publicação impressa',
    description:
      'Livros, revistas, relatórios anuais e catálogos com atenção rigorosa ao papel, tinta e composição.',
  },
  {
    name: 'Embalagem',
    description:
      'Soluções de embalagem para produtos físicos, com foco em materiais sustentáveis e produção local.',
  },
  {
    name: 'Estratégia de marca',
    description:
      'Posicionamento, narrativa, arquitetura de marca e mensagem central — antes de qualquer pixel.',
  },
];

export default function Services() {
  return (
    <section className="section services" id="services">
      <div className="container">
        <header>
          <span className="section-eyebrow">Serviços</span>
          <h2 className="section-title">O que entregamos.</h2>
          <p className="section-lede">
            Trabalhamos em parceria ao longo do projeto. Para necessidades
            pontuais, recomendamos colaboradores em quem confiamos.
          </p>
        </header>
        <ul className="services-list">
          {SERVICES.map((s, i) => (
            <li className="services-item" key={s.name}>
              <span className="services-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="services-name">{s.name}</span>
              <span className="services-desc">{s.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
