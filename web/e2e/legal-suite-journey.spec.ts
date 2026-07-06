import { test, expect, type Page } from '@playwright/test';
import { cortexBase, legalAppUrl } from './helpers/legal';

/**
 * §9.3 FULL-SUITE JOURNEY — one PT law firm's matter walked end-to-end across
 * the WHOLE legal vertical, app by app, over ONE shared spine (window.__ekoa.shared).
 *
 * This spec proves the SEAMS between the apps, not the depth of any single one
 * (the per-app legal-*.spec.ts specs already prove depth). A prospective client
 * is conflict-checked, taken on as a matter, KYC-approved, worked (dossiê note,
 * CPC deadline, kanban task, time entry), billed (honorários pré-fatura →
 * dossiê, finanças ledger, cobrança reconciliation), scheduled (agenda booking),
 * corresponded with (correio → dossiê) and finally taken through apoio judiciário
 * (SinOA deadlines back into Prazos) — with the notifications bell showing the
 * trail. Every created row carries a per-run TAG and afterAll deletes them all,
 * children before parents, so the shared dev spine is left as found.
 *
 * The apps are served by the shared dev cortex at /apps/legal-*; absolute cortex
 * URLs are used throughout (the frontend baseURL is irrelevant here). The whole
 * journey shares ONE page so the account-shared spine persists across steps.
 */

const CORTEX = cortexBase();
const STAMP = Date.now();
const TAG = `JNY-${STAMP}`;

/* ---- shared spine typing (avoids `any`; the served apps inject window.__ekoa) ---- */
type Row = Record<string, unknown>;
interface EkoaShared {
  list(coll: string): Promise<Row[]>;
  get(coll: string, id: string): Promise<Row | null>;
  create(coll: string, data: Row): Promise<Row>;
  update(coll: string, id: string, patch: Row): Promise<unknown>;
  delete(coll: string, id: string): Promise<unknown>;
}
interface EkoaApi {
  shared: EkoaShared;
  deleteFile?(id: string): Promise<unknown>;
}
interface EkoaWindow extends Window {
  __ekoa: EkoaApi;
  __EKOA_APP_ID?: string;
}

