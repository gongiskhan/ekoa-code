/*
 * Painel de assistente EMBUTIDO - usado apenas quando a plataforma não serve
 * o painel próprio (/__ekoa/panel-runtime.js responde 404). Monta-se no mesmo
 * nó #ekoa-assistant-root, fala com POST /api/app-assistant e fundamenta as
 * respostas no instantâneo de dados calculado pela própria app.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { perguntarAssistente } from '../../ekoa.js';
import { construirContextoAssistente, DESCRICAO_APP } from './contexto.js';
import { tr, currentLang } from '../../i18n.js';

const SUGESTOES = [
  { pt: 'Quem devo contactar hoje e porquê?', en: 'Who should I chase today and why?' },
  { pt: 'Resume a situação da carteira.', en: 'Summarise the portfolio.' },
  { pt: 'Há correspondências bancárias por confirmar?', en: 'Any bank matches waiting for me?' },
];

function AssistentePanel() {
  const [aberto, setAberto] = useState(!!window.__ekoaAssistantAutoOpen);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [aPensar, setAPensar] = useState(false);
  const fimRef = useRef(null);

  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener('ekoa:assistant-open', abrir);
    return () => window.removeEventListener('ekoa:assistant-open', abrir);
  }, []);

  useEffect(() => {
    if (fimRef.current) fimRef.current.scrollTop = fimRef.current.scrollHeight;
  }, [mensagens, aPensar, aberto]);

  async function enviar(pergunta) {
    const msg = (pergunta ?? texto).trim();
    if (!msg || aPensar) return;
    setTexto('');
    setMensagens((prev) => [...prev, { role: 'user', content: msg }]);
    setAPensar(true);
    try {
      const dados = await construirContextoAssistente();
      const r = await perguntarAssistente({
        message: msg,
        history: mensagens.slice(-12),
        context: {
          route: window.__cobrancasRota || '/',
          lang: currentLang(),
          dados,
          descricaoApp: DESCRICAO_APP,
        },
      });
      setMensagens((prev) => [
        ...prev,
        r.success
          ? { role: 'assistant', content: r.reply }
          : { role: 'assistant', content: r.error || tr('O assistente está indisponível de momento.', 'The assistant is unavailable right now.'), erro: true },
      ]);
    } catch (err) {
      setMensagens((prev) => [
        ...prev,
        { role: 'assistant', content: err instanceof Error ? err.message : String(err), erro: true },
      ]);
    } finally {
      setAPensar(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        className="assistente__launcher"
        aria-label={tr('Abrir o assistente', 'Open the assistant')}
        data-testid="assistente-launcher"
        onClick={() => setAberto(true)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
        <span>{tr('Assistente', 'Assistant')}</span>
      </button>
    );
  }

  return (
    <div className="assistente" role="dialog" aria-label={tr('Assistente Cobranças', 'Collections assistant')} data-testid="assistente-painel">
      <header className="assistente__cabeca">
        <div>
          <p className="assistente__titulo">{tr('Assistente', 'Assistant')}</p>
          <p className="assistente__sub">Cobranças · Ekoa</p>
        </div>
        <button type="button" className="assistente__fechar" aria-label={tr('Fechar', 'Close')} onClick={() => setAberto(false)}>×</button>
      </header>
      <div className="assistente__corpo" ref={fimRef}>
        {mensagens.length === 0 ? (
          <div className="assistente__vazio">
            <p>{tr('Pergunte sobre a carteira de cobranças — as respostas baseiam-se nos dados reais da aplicação.', 'Ask about the collections portfolio — answers are grounded in the app data.')}</p>
            <div className="assistente__sugestoes">
              {SUGESTOES.map((s) => (
                <button key={s.pt} type="button" onClick={() => enviar(tr(s.pt, s.en))}>{tr(s.pt, s.en)}</button>
              ))}
            </div>
          </div>
        ) : (
          mensagens.map((m, i) => (
            <div key={i} className={`assistente__msg assistente__msg--${m.role}${m.erro ? ' assistente__msg--erro' : ''}`}>
              {m.content}
            </div>
          ))
        )}
        {aPensar ? <div className="assistente__msg assistente__msg--assistant assistente__msg--pensar">{tr('A analisar a carteira…', 'Analysing the portfolio…')}</div> : null}
      </div>
      <form
        className="assistente__rodape"
        onSubmit={(e) => { e.preventDefault(); enviar(); }}
      >
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={tr('Escreva a sua pergunta…', 'Type your question…')}
          data-testid="assistente-input"
        />
        <button type="submit" disabled={aPensar || !texto.trim()} data-testid="assistente-enviar">
          {tr('Enviar', 'Send')}
        </button>
      </form>
    </div>
  );
}

let montado = false;

/** Monta o painel embutido no #ekoa-assistant-root (uma única vez). */
export function mountFallbackPanel() {
  if (montado || typeof document === 'undefined') return;
  const node = document.getElementById('ekoa-assistant-root');
  if (!node) return;
  montado = true;
  // Remove o launcher plain-DOM - o painel embutido traz o seu próprio.
  const boot = document.querySelector('[data-ekoa-boot-launcher]');
  if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
  createRoot(node).render(<AssistentePanel />);
}
