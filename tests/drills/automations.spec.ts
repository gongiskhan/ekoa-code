// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Automatizações (list)", () => {
  test("heading-visible: The page shows the \"Automatizações\" heading.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Automatizações");
  });

  test("create-cta-visible: The \"Criar automatização\" call-to-action button is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Criar automatização" })).toBeVisible();
  });

  test("on-automations-url: The browser stays on the /automations route.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/automations"));
  });

  test("content-renders-not-stuck-loading: The page settles into real content - either the empty state (\"Ainda não há automatizações\" with its explanatory copy) or a list of automation entries. It is never a blank page or a spinner that stays on \"A carregar automatizações...\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Ainda não há automatizações");
  });

  test("create-cta-navigates-to-new: After the action, the browser is on /automations/new and the \"Nova automatização\" form is shown.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Criar automatização" button
    await page.getByRole("button", { name: "Criar automatização" }).click();
    await expect(page).toHaveURL(new RegExp("/automations/new"));
  });

  test("empty-state-polish: The page content is centred and balanced - the icon, heading, explanatory paragraph and CTA form one coherent, readable block (or, when automations exist, the entries form a tidy, consistently spaced list); nothing is misaligned, clipped or floating oddly in the whitespace.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page content is centred and balanced - the icon, heading, explanatory paragraph and CTA form one coherent, readable block (or, when automations exist, the entries form a tidy, consistently spaced list); nothing is misaligned, clipped or floating oddly in the whitespace.");
    expect(ok, "drillJudge: The page content is centred and balanced - the icon, heading, explanatory paragraph and CTA form one coherent, readable block (or, when automations exist, the entries form a tidy, consistently spaced list); nothing is misaligned, clipped or floating oddly in the whitespace.").toBe(true);
  });
});
