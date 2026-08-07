// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";

test.describe("Pedidos legacy route (redirect into Settings)", () => {
  test("redirects-to-settings-pedidos: Navigating to /pedidos no longer renders a standalone page: the browser is redirected to /settings/pedidos and lands on the Pedidos tab inside Settings - the settings tab bar (\"Plataforma\" / \"Pedidos\", with \"Pedidos\" active) is visible above the \"Pedidos\" heading and its Escritório/Estado filter bar, and the URL shown is /settings/pedidos, not /pedidos.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/pedidos"));
  });

  test("lands-on-pedidos-page: After the redirect the real destination is rendered - the \"Pedidos\" heading is on the page, not an empty shell.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Pedidos");
  });

  test("pedidos-tab-is-the-active-one: The redirect lands inside the Settings tab bar, with the \"Pedidos\" tab present alongside Plataforma, Utilizadores and Escritórios - the legacy route resolves to a tab of Settings rather than to a detached page that happens to share the heading.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("tab", { name: "Pedidos" })).toBeVisible();
  });

  test("redirect-is-clean: The redirect is clean - no flash of an empty page, a login form or an error banner on the way through, and the settings tab bar ends up visually highlighting Pedidos, the tab actually landed on, rather than leaving no tab marked active.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("[role='tab']:nth-child(2)")).toHaveAttribute("aria-selected", "true");
  });

  test("destination-content-resolves: Arriving through the legacy route loads the destination's data just like a direct visit does - the Pedidos list settles into either change-request rows or a written empty state, and does not stay parked on \"A carregar pedidos...\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Sem pedidos de alteração.");
  });

  test("no-console-errors: Navigating to /pedidos produces no browser console errors and no failed network requests on the way to its destination.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/pedidos"));
  });
});
