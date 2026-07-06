import { IconAlertTriangle } from '../components/Icons.jsx';
import { DISCLAIMER } from './pecas-logic.js';

/*
 * Aviso FIXO e obrigatório em cada superfície de edição de peças: a redação é um
 * rascunho determinístico; o advogado revê sempre. O anel `data-demo-target`
 * ("pecas-disclaimer") é único por ecrã - o assistente e os testes localizam-no.
 */
export default function Disclaimer({ style }) {
  return (
    <div
      className="pecas-disclaimer"
      data-demo-target="pecas-disclaimer"
      role="note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2, 0.5rem)',
        padding: 'var(--space-3, 0.75rem) var(--space-4, 1rem)',
        borderRadius: 'var(--radius-md, 0.5rem)',
        background: 'rgba(217, 119, 6, 0.10)',
        border: '1px solid rgba(217, 119, 6, 0.30)',
        fontSize: 'var(--text-sm, 0.875rem)',
        ...(style || {}),
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--warn, #d97706)', display: 'inline-flex', flexShrink: 0 }}>
        <IconAlertTriangle size={16} />
      </span>
      <span className="text-strong" style={{ color: 'var(--color-text, #0F172A)' }}>{DISCLAIMER}</span>
    </div>
  );
}
