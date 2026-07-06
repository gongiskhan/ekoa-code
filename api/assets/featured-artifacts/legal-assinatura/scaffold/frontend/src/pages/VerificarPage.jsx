import { useRef, useState } from 'react';
import { Button, Badge } from '../components/ui.jsx';
import { useDemoResult } from '../demo.js';
import { IconShieldCheck, IconUpload, IconCheck, IconAlertTriangle, IconExternalLink } from '../components/Icons.jsx';
import { verificarFicheiro, VALIDADOR_OFICIAL_URL, AVISO_VERIFICACAO } from '../pdf-verify.js';

/*
 * Verificação de um PDF assinado externamente - ÂMBITO HONESTO. Faz um
 * varrimento de presença de assinatura (dicionário /Sig, /ByteRange, /SubFilter)
 * e NUNCA afirma validade jurídica: a validação qualificada faz-se no validador
 * oficial (validador.autenticacao.gov.pt), sempre indicado com ligação direta.
 */
export default function VerificarPage() {
  const inputRef = useRef(null);
  const [aVerificar, setAVerificar] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null); // null | { nome, ...verificacao }

  useDemoResult('assinatura-verificar-resultado', resultado !== null);

  async function onFile(ev) {
    const file = ev.target && ev.target.files && ev.target.files[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setErro(null);
    setResultado(null);
    setAVerificar(true);
    try {
      const v = await verificarFicheiro(file);
      setResultado({ nome: file.name || 'documento.pdf', ...v });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível ler este ficheiro.');
    } finally {
      setAVerificar(false);
    }
  }

  return (
    <div data-demo-page="assinatura/verificar" data-testid="assinatura-verificar-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Verificar documento assinado</h1>
          <p className="page-subtitle">
            Carregue um PDF para verificar se contém uma assinatura digital. Esta verificação é de presença,
            não de validade jurídica - a validação qualificada faz-se no validador oficial.
          </p>
        </div>
      </div>

      <section className="card" style={{ borderStyle: 'dashed' }} aria-label="Carregar documento">
        <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)', flexWrap: 'wrap' }}>
          <div className="row row-2" style={{ alignItems: 'flex-start' }}>
            <span className="empty-icon" aria-hidden="true" style={{ marginTop: 2 }}><IconShieldCheck /></span>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>Carregar um PDF assinado</h2>
              <p className="card-subtitle" style={{ margin: 0 }}>
                O ficheiro é analisado no browser e não sai da página.
              </p>
            </div>
          </div>
          <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)' }}>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              onChange={onFile}
              data-testid="assinatura-verificar-input"
              style={{ display: 'none' }}
            />
            <Button
              data-testid="assinatura-verificar"
              data-demo-target="assinatura-verificar"
              onClick={() => inputRef.current && inputRef.current.click()}
              disabled={aVerificar}
            >
              <IconUpload /> Carregar PDF
            </Button>
          </div>
        </div>
        {aVerificar ? (
          <div className="loading" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}><span className="spinner" aria-hidden="true" /><span>A analisar o documento.</span></div>
        ) : null}
        {erro ? <p className="resultado-erro" data-testid="assinatura-verificar-erro" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>{erro}</p> : null}
      </section>

      {resultado ? (
        <section className="resultado-panel" data-testid="assinatura-verificar-resultado" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
          <div className="row-space-between" style={{ alignItems: 'center', gap: 'var(--sp-3, 0.75rem)' }}>
            <div className="row row-2" style={{ alignItems: 'center' }}>
              <span aria-hidden="true" style={{ display: 'inline-flex', color: resultado.assinado ? 'var(--ok, #16a34a)' : 'var(--warn, #b45309)' }}>
                {resultado.assinado ? <IconCheck /> : <IconAlertTriangle />}
              </span>
              <h2 className="card-title" style={{ margin: 0 }}>{resultado.nome}</h2>
            </div>
            <Badge tone={resultado.assinado ? 'ok' : 'media'} data-testid="assinatura-verificar-estado">
              {resultado.assinado ? 'Contém assinatura digital' : 'Sem assinatura digital'}
            </Badge>
          </div>

          <dl className="resultado-grid" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
            <div className="resultado-tile">
              <dt className="text-subtle text-xs">Assinatura digital presente</dt>
              <dd className="resultado-value" data-testid="assinatura-verificar-presente">{resultado.assinado ? 'Sim' : 'Não'}</dd>
            </div>
            <div className="resultado-tile">
              <dt className="text-subtle text-xs">Formato (SubFilter)</dt>
              <dd className="resultado-value" data-testid="assinatura-verificar-subfilter">
                {resultado.subFilterPrincipal ? resultado.subFilterDescricao : '—'}
              </dd>
            </div>
            <div className="resultado-tile">
              <dt className="text-subtle text-xs">Dicionários de assinatura</dt>
              <dd className="resultado-value">{resultado.dicionariosSig}</dd>
            </div>
            <div className="resultado-tile">
              <dt className="text-subtle text-xs">Intervalo assinado (ByteRange)</dt>
              <dd className="resultado-value">{resultado.temByteRange ? 'Sim' : 'Não'}</dd>
            </div>
          </dl>

          {resultado.subFilters.length > 1 ? (
            <p className="text-subtle text-xs" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
              Formatos detetados: {resultado.subFilters.join(', ')}.
            </p>
          ) : null}
          {!resultado.ehPdf ? (
            <p className="text-subtle text-xs" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
              O ficheiro não aparenta ser um PDF válido.
            </p>
          ) : null}

          <p className="text-subtle text-xs" data-testid="assinatura-verificar-aviso" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
            {AVISO_VERIFICACAO}
          </p>
          <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)', marginTop: 'var(--sp-3, 0.75rem)' }}>
            <a
              href={VALIDADOR_OFICIAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              data-testid="assinatura-verificar-validador"
            >
              Validar no validador oficial <IconExternalLink />
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
