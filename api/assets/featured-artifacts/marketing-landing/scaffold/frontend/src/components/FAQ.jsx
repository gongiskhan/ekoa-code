import { useState } from 'react';

const ITEMS = [
  {
    q: 'Preciso de cartão de crédito para começar?',
    a: 'Não. A avaliação gratuita de catorze dias inclui todas as funcionalidades do plano Crescimento e não exige qualquer método de pagamento. Apenas no fim do período é que poderá escolher manter um plano pago.',
  },
  {
    q: 'Posso importar os meus contactos atuais?',
    a: 'Sim. Pode importar uma folha de cálculo com colunas habituais (nome, correio, origem) ou ligar diretamente o seu CRM e formulários atuais. A nossa equipa apoia a primeira importação sem custo adicional.',
  },
  {
    q: 'Como é tratada a privacidade dos dados?',
    a: 'A infraestrutura está alojada na União Europeia e cumpre o RGPD. Cada contacto regista o consentimento explícito e a sua origem, e tem o direito a exportação e eliminação a qualquer momento.',
  },
  {
    q: 'A plataforma integra-se com as ferramentas que já uso?',
    a: 'Ligações nativas disponíveis incluem Google Workspace, Microsoft 365, HubSpot, Pipedrive, Slack e plataformas de anúncios. Para casos específicos, existe uma API REST documentada e webhooks bidirecionais.',
  },
  {
    q: 'Quanto tempo demora a implementação?',
    a: 'A maioria das equipas está operacional no mesmo dia. Configurações mais avançadas (atribuição multi-canal, automatismos longos) costumam levar entre três a sete dias com o apoio da nossa equipa de instalação.',
  },
  {
    q: 'Posso cancelar o plano em qualquer altura?',
    a: 'Pode. Não existem contratos de fidelização nem penalizações. Em caso de cancelamento, mantém acesso de leitura aos dados durante trinta dias para exportação completa.',
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="section" id="faq">
      <div className="container">
        <header className="section-head">
          <span className="eyebrow">Perguntas frequentes</span>
          <h2>Tudo o que precisa de saber antes de começar.</h2>
        </header>
        <div className="faq-list">
          {ITEMS.map((item, i) => {
            const open = openIndex === i;
            return (
              <div className="faq-item" key={item.q}>
                <button
                  className="faq-question"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? -1 : i)}
                >
                  <span>{item.q}</span>
                  <svg
                    className={open ? 'faq-icon faq-icon-open' : 'faq-icon'}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                {open && <div className="faq-answer">{item.a}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
