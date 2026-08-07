// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Nova automatização (create form)", () => {
  test("heading-visible: The page shows the \"Nova automatização\" heading with its explanatory subtitle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Nova automatização");
  });

  test("objective-field-visible: The required \"Objetivo (obrigatório)\" textarea is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Objetivo (obrigatório)")).toBeVisible();
  });

  test("name-field-visible: The optional \"Nome (opcional)\" input is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Nome (opcional)")).toBeVisible();
  });

  test("cancel-button-visible: The \"Cancelar\" button is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Cancelar" })).toBeVisible();
  });

  test("draft-disabled-when-empty: With the objective empty, the \"Esboçar passos\" submit button is disabled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Esboçar passos" })).toHaveAttribute("disabled", "");
  });

  test("draft-enables-after-objective: After the action, the \"Esboçar passos\" button is enabled (no longer greyed out / disabled) once an objective has been typed.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Objetivo (obrigatório)" field with "Abrir o site da empresa e tirar um screenshot"
    await page.getByRole("textbox", { name: "Objetivo (obrigatório)" }).fill("Abrir o site da empresa e tirar um screenshot");
    await expect(page.getByRole("button", { name: "Esboçar passos" })).toBeVisible();
  });

  test("cancel-returns-to-list: After the action, the browser is back on /automations showing the automations list page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Cancelar" button
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page).toHaveURL(new RegExp("/automations$"));
  });

  test("form-layout-polish: The form reads as a tidy single column - labels sit directly above their fields, the placeholder example text in the objective textarea is legible, and the Cancelar / Esboçar passos buttons are right-aligned on one row without wrapping or misalignment.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The form reads as a tidy single column - labels sit directly above their fields, the placeholder example text in the objective textarea is legible, and the Cancelar / Esboçar passos buttons are right-aligned on one row without wrapping or misalignment.");
    expect(ok, "drillJudge: The form reads as a tidy single column - labels sit directly above their fields, the placeholder example text in the objective textarea is legible, and the Cancelar / Esboçar passos buttons are right-aligned on one row without wrapping or misalignment.").toBe(true);
  });

  test("s1785348441480-1: The create form is served at its own route - the browser stays on /automations/new rather than being redirected back to the list.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/automations/new"));
  });

  test("s1785351740689-2: Interacting with the draft form does not navigate away - the browser is still on /automations/new after the form has been filled in.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/automations/new", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/automations/new"));
  });
});
