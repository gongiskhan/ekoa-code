import { useEffect, useMemo, useRef, useState } from 'react';
import { criarEnvelope } from '../assinatura-cliente.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useSharedCollection,
  getShared,
  listShared,
  createShared,
  updateShared,
  deleteShared,
  notify,
  appHref,
} from '../shared.js';
import {
  Button,
  Field,
  Select,
  Input,
  Badge,
  EmptyState,
} from '../components/ui.jsx';
import { IconClipboardForm, IconDownload, IconExternalLink, IconCheck } from '../components/Icons.jsx';
import { resolveMapeamento, suggestMapeamento, applyLayoutMemory } from '../engine/forms.mjs';
import { fillAndFlatten } from './forms-pdf.js';
import { useDemoResult } from '../demo.js';

// Origens possíveis para cada campo (a espinha partilhada + manual).
const ORIGEM_OPCOES = [
  { value: 'manual', label: 'Manual' },
  { value: 'cliente.nome', label: 'Cliente · Nome' },
  { value: 'cliente.nif', label: 'Cliente · NIF' },
  { value: 'cliente.morada', label: 'Cliente · Morada' },
  { value: 'cliente.email', label: 'Cliente · Email' },
  { value: 'processo.numero', label: 'Processo · Número' },
  { value: 'processo.tribunal', label: 'Processo · Tribunal' },
];

function hojeISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Nome de ficheiro seguro a partir de um rótulo livre. */
function slugFile(s) {
  return String(s || 'formulario')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'formulario';
}

