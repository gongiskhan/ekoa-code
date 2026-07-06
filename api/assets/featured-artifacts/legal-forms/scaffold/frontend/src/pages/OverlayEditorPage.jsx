import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getShared,
  updateShared,
  createShared,
} from '../shared.js';
import { Button, Badge, EmptyState, toast } from '../components/ui.jsx';
import { IconClipboardForm, IconEdit } from '../components/Icons.jsx';
import { applyLayoutMemory } from '../engine/forms.mjs';

// Página de placeholder (pdf-lib não renderiza páginas); usamos uma caixa com a
// proporção da página e rectângulos absolutos por campo. Sem pdf.js de propósito.
const A4 = { width: 595.28, height: 841.89 };
const DISPLAY_W = 460; // largura de apresentação da caixa da página, em px
const CAMPO_W = 150; // dimensão por omissão de um campo colocado (unidades PDF)
const CAMPO_H = 18;

function nowISO() {
  return new Date().toISOString();
}

export default function OverlayEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [layout, setLayout] = useState([]); // espelho local de layoutMemoria
  const [seq, setSeq] = useState(1);
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    getShared('form_templates', id)
      .then((t) => {
        if (!alive) return;
        if (!t) { setNotFound(true); setLoading(false); return; }
        setTemplate(t);
        const lm = Array.isArray(t.layoutMemoria) ? t.layoutMemoria : [];
        setLayout(lm);
        setSeq(lm.length + 1);
        setLoading(false);
      })
      .catch(() => { if (alive) { setNotFound(true); setLoading(false); } });
    return () => { alive = false; };
  }, [id]);

  const isAcroform = template && template.tipoPdf === 'acroform';
  const pageSize = (template && Array.isArray(template.pageSizes) && template.pageSizes[0]) || A4;
  const displayH = Math.round((pageSize.height / pageSize.width) * DISPLAY_W);

  // Campos a desenhar: para acroform, os detectados com a memória aplicada; para
  // plano, os colocados manualmente (layoutMemoria).
  const campos = useMemo(() => {
    if (!template) return [];
    if (isAcroform) {
      return applyLayoutMemory({
        camposDetectados: Array.isArray(template.camposDetectados) ? template.camposDetectados : [],
        layoutMemoria: layout,
      }).filter((c) => c.x != null && c.y != null);
    }
    return layout.map((l) => ({ nome: l.campo, tipo: 'text', ...l }));
  }, [template, isAcroform, layout]);

  // Converte um clique (px, origem topo-esquerda) para o rectângulo de um campo
  // em coordenadas PDF (origem inferior-esquerda) na página 0.
  async function onPlace(ev) {
    if (isAcroform || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const relX = ev.clientX - rect.left;
    const relY = ev.clientY - rect.top;
    const pdfX = Math.max(0, Math.round((relX / rect.width) * pageSize.width - CAMPO_W / 2));
    const pdfYtop = (relY / rect.height) * pageSize.height;
    const pdfY = Math.max(0, Math.round(pageSize.height - pdfYtop - CAMPO_H));
    const campo = `campo-${seq}`;
    const entrada = { campo, pagina: 0, x: pdfX, y: pdfY, w: CAMPO_W, h: CAMPO_H };
    const proximo = [...layout, entrada];
    setLayout(proximo);
    setSeq((n) => n + 1);
    try {
      await updateShared('form_templates', template.id, { layoutMemoria: proximo });
      await createShared('form_feedback', { templateId: template.id, campo, correcao: { x: pdfX, y: pdfY, w: CAMPO_W, h: CAMPO_H }, data: nowISO() });
    } catch {
      toast('Não foi possível guardar a disposição.', { tone: 'error' });
    }
  }

  async function removerCampo(campo) {
    const proximo = layout.filter((l) => l.campo !== campo);
    setLayout(proximo);
    try {
      await updateShared('form_templates', template.id, { layoutMemoria: proximo });
    } catch {
      toast('Não foi possível guardar a disposição.', { tone: 'error' });
    }
  }

  if (loading) {
    return (
      <div data-testid="forms-editor-page">
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelo.</span></div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div data-testid="forms-editor-page">
        <EmptyState
          icon={<IconClipboardForm />}
          title="Modelo não encontrado"
          hint="O modelo pode ter sido eliminado."
          action={<Button onClick={() => navigate('/')}>Voltar aos modelos</Button>}
        />
      </div>
    );
  }

  return (
    <div data-testid="forms-editor-page" data-demo-page="forms/editar">
      <div className="page-header">
        <div>
          <h1 className="page-title">Disposição: {template.nome}</h1>
          <p className="page-subtitle">
            {isAcroform
              ? 'Formulário com campos AcroForm - a disposição vem do próprio PDF. O mapeamento faz-se em Preencher.'
              : 'PDF digitalizado - clique na página para colocar um campo. A disposição fica aprendida para as próximas vezes.'}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" data-testid="forms-ir-preencher" onClick={() => navigate(`/preencher?template=${encodeURIComponent(template.id)}`)}>
            <IconEdit /> Preencher
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>Voltar</Button>
        </div>
      </div>

      <div className="contratos-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-5, 1.25rem)', alignItems: 'start' }}>
        {/* Caixa da página com os rectângulos dos campos */}
        <section className="card">
          <h2 className="card-title">Página 1</h2>
          <p className="card-subtitle">{isAcroform ? 'Campos detetados no PDF.' : 'Clique para colocar um campo.'}</p>
          <div
            ref={boxRef}
            data-testid="forms-pagina"
            onClick={onPlace}
            style={{
              position: 'relative',
              width: DISPLAY_W,
              maxWidth: '100%',
              height: displayH,
              margin: 'var(--space-3, 0.75rem) auto 0',
              background: 'var(--color-surface, #fff)',
              border: '1px solid var(--color-border, #E2E8F0)',
              borderRadius: 6,
              cursor: isAcroform ? 'default' : 'crosshair',
              overflow: 'hidden',
            }}
          >
            {campos.map((c) => {
              const left = ((Number(c.x) || 0) / pageSize.width) * DISPLAY_W;
              const width = ((Number(c.w) || CAMPO_W) / pageSize.width) * DISPLAY_W;
              const height = ((Number(c.h) || CAMPO_H) / pageSize.height) * displayH;
              const top = displayH - ((Number(c.y) || 0) / pageSize.height) * displayH - height;
              return (
                <div
                  key={c.nome}
                  title={c.nome}
                  data-testid={`forms-rect-${c.nome}`}
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    width,
                    height,
                    background: 'rgba(20, 184, 166, 0.14)',
                    border: '1px solid var(--color-primary, #0EA5A4)',
                    borderRadius: 2,
                    fontSize: 9,
                    color: 'var(--color-primary, #0EA5A4)',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    padding: '0 2px',
                  }}
                >
                  {c.nome}
                </div>
              );
            })}
          </div>
        </section>

        {/* Lista de campos */}
        <section className="card">
          <div className="row-space-between" style={{ alignItems: 'flex-start' }}>
            <h2 className="card-title">Campos</h2>
            <Badge tone={isAcroform ? 'ok' : 'neutral'}>{isAcroform ? 'AcroForm' : 'Digitalizado'}</Badge>
          </div>
          {campos.length === 0 ? (
            <p className="field-hint" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              {isAcroform ? 'Sem rectângulos legíveis neste PDF.' : 'Ainda não colocou campos. Clique na página ao lado.'}
            </p>
          ) : (
            <div className="stack stack-2" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              {campos.map((c) => (
                <div key={c.nome} className="row-space-between" data-testid={`forms-campo-item-${c.nome}`} style={{ padding: 'var(--space-2, 0.5rem) 0', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
                  <div>
                    <span className="text-small" style={{ fontWeight: 600 }}>{c.nome}</span>
                    <span className="text-small text-subtle" style={{ display: 'block' }}>{c.tipo || 'text'}{c.memoria ? ' · aprendido' : ''}</span>
                  </div>
                  {!isAcroform ? (
                    <Button size="sm" variant="ghost" data-testid={`forms-remover-${c.nome}`} onClick={() => removerCampo(c.nome)}>Remover</Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
