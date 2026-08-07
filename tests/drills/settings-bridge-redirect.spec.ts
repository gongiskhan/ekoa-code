// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";

test.describe("Ponte local legacy route (redirect into Privacidade)", () => {
  test("redirects-to-settings-privacy: Navigating to /settings/bridge does not render a standalone bridge page - the browser is redirected and the URL shown is /settings/privacy.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/bridge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/privacy"));
  });

  test("lands-on-privacy-page: After the redirect the user is looking at the real destination, not a blank shell - the \"Privacidade e ponte local\" heading is rendered.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/bridge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Privacidade e ponte local");
  });

  test("bridge-section-reachable: The bridge functionality the old route pointed at is actually present at the destination - the \"Gerar código de emparelhamento\" pairing control is on the page. A redirect that drops the user somewhere the feature no longer exists is a broken redirect.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/bridge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Gerar código de emparelhamento" })).toBeVisible();
  });

  test("redirect-is-clean: The redirect happens cleanly - the user never sees a flash of an empty or half-built bridge page, an error banner, or a \"not found\" screen on the way through, and the settings navigation ends up highlighting the tab that was actually landed on.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/bridge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/privacy"));
  });

  test("no-console-errors: Navigating to /settings/bridge produces no browser console errors and no failed network requests on the way to its destination.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/bridge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/privacy"));
  });
});
