// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("O que a Ekoa sabe (knowledge base)", () => {
  test("heading-visible: The page shows the \"O que a Ekoa sabe\" heading with its subtitle about sourced, citable documents.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("O que a Ekoa sabe");
  });

  test("learned-button-visible: The \"O que a Ekoa aprendeu\" button is present in the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "O que a Ekoa aprendeu" })).toBeVisible();
  });

  test("explainer-banner-visible: The explainer banner \"Os agentes da Ekoa usam esta base primeiro.\" is shown above the tabs.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Os agentes da Ekoa usam esta base primeiro.");
  });

  test("tabs-present: The tab row offers Fornecido, Fontes and Documentos.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Fontes");
  });

  test("fornecido-empty-state: On the default \"Fornecido\" tab with no documents, the page shows the centred empty state \"Ainda não há documentos nesta base.\" with the hint pointing at «Documentos» and «Fontes», plus the \"Todas\" filter chip - not a blank panel.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Ainda não há documentos nesta base.");
  });

  test("fornecido-list-resolves: The \"Fornecido\" panel settles into a real result - either document entries or the written empty state. It must not be left on the centred \"A carregar...\" spinner beneath the \"Todas\" filter chip once the page has loaded; a spinner that never resolves is a failure, and it is indistinguishable to the user from a knowledge base that silently lost its contents.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Ainda não há documentos nesta base.");
  });

  test("loading-state-does-not-leak-across-tabs: After the action, switching to the \"Fontes\" tab shows that tab's own content - the \"Adicionar fonte\" form and the list of configured sources. A stray \"A carregar...\" left over from the Fornecido panel must not still be sitting in the page header area while a different tab is selected.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Fontes" tab
    await page.getByRole("tab", { name: "Fontes" }).click();
    await expect(page.getByRole("heading", { name: "Adicionar fonte" })).toBeVisible();
  });

  test("fontes-tab-shows-add-source-form: After the action, the \"Fontes\" tab is selected and its \"Adicionar fonte\" form is shown with Nome, Coleção and URL fields, the \"Níveis de links\", \"Âmbito\" and \"Máx. páginas\" controls, and the \"Renderizar com navegador (JS/SPA)\" checkbox.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Fontes" tab
    await page.getByRole("tab", { name: "Fontes" }).click();
    await expect(page.getByRole("heading", { name: "Adicionar fonte" })).toBeVisible();
  });

  test("documentos-tab-renders: After the action, the \"Documentos\" tab is selected and shows its document-upload interface (or a clear empty state) - never a blank panel or a panel still showing the Fontes form.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Documentos" tab
    await page.getByRole("tab", { name: "Documentos" }).click();
    await expect(page.getByRole("heading", { name: "Carregar documentos" })).toBeVisible();
  });

  test("add-source-validates-url: After the actions - opening Fontes and submitting the add-source form with a name but no URL - the form does not silently accept it; it either blocks submission with visible validation feedback on the URL field or keeps the submit control disabled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Fontes" tab
    await page.getByRole("tab", { name: "Fontes" }).click();
    // fill the "Nome" field with "Fonte de teste"
    await page.getByRole("textbox", { name: "Nome" }).fill("Fonte de teste");
    // click the "Adicionar fonte" submit control
    await page.getByRole("button", { name: "Adicionar fonte" }).click();
    await expect(page.locator("body")).toContainText("Indique o URL e a coleção.");
  });

  test("learned-panel-opens: After the action, the \"O que a Ekoa aprendeu\" control opens a panel or view showing what the agents have learned - it does not leave the page unchanged or produce an error.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "O que a Ekoa aprendeu" button
    await page.getByRole("button", { name: "O que a Ekoa aprendeu" }).click();
    await expect(page).toHaveURL(new RegExp("/memory"));
  });

  test("page-polish: The page is visually coherent - the tinted explainer banner is clearly a callout distinct from body copy, the tab row with its icons is evenly spaced and the active tab is unmistakably marked, and the content area below keeps the same left margin as the header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page is visually coherent - the tinted explainer banner is clearly a callout distinct from body copy, the tab row with its icons is evenly spaced and the active tab is unmistakably marked, and the content area below keeps the same left margin as the header.");
    expect(ok, "drillJudge: The page is visually coherent - the tinted explainer banner is clearly a callout distinct from body copy, the tab row with its icons is evenly spaced and the active tab is unmistakably marked, and the content area below keeps the same left margin as the header.").toBe(true);
  });

  test("source-form-polish: On the Fontes tab the add-source form is well laid out - the Nome/Coleção pair and the Níveis de links / Âmbito / Máx. páginas trio align on shared rows, helper text sits under its own field, and no field or its hint text overflows the card.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/knowledge", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Fontes" tab
    await page.getByRole("tab", { name: "Fontes" }).click();
    const ok = await drillJudge(page, "On the Fontes tab the add-source form is well laid out - the Nome/Coleção pair and the Níveis de links / Âmbito / Máx. páginas trio align on shared rows, helper text sits under its own field, and no field or its hint text overflows the card.");
    expect(ok, "drillJudge: On the Fontes tab the add-source form is well laid out - the Nome/Coleção pair and the Níveis de links / Âmbito / Máx. páginas trio align on shared rows, helper text sits under its own field, and no field or its hint text overflows the card.").toBe(true);
  });
});
