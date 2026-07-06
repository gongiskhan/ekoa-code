import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  createShared,
  formatEur,
  formatDate,
} from '../shared.js';
import {
  Button,
  Field,
  Select,
  DataTable,
  Badge,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconFileText, IconAlertTriangle, IconFolder, IconFilePdf } from '../components/Icons.jsx';
import {
  hojeISO,
  REGRA_EMISSAO,
  EMISSAO_BLOQUEADA,
  PEDIDO_ESTADO_LABEL,
  PEDIDO_ESTADO_TONE,
} from './financas-logic.js';

/*
 * Faturação. REGRA REGULATÓRIA §3.2.1: a Ekoa NÃO emite faturas nativamente.
 *
 * Esta página lista as pré-faturas de honorários (documentos origem 'honorarios',
 * geradas pelo módulo Honorários) e deixa PREPARAR um pedido de emissão
 * certificada - uma linha de intenção em `faturacao_pedidos`. Nunca gera um
 * número de fatura, código de validação, código de barras bidimensional nem
 * qualquer artefacto fiscal localmente.
 *
 * A emissão certificada em si passa EXCLUSIVAMENTE pela integração InvoiceXpress
 * (Autoridade Tributária). Nesta máquina a integração não tem credenciais
 * configuradas e um artefacto servido não tem caminho para a executar
 * directamente, pelo que o botão "Emitir fatura certificada" está DESATIVADO com
 * a explicação. Quando a integração estiver ligada, o pedido é levantado pelo
 * backend (onMessage / 'emitirFatura'), que chama a InvoiceXpress.
 */
