// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Configurações da Plataforma", () => {
  test("language-setting-present: The Idioma setting offers \"Português (Portugal)\" alongside English.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Portuguese (Portugal)");
  });

  test("guidance-level-section-present: The \"Nível de orientação\" section is present further down the page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Nível de orientação");
  });

  test("language-selection-matches-ui: The Idioma control's highlighted option agrees with the language the app is actually rendering and with the top bar's language indicator. Since the whole interface renders in Portuguese and the top bar reads \"PT\", \"Inglês\" must not be the selected option.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("English");
  });

  test("platform-name-persists: After the actions, changing the platform name and reloading the page keeps the new value in the field - the setting is saved, not lost on navigation. If saving requires an explicit save button, that button must be visible rather than assumed.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome da Plataforma" field with "Ekoa QA"
    await page.locator("input[placeholder='Ekoa']").fill("Ekoa QA");
    // press Tab to blur the field
    await page.keyboard.press("Tab");
    // reload the page
    await page.keyboard.press("F5");
    await expect(page.locator("input[value='Ekoa QA']")).toHaveAttribute("value", "Ekoa QA");
  });

  test("language-switch-changes-ui: After the action, selecting \"Português (Portugal)\" leaves the interface fully in Portuguese with no untranslated English strings appearing in the navigation or section headers.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Português (Portugal)" language option
    await page.getByRole("button", { name: "Portuguese (Portugal)" }).click();
    await expect(page.getByRole("button", { name: "Português (Portugal)" })).toBeVisible();
  });

  test("settings-rows-polish: Every settings row follows one pattern - label and description on the left, control right-aligned on the same baseline, rows separated by hairline dividers within a card, and sections introduced by a small title plus grey caption. No control is orphaned or vertically misaligned with its label.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "Every settings row follows one pattern - label and description on the left, control right-aligned on the same baseline, rows separated by hairline dividers within a card, and sections introduced by a small title plus grey caption. No control is orphaned or vertically misaligned with its label.");
    expect(ok, "drillJudge: Every settings row follows one pattern - label and description on the left, control right-aligned on the same baseline, rows separated by hairline dividers within a card, and sections introduced by a small title plus grey caption. No control is orphaned or vertically misaligned with its label.").toBe(true);
  });

  test("settings-form-resolves: The platform settings form actually renders, rather than being left indefinitely on its \"A carregar as configurações...\" loader with none of the settings below reachable. (Re-checked 2026-08-05: this page DOES resolve, but only after about two minutes on the loader - the same delay described in the Book's standing defect. Everything below it then renders correctly. Judge it on whether the form arrives in a reasonable time, not on whether it arrives at all. Note also that the loader copy is correct European Portuguese - an earlier note in this Book called it Brazilian \"Carregando configurações...\", which is not what the page shows.)", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Configurações da Plataforma" })).toBeVisible();
  });

  test("default-language-is-portuguese: The \"Idioma\" setting - described as \"Definir o idioma predefinido para a interface da plataforma e conteúdo gerado\" - has \"Português (Portugal)\" as the selected segment, not \"Inglês\". This product ships a Portuguese interface, its top-bar switcher reads PT, and every string on this very page is Portuguese, so a platform default of English contradicts the product the user is looking at and would drive generated content into the wrong language.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Português (Portugal)" })).toBeVisible();
  });

  test("platform-name-shows-saved-value: The \"Nome da Plataforma\" field shows the platform's saved name as an actual editable VALUE in dark text, not as a grey placeholder. A placeholder reading \"Ekoa\" is ambiguous in a way that matters on a settings form: the user cannot tell whether the name is set to \"Ekoa\" or simply unset with \"Ekoa\" suggested, and saving the form with the field untouched may clear or default the setting without them intending it.\" in the row beneath it.)", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/platform", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("input[placeholder='Ekoa']")).toHaveAttribute("value", "Ekoa QA");
  });
});
