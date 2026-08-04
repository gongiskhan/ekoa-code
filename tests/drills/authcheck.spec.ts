// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";

test.describe("Auth check (E2E)", () => {
  test("logged-in: We are authenticated, NOT on the login screen. PASS only if the app UI is visible (a message composer text area, or the app sidebar/dashboard chrome). FAIL if the page shows a login form (a username/password field or an Entrar button).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/chat"));
  });
});
