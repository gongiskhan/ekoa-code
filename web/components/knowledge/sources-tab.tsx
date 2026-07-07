"use client";

/**
 * "Fontes" — the crawl-source manager for the Knowledge vault.
 *
 * Lists the curated websites the platform crawls into knowledge (the three
 * default Portuguese legal portals are seeded at startup), with add / edit /
 * remove / enable. The crawl + nightly-refresh controls (kn2/kn3) hang off the
 * same source cards. Management only here — no operational logic.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Globe,
  Plus,
  Trash2,
  AlertTriangle,
  ExternalLink,
  Pencil,
  X,
  Layers,
  Power,
  CheckCircle2,
  Ban,
  RefreshCw,
  CalendarClock,
} from "lucide-react";
import {
  useKnowledgeStore,
  type KnowledgeSource,
  type SourceInput,
  type CrawlProgress,
  type CrawlStats,
} from "@/stores/knowledge";
import { Spinner } from "@/components/ui/spinner";

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-PT", { year: "numeric", month: "short", day: "numeric" });
}

const EMPTY_FORM: SourceInput = {
  label: "",
  url: "",
  collection: "",
  levels: 1,
  maxPages: 2000,
  scope: "same-domain",
  enabled: true,
  render: false,
};

export function SourcesTab() {
  const sources = useKnowledgeStore((s) => s.sources);
  const sourcesLoading = useKnowledgeStore((s) => s.sourcesLoading);
  const fetchSources = useKnowledgeStore((s) => s.fetchSources);
  const addSource = useKnowledgeStore((s) => s.addSource);
  const updateSource = useKnowledgeStore((s) => s.updateSource);
  const deleteSource = useKnowledgeStore((s) => s.deleteSource);
  const startCrawl = useKnowledgeStore((s) => s.startCrawl);
  const fetchCrawlStatus = useKnowledgeStore((s) => s.fetchCrawlStatus);
  const schedule = useKnowledgeStore((s) => s.schedule);
  const fetchSchedule = useKnowledgeStore((s) => s.fetchSchedule);

  const [form, setForm] = useState<SourceInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Live crawl progress per source id (in-flight updates).
  const [progressById, setProgressById] = useState<Record<string, CrawlProgress | null>>({});
  // Ledger stats per source id (indexed vs pending frontier).
  const [statsById, setStatsById] = useState<Record<string, CrawlStats | null>>({});
  const pollersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const stopPoller = useCallback((id: string) => {
    const t = pollersRef.current[id];
    if (t) {
      clearInterval(t);
      delete pollersRef.current[id];
    }
  }, []);

  const poll = useCallback(
    (id: string) => {
      if (pollersRef.current[id]) return; // already polling
      pollersRef.current[id] = setInterval(async () => {
        const { running, progress, stats } = await fetchCrawlStatus(id);
        setProgressById((prev) => ({ ...prev, [id]: progress }));
        if (stats) setStatsById((prev) => ({ ...prev, [id]: stats }));
        if (!running && (!progress || progress.state !== "running")) {
          stopPoller(id);
          await fetchSources(); // pick up persisted lastResult
          // Clear the transient progress line a few seconds after completion.
          setTimeout(() => setProgressById((prev) => ({ ...prev, [id]: null })), 5000);
        }
      }, 1500);
    },
    [fetchCrawlStatus, fetchSources, stopPoller],
  );

  useEffect(() => {
    fetchSources();
    fetchSchedule();
  }, [fetchSources, fetchSchedule]);

  // Load each source's ledger stats (indexed/pending) + resume polling for any
  // running update. Re-runs whenever the SET of sources changes (so a newly
  // added source gets its stats too), skipping ones already loaded/polling.
  const sourceIdsKey = sources.map((s) => s.id).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const src of sources) {
        if (statsById[src.id] || pollersRef.current[src.id]) continue;
        const { running, stats } = await fetchCrawlStatus(src.id);
        if (cancelled) return;
        if (stats) setStatsById((prev) => ({ ...prev, [src.id]: stats }));
        if (running) poll(src.id);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdsKey]);

  // Tear down all pollers on unmount.
  useEffect(() => {
    const pollers = pollersRef.current;
    return () => {
      Object.values(pollers).forEach((t) => clearInterval(t));
    };
  }, []);

  const handleUpdate = useCallback(
    async (id: string) => {
      setProgressById((prev) => ({
        ...prev,
        [id]: {
          sourceId: id,
          state: "running",
          fetched: 0,
          ingested: 0,
          updated: 0,
          unchanged: 0,
          discovered: 0,
          failed: 0,
          queued: 0,
          capped: false,
          startedAt: new Date().toISOString(),
        },
      }));
      const res = await startCrawl(id);
      if (!res.success) {
        setProgressById((prev) => ({ ...prev, [id]: null }));
        return;
      }
      poll(id);
    },
    [startCrawl, poll],
  );

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  }, []);

  const startEdit = useCallback((src: KnowledgeSource) => {
    setEditingId(src.id);
    setForm({
      label: src.label,
      url: src.url,
      collection: src.collection,
      levels: src.levels,
      maxPages: src.maxPages,
      scope: src.scope,
      enabled: src.enabled,
      render: src.render ?? false,
      userAgent: src.userAgent ?? "",
      seeds: src.seeds ?? [],
      seedTemplate: src.seedTemplate,
    });
    setFormError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (!form.url.trim() || !form.collection.trim()) {
        setFormError("Indique o URL e a coleção.");
        return;
      }
      setSaving(true);
      // Populated multi-seed fields are sent as-is. When empty: on EDIT send an
      // explicit clear ([] / null) so removing them persists; on CREATE omit them
      // (undefined) so an empty template URL doesn't fail validation.
      const isEdit = !!editingId;
      const payload: SourceInput = {
        ...form,
        seeds: form.seeds && form.seeds.length ? form.seeds : isEdit ? [] : undefined,
        seedTemplate: form.seedTemplate && form.seedTemplate.url.trim() ? form.seedTemplate : isEdit ? null : undefined,
      };
      const res = editingId
        ? await updateSource(editingId, payload)
        : await addSource(payload);
      setSaving(false);
      if (res.success) {
        resetForm();
      } else {
        setFormError(res.error || "Falha ao guardar a fonte.");
      }
    },
    [form, editingId, addSource, updateSource, resetForm],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      await deleteSource(id);
      setDeletingId(null);
    },
    [deleteSource],
  );

  const handleToggle = useCallback(
    async (src: KnowledgeSource) => {
      setTogglingId(src.id);
      await updateSource(src.id, {
        label: src.label,
        url: src.url,
        collection: src.collection,
        levels: src.levels,
        maxPages: src.maxPages,
        scope: src.scope,
        enabled: !src.enabled,
      });
      setTogglingId(null);
    },
    [updateSource],
  );

  return (
    <div data-testid="kn-sources" className="space-y-8">
      {/* Nightly refresh schedule */}
      {schedule && (
        <div
          data-testid="kn-schedule"
          className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2"
        >
          <CalendarClock size={14} className="text-teal-600 shrink-0" />
          {schedule.enabled ? (
            <span>
              Atualização automática diária às {String(schedule.hour).padStart(2, "0")}:00 — próxima:{" "}
              {new Date(schedule.nextRunAt).toLocaleString("pt-PT", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              . Só re-indexa o que mudou e descobre páginas novas.
            </span>
          ) : (
            <span>Atualização automática desativada.</span>
          )}
        </div>
      )}

      {/* Add / edit form */}
      <form
        data-testid="kn-source-form"
        onSubmit={handleSubmit}
        className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {editingId ? (
              <Pencil size={16} className="text-teal-600" />
            ) : (
              <Plus size={16} className="text-teal-600" />
            )}
            <h2 className="text-sm font-semibold text-neutral-800">
              {editingId ? "Editar fonte" : "Adicionar fonte"}
            </h2>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 cursor-pointer"
            >
              <X size={13} />
              <span>Cancelar</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="src-label" className="text-xs font-medium text-neutral-600">
              Nome
            </label>
            <input
              id="src-label"
              data-testid="src-label"
              type="text"
              value={form.label ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="ex.: DGSI — Jurisprudência"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="src-collection" className="text-xs font-medium text-neutral-600">
              Coleção
            </label>
            <input
              id="src-collection"
              data-testid="src-collection"
              type="text"
              value={form.collection}
              onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))}
              placeholder="ex.: jurisprudencia"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="src-url" className="text-xs font-medium text-neutral-600">
            URL
          </label>
          <input
            id="src-url"
            data-testid="src-url"
            type="text"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://www.dgsi.pt"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label htmlFor="src-levels" className="text-xs font-medium text-neutral-600">
              Níveis de links
            </label>
            <select
              id="src-levels"
              data-testid="src-levels"
              value={form.levels}
              onChange={(e) => setForm((f) => ({ ...f, levels: Number(e.target.value) }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            >
              <option value={1}>1 — links da página</option>
              <option value={2}>2 — links das subpáginas</option>
              <option value={3}>3 — mais fundo (ex.: DGSI)</option>
              <option value={4}>4 — máximo</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="src-scope" className="text-xs font-medium text-neutral-600">
              Âmbito
            </label>
            <select
              id="src-scope"
              data-testid="src-scope"
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            >
              <option value="same-domain">Mesmo domínio</option>
              <option value="any">Qualquer ligação</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="src-maxpages" className="text-xs font-medium text-neutral-600">
              Máx. páginas
            </label>
            <input
              id="src-maxpages"
              data-testid="src-maxpages"
              type="number"
              min={1}
              max={200000}
              value={form.maxPages}
              onChange={(e) => setForm((f) => ({ ...f, maxPages: Number(e.target.value) }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
            />
            <p className="text-[11px] text-neutral-400">Por atualização (até 200&nbsp;000). O rastreio é retomável — fontes grandes são recolhidas ao longo de várias atualizações.</p>
          </div>
        </div>

        {/* Render mode — JS/SPA sites whose static HTML has no links/content */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            data-testid="src-render"
            checked={!!form.render}
            onChange={(e) => setForm((f) => ({ ...f, render: e.target.checked }))}
            className="mt-0.5 accent-teal-600"
          />
          <span className="text-xs text-neutral-600">
            <span className="font-medium text-neutral-700">Renderizar com navegador (JS/SPA)</span> — ative para sites
            que carregam o conteúdo e os links por JavaScript (ex.: ACT, Diário da República). Mais lento, mas vê o
            que o rastreio simples não consegue ver.
          </span>
        </label>

        {/* Multi-seed (advanced) — extra seed URLs + a numeric-range URL template.
            Lets one source enumerate an id space or paginated listing directly,
            past the link-follow depth limit. */}
        <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-neutral-700">
            Sementes adicionais (avançado)
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="src-useragent" className="text-xs font-medium text-neutral-600">
                User-Agent (opcional)
              </label>
              <input
                id="src-useragent"
                data-testid="src-useragent"
                value={form.userAgent ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, userAgent: e.target.value }))}
                placeholder="ex.: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
              <p className="text-[11px] text-neutral-500">
                Alguns sites devolvem o HTML completo a um Googlebot mas só uma casca SPA a outros agentes (ex.: Diário
                da República).
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="src-seeds" className="text-xs font-medium text-neutral-600">
                URLs de partida adicionais (uma por linha)
              </label>
              <textarea
                id="src-seeds"
                data-testid="src-seeds"
                rows={3}
                value={(form.seeds ?? []).join("\n")}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    seeds: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder={"https://www.dgsi.pt/jstj.nsf?OpenDatabase&Start=1&Count=1000"}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="src-template-url" className="text-xs font-medium text-neutral-600">
                Modelo de URL com intervalo (marcador {"{n}"})
              </label>
              <input
                id="src-template-url"
                data-testid="src-template-url"
                value={form.seedTemplate?.url ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    seedTemplate: { from: 1, to: 1, ...(f.seedTemplate ?? {}), url: e.target.value },
                  }))
                }
                placeholder={"https://www.pgdlisboa.pt/leis/lei_mostra_articulado.php?nid={n}&tabela=leis&so_miolo=S"}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  data-testid="src-template-from"
                  placeholder="de"
                  value={form.seedTemplate?.from ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      seedTemplate: { url: "", to: 1, ...(f.seedTemplate ?? {}), from: Number(e.target.value) },
                    }))
                  }
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
                <input
                  type="number"
                  data-testid="src-template-to"
                  placeholder="até"
                  value={form.seedTemplate?.to ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      seedTemplate: { url: "", from: 1, ...(f.seedTemplate ?? {}), to: Number(e.target.value) },
                    }))
                  }
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
                <input
                  type="number"
                  data-testid="src-template-step"
                  placeholder="passo"
                  value={form.seedTemplate?.step ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      seedTemplate: { url: "", from: 1, to: 1, ...(f.seedTemplate ?? {}), step: Number(e.target.value) || 1 },
                    }))
                  }
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
              <p className="text-[11px] text-neutral-500">
                Expande {"{n}"} de &quot;de&quot; até &quot;até&quot; (passo opcional). Ex.: nid 1..4040, ou Start
                1,1001,… (passo 1000) — alcança documentos para além do limite de profundidade.
              </p>
            </div>
          </div>
        </details>

        {formError && (
          <div className="flex items-center space-x-2 text-sm text-red-600">
            <AlertTriangle size={14} />
            <span>{formError}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            data-testid="src-save"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving && <Spinner size="sm" />}
            <span>{editingId ? "Guardar alterações" : "Adicionar fonte"}</span>
          </button>
        </div>
      </form>

      {/* Source list */}
      {sourcesLoading ? (
        <div className="flex items-center space-x-2 text-neutral-400 text-sm py-8 justify-center">
          <Spinner size="sm" />
          <span>A carregar...</span>
        </div>
      ) : sources.length === 0 ? (
        <div
          data-testid="kn-sources-empty"
          className="flex flex-col items-center justify-center py-12 text-center text-neutral-400"
        >
          <Globe size={28} className="mb-3 text-neutral-300" />
          <p className="text-sm">Ainda não há fontes. Adicione a primeira acima.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((src) => (
            <div
              key={src.id}
              data-testid="kn-source-card"
              className={`bg-white border rounded-xl p-4 ${
                src.enabled ? "border-neutral-200" : "border-neutral-200 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-neutral-900 truncate">{src.label}</h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-teal-50 text-teal-700">
                      {src.collection}
                    </span>
                    {!src.enabled && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-neutral-100 text-neutral-500">
                        desativada
                      </span>
                    )}
                  </div>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-xs text-teal-600 hover:text-teal-800 transition-colors"
                  >
                    <ExternalLink size={11} />
                    <span className="truncate max-w-[340px]">{src.url}</span>
                  </a>
                  <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Layers size={11} />
                      {src.levels} {src.levels === 1 ? "nível" : "níveis"}
                    </span>
                    <span>{src.scope === "any" ? "qualquer ligação" : "mesmo domínio"}</span>
                    <span>{src.maxPages.toLocaleString("pt-PT")} págs./atualização</span>
                    {statsById[src.id] && (
                      <span className="text-neutral-500">
                        {statsById[src.id]!.withDoc.toLocaleString("pt-PT")} indexadas
                        {statsById[src.id]!.pending > 0
                          ? ` · ${statsById[src.id]!.pending.toLocaleString("pt-PT")} por indexar`
                          : ""}
                      </span>
                    )}
                    {src.lastCrawledAt && <span>última: {formatDate(src.lastCrawledAt)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    data-testid="src-refresh"
                    onClick={() => handleUpdate(src.id)}
                    disabled={progressById[src.id]?.state === "running"}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    title="Atualizar: procura páginas novas e re-indexa só o que mudou (resumível — clique novamente para ir mais fundo)"
                  >
                    {progressById[src.id]?.state === "running" ? (
                      <Spinner size="xs" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    <span>Atualizar</span>
                  </button>
                  <button
                    data-testid="src-toggle"
                    onClick={() => handleToggle(src)}
                    disabled={togglingId === src.id}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                      src.enabled
                        ? "text-teal-600 hover:bg-teal-50"
                        : "text-neutral-300 hover:text-neutral-500 hover:bg-neutral-100"
                    }`}
                    aria-label={src.enabled ? "Desativar fonte" : "Ativar fonte"}
                    title={src.enabled ? "Desativar" : "Ativar"}
                  >
                    {togglingId === src.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <Power size={15} />
                    )}
                  </button>
                  <button
                    data-testid="src-edit"
                    onClick={() => startEdit(src)}
                    className="p-1.5 text-neutral-300 hover:text-teal-600 rounded-lg hover:bg-teal-50 transition-colors cursor-pointer"
                    aria-label="Editar fonte"
                    title="Editar"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    data-testid="src-delete"
                    onClick={() => handleDelete(src.id)}
                    disabled={deletingId === src.id}
                    className="p-1.5 text-neutral-300 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                    aria-label="Eliminar fonte"
                    title="Eliminar"
                  >
                    {deletingId === src.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <Trash2 size={15} />
                    )}
                  </button>
                </div>
              </div>

              {/* Live crawl progress (in flight) */}
              {progressById[src.id]?.state === "running" && (
                <div
                  data-testid="src-progress"
                  className="mt-3 flex items-center gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2"
                >
                  <Spinner size="xs" className="shrink-0" />
                  <span>
                    A indexar… {progressById[src.id]!.fetched} págs · {progressById[src.id]!.ingested} novas ·{" "}
                    {progressById[src.id]!.updated} atualizadas · {progressById[src.id]!.unchanged} sem alterações
                    {progressById[src.id]!.queued > 0 ? ` · ${progressById[src.id]!.queued} em fila` : ""}
                  </span>
                </div>
              )}

              {/* Last update result (persisted) */}
              {progressById[src.id]?.state !== "running" && src.lastResult && (
                <div
                  data-testid="src-result"
                  className={`mt-3 flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
                    src.lastResult.error
                      ? "text-red-600 bg-red-50 border border-red-100"
                      : "text-neutral-600 bg-neutral-50 border border-neutral-100"
                  }`}
                >
                  {src.lastResult.error ? (
                    <Ban size={13} className="shrink-0 text-red-500" />
                  ) : (
                    <CheckCircle2 size={13} className="shrink-0 text-teal-600" />
                  )}
                  <span>
                    {src.lastResult.error
                      ? `Erro na última atualização: ${src.lastResult.error}`
                      : `Última atualização: ${src.lastResult.ingested} novas · ${src.lastResult.updated} atualizadas · ${src.lastResult.unchanged} sem alterações · ${src.lastResult.failed} falhas` +
                        ((src.lastResult.pendingRemaining ?? 0) > 0
                          ? ` · ${src.lastResult.pendingRemaining!.toLocaleString("pt-PT")} por indexar — clique Atualizar para continuar`
                          : "")}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
