import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Playwright global setup (ch13 §13.2 harness; test-audit §2.4). Seeds the legal
 * shared spine ONCE, before the 37-spec byte-compat suite, by opening the Núcleo -
 * exactly the product mechanism the spine contract fixes.
 *
 * Why (and why this is faithful): assets/legal-spine/contract.md fixes that ONLY the
 * Núcleo app seeds the shared spine, once, when empty; every satellite app (Prazos,
 * KYC, Apoio, Peças, ...) READS what the Núcleo wrote. The Núcleo's seed is broad and
 * FK-COHERENT - it creates clientes, then processos referencing THOSE clientes, then
 * pessoas / kyc_fichas / sessao_tipos / modelos / ... all chained off the ids it just
 * minted (frontend/src/shared.js `seedCollectionIfEmpty`). In the old system the
 * Núcleo was opened once and its seed persisted in the account's shared data, so the
 * satellite specs assume a populated spine. Our per-run harness boots a fresh
 * in-memory Mongo, so the spine starts empty.
 *
 * Opening the Núcleo in a real browser reproduces that precondition EXACTLY (the same
 * client-side seed the product runs), FK-coherently, for the whole suite - so the
 * satellite specs are order-independent without any assertion touched. A partial
 * server-side seed would be wrong: pre-writing `clientes` makes the Núcleo's
 * seed-when-empty skip that collection, which breaks the cascade that derives the
 * rest from the just-minted ids.
 */
function cortexBase(): string {
  try {
    const port = readFileSync(resolve(__dirname, '..', '..', 'backend.port'), 'utf-8').trim();
    if (port) return `http://127.0.0.1:${port}`;
  } catch {
    /* fall through */
  }
  return 'http://127.0.0.1:4111';
}

export default async function globalSetup(): Promise<void> {
  const base = cortexBase();

  // Wait for the api + the featured Núcleo build to be serving.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const h = await fetch(`${base}/health`);
      if (h.ok) {
        const app = await fetch(`${base}/apps/legal-nucleo/`);
        const html = await app.text();
        if (app.ok && html.includes('__EKOA_APP_ID') && !/Building/i.test(html)) break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // The Núcleo seeds clientes with a concurrent Promise.all; if that goes partial the
  // root collection is left non-empty with too few rows, and the app's seed-when-empty
  // then REUSES the partial ids forever (the one poison state its auto-recovery cannot
  // heal - recovery only refills the still-empty dependents). So global-setup drives a
  // clean, complete seed: open the Núcleo, wait; if clientes is short of the full 6,
  // wipe the spine and reload to re-trigger a fresh seed. Bounded retries; the app's
  // own dependent-recovery fills kyc_fichas/pessoas/... off the full clientes/processos.
  const EXPECTED_CLIENTES = 6;
  const readCounts = async (page: import('@playwright/test').Page) =>
    page.evaluate(async () => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<unknown[]> } } }).__ekoa?.shared;
      if (!s) return { clientes: -1, processos: -1, kyc_fichas: -1 };
      const [clientes, processos, fichas] = await Promise.all([s.list('clientes'), s.list('processos'), s.list('kyc_fichas')]);
      return { clientes: clientes.length, processos: processos.length, kyc_fichas: fichas.length };
    });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let counts = { clientes: 0, processos: 0, kyc_fichas: 0 };
    for (let attempt = 1; attempt <= 5; attempt++) {
      await page.goto(`${base}/apps/legal-nucleo/`, { waitUntil: 'domcontentloaded' });
      // Give the module-scope seed promise (+ Web Lock) time to run to completion.
      await page.waitForFunction(() => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared), undefined, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(6000);
      counts = await readCounts(page);
      if (counts.clientes >= EXPECTED_CLIENTES && counts.kyc_fichas > 0) break;
      // Partial/poisoned: wipe the spine roots so the next load re-seeds from empty.
      await page.evaluate(async () => {
        const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<{ id: string }>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa.shared;
        for (const coll of ['tarefas', 'lancamentos', 'eventos', 'documentos', 'prazos', 'kyc_fichas', 'pessoas', 'processos', 'clientes']) {
          const rows = await s.list(coll).catch(() => []);
          await Promise.all(rows.map((r) => s.delete(coll, r.id).catch(() => {})));
        }
      }).catch(() => {});
      console.warn(`[legal-spine] global-setup attempt ${attempt}: partial seed ${JSON.stringify(counts)} - wiped + retrying`);
    }
    console.log(`[legal-spine] global-setup seeded the spine via the Núcleo: ${JSON.stringify(counts)}`);
  } finally {
    await browser.close();
  }
}
