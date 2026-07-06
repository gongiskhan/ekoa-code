import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, createShared, getShared, registarEvento } from '../shared.js';
import { Button, Badge, Field, Input, Select, EmptyState } from '../components/ui.jsx';
import { IconPlus, IconTrash, IconUpload, IconSignature } from '../components/Icons.jsx';
import { criarEnvelope } from '../engine/assinatura.mjs';
import { metodosSelecionaveis, METODO_PADRAO, providerDe, TIPO_LABEL } from '../providers.js';
import { sha256Hex } from '../model.js';

const PAPEIS = ['cliente', 'advogado', 'mandatário', 'contraparte', 'testemunha', 'outro'];

/* Texto-base de uma procuração forense fictícia (exemplo de demonstração). */
const PROC_TEXTO = [
  'PROCURAÇÃO FORENSE',
  '',
  'Marília Costa, contribuinte n.º 210 000 017, constitui sua bastante procuradora a advogada signatária,',
  'a quem confere os poderes forenses gerais em direito permitidos, para a representar em juízo e fora dele,',
  'incluindo os poderes especiais para confessar, desistir e transigir.',
  '',
  'Exemplo de demonstração - Fonseca & Associados.',
].join('\n');

function novoSignatario(metodo) {
  return { nome: '', email: '', papel: 'cliente', metodo };
}

