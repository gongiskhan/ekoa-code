/**
 * Landing shell - platform starting point, NOT a finished page.
 *
 * AGENT: replace every placeholder below with the real brand/product content. This is a
 * single scrolling page (in-page anchor links only, never a router - base-conventions.md
 * rule "no client-side routing") built from the full marketing-site section vocabulary
 * (landing-craft.md): header nav, hero, trust strip, features, how it works, pricing
 * (optional - remove the section if the brief has no pricing), testimonials, FAQ, final CTA,
 * footer. Delete any section the brief genuinely doesn't need; don't ship this placeholder
 * copy as the deliverable.
 *
 * The skeleton already carries the expected craft bar: display type in the hero, a feature
 * ledger (the FIRST entry of FEATURES renders as the lead row), a numbered step path, a
 * typographic pull-quote, animated FAQ rows, a tinted full-bleed final CTA band and a
 * columned footer. Keep that structural quality when swapping in real content - every
 * layout is driven by the arrays below, so add or remove entries freely.
 */
import { useState } from 'react';

const NAV_LINKS = [
  { href: '#features', label: 'Funcionalidades' },
  { href: '#how-it-works', label: 'Como funciona' },
  { href: '#pricing', label: 'Preços' },
  { href: '#faq', label: 'Perguntas frequentes' },
];

// AGENT: the FIRST entry renders as the lead row of the feature ledger (bigger type,
// more room) - order the array by importance, three to six entries (landing-craft.md).
const FEATURES = [
  { title: 'Substituir pelo benefício principal', body: 'A primeira entrada desta lista recebe o destaque visual - use-a para o resultado mais forte que o produto entrega, numa frase concreta, não um adjetivo vago.' },
  { title: 'Segundo benefício', body: 'Cada linha justifica a sua presença - não um genérico "rápido, fácil, seguro".' },
  { title: 'Terceiro benefício', body: 'Três a seis entradas (landing-craft.md) - apague ou acrescente conforme o produto real.' },
];

// AGENT: the step number is rendered from the array index - keep titles free of "1.", "2.".
const STEPS = [
  { title: 'Primeiro passo', body: 'O que o utilizador faz primeiro.' },
  { title: 'Segundo passo', body: 'O que acontece a seguir.' },
  { title: 'Resultado', body: 'O que o utilizador ganha no final.' },
];

const TESTIMONIALS = [
  { quote: 'Substituir por uma citação real de um cliente - nunca "John Doe".', name: 'Nome, Cargo - Empresa' },
];

// AGENT: four to eight items on a real page (landing-craft.md).
const FAQ = [
  { q: 'Pergunta frequente real do público-alvo?', a: 'Resposta direta, em uma ou duas frases.' },
  { q: 'Segunda pergunta - a objeção mais comum antes de avançar?', a: 'Resposta que remove a objeção - substituir por conteúdo real.' },
  { q: 'Terceira pergunta - substituir ou apagar?', a: 'Mantenha entre quatro e oito itens no total; apague ou acrescente conforme o produto.' },
];