export default function FaturacaoPage() {
  const { items: documentos, loading: docsLoading } = useSharedCollection('documentos');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: pedidos, loading: pedidosLoading, refresh: refreshPedidos } = useSharedCollection('faturacao_pedidos');

  const [selDoc, setSelDoc] = useState('');
  const [busy, setBusy] = useState(false);

  const processoById = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p));
    return map;
  }, [processos]);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => (id ? map.get(id) || '' : '');
  }, [clientes]);

  // Pré-faturas de honorários = documentos origem 'honorarios' (fonte: módulo
  // Honorários). São a base de um pedido de emissão certificada.
  const preFaturas = useMemo(
    () => documentos
      .filter((d) => d.origem === 'honorarios')
      .slice()
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))),
    [documentos],
  );

  // Ids de pré-fatura que já têm um pedido, para não duplicar.
  const pedidoPorDoc = useMemo(() => {
    const set = new Set();
    pedidos.forEach((p) => { if (p.documentoId) set.add(p.documentoId); });
    return set;
  }, [pedidos]);

  const pedidosOrdenados = useMemo(
    () => pedidos.slice().sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))),
    [pedidos],
  );

  const selDocObj = preFaturas.find((d) => d.id === selDoc) || null;

  /*
   * Preparar pedido de emissão certificada. Escreve APENAS uma linha de intenção
   * em `faturacao_pedidos` (estado 'emissao_pendente') - NUNCA um número de
   * fatura nem metadados fiscais. A emissão certificada só ocorre na
   * InvoiceXpress; este pedido é a fila de espera até a integração estar ligada.
   */
  async function onPrepararPedido() {
    if (!selDocObj || busy) return;
    if (pedidoPorDoc.has(selDocObj.id)) {
      toast('Esta pré-fatura já tem um pedido de emissão.', { tone: 'info' });
      return;
    }
    setBusy(true);
    try {
      const proc = selDocObj.processoId ? processoById.get(selDocObj.processoId) : null;
      const clienteId = selDocObj.clienteId || (proc ? proc.clienteId : null) || null;
      await createShared('faturacao_pedidos', {
        documentoId: selDocObj.id,
        processoId: selDocObj.processoId || null,
        clienteId,
        referencia: selDocObj.nome || 'Pré-fatura de honorários',
        estado: 'emissao_pendente',
        data: hojeISO(),
        // Explicitamente SEM número, SEM código de validação, SEM QR: a emissão
        // certificada é da InvoiceXpress, não deste artefacto.
      });
      await refreshPedidos();
      setSelDoc('');
      toast('Pedido de emissão certificada preparado. Fica na fila para a InvoiceXpress.', { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível preparar o pedido.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="faturacao-page" data-demo-page="financas/faturacao">
      <div className="page-header">
        <div>
          <h1 className="page-title">Faturação</h1>
          <p className="page-subtitle">
            Prepare a emissão certificada a partir das pré-faturas de honorários. A emissão em si é
            feita pela Autoridade Tributária através da integração InvoiceXpress.
          </p>
        </div>
      </div>

      {/* Nota regulatória - sempre visível no topo. */}
      <div className="citius-resultado is-review" data-testid="fat-regra" role="note">
        <span className="citius-resultado-icon" aria-hidden="true"><IconAlertTriangle /></span>
        <span className="citius-resultado-text">
          <span className="citius-resultado-strong">Emissão certificada exclusivamente via InvoiceXpress</span>
          <span className="citius-resultado-meta">{REGRA_EMISSAO}</span>
        </span>
      </div>

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        {/* ---------- (A) PREPARAR PEDIDO A PARTIR DE PRÉ-FATURA ---------- */}
        <section className="card" aria-label="Preparar emissão">
          <h2 className="card-title">Pré-faturas de honorários</h2>
          <p className="card-subtitle">
            Geradas pelo módulo Honorários. Escolha uma para preparar o pedido de emissão certificada.
          </p>

          <div className="form" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <Field label="Pré-fatura">
              <Select data-testid="fat-prefatura-select" value={selDoc} onChange={(e) => setSelDoc(e.target.value)}>
                <option value="">{preFaturas.length === 0 ? 'Sem pré-faturas - emita uma no módulo Honorários.' : 'Seleccione a pré-fatura.'}</option>
                {preFaturas.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome || 'Pré-fatura'}{d.data ? ` · ${formatDate(d.data)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="row row-2">
              <Button
                data-testid="financas-pedido-emissao"
                data-demo-target="financas-pedido-emissao"
                onClick={onPrepararPedido}
                disabled={!selDocObj || busy || (selDocObj && pedidoPorDoc.has(selDocObj.id))}
              >
                <IconFileText /> Preparar pedido de emissão
              </Button>
            </div>
            {selDocObj && pedidoPorDoc.has(selDocObj.id) ? (
              <p className="field-hint" data-testid="fat-ja-pedido">Esta pré-fatura já tem um pedido de emissão preparado.</p>
            ) : null}
          </div>
        </section>

        {/* ---------- (B) EMISSÃO CERTIFICADA (BLOQUEADA) ---------- */}
        <section className="card" aria-label="Emissão certificada">
          <h2 className="card-title">Emissão certificada</h2>
          <p className="card-subtitle">A fatura certificada e os seus elementos fiscais são gerados pela InvoiceXpress, junto da Autoridade Tributária - nunca por esta aplicação.</p>

          <div className="citius-resultado is-erro" data-testid="fat-bloqueio" role="note" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <span className="citius-resultado-icon" aria-hidden="true"><IconAlertTriangle /></span>
            <span className="citius-resultado-text">
              <span className="citius-resultado-strong">Integração InvoiceXpress não configurada</span>
              <span className="citius-resultado-meta" data-testid="fat-bloqueio-copy">{EMISSAO_BLOQUEADA}</span>
            </span>
          </div>

          <div className="row row-2" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <Button
              data-testid="financas-emitir-bloqueado"
              data-demo-target="financas-emitir-bloqueado"
              disabled
              title={EMISSAO_BLOQUEADA}
              aria-disabled="true"
            >
              <IconFilePdf /> Emitir fatura certificada
            </Button>
          </div>
          <p className="field-hint">
            Quando a integração estiver ligada, o pedido preparado é levantado e emitido na
            InvoiceXpress - a Ekoa nunca gera o artefacto fiscal.
          </p>
        </section>
      </div>

      {/* ---------- (C) PEDIDOS DE EMISSÃO ---------- */}
      <section className="card" aria-label="Pedidos de emissão" style={{ marginTop: 'var(--sp-7, 2rem)' }}>
        <h2 className="card-title">Pedidos de emissão</h2>
        <p className="card-subtitle">A fila de pré-faturas a aguardar emissão certificada na InvoiceXpress.</p>
        {docsLoading || pedidosLoading ? (
          <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar.</span></div>
        ) : pedidosOrdenados.length === 0 ? (
          <EmptyState icon={<IconFolder />} title="Sem pedidos" hint="Prepare um pedido a partir de uma pré-fatura de honorários." />
        ) : (
          <DataTable
            data-testid="fat-pedidos"
            columns={[
              { key: 'referencia', label: 'Pré-fatura', render: (p) => (
                <div className="stack stack-1">
                  <span className="text-strong">{p.referencia || 'Pré-fatura'}</span>
                  <span className="text-subtle text-xs">{p.data ? formatDate(p.data) : ''}</span>
                </div>
              ) },
              { key: 'processo', label: 'Processo / Cliente', render: (p) => (
                <div className="stack stack-1">
                  <span>{processoById.get(p.processoId)?.numeroProcesso || '—'}</span>
                  <span className="text-subtle text-xs">{clienteNome(p.clienteId)}</span>
                </div>
              ) },
              { key: 'estado', label: 'Estado', render: (p) => (
                <Badge tone={PEDIDO_ESTADO_TONE[p.estado] || 'neutral'} data-testid={`fat-pedido-estado-${p.id}`}>
                  {PEDIDO_ESTADO_LABEL[p.estado] || p.estado || '—'}
                </Badge>
              ) },
            ]}
            rows={pedidosOrdenados}
            rowKey="id"
          />
        )}
      </section>
    </div>
  );
}
