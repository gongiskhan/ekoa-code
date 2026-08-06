/* Shell da app: barra lateral de navegação, cabeçalho com título + seletor de
 * idioma, conteúdo, e o nó VAZIO #ekoa-assistant-root onde o painel do
 * assistente da plataforma se auto-monta (nunca renderizar nada lá dentro). */
import { NavLink, useLocation } from 'react-router-dom';
import { LANGS, tr, useLang, useSetLang } from '../i18n.js';
import { EKOA_LOGO } from '../assets/logo.js';

function LanguageSelector() {
  const lang = useLang();
  const setLang = useSetLang();
  return (
    <div className="seletor-idioma" title={tr('Idioma da aplicação', 'Application language')} data-demo-target="seletor-idioma">
      {LANGS.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`seletor-idioma__opcao ${lang === o.id ? 'seletor-idioma__opcao--ativa' : ''}`}
          onClick={() => setLang(o.id)}
          title={o.name}
          data-testid={`lang-${o.id}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Layout({ nav = [], titulos = {}, children }) {
  useLang(); // re-renderiza o shell ao trocar de idioma
  const { pathname } = useLocation();
  const tituloAtual = (() => {
    const chaves = Object.keys(titulos).sort((a, b) => b.length - a.length);
    const chave = chaves.find((k) => (k === '/' ? pathname === '/' : pathname.startsWith(k)));
    const t = chave ? titulos[chave] : null;
    return t ? tr(t.pt, t.en) : 'Cobranças';
  })();

  return (
    <div className="app">
      <aside className="lateral" data-demo-target="navegacao">
        <div className="lateral__marca">
          <img className="lateral__logo" src={EKOA_LOGO} alt="Ekoa" />
          <span className="lateral__nomes">
            <span className="lateral__nome">Cobranças</span>
            <span className="lateral__por">{tr('por Ekoa', 'by Ekoa')}</span>
          </span>
        </div>
        <nav className="lateral__nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `lateral__item ${isActive ? 'lateral__item--ativo' : ''}`}
              data-demo-target={item.demoTarget}
              data-testid={item.testid}
            >
              <item.icon size={17} />
              <span>{tr(item.pt, item.en)}</span>
            </NavLink>
          ))}
        </nav>
        <p className="lateral__rodape">{tr('Recuperação de créditos', 'Debt recovery')}</p>
      </aside>
      <div className="principal">
        <header className="cabeca">
          <div className="cabeca__grupo">
            <p className="cabeca__kicker">{tr('Cobranças', 'Collections')}</p>
            <h1 className="cabeca__titulo" data-demo-target="titulo-pagina">{tituloAtual}</h1>
          </div>
          <div className="cabeca__acoes">
            <LanguageSelector />
          </div>
        </header>
        <main className="conteudo">{children}</main>
      </div>
      {/* Raiz do painel do assistente da plataforma - SEMPRE vazia. */}
      <div id="ekoa-assistant-root" data-demo-target="assistant-root" />
    </div>
  );
}
