// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Automatização (detail, unknown id)", () => {
  test("stays-on-detail-route: Requesting an automation that does not exist keeps the browser on the automation detail route rather than silently bouncing to the list or to the app root - the user must be able to see which id failed and to copy or retry the URL.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/automations/00000000-0000-0000-0000-000000000000"));
  });

  test("shell-chrome-present: The error path stays inside the authenticated shell - the sidebar toggle is still there, so the user is never dumped onto a chrome-less dead end they can only escape with the back button.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Alternar barra lateral" })).toBeVisible();
  });

  test("user-menu-still-reachable: The top bar's user menu remains available on the error path, so the session is still operable from here.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Menu do utilizador" })).toBeVisible();
  });

  test("unknown-id-handled-gracefully: The page settles on a clear not-found or error message naming the problem in Portuguese - the automation does not exist or is not accessible. It must NOT be left on the \"A carregar...\" spinner: a request that has already come back 404 has finished, and continuing to show a loading state misrepresents a definite failure as work in progress.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Automatização não encontrada");
  });

  test("way-back-to-list: The not-found state offers an explicit route out - a link or button back to \"Automatizações\" - rather than relying on the user to find the sidebar icon or press the browser back button.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Voltar às automatizações" })).toBeVisible();
  });

  test("no-bare-fullscreen-spinner: Whatever this route shows, it keeps the app's page-header pattern - an icon tile, a title and a subtitle - so the user can tell which section they are in. A centred spinner filling the whole content area with no heading at all is a defect.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Automatizações" })).toBeVisible();
  });

  test("error-state-polish: The not-found state is composed rather than improvised - the message sits in the same card geometry and horizontal margins as the rest of the app, the tone is plain Portuguese without raw ids, stack traces or English fragments leaking through, and nothing about it looks like an unhandled crash.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/00000000-0000-0000-0000-000000000000", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The not-found state is composed rather than improvised - the message sits in the same card geometry and horizontal margins as the rest of the app, the tone is plain Portuguese without raw ids, stack traces or English fragments leaking through, and nothing about it looks like an unhandled crash.");
    expect(ok, "drillJudge: The not-found state is composed rather than improvised - the message sits in the same card geometry and horizontal margins as the rest of the app, the tone is plain Portuguese without raw ids, stack traces or English fragments leaking through, and nothing about it looks like an unhandled crash.").toBe(true);
  });
});
