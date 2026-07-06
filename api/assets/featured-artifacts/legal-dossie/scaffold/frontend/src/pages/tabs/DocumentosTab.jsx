import { useEffect, useRef, useState } from 'react';
import {
  createShared,
  updateShared,
  deleteShared,
  formatDate,
  useDebounced,
} from '../../shared.js';
import {
  Button,
  Badge,
  Modal,
  Textarea,
  Input,
  Field,
  ConfirmDialog,
  EmptyState,
  toast,
} from '../../components/ui.jsx';
import {
  IconUpload,
  IconDownload,
  IconExternalLink,
  IconTrash,
  IconFileText,
  IconEdit,
} from '../../components/Icons.jsx';
import {
  DocTypeIcon,
  tipoFromFile,
  formatBytes,
  origemLabel,
  origemTone,
  isNota,
  isOfficeTipo,
  isPreviewableTipo,
  todayStr,
} from '../doc-helpers.jsx';

const ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.msg,.eml,application/pdf,image/*';

function appId() {
  return typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
}

function ekoa() {
  return typeof window !== 'undefined' ? window.__ekoa : null;
}

/* Editor de nota (modal). Autosave com atraso; grava directamente na espinha e
 * avisa o utilizador ("Guardado"). Ao fechar, DESCARTA a nota apenas se ela foi
 * CRIADA nesta sessão do editor E nunca chegou a ter conteúdo (createdHere +
 * nunca gravou texto): assim uma nota já existente aberta e esvaziada nunca é
 * apagada por engano. */
