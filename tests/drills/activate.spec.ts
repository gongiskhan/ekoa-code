// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Authorize this device (CLI device activation)", () => {
  test("heading-visible: The page shows the \"Autorizar este dispositivo\" heading explaining that Ekoa Local (the terminal) is asking to sign in to the account.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Autorizar este dispositivo");
  });

  test("missing-code-error-shown: Opening the page without a device code in the link shows the explicit error \"Nenhum código de dispositivo na ligação. Execute novamente o início de sessão a partir do seu terminal.\" rather than a blank or spinning page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Nenhum código de dispositivo na ligação. Execute novamente o início de sessão a partir do seu terminal.");
  });

  test("phishing-warning-present: The safety warning \"Apenas aprove se foi você que iniciou esta sessão. O código deve corresponder ao do seu terminal.\" is shown - this is the page's defence against a user approving someone else's device.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Apenas aprove se foi você que iniciou esta sessão. O código deve corresponder ao do seu terminal.");
  });

  test("no-approve-control-without-code: With no device code in the link, the page offers no approve action at all - there is no clickable \"Aprovar\"/\"Autorizar\" button that could authorise an unknown device.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  });

  test("page-language-matches-app: This page's copy is in the same language as the rest of the product. The whole app renders in Portuguese, so the page must read in Portuguese (\"Autorizar este dispositivo\", \"Nenhum código de dispositivo na ligação...\") - an entirely English page here is an untranslated-page failure.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Autorizar este dispositivo" })).toBeVisible();
  });

  test("card-polish: The dark centred card is well composed - the Ekoa mark above it, the terminal glyph, heading and explanation stack with even rhythm, the red error badge reads clearly against the dark surface without vibrating, and the footer caution line is legible rather than lost in the background.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The dark centred card is well composed - the Ekoa mark above it, the terminal glyph, heading and explanation stack with even rhythm, the red error badge reads clearly against the dark surface without vibrating, and the footer caution line is legible rather than lost in the background.");
    expect(ok, "drillJudge: The dark centred card is well composed - the Ekoa mark above it, the terminal glyph, heading and explanation stack with even rhythm, the red error badge reads clearly against the dark surface without vibrating, and the footer caution line is legible rather than lost in the background.").toBe(true);
  });
});
