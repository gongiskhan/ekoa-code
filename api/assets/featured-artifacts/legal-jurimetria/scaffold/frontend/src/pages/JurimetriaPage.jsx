import { useMemo, useState } from 'react';
import { useSharedCollection, createShared } from '../shared.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconFileText, IconPrinter } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import REFERENCIAS from '../referencias.json';
import {
  construirLinhas,
  totalFindos,
  comparadorSemDados,
  fonteInterna,
  fontePublica,
  AMOSTRA_MINIMA,
} from './jurimetria-stats.js';

/*
 * Comparador interno: os processos FINDOS do escritório (dataAbertura ->
 * dataFecho) contra as referências públicas por área. Estatística descritiva -
 * médias históricas; a página nunca fala do desfecho de um caso concreto.
 *
 * REGRA DA HONESTIDADE ESTATÍSTICA (ver jurimetria-stats.js): toda a estatística
 * mostrada carrega fonte + período. A média interna só aparece com amostra
 * suficiente (n >= AMOSTRA_MINIMA); abaixo disso a linha diz "sem dados
 * suficientes", nunca um número enganador. A média pública cita a DGPJ e o seu
 * período; sem referência publicada, di-lo.
 */
export default function JurimetriaPage() {
  const toast = useToast();
  const { items: processos } = useSharedCollection('processos');
  const [ficha, setFicha] = useState('');

  const linhas = useMemo(() => construirLinhas(processos, REFERENCIAS), [processos]);
  const total = useMemo(() => totalFindos(linhas), [linhas]);
  const semDados = useMemo(() => comparadorSemDados(linhas), [linhas]);

  useDemoResult('jurimetria-ficha', Boolean(ficha), 'Ficha de expectativas gerada');

  async function gerarFicha() {
    const publicaveis = linhas.filter((l) => l.suficiente);
    const corpo = [
      'FICHA DE EXPECTATIVAS - durações médias (estatística descritiva)',
      `Fonte pública: ${REFERENCIAS.fonte} · período ${REFERENCIAS.periodo}`,
      `Amostra interna: processos findos do escritório (${total} processos; mínimo ${AMOSTRA_MINIMA} por área para publicar média)`,
      '',
      ...publicaveis.map((l) => {
        const pub = l.refMeses != null ? `${l.refMeses} meses` : 'sem referência publicada';
        return `  ${l.area}: média interna ${l.mediaMeses} meses (n=${l.n}${l.periodoInterno ? `, fechos ${l.periodoInterno}` : ''}) · média pública ${pub}`;
      }),
      ...(publicaveis.length === 0
        ? ['  Sem áreas com amostra suficiente - a ficha não publica médias enganadoras.']
        : []),
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
          <EmptyState
            title="Sem processos findos"
            hint="O comparador precisa de processos arquivados com datas de abertura e fecho. Sem eles, não há médias a mostrar - e nada é inventado."
          />
        ) : semDados ? (
          <div className="resultado-panel" data-testid="jurimetria-sem-dados">
            <p className="text-strong" style={{ margin: 0 }}>Sem dados suficientes</p>
            <p className="text-subtle text-small" style={{ margin: '4px 0 0' }}>
              Nenhuma área tem, ainda, {AMOSTRA_MINIMA} ou mais processos findos - uma média sobre 1 ou 2 casos seria
              enganadora. As médias internas aparecem à medida que o escritório fecha mais processos. As referências
              públicas ({REFERENCIAS.fonte} · {REFERENCIAS.periodo}) continuam abaixo para enquadramento.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Findos (n)</th>
                  <th>Média interna</th>
                  <th>Fonte interna</th>
                  <th>Média pública</th>
                  <th>Fonte pública</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.area} data-testid="jurimetria-linha">
                    <td>{l.area}</td>
                    <td className="numeric">{l.n}</td>
                    <td className="numeric" data-testid={`interna-${l.area}`}>
                      {l.suficiente ? (
                        `${l.mediaMeses} meses`
                      ) : (
                        <span className="text-subtle text-xs" data-testid={`interna-sem-dados-${l.area}`}>sem dados suficientes (n={l.n})</span>
                      )}
                    </td>
                    <td className="text-xs text-subtle" data-testid={`fonte-interna-${l.area}`}>
                      {fonteInterna(l) || `mínimo ${AMOSTRA_MINIMA} findos`}
                    </td>
                    <td className="numeric">{l.refMeses != null ? `${l.refMeses} meses` : '-'}</td>
                    <td className="text-xs text-subtle" data-testid={`fonte-publica-${l.area}`}>
                      {fontePublica(l) || 'sem referência'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="field-hint">
          Cada número traz a sua fonte e período: a média interna cita a amostra do escritório (n e intervalo de
          fechos); a média pública cita a DGPJ. Referências nacionais por área (os dados abertos da DGPJ não publicam
          desagregação por comarca); valores por confirmar saram-se com a ingestão periódica do conjunto público.
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
