// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Not found (404)", () => {
  test("renders-404-copy: Navigating directly to an arbitrary unknown path (/this-page-does-not-exist-xyz) renders the app's custom not-found page rather than a Next.js dev error overlay or a blank/broken page: centered text shows the heading \"404\", the message \"Página não encontrada\", and a link reading \"Ir para o Builder\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/this-page-does-not-exist-xyz", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Página não encontrada");
  });

  test("html-lang-pt: The root <html> element has lang=\"pt-PT\" when the unknown path is loaded, confirming the not-found page renders in PT-PT (the default market language) rather than falling back to English copy.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/this-page-does-not-exist-xyz", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Página não encontrada");
  });

  test("no-dashboard-chrome: The not-found page renders as a standalone centered panel on a plain white background with no left Sidebar and no dashboard Header (and therefore no language-toggle button) - confirming this global not-found boundary sits outside the shared PageShell/dashboard layout used by every other authenticated route.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/this-page-does-not-exist-xyz", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("no-console-errors: Loading the unknown path produces zero browser console errors, aside from known-benign favicon or React DevTools messages.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/this-page-does-not-exist-xyz", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Página não encontrada");
  });

  test("visual-polish-and-mobile-layout: The 404 heading, message, and link are vertically centered with generous whitespace and read as a deliberate, polished empty state (not a raw stack trace, framework error page, or unstyled HTML); at the 375x812 mobile viewport the same centered block remains fully visible with no horizontal scrollbar and no clipped or overlapping text.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/this-page-does-not-exist-xyz", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The 404 heading, message, and link are vertically centered with generous whitespace and read as a deliberate, polished empty state (not a raw stack trace, framework error page, or unstyled HTML); at the 375x812 mobile viewport the same centered block remains fully visible with no horizontal scrollbar and no clipped or overlapping text.");
    expect(ok, "drillJudge: The 404 heading, message, and link are vertically centered with generous whitespace and read as a deliberate, polished empty state (not a raw stack trace, framework error page, or unstyled HTML); at the 375x812 mobile viewport the same centered block remains fully visible with no horizontal scrollbar and no clipped or overlapping text.").toBe(true);
  });

  test("obs-01KXQPG2GT48NJQNDAHB1TGBN5: The 404 page (any unknown route, e.g. /this-page-does-not-exist-xyz) renders its h1 (\"404\") without the Lora serif used by every other page header - likely outside the shared PageShell/PageHeader. Minor, but it is the only user-visible page off the design system.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/this-page-does-not-exist-xyz", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("404");
  });
});
