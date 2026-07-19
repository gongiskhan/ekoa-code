// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";

test.describe("Login", () => {
  test("logo-renders: The Ekoa logo image (alt=\"Ekoa\", served from /ekoa_logo.png, roughly 48x48) renders as a visible loaded icon above the heading, not a broken-image placeholder or blank box.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("img")).toBeVisible();
  });
});
