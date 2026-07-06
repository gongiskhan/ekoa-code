import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSharedCollection,
  listShared,
  createShared,
  deleteShared,
  formatDate,
} from '../shared.js';
import {
  Button,
  Badge,
  SearchInput,
  EmptyState,
  ConfirmDialog,
  toast,
} from '../components/ui.jsx';
import { IconClipboardForm, IconUpload, IconFilePdf } from '../components/Icons.jsx';
import { computeFingerprint, matchTemplate, suggestMapeamento } from '../engine/forms.mjs';
import { detectForm, fileToBytes, base64ToBytes, bytesToBase64 } from './forms-pdf.js';
import { EXEMPLO_PROCURACAO_PDF_B64 } from '../data/exemplo-procuracao.pdf.b64.js';

const NOME_EXEMPLO = 'Procuração forense (exemplo)';

/* Rótulo humano para o tipo de PDF. */
function tipoLabel(tipoPdf) {
  return tipoPdf === 'acroform' ? 'AcroForm' : 'Digitalizado';
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { items: templates, loading, refresh } = useSharedCollection('form_templates');

  const [query, setQuery] = useState('');
  const [aProcessar, setAProcessar] = useState(false);
  const [erro, setErro] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const inputRef = useRef(null);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates
      .filter((t) => {
        if (!q) return true;
        return [t.nome, tipoLabel(t.tipoPdf)].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }, [templates, query]);

  // Caminho único de todo o "trazer um PDF" (upload real OU botão de exemplo):
  // deteta os campos, calcula a impressão digital, reconhece um modelo já visto
  // e, ou abre o reconhecido, ou cria a linha do modelo e abre-a para preencher.
  async function abrirPdf({ bytes, nome, origem }) {
    setErro(null);
    setAProcessar(true);
    try {
      const detalhe = await detectForm(bytes);
      const fingerprint = computeFingerprint({ paginas: detalhe.paginas, fieldNames: detalhe.fieldNames });

      const existentes = await listShared('form_templates');
      const match = matchTemplate({ fingerprint, templates: existentes });
      if (match && match.id) {
        // Reconhecido pela impressão digital - abre o modelo com a disposição
        // aprendida aplicada e sinaliza o reconhecimento na página de preenchimento.
        navigate(`/preencher?template=${encodeURIComponent(match.id)}&reconhecido=1`);
        return;
      }

      const mapeamento = suggestMapeamento(detalhe.fieldNames).map((s) => ({ campo: s.campo, origem: s.origem }));
      const criado = await createShared('form_templates', {
        nome,
        origem,
        tipoPdf: detalhe.tipoPdf,
        fingerprint,
        pageSizes: detalhe.pageSizes,
        camposDetectados: detalhe.camposDetectados,
        mapeamento,
        layoutMemoria: [],
        pdfBase64: bytesToBase64(bytes),
        versao: 1,
      });
      if (!criado || !criado.id) throw new Error('Não foi possível guardar o modelo.');
      navigate(`/preencher?template=${encodeURIComponent(criado.id)}`);
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível ler este PDF.');
      setAProcessar(false);
    }
  }

  async function onFile(ev) {
    const file = ev.target && ev.target.files && ev.target.files[0];
    if (inputRef.current) inputRef.current.value = ''; // permite reescolher o mesmo ficheiro
    if (!file) return;
    if (file.type && file.type !== 'application/pdf') {
      setErro('Escolha um ficheiro PDF.');
      return;
    }
    const bytes = await fileToBytes(file);
    const nome = (file.name || 'Formulário').replace(/\.pdf$/i, '');
    await abrirPdf({ bytes, nome, origem: 'upload' });
  }

  async function onExemplo() {
    const bytes = base64ToBytes(EXEMPLO_PROCURACAO_PDF_B64);
    await abrirPdf({ bytes, nome: NOME_EXEMPLO, origem: 'biblioteca' });
  }

  async function onEliminarConfirmado() {
    const alvo = aEliminar;
    setAEliminar(null);
    if (!alvo) return;
    try {
      await deleteShared('form_templates', alvo.id);
      await refresh();
      toast('Modelo eliminado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível eliminar o modelo.', { tone: 'error' });
    }
  }

  return (
    <div data-testid="forms-templates-page" data-demo-page="forms/modelos">
      <div className="page-header">
        <div>
          <h1 className="page-title">Modelos de formulário</h1>
          <p className="page-subtitle">
            Carregue um formulário oficial em PDF. Os campos AcroForm são detetados e mapeados ao cliente e ao
            processo; a disposição aprendida é reconhecida da próxima vez pela impressão digital do documento.
          </p>
        </div>
      </div>

      {/* Zona de carregamento + exemplo */}
      <section
        className="card"
        data-demo-target="forms-upload"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)', borderStyle: 'dashed' }}
      >
        <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--space-3, 0.75rem)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3, 0.75rem)', alignItems: 'flex-start' }}>
            <span className="empty-icon" aria-hidden="true" style={{ marginTop: 2 }}><IconFilePdf /></span>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>Carregar um formulário</h2>
              <p className="card-subtitle" style={{ margin: 0 }}>
                PDF com campos preenchíveis (AcroForm) - a maioria dos formulários oficiais. Sem sair da página.
              </p>
            </div>
          </div>
          <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              onChange={onFile}
              data-testid="forms-file-input"
              style={{ display: 'none' }}
            />
            <Button data-testid="forms-carregar" onClick={() => inputRef.current && inputRef.current.click()} disabled={aProcessar}>
              <IconUpload /> Carregar PDF
            </Button>
            <Button variant="secondary" data-demo-target="forms-exemplo" data-testid="forms-exemplo" onClick={onExemplo} disabled={aProcessar}>
              Usar exemplo
            </Button>
          </div>
        </div>

        {/* Deteção assistida por IA para PDF digitalizados - em preparação. */}
        <p className="field-hint" data-testid="forms-ia-nota" style={{ margin: 0 }}>
          Para PDF digitalizados (imagem), a deteção assistida por IA para colocar os campos será ativada com a
          ligação ao modelo. Por agora, os PDF digitalizados abrem no editor de disposição para colocação manual dos campos.
        </p>

        {aProcessar ? (
          <div className="loading" data-testid="forms-a-processar"><span className="spinner" aria-hidden="true" /><span>A ler o PDF.</span></div>
        ) : null}
        {erro ? <p className="resultado-erro" data-testid="forms-erro">{erro}</p> : null}
      </section>

      <div className="filters" style={{ marginTop: 'var(--space-5, 1.25rem)' }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por nome ou tipo…"
          data-testid="forms-pesquisa"
        />
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelos.</span></div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={<IconClipboardForm />}
          title={templates.length === 0 ? 'Ainda não há modelos' : 'Sem resultados'}
          hint={
            templates.length === 0
              ? 'Carregue um formulário em PDF, ou use o exemplo, para criar o primeiro modelo.'
              : 'Nenhum modelo corresponde à pesquisa.'
          }
          action={
            templates.length === 0 ? (
              <Button data-testid="forms-exemplo-vazio" onClick={onExemplo} disabled={aProcessar}>Usar exemplo</Button>
            ) : null
          }
        />
      ) : (
        <div className="launcher-grid" data-testid="forms-lista">
          {filtrados.map((t) => {
            const nCampos = Array.isArray(t.camposDetectados) ? t.camposDetectados.length : 0;
            return (
              <article
                key={t.id}
                className="card card-hover"
                data-testid={`forms-card-${t.id}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)' }}
              >
                <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--space-3, 0.75rem)' }}>
                  <span className="launcher-title">{t.nome || '(sem nome)'}</span>
                  <Badge tone={t.tipoPdf === 'acroform' ? 'ok' : 'neutral'}>{tipoLabel(t.tipoPdf)}</Badge>
                </div>
                <div className="row-space-between" style={{ marginTop: 'auto' }}>
                  <span className="text-small text-subtle">
                    {nCampos} {nCampos === 1 ? 'campo' : 'campos'}
                  </span>
                  <span className="text-small text-subtle">Versão {t.versao || 1} · {formatDate(t.updatedAt || t.createdAt)}</span>
                </div>
                <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
                  <Button size="sm" data-testid={`forms-preencher-${t.id}`} onClick={() => navigate(`/preencher?template=${encodeURIComponent(t.id)}`)}>
                    Preencher
                  </Button>
                  <Button size="sm" variant="ghost" data-testid={`forms-editar-${t.id}`} onClick={() => navigate(`/editar/${encodeURIComponent(t.id)}`)}>
                    Disposição
                  </Button>
                  <Button size="sm" variant="ghost" data-testid={`forms-eliminar-${t.id}`} onClick={() => setAEliminar(t)}>
                    Eliminar
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!aEliminar}
        title="Eliminar modelo"
        message={aEliminar ? `Eliminar o modelo "${aEliminar.nome}"? Os documentos já exportados mantêm-se no dossiê.` : ''}
        confirmLabel="Eliminar"
        danger
        onConfirm={onEliminarConfirmado}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
