"use client";

/**
 * "O que a Ekoa sabe" -- the KNOWLEDGE vault (managed by humans, consumed by AGENTS).
 *
 * There is deliberately NO human search box: the base is searched by Ekoa's
 * agents (chat, coding, automations) via ripgrep — knowledge-first, before the
 * web, cited-or-silent. This page only BROWSES and MANAGES the base:
 *   - "Fornecido": browse the whole base -- collection filter + paginated doc list.
 *   - "Fontes": manage crawl sources (add/edit/remove/Atualizar).
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
import { useKnowledgeStore } from "@/stores/knowledge";
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

/* ---------- Helpers ---------- */

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-PT", { year: "numeric", month: "short", day: "numeric" });
}

/* ---------- Page ---------- */

type TabKey = "fornecido" | "fontes" | "documentos";

export default function KnowledgePage() {
  const { sidebar } = useTranslation();
  const router = useRouter();

  const collections = useKnowledgeStore((s) => s.collections);
  const docs = useKnowledgeStore((s) => s.docs);
  const docsTotal = useKnowledgeStore((s) => s.docsTotal);
  const docsPage = useKnowledgeStore((s) => s.docsPage);
  const pageSize = useKnowledgeStore((s) => s.DOCS_PAGE_SIZE);
  const activeCollection = useKnowledgeStore((s) => s.activeCollection);
  const loading = useKnowledgeStore((s) => s.loading);
  const error = useKnowledgeStore((s) => s.error);

  const fetchCollections = useKnowledgeStore((s) => s.fetchCollections);
  const fetchDocs = useKnowledgeStore((s) => s.fetchDocs);
  const remove = useKnowledgeStore((s) => s.remove);
  const setActiveCollection = useKnowledgeStore((s) => s.setActiveCollection);

  const [tab, setTab] = useState<TabKey>("fornecido");
  // Pending delete id (per-card spinner)
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCollections();
    fetchDocs(0);
  }, [fetchCollections, fetchDocs]);

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

  return (
    <PageShell testId="knowledge-page">
      <PageHeader
        icon={Library}
        title={sidebar.knowledge}
        description="A base de conhecimento que fornece à Ekoa: documentos com fonte e data, prontos a citar."
        actions={
          <Button
            variant="secondary"
            icon={Brain}
            data-testid="kn-aprendido-link"
            onClick={() => router.push("/memory")}
          >
            O que a Ekoa aprendeu
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
          <p className="font-medium">Os agentes da Ekoa usam esta base primeiro.</p>
          <p className="mt-0.5 text-teal-800/80">
            O assistente, o agente de código e (em breve) as automações consultam esta base de
            conhecimento <span className="font-medium">antes da web</span> — citam a fonte ou ficam
            em silêncio, nunca inventam. Não há aqui uma caixa de pesquisa: a base é consultada pelos
            agentes; aqui apenas gere o que ela contém.
          </p>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <Card className="flex items-center gap-2 border-red-200 bg-red-50/60 text-red-600">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="text-sm">{error}</span>
        </Card>
      )}

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
          {/* Collection filter (browse only — the base is searched by the agents,
              via ripgrep, not from a box here) */}
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
                {c}
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
                        <p className="mt-1.5 line-clamp-2 text-sm text-neutral-500">{doc.snippet}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                          {doc.date && <span>{formatDate(doc.date)}</span>}
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
                      {deletingId === doc.id ? (
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
                      )}
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
