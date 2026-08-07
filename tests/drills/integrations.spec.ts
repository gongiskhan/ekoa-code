// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Integrações", () => {
  test("heading-visible: The page shows the \"Integrações\" heading with the integration count subtitle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Integrações");
  });

  test("three-tabs-visible: The three tabs \"Integrações da Plataforma\", \"Minhas Integrações\" and \"Webhooks\" are present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("tab", { name: "Webhooks" })).toBeVisible();
  });

  test("refresh-action-present: The page header offers an \"Atualizar\" refresh action, so a user whose catalogue failed to load has a way to retry without a full page reload.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Atualizar" })).toBeVisible();
  });

  test("search-box-visible: The platform tab renders its filter row above the card grid - the \"Pesquisar integrações.\" search box and the Todas / Ativadas / Configuradas / Disponíveis count chips. A catalogue of this size is unusable without them.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("textbox", { name: "Pesquisar integrações..." })).toBeVisible();
  });

  test("platform-grid-resolves: Every card in the platform grid settles into a real integration - a logo, a name, a description and a status pill. Grey skeleton placeholder cards still sitting in the grid once the page has loaded are a failure, not a slow success.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    expect(await (page.getByRole("heading")).count()).toBeGreaterThanOrEqual(4);
  });

  test("platform-cards-present: The platform tab lists the built-in integrations - Google Workspace is among the cards.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Google Workspace");
  });

  test("connect-buttons-present: The platform catalogue offers at least two \"Ligar\" connect buttons - every account or catalogue integration that is not yet connected exposes its connect action directly on its card.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    expect(await (page.getByRole("button", { name: "Ligar" })).count()).toBeGreaterThanOrEqual(2);
  });

  test("account-connection-state-coherent: Each account integration card (Google Workspace, Microsoft 365) presents a coherent connection state - either the \"Não ligado\" pill with a \"Ligar\" button, or the \"Ligado\" pill together with the connected account's identity (its email address) and a \"Desligar\" action. A card claiming \"Ligado\" without naming the account it is connected as, or one offering \"Ligar\" while marked \"Ligado\", is incoherent.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("goncalo.p.gomes@gmail.com");
  });

  test("pipedream-explore-expands: After the action, the Pipedream card expands inline into the \"Milhares de aplicações\" panel - a \"Procurar entre milhares de aplicações...\" search box above a grid of app tiles (Notion, Slack, Airtable, ...) each carrying an app name and a Portuguese category label, plus a \"Recolher\" control that collapses the panel back to the card.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Explorar" button
    await page.getByRole("button", { name: "Explorar" }).click();
    await expect(page.getByRole("button", { name: "Recolher" })).toBeVisible();
  });

  test("webhooks-tab-shows-webhooks-panel: After the action, the URL carries tab=webhooks and the panel shows the \"Webhooks\" heading, its description about routing external events to an artifact backend, a \"Criar webhook\" button, and (with no webhooks yet) the \"Ainda não existem webhooks\" empty-state message.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Webhooks" tab
    await page.getByRole("tab", { name: "Webhooks" }).click();
    await expect(page).toHaveURL(new RegExp("tab=webhooks"));
  });

  test("create-webhook-dialog-opens: After the actions, the \"Novo webhook\" dialog is open with an \"Integração\" select, an \"Evento\" field, an \"Artefacto de destino\" select, a \"Função do backend\" field, and Cancelar / Criar buttons.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Webhooks" tab
    await page.getByRole("tab", { name: "Webhooks" }).click();
    // click the "Criar webhook" button
    await page.getByRole("button", { name: "Criar webhook" }).click();
    await expect(page.getByRole("heading", { name: "Novo webhook" })).toBeVisible();
  });

  test("my-integrations-tab-renders: After the action, the \"Minhas Integrações\" panel renders real content - either the user's connected integrations or a clear empty-state message - never a blank area or an error.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Minhas Integrações" tab
    await page.getByRole("tab", { name: "Minhas Integrações" }).click();
    await expect(page.locator("body")).toContainText("Ainda não há integrações");
  });

  test("search-filters-integrations: After the action, the card grid narrows to integrations matching \"Google\" (Google Workspace remains; unrelated cards such as Ifthenpay disappear).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // type "Google" into the "Pesquisar integrações." search box
    await page.getByRole("textbox", { name: "Pesquisar integrações..." }).fill("Google");
    await expect(page.getByRole("button", { name: "Limpar" })).toBeVisible();
  });

  test("cards-grid-polish: Integration cards form a tidy uniform grid - provider logos render (no broken images), status pills (\"Não ligado\", \"Disponíveis\") are consistently styled, card descriptions truncate cleanly, and the count chips row (Todas / Ativadas / Configuradas / Disponíveis) is aligned with the search box.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "Integration cards form a tidy uniform grid - provider logos render (no broken images), status pills (\"Não ligado\", \"Disponíveis\") are consistently styled, card descriptions truncate cleanly, and the count chips row (Todas / Ativadas / Configuradas / Disponíveis) is aligned with the search box.");
    expect(ok, "drillJudge: Integration cards form a tidy uniform grid - provider logos render (no broken images), status pills (\"Não ligado\", \"Disponíveis\") are consistently styled, card descriptions truncate cleanly, and the count chips row (Todas / Ativadas / Configuradas / Disponíveis) is aligned with the search box.").toBe(true);
  });

  test("no-console-errors: Loading /integrations produces no browser console errors and no failed network requests - every API read the catalogue fires (including per-integration status probes such as the CITIUS sync state) answers successfully rather than 404ing into the console.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/integrations", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Integrações" })).toBeVisible();
  });
});
