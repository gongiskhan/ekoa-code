"use client";

/**
 * "O que a Ekoa sabe" -- the KNOWLEDGE vault (managed by humans, consumed by AGENTS).
 *
 * WS8a: the base was never actually empty for a real org - every search already unions the
 * caller's own vault with the reserved `_shared` legal corpus (209k+ jurisprudência, 43k+
 * legislação, 10k+ legislação laboral). What was missing was VISIBILITY: this page only ever
 * browsed the org's own vault, so a fresh org with zero private uploads looked empty even though
 * the shared corpus was fully populated. This page now:
 *   - "Fornecido": browse either scope (segmented control) -- collection filter + paginated list.
 *   - a search box (POST /api/v1/knowledge/search, unions both scopes) -- the primary way to use
 *     a 262k-document corpus is to search it, not page through it.
 *   - "Fontes": manage crawl sources (add/edit/remove).
 *   - "Documentos": upload files AND add a document by text.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Library,
  Trash2,
  AlertTriangle,
  ExternalLink,
  Brain,
  Bot,
  ListFilter,
  FileText,
  Globe,
  Upload,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "@/stores/i18n";
import { useKnowledgeStore, type KnowledgeScope } from "@/stores/knowledge";
import { SourcesTab } from "@/components/knowledge/sources-tab";
import { DocumentsTab } from "@/components/knowledge/documents-tab";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { LoadingState, Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";

/* ---------- Helpers ---------- */

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-PT", { year: "numeric", month: "short", day: "numeric" });
}

/** The three known `_shared` collections get their proper Portuguese names; anything else
 *  (an org's own free-text collection name) is shown as-is. */
function collectionLabel(
  c: string,
  scope: KnowledgeScope,
  tk: { collectionJurisprudencia: string; collectionLegislacao: string; collectionLegislacaoLaboral: string },
): string {
  if (scope !== "shared") return c;
  if (c === "jurisprudencia") return tk.collectionJurisprudencia;
  if (c === "legislacao") return tk.collectionLegislacao;
  if (c === "legislacao-laboral") return tk.collectionLegislacaoLaboral;
  return c;
}

/* ---------- Page ---------- */

type TabKey = "fornecido" | "fontes" | "documentos";

/** Debounce before a keystroke fires a search request - the corpus is 262k+ documents behind an
 *  HTTP round trip, not a local filter. */
const SEARCH_DEBOUNCE_MS = 300;

