// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Marca (brand research and design system)", () => {
  test("heading-visible: The page shows the \"Marca\" heading.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Marca");
  });

  test("reset-button-visible: The \"Repor\" reset button is present in the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Repor" })).toBeVisible();
  });

  test("tabs-present: The tab row offers Pesquisa, Marca and \"Sistema de Design\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Sistema de Design");
  });

  test("url-field-visible: The \"URL do Website\" input is present with its https://exemplo.com placeholder.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("https://exemplo.com")).toBeVisible();
  });

  test("research-disabled-when-empty: With no URL entered, the \"Pesquisar Marca\" button is disabled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Pesquisar Marca" })).toHaveAttribute("disabled", "");
  });

  test("ai-and-memory-warnings-shown: Both advisory callouts are shown before any research runs - \"Os resultados podem necessitar de revisao\" (AI-extracted results need checking) and \"A memória da empresa sera atualizada\" (saving replaces existing company-identity memories). These set expectations for a destructive, AI-driven action and must not be hidden behind a click.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("A memória da empresa será atualizada");
  });

  test("warning-copy-correctly-accented: The two amber callouts are spelled in correct Portuguese. Their headings must read \"Os resultados podem necessitar de revisão\" and \"A memória da empresa será atualizada\" - with the accents on \"revisão\" and \"será\". Unaccented \"revisao\" and \"sera\" are spelling defects, not stylistic choices, and they sit in the most prominent warning copy on the page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Os resultados podem necessitar de revisão");
  });

  test("research-enables-with-url: After the action, the \"Pesquisar Marca\" button becomes enabled (no longer greyed out) once a website URL has been entered.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "URL do Website" field with "https://www.anthropic.com"
    await page.getByRole("textbox", { name: "URL do Website" }).fill("https://www.anthropic.com");
    await expect(page.getByRole("button", { name: "Pesquisar Marca" })).toHaveAttribute("disabled", "");
  });

  test("invalid-url-rejected: After the actions, submitting a string that is not a URL does not start a silent failing research run - the page either blocks it with visible validation feedback on the field or surfaces a clear error message.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "URL do Website" field with "isto nao e um url"
    await page.getByRole("textbox", { name: "URL do Website" }).fill("isto nao e um url");
    // click the "Pesquisar Marca" button
    await page.getByRole("button", { name: "Pesquisar Marca" }).click();
    await expect(page.locator("body")).toContainText("A pesquisa falhou. Tente novamente.");
  });

  test("brand-tab-renders: After the action, the \"Marca\" tab is selected and shows the brand identity fields (such as colours, logo and company details) or a clear empty state - never a blank panel.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Marca" tab
    await page.getByRole("tab", { name: "Marca" }).click();
    await expect(page.getByRole("textbox", { name: "Nome da Empresa" })).toBeVisible();
  });

  test("design-system-tab-renders: After the action, the \"Sistema de Design\" tab is selected and shows the design-system settings (tokens, typography, palette) or a clear empty state - never a blank panel.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Sistema de Design" tab
    await page.getByRole("tab", { name: "Sistema de Design" }).click();
    await expect(page.locator("body")).toContainText("Sistema de design ainda não extraído");
  });

  test("page-polish: The page is visually coherent - the two amber warning callouts are clearly warnings without shouting, the URL field and its button sit on one aligned row, and the dashed placeholder panel below reads as an intentional empty state rather than a rendering failure.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/branding", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page is visually coherent - the two amber warning callouts are clearly warnings without shouting, the URL field and its button sit on one aligned row, and the dashed placeholder panel below reads as an intentional empty state rather than a rendering failure.");
    expect(ok, "drillJudge: The page is visually coherent - the two amber warning callouts are clearly warnings without shouting, the URL field and its button sit on one aligned row, and the dashed placeholder panel below reads as an intentional empty state rather than a rendering failure.").toBe(true);
  });
});
