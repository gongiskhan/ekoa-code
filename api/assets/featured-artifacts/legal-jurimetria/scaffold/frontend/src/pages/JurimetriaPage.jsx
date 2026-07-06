import { useEffect, useMemo, useState } from 'react';
import { useSharedCollection, createShared, listShared, formatDate } from '../shared.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconChartBar, IconFileText, IconPrinter } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import REFERENCIAS from '../referencias.json';

/* Meses entre duas datas ISO (aproximação a 30,44 dias - suficiente para médias). */
function mesesEntre(a, b) {
  const da = new Date(a); const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.max(0, (db.getTime() - da.getTime()) / (30.44 * 86400000));
}

/*
 * Comparador interno: os processos FINDOS do escritório (dataAbertura ->
 * dataFecho) contra as referências públicas por área. Estatística descritiva -
 * médias históricas; a página nunca fala do desfecho de um caso concreto.
 */
export default function JurimetriaPage() {
  const toast = useToast();
  const { items: processos } = useSharedCollection('processos');
  const [ficha, setFicha] = useState('');

  const findosPorArea = useMemo(() => {
    const grupos = {};
    for (const p of processos) {
      if (p.estado !== 'arquivado' || !p.dataAbertura || !p.dataFecho) continue;
      const m = mesesEntre(p.dataAbertura, p.dataFecho);
      if (m == null) continue;
      (grupos[p.area || 'Outra'] ||= []).push(m);
    }
    return Object.entries(grupos).map(([area, meses]) => ({
      area,
      n: meses.length,
      mediaMeses: Math.round((meses.reduce((s, x) => s + x, 0) / meses.length) * 10) / 10,
    })).sort((a, b) => b.n - a.n);
  }, [processos]);

  const linhas = useMemo(() => findosPorArea.map((f) => {
    const ref = REFERENCIAS.referencias.find((r) => r.area === f.area) || null;
    return { ...f, ref: ref ? ref.duracaoMediaMeses : null, refNota: ref ? ref.nota : null };
  }), [findosPorArea]);

  useDemoResult('jurimetria-ficha', Boolean(ficha), 'Ficha de expectativas gerada');

  async function gerarFicha() {
    const corpo = [
      'FICHA DE EXPECTATIVAS - durações médias (estatística descritiva)',
      `Fonte pública: ${REFERENCIAS.fonte} · período ${REFERENCIAS.periodo}`,
      `Amostra interna: processos findos do escritório (${findosPorArea.reduce((s, f) => s + f.n, 0)} processos)`,
      '',
      ...linhas.map((l) => `  ${l.area}: média interna ${l.mediaMeses} meses (n=${l.n}) · média pública ${l.ref != null ? `${l.ref} meses` : 'sem referência publicada'}`),
      '',
      'Nota: valores são médias históricas de conjuntos de processos.',
      'Não constituem garantia nem antecipação do desfecho ou da duração de um caso concreto.',
    ].join('\n');
    setFicha(corpo);
    await createShared('documentos', {
      nome: `Ficha de expectativas - ${new Date().toISOString().slice(0, 10)}.txt`,
      tipo: 'ficha-expectativas', origem: 'legal-jurimetria', conteudo: corpo,
    });
    toast('Ficha gerada e arquivada nos documentos (partilhável via portal, por decisão explícita).');
  }

  return (
    <div className="stack stack-6" data-demo-page="jurimetria/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Jurimetria - médias, com fonte</h1>
          <p className="card-subtitle">
            Durações médias públicas por área processual ({REFERENCIAS.fonte}, {REFERENCIAS.periodo})
            comparadas com a experiência do próprio escritório. Estatística descritiva - médias históricas,
            nunca a antecipação do desfecho de um caso.
          </p>
        </div>
      </div>

      <section className="card" data-testid="jurimetria-tabela" data-demo-target="jurimetria-explicacao">
        <h2 className="card-title">Comparador interno vs. médias públicas</h2>
        {linhas.length === 0 ? (
          <EmptyState title="Sem processos findos" hint="O comparador precisa de processos arquivados com datas de abertura e fecho." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Área</th><th>Findos (n)</th><th>Média interna</th><th>Média pública</th><th>Fonte</th></tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.area} data-testid="jurimetria-linha">
                    <td>{l.area}</td>
                    <td className="numeric">{l.n}</td>
                    <td className="numeric" data-testid={`interna-${l.area}`}>{l.mediaMeses} meses</td>
                    <td className="numeric">{l.ref != null ? `${l.ref} meses` : '-'}</td>
                    <td className="text-xs text-subtle">{l.ref != null ? `${REFERENCIAS.fonte} · ${REFERENCIAS.periodo}` : 'sem referência'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="field-hint">
          Referências nacionais por área (os dados abertos da DGPJ não publicam desagregação por comarca);
          valores por confirmar saram-se com a ingestão periódica do conjunto público.
        </p>
      </section>

      <section className="card" data-testid="jurimetria-ficha-card">
        <h2 className="card-title">Ficha de expectativas para o cliente</h2>
        {!ficha ? (
          <Button data-testid="jurimetria-gerar" data-demo-target="jurimetria-gerar" onClick={gerarFicha}>
            <IconFileText /> Gerar ficha de expectativas
          </Button>
        ) : (
          <>
            <pre data-testid="jurimetria-ficha" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 'var(--sp-3)', borderRadius: 'var(--r-2)', fontSize: '0.8125rem' }}>{ficha}</pre>
            <Button variant="secondary" data-testid="jurimetria-imprimir" onClick={() => window.print()}>
              <IconPrinter /> Imprimir / PDF
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
