/*
 * Botão "Copiar citação" - app-local (vive só na Pesquisa). Coloca na área de
 * transferência a referência da citação segundo a norma portuguesa (ver
 * citacao-pt.js), com o URL verificável entre parênteses. Nunca inventa
 * elementos: reescreve apenas o que a citação guardada já contém.
 *
 * Mostra a forma da referência (acórdão / diploma / título) num rótulo discreto,
 * para o advogado saber, antes de colar, se saiu a forma canónica do foro ou uma
 * degradação honesta.
 */
import { useState } from 'react';
import { Button, toast } from '../components/ui.jsx';
import { IconFileText, IconCheck } from '../components/Icons.jsx';
import { formatarCitacao, citacaoParaClipboard, copiarTexto } from './citacao-pt.js';

const FORMA_LABEL = {
  acordao: 'forma do foro (acórdão)',
  diploma: 'diploma (DRE)',
  titulo: 'título da fonte',
};

export function CopiarCitacaoButton({ citacao, size = 'sm' }) {
  const [copiado, setCopiado] = useState(false);
  const { referencia, forma } = formatarCitacao(citacao);

  async function copiar() {
    const texto = citacaoParaClipboard(citacao);
    const ok = await copiarTexto(texto);
    if (ok) {
      setCopiado(true);
      toast('Citação copiada na forma portuguesa.', { tone: 'ok' });
      setTimeout(() => setCopiado(false), 2500);
    } else {
      toast('Não foi possível copiar automaticamente. Referência mostrada para cópia manual.', { tone: 'error' });
    }
  }

  return (
    <div className="stack stack-1" data-testid="pesquisa-citacao-pt">
      <span
        className="text-xs"
        data-testid="pesquisa-citacao-pt-texto"
        style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', wordBreak: 'break-word' }}
      >
        {referencia}
      </span>
      <div className="row row-2" style={{ alignItems: 'center', gap: 'var(--sp-2)' }}>
        <Button
          size={size}
          variant="ghost"
          data-testid="pesquisa-copiar-citacao"
          onClick={copiar}
          title="Copiar a referência na forma portuguesa (norma do foro)"
        >
          {copiado ? <IconCheck size={13} /> : <IconFileText size={13} />} {copiado ? 'Copiado' : 'Copiar citação'}
        </Button>
        <span className="text-subtle text-xs" data-testid="pesquisa-citacao-pt-forma">
          {FORMA_LABEL[forma] || forma}
        </span>
      </div>
    </div>
  );
}
