/**
 * Memory page behavior test (§13.6 "Dashboard pages beyond rendering - memory
 * CRUD"; FC-503 visibility, FC-504 automatic-write affordance). The page-level
 * e2e is unreachable (api-only harness), so this committed component spec is the
 * durable regression for the migrated memory surface: it renders the memory
 * cards from `api.memories.list`, pins the FC-504 automatic-memory affordance,
 * the tier change (`api.memories.update { tier }`), and the FC-503 visibility
 * edit (`api.memories.update { visibility }`). The typed client is mocked; the
 * real memory store runs against it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemoryPage from '@/app/(dashboard)/memory/page';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { useMemoryStore } from '@/stores/memory';
import { api } from '@/lib/api';

// FC-307: mock the typed client; the real memory store calls it through tryCall.
vi.mock('@/lib/api', () => ({
  api: {
    memories: {
      list: vi.fn(),
      stats: vi.fn(),
      listTags: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      bulkDelete: vi.fn(),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  ApiError: class ApiError extends Error {},
  isApiError: () => false,
}));

const mocked = api as unknown as {
  memories: {
    list: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
    listTags: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const M_AUTO = {
  id: 'm1',
  title: 'Cliente prefere email',
  type: 'preference',
  scope: 'individual',
  tier: 'active',
  visibility: 'private',
  origin: 'auto-extraction',
  content: 'O cliente prefere ser contactado por email.',
  tags: [],
  createdAt: '2026-06-01T00:00:00Z',
  metadata: {},
};

const M_MANUAL = {
  id: 'm2',
  title: 'Usar Tailwind',
  type: 'lesson',
  scope: 'company',
  tier: 'active',
  visibility: 'org',
  origin: 'manual',
  content: 'Usar sempre Tailwind para estilos.',
  tags: ['css'],
  createdAt: '2026-06-02T00:00:00Z',
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.memories.list.mockResolvedValue({ items: [M_AUTO, M_MANUAL], total: 2 });
  mocked.memories.stats.mockResolvedValue({ total: 2, verified: 0, recentCount: 0, topTags: [] });
  mocked.memories.listTags.mockResolvedValue({ items: [] });
  mocked.memories.update.mockImplementation(async (arg: Record<string, unknown>) => ({ ...M_AUTO, ...arg }));
  useMemoryStore.setState({
    memories: [],
    stats: null,
    tags: [],
    activeTab: 'overview',
    selectedIds: new Set<string>(),
    filters: { type: '', scope: '', visibility: '', tags: [], search: '' },
    page: 1,
    total: 0,
    totalPages: 0,
    isLoading: false,
    error: null,
  });
});

function renderPage() {
  return render(
    <ConfirmProvider>
      <MemoryPage />
    </ConfirmProvider>,
  );
}

describe('MemoryPage', () => {
  it('renders memory cards and the FC-504 automatic-memory affordance', async () => {
    renderPage();

    expect(await screen.findByText('Cliente prefere email')).toBeInTheDocument();
    expect(screen.getByText('Usar Tailwind')).toBeInTheDocument();
    // FC-504: only the auto-extracted memory carries the "Memória automática" affordance.
    const affordances = screen.getAllByTestId('memory-auto-affordance');
    expect(affordances).toHaveLength(1);
    expect(affordances[0]).toHaveTextContent('Memória automática');
  });

  it('changing a memory tier calls api.memories.update with { tier }', async () => {
    renderPage();
    await screen.findByText('Cliente prefere email');

    // Open the first card's tier menu (trigger aria-label is the promote label) and archive it.
    await userEvent.click(screen.getAllByRole('button', { name: 'Mover para o nucleo' })[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivada' }));

    await waitFor(() => expect(mocked.memories.update).toHaveBeenCalledWith({ id: 'm1', tier: 'archive' }));
  });

  it('editing a memory to private calls api.memories.update with { visibility }', async () => {
    renderPage();
    await screen.findByText('Usar Tailwind');

    // Open the edit dialog for the second (org-shared) card.
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar' })[1]);
    const select = await screen.findByTestId('memory-visibility-select');
    await userEvent.selectOptions(select, 'private');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(mocked.memories.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', visibility: 'private' })),
    );
  });
});
