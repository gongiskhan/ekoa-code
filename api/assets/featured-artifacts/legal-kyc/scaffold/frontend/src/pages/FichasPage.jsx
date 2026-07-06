import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate, diasRestantes } from '../shared.js';
import {
  Button,
  Badge,
  Select,
  DataTable,
  EmptyState,
} from '../components/ui.jsx';
import { IconPlus, IconShieldCheck, IconShieldAlert } from '../components/Icons.jsx';
import {
  RISCO_TONE,
  RISCO_LABEL,
  ESTADO_LABEL,
  ESTADO_TONE,
  RCBE_ESTADO_LABEL,
  RCBE_ESTADO_TONE,
} from './kyc-helpers.js';

/* Aviso de conservação - sempre visível. As fichas de diligência conservam-se
 * 7 anos (art. 51.º da Lei n.º 83/2017), por isso NÃO há remoção antes da data
 * de arquivo. */
function ConservacaoBanner() {
  return (
    <div className="citius-resultado is-review" data-testid="kyc-conservacao" role="note">
      <span className="citius-resultado-icon" aria-hidden="true"><IconShieldCheck /></span>
      <span className="citius-resultado-text">
        <span className="citius-resultado-strong">Conservação obrigatória de 7 anos</span>
        <span className="citius-resultado-meta">
          As fichas de diligência conservam-se durante 7 anos após a aprovação (art. 51.º da
          Lei n.º 83/2017). Por esse motivo não podem ser eliminadas antes da data de arquivo.
        </span>
      </span>
    </div>
  );
}

/* Célula da data de arquivo: mostra a data e, quando falta menos de 180 dias,
 * um aviso de proximidade. Antes da aprovação a data ainda não existe. */
function ArquivoCell({ ficha }) {
  if (!ficha.arquivarAte) {
    return <span className="text-subtle text-xs">Após aprovação</span>;
  }
  const dias = diasRestantes(ficha.arquivarAte);
  const proximo = Number.isFinite(dias) && dias <= 180;
  return (
    <div className="stack stack-1">
      <span className="text-strong">{formatDate(ficha.arquivarAte)}</span>
      {proximo ? (
        <Badge tone="media" data-testid="arquivo-proximo">
          {dias < 0 ? 'Prazo de arquivo atingido' : `Faltam ${dias} dias`}
        </Badge>
      ) : null}
    </div>
  );
}

export default function FichasPage() {
  const navigate = useNavigate();
  const { items: fichas, loading } = useSharedCollection('kyc_fichas');
  const { items: clientes } = useSharedCollection('clientes');

  const [fEstado, setFEstado] = useState('');
  const [fRisco, setFRisco] = useState('');

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '(cliente removido)';
  }, [clientes]);

  const rows = useMemo(() => {
    let list = fichas.slice();
    if (fEstado) list = list.filter((f) => (f.estado || 'em_analise') === fEstado);
    if (fRisco) list = list.filter((f) => (f.risco || '') === fRisco);
    // Mais recentes primeiro (createdAt desc).
    return list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [fichas, fEstado, fRisco]);

  return (
    <div data-testid="fichas-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fichas de diligência</h1>
          <p className="page-subtitle">
            Identificação e diligência de clientes (Lei n.º 83/2017). O risco é pontuado por um
            motor determinístico e cada ficha conserva-se 7 anos.
          </p>
        </div>
        <Button data-testid="nova-ficha" onClick={() => navigate('/nova')}>
          <IconPlus /> Nova ficha
        </Button>
      </div>

      <ConservacaoBanner />

      <div className="filters" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <Select data-testid="filtro-estado" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos os estados</option>
          <option value="em_analise">Em análise</option>
          <option value="aprovada">Aprovadas</option>
          <option value="recusada">Recusadas</option>
        </Select>
        <Select data-testid="filtro-risco" value={fRisco} onChange={(e) => setFRisco(e.target.value)}>
          <option value="">Todos os riscos</option>
          <option value="baixo">Risco baixo</option>
          <option value="medio">Risco médio</option>
          <option value="alto">Risco elevado</option>
        </Select>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar fichas.</span></div>
      ) : (
        <div data-demo-target="kyc-fichas" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
          <DataTable
            data-testid="kyc-fichas-tabela"
            columns={[
              { key: 'cliente', label: 'Cliente', render: (f) => (
                <span className="text-strong">{clienteNome(f.clienteId)}</span>
              ) },
              { key: 'risco', label: 'Risco', render: (f) => (
                <Badge tone={RISCO_TONE[f.risco] || 'neutral'} data-testid="risco-badge">
                  {RISCO_LABEL[f.risco] || f.risco || '—'}
                </Badge>
              ) },
              { key: 'estado', label: 'Estado', render: (f) => (
                <Badge tone={ESTADO_TONE[f.estado] || 'neutral'}>
                  {ESTADO_LABEL[f.estado] || f.estado || '—'}
                </Badge>
              ) },
              { key: 'rcbe', label: 'RCBE', render: (f) => {
                const estado = (f.rcbe && f.rcbe.estado) || 'pendente';
                return (
                  <Badge tone={RCBE_ESTADO_TONE[estado] || 'neutral'}>
                    {RCBE_ESTADO_LABEL[estado] || estado}
                  </Badge>
                );
              } },
              { key: 'arquivo', label: 'Arquivo até', render: (f) => <ArquivoCell ficha={f} /> },
            ]}
            rows={rows}
            rowKey="id"
            onRowClick={(f) => navigate(`/ficha/${f.id}`)}
            empty={
              <EmptyState
                icon={<IconShieldAlert />}
                title="Sem fichas"
                hint={
                  fEstado || fRisco
                    ? 'Nenhuma ficha corresponde a este filtro.'
                    : 'Crie a primeira ficha de diligência de um cliente.'
                }
              />
            }
          />
        </div>
      )}
    </div>
  );
}
