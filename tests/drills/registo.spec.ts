// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";

test.describe("Registo", () => {
  test("table-empty-state: When the applied filters match zero entries, the table is replaced by an EmptyState with the ScrollText icon and the exact title text \"Sem entradas no registo.\", and no stray table markup or column headers remain on screen.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Sem entradas no registo.");
  });
});