export default function KnowledgePage() {
  const { sidebar, pages } = useTranslation();
  const tk = pages.knowledge;
  const router = useRouter();

  const collections = useKnowledgeStore((s) => s.collections);
  const docs = useKnowledgeStore((s) => s.docs);
  const docsTotal = useKnowledgeStore((s) => s.docsTotal);
  const docsPage = useKnowledgeStore((s) => s.docsPage);
  const pageSize = useKnowledgeStore((s) => s.DOCS_PAGE_SIZE);
  const activeCollection = useKnowledgeStore((s) => s.activeCollection);
  const scope = useKnowledgeStore((s) => s.scope);
  const loading = useKnowledgeStore((s) => s.loading);
  const error = useKnowledgeStore((s) => s.error);

  const fetchCollections = useKnowledgeStore((s) => s.fetchCollections);
  const fetchDocs = useKnowledgeStore((s) => s.fetchDocs);
  const remove = useKnowledgeStore((s) => s.remove);
  const setActiveCollection = useKnowledgeStore((s) => s.setActiveCollection);
  const setScope = useKnowledgeStore((s) => s.setScope);

  const searchHits = useKnowledgeStore((s) => s.searchHits);
  const searching = useKnowledgeStore((s) => s.searching);
  const searchError = useKnowledgeStore((s) => s.searchError);
  const runSearch = useKnowledgeStore((s) => s.search);
  const clearSearch = useKnowledgeStore((s) => s.clearSearch);

  const [tab, setTab] = useState<TabKey>("fornecido");
  // Pending delete id (per-card spinner)
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState("");

  useEffect(() => {
    fetchCollections();
    fetchDocs(0);
  }, [fetchCollections, fetchDocs]);

  // Debounced search - a blank box clears results immediately (no request needed).
  useEffect(() => {
    if (!queryInput.trim()) {
      clearSearch();
      return;
    }
    const t = setTimeout(() => void runSearch(queryInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryInput, runSearch, clearSearch]);

  const handleDelete = useCallback(
    async (collection: string, id: string) => {
      setDeletingId(id);
      await remove(collection, id);
      setDeletingId(null);
    },
    [remove],
  );

  const totalPages = Math.max(1, Math.ceil(docsTotal / pageSize));
  const rangeFrom = docsTotal === 0 ? 0 : docsPage * pageSize + 1;
  const rangeTo = Math.min(docsTotal, (docsPage + 1) * pageSize);
  const isSearching = queryInput.trim().length > 0;

  return (
    <PageShell testId="knowledge-page">
      <PageHeader
        icon={Library}
        title={sidebar.knowledge}
        description={tk.description}
        actions={
          <Button
            variant="secondary"
            icon={Brain}
            data-testid="kn-aprendido-link"
            onClick={() => router.push("/memory")}
          >
            {tk.learnedLink}
          </Button>
        }
      />

      {/* Agents-first banner — make it clear the base is consumed by the agents,
          not searched by hand here. */}
      <Card
        data-testid="kn-agents-banner"
        className="flex items-start gap-3 border-teal-200 bg-teal-50/60"
      >
        <Bot className="mt-0.5 h-[18px] w-[18px] shrink-0 text-teal-600" aria-hidden />
        <div className="text-sm text-teal-900">
          <p className="font-medium">{tk.agentsBannerTitle}</p>
          <p className="mt-0.5 text-teal-800/80">
            {tk.agentsBannerBodyBefore}
            <span className="font-medium">{tk.agentsBannerBodyEmphasis}</span>
            {tk.agentsBannerBodyAfter}
          </p>
        </div>
      </Card>

      {/* Search (WS8a) - the primary way to use a 262k-document corpus, unions org + `_shared`
          regardless of the browse scope below. */}
      <Card data-testid="kn-search" className="space-y-2">
        <SearchInput
          value={queryInput}
          onValueChange={setQueryInput}
          placeholder={tk.searchPlaceholder}
          data-testid="kn-search-input"
        />
        <p className="text-xs text-neutral-400">{tk.searchHint}</p>
      </Card>

      {/* Error */}
      {error && !isSearching && (
        <Card className="flex items-center gap-2 border-red-200 bg-red-50/60 text-red-600">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="text-sm">{error}</span>
        </Card>
      )}

      {isSearching ? (
        /* ---------------- Search results (WS8a) ---------------- */
        <div className="space-y-3" data-testid="kn-search-results">
          {searching ? (
            <LoadingState label="A pesquisar..." />
          ) : searchError ? (
            <Card className="flex items-center gap-2 border-red-200 bg-red-50/60 text-red-600">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-sm">{searchError}</span>
            </Card>
          ) : searchHits.length === 0 ? (
            <div data-testid="kn-search-empty">
              <EmptyState icon={FileText} title={tk.searchEmpty} />
            </div>
          ) : (
            searchHits.map((hit) => (
              <Card key={`${hit.scope}/${hit.collection}/${hit.docId}`} data-testid="kn-search-hit">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-neutral-900">
                      {hit.title || hit.docId}
                    </h3>
                    <Badge tone="brand">{hit.collection}</Badge>
                    {hit.scope === "shared" && (
                      <Badge tone="info" data-testid="kn-hit-shared-badge">
                        {tk.sharedBadge}
                      </Badge>
                    )}
                  </div>
                  {hit.snippet && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-neutral-500">{hit.snippet}</p>
                  )}
                  {hit.sourceUrl && (
                    <a
                      href={hit.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-teal-600 transition-colors hover:text-teal-800 focus-ring rounded"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      <span className="max-w-[260px] truncate">{hit.sourceUrl}</span>
                    </a>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <Tabs
            value={tab}
            onChange={(k) => setTab(k as TabKey)}
            items={[
              { key: "fornecido", label: "Fornecido", icon: BookOpen, testId: "kn-tab-fornecido" },
              { key: "fontes", label: "Fontes", icon: Globe, testId: "kn-tab-fontes" },
              { key: "documentos", label: "Documentos", icon: Upload, testId: "kn-tab-documentos" },
            ]}
          />

          {/* ---------------- Fontes ---------------- */}
          {tab === "fontes" && <SourcesTab />}

          {/* ---------------- Documentos ---------------- */}
          {tab === "documentos" && <DocumentsTab />}

          {/* ---------------- Fornecido (browse) ---------------- */}
          {tab === "fornecido" && (
            <div className="space-y-6">
              {/* Scope toggle (WS8a) - the org's own vault vs. the reserved `_shared` public corpus. */}
              <div className="flex flex-wrap items-center gap-2" data-testid="kn-scope-toggle">
                <FilterChip testId="kn-scope-org" active={scope === "org"} onClick={() => setScope("org")}>
                  {tk.scopeOrgLabel}
                </FilterChip>
                <FilterChip testId="kn-scope-shared" active={scope === "shared"} onClick={() => setScope("shared")}>
                  {tk.scopeSharedLabel}
                </FilterChip>
              </div>
              {scope === "shared" && (
                <p className="text-xs text-neutral-400" data-testid="kn-scope-shared-hint">
                  {tk.scopeSharedHint}
                </p>
              )}

              {/* Collection filter (browse only) */}
              <div className="flex flex-wrap items-center gap-2">
                <ListFilter className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                <FilterChip
                  testId="kn-filter-all"
                  active={activeCollection === ""}
                  onClick={() => setActiveCollection("")}
                >
                  Todas
                </FilterChip>
                {collections.map((c) => (
                  <FilterChip
                    key={c}
                    testId={`kn-filter-${c}`}
                    active={activeCollection === c}
                    onClick={() => setActiveCollection(c)}
                  >
                    {collectionLabel(c, scope, tk)}
                  </FilterChip>
                ))}
              </div>

              {/* Count + pagination header */}
              {!loading && docsTotal > 0 && (
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>
                    {rangeFrom}–{rangeTo} de {docsTotal.toLocaleString("pt-PT")} documentos
                  </span>
                  <span>
                    Página {docsPage + 1} de {totalPages.toLocaleString("pt-PT")}
                  </span>
                </div>
              )}

              {/* Doc list */}
              {loading ? (
                <LoadingState label="A carregar..." />
              ) : docs.length === 0 ? (
                <div data-testid="kn-empty">
                  <EmptyState
                    icon={FileText}
                    title="Ainda não há documentos nesta base."
                    description="Adicione em «Documentos» ou em «Fontes»."
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-3" data-testid="kn-doc-list">
                    {docs.map((doc) => (
                      <Card key={`${doc.collection}/${doc.id}`} data-testid="kn-doc">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-neutral-900">
                                {doc.title}
                              </h3>
                              <Badge tone="brand">{doc.collection}</Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                              {doc.createdAt && <span>{formatDate(doc.createdAt)}</span>}
                              {doc.sourceUrl && (
                                <a
                                  href={doc.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-teal-600 transition-colors hover:text-teal-800 focus-ring rounded"
                                >
                                  <ExternalLink className="h-3 w-3" aria-hidden />
                                  <span className="max-w-[260px] truncate">{doc.sourceUrl}</span>
                                </a>
                              )}
                            </div>
                          </div>
                          {scope === "org" &&
                            (deletingId === doc.id ? (
                              <span className="flex h-7 w-7 items-center justify-center text-neutral-400">
                                <Spinner size="sm" />
                              </span>
                            ) : (
                              <IconButton
                                data-testid="kn-doc-delete"
                                icon={Trash2}
                                label="Eliminar documento"
                                size="sm"
                                variant="danger-ghost"
                                onClick={() => handleDelete(doc.collection, doc.id)}
                              />
                            ))}
                        </div>
                      </Card>
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-3 pt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={ChevronLeft}
                        data-testid="kn-prev"
                        onClick={() => fetchDocs(docsPage - 1)}
                        disabled={docsPage <= 0}
                      >
                        Anterior
                      </Button>
                      <span className="text-xs text-neutral-500">
                        {docsPage + 1} / {totalPages}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="kn-next"
                        onClick={() => fetchDocs(docsPage + 1)}
                        disabled={docsPage + 1 >= totalPages}
                      >
                        Próximo
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

function FilterChip({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-ring ${
        active
          ? "bg-teal-600 text-white"
          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}
