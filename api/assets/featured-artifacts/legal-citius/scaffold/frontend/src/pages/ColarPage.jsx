import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { processarNotificacao } from '../engine/citius-process.mjs';
import { spineApi, formatDate } from '../shared.js';
import { Button } from '../components/ui.jsx';
import { IconInbox, IconCalendar, IconChevronRight } from '../components/Icons.jsx';
import { splitNotificacoes } from './colar-split.js';

// Notificação de exemplo - emparelha o processo 1234/26.0T8LSB semeado pelo
// Núcleo e, por isso, produz um prazo (Contestação, 30 dias úteis).
const EXEMPLO = [
  'Citius - Notificação Electrónica',
  'Processo: 1234/26.0T8LSB',
  'Tribunal Judicial da Comarca de Lisboa',
  'Fica V. Exa. notificado(a), na qualidade de mandatário, para apresentar contestação no processo supra identificado.',
  'Data do acto: 2026-06-05',
].join('\n');

/*
 * Colar notificação - a via manual (fallback), para quando uma notificação
 * chega fora da intake automática de email. Corre o MESMO motor determinístico:
 * emparelha o processo na espinha, calcula o prazo e escreve a linha na caixa.
 * O que for ambíguo vai para revisão - nunca adivinha um prazo.
 */
export default function ColarPage() {
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState(null);
  const [resultados, setResultados] = useState(null); // vários segmentos colados
  const [erro, setErro] = useState(null);
  const [processando, setProcessando] = useState(false);

  function onExemplo() {
    setResultado(null);
    setResultados(null);
    setErro(null);
    setTexto(EXEMPLO);
  }

  function onTexto(value) {
    // Editar o texto invalida o resultado anterior - nunca se mostra um
    // resultado calculado a partir de texto que entretanto mudou.
    setResultado(null);
    setResultados(null);
    setErro(null);
    setTexto(value);
  }

  async function onProcessar() {
    const raw = texto.trim();
    if (!raw) { setErro('Cole o texto de uma notificação Citius para processar.'); return; }
    setErro(null);
    setResultado(null);
    setResultados(null);
    setProcessando(true);
    try {
      // Não passamos sourceRef - o motor deriva-o do conteúdo, pelo que
      // reprocessar o mesmo texto deduplica (não cria um prazo repetido).
      // Um texto com VÁRIAS notificações (separadores explícitos, ou blocos
      // que são inequivocamente notificações completas) é dividido de forma
      // conservadora e cada segmento corre o motor por si - com o seu próprio
      // resultado honesto. Um segmento único segue o caminho histórico intacto.
      const segmentos = splitNotificacoes(raw);
      if (segmentos.length <= 1) {
        const r = await processarNotificacao(raw, spineApi);
        setResultado(r);
      } else {
        const rs = [];
        for (const seg of segmentos) {
          rs.push(await processarNotificacao(seg, spineApi));
        }
        setResultados(rs);
      }
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível processar a notificação.');
    } finally {
      setProcessando(false);
    }
  }

  const processarDisabled = processando || !texto.trim();

  return (
    <div data-testid="colar-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Colar notificação</h1>
          <p className="page-subtitle">
            Cole o texto de uma notificação Citius. O motor emparelha o processo na espinha partilhada, calcula o
            prazo e mostra o seu trabalho. O que for ambíguo vai para a caixa de entrada, para revisão.
          </p>
        </div>
      </div>

      <section className="card" aria-label="Colar notificação" style={{ maxWidth: 720 }}>
        <form
          className="form"
          data-testid="citius-form"
          onSubmit={(e) => { e.preventDefault(); onProcessar(); }}
        >
          <label className="field">
            <span className="field-label">Texto da notificação</span>
            <textarea
              className="field-textarea citius-textarea"
              data-testid="citius-texto"
              placeholder="Cole aqui o texto de uma notificação Citius…"
              value={texto}
              onChange={(e) => onTexto(e.target.value)}
            />
          </label>

          <div className="citius-actions">
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="citius-processar" data-demo-target="citius-processar"
              disabled={processarDisabled}
            >
              <IconChevronRight /> {processando ? 'A processar…' : 'Processar'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="citius-exemplo" data-demo-target="citius-exemplo"
              onClick={onExemplo}
            >
              Notificação de exemplo
            </button>
          </div>
        </form>

        {erro ? (
          <div className="citius-resultado is-erro" data-testid="citius-resultado" data-demo-target="citius-resultado">
            <span className="citius-resultado-text">
              <span className="citius-resultado-strong">{erro}</span>
            </span>
          </div>
        ) : resultado ? (
          <ResultadoLinha resultado={resultado} navigate={navigate} />
        ) : resultados ? (
          <div className="stack stack-3" style={{ marginTop: 'var(--space-4, 1rem)' }}>
            <p className="text-small text-strong" data-testid="citius-multi-resumo">
              {resultados.length} notificações separadas: {resultados.filter((r) => r.status === 'matched').length} com
              prazo · {resultados.filter((r) => r.status !== 'matched').length} para revisão
            </p>
            {resultados.map((r, i) => (
              <ResultadoLinha key={i} resultado={r} navigate={navigate} testid={`citius-resultado-seg-${i}`} />
            ))}
          </div>
        ) : null}

        <p className="text-muted text-small" style={{ marginTop: 'var(--space-4, 1rem)' }}>
          As notificações que chegam por email são triadas automaticamente e aparecem na caixa de entrada - colar à
          mão é apenas o caminho alternativo. Pode colar várias notificações de uma vez, separadas por uma linha de
          "---": cada uma é processada por si, com o seu próprio resultado.
        </p>
      </section>
    </div>
  );
}

/*
 * Linha de resultado do processamento - verde (prazo criado) ou âmbar (revisão).
 * `testid` por omissão mantém o caminho de segmento único byte-idêntico; a vista
 * multi-notificação passa `citius-resultado-seg-<i>` (o alvo de demo fica só no
 * caminho único, que é o que a demonstração guiada usa).
 */
function ResultadoLinha({ resultado, navigate, testid = 'citius-resultado' }) {
  const dup = resultado.duplicate ? ' (já processada)' : '';
  const demoProps = testid === 'citius-resultado' ? { 'data-demo-target': 'citius-resultado' } : {};

  if (resultado.status === 'matched') {
    // Uma re-entrega já processada devolve 'matched' SEM dataLimite (o prazo já
    // existe) - não mostrar "data-limite undefined".
    const principal = resultado.dataLimite
      ? `Prazo criado - data-limite ${resultado.dataLimite}`
      : 'Prazo já criado';
    return (
      <div className="citius-resultado is-matched" data-testid={testid} {...demoProps}>
        <span className="citius-resultado-icon" aria-hidden="true"><IconCalendar /></span>
        <span className="citius-resultado-text">
          <span className="citius-resultado-strong">{principal}{dup}</span>
          {resultado.dataLimite ? (
            <span className="citius-resultado-meta">{formatDate(resultado.dataLimite)}</span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            Ver na caixa de entrada
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="citius-resultado is-review" data-testid={testid}>
      <span className="citius-resultado-icon" aria-hidden="true"><IconInbox /></span>
      <span className="citius-resultado-text">
        <span className="citius-resultado-strong">Precisa de revisão - {resultado.motivo}{dup}</span>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          Rever na caixa de entrada
        </Button>
      </span>
    </div>
  );
}
