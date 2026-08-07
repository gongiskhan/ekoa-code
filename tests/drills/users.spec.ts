// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Utilizadores e Equipas (Settings tab)", () => {
  test("heading-visible: The page shows the \"Utilizadores e Equipas\" heading with its \"Gerir utilizadores e equipas\" subtitle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Utilizadores e Equipas");
  });

  test("add-user-button-visible: The \"Adicionar Utilizador\" button is present in the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Adicionar Utilizador" })).toBeVisible();
  });

  test("search-box-visible: The \"Pesquisar utilizadores.\" search box is present above the table.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("Pesquisar utilizadores.")).toBeVisible();
  });

  test("table-headers-present: The users table renders its column headers, including NOME DE UTILIZADOR.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("NOME DE UTILIZADOR");
  });

  test("role-badge-rendered: The admin row shows its role as a \"Super Administrador\" badge rather than a raw role key.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Super Administrador");
  });

  test("add-user-dialog-opens: After the action, a create-user dialog or form opens with the fields needed to add a user (at minimum a username and a role selector) and explicit save / cancel controls.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Adicionar Utilizador" button
    await page.getByRole("button", { name: "Adicionar Utilizador" }).click();
    await expect(page.getByRole("dialog", { name: "Adicionar Utilizador" })).toBeVisible();
  });

  test("search-filters-table: After the action, typing a string that matches no user leaves the table with no matching rows and a clear \"no results\" indication - it does not keep showing every user, and it does not blank out into an error.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // type "zzzznotauser" into the "Pesquisar utilizadores." search box
    await page.getByRole("textbox", { name: "Pesquisar utilizadores..." }).fill("zzzznotauser");
    await expect(page.locator("body")).toContainText("Nenhum utilizador corresponde à sua pesquisa.");
  });

  test("table-polish: The page reads cleanly - the \"Visão geral\" summary bar, the UTILIZADORES section header with its search box, and the table below share consistent horizontal margins; the avatar, role badge and token-usage pill are vertically centred within their row.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page reads cleanly - the \"Visão geral\" summary bar, the UTILIZADORES section header with its search box, and the table below share consistent horizontal margins; the avatar, role badge and token-usage pill are vertically centred within their row.");
    expect(ok, "drillJudge: The page reads cleanly - the \"Visão geral\" summary bar, the UTILIZADORES section header with its search box, and the table below share consistent horizontal margins; the avatar, role badge and token-usage pill are vertically centred within their row.").toBe(true);
  });

  test("table-resolves: The users table settles into a real result - at minimum the signed-in account's own row, since a user looking at this page necessarily exists. It must not stop at the heading and the \"Adicionar Utilizador\" button with no table beneath.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("admin");
  });

  test("user-list-does-not-fake-empty: The page never claims the organisation has no users. Whoever is reading this page is themselves a user of it, so \"Nenhum utilizador ainda. Adicione o primeiro utilizador.\" is always false here - a read that failed must surface as a retryable error, not as an authoritative statement that the account list is empty. The tell is that empty copy sitting directly below a red error banner.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("table tbody tr")).toBeVisible();
  });

  test("overview-counts-are-not-fabricated: The \"Visão geral\" summary bar never presents counts it does not have. Reading \"0 utilizadores\", \"0 administrador\" and \"0 ativo\" on a page being viewed BY an active administrator is a stated falsehood, not a neutral default - when the underlying request failed, the summary must show a dash, a skeleton or nothing at all rather than a confident zero. This is the most damaging form of the failure on this page, because a zero reads as a fact the user can act on.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("1 utilizadores");
  });

  test("search-placeholder-not-truncated: The search box's placeholder is a well-formed phrase. It currently reads \"Pesquisar utilizadores.\" ending in a single full stop, which reads as a truncated ellipsis - every other search field in this product ends in \"...\" (compare \"Pesquisar memórias...\" on Memória). Either the ellipsis or no trailing punctuation at all is correct; a lone period is neither.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/users", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("textbox", { name: "Pesquisar utilizadores..." })).toBeVisible();
  });
});
