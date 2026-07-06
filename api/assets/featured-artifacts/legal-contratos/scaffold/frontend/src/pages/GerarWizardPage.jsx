import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Packer } from 'docx';
import {
  useSharedCollection,
  getShared,
  createShared,
  notify,
  appHref,
} from '../shared.js';
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  EmptyState,
  Badge,
} from '../components/ui.jsx';
import { IconFileText, IconDownload, IconExternalLink } from '../components/Icons.jsx';
import {
  isSpineOrigem,
  resolveOrigem,
  origemLabel,
  substitute,
  extractPlaceholders,
  slugFile,
  hojeISO,
} from './modelo-util.js';
import { buildModeloDocx } from './modelo-docx.js';

const PASSOS = ['Cliente e processo', 'Variáveis', 'Pré-visualização'];

export default function GerarWizardPage() {
  const { modeloId } = useParams();
  const navigate = useNavigate();

  const [modelo, setModelo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const {
    items: clientes,
    loading: clientesLoading,
    error: clientesErro,
    refresh: refreshClientes,
  } = useSharedCollection('clientes');
  const { items: processos, refresh: refreshProcessos } = useSharedCollection('processos');

  // Um cliente registado no Núcleo noutro separador tem de aparecer aqui sem
  // recarregar a página: ao voltar o foco à janela, relê clientes e processos.
  useEffect(() => {
    const onFocus = () => { refreshClientes(); refreshProcessos(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshClientes, refreshProcessos]);

  const [passo, setPasso] = useState(1);
  const [clienteId, setClienteId] = useState('');
  const [processoId, setProcessoId] = useState('');
  const [valores, setValores] = useState({}); // chave -> string
  const [editar, setEditar] = useState({}); // chave -> bool (destravar variável da espinha)
  const [erro, setErro] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState(null); // { url, filename, processoId }

  // Última seleção cliente|processo já resolvida para a espinha - permite não
  // pisar variáveis que o utilizador destravou/editou ao voltar e avançar.
  const lastResolvedRef = useRef('');

  // Trava síncrona contra reentrância: um duplo-clique em "Gerar documento"
  // dispara dois handlers antes de setGerando(true) pintar e desativar o botão.
  const gerandoRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    getShared('modelos', modeloId)
      .then((m) => {
        if (!alive) return;
        if (!m) { setNotFound(true); setLoading(false); return; }
        setModelo(m);
        setLoading(false);
      })
      .catch(() => { if (alive) { setNotFound(true); setLoading(false); } });
    return () => { alive = false; };
  }, [modeloId]);

  const variaveis = useMemo(() => (modelo && Array.isArray(modelo.variaveis) ? modelo.variaveis : []), [modelo]);

  const cliente = useMemo(() => clientes.find((c) => c.id === clienteId) || null, [clientes, clienteId]);
  const processo = useMemo(() => processos.find((p) => p.id === processoId) || null, [processos, processoId]);

  const processosCliente = useMemo(
    () => (clienteId ? processos.filter((p) => p.clienteId === clienteId) : []),
    [processos, clienteId],
  );

  function onSelectCliente(id) {
    setClienteId(id);
    setProcessoId('');
    setErro(null);
  }

  // Ao entrar no passo 2, pré-preenche as variáveis da espinha a partir da
  // seleção; mantém o que o utilizador já tenha escrito nas manuais.
  function avancarParaVariaveis() {
    if (!cliente) { setErro('Selecione um cliente.'); return; }
    if (!processo) { setErro('Selecione um processo deste cliente.'); return; }
    if (processo.clienteId !== cliente.id) { setErro('O processo não pertence ao cliente selecionado.'); return; }
    const selKey = `${cliente.id}|${processo.id}`;
    const selChanged = lastResolvedRef.current !== selKey;
    const next = { ...valores };
    for (const v of variaveis) {
      if (isSpineOrigem(v.origem)) {
        // Re-preenche da espinha quando a seleção muda; caso contrário preserva
        // o que o utilizador destravou e editou (não pisar edições ao voltar).
        if (selChanged || !editar[v.chave]) {
          next[v.chave] = resolveOrigem(v.origem, cliente, processo);
        }
      } else if (!(v.chave in next)) {
        next[v.chave] = '';
      }
    }
    if (selChanged) setEditar({}); // nova seleção -> variáveis da espinha voltam a ficar fixas
    lastResolvedRef.current = selKey;
    setValores(next);
    setErro(null);
    setPasso(2);
  }

  function validarObrigatorias() {
    const emFalta = variaveis
      .filter((v) => v.obrigatoria && !String(valores[v.chave] || '').trim())
      .map((v) => v.rotulo || v.chave);
    return emFalta;
  }

  function avancarParaPreview() {
    const emFalta = validarObrigatorias();
    if (emFalta.length > 0) {
      setErro(`Preencha as variáveis obrigatórias: ${emFalta.join(', ')}.`);
      return;
    }
    setErro(null);
    setPasso(3);
  }

  const corpoSubstituido = useMemo(
    () => (modelo ? substitute(modelo.corpo, valores) : ''),
    [modelo, valores],
  );

  // {{chaves}} que sobrariam textuais no documento - placeholders no corpo sem
  // variável definida no modelo. Bloqueiam a geração (o modelo tem de ser
  // corrigido no editor); as variáveis definidas ficam sempre mapeadas.
  const placeholdersEmFalta = useMemo(() => extractPlaceholders(corpoSubstituido), [corpoSubstituido]);

  async function gerarDocumento() {
    if (gerandoRef.current) return; // reentrância: já há uma geração a decorrer
    setErro(null);
    if (!cliente || !processo) { setErro('Cliente ou processo em falta.'); return; }
    if (processo.clienteId !== cliente.id) { setErro('O processo não pertence ao cliente selecionado.'); return; }
    if (placeholdersEmFalta.length > 0) {
      setErro(`Há variáveis no corpo sem valor mapeado: ${placeholdersEmFalta.map((p) => `{{${p}}}`).join(', ')}. Edite o modelo para as definir.`);
      return;
    }
    const api = typeof window !== 'undefined' ? window.__ekoa : null;
    if (!api || typeof api.uploadFile !== 'function') { setErro('Carregamento de ficheiros indisponível neste contexto.'); return; }

    gerandoRef.current = true;
    setGerando(true);
    let uploaded = null;
    try {
      const hoje = hojeISO();
      const doc = buildModeloDocx({ corpo: corpoSubstituido });
      const blob = await Packer.toBlob(doc);
      const filename = `${slugFile(modelo.nome)}-${slugFile(cliente.nome)}.docx`;

      uploaded = await api.uploadFile(blob, { name: filename });
      if (!uploaded || !uploaded.id || !uploaded.url) throw new Error('O carregamento não devolveu um ficheiro válido.');

      const appId = typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
      try {
        await createShared('documentos', {
          nome: `${modelo.nome} - ${cliente.nome}`,
          tipo: 'docx',
          processoId: processo.id,
          clienteId: cliente.id,
          data: hoje,
          origem: 'contratos',
          ficheiro: { fileId: uploaded.id, appId, url: uploaded.url, mime: uploaded.type || 'application/octet-stream', size: uploaded.size || blob.size },
          versao: 1,
        });
      } catch {
        // O ficheiro subiu mas a linha de metadados falhou: apaga o blob órfão
        // (o registo é a fonte de verdade; um ficheiro sem linha é lixo) e falha
        // com um erro fiel - a geração NÃO é apresentada como concluída.
        if (uploaded && uploaded.id && typeof api.deleteFile === 'function') {
          try { await api.deleteFile(uploaded.id); } catch { /* melhor-esforço */ }
        }
        throw new Error('O documento foi criado mas não foi possível registá-lo no dossiê. Tente novamente.');
      }

      // A geração está persistida: apresenta já o sucesso. A notificação é
      // ACESSÓRIA e corre FORA do caminho crítico - uma falha a notificar nunca
      // deve apresentar uma geração já persistida como falhada (o reenvio
      // duplicaria o ficheiro e a linha).
      setResultado({ url: uploaded.url, filename, processoId: processo.id });
      Promise.resolve(
        notify({
          tipo: 'documento',
          titulo: 'Contrato gerado',
          corpo: `${modelo.nome} - ${cliente.nome}`,
          processoId: processo.id,
          href: appHref('legal-dossie', `processo/${processo.id}`),
        }),
      ).catch(() => { /* notificação é acessória */ });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível gerar o documento.');
    } finally {
      gerandoRef.current = false;
      setGerando(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setPasso(1);
    setValores({});
    setEditar({});
    setErro(null);
  }

  if (loading) {
    return (
      <div data-testid="gerar-page" data-demo-target="contratos-wizard">
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelo.</span></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div data-testid="gerar-page" data-demo-target="contratos-wizard">
        <EmptyState
          icon={<IconFileText />}
          title="Modelo não encontrado"
          hint="O modelo pode ter sido eliminado. Volte à galeria."
          action={<Button onClick={() => navigate('/')}>Voltar aos modelos</Button>}
        />
      </div>
    );
  }

  return (
    <div data-testid="gerar-page" data-demo-target="contratos-wizard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gerar: {modelo.nome || '(sem nome)'}</h1>
          <p className="page-subtitle">
            Preenche o modelo a partir do cliente e do processo, e guarda o .docx no dossiê do processo.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => navigate('/')}>Voltar aos modelos</Button>
        </div>
      </div>

      {/* Indicador de passos */}
      <div className="chip-row" style={{ marginBottom: 'var(--space-6, 1.5rem)' }}>
        {PASSOS.map((label, i) => (
          <span key={label} className={`chip${passo === i + 1 ? ' is-active' : ''}`} data-testid={`gerar-passo-${i + 1}`}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {resultado ? (
        <section className="card" data-testid="gerar-sucesso">
          <h2 className="card-title">Contrato gerado</h2>
          <p className="card-subtitle" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
            O documento foi guardado no processo e registado no dossiê.
          </p>
          <div className="resultado-ok" style={{ marginTop: 0 }}>Documento gerado e guardado com sucesso.</div>
          <div className="row row-wrap" style={{ marginTop: 'var(--space-4, 1rem)', gap: 'var(--space-2, 0.5rem)' }}>
            <a
              className="btn btn-primary"
              href={`${resultado.url}?download=1`}
              download={resultado.filename}
              data-testid="gerar-download"
            >
              <IconDownload /> Descarregar .docx
            </a>
            <a
              className="btn btn-secondary"
              href={appHref('legal-dossie', `processo/${resultado.processoId}`)}
              data-testid="gerar-abrir-dossie"
            >
              <IconExternalLink /> Abrir no Dossiê
            </a>
            <Button variant="ghost" data-testid="gerar-outro" onClick={reiniciar}>Gerar outro</Button>
          </div>
        </section>
      ) : passo === 1 ? (
        <section className="card" data-testid="gerar-passo1">
          <h2 className="card-title">Cliente e processo</h2>
          <p className="card-subtitle">Escolha o cliente e o processo a que o contrato diz respeito.</p>
          <div className="form-grid" style={{ marginTop: 'var(--space-4, 1rem)' }}>
            <Field label="Cliente" required>
              <Select value={clienteId} onChange={(e) => onSelectCliente(e.target.value)} data-testid="gerar-cliente">
                <option value="">
                  {clientesLoading
                    ? 'A carregar clientes…'
                    : clientes.length === 0
                      ? 'Sem clientes - registe no Núcleo.'
                      : 'Selecione o cliente.'}
                </option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </Field>
            <Field label="Processo" required>
              <Select value={processoId} onChange={(e) => { setProcessoId(e.target.value); setErro(null); }} data-testid="gerar-processo" disabled={!clienteId}>
                <option value="">
                  {!clienteId
                    ? 'Selecione primeiro o cliente.'
                    : processosCliente.length === 0
                      ? 'Sem processos - abra um no Núcleo.'
                      : 'Selecione o processo.'}
                </option>
                {processosCliente.map((p) => <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>)}
              </Select>
            </Field>
          </div>
          {clientesErro ? (
            <p className="resultado-erro" data-testid="gerar-clientes-erro">
              Não foi possível carregar os clientes.{' '}
              <Button variant="ghost" data-testid="gerar-clientes-repetir" onClick={() => { refreshClientes(); refreshProcessos(); }}>
                Tentar novamente
              </Button>
            </p>
          ) : null}
          {erro ? <p className="resultado-erro" data-testid="gerar-erro">{erro}</p> : null}
          <div className="row" style={{ marginTop: 'var(--space-4, 1rem)' }}>
            <Button data-testid="gerar-continuar" onClick={avancarParaVariaveis} disabled={!clienteId || !processoId}>
              Continuar
            </Button>
          </div>
        </section>
      ) : passo === 2 ? (
        <section className="card" data-testid="gerar-passo2">
          <h2 className="card-title">Variáveis</h2>
          <p className="card-subtitle">
            As variáveis da espinha vêm pré-preenchidas do cliente/processo. Destrave para editar. As manuais preenche-as aqui.
          </p>
          {variaveis.length === 0 ? (
            <p className="field-hint" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              Este modelo não tem variáveis. Pode avançar para a pré-visualização.
            </p>
          ) : (
            <div className="stack stack-3" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              {variaveis.map((v, i) => {
                const spine = isSpineOrigem(v.origem);
                const destravada = !!editar[v.chave];
                const readOnly = spine && !destravada;
                return (
                  <Field
                    key={v.chave || `var-${i}`}
                    label={
                      <>
                        {v.rotulo || v.chave} {v.obrigatoria ? <span className="field-required" aria-hidden="true">*</span> : null}
                      </>
                    }
                    hint={<span className="text-xs text-subtle">Origem: {origemLabel(v.origem)}</span>}
                  >
                    {spine ? (
                      // Origem da espinha: override curto de uma linha, com destravar/fixar.
                      <div className="row" style={{ gap: 'var(--space-2, 0.5rem)', alignItems: 'stretch' }}>
                        <Input
                          value={valores[v.chave] || ''}
                          onChange={(e) => setValores((prev) => ({ ...prev, [v.chave]: e.target.value }))}
                          data-testid={`gerar-var-${v.chave}`}
                          readOnly={readOnly}
                          placeholder=""
                          style={readOnly ? { background: 'var(--color-surface-muted, #F1F5F9)', flex: 1 } : { flex: 1 }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`gerar-editar-${v.chave}`}
                          onClick={() => setEditar((prev) => ({ ...prev, [v.chave]: !prev[v.chave] }))}
                        >
                          {destravada ? 'Fixar' : 'Editar'}
                        </Button>
                      </div>
                    ) : (
                      // Manual: cláusula livre - textarea multilinha; os \n são preservados
                      // na pré-visualização e no .docx (ambos partem o corpo por linha).
                      <Textarea
                        value={valores[v.chave] || ''}
                        onChange={(e) => setValores((prev) => ({ ...prev, [v.chave]: e.target.value }))}
                        data-testid={`gerar-var-${v.chave}`}
                        placeholder="Preencher…"
                        rows={3}
                        style={{ width: '100%' }}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          )}
          {erro ? <p className="resultado-erro" data-testid="gerar-erro">{erro}</p> : null}
          <div className="row row-wrap" style={{ marginTop: 'var(--space-4, 1rem)', gap: 'var(--space-2, 0.5rem)' }}>
            <Button variant="ghost" onClick={() => { setErro(null); setPasso(1); }}>Anterior</Button>
            <Button data-testid="gerar-continuar" onClick={avancarParaPreview}>Continuar</Button>
          </div>
        </section>
      ) : (
        <section className="card" data-testid="gerar-passo3">
          <div className="row-space-between">
            <div>
              <h2 className="card-title">Pré-visualização</h2>
              <p className="card-subtitle">Confirme o documento antes de o gerar. As chavetas foram substituídas.</p>
            </div>
            <Badge tone="info">{cliente ? cliente.nome : ''}</Badge>
          </div>

          <div
            className="clausulas-list"
            data-testid="gerar-preview"
            style={{ marginTop: 'var(--space-4, 1rem)', padding: 'var(--space-4, 1rem)', display: 'block' }}
          >
            {corpoSubstituido.split('\n').map((line, i) => (
              line.trim()
                ? <p key={i} style={{ margin: '0 0 0.5rem' }}>{line}</p>
                : <div key={i} style={{ height: '0.5rem' }} />
            ))}
          </div>

          {placeholdersEmFalta.length > 0 ? (
            <div className="resultado-erro" data-testid="gerar-placeholders-erro" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              Há variáveis no corpo sem valor mapeado: {placeholdersEmFalta.map((p) => `{{${p}}}`).join(', ')}. Edite o modelo para as definir antes de gerar.
            </div>
          ) : null}

          {erro ? <p className="resultado-erro" data-testid="gerar-erro">{erro}</p> : null}

          <div className="row row-wrap" style={{ marginTop: 'var(--space-4, 1rem)', gap: 'var(--space-2, 0.5rem)' }}>
            <Button variant="ghost" onClick={() => { setErro(null); setPasso(2); }}>Anterior</Button>
            <Button data-testid="gerar-confirmar" onClick={gerarDocumento} disabled={gerando || placeholdersEmFalta.length > 0}>
              <IconDownload /> {gerando ? 'A gerar…' : 'Gerar documento'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
