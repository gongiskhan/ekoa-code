import { useEffect, useMemo, useState } from 'react';
import { useSharedCollection, formatEur, formatDateTime } from '../shared.js';
import { Badge, EmptyState, toast } from '../components/ui.jsx';
import { IconFileText, IconPrinter, IconLink, IconEuro, IconGavel } from '../components/Icons.jsx';
import { memoriaTexto } from './calculo-view.js';

// Isolamento de impressão: só o bloco #calculo-print é visível no diálogo de
// impressão (o resto da moldura fica oculto), sem depender de printChrome no
// registo do Layout. Escrito uma vez pelo próprio app.
const PRINT_CSS = `
#calculo-print { display: none; }
@media print {
  body * { visibility: hidden !important; }
  #calculo-print, #calculo-print * { visibility: visible !important; }
  #calculo-print { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
}
`;

/* Bloco estruturado, pronto a colar numa peça/carta (título + memória + fontes). */
function blocoParaPeca(row) {
  const kind = row.tipo === 'custas' ? 'custas' : 'juros';
  const linhas = [row.titulo || (kind === 'custas' ? 'Taxa de justiça' : 'Juros de mora'), ''];
  linhas.push(memoriaTexto(row.resultado || {}, kind));
  const citas = Array.isArray(row.citas) ? row.citas : [];
  if (citas.length) {
    linhas.push('', 'Fundamentação:');
    for (const c of citas) linhas.push(`- ${c}`);
  }
  return linhas.join('\n');
}

async function copiar(texto) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch { /* cai no fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function MemoriasPage() {
  const { items, loading, refresh } = useSharedCollection('calculos');
  const [printRow, setPrintRow] = useState(null);

  // Imprime quando um registo é seleccionado para exportação (após o render).
  useEffect(() => {
    if (!printRow) return undefined;
    const id = window.requestAnimationFrame(() => {
      try { window.print(); } catch { /* sem impressão disponível */ }
    });
    return () => window.cancelAnimationFrame(id);
  }, [printRow]);

  const ordenados = useMemo(() => {
    return (items || []).slice().sort((a, b) => String(b.data || b.createdAt || '').localeCompare(String(a.data || a.createdAt || '')));
  }, [items]);

  async function onCopiar(row) {
    const ok = await copiar(blocoParaPeca(row));
    toast(ok ? 'Memória copiada para a área de transferência.' : 'Não foi possível copiar.', { tone: ok ? 'ok' : 'alta' });
  }

  function valorDe(row) {
    if (row.tipo === 'custas') return row.resultado && row.resultado.valor;
    return row.resultado && row.resultado.total;
  }

  return (
    <div data-testid="memorias-page" data-demo-page="calculos/memorias">
      <style>{PRINT_CSS}</style>

      <div className="page-header">
        <div>
          <h1 className="page-title">Memórias de cálculo</h1>
          <p className="page-subtitle">
            Os cálculos guardados, prontos a exportar em PDF ou a copiar para uma peça. Cada memória mantém a
            fonte citada.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="refrescar" onClick={() => refresh()}>Actualizar</button>
      </div>

      {loading ? (
        <div className="card"><p className="text-subtle">A carregar memórias.</p></div>
      ) : ordenados.length === 0 ? (
        <EmptyState
          icon={<IconFileText />}
          title="Sem memórias guardadas"
          hint="Calcule juros de mora ou uma taxa de justiça e guarde a memória para a acompanhar aqui."
        />
      ) : (
        <div className="table-wrap" data-testid="memorias-lista">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cálculo</th>
                <th>Tipo</th>
                <th className="numeric">Valor</th>
                <th>Data</th>
                <th className="numeric">Acções</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((row) => (
                <tr key={row.id} data-testid="memoria-row">
                  <td><span className="text-strong">{row.titulo || '(sem título)'}</span></td>
                  <td>
                    <Badge tone={row.tipo === 'custas' ? 'info' : 'ok'}>
                      {row.tipo === 'custas' ? <><IconGavel /> Taxa de justiça</> : <><IconEuro /> Juros de mora</>}
                    </Badge>
                  </td>
                  <td className="numeric text-strong">{formatEur(valorDe(row))}</td>
                  <td className="text-subtle">{formatDateTime(row.data || row.createdAt)}</td>
                  <td className="numeric">
                    <div className="row" style={{ gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-secondary btn-sm" data-testid="exportar-memoria" onClick={() => setPrintRow(row)}>
                        <IconPrinter /> Exportar memória
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" data-testid="copiar-peca" onClick={() => onCopiar(row)}>
                        <IconLink /> Copiar para peça
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Alvo de impressão isolado (oculto no ecrã; visível só no PDF). */}
      <div id="calculo-print" data-testid="calculo-print">
        {printRow ? (
          <article>
            <h1>{printRow.titulo || 'Memória de cálculo'}</h1>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{memoriaTexto(printRow.resultado || {}, printRow.tipo === 'custas' ? 'custas' : 'juros')}</pre>
            {Array.isArray(printRow.citas) && printRow.citas.length ? (
              <>
                <h2>Fundamentação</h2>
                <ul>{printRow.citas.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </>
            ) : null}
          </article>
        ) : null}
      </div>
    </div>
  );
}