/* ---- date helpers (byte-for-byte the same basis the apps use) ---- */
function ymd(days = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function diasRestantes(dateStr: string): number {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const target = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
/* Independent +7y (KYC art. 51.º), so the arquivarAte assertion never trusts the app. */
function prazoMais7(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ty = y + 7;
  const isLeap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const dd = m === 2 && d === 29 && !isLeap ? 28 : d;
  return `${ty}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* ---- spine access helpers ---- */
async function waitForSpine(pg: Page): Promise<void> {
  await pg.waitForFunction(
    () => {
      const w = window as unknown as EkoaWindow;
      return Boolean(w.__ekoa && w.__ekoa.shared);
    },
    undefined,
    { timeout: 20_000 },
  );
}
async function spineList(pg: Page, coll: string): Promise<Row[]> {
  return pg.evaluate((c) => (window as unknown as EkoaWindow).__ekoa.shared.list(c), coll);
}
async function spineGet(pg: Page, coll: string, id: string): Promise<Row | null> {
  return pg.evaluate(
    ({ c, i }) => (window as unknown as EkoaWindow).__ekoa.shared.get(c, i),
    { c: coll, i: id },
  );
}
/* Narrowing find — throws with a helpful message instead of yielding undefined. */
function must<T>(v: T | undefined | null, message: string): T {
  if (v === undefined || v === null) throw new Error(message);
  return v;
}

/* Wait for a <select>'s option[value] to exist, then select it. */
async function selectByValue(pg: Page, testid: string, value: string): Promise<void> {
  const sel = pg.getByTestId(testid);
  await expect(sel.locator(`option[value="${value}"]`)).toBeAttached({ timeout: 15_000 });
  await sel.selectOption(value);
}

/* State captured as the matter moves through the suite. */
const S = {
  clienteId: '',
  processoId: '',
  numeroProcesso: '',
  prazoId: '',
  fichaId: '',
  correioId: '',
  cobrancaId: '',
  pedidoId: '',
  lancamentoValor: 180, // 90 min @ 120/h = 1.5h × 120
};

let page: Page;
const pageErrors: string[] = [];

function noNewErrors(base: number, label: string): void {
  const fresh = pageErrors.slice(base);
  expect(fresh, `${label} — page errors: ${fresh.join(' | ')}`).toHaveLength(0);
}

/* Bullet-proof teardown: delete every row the journey created across every
 * collection it touched, children before parents, keyed off the matter FKs and
 * the per-run TAG. Runs inside the Núcleo so window.__ekoa is present. */
async function cleanup(): Promise<void> {
  try {
    await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
    await waitForSpine(page);
    await page.evaluate(
      async ({ clienteId, processoId, fichaId, pedidoId, tag }) => {
        const w = window as unknown as EkoaWindow;
        const s = w.__ekoa && w.__ekoa.shared;
        if (!s) return;
        const has = (v: unknown): boolean => typeof v === 'string' && v.includes(tag);
        const del = async (coll: string, id: unknown): Promise<void> => {
          try {
            await s.delete(coll, String(id));
          } catch {
            /* ignore */
          }
        };
        const sweep = async (coll: string, pred: (r: Row) => boolean): Promise<void> => {
          let rows: Row[] = [];
          try {
            rows = await s.list(coll);
          } catch {
            rows = [];
          }
          for (const r of rows) {
            try {
              if (pred(r)) await del(coll, r.id);
            } catch {
              /* ignore */
            }
          }
        };

        // 1) conflitos
        await sweep('conflitos_check', (r) => has(r.notas) || has(r.termo));

        // 2) kyc (events before the ficha)
        if (fichaId) {
          let evs: Row[] = [];
          try {
            evs = await s.list('kyc_eventos');
          } catch {
            evs = [];
          }
          for (const e of evs) if (e.fichaId === fichaId) await del('kyc_eventos', e.id);
          await del('kyc_fichas', fichaId);
        }
        await sweep('kyc_fichas', (r) => r.clienteId === clienteId);

        // 3) kanban
        await sweep(
          'tarefas',
          (r) => r.processoId === processoId || r.clienteId === clienteId || has(r.titulo),
        );

        // 4) tempos + honorários lançamentos
        await sweep('registos_tempo', (r) => r.processoId === processoId || has(r.descricao));
        await sweep('lancamentos', (r) => r.processoId === processoId || has(r.descricao));

        // 5) documentos (dossiê) — free any attached files too
        {
          let docs: Row[] = [];
          try {
            docs = await s.list('documentos');
          } catch {
            docs = [];
          }
          for (const d of docs) {
            if (d.processoId === processoId || has(d.nome)) {
              const fich = d.ficheiro as { fileId?: string } | undefined;
              if (fich && fich.fileId && w.__ekoa.deleteFile) {
                try {
                  await w.__ekoa.deleteFile(fich.fileId);
                } catch {
                  /* ignore */
                }
              }
              await del('documentos', d.id);
            }
          }
        }

        // 6) finanças
        await sweep(
          'despesas',
          (r) => r.clienteId === clienteId || r.processoId === processoId || has(r.descricao),
        );
        // 7) cobranças
        await sweep('cobrancas', (r) => r.clienteId === clienteId || has(r.descricao));
        // 8) conta corrente (débito da despesa + crédito da cobrança)
        await sweep('conta_corrente', (r) => r.clienteId === clienteId || has(r.notas));

        // 9) agenda reservas + derived eventos
        const reservaIds = new Set<string>();
        {
          let rs: Row[] = [];
          try {
            rs = await s.list('reservas');
          } catch {
            rs = [];
          }
          for (const r of rs)
            if (has(r.nome)) {
              reservaIds.add(String(r.id));
              await del('reservas', r.id);
            }
        }
        await sweep(
          'eventos',
          (r) =>
            r.processoId === processoId ||
            (typeof r.reservaId === 'string' && reservaIds.has(r.reservaId)) ||
            has(r.titulo),
        );

        // 10) correio
        await sweep(
          'correio',
          (r) => r.processoId === processoId || r.clienteId === clienteId || has(r.conteudoDescricao),
        );

        // 11) apoio judiciário + its SinOA prazos
        if (pedidoId) {
          try {
            const p = await s.get('apoio_judiciario', pedidoId);
            const gerados = (p && Array.isArray(p.prazosGerados) ? p.prazosGerados : []) as string[];
            for (const id of gerados) await del('prazos', id);
          } catch {
            /* ignore */
          }
          await del('apoio_judiciario', pedidoId);
        }
        await sweep('apoio_judiciario', (r) => r.clienteId === clienteId);

        // 12) prazos (step-5 manual + any SinOA linked to the matter)
        await sweep('prazos', (r) => r.processoId === processoId);

        // 13) notificações left by the journey
        await sweep(
          'notificacoes',
          (r) =>
            r.processoId === processoId ||
            has(r.corpo) ||
            has(r.titulo) ||
            (typeof r.href === 'string' &&
              (r.href.includes(processoId) || r.href.includes(clienteId))),
        );

        // parents last
        await sweep('processos', (r) => r.id === processoId || r.clienteId === clienteId);
        if (clienteId) await del('clientes', clienteId);
      },
      {
        clienteId: S.clienteId,
        processoId: S.processoId,
        fichaId: S.fichaId,
        pedidoId: S.pedidoId,
        tag: TAG,
      },
    );
  } catch {
    /* best-effort */
  }
}

test.describe.serial('legal suite journey: cliente a apoio judiciário por todas as costuras da suite', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // The Núcleo (and only it) seeds the shared spine on boot. Open it once and
    // wait for the seed to land so downstream steps (agenda, kanban) have data.
    await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
    await waitForSpine(page);
    let seeded = false;
    for (let i = 0; i < 40 && !seeded; i += 1) {
      seeded = await page.evaluate(async () => {
        const w = window as unknown as EkoaWindow;
        const tipos = await w.__ekoa.shared.list('sessao_tipos');
        return tipos.some((t) => Boolean((t as Row).publico));
      });
      if (!seeded) await page.waitForTimeout(500);
    }
    expect(seeded, 'the Núcleo seed (sessao_tipos) must be present').toBe(true);
  });

  test.afterAll(async () => {
    if (page) {
      await cleanup();
      await page.close();
    }
  });

  // 1 -----------------------------------------------------------------------
  test('1) legal-conflitos — verificar o prospecto, sem conflito, decisão sem_conflito', async () => {
    const base = pageErrors.length;
    const prospecto = `${TAG} Ribeiro & Filhos`;

    await page.goto(legalAppUrl('legal-conflitos'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('verificar-page')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('conflitos-termo').fill(prospecto);
    await page.getByTestId('conflitos-verificar').click();
    // a novel synthetic name yields the empty-state (no conflict)
    await expect(page.getByTestId('conflitos-sem-hits')).toBeVisible({ timeout: 10_000 });

    // record the decisão sem_conflito (registar is disabled until a decision is chosen)
    await expect(page.getByTestId('conflitos-registar')).toBeDisabled();
    await page.getByTestId('conflitos-decisao-select').selectOption('sem_conflito');
    await expect(page.getByTestId('conflitos-registar')).toBeEnabled();
    await page.getByTestId('conflitos-notas').fill(`Verificação de conflitos da jornada ${TAG}`);
    await page.getByTestId('conflitos-registar').click();
    await expect(page.getByTestId('conflitos-sucesso')).toBeVisible({ timeout: 10_000 });

    // the check persisted with the recorded decision
    const check = must(
      (await spineList(page, 'conflitos_check')).find((r) => has(r.notas)),
      'conflitos_check not persisted',
    );
    expect(check.decisao).toBe('sem_conflito');

    noNewErrors(base, '1 conflitos');
  });

  // 2 -----------------------------------------------------------------------
  test('2) legal-nucleo — abrir o cliente (empresa) e o processo FK-ligado', async () => {
    const base = pageErrors.length;

    await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 20_000 });

    // cliente (empresa)
    await page.getByTestId('nav-clientes').click();
    await expect(page.getByTestId('clientes-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('novo-cliente').click();
    await page.getByTestId('cliente-nome').fill(`${TAG} Ribeiro & Filhos`);
    await page.getByTestId('cliente-tipo').selectOption('empresa');
    const nif = ('5' + String(STAMP % 100000000).padStart(8, '0')).slice(0, 9);
    await page.getByTestId('cliente-nif').fill(nif);
    await page.getByTestId('cliente-email').fill(`ribeiro-${STAMP}@e2e.pt`);
    await page.getByTestId('guardar-cliente').click();
    await expect(page).toHaveURL(/\/clientes\/[^/]+$/, { timeout: 15_000 });
    S.clienteId = page.url().match(/\/clientes\/([^/?#]+)/)?.[1] ?? '';
    expect(S.clienteId, 'cliente id from URL').toBeTruthy();

    // processo for that cliente (real tribunal, TAG-derived número)
    await page.getByTestId('nav-processos').click();
    await expect(page.getByTestId('processos-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('novo-processo').click();
    const opt = page
      .getByTestId('processo-cliente')
      .locator('option', { hasText: `${TAG} Ribeiro & Filhos` });
    await expect(opt).toBeAttached({ timeout: 10_000 });
    await page.getByTestId('processo-cliente').selectOption((await opt.getAttribute('value')) ?? '');
    S.numeroProcesso = `${(STAMP % 90000) + 10000}/26.4T8CBR`;
    await page.getByTestId('processo-numero').fill(S.numeroProcesso);
    await page.getByTestId('processo-tribunal').fill('Juízo Central Cível de Coimbra');
    await page.getByTestId('guardar-processo').click();
    await expect(page).toHaveURL(/\/processos\/[^/]+$/, { timeout: 15_000 });
    S.processoId = page.url().match(/\/processos\/([^/?#]+)/)?.[1] ?? '';
    expect(S.processoId, 'processo id from URL').toBeTruthy();

    // tipo empresa persisted on the shared spine
    const cli = await spineGet(page, 'clientes', S.clienteId);
    expect(cli?.tipo).toBe('empresa');

    noNewErrors(base, '2 nucleo');
  });

  // 3 -----------------------------------------------------------------------
  test('3) legal-kyc — nova ficha, risco calculado, aprovar, arquivarAte carimbado', async () => {
    const base = pageErrors.length;

    await page.goto(legalAppUrl('legal-kyc', 'nova'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nova-ficha-page')).toBeVisible({ timeout: 20_000 });

    // (0) aplicabilidade — default serviço is applicable → advance
    await page.getByTestId('kyc-servico-avancar').click();
    // (1) identificação — this matter's cliente + risk factors
    await expect(page.getByTestId('kyc-cliente')).toBeVisible({ timeout: 15_000 });
    await selectByValue(page, 'kyc-cliente', S.clienteId);
    await page.getByTestId('kyc-tipo').selectOption('empresa');
    await page.getByTestId('kyc-pais').selectOption('medio');
    await page.getByTestId('kyc-natureza').selectOption('societario');
    await page.getByTestId('kyc-avancar').click();
    // (2) risco — the engine computed a band/score
    await expect(page.getByTestId('kyc-risco')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('kyc-score')).toHaveText(/\d+/);
    await page.getByTestId('kyc-risco-avancar').click();
    // (3) RCBE — leave pending for an empresa, advance
    await expect(page.getByTestId('kyc-rcbe-avancar')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('kyc-rcbe-avancar').click();
    // (4) guardar
    await expect(page.getByTestId('kyc-guardar')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('kyc-guardar').click();
    await expect(page).toHaveURL(/\/ficha\/[^/]+$/, { timeout: 15_000 });
    S.fichaId = page.url().match(/\/ficha\/([^/?#]+)/)?.[1] ?? '';
    expect(S.fichaId, 'ficha id from URL').toBeTruthy();

    // aprovar → estado + arquivarAte +7y
    await expect(page.getByTestId('ficha-detail')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('ficha-aprovar').click();
    await expect(page.getByTestId('ficha-estado')).toContainText('Aprovada', { timeout: 15_000 });
    const ficha = await spineGet(page, 'kyc_fichas', S.fichaId);
    expect(ficha?.estado).toBe('aprovada');
    expect(ficha?.arquivarAte).toBe(prazoMais7(ymd(0)));

    noNewErrors(base, '3 kyc');
  });

  // 4 -----------------------------------------------------------------------
  test('4) legal-dossie — nota documento no processo', async () => {
    const base = pageErrors.length;
    const notaTitle = `Nota ${TAG}`;

    await page.goto(legalAppUrl('legal-dossie', `processo/${S.processoId}`), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('tab-documentos').click();
    await expect(page.getByTestId('documentos-tab')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('nova-nota').click();
    await page.getByPlaceholder('Título da nota').fill(notaTitle);
    await page.getByTestId('nota-texto').fill(`Estratégia processual da jornada ${TAG}.`);
    await expect(page.getByText('Guardado.').first()).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'Concluir' }).click();

    await expect(page.getByTestId('documentos-list').getByText(notaTitle)).toBeVisible({
      timeout: 15_000,
    });

    noNewErrors(base, '4 dossie');
  });

  // 5 -----------------------------------------------------------------------
  test('5) legal-prazos — calculadora, guardar prazo, aparece no radar', async () => {
    const base = pageErrors.length;
    const prazoTitulo = `Prazo ${TAG}`;

    await page.goto(`${CORTEX}/apps/legal-prazos/calculadora`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('calculadora-page')).toBeVisible({ timeout: 20_000 });
    await selectByValue(page, 'prazo-processo', S.processoId);
    await page.getByTestId('prazo-data').fill(ymd(0));
    await page.getByTestId('prazo-titulo').fill(prazoTitulo);
    await page.getByTestId('prazo-dias').fill('10');
    // drop the férias suspension so the deadline stays inside the radar window
    await page.getByTestId('prazo-ferias').uncheck();
    await page.getByTestId('calcular').click();
    await expect(page.getByTestId('resultado-datalimite')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('guardar-prazo').click();
    await expect(page.getByTestId('prazos-lista').getByText(prazoTitulo).first()).toBeVisible({
      timeout: 10_000,
    });

    // persisted, FK-linked to the matter
    const prazo = must(
      (await spineList(page, 'prazos')).find(
        (p) => p.processoId === S.processoId && (p.titulo === prazoTitulo || p.descricao === prazoTitulo),
      ),
      'prazo did not persist to the shared spine',
    );
    S.prazoId = String(prazo.id);
    const d = diasRestantes(String(prazo.dataLimite));

    // it surfaces on the radar in its urgency band
    await page.goto(legalAppUrl('legal-prazos'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('radar-page')).toBeVisible({ timeout: 20_000 });
    if (d > 7) await page.getByTestId('radar-window-30').click();
    await expect(
      page.getByTestId('radar-proximos').getByTestId(`prazo-desc-${S.prazoId}`),
    ).toHaveText(prazoTitulo, { timeout: 15_000 });

    noNewErrors(base, '5 prazos');
  });

  // 6 -----------------------------------------------------------------------
  test('6) legal-kanban — criar tarefa para o processo, mover para Em curso, estado sincroniza', async () => {
    const base = pageErrors.length;
    const cardTitulo = `Tarefa ${TAG}`;

    await page.goto(legalAppUrl('legal-kanban'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('kanban-novo')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('kanban-novo').click();
    await page.getByTestId('kanban-titulo').fill(cardTitulo);
    await selectByValue(page, 'kanban-processo', S.processoId);
    await page.getByTestId('kanban-guardar').click();

    const card = page.getByTestId('kanban-card').filter({ hasText: cardTitulo });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByTestId('kanban-mover').selectOption('em_curso');
    await expect(page.getByTestId('kanban-lane-em_curso')).toContainText(cardTitulo, {
      timeout: 15_000,
    });

    const tarefa = must(
      (await spineList(page, 'tarefas')).find((t) => t.titulo === cardTitulo),
      'tarefa not persisted',
    );
    expect(tarefa.estado).toBe('em_curso');
    expect(tarefa.processoId).toBe(S.processoId);

    noNewErrors(base, '6 kanban');
  });

  // 7 -----------------------------------------------------------------------
  test('7) legal-tempos — registo manual 90 min tarifa 120 faturável, transferir para honorários', async () => {
    const base = pageErrors.length;
    const desc = `Reunião de trabalho ${TAG}`;

    await page.goto(legalAppUrl('legal-tempos'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('tempos-desc')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('tempos-desc').fill(desc);
    await selectByValue(page, 'tempos-processo', S.processoId);
    await page.getByTestId('tempos-minutos').fill('90');
    await page.getByTestId('tempos-tarifa').fill('120');
    // faturável is checked by default
    await page.getByTestId('tempos-guardar').click();

    const registo = page.getByTestId('tempos-registo').filter({ hasText: TAG }).first();
    await expect(registo).toBeVisible({ timeout: 15_000 });
    await registo.getByTestId('tempos-transferir').click();
    await expect(registo.getByTestId('tempos-transferir')).toHaveCount(0, { timeout: 15_000 });

    // a honorários lançamento was written for the matter (1.5h × 120 = 180)
    const lanc = must(
      (await spineList(page, 'lancamentos')).find(
        (l) => l.processoId === S.processoId && has(l.descricao),
      ),
      'lançamento not created by transfer',
    );
    expect(lanc.valor).toBe(180);
    S.lancamentoValor = 180;

    noNewErrors(base, '7 tempos');
  });

  // 8 -----------------------------------------------------------------------
  test('8) legal-honorarios — a pré-fatura gera e o documento aterra no dossiê', async () => {
    const base = pageErrors.length;

    await page.goto(legalAppUrl('legal-honorarios', 'pre-faturas'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('prefaturas-page')).toBeVisible({ timeout: 20_000 });

    await selectByValue(page, 'pf-processo', S.processoId);
    await page.getByTestId('pf-calcular').click();
    await expect(page.getByTestId('pf-breakdown')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pf-emitir').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Emitir', exact: true }).click();
    await expect(page.getByTestId('pf-resultado')).toHaveCount(0, { timeout: 15_000 });

    // a documentos row (origem honorarios) was written for the matter
    const doc = must(
      (await spineList(page, 'documentos')).find(
        (x) => x.origem === 'honorarios' && x.processoId === S.processoId,
      ),
      'pré-fatura documento not written to the dossiê',
    );
    expect(doc.tipo).toBe('nota');

    // and it is visible in the dossiê's Documentos tab
    await page.goto(legalAppUrl('legal-dossie', `processo/${S.processoId}`), {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('tab-documentos').click();
    await expect(
      page.getByTestId('documentos-list').getByText('Pré-fatura', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });

    noNewErrors(base, '8 honorarios');
  });

  // 9 -----------------------------------------------------------------------
  test('9) legal-financas — despesa reembolsável no ledger + emissão certificada BLOQUEADA', async () => {
    const base = pageErrors.length;

    // SEAM NOTE: pré-faturas do NOT auto-post to conta_corrente (finanças is a
    // read-only ledger fed only by approved reembolsável despesas / recebidas
    // provisões / reconciled cobranças). So we register + approve a tagged despesa
    // to assert the ledger, per the brief's contingency.
    await page.goto(legalAppUrl('legal-financas', 'despesas'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('despesas-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('financas-despesa-nova').click();
    await selectByValue(page, 'despesa-processo', S.processoId); // auto-fills clienteId
    await page.getByTestId('despesa-descricao').fill(`Taxa de justiça ${TAG}`);
    await page.getByTestId('despesa-valor').fill('45');
    // reembolsável is on by default (required for the débito)
    await page.getByTestId('despesa-guardar').click();

    const desp = must(
      (await spineList(page, 'despesas')).find((r) => has(r.descricao)),
      'despesa not created',
    );
    const despId = String(desp.id);
    await page.getByTestId(`despesa-aprovar-${despId}`).click();
    await expect(page.getByTestId(`despesa-estado-${despId}`)).toContainText('Aprovada', {
      timeout: 15_000,
    });

    // the approval posted a débito to the cliente's conta corrente
    const debito = must(
      (await spineList(page, 'conta_corrente')).find(
        (c) => c.clienteId === S.clienteId && c.tipo === 'debito' && c.origem === 'despesa',
      ),
      'conta corrente débito (origem despesa) not posted',
    );
    expect(debito.clienteId).toBe(S.clienteId);

    // regulatory: the certified-emission block is disabled (no native AT invoicing)
    await page.goto(legalAppUrl('legal-financas', 'faturacao'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('faturacao-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('financas-emitir-bloqueado')).toBeDisabled();
    await expect(page.getByTestId('fat-bloqueio-copy')).toContainText('InvoiceXpress');

    noNewErrors(base, '9 financas');
  });

  // 10 ----------------------------------------------------------------------
  test('10) legal-cobrancas — cobrança, referência (mock), pagamento ?dev=1, paga + crédito conciliado', async () => {
    const base = pageErrors.length;

    await page.goto(legalAppUrl('legal-cobrancas'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('cobrancas-page')).toBeVisible({ timeout: 20_000 });
    await waitForSpine(page);

    // create a cobrança for the cliente (valor mirrors the pré-fatura honorário base)
    S.cobrancaId = await page.evaluate(
      async ({ clienteId, valor, tag }) => {
        const s = (window as unknown as EkoaWindow).__ekoa.shared;
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const row = await s.create('cobrancas', {
          clienteId,
          descricao: `Cobrança ${tag}`,
          valor,
          dataVencimento: `${d.getFullYear()}-${mm}-${dd}`,
          estado: 'pendente',
          metodo: 'ifthenpay-mb',
        });
        return String(row.id);
      },
      { clienteId: S.clienteId, valor: S.lancamentoValor, tag: TAG },
    );
    expect(S.cobrancaId).toBeTruthy();

    // ?dev=1 unlocks the simulate-payment block
    await page.goto(`${legalAppUrl('legal-cobrancas', `cobranca/${S.cobrancaId}`)}?dev=1`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('cobranca-detalhe')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('cobrancas-gerar-ref').click();
    await expect(page.getByTestId('mb-referencia')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('cobrancas-simular-callback').click();
    await expect(page.getByTestId('cobranca-reconciliada')).toBeVisible({ timeout: 10_000 });

    // §3.3 reconciliation: paga + exactly one conta_corrente crédito origem 'cobranca'
    const recon = await page.evaluate(async (id) => {
      const s = (window as unknown as EkoaWindow).__ekoa.shared;
      const norm = (r: unknown): string => String(r == null ? '' : r).replace(/\s+/g, '');
      const cob = await s.get('cobrancas', id);
      const refPag = (cob?.refPagamento ?? {}) as { referencia?: string };
      const ref = norm(refPag.referencia);
      const conta = await s.list('conta_corrente');
      const creditos = conta.filter((c) => c.origem === 'cobranca' && norm(c.refExterna) === ref);
      return {
        estado: cob?.estado,
        creditos: creditos.map((c) => ({ valor: c.valor, clienteId: c.clienteId })),
      };
    }, S.cobrancaId);
    expect(recon.estado).toBe('paga');
    expect(recon.creditos).toHaveLength(1);
    expect(recon.creditos[0].valor).toBe(S.lancamentoValor);
    expect(recon.creditos[0].clienteId).toBe(S.clienteId);

    noNewErrors(base, '10 cobrancas');
  });

  // 11 ----------------------------------------------------------------------
  test('11) legal-agenda — tipos semeados; reserva pública gratuita → confirmada → aparece na equipa', async () => {
    const base = pageErrors.length;

    // staff: the seeded sessão tipos render
    await page.goto(`${legalAppUrl('legal-agenda')}tipos`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('tipos-page')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('tipos-lista').getByText('Reunião de acompanhamento', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId('tipo-row').count()).toBeGreaterThanOrEqual(3);

    // find the público gratuito tipo
    const gratId = await page.evaluate(async () => {
      const s = (window as unknown as EkoaWindow).__ekoa.shared;
      const tipos = await s.list('sessao_tipos');
      const g =
        tipos.find((t) => t.nome === 'Reunião de acompanhamento' && Boolean(t.publico)) ??
        tipos.find((t) => Boolean(t.publico) && t.preco == null);
      return g ? String(g.id) : '';
    });
    expect(gratId, 'gratuito público sessão tipo').toBeTruthy();

    // public: book a gratuito slot (auto-confirms)
    await page.goto(`${legalAppUrl('legal-agenda-reservas')}?tipo=${gratId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('reservas-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('rz-tipo-nome')).toHaveText('Reunião de acompanhamento');
    await expect(page.getByTestId('reservas-slots')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('rz-slot').first().click();
    await expect(page.getByTestId('reservas-form')).toBeVisible();
    await page.getByTestId('rz-nome').fill(`Cliente ${TAG}`);
    await page.getByTestId('rz-email').fill(`agenda-${STAMP}@e2e.pt`);
    await page.getByTestId('reservas-confirmar').click();
    await expect(page.getByTestId('reservas-resultado')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('reservas-estado')).toContainText('confirmada', { ignoreCase: true });
    // gratuito → no MB payment panel
    await expect(page.getByTestId('pay-multibanco')).toHaveCount(0);

    const reserva = must(
      (await spineList(page, 'reservas')).find((r) => has(r.nome)),
      'reserva not persisted',
    );
    expect(reserva.estado).toBe('confirmada');

    // it shows on the staff AgendaPage "próximas"
    await page.goto(legalAppUrl('legal-agenda'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('agenda-proximas')).toContainText(`Cliente ${TAG}`, {
      timeout: 15_000,
    });

    noNewErrors(base, '11 agenda');
  });

  // 12 ----------------------------------------------------------------------
  test('12) legal-correio — carta registada, expedido/entregue, comprovativo no dossiê', async () => {
    const base = pageErrors.length;
    const conteudo = `Notificação registada ${TAG}`;

    await page.goto(`${legalAppUrl('legal-correio')}nova`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('correio-nova-page')).toBeVisible({ timeout: 20_000 });
    await selectByValue(page, 'correio-nova-cliente', S.clienteId);
    await selectByValue(page, 'correio-nova-processo', S.processoId);
    await page.getByTestId('correio-nova-conteudo').fill(conteudo);
    await page.getByTestId('correio-registar').click();
    await expect(page.getByTestId('correio-ref')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('correio-ref-valor')).toHaveText(/^RR\d{9}PT$/);

    const carta = must(
      (await spineList(page, 'correio')).find((r) => r.conteudoDescricao === conteudo),
      'carta not persisted',
    );
    S.correioId = String(carta.id);

    // expedido here, entregue in the Expediente
    await page.getByTestId('correio-marcar-expedido').click();
    await expect(page.getByTestId('correio-ref-estado')).toHaveText('Expedido', { timeout: 15_000 });
    await page.goto(legalAppUrl('legal-correio'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`correio-entregue-${S.correioId}`).click();
    await expect(page.getByTestId(`correio-estado-${S.correioId}`)).toHaveText('Entregue', {
      timeout: 15_000,
    });

    // anexar comprovativo → writes a documentos row into the dossiê
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId(`correio-comprovativo-${S.correioId}`).click(),
    ]);
    await chooser.setFiles({
      name: 'comprovativo-jornada.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% comprovativo da jornada legal\n'),
    });
    await expect
      .poll(
        async () => {
          const c = await spineGet(page, 'correio', S.correioId);
          return c && typeof c.comprovativoDocumentoId === 'string' ? 'linked' : 'pending';
        },
        { timeout: 20_000 },
      )
      .toBe('linked');

    const cartaAfter = await spineGet(page, 'correio', S.correioId);
    const docId = String(cartaAfter?.comprovativoDocumentoId);
    const doc = await spineGet(page, 'documentos', docId);
    expect(doc?.origem).toBe('legal-correio');
    expect(doc?.processoId).toBe(S.processoId);

    // visible in the dossiê Documentos tab
    await page.goto(legalAppUrl('legal-dossie', `processo/${S.processoId}`), {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('tab-documentos').click();
    await expect(
      page.getByTestId('documentos-list').getByText('Comprovativo', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });

    noNewErrors(base, '12 correio');
  });

  // 13 ----------------------------------------------------------------------
  test('13) legal-apoio — pedido, registar notificação (data fixa), 2 prazos SinOA no legal-prazos', async () => {
    const base = pageErrors.length;

    await page.goto(`${legalAppUrl('legal-apoio')}novo`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('novo-pedido-page')).toBeVisible({ timeout: 20_000 });
    await selectByValue(page, 'apoio-cliente', S.clienteId);
    await page.getByTestId('apoio-tipo').selectOption('proteccao_juridica');
    await page.getByTestId('apoio-data').fill(ymd(0));
    // bind to this matter's processo so the SinOA prazos FK-link to it
    await selectByValue(page, 'apoio-processo', S.processoId);
    await page.getByTestId('apoio-criar').click();
    await expect(page).toHaveURL(/\/pedido\/[^/]+$/, { timeout: 15_000 });
    S.pedidoId = page.url().match(/\/pedido\/([^/?#]+)/)?.[1] ?? '';
    expect(S.pedidoId, 'pedido id from URL').toBeTruthy();
    await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 15_000 });

    // registar a notificação with a FIXED date (a Monday outside férias) → deterministic SinOA prazos
    await page.getByTestId('apoio-notif-data').fill('2026-09-07');
    await page.getByTestId('apoio-notif-registar').click();
    await expect(page.getByTestId('apoio-prazo-datalimite-0')).toHaveText('2026-09-14', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('apoio-prazo-datalimite-1')).toHaveText('2026-10-07');
    await expect(page.getByTestId('apoio-prazo-desc-0')).toHaveText(
      'SinOA: registo do pedido (5 dias úteis)',
    );
    await expect(page.getByTestId('apoio-prazo-desc-1')).toHaveText('SinOA: documentação (30 dias)');

    // the two SinOA prazos persisted (origem apoio, linked to the matter)
    const sinoa = (await spineList(page, 'prazos')).filter(
      (p) => p.origem === 'apoio' && p.processoId === S.processoId,
    );
    expect(sinoa).toHaveLength(2);

    // and they surface in the legal-prazos LIST (the fixed Sep/Oct dates fall
    // outside the radar's 30-day band by design, so the Todos-os-prazos list is
    // where they deterministically land — this is the apoio→prazos seam).
    await page.goto(`${legalAppUrl('legal-prazos')}prazos`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('prazos-list-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('prazos-search').fill('SinOA');
    await expect(
      page.getByText('SinOA: registo do pedido (5 dias úteis)', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('SinOA: documentação (30 dias)', { exact: false }).first(),
    ).toBeVisible();

    noNewErrors(base, '13 apoio');
  });

  // 14 ----------------------------------------------------------------------
  test('14) legal-nucleo — dashboard sem erros; o sino tem notificações da jornada', async () => {
    const base = pageErrors.length;

    await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 20_000 });

    // the journey left notificações on the shared spine (tempos transfer, honorários
    // emit, correio comprovativo, apoio notificação, ...)
    const journeyNotifs = await page.evaluate(
      async ({ pid, cid, tag }) => {
        const s = (window as unknown as EkoaWindow).__ekoa.shared;
        const list = await s.list('notificacoes');
        return list.filter(
          (n) =>
            n.processoId === pid ||
            (typeof n.corpo === 'string' && n.corpo.includes(tag)) ||
            (typeof n.titulo === 'string' && n.titulo.includes(tag)) ||
            (typeof n.href === 'string' && (n.href.includes(pid) || n.href.includes(cid))),
        ).length;
      },
      { pid: S.processoId, cid: S.clienteId, tag: TAG },
    );
    expect(journeyNotifs, 'the journey should have left notificações on the spine').toBeGreaterThan(0);

    // and the bell surfaces them (read-only; we do NOT mark-all-read so other
    // notifications' lida state is untouched)
    await page.getByTestId('bell').click();
    await expect(page.getByTestId('bell-menu')).toBeVisible();
    expect(await page.getByTestId('bell-item').count()).toBeGreaterThanOrEqual(1);

    noNewErrors(base, '14 final');
  });
});

/* `has` is used inside both the top-level steps and the cleanup closure. */
function has(v: unknown): boolean {
  return typeof v === 'string' && v.includes(TAG);
}
