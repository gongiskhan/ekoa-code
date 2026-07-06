import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSharedCollection, formatDate, formatDateTime } from '../shared.js';
import {
  Button,
  Badge,
  DataTable,
  Modal,
  Field,
  Input,
  SearchInput,
  EmptyState,
  Skeleton,
  toast,
} from '../components/ui.jsx';
import { IconDoor, IconLink, IconUsers } from '../components/Icons.jsx';
import {
  listUtilizadores,
  convidarCliente,
  definirEstadoAcesso,
  definirLink,
} from '../portal.js';

const ESTADO_TONE = { ativo: 'ok', convidado: 'info', suspenso: 'media', sem: 'neutral' };
const ESTADO_LABEL = { ativo: 'Ativo', convidado: 'Convidado', suspenso: 'Suspenso', sem: 'Sem acesso' };

/* Loja por-app de utilizadores (credenciais) - lida à parte da espinha. */
function useUtilizadores() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listUtilizadores());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { items, loading, refresh };
}

export default function AcessosPage() {
  const { items: clientes, loading: loadingClientes } = useSharedCollection('clientes');
  const { items: acessos, refresh: refreshAcessos } = useSharedCollection('portal_acessos');
  const { refresh: refreshUtilizadores } = useUtilizadores();

  const [query, setQuery] = useState('');
  const [convite, setConvite] = useState(null); // { cliente, link }
  const [busyId, setBusyId] = useState(null);

  const acessoByCliente = useMemo(() => {
    const m = new Map();
    for (const a of acessos) m.set(a.clienteId, a);
    return m;
  }, [acessos]);

  const linhas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clientes
      .map((c) => {
        const acesso = acessoByCliente.get(c.id) || null;
        const estado = acesso ? acesso.estado || 'convidado' : 'sem';
        return { cliente: c, acesso, estado };
      })
      .filter(({ cliente }) => {
        if (!q) return true;
        return `${cliente.nome || ''} ${cliente.email || ''} ${cliente.nif || ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.cliente.nome || '').localeCompare(String(b.cliente.nome || ''), 'pt'));
  }, [clientes, acessoByCliente, query]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshAcessos(), refreshUtilizadores()]);
  }, [refreshAcessos, refreshUtilizadores]);

  async function onConvidar(cliente) {
    if (!cliente.email) {
      toast('Este cliente não tem email - registe-o no Núcleo antes de convidar.', { tone: 'error' });
      return;
    }
    setBusyId(cliente.id);
    try {
      const { token } = await convidarCliente(cliente);
      await refreshAll();
      setConvite({ cliente, link: definirLink(token) });
      toast('Convite criado. Partilhe o link de definição de palavra-passe.', { tone: 'ok' });
    } catch (err) {
      toast(err && err.message === 'sem_email' ? 'O cliente não tem email.' : 'Não foi possível convidar.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function onEstado(cliente, estado) {
    setBusyId(cliente.id);
    try {
      await definirEstadoAcesso(cliente.id, estado);
      await refreshAll();
      toast(estado === 'suspenso' ? 'Acesso suspenso.' : 'Acesso reativado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível alterar o acesso.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const totalAtivos = linhas.filter((l) => l.estado === 'ativo').length;
  const totalConvidados = linhas.filter((l) => l.estado === 'convidado').length;

  const columns = [
    {
      key: 'cliente',
      label: 'Cliente',
      render: (row) => (
        <div className="stack stack-1">
          <span className="text-strong">{row.cliente.nome || '(sem nome)'}</span>
          <span className="text-subtle text-xs">{row.cliente.email || 'sem email'}</span>
        </div>
      ),
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (row) => <Badge tone={ESTADO_TONE[row.estado] || 'neutral'}>{ESTADO_LABEL[row.estado] || row.estado}</Badge>,
    },
    {
      key: 'acesso',
      label: 'Último acesso',
      render: (row) => (
        <span className="text-subtle text-xs">
          {row.acesso && row.acesso.ultimoLogin
            ? formatDateTime(row.acesso.ultimoLogin)
            : row.acesso && row.acesso.criadoEm
              ? `convidado a ${formatDate(row.acesso.criadoEm)}`
              : '—'}
        </span>
      ),
    },
    {
      key: 'acoes',
      label: '',
      align: 'right',
      render: (row) => {
        const busy = busyId === row.cliente.id;
        return (
          <div className="row row-2" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {row.estado === 'sem' && (
              <Button
                size="sm"
                variant="primary"
                data-demo-target="portal-convidar"
                data-testid={`convidar-${row.cliente.id}`}
                disabled={busy}
                onClick={() => onConvidar(row.cliente)}
              >
                <IconDoor size={14} /> Convidar
              </Button>
            )}
            {row.estado === 'convidado' && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  data-demo-target="portal-convidar"
                  data-testid={`reenviar-${row.cliente.id}`}
                  disabled={busy}
                  onClick={() => onConvidar(row.cliente)}
                >
                  <IconLink size={14} /> Reenviar convite
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEstado(row.cliente, 'suspenso')}>
                  Suspender
                </Button>
              </>
            )}
            {row.estado === 'ativo' && (
              <Button
                size="sm"
                variant="ghost"
                data-testid={`suspender-${row.cliente.id}`}
                disabled={busy}
                onClick={() => onEstado(row.cliente, 'suspenso')}
              >
                Suspender
              </Button>
            )}
            {row.estado === 'suspenso' && (
              <Button
                size="sm"
                variant="secondary"
                data-testid={`reativar-${row.cliente.id}`}
                disabled={busy}
                onClick={() => onEstado(row.cliente, 'ativo')}
              >
                Reativar
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="stack stack-6" data-demo-page="portal/acessos" data-testid="acessos-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Acessos ao portal</h1>
          <p className="page-subtitle">
            Convide clientes para o portal e faça a gestão do seu acesso. O convite gera um link de uso único para o
            cliente definir a palavra-passe; nada fica visível para o cliente até ser partilhado.
          </p>
        </div>
        <div className="row row-3" style={{ flexShrink: 0 }}>
          <Badge tone="ok">{totalAtivos} ativos</Badge>
          <Badge tone="info">{totalConvidados} convidados</Badge>
        </div>
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="Pesquisar clientes…" data-testid="acessos-search" />

      {loadingClientes ? (
        <Skeleton lines={5} />
      ) : linhas.length === 0 ? (
        <EmptyState
          icon={<IconUsers />}
          title="Sem clientes"
          hint="Os clientes vivem no Núcleo. Registe-os aí para os poder convidar para o portal."
        />
      ) : (
        <DataTable columns={columns} rows={linhas} rowKey={(row) => row.cliente.id} data-testid="acessos-table" />
      )}

      <Modal
        open={!!convite}
        title="Link de definição de palavra-passe"
        onClose={() => setConvite(null)}
        actions={<Button variant="primary" onClick={() => setConvite(null)}>Concluir</Button>}
      >
        {convite && (
          <div className="stack stack-4">
            <p className="text-muted" style={{ margin: 0 }}>
              Envie este link de uso único a <strong>{convite.cliente.nome || convite.cliente.email}</strong>. Ao
              abri-lo, o cliente define a sua palavra-passe e o acesso passa a ativo.
            </p>
            <Field label="Link de convite">
              <div className="row row-2" style={{ alignItems: 'center' }}>
                <Input readOnly value={convite.link} data-testid="convite-link-input" onFocus={(e) => e.target.select()} />
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="convite-link-copiar"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(convite.link);
                      toast('Link copiado.', { tone: 'ok' });
                    } catch {
                      toast('Copie o link manualmente.', { tone: 'info' });
                    }
                  }}
                >
                  Copiar
                </Button>
              </div>
            </Field>
            <a href={convite.link} data-testid="convite-link" className="text-xs text-subtle" style={{ wordBreak: 'break-all' }}>
              {convite.link}
            </a>
          </div>
        )}
      </Modal>
    </div>
  );
}