export default function App() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <>
      <header className="landing-header">
        <div className="landing-header-inner">
          <a href="#top" className="landing-logo">Marca</a>
          <nav className={navOpen ? 'landing-nav landing-nav-open' : 'landing-nav'} aria-label="Navegação principal">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setNavOpen(false)}>{link.label}</a>
            ))}
            <a href="#cta" className="btn btn-primary landing-nav-cta" onClick={() => setNavOpen(false)}>Começar</a>
          </nav>
          <a href="#cta" className="btn btn-primary landing-header-cta">Começar</a>
          <button
            type="button"
            className="landing-nav-toggle"
            aria-label={navOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-hero-inner">
            <h1>Proposta de valor clara numa só frase</h1>
            <p className="landing-hero-sub">Uma segunda frase que explica quem usa isto e porquê - até 30 palavras.</p>
            <div className="landing-hero-ctas">
              <a href="#cta" className="btn btn-primary">Ação principal</a>
              <a href="#features" className="btn btn-outline">
                Saber mais
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        </section>

        <section className="landing-trust">
          <p className="landing-trust-label">Com a confiança de equipas de</p>
          <div className="landing-trust-logos">
            <span>Logótipo 1</span>
            <span>Logótipo 2</span>
            <span>Logótipo 3</span>
            <span>Logótipo 4</span>
            <span>Logótipo 5</span>
          </div>
        </section>

        <section id="features" className="landing-features">
          <h2>Porque escolher isto</h2>
          <div className="landing-features-grid">
            {FEATURES.map((f, i) => (
              <article key={f.title} className={i === 0 ? 'landing-feature-card landing-feature-lead' : 'landing-feature-card'}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="landing-steps">
          <h2>Como funciona</h2>
          <div className="landing-steps-grid">
            {STEPS.map((s, i) => (
              <div key={s.title} className="landing-step">
                <div className="landing-step-marker">
                  <span className="landing-step-number">{i + 1}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="landing-pricing">
          <h2>Preços</h2>
          <p className="landing-pricing-note">Substitua por tiers reais, ou remova esta secção (e o link de navegação correspondente) se o pedido não tiver preços públicos.</p>
        </section>

        <section className="landing-testimonials">
          <h2>O que dizem</h2>
          {TESTIMONIALS.map((t) => (
            <blockquote key={t.name} className="landing-testimonial">
              <svg className="landing-testimonial-mark" width="44" height="33" viewBox="0 0 48 36" aria-hidden="true">
                <path fill="currentColor" d="M10.7 36c-3.4 0-6-1.1-7.9-3.3C1 30.6 0 27.9 0 24.8 0 21 1.1 17 3.2 12.9 5.4 8.7 8.5 4.4 12.6 0l6.5 4.4c-2.3 2.9-4.1 5.6-5.4 8.2-1.2 2.5-1.9 4.6-2 6.3 2.1.4 3.8 1.4 5.2 3 1.4 1.5 2.1 3.4 2.1 5.6 0 2.5-.8 4.6-2.5 6.2-1.6 1.5-3.6 2.3-5.8 2.3Zm25.4 0c-3.4 0-6-1.1-7.9-3.3-1.8-2.1-2.8-4.8-2.8-7.9 0-3.8 1.1-7.8 3.2-11.9C30.8 8.7 33.9 4.4 38 0l6.5 4.4c-2.3 2.9-4.1 5.6-5.4 8.2-1.2 2.5-1.9 4.6-2 6.3 2.1.4 3.8 1.4 5.2 3 1.4 1.5 2.1 3.4 2.1 5.6 0 2.5-.8 4.6-2.5 6.2-1.6 1.5-3.6 2.3-5.8 2.3Z" />
              </svg>
              <p>{t.quote}</p>
              <cite>{t.name}</cite>
            </blockquote>
          ))}
        </section>

        <section id="faq" className="landing-faq">
          <h2>Perguntas frequentes</h2>
          <div className="landing-faq-list">
            {FAQ.map((item) => (
              <details key={item.q} className="landing-faq-item">
                <summary>
                  <span>{item.q}</span>
                  <svg className="landing-faq-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 6l4.5 4.5L12.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="landing-faq-answer">
                  <div>
                    <p>{item.a}</p>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section id="cta" className="landing-final-cta">
          <div className="landing-final-cta-inner">
            <h2>Repita a ação principal aqui</h2>
            <p className="landing-final-cta-note">Uma frase curta que remove a última objeção antes do clique - substituir.</p>
            <a href="#top" className="btn btn-primary">Ação principal</a>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-grid">
            <div className="landing-footer-brand">
              <a href="#top" className="landing-logo">Marca</a>
              <p>Uma frase curta sobre o que a marca faz - substituir.</p>
            </div>
            <nav className="landing-footer-col" aria-label="Secções da página">
              <h3>Navegar</h3>
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href}>{link.label}</a>
              ))}
            </nav>
            <div className="landing-footer-col">
              <h3>Legal</h3>
              <a href="#top">Termos (substituir)</a>
              <a href="#top">Privacidade (substituir)</a>
            </div>
          </div>
          <div className="landing-footer-fine">
            <p>&copy; {new Date().getFullYear()} Marca. Todos os direitos reservados.</p>
            <a href="#top" className="landing-footer-top">
              Voltar ao topo
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 11V3M3.5 6.5L7 3l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