export default function NovoEnvelopePage() {
  const navigate = useNavigate();
  const { items: documentos } = useSharedCollection('documentos');
  const { items: processos } = useSharedCollection('processos');
  const fileRef = useRef(null);
  const criandoRef = useRef(false);

  const [titulo, setTitulo] = useState('');
  const [metodoPadrao, setMetodoPadrao] = useState(METODO_PADRAO);
  const [processoId, setProcessoId] = useState('');
  // documento: null | { nome, fonte:'exemplo'|'spine'|'upload', texto?, docId?, ficheiro?, file? }
  const [documento, setDocumento] = useState(null);
  const [signatarios, setSignatarios] = useState([novoSignatario(METODO_PADRAO)]);
  const [erro, setErro] = useState(null);
  const [aCriar, setACriar] = useState(false);

  const metodos = useMemo(() => metodosSelecionaveis(), []);
  const docsComNome = useMemo(() => (Array.isArray(documentos) ? documentos.filter((d) => d && d.nome) : []), [documentos]);

  function usarExemplo() {
    setTitulo('Procuração forense - exemplo');
    setMetodoPadrao('simulado');
    setDocumento({ nome: 'Procuração forense (exemplo)', fonte: 'exemplo', texto: PROC_TEXTO });
    setSignatarios([
      { nome: 'Marília Costa', email: 'marilia.costa@exemplo.pt', papel: 'cliente', metodo: 'simulado' },
      { nome: 'Dra. Marília', email: 'marilia@escritorio.pt', papel: 'advogado', metodo: 'simulado' },
    ]);
    setErro(null);
  }

  function onEscolherSpine(docId) {
    if (!docId) { setDocumento(null); return; }
    const row = docsComNome.find((d) => d.id === docId);
    if (!row) return;
    setDocumento({ nome: row.nome, fonte: 'spine', docId: row.id, ficheiro: row.ficheiro || null });
    if (!titulo.trim()) setTitulo(row.nome);
    if (row.processoId) setProcessoId(row.processoId);
    setErro(null);
  }

  async function onFile(ev) {
    const file = ev.target && ev.target.files && ev.target.files[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setDocumento({ nome: file.name || 'Documento.pdf', fonte: 'upload', file });
    if (!titulo.trim()) setTitulo((file.name || 'Documento').replace(/\.pdf$/i, ''));
    setErro(null);
  }

  function setSig(i, patch) {
    setSignatarios((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addSig() {
    setSignatarios((prev) => [...prev, novoSignatario(metodoPadrao)]);
  }
  function removeSig(i) {
    setSignatarios((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  /* Resolve o hash SHA-256 e (quando aplicável) o ficheiro do documento. */
  async function resolverDocumento(doc) {
    const out = { nome: doc.nome };
    if (doc.fonte === 'exemplo') {
      out.hash = await sha256Hex(doc.texto || doc.nome);
      return out;
    }
    if (doc.fonte === 'upload' && doc.file) {
      const bytes = new Uint8Array(await doc.file.arrayBuffer());
      out.hash = await sha256Hex(bytes);
      // Carrega o ficheiro para um ref persistente, se a plataforma o permitir.
      const api = typeof window !== 'undefined' ? window.__ekoa : null;
      if (api && typeof api.uploadFile === 'function') {
        try {
          const up = await api.uploadFile(new Blob([bytes], { type: 'application/pdf' }), { name: doc.nome });
          if (up && up.id && up.url) out.fileId = up.id;
          if (up && up.url) out.url = up.url;
          out.mime = (up && up.type) || 'application/pdf';
        } catch { /* ref é acessória - o hash é a impressão digital */ }
      }
      return out;
    }
    // spine: usa o ficheiro se existir; caso contrário, impressão digital do registo.
    if (doc.docId) out.docId = doc.docId;
    if (doc.ficheiro && doc.ficheiro.url) {
      out.fileId = doc.ficheiro.fileId;
      out.url = doc.ficheiro.url;
      out.mime = doc.ficheiro.mime;
      try {
        const resp = await fetch(doc.ficheiro.url);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        out.hash = await sha256Hex(bytes);
      } catch {
        out.hash = await sha256Hex(`${doc.docId}:${doc.nome}`);
      }
    } else {
      out.hash = await sha256Hex(`${doc.docId || doc.nome}:${doc.nome}`);
    }
    return out;
  }

  async function criar() {
    if (criandoRef.current) return;
    setErro(null);
    if (!documento) { setErro('Escolha um documento, carregue um PDF ou use o exemplo.'); return; }
    const sigsValidos = signatarios.filter((s) => s.nome.trim());
    if (sigsValidos.length === 0) { setErro('Indique pelo menos um signatário com nome.'); return; }

    criandoRef.current = true;
    setACriar(true);
    try {
      const doc = await resolverDocumento(documento);
      const envValor = criarEnvelope({
        titulo: (titulo.trim() || doc.nome),
        metodoPadrao,
        processoId: processoId || undefined,
        documentos: [doc],
        signatarios: sigsValidos.map((s, i) => ({
          nome: s.nome.trim(),
          email: s.email.trim() || undefined,
          papel: s.papel,
          metodo: s.metodo,
          ordem: i + 1,
        })),
      });
      // Persiste a linha do envelope (a plataforma atribui id/createdAt).
      const row = await createShared('envelopes', envValor);
      if (!row || !row.id) throw new Error('Não foi possível guardar o envelope.');

      await registarEvento({
        app: 'legal-assinatura',
        acao: 'envelope:criado',
        fundamentacao: `Envelope "${envValor.titulo}" com ${sigsValidos.length} signatário(s), método ${metodoPadrao}.`,
        proveniencia: 'manual',
        extra: { envelopeId: row.id },
      });

      navigate(`/envelopes/${row.id}`);
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível criar o envelope.');
      criandoRef.current = false;
      setACriar(false);
    }
  }

  return (
    <div data-demo-page="assinatura/novo" data-testid="assinatura-novo-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Novo envelope</h1>
          <p className="page-subtitle">
            Escolha o documento, defina os signatários e a sua ordem, e o método de assinatura. O envelope
            nasce em rascunho; a assinatura conduz-se no detalhe do envelope.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" data-testid="assinatura-exemplo" data-demo-target="assinatura-exemplo" onClick={usarExemplo}>
            Usar exemplo
          </Button>
        </div>
      </div>

      {/* Documento */}
      <section className="card" aria-label="Documento">
        <h2 className="card-title">Documento</h2>
        <p className="card-subtitle">Do dossiê, um PDF carregado, ou o exemplo de procuração forense.</p>
        <div className="form-grid" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
          <Field label="Documento do dossiê">
            <Select
              value={documento && documento.fonte === 'spine' ? documento.docId : ''}
              onChange={(e) => onEscolherSpine(e.target.value)}
              data-testid="assinatura-doc-spine"
            >
              <option value="">Selecionar documento…</option>
              {docsComNome.map((d) => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ou carregar um PDF">
            <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} data-testid="assinatura-doc-upload" style={{ display: 'none' }} />
            <Button variant="secondary" onClick={() => fileRef.current && fileRef.current.click()}>
              <IconUpload /> Carregar PDF
            </Button>
          </Field>
        </div>
        {documento ? (
          <p className="text-subtle text-xs" data-testid="assinatura-doc-escolhido" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
            Documento: <span className="text-strong">{documento.nome}</span>
          </p>
        ) : null}
      </section>

      {/* Título + método + processo */}
      <section className="card" style={{ marginTop: 'var(--sp-4, 1rem)' }} aria-label="Definições">
        <div className="form-grid">
          <Field label="Título do envelope" required>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Procuração forense" data-testid="assinatura-titulo" />
          </Field>
          <Field label="Método por omissão" hint={providerDe(metodoPadrao).resumo}>
            <Select
              value={metodoPadrao}
              onChange={(e) => setMetodoPadrao(e.target.value)}
              data-testid="assinatura-metodo"
            >
              {metodos.map((m) => (
                <option key={m.key} value={m.key}>{m.nome} ({TIPO_LABEL[m.tipo] || m.tipo})</option>
              ))}
            </Select>
          </Field>
          <Field label="Processo (opcional)">
            <Select value={processoId} onChange={(e) => setProcessoId(e.target.value)} data-testid="assinatura-processo">
              <option value="">Sem processo associado</option>
              {(Array.isArray(processos) ? processos : []).map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || p.id}</option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      {/* Signatários + ordem */}
      <section className="card" style={{ marginTop: 'var(--sp-4, 1rem)' }} aria-label="Signatários">
        <div className="row-space-between" style={{ alignItems: 'center' }}>
          <div>
            <h2 className="card-title">Signatários e ordem</h2>
            <p className="card-subtitle">A ordem de assinatura segue a ordem desta lista.</p>
          </div>
          <Button variant="secondary" size="sm" data-testid="assinatura-add-sig" onClick={addSig}><IconPlus /> Adicionar</Button>
        </div>

        <ul className="stack stack-3" data-testid="assinatura-sigs" style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}>
          {signatarios.map((s, i) => (
            <li
              key={i}
              className="passo-item"
              data-testid={`assinatura-sig-${i}`}
              style={{ border: '1px solid var(--line-1, #e2e8f0)', borderRadius: 'var(--r-2, 0.5rem)', padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)' }}
            >
              <div className="row-space-between" style={{ alignItems: 'center', marginBottom: 'var(--sp-2, 0.5rem)' }}>
                <Badge tone="neutral">Ordem {i + 1}</Badge>
                <Button variant="ghost" size="sm" data-testid={`assinatura-remove-sig-${i}`} onClick={() => removeSig(i)} disabled={signatarios.length <= 1}>
                  <IconTrash /> Remover
                </Button>
              </div>
              <div className="form-grid">
                <Field label="Nome" required>
                  <Input value={s.nome} onChange={(e) => setSig(i, { nome: e.target.value })} placeholder="Nome do signatário" data-testid={`assinatura-sig-nome-${i}`} />
                </Field>
                <Field label="Email (opcional)">
                  <Input type="email" value={s.email} onChange={(e) => setSig(i, { email: e.target.value })} placeholder="email@exemplo.pt" data-testid={`assinatura-sig-email-${i}`} />
                </Field>
                <Field label="Papel">
                  <Select value={s.papel} onChange={(e) => setSig(i, { papel: e.target.value })} data-testid={`assinatura-sig-papel-${i}`}>
                    {PAPEIS.map((p) => (<option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>))}
                  </Select>
                </Field>
                <Field label="Método">
                  <Select value={s.metodo} onChange={(e) => setSig(i, { metodo: e.target.value })} data-testid={`assinatura-sig-metodo-${i}`}>
                    {metodos.map((m) => (<option key={m.key} value={m.key}>{m.nome}</option>))}
                  </Select>
                </Field>
              </div>
            </li>
          ))}
        </ul>
        {signatarios.length === 0 ? (
          <EmptyState icon={<IconSignature />} title="Sem signatários" hint="Adicione pelo menos um signatário." />
        ) : null}
      </section>

      {erro ? <p className="resultado-erro" data-testid="assinatura-novo-erro" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>{erro}</p> : null}

      <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)', marginTop: 'var(--sp-4, 1rem)' }}>
        <Button data-testid="assinatura-criar" data-demo-target="assinatura-criar" onClick={criar} disabled={aCriar}>
          <IconSignature /> {aCriar ? 'A criar.' : 'Criar envelope'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/')}>Cancelar</Button>
      </div>
    </div>
  );
}
