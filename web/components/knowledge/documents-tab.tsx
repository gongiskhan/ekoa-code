"use client";

/**
 * "Documentos" — upload files into the knowledge base.
 *
 * Drag/drop or pick PDF / Word / PowerPoint / Excel / text / image files; each
 * is extracted to text, chunked, and indexed into a collection. The list shows
 * indexed status + chunk/char counts, and a remove button that un-indexes the
 * document (deletes its chunks + the stored file).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  FileText,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Plus,
} from "lucide-react";
import { useKnowledgeStore, type UploadDoc } from "@/stores/knowledge";
import { Spinner } from "@/components/ui/spinner";

const ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.ods,.txt,.md,.csv,.tsv,.json,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.bmp";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-PT", { year: "numeric", month: "short", day: "numeric" });
}

export function DocumentsTab() {
  const uploads = useKnowledgeStore((s) => s.uploads);
  const uploadsLoading = useKnowledgeStore((s) => s.uploadsLoading);
  const fetchUploads = useKnowledgeStore((s) => s.fetchUploads);
  const uploadDocument = useKnowledgeStore((s) => s.uploadDocument);
  const unindexDocument = useKnowledgeStore((s) => s.unindexDocument);
  const ingest = useKnowledgeStore((s) => s.ingest);

  const [collection, setCollection] = useState("documentos");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]); // filenames in flight
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Manual "add by text" form (moved here from the Fornecido tab).
  const [txtCollection, setTxtCollection] = useState("documentos");
  const [txtTitle, setTxtTitle] = useState("");
  const [txtBody, setTxtBody] = useState("");
  const [txtSource, setTxtSource] = useState("");
  const [savingTxt, setSavingTxt] = useState(false);
  const [txtError, setTxtError] = useState<string | null>(null);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const handleAddText = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTxtError(null);
      if (!txtCollection.trim() || !txtTitle.trim() || !txtBody.trim()) {
        setTxtError("Indique a coleção, o título e o texto.");
        return;
      }
      setSavingTxt(true);
      const res = await ingest({
        collection: txtCollection.trim(),
        title: txtTitle.trim(),
        text: txtBody.trim(),
        sourceUrl: txtSource.trim() || undefined,
      });
      setSavingTxt(false);
      if (res.success) {
        setTxtTitle("");
        setTxtBody("");
        setTxtSource("");
      } else {
        setTxtError(res.error || "Falha ao guardar o documento.");
      }
    },
    [txtCollection, txtTitle, txtBody, txtSource, ingest],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploadError(null);
      if (!collection.trim()) {
        setUploadError("Indique a coleção de destino.");
        return;
      }
      for (const file of list) {
        setUploading((u) => [...u, file.name]);
        const res = await uploadDocument(file, collection.trim());
        setUploading((u) => u.filter((n) => n !== file.name));
        if (!res.success) {
          setUploadError(`${file.name}: ${res.error || "falha"}`);
        }
      }
    },
    [collection, uploadDocument],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setRemovingId(id);
      await unindexDocument(id);
      setRemovingId(null);
    },
    [unindexDocument],
  );

  return (
    <div data-testid="kn-documents" className="space-y-8">
      {/* Upload zone */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-teal-600" />
          <h2 className="text-sm font-semibold text-neutral-800">Carregar documentos</h2>
        </div>

        <div className="space-y-1 max-w-xs">
          <label htmlFor="doc-collection" className="text-xs font-medium text-neutral-600">
            Coleção de destino
          </label>
          <input
            id="doc-collection"
            data-testid="doc-collection"
            type="text"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            placeholder="ex.: documentos"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
          />
        </div>

        <div
          data-testid="doc-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            dragOver ? "border-teal-400 bg-teal-50" : "border-neutral-200 hover:border-teal-300 hover:bg-neutral-50"
          }`}
        >
          <Upload size={24} className="text-neutral-300" />
          <p className="text-sm text-neutral-600">Arraste ficheiros para aqui ou clique para escolher</p>
          <p className="text-xs text-neutral-400">PDF, Word, PowerPoint, Excel, texto, imagens</p>
          <input
            ref={inputRef}
            data-testid="doc-input"
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {uploading.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-teal-700">
            <Spinner size="xs" />
            <span>A carregar e indexar: {uploading.join(", ")}</span>
          </div>
        )}

        {uploadError && (
          <div className="flex items-center space-x-2 text-sm text-red-600">
            <AlertTriangle size={14} />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Add by text (moved here from the Fornecido tab) */}
      <form
        data-testid="kn-form"
        onSubmit={handleAddText}
        className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Plus size={16} className="text-teal-600" />
          <h2 className="text-sm font-semibold text-neutral-800">Adicionar por texto</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="kn-collection" className="text-xs font-medium text-neutral-600">
              Coleção
            </label>
            <input
              id="kn-collection"
              data-testid="kn-collection"
              type="text"
              value={txtCollection}
              onChange={(e) => setTxtCollection(e.target.value)}
              placeholder="ex.: documentos"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="kn-titulo" className="text-xs font-medium text-neutral-600">
              Título
            </label>
            <input
              id="kn-titulo"
              data-testid="kn-titulo"
              type="text"
              value={txtTitle}
              onChange={(e) => setTxtTitle(e.target.value)}
              placeholder="Título do documento"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="kn-texto" className="text-xs font-medium text-neutral-600">
            Texto
          </label>
          <textarea
            id="kn-texto"
            data-testid="kn-texto"
            value={txtBody}
            onChange={(e) => setTxtBody(e.target.value)}
            rows={5}
            placeholder="Conteúdo do documento a guardar na base."
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 resize-y"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="kn-fonte" className="text-xs font-medium text-neutral-600">
            Fonte (URL, opcional)
          </label>
          <input
            id="kn-fonte"
            data-testid="kn-fonte"
            type="text"
            value={txtSource}
            onChange={(e) => setTxtSource(e.target.value)}
            placeholder="https://..."
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
          />
        </div>

        {txtError && (
          <div className="flex items-center space-x-2 text-sm text-red-600">
            <AlertTriangle size={14} />
            <span>{txtError}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            data-testid="kn-guardar"
            disabled={savingTxt}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {savingTxt && <Spinner size="sm" />}
            <span>Guardar</span>
          </button>
        </div>
      </form>

      {/* Uploaded docs list */}
      {uploadsLoading ? (
        <div className="flex items-center space-x-2 text-neutral-400 text-sm py-8 justify-center">
          <Spinner size="sm" />
          <span>A carregar...</span>
        </div>
      ) : uploads.length === 0 ? (
        <div
          data-testid="kn-documents-empty"
          className="flex flex-col items-center justify-center py-12 text-center text-neutral-400"
        >
          <FileText size={28} className="mb-3 text-neutral-300" />
          <p className="text-sm">Ainda não carregou documentos. Adicione o primeiro acima.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {uploads.map((doc: UploadDoc) => (
            <div
              key={doc.id}
              data-testid="kn-upload-card"
              className="bg-white border border-neutral-200 rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-neutral-900 truncate">{doc.filename}</h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-teal-50 text-teal-700">
                      {doc.collection}
                    </span>
                    {doc.status === "indexed" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-teal-50 text-teal-700">
                        <CheckCircle2 size={11} /> indexado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700">
                        <FileWarning size={11} /> guardado (sem texto)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400 flex-wrap">
                    <span>{formatBytes(doc.bytes)}</span>
                    {doc.status === "indexed" && (
                      <span>
                        {doc.chunkCount} {doc.chunkCount === 1 ? "excerto" : "excertos"} ·{" "}
                        {doc.charCount.toLocaleString("pt-PT")} caracteres
                      </span>
                    )}
                    {doc.uploadedAt && <span>{formatDate(doc.uploadedAt)}</span>}
                  </div>
                </div>
                <button
                  data-testid="doc-remove"
                  onClick={() => handleRemove(doc.id)}
                  disabled={removingId === doc.id}
                  className="p-1.5 text-neutral-300 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  aria-label="Remover documento (retirar do índice)"
                  title="Remover do índice"
                >
                  {removingId === doc.id ? (
                    <Spinner size="sm" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
