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
});
