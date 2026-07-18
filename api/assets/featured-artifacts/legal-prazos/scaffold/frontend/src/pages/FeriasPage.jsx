import { useMemo, useState } from 'react';
import { Badge, Field, Select } from '../components/ui.jsx';
import { IconCalendarClock, IconAlertTriangle } from '../components/Icons.jsx';
import { domingoPascoa, feriadosNacionais, isFeriasJudiciais, iso } from '../engine/prazo.mjs';

// Vista informativa das férias judiciais (LOSJ art. 28.º) e dos feriados
// nacionais que o motor de prazos usa. Todas as datas vêm do PRÓPRIO motor
// (domingoPascoa/feriadosNacionais) - a página nunca pode divergir da contagem.

const MS_DIA = 86400000;
const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dataPt(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} de ${MESES_PT[m - 1]} de ${y}`;
}

// Nomes dos feriados: fixos por MM-DD; móveis calculados a partir da mesma
// Páscoa do motor. O Set do motor é a fonte de verdade - um feriado sem nome
// conhecido aparece na mesma, como "Feriado nacional".
const NOMES_FIXOS = {
  '01-01': 'Ano Novo',
  '04-25': 'Dia da Liberdade',
  '05-01': 'Dia do Trabalhador',
  '06-10': 'Dia de Portugal',
  '08-15': 'Assunção de Nossa Senhora',
  '10-05': 'Implantação da República',
  '11-01': 'Dia de Todos os Santos',
  '12-01': 'Restauração da Independência',
  '12-08': 'Imaculada Conceição',
  '12-25': 'Natal',
};

function nomesFeriados(ano) {
  const pascoa = domingoPascoa(ano);
  const nomes = new Map();
  nomes.set(iso(new Date(pascoa.getTime() - 2 * MS_DIA)), 'Sexta-feira Santa');
  nomes.set(iso(pascoa), 'Domingo de Páscoa');
  nomes.set(iso(new Date(pascoa.getTime() + 60 * MS_DIA)), 'Corpo de Deus');
  return (ymd) => nomes.get(ymd) || NOMES_FIXOS[ymd.slice(5)] || 'Feriado nacional';
}

export default function FeriasPage() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const anos = useMemo(() => [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2], [anoAtual]);

  const dados = useMemo(() => {
    const pascoa = domingoPascoa(ano);
    const ramos = iso(new Date(pascoa.getTime() - 7 * MS_DIA));
    const segundaPascoa = iso(new Date(pascoa.getTime() + 1 * MS_DIA));
    const periodos = [
      {
        key: 'pascoa',
        label: 'Férias da Páscoa',
        de: ramos,
        a: segundaPascoa,
        nota: 'Do Domingo de Ramos à 2.ª-feira de Páscoa (datas móveis, calculadas pelo motor).',
      },
      {
        key: 'verao',
        label: 'Férias de verão',
        de: `${ano}-07-16`,
        a: `${ano}-08-31`,
        nota: 'De 16 de julho a 31 de agosto.',
      },
      {
        key: 'natal',
        label: 'Férias de Natal',
        de: `${ano}-12-22`,
        a: `${ano + 1}-01-03`,
        nota: `De 22 de dezembro a 3 de janeiro (termina já em ${ano + 1}; o período que termina a 3 de janeiro de ${ano} começou a 22 de dezembro de ${ano - 1}).`,
      },
    ];
    const feriados = Array.from(feriadosNacionais(ano)).sort();
    return { periodos, feriados, nomeDe: nomesFeriados(ano) };
  }, [ano]);

  const hojeEmFerias = isFeriasJudiciais(new Date());

  return (
    <div data-testid="ferias-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Férias judiciais</h1>
          <p className="page-subtitle">
            Os períodos em que os prazos processuais (dias úteis) se suspendem, e os feriados que o motor salta.
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={hojeEmFerias ? 'alta' : 'ok'} data-testid="ferias-hoje">
            {hojeEmFerias ? 'Hoje: em férias judiciais' : 'Hoje: fora das férias judiciais'}
          </Badge>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="card-header">
          <h2 className="card-title"><IconCalendarClock /> Períodos de férias judiciais</h2>
          <Field label="Ano">
            <Select value={String(ano)} onChange={(e) => setAno(Number(e.target.value))} data-testid="ferias-ano">
              {anos.map((a) => (
                <option key={a} value={String(a)}>{a}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-subtle" data-testid="ferias-citacao">
          Fonte: LOSJ - Lei n.º 62/2013, de 26 de agosto, art. 28.º. Suspensão dos prazos: CPC art. 138.º n.º 1.
        </p>
        <ul className="list-plain">
          {dados.periodos.map((p) => (
            <li key={p.key} data-testid={`ferias-periodo-${p.key}`} style={{ padding: 'var(--sp-3) 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <span className="text-strong">{p.label}</span>
                <span className="numeric">{dataPt(p.de)} - {dataPt(p.a)}</span>
              </div>
              <p className="text-subtle text-xs" style={{ margin: '4px 0 0' }}>{p.nota}</p>
            </li>
          ))}
        </ul>
        <p className="text-subtle text-xs" style={{ marginTop: 'var(--sp-3)' }}>
          <IconAlertTriangle size={14} /> Durante as férias judiciais os prazos em dias ÚTEIS suspendem-se (CPC art.
          138.º n.º 1). Os prazos do regime CIRE (insolvência) NÃO se suspendem - o processo é urgente e corre em
          férias (CIRE art. 9.º n.º 1); a calculadora aplica esta distinção pelo campo "regime".
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Feriados nacionais de {ano}</h2>
        </div>
        <p className="text-subtle">
          Lista produzida por <code>feriadosNacionais({ano})</code> do motor de prazos - fixos + móveis (calculados a
          partir do Domingo de Páscoa, {dataPt(iso(domingoPascoa(ano)))}).
        </p>
        <ul className="list-plain" data-testid="ferias-feriados">
          {dados.feriados.map((f) => (
            <li key={f} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{dados.nomeDe(f)}</span>
              <span className="numeric text-strong">{dataPt(f)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
