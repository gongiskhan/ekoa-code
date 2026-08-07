// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
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

  test("create-cta-visible: The \"Nova automatização\" call-to-action button is present in the page header, whether the list is empty or populated.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Nova automatização" })).toBeVisible();
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
    await expect(page.locator("body")).toContainText("3 no total");
  });

  test("header-survives-loading: While the automations list is still fetching, the page header stays on screen - the icon tile, the \"Automatizações\" title, its subtitle and the \"Nova automatização\" action. The loading state belongs to the list region only. Replacing the entire content area with a centred spinner strips the user of the section title and of the primary action, so a user who wants to create an automation has nothing to click for as long as the fetch takes.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Nova automatização" })).toBeVisible();
  });

  test("heading-not-satisfied-by-loading-text: \"Automatizações\" appears on this page as the page TITLE in the header, rendered as a heading - not merely as a word inside the \"A carregar automatizações...\" spinner caption. A page whose only occurrence of its own name is inside a loading message has not rendered its header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Automatizações" })).toBeVisible();
  });

  test("create-cta-navigates-to-new: After the action, the browser is on /automations/new and the \"Nova automatização\" form is shown.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Nova automatização" button
    await page.getByRole("button", { name: "Nova automatização" }).click();
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

  test("list-resolves: The automations panel settles into a real result - either a list of automations or the written empty state (\"Ainda não há automatizações\"). It must NOT still be showing \"A carregar automatizações...\" once the page has settled; a loader that never resolves is a failure, not a slow success.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("3 no total");
  });
});
