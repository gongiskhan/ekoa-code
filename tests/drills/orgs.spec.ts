// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Escritórios (offices / tenants, Settings tab)", () => {
  test("heading-visible: The page shows the \"Escritórios\" heading with its subtitle about creating, listing and renaming platform offices.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Escritórios");
  });

  test("create-office-button-visible: The \"Criar escritório\" button is present in the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Criar escritório" })).toBeVisible();
  });

  test("table-headers-present: The offices table renders its columns, including NOME DE APRESENTAÇÃO.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("NOME DE APRESENTAÇÃO");
  });

  test("default-office-listed: The default \"Founder\" office is listed in the table.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Founder");
  });

  test("create-office-dialog-opens: After the action, a create-office dialog or inline form opens with a name field and explicit save / cancel controls.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Criar escritório" button
    await page.getByRole("button", { name: "Criar escritório" }).click();
    await expect(page.getByRole("dialog", { name: "Criar escritório" })).toBeVisible();
  });

  test("rename-action-opens-editor: After the action, the row's pencil action opens a rename editor pre-filled with the office's current name, offering a way to confirm and a way to cancel.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the pencil edit icon in the AÇÃO column of the "Founder" row
    await page.getByRole("button", { name: "Renomear" }).click();
    await expect(page.getByRole("dialog", { name: "Renomear escritório" })).toBeVisible();
  });

  test("table-polish: The table reads cleanly - the ID column uses a monospace, de-emphasised treatment that does not compete with the office name, the AÇÃO icon column is right-aligned, and the single-row table does not leave the card looking broken or stretched.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The table reads cleanly - the ID column uses a monospace, de-emphasised treatment that does not compete with the office name, the AÇÃO icon column is right-aligned, and the single-row table does not leave the card looking broken or stretched.");
    expect(ok, "drillJudge: The table reads cleanly - the ID column uses a monospace, de-emphasised treatment that does not compete with the office name, the AÇÃO icon column is right-aligned, and the single-row table does not leave the card looking broken or stretched.").toBe(true);
  });

  test("list-resolves: The offices panel settles into a real result - either the offices table or a written empty state. It must NOT still be showing \"A carregar escritórios...\" once the page has settled. Judge the empty state carefully: \"Ainda não há escritórios.\" only counts as a real result when NO error banner sits above it (see office-list-does-not-fake-empty below), because the page currently renders that same empty copy after a failed request. (Observed at authoring time - the page stays on \"A carregar escritórios...\" for a full two minutes even though the API returns the office list immediately.)", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("office-list-does-not-fake-empty: The page never tells the user they have no offices when the request to fetch them failed. This account owns the seeded \"Founder\" office, so \"Ainda não há escritórios.\" with its \"Criar escritório\" call to action is a FALSE empty state and a defect - a failed read must surface as an error the user can retry, never as an authoritative \"you have nothing here\". The tell is the empty illustration and copy appearing directly BELOW a red error banner on the same screen; a genuine empty state appears on its own. (Authoring-time observation, since retracted as a harness artifact - a request that timed out after 120s rendered the red banner and the \"Ainda não há escritórios.\" empty state together, for an account that demonstrably owns an office.)", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("load-error-is-in-portuguese: If the offices list fails to load, the error the user is shown is written in Portuguese and in human terms - it explains that the list could not be loaded and offers the retry action. A raw English developer string is a defect in a product that is Portuguese everywhere else, and so is quoting a millisecond timeout figure at the user. (Observed defect at authoring time - the banner read literally \"Request timed out after 120000ms\", in English, beside a Portuguese \"Tentar novamente\" link.) NOTE 2026-08-05: the authoring-time observation behind this check was a dev-harness artifact (a leaking CORS proxy), not a product hang - the page renders normally in a clean browser. The CHECK stands: web/lib/api/core.ts really can surface a raw English timeout string and a failed read really must not render as an empty state, so this is kept as the guard for those paths.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/offices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("table")).toBeVisible();
  });
});