export default function PreencherPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const templateId = params.get('template') || '';
  const reconhecido = params.get('reconhecido') === '1';

  const { items: templatesLista } = useSharedCollection('form_templates');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(!!templateId);
  const [notFound, setNotFound] = useState(false);

  const [clienteId, setClienteId] = useState('');
  const [processoId, setProcessoId] = useState('');
  const [mapaOrigem, setMapaOrigem] = useState({}); // campo -> origem
  const [mapaManual, setMapaManual] = useState({}); // campo -> valorManual

  const [erro, setErro] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [resultado, setResultado] = useState(null); // { url, filename, processoId }
  const exportandoRef = useRef(false);

  // Carrega o modelo escolhido e semeia o mapeamento (guardado, ou sugerido).
  useEffect(() => {
    let alive = true;
    if (!templateId) { setTemplate(null); setLoading(false); setNotFound(false); return undefined; }
    setLoading(true);
    setNotFound(false);
    setResultado(null);
    getShared('form_templates', templateId)
      .then((t) => {
        if (!alive) return;
        if (!t) { setNotFound(true); setLoading(false); return; }
        const campos = Array.isArray(t.camposDetectados) ? t.camposDetectados : [];
        const guardado = new Map((Array.isArray(t.mapeamento) ? t.mapeamento : []).map((m) => [m.campo, m]));
        const sugestoes = new Map(suggestMapeamento(campos.map((c) => c.nome)).map((s) => [s.campo, s.origem]));
        const origem = {};
        const manual = {};
        for (const c of campos) {
          const g = guardado.get(c.nome);
          origem[c.nome] = (g && g.origem) || sugestoes.get(c.nome) || 'manual';
          manual[c.nome] = (g && g.valorManual) || '';
        }
        setTemplate(t);
        setMapaOrigem(origem);
        setMapaManual(manual);
        setLoading(false);
      })
      .catch(() => { if (alive) { setNotFound(true); setLoading(false); } });
    return () => { alive = false; };
  }, [templateId]);

  const cliente = useMemo(() => clientes.find((c) => c.id === clienteId) || null, [clientes, clienteId]);
  const processo = useMemo(() => processos.find((p) => p.id === processoId) || null, [processos, processoId]);
  const processosCliente = useMemo(
    () => (clienteId ? processos.filter((p) => p.clienteId === clienteId) : []),
    [processos, clienteId],
  );

  // Campos com a disposição aprendida aplicada (rectângulos corrigidos), na
  // ordem detectada. A memória não muda o mapeamento; serve o editor de disposição.
  const campos = useMemo(() => {
    if (!template) return [];
    return applyLayoutMemory({
      camposDetectados: Array.isArray(template.camposDetectados) ? template.camposDetectados : [],
      layoutMemoria: Array.isArray(template.layoutMemoria) ? template.layoutMemoria : [],
    });
  }, [template]);

  // Mapeamento corrente (editável) e a sua resolução ao vivo contra a seleção.
  const mapeamentoAtual = useMemo(
    () => campos.map((c) => ({ campo: c.nome, origem: mapaOrigem[c.nome] || 'manual', valorManual: mapaManual[c.nome] || '' })),
    [campos, mapaOrigem, mapaManual],
  );
  const resolvido = useMemo(
    () => resolveMapeamento({ mapeamento: mapeamentoAtual, cliente, processo }),
    [mapeamentoAtual, cliente, processo],
  );
  const valorPorCampo = useMemo(() => {
    const m = new Map();
    for (const r of resolvido) m.set(r.campo, r.valor);
    return m;
  }, [resolvido]);

  // Sinaliza à ponte de demonstrações que o resultado (annotate-result) está visível.
  useDemoResult('forms-resultado', !!resultado);

  function onSelectTemplate(id) {
    setParams(id ? { template: id } : {});
  }

  async function exportar() {
    if (exportandoRef.current) return;
    setErro(null);
    if (!template) { setErro('Escolha um modelo.'); return; }
    if (!cliente) { setErro('Selecione um cliente.'); return; }
    if (processo && processo.clienteId && processo.clienteId !== cliente.id) {
      setErro('O processo não pertence ao cliente selecionado.');
      return;
    }
    const api = typeof window !== 'undefined' ? window.__ekoa : null;
    if (!api || typeof api.uploadFile !== 'function') { setErro('Carregamento de ficheiros indisponível neste contexto.'); return; }

    exportandoRef.current = true;
    setExportando(true);
    let uploaded = null;
    try {
      const bytes = await fillAndFlatten({
        pdfBase64: template.pdfBase64,
        resolved: resolvido,
        camposDetectados: template.camposDetectados,
      });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const filename = `${slugFile(template.nome)}-${slugFile(cliente.nome)}.pdf`;

      uploaded = await api.uploadFile(blob, { name: filename });
      if (!uploaded || !uploaded.id || !uploaded.url) throw new Error('O carregamento não devolveu um ficheiro válido.');

      const appId = typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
      try {
        await createShared('documentos', {
          nome: `${template.nome} - ${cliente.nome}`,
          tipo: 'pdf',
          processoId: processo ? processo.id : undefined,
          clienteId: cliente.id,
          data: hojeISO(),
          origem: 'legal-forms',
          ficheiro: { fileId: uploaded.id, appId, url: uploaded.url, mime: uploaded.type || 'application/pdf', size: uploaded.size || blob.size },
          versao: 1,
        });
      } catch {
        // O ficheiro subiu mas a linha de metadados falhou: apaga o blob órfão
        // (o registo é a fonte de verdade) e falha com um erro fiel.
        if (uploaded && uploaded.id && typeof api.deleteFile === 'function') {
          try { await api.deleteFile(uploaded.id); } catch { /* melhor-esforço */ }
        }
        throw new Error('O formulário foi preenchido mas não foi possível registá-lo no dossiê. Tente novamente.');
      }

      // Guarda o mapeamento (possivelmente editado) de volta no modelo e sobe a
      // versão - a app aprende o mapa deste formulário para a próxima vez.
      try {
        await updateShared('form_templates', template.id, {
          mapeamento: mapeamentoAtual.map((m) => ({ campo: m.campo, origem: m.origem, valorManual: m.origem === 'manual' ? m.valorManual : undefined })),
          versao: (Number(template.versao) || 1) + 1,
        });
      } catch { /* aprendizagem do mapa é acessória - não falha a exportação */ }

      setResultado({ url: uploaded.url, filename, processoId: processo ? processo.id : null });

      // Notificação ACESSÓRIA, fora do caminho crítico.
      Promise.resolve(
        notify({
          tipo: 'documento',
          titulo: 'Formulário preenchido',
          corpo: `${template.nome} - ${cliente.nome}`,
          processoId: processo ? processo.id : undefined,
          href: processo ? appHref('legal-dossie', `processo/${processo.id}`) : appHref('legal-forms', 'historico'),
        }),
      ).catch(() => { /* notificação é acessória */ });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível preencher o formulário.');
    } finally {
      exportandoRef.current = false;
      setExportando(false);
    }
  }

  function novo() {
    setResultado(null);
    setParams(templateId ? { template: templateId } : {});
  }

  return (
    <div data-testid="forms-preencher-page" data-demo-page="forms/preencher">
      <div className="page-header">
        <div>
          <h1 className="page-title">Preencher formulário</h1>
          <p className="page-subtitle">
            Escolha o modelo, o cliente e (opcionalmente) o processo. Os campos preenchem-se a partir da espinha;
            o PDF resultante é guardado no dossiê.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => navigate('/')}>Voltar aos modelos</Button>
        </div>
      </div>

      {reconhecido ? (
        <div className="resultado-ok" data-testid="forms-reconhecido" data-demo-target="forms-reconhecido" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
          Modelo reconhecido - disposição aprendida aplicada.
        </div>
      ) : null}

      <section className="card">
        <div className="form-grid">
          <Field label="Modelo">
            <Select value={templateId} onChange={(e) => onSelectTemplate(e.target.value)} data-testid="forms-template">
              <option value="">{templatesLista.length === 0 ? 'Sem modelos - carregue um PDF nos Modelos.' : 'Selecione o modelo.'}</option>
              {templatesLista.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </Field>
          <Field label="Cliente" required>
            <Select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setProcessoId(''); setErro(null); }} data-testid="forms-cliente" data-demo-target="forms-cliente">
              <option value="">{clientes.length === 0 ? 'Sem clientes - registe no Núcleo.' : 'Selecione o cliente.'}</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </Field>
          <Field label="Processo (opcional)">
            <Select value={processoId} onChange={(e) => { setProcessoId(e.target.value); setErro(null); }} data-testid="forms-processo" disabled={!clienteId}>
              <option value="">
                {!clienteId
                  ? 'Selecione primeiro o cliente.'
                  : processosCliente.length === 0
                    ? 'Sem processos deste cliente.'
                    : 'Sem processo associado.'}
              </option>
              {processosCliente.map((p) => <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>)}
            </Select>
          </Field>
        </div>
      </section>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelo.</span></div>
      ) : notFound ? (
        <EmptyState
          icon={<IconClipboardForm />}
          title="Modelo não encontrado"
          hint="O modelo pode ter sido eliminado. Volte aos modelos."
          action={<Button onClick={() => navigate('/')}>Voltar aos modelos</Button>}
        />
      ) : !template ? (
        <EmptyState
          icon={<IconClipboardForm />}
          title="Escolha um modelo"
          hint="Selecione um modelo acima, ou carregue um PDF na página de Modelos."
          action={<Button onClick={() => navigate('/')}>Ir aos modelos</Button>}
        />
      ) : resultado ? (
        <section className="card" data-testid="forms-resultado" data-demo-target="forms-resultado">
          <h2 className="card-title">Formulário preenchido</h2>
          <p className="card-subtitle" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
            O PDF foi preenchido, achatado e guardado no dossiê.
          </p>
          <div className="resultado-ok" style={{ marginTop: 0 }}><IconCheck /> Documento gerado e guardado com sucesso.</div>
          <div className="row row-wrap" style={{ marginTop: 'var(--space-4, 1rem)', gap: 'var(--space-2, 0.5rem)' }}>
            <a className="btn btn-primary" href={`${resultado.url}?download=1`} download={resultado.filename} data-testid="forms-download">
              <IconDownload /> Descarregar PDF
            </a>
            {resultado.processoId ? (
              <a className="btn btn-secondary" href={appHref('legal-dossie', `processo/${resultado.processoId}`)} data-testid="forms-abrir-dossie">
                <IconExternalLink /> Abrir no Dossiê
              </a>
            ) : null}
            <a className="btn btn-secondary" href={appHref('legal-forms', 'historico')} data-testid="forms-abrir-historico">
              <IconExternalLink /> Ver histórico
            </a>
            <Button
              variant="secondary"
              data-testid="forms-enviar-assinatura"
              onClick={async () => {
                try {
                  const env = await criarEnvelope({
                    titulo: `${resultado.filename} - assinatura`,
                    ficheiro: { nome: resultado.filename, url: resultado.url },
                    signatarios: [{ nome: 'Mandatário responsável', papel: 'advogado', metodo: 'cmd-orquestrado' }],
                    processoId: resultado.processoId || undefined,
                  });
                  window.location.assign(env.href);
                } catch {
                  setErro('Não foi possível criar o envelope de assinatura.');
                }
              }}
            >
              Enviar para assinatura
            </Button>
            <Button variant="ghost" data-testid="forms-novo" onClick={novo}>Preencher outro</Button>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="row-space-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <h2 className="card-title">Campos do formulário</h2>
              <p className="card-subtitle">
                Cada campo detetado no PDF mapeia-se a um valor. Ajuste as origens; a pré-visualização mostra o valor final.
              </p>
            </div>
            <Badge tone={template.tipoPdf === 'acroform' ? 'ok' : 'neutral'}>
              {template.tipoPdf === 'acroform' ? 'AcroForm' : 'Digitalizado'} · {campos.length} {campos.length === 1 ? 'campo' : 'campos'}
            </Badge>
          </div>

          {campos.length === 0 ? (
            <p className="field-hint" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              Este PDF não tem campos preenchíveis. Abra o editor de disposição para colocar campos manualmente.
            </p>
          ) : (
            <div className="table-wrap" data-testid="forms-mapeamento" data-demo-target="forms-mapeamento" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>Campo</th>
                    <th style={{ width: '30%' }}>Origem</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {campos.map((c) => {
                    const origem = mapaOrigem[c.nome] || 'manual';
                    const valor = valorPorCampo.get(c.nome) || '';
                    return (
                      <tr key={c.nome} data-testid={`forms-linha-${c.nome}`}>
                        <td>
                          <span className="text-small" style={{ fontWeight: 600 }}>{c.nome}</span>
                          <span className="text-small text-subtle" style={{ display: 'block' }}>{c.tipo}{c.memoria ? ' · disposição aprendida' : ''}</span>
                        </td>
                        <td>
                          <Select
                            value={origem}
                            onChange={(e) => setMapaOrigem((prev) => ({ ...prev, [c.nome]: e.target.value }))}
                            data-testid={`forms-origem-${c.nome}`}
                          >
                            {ORIGEM_OPCOES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </Select>
                        </td>
                        <td>
                          {origem === 'manual' ? (
                            <Input
                              value={mapaManual[c.nome] || ''}
                              onChange={(e) => setMapaManual((prev) => ({ ...prev, [c.nome]: e.target.value }))}
                              placeholder="Preencher…"
                              data-testid={`forms-manual-${c.nome}`}
                            />
                          ) : (
                            <span className="text-small" data-testid={`forms-valor-${c.nome}`}>{valor || <span className="text-subtle">—</span>}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {erro ? <p className="resultado-erro" data-testid="forms-erro">{erro}</p> : null}

          <div className="row row-wrap" style={{ marginTop: 'var(--space-4, 1rem)', gap: 'var(--space-2, 0.5rem)' }}>
            <Button
              data-testid="forms-preencher-exportar"
              data-demo-target="forms-preencher"
              onClick={exportar}
              disabled={exportando || !clienteId}
            >
              <IconDownload /> {exportando ? 'A preencher…' : 'Preencher e exportar'}
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/editar/${encodeURIComponent(template.id)}`)}>Editar disposição</Button>
          </div>
        </section>
      )}
    </div>
  );
}
