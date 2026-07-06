import { useState } from 'react';

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <section className="section contact" id="contact">
      <div className="container">
        <div className="contact-inner">
          <div>
            <span className="section-eyebrow">Contacto</span>
            <h2 className="section-title">Vamos conversar sobre o seu projeto.</h2>
            <p className="section-lede">
              Recebemos cerca de quarenta pedidos por ano e aceitamos entre
              oito e doze. Conte-nos o que tem em mente, sem necessidade de
              briefing formal.
            </p>
            <div className="contact-info-block">
              <div className="contact-info-label">Correio eletrónico</div>
              <div className="contact-info-value">
                <a href="mailto:atelier@exemplo.pt">atelier@exemplo.pt</a>
              </div>
            </div>
            <div className="contact-info-block">
              <div className="contact-info-label">Atelier</div>
              <div className="contact-info-value">Rua dos Anjos 42, 1150-039 Lisboa</div>
            </div>
            <div className="contact-info-block">
              <div className="contact-info-label">Resposta habitual</div>
              <div className="contact-info-value">Dois dias úteis</div>
            </div>
          </div>

          {submitted ? (
            <div className="contact-form form-success">
              <div className="form-success-icon">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3>Mensagem enviada</h3>
              <p>
                Obrigado pelo contacto. A nossa equipa irá responder em até
                dois dias úteis, com perguntas iniciais e uma proposta de
                conversa.
              </p>
            </div>
          ) : (
            <form className="contact-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="contact-name">Nome</label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={handleChange('name')}
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <label htmlFor="contact-email">Correio eletrónico</label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={handleChange('email')}
                  autoComplete="email"
                />
              </div>
              <div className="field">
                <label htmlFor="contact-company">Empresa ou organização</label>
                <input
                  id="contact-company"
                  type="text"
                  value={form.company}
                  onChange={handleChange('company')}
                  autoComplete="organization"
                />
              </div>
              <div className="field">
                <label htmlFor="contact-message">Mensagem</label>
                <textarea
                  id="contact-message"
                  required
                  value={form.message}
                  onChange={handleChange('message')}
                  placeholder="Descreva brevemente o projeto, prazos e expectativas."
                />
              </div>
              <button type="submit" className="btn btn-primary form-submit">
                Enviar mensagem
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
