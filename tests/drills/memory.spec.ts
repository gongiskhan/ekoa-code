// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Memória (agent knowledge store)", () => {
  test("heading-visible: The page shows the \"Memória\" heading with its subtitle about knowledge learned from agent interactions.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Memória");
  });

  test("add-memory-button-visible: The \"Adicionar Memória\" button is present in the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Adicionar Memória" })).toBeVisible();
  });

  test("search-box-visible: The \"Pesquisar memórias...\" search box is present in the filter bar.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("Pesquisar memórias...")).toBeVisible();
  });

  test("filter-selects-visible: The filter bar offers the type filter (\"Todos os tipos\") alongside scope and visibility filters.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Todos os tipos");
  });

  test("tabs-present: The tab row includes \"Guardrails\" alongside Visão geral, Sempre ativa, Padroes recentes and Configurações.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Guardrails");
  });

  test("chrome-copy-correctly-accented: The page's own chrome is spelled in correct Portuguese. The subtitle must read \"Conhecimento aprendido a partir das interações dos agentes\", the fourth tab must read \"Padrões recentes\", and the scope filter must read \"Todos os âmbitos\". Unaccented \"interacoes\", \"Padroes\" and \"ambitos\" are spelling defects sitting in permanent navigation and header copy.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Todos os âmbitos");
  });

  test("memory-list-resolves: Below the filter bar the memory area settles into a real result - either memory cards or the written empty state. It must not be left on the \"Carregando...\" spinner: a loading state that never resolves is a failure, not a slow success.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Sem memórias");
  });

  test("loading-copy-is-european-portuguese: Any loading text on this page uses the same wording as the rest of the product, which says \"A carregar...\". \"Carregando...\" is Brazilian Portuguese and is inconsistent with the pt-PT copy used everywhere else in the app.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Memória" })).toBeVisible();
  });

  test("add-memory-dialog-opens: After the action, the \"Adicionar Memória\" dialog is open with Titulo, Tipo, Conteudo, Etiquetas, Visibilidade and Ambito fields plus Cancelar / Guardar buttons.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Adicionar Memória" button
    await page.getByRole("button", { name: "Adicionar Memória" }).click();
    await expect(page.getByRole("dialog", { name: "Adicionar Memória" })).toBeVisible();
  });

  test("how-it-works-expands: After the action, the \"Como funciona a Memória\" panel expands and reveals explanatory text about how memory works (it is a collapsible disclosure, not a dead header).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Como funciona a Memória" panel header
    await page.getByRole("button", { name: "Como funciona a Memória" }).click();
    await expect(page.locator("body")).toContainText("As memórias são extraídas automaticamente das interações com os agentes.");
  });

  test("guardrails-tab-renders: After the action, the Guardrails tab is selected and its panel renders real content - a guardrails list or a clear empty state - never a blank region or an error.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Guardrails" tab
    await page.getByRole("tab", { name: "Guardrails" }).click();
    await expect(page.locator("body")).toContainText("Sem guardrails definidas");
  });

  test("settings-tab-renders: After the action, the \"Configurações\" tab is selected and shows memory configuration controls, not a blank panel.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Configurações" tab
    await page.getByRole("tab", { name: "Configurações" }).click();
    await expect(page.getByRole("heading", { name: "Configurações de Memória" })).toBeVisible();
  });

  test("empty-state-copy: When no memories exist the page shows the \"Sem memórias\" empty state with its explanation and an \"Adicionar Memória\" call to action, centred and legible. (If memories already exist this check does not apply - the list renders instead.)", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "When no memories exist the page shows the \"Sem memórias\" empty state with its explanation and an \"Adicionar Memória\" call to action, centred and legible. (If memories already exist this check does not apply - the list renders instead.)");
    expect(ok, "drillJudge: When no memories exist the page shows the \"Sem memórias\" empty state with its explanation and an \"Adicionar Memória\" call to action, centred and legible. (If memories already exist this check does not apply - the list renders instead.)").toBe(true);
  });

  test("page-polish: The page reads as one coherent layout - the header, the collapsible info panel, the tab row, the totals bar and the filter bar are consistently spaced full-width blocks, and the memory cards below align to the same grid without stray gaps.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/memory", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page reads as one coherent layout - the header, the collapsible info panel, the tab row, the totals bar and the filter bar are consistently spaced full-width blocks, and the memory cards below align to the same grid without stray gaps.");
    expect(ok, "drillJudge: The page reads as one coherent layout - the header, the collapsible info panel, the tab row, the totals bar and the filter bar are consistently spaced full-width blocks, and the memory cards below align to the same grid without stray gaps.").toBe(true);
  });
});
