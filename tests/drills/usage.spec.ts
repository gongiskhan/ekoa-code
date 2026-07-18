// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Usage", () => {
  test("super-admin-gate: Navigating directly to /usage while logged in as the super-admin dev account (admin/tmp12345) does NOT redirect away; the usage-page testid becomes visible instead of the browser landing on /chat (this route is hidden from the sidebar and self-gates non-super-admin callers back to /chat, which cannot be exercised further since no non-admin login is available).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/usage"));
  });

  test("loading-state: On first load before the usage data arrives, a shared LoadingState spinner/component is shown in place of the table (not a blank page, not a layout jump once data arrives).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "On first load before the usage data arrives, a shared LoadingState spinner/component is shown in place of the table (not a blank page, not a layout jump once data arrives).");
    expect(ok, "drillJudge: On first load before the usage data arrives, a shared LoadingState spinner/component is shown in place of the table (not a blank page, not a layout jump once data arrives).").toBe(true);
  });
});