function NotaEditor({ nota, createdHere, onDone }) {
  const [nome, setNome] = useState(nota.nome || 'Nota');
  const [texto, setTexto] = useState(nota.texto || '');
  const [saving, setSaving] = useState(false);
  const debNome = useDebounced(nome, 500);
  const debTexto = useDebounced(texto, 500);
  const skipFirst = useRef(true);
  const closing = useRef(false);
  // Passa a true assim que qualquer conteúdo (texto) é persistido - trava a
  // heurística de descarte para notas que já tiveram substância.
  const savedContent = useRef(!!(nota.texto && nota.texto.trim()));

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    if (closing.current) return;
    let alive = true;
    (async () => {
      try {
        setSaving(true);
        await updateShared('documentos', nota.id, { nome: debNome || 'Nota', texto: debTexto });
        if (debTexto && debTexto.trim()) savedContent.current = true;
        if (alive) toast('Guardado.', { tone: 'ok' });
      } catch {
        if (alive) toast('Falha ao guardar a nota.', { tone: 'error' });
      } finally {
        if (alive) setSaving(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [debNome, debTexto, nota.id]);

  const fechar = async () => {
    closing.current = true;
    try {
      if (createdHere && !savedContent.current && !texto.trim()) {
        // Nota criada agora, sem nunca ter tido conteúdo -> descarta (sem linha fantasma).
        await deleteShared('documentos', nota.id);
      } else {
        await updateShared('documentos', nota.id, { nome: nome || 'Nota', texto });
      }
    } catch {
      /* não fatal - a lista é re-lida a seguir */
    }
    onDone();
  };

  return (
    <Modal
      open
      title="Nota"
      onClose={fechar}
      actions={
        <Button variant="primary" onClick={fechar}>
          Concluir
        </Button>
      }
    >
      <div className="form">
        <Field label="Título">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Título da nota" />
        </Field>
        <Field label="Nota" hint={saving ? 'A guardar…' : 'Guardado automaticamente enquanto escreve.'}>
          <Textarea
            data-testid="nota-texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escreva a nota do processo…"
            rows={8}
          />
        </Field>
      </div>
    </Modal>
  );
}

/* Uma linha da lista de documentos: ícone por tipo, metadados, pré-visualização
 * inline (PDF/imagem) e ações (descarregar, editar no Office, ressincronizar,
 * remover). As notas mostram um excerto e abrem o editor. */
function DocRow({ doc, signedIn, onEditNota, onDelete, onOffice, onResync, busyId }) {
  const [preview, setPreview] = useState(false);
  const nota = isNota(doc);
  const ficheiro = doc.ficheiro || null;
  const tipo = doc.tipo || 'outro';
  const size = ficheiro ? formatBytes(ficheiro.size) : '';
  const canPreview = !!(ficheiro && ficheiro.url && isPreviewableTipo(tipo));
  const canOffice = !!(ficheiro && ficheiro.url && isOfficeTipo(tipo));
  const hasM365 = !!(doc.m365 && doc.m365.driveItemId);
  const busy = busyId === doc.id;

  return (
    <li data-testid={`doc-row-${doc.id}`} className="doc-entry" style={{ borderTop: '1px solid var(--line-1)' }}>
      <div className="documento-item" style={{ alignItems: 'flex-start' }}>
        <span className="row-icon" style={{ marginTop: 2 }} aria-hidden="true">
          <DocTypeIcon tipo={tipo} />
        </span>
        <div className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
          <span className="documento-nome">{doc.nome || '(sem nome)'}</span>
          {nota && doc.texto ? (
            <span className="text-muted text-small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {doc.texto.length > 180 ? `${doc.texto.slice(0, 180)}…` : doc.texto}
            </span>
          ) : null}
          <span
            className="row row-2 text-xs text-subtle"
            style={{ flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 2 }}
          >
            <Badge tone={origemTone(doc.origem)}>{origemLabel(doc.origem)}</Badge>
            {size ? <span>{size}</span> : null}
            <span>{formatDate(doc.data || doc.createdAt)}</span>
            {Number(doc.versao) > 1 ? <span>versão {doc.versao}</span> : null}
            {hasM365 ? <span title={doc.m365.webUrl || ''}>OneDrive</span> : null}
          </span>
        </div>
        <div className="row row-2" style={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canPreview ? (
            <Button size="sm" variant="ghost" onClick={() => setPreview((v) => !v)} data-testid="doc-preview-toggle">
              {preview ? 'Fechar' : 'Pré-visualizar'}
            </Button>
          ) : null}
          {ficheiro && ficheiro.url ? (
            <a
              className="btn btn-ghost btn-sm"
              href={ficheiro.url}
              target="_blank"
              rel="noopener noreferrer"
              download={doc.nome || undefined}
              data-testid="doc-download"
            >
              <IconDownload size={14} /> Descarregar
            </a>
          ) : null}
          {nota ? (
            <Button size="sm" variant="ghost" onClick={() => onEditNota(doc)}>
              <IconEdit size={14} /> Editar
            </Button>
          ) : null}
          {canOffice ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid="editar-office"
              disabled={!signedIn || busy}
              title={!signedIn ? 'Inicie sessão M365' : undefined}
              onClick={() => onOffice(doc)}
            >
              <IconExternalLink size={14} /> Editar no Office
            </Button>
          ) : null}
          {hasM365 ? (
            <Button size="sm" variant="ghost" data-testid="ressincronizar" disabled={busy} onClick={() => onResync(doc)}>
              Ressincronizar
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remover documento"
            data-testid="doc-delete"
            onClick={() => onDelete(doc)}
          >
            <IconTrash size={14} />
          </Button>
        </div>
      </div>

      {preview && canPreview ? (
        <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }} data-testid="doc-preview">
          {tipo === 'pdf' ? (
            <iframe
              title={doc.nome || 'Documento'}
              src={ficheiro.url}
              style={{
                width: '100%',
                height: '480px',
                border: '1px solid var(--line-1)',
                borderRadius: 'var(--r-2)',
                background: 'var(--surface-1)',
              }}
            />
          ) : (
            <img
              src={ficheiro.url}
              alt={doc.nome || 'Imagem'}
              style={{
                maxWidth: '100%',
                maxHeight: '480px',
                borderRadius: 'var(--r-2)',
                border: '1px solid var(--line-1)',
              }}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}

/*
 * Separador Documentos - o coração do dossiê. Carrega documentos de todos os
 * tipos comuns (arrastar-largar ou escolher), grava notas com autosave, e faz o
 * ciclo M365: "Editar no Office" envia o ficheiro para o OneDrive do advogado e
 * abre-o; "Ressincronizar" traz de volta a versão editada como nova versão.
 */
export default function DocumentosTab({ processo, documentos, refresh, sso }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingNota, setEditingNota] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const signedIn = !!(sso && sso.signedIn);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const api = ekoa();
    if (!api || typeof api.uploadFile !== 'function') {
      toast('Carregamento indisponível neste contexto.', { tone: 'error' });
      return;
    }
    setUploading(true);
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
        const row = {
          nome: file.name,
          tipo: tipoFromFile(file),
          processoId: processo.id,
          data: todayStr(),
          origem: 'upload',
          ficheiro,
          versao: 1,
        };
        if (processo.clienteId) row.clienteId = processo.clienteId;
        await createShared('documentos', row);
        ok += 1;
      } catch {
        // Se o ficheiro subiu mas a linha de metadados falhou, apaga o ficheiro
        // órfão (o registo é a fonte de verdade; um blob sem linha é lixo).
        if (uploaded && uploaded.id) {
          try {
            await api.deleteFile(uploaded.id);
          } catch {
            /* melhor-esforço */
          }
        }
      }
    }
    setUploading(false);
    await refresh();
    if (ok > 0) {
      toast(ok === 1 ? 'Documento carregado.' : `${ok} documentos carregados.`, { tone: 'ok' });
    }
    if (ok < files.length) {
      toast('Alguns ficheiros não foram carregados.', { tone: 'error' });
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }

  async function novaNota() {
    try {
      const row = {
        nome: 'Nota',
        tipo: 'nota',
        processoId: processo.id,
        data: todayStr(),
        origem: 'nota',
        texto: '',
        versao: 1,
      };
      if (processo.clienteId) row.clienteId = processo.clienteId;
      const created = await createShared('documentos', row);
      await refresh();
      if (created && created.id) setEditingNota({ ...row, id: created.id, __createdHere: true });
    } catch {
      toast('Não foi possível criar a nota.', { tone: 'error' });
    }
  }

  async function removeDoc(doc) {
    setConfirm(null);
    try {
      await deleteShared('documentos', doc.id);
      const api = ekoa();
      if (api && doc.ficheiro && doc.ficheiro.fileId && doc.ficheiro.appId === appId()) {
        try {
          await api.deleteFile(doc.ficheiro.fileId);
        } catch {
          /* ficheiro já removido - não fatal */
        }
      }
      await refresh();
      toast('Documento removido.', { tone: 'ok' });
    } catch {
      toast('Não foi possível remover o documento.', { tone: 'error' });
    }
  }

  // "Editar no Office": lê os bytes do ficheiro, envia-os para o OneDrive do
  // advogado (Graph delegado) sob "Ekoa Juridico/<processo>", guarda o vínculo
  // m365 e abre o webUrl no Office online.
  async function editarNoOffice(doc) {
    const api = ekoa();
    if (!api || !doc.ficheiro || !doc.ficheiro.url) return;
    setBusyId(doc.id);
    try {
      const fileRes = await api.fetch(doc.ficheiro.url);
      if (!fileRes.ok) throw new Error('Falha ao ler o ficheiro.');
      const blob = await fileRes.blob();
      // Cada segmento do caminho Graph é codificado individualmente ('#','?','%',
      // ':' num nome de ficheiro corromperiam o URL). O nome é prefixado com
      // doc.id para que documentos homónimos no mesmo processo nunca se
      // sobreponham no OneDrive.
      const numeroSafe = String(processo.numeroProcesso || 'processo').replace(/\//g, '-');
      const segFolder = encodeURIComponent('Ekoa Juridico');
      const segNumero = encodeURIComponent(numeroSafe);
      const segNome = encodeURIComponent(`${doc.id}-${doc.nome || 'documento'}`);
      const path = `v1.0/me/drive/root:/${segFolder}/${segNumero}/${segNome}:/content`;
      const putRes = await api.graphFetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': doc.ficheiro.mime || 'application/octet-stream' },
        body: blob,
      });
      if (putRes.status === 401) {
        toast('Sessão M365 expirada - inicie sessão novamente.', { tone: 'error' });
        return;
      }
      if (putRes.status === 403) {
        toast('Falta consentimento do OneDrive - inicie sessão novamente.', { tone: 'error' });
        return;
      }
      if (!putRes.ok) throw new Error('Falha ao enviar para o OneDrive.');
      const item = await putRes.json();
      await updateShared('documentos', doc.id, {
        m365: { driveItemId: item.id, webUrl: item.webUrl, lastSyncAt: new Date().toISOString() },
      });
      await refresh();
      if (item.webUrl) window.open(item.webUrl, '_blank', 'noopener');
      toast('Aberto no Office. Guarde e depois use Ressincronizar.', { tone: 'ok' });
    } catch (err) {
      toast(err && err.message ? err.message : 'Não foi possível abrir no Office.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  // "Ressincronizar": traz a versão editada do OneDrive de volta, guarda-a como
  // novo ficheiro e incrementa a versão (arquivando a anterior em `versoes`).
  async function ressincronizar(doc) {
    const api = ekoa();
    if (!api || !doc.m365 || !doc.m365.driveItemId) return;
    setBusyId(doc.id);
    try {
      const getRes = await api.graphFetch(
        `v1.0/me/drive/items/${encodeURIComponent(doc.m365.driveItemId)}/content`,
        { method: 'GET' },
      );
      if (getRes.status === 401 || getRes.status === 403) {
        toast('Sessão M365 expirada - inicie sessão novamente.', { tone: 'error' });
        return;
      }
      if (!getRes.ok) throw new Error('Falha ao obter a versão do OneDrive.');
      const blob = await getRes.blob();
      const mime = (doc.ficheiro && doc.ficheiro.mime) || blob.type || 'application/octet-stream';
      const file = new File([blob], doc.nome || 'documento', { type: mime });
      const uploaded = await api.uploadFile(file);
      const prevVersoes = Array.isArray(doc.versoes) ? doc.versoes : [];
      const prevFileId = doc.ficheiro && doc.ficheiro.fileId;
      const prevUrl = doc.ficheiro && doc.ficheiro.url;
      // A versão anterior é ARQUIVADA com o seu url e MANTIDA (o ficheiro antigo
      // NÃO é apagado) - o histórico de versões continua descarregável. O custo
      // de armazenamento é aceite em troca de um histórico restaurável.
      await updateShared('documentos', doc.id, {
        ficheiro: { fileId: uploaded.id, appId: appId(), url: uploaded.url, mime: uploaded.type, size: uploaded.size },
        versao: (Number(doc.versao) || 1) + 1,
        versoes: [...prevVersoes, { fileId: prevFileId, url: prevUrl, data: new Date().toISOString() }],
        m365: { ...doc.m365, lastSyncAt: new Date().toISOString() },
      });
      await refresh();
      toast(`Versão ${(Number(doc.versao) || 1) + 1} sincronizada do OneDrive.`, { tone: 'ok' });
    } catch (err) {
      toast(err && err.message ? err.message : 'Não foi possível ressincronizar.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack stack-6" data-testid="documentos-tab">
      {/* ---- Zona de carregamento ---- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--line-2)'}`,
          background: dragging ? 'var(--accent-weak)' : 'var(--surface-1)',
          borderRadius: 'var(--r-3)',
          padding: 'var(--sp-7) var(--sp-6)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          transition: 'border-color 120ms ease, background 120ms ease',
        }}
      >
        <span className="empty-icon" aria-hidden="true">
          <IconUpload />
        </span>
        <p className="text-strong" style={{ margin: 0 }}>
          Arraste ficheiros para aqui
        </p>
        <p className="text-muted text-small" style={{ margin: 0 }}>
          PDF, Word, Excel, imagens ou emails - ou escolha do computador.
        </p>
        <div className="row row-2" style={{ marginTop: 'var(--sp-2)' }}>
          <Button variant="secondary" onClick={() => inputRef.current && inputRef.current.click()} disabled={uploading}>
            <IconUpload size={14} /> {uploading ? 'A carregar…' : 'Escolher ficheiros'}
          </Button>
          <Button variant="ghost" onClick={novaNota} data-testid="nova-nota">
            <IconFileText size={14} /> Nova nota
          </Button>
        </div>
        <input
          ref={inputRef}
          data-testid="upload-input"
          type="file"
          multiple
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* ---- Estado M365 ---- */}
      {!sso || sso.loading ? null : signedIn ? (
        <p className="text-subtle text-xs" style={{ margin: 0 }}>
          Sessão M365 ativa - documentos Word e Excel podem ser editados no Office.
        </p>
      ) : (
        <div className="row row-space-between" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <span className="text-subtle text-xs">
            Inicie sessão no M365 para editar documentos Word e Excel no Office.
          </span>
          <Button
            size="sm"
            variant="secondary"
            data-testid="office-signin"
            onClick={() => {
              const api = ekoa();
              if (api && typeof api.signIn === 'function') api.signIn();
            }}
          >
            Iniciar sessão M365
          </Button>
        </div>
      )}

      {/* ---- Lista de documentos ---- */}
      {documentos.length === 0 ? (
        <EmptyState
          icon={<IconFileText />}
          title="Sem documentos"
          hint="Carregue o primeiro documento ou crie uma nota para começar o dossiê do processo."
        />
      ) : (
        <ul className="documentos-list" data-testid="documentos-list">
          {documentos.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              signedIn={signedIn}
              busyId={busyId}
              onEditNota={(d) => setEditingNota(d)}
              onDelete={(d) => setConfirm(d)}
              onOffice={editarNoOffice}
              onResync={ressincronizar}
            />
          ))}
        </ul>
      )}

      {editingNota ? (
        <NotaEditor
          nota={editingNota}
          createdHere={!!editingNota.__createdHere}
          onDone={async () => {
            setEditingNota(null);
            await refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!confirm}
        title="Remover documento"
        message={confirm ? `Remover "${confirm.nome || 'documento'}" do dossiê? Esta ação é definitiva.` : ''}
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        danger
        onConfirm={() => confirm && removeDoc(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
