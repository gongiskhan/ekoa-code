import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listShared,
  createShared,
  updateShared,
  formatDate,
  formatDateTime,
} from '../shared.js';
import { Button, Field, Input, Badge, Select, EmptyState, toast } from '../components/ui.jsx';
import {
  IconDoor,
  IconFileText,
  IconDownload,
  IconCalendar,
  IconShieldCheck,
  IconUpload,
  IconMail,
} from '../components/Icons.jsx';
import {
  appId,
  whoami,
  passwordSignIn,
  signOut,
  findUtilizadorByEmail,
  resolveVisibility,
  writeAudit,
  enviarMensagemCliente,
  mensagensDoCliente,
} from '../portal.js';
import ClienteShell from './ClienteShell.jsx';

const ESTADO_PROC_TONE = { ativo: 'ok', suspenso: 'media', arquivado: 'neutral' };

function tipoFromFile(file) {
  const mime = String((file && file.type) || '').toLowerCase();
  const name = String((file && file.name) || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.includes('word') || ext === 'doc' || ext === 'docx') return 'docx';
  if (mime.includes('sheet') || mime.includes('excel') || ext === 'xls' || ext === 'xlsx') return 'xlsx';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'imagem';
  return 'outro';
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* --------------------------------------------------------------------------- */
/* Cartão de início de sessão                                                   */
/* --------------------------------------------------------------------------- */

function LoginCard({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErro('');
    if (!email.trim() || !password) {
      setErro('Introduza o email e a palavra-passe.');
      return;
    }
    setBusy(true);
    try {
      const res = await passwordSignIn(email, password);
      if (!res || !res.ok) {
        setErro('Email ou palavra-passe incorretos.');
        return;
      }
      const user = await findUtilizadorByEmail(email);
      if (!user) {
        await signOut();
        setErro('Não foi possível confirmar o seu acesso.');
        return;
      }
      if (user.estado === 'suspenso') {
        await signOut();
        setErro('O seu acesso está suspenso. Contacte o escritório.');
        return;
      }
      await onSignedIn(user, { justLoggedIn: true });
    } catch {
      setErro('Não foi possível iniciar sessão. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-center" data-testid="portal-login">
      <form className="card stack stack-4" style={{ padding: 'var(--sp-6)', width: '100%', maxWidth: 420 }} onSubmit={submit}>
        <div className="stack stack-1">
          <span className="portal-brand-icon" aria-hidden="true"><IconDoor /></span>
          <h1 className="portal-title">Portal do Cliente</h1>
          <p className="text-muted" style={{ margin: 0 }}>
            Introduza as suas credenciais para consultar o seu processo, os documentos partilhados e as mensagens do
            escritório.
          </p>
        </div>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            data-testid="login-email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="o.seu.email@exemplo.pt"
          />
        </Field>
        <Field label="Palavra-passe">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            data-testid="login-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="A sua palavra-passe"
          />
        </Field>
        {erro ? <p className="portal-erro" data-testid="login-erro">{erro}</p> : null}
        <Button type="submit" variant="primary" data-testid="login-submit" disabled={busy}>
          {busy ? 'A entrar…' : 'Entrar'}
        </Button>
        <p className="text-subtle text-xs" style={{ margin: 0 }}>
          Recebeu um convite? Abra o link de definição de palavra-passe que o escritório lhe enviou.
        </p>
      </form>
    </div>
  );
}

/* --------------------------------------------------------------------------- */
/* Caixa de envio de documentos (upload)                                        */
/* --------------------------------------------------------------------------- */

function UploadBox({ clienteId, processosDisponiveis, onUploaded }) {
  const inputRef = useRef(null);
  const [processoId, setProcessoId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (processosDisponiveis.length > 0 && !processosDisponiveis.some((p) => p.id === processoId)) {
      setProcessoId(processosDisponiveis[0].id);
    }
    if (processosDisponiveis.length === 0 && processoId) setProcessoId('');
  }, [processosDisponiveis, processoId]);

  const disabled = processosDisponiveis.length === 0;

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0 || disabled) return;
    const api = typeof window !== 'undefined' ? window.__ekoa : null;
    if (!api || typeof api.uploadFile !== 'function') {
      toast('Envio indisponível neste contexto.', { tone: 'error' });
      return;
    }
    const proc = processosDisponiveis.find((p) => p.id === processoId) || processosDisponiveis[0];
    setBusy(true);
    let ok = 0;
    for (const file of files) {
      let uploaded = null;
      try {
        uploaded = await api.uploadFile(file);
        const ficheiro = {
          fileId: uploaded.id,
          appId: appId(),
          url: uploaded.url,
          mime: uploaded.type,
          size: uploaded.size,
        };
        await createShared('documentos', {
          nome: file.name,
          tipo: tipoFromFile(file),
          origem: 'portal',
          clienteId,
          processoId: proc.id,
          data: todayStr(),
          ficheiro,
          versao: 1,
        });
        await writeAudit({
          clienteId,
          processoId: proc.id,
          titulo: 'Documento enviado pelo cliente',
          descricao: `${file.name} (via portal, processo ${proc.numeroProcesso || proc.id}).`,
        });
        ok += 1;
      } catch {
        if (uploaded && uploaded.id) {
          try {
            await api.deleteFile(uploaded.id);
          } catch {
            /* melhor-esforço */
          }
        }
      }
    }
    setBusy(false);
    if (ok > 0) {
      toast(ok === 1 ? 'Documento enviado ao escritório.' : `${ok} documentos enviados.`, { tone: 'ok' });
      await onUploaded();
    } else {
      toast('Não foi possível enviar o documento.', { tone: 'error' });
    }
  }

  return (
    <section className="card stack stack-3" style={{ padding: 'var(--sp-5)' }} data-testid="portal-upload">
      <div className="row row-2" style={{ alignItems: 'center' }}>
        <span className="row-icon" aria-hidden="true"><IconUpload size={16} /></span>
        <span className="text-strong">Enviar um documento ao escritório</span>
      </div>
      {disabled ? (
        <p className="text-subtle text-xs" style={{ margin: 0 }}>
          Ainda não há processos partilhados consigo. Assim que o escritório partilhar o estado de um processo, poderá
          enviar documentos aqui.
        </p>
      ) : (
        <>
          <Field label="Processo">
            <Select value={processoId} data-testid="upload-processo" onChange={(e) => setProcessoId(e.target.value)}>
              {processosDisponiveis.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || p.id}</option>
              ))}
            </Select>
          </Field>
          <div className="row row-2">
            <Button variant="secondary" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
              <IconUpload size={14} /> {busy ? 'A enviar…' : 'Escolher ficheiro'}
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            data-testid="upload-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------------- */
/* Mensagens do portal (duplo sentido)                                          */
/* --------------------------------------------------------------------------- */

function Mensagens({ clienteId, comunicacoes, onSent }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const mensagens = useMemo(() => mensagensDoCliente(comunicacoes, clienteId), [comunicacoes, clienteId]);

  async function enviar(e) {
    e.preventDefault();
    const texto = body.trim();
    if (!texto) return;
    setBusy(true);
    try {
      await enviarMensagemCliente(clienteId, texto);
      setBody('');
      toast('Mensagem enviada ao escritório.', { tone: 'ok' });
      await onSent();
    } catch {
      toast('Não foi possível enviar a mensagem.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack stack-3" style={{ padding: 'var(--sp-5)' }} data-testid="portal-mensagens">
      <div className="row row-2" style={{ alignItems: 'center' }}>
        <span className="row-icon" aria-hidden="true"><IconMail size={16} /></span>
        <span className="text-strong">Mensagens com o escritório</span>
      </div>
      {mensagens.length === 0 ? (
        <p className="text-subtle text-xs" style={{ margin: 0 }}>Sem mensagens ainda. Escreva a primeira abaixo.</p>
      ) : (
        <ul className="stack stack-2" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {mensagens.map((m) => (
            <li
              key={m.id}
              className="portal-msg"
              data-testid="portal-msg"
              data-direction={m.direction}
              style={{ alignSelf: m.direction === 'out' ? 'flex-start' : 'flex-end' }}
            >
              <span className="portal-msg-de">{m.direction === 'out' ? 'Escritório' : 'Você'}</span>
              <span className="portal-msg-body">{m.body}</span>
              <span className="portal-msg-data">{formatDateTime(m.receivedAt || m.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="row row-2" style={{ alignItems: 'flex-end' }} onSubmit={enviar}>
        <Field label="Nova mensagem" htmlFor="portal-msg-input">
          <Input
            id="portal-msg-input"
            value={body}
            data-testid="mensagem-input"
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva ao escritório…"
          />
        </Field>
        <Button type="submit" variant="primary" data-testid="mensagem-enviar" disabled={busy || !body.trim()}>
          Enviar
        </Button>
      </form>
    </section>
  );
}

/* --------------------------------------------------------------------------- */
/* Vista autenticada                                                            */
/* --------------------------------------------------------------------------- */

function SharedView({ user, onSignOut }) {
  const clienteId = user.clienteId;
  const [processos, setProcessos] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [partilhas, setPartilhas] = useState([]);
  const [comunicacoes, setComunicacoes] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [prc, docs, evs, prt, coms] = await Promise.all([
      listShared('processos'),
      listShared('documentos'),
      listShared('eventos'),
      listShared('portal_partilhas'),
      listShared('comunicacoes'),
    ]);
    setProcessos(prc);
    setDocumentos(docs);
    setEventos(evs);
    setPartilhas(prt);
    setComunicacoes(coms);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const vis = useMemo(
    () => resolveVisibility(clienteId, partilhas, processos, documentos, eventos),
    [clienteId, partilhas, processos, documentos, eventos],
  );

  async function onDownload(doc) {
    // Auditoria de consulta de documento (não fatal, não bloqueia o download).
    await writeAudit({
      clienteId,
      processoId: doc.processoId,
      titulo: 'Documento consultado pelo cliente',
      descricao: `${doc.nome || 'documento'} (via portal).`,
    });
  }

  return (
    <div className="stack stack-4" data-testid="portal-autenticado">
      {loading ? (
        <p className="text-muted">A carregar…</p>
      ) : vis.empty ? (
        <div data-testid="portal-vazio">
          <EmptyState
            icon={<IconShieldCheck />}
            title="Nada partilhado consigo ainda"
            hint="Quando o escritório partilhar o estado do seu processo, documentos ou eventos, aparecem aqui. Pode desde já enviar documentos e mensagens."
          />
        </div>
      ) : (
        <div className="stack stack-4" data-testid="portal-shared">
          {vis.estados.length > 0 && (
            <section className="card stack stack-3" style={{ padding: 'var(--sp-5)' }} data-testid="portal-estados">
              <span className="text-strong">Estado do seu processo</span>
              <ul className="stack stack-2" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {vis.estados.map(({ processo }) => (
                  <li key={processo.id} className="row row-space-between" data-testid="portal-estado-item" style={{ gap: 'var(--sp-3)' }}>
                    <div className="stack stack-1" style={{ minWidth: 0 }}>
                      <span className="text-strong">{processo.numeroProcesso}</span>
                      <span className="text-subtle text-xs">{processo.tribunal || ''}</span>
                    </div>
                    <Badge tone={ESTADO_PROC_TONE[processo.estado] || 'neutral'}>{processo.estado || 'ativo'}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {vis.docs.length > 0 && (
            <section className="card stack stack-3" style={{ padding: 'var(--sp-5)' }} data-testid="portal-docs">
              <span className="text-strong">Documentos partilhados consigo</span>
              <ul className="stack stack-2" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {vis.docs.map(({ documento }) => (
                  <li key={documento.id} className="row row-space-between" data-testid="portal-doc-item" style={{ gap: 'var(--sp-3)' }}>
                    <div className="row row-2" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                      <span className="row-icon" aria-hidden="true" style={{ marginTop: 2 }}><IconFileText size={16} /></span>
                      <div className="stack stack-1" style={{ minWidth: 0 }}>
                        <span className="text-strong" style={{ wordBreak: 'break-word' }}>{documento.nome || '(documento)'}</span>
                        <span className="text-subtle text-xs">{formatDate(documento.data || documento.createdAt)}</span>
                      </div>
                    </div>
                    {documento.ficheiro && documento.ficheiro.url ? (
                      <a
                        className="btn btn-secondary btn-sm"
                        href={documento.ficheiro.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={documento.nome || undefined}
                        data-testid="portal-doc-download"
                        onClick={() => onDownload(documento)}
                      >
                        <IconDownload size={14} /> Descarregar
                      </a>
                    ) : (
                      <span className="text-subtle text-xs">Sem ficheiro</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {vis.evs.length > 0 && (
            <section className="card stack stack-3" style={{ padding: 'var(--sp-5)' }} data-testid="portal-eventos">
              <span className="text-strong">Eventos do seu processo</span>
              <ul className="stack stack-2" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {vis.evs.map(({ evento }) => (
                  <li key={evento.id} className="row row-2" data-testid="portal-evento-item" style={{ alignItems: 'flex-start' }}>
                    <span className="row-icon" aria-hidden="true" style={{ marginTop: 2 }}><IconCalendar size={16} /></span>
                    <div className="stack stack-1" style={{ minWidth: 0 }}>
                      <span className="text-strong">{evento.titulo || '(evento)'}</span>
                      <span className="text-subtle text-xs">
                        {formatDate(evento.data || evento.createdAt)}
                        {evento.descricao ? ` · ${evento.descricao}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <UploadBox clienteId={clienteId} processosDisponiveis={vis.uploadProcessos} onUploaded={load} />
      <Mensagens clienteId={clienteId} comunicacoes={comunicacoes} onSent={load} />

      <div className="row" style={{ justifyContent: 'center' }}>
        <Button variant="ghost" data-testid="portal-sair" onClick={onSignOut}>Terminar sessão</Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- */
/* Página do cliente (raiz)                                                      */
/* --------------------------------------------------------------------------- */

export default function ClientePage() {
  const [state, setState] = useState({ status: 'loading', user: null });

  const onSignedIn = useCallback(async (user, opts) => {
    if (opts && opts.justLoggedIn) {
      // Auditoria de início de sessão + carimbo de último acesso (só num login real).
      await writeAudit({
        clienteId: user.clienteId,
        titulo: 'Início de sessão no portal',
        descricao: `${user.email} iniciou sessão no portal do cliente.`,
      });
      try {
        const acessos = await listShared('portal_acessos');
        const acesso = acessos.find((a) => a.clienteId === user.clienteId);
        if (acesso) await updateShared('portal_acessos', acesso.id, { ultimoLogin: new Date().toISOString() });
      } catch {
        /* não fatal */
      }
    }
    setState({ status: 'in', user });
  }, []);

  const restore = useCallback(async () => {
    const me = await whoami();
    if (me && me.email) {
      const user = await findUtilizadorByEmail(me.email);
      if (user && user.estado !== 'suspenso') {
        setState({ status: 'in', user });
        return;
      }
      if (user && user.estado === 'suspenso') await signOut();
    }
    setState({ status: 'out', user: null });
  }, []);

  useEffect(() => {
    restore();
  }, [restore]);

  async function onSignOut() {
    await signOut();
    setState({ status: 'out', user: null });
    toast('Sessão terminada.', { tone: 'ok' });
  }

  if (state.status === 'loading') {
    return (
      <ClienteShell>
        <div className="portal-center"><p className="text-muted">A carregar…</p></div>
      </ClienteShell>
    );
  }

  if (state.status === 'out') {
    return (
      <ClienteShell>
        <LoginCard onSignedIn={onSignedIn} />
      </ClienteShell>
    );
  }

  return (
    <ClienteShell user={state.user} onSignOut={onSignOut}>
      <SharedView user={state.user} onSignOut={onSignOut} />
    </ClienteShell>
  );
}
