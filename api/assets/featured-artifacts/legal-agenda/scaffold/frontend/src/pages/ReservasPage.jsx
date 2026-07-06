import { useMemo, useState } from 'react';
import {
  useSharedCollection, listShared, getShared, createShared, updateShared, formatEur, formatDate,
} from '../shared.js';
import { Badge, Button, Skeleton, EmptyState, DataTable, toast, ConfirmDialog } from '../components/ui.jsx';
import { IconInbox } from '../components/Icons.jsx';
import {
  decidirConfirmacao, construirEventoDeReserva, construirCreditoDeReserva,
} from '../engine/agenda.mjs';
import {
  reservaEstadoLabel, reservaEstadoTone, reservaActiva, horaDe, dataDe,
} from './agenda-logic.js';

/*
 * Caixa de reservas: todas as marcações, com estado e contactos. O advogado pode
 * cancelar uma marcação activa. O botão "Simular confirmação de pagamento" só
 * aparece com ?dev=1 — é uma ajuda de demonstração honesta: a confirmação REAL
 * chega pelo callback do fornecedor de pagamento (o backend onWebhook). A
 * simulação corre a MESMA decisão pura do motor (decidirConfirmacao) e escreve
 * as mesmas linhas, do lado do cliente, para se poder ver o fluxo sem provedor.
 */
function devFlag() {
  try { return new URLSearchParams(window.location.search).get('dev') === '1'; }
  catch { return false; }
}

export default function ReservasPage() {
  const { items: reservas, loading, refresh } = useSharedCollection('reservas');
  const { items: tipos } = useSharedCollection('sessao_tipos');
  const [aCancelar, setACancelar] = useState(null);
  const [busy, setBusy] = useState(null);
  const dev = useMemo(devFlag, []);

  const tipoNome = useMemo(() => {
    const map = new Map();
    (tipos || []).forEach((t) => map.set(t.id, t.nome));
    return (id) => map.get(id) || 'Sessão';
  }, [tipos]);

  const linhas = useMemo(() => {
    const peso = (e) => (reservaActiva(e) ? 0 : 1);
    return [...(reservas || [])].sort((a, b) => (peso(a.estado) - peso(b.estado)) || String(b.inicio).localeCompare(String(a.inicio)));
  }, [reservas]);

  async function cancelar() {
    const r = aCancelar;
    setACancelar(null);
    if (!r) return;
    try {
      await updateShared('reservas', r.id, { estado: 'cancelada', motivoCancelamento: 'cancelada pela equipa' });
      await refresh();
      toast('Reserva cancelada.', { tone: 'ok' });
    } catch { toast('Não foi possível cancelar.', { tone: 'error' }); }
  }

  // Simulação de dev — aplica a MESMA decisão do motor que o backend aplicaria.
  async function simular(r) {
    setBusy(r.id);
    try {
      const todas = await listShared('reservas'); // re-leitura fresca (guarda anti-duplicação)
      const d = decidirConfirmacao({ reservas: todas, orderId: r.id });
      if (d.decisao === 'confirmar') {
        await updateShared('reservas', r.id, { estado: 'confirmada', confirmadaEm: new Date().toISOString() });
        const tipo = r.sessaoTipoId ? await getShared('sessao_tipos', r.sessaoTipoId) : null;
        const evento = await createShared('eventos', construirEventoDeReserva(r, tipo));
        if (evento && evento.id) await updateShared('reservas', r.id, { eventoId: evento.id });
        const credito = construirCreditoDeReserva(r);
        if (credito) await createShared('conta_corrente', credito);
        toast('Pagamento simulado: reserva confirmada.', { tone: 'ok' });
      } else if (d.decisao === 'cancelar_sobreposicao') {
        await updateShared('reservas', r.id, { estado: 'cancelada', motivoCancelamento: d.motivo });
        toast('Horário já ocupado — reserva cancelada.', { tone: 'error' });
      } else {
        toast(`Sem acção: ${d.motivo}`, { tone: 'info' });
      }
      await refresh();
    } catch {
      toast('Falha na simulação.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="reservas-page" data-demo-page="agenda/reservas">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reservas</h1>
          <p className="page-subtitle">
            As marcações feitas pela página pública e pela equipa. A confirmação de pagamento chega pelo callback do fornecedor; as gratuitas confirmam de imediato.
          </p>
        </div>
      </div>

      {dev && (
        <p className="text-xs text-subtle" data-testid="reservas-dev-nota" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
          Modo de demonstração (?dev=1): o botão “Simular confirmação de pagamento” corre a mesma decisão do motor que o callback real corre.
        </p>
      )}

      {loading ? (
        <Skeleton lines={5} />
      ) : linhas.length === 0 ? (
        <EmptyState icon={<IconInbox />} title="Sem reservas" hint="As marcações da página pública aparecem aqui." />
      ) : (
        <div data-testid="agenda-reservas" data-demo-target="agenda-reservas">
          <DataTable
            columns={[
              { key: 'nome', label: 'Cliente', render: (r) => (
                <div className="stack" style={{ gap: 2 }}>
                  <span className="text-strong">{r.nome}</span>
                  <span className="text-xs text-subtle">{r.email}{r.telefone ? ` · ${r.telefone}` : ''}</span>
                </div>
              ) },
              { key: 'tipo', label: 'Tipo', render: (r) => tipoNome(r.sessaoTipoId) },
              { key: 'inicio', label: 'Quando', render: (r) => <span className="numeric">{formatDate(dataDe(r.inicio))} · {horaDe(r.inicio)}</span> },
              { key: 'valor', label: 'Valor', align: 'right', render: (r) => (r.pagamento && r.pagamento.valor != null ? formatEur(r.pagamento.valor) : '—') },
              { key: 'estado', label: 'Estado', render: (r) => <Badge tone={reservaEstadoTone(r.estado)}>{reservaEstadoLabel(r.estado)}</Badge> },
              { key: 'acoes', label: '', align: 'right', render: (r) => (
                <div className="row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', justifyContent: 'flex-end' }}>
                  {dev && r.estado === 'pendente_pagamento' && (
                    <Button variant="secondary" size="sm" data-testid="reserva-simular" disabled={busy === r.id} onClick={() => simular(r)}>
                      {busy === r.id ? '…' : 'Simular confirmação de pagamento'}
                    </Button>
                  )}
                  {reservaActiva(r.estado) && (
                    <Button variant="ghost" size="sm" data-testid="reserva-cancelar" onClick={() => setACancelar(r)}>Cancelar</Button>
                  )}
                </div>
              ) },
            ]}
            rows={linhas}
            rowKey="id"
            data-testid="reservas-tabela"
            empty="Sem reservas."
          />
          {/* Linhas com atributos de teste por reserva (a DataTable não os expõe por linha). */}
          <div hidden aria-hidden="true">
            {linhas.map((r) => <span key={r.id} data-testid="reserva-row" data-reserva-id={r.id} data-estado={r.estado} />)}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={aCancelar != null}
        title="Cancelar reserva"
        message={aCancelar ? `Cancelar a marcação de ${aCancelar.nome}? O horário volta a ficar livre.` : ''}
        confirmLabel="Cancelar reserva"
        danger
        onConfirm={cancelar}
        onCancel={() => setACancelar(null)}
      />
    </div>
  );
}
