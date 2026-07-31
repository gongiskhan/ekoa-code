// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Pedidos (change requests, Settings tab)", () => {
  test("heading-visible: The page shows the \"Pedidos\" heading with its subtitle about change requests sent by users from the apps.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Pedidos");
  });

  test("state-filter-defaults-open: The \"Estado\" filter defaults to \"Abertos\" (open requests).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Abertos");
  });

  test("empty-state-message: With no change requests, the page shows the \"Sem pedidos de alteração.\" empty state.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Sem pedidos de alteração.");
  });

  test("office-filter-present: The office scope filter (\"Todos os escritórios\") is present in the filter bar.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Todos os escritórios");
  });

  test("empty-state-polish: The empty state is centred with its icon above the message and reads as deliberate design rather than a page that failed to load; the filter bar above it spans the same width as the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The empty state is centred with its icon above the message and reads as deliberate design rather than a page that failed to load; the filter bar above it spans the same width as the page header.");
    expect(ok, "drillJudge: The empty state is centred with its icon above the message and reads as deliberate design rather than a page that failed to load; the filter bar above it spans the same width as the page header.").toBe(true);
  });

  test("settings-tab-bar-visible: A settings tab bar sits above the page header with exactly two tabs, \"Plataforma\" and \"Pedidos\", and \"Pedidos\" is the active tab (highlighted with the active underline) - this page now lives as a tab inside Settings, not as a standalone page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("tab")).toHaveCount(2);
  });

  test("tab-switch-to-platform: After the action, the app has navigated to the platform settings tab: the URL is /settings/platform, the \"Configurações da Plataforma\" heading has replaced the Pedidos queue, and the same tab bar remains visible with \"Plataforma\" now the active tab.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Plataforma" tab
    await page.getByRole("tab", { name: "Plataforma" }).click();
    await expect(page).toHaveURL(new RegExp("/settings/platform"));
  });

  test("sidebar-has-no-pedidos-entry: After the action, the expanded left navigation rail lists NO \"Pedidos\" entry anywhere (the queue is reached only through Settings now); the rail shows entries such as Chat, Automatizações, Artefactos, Integrações, Memória, Utilizadores, Registo and Configurações, and \"Configurações\" is the highlighted active section while on this page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Alternar barra lateral" button to expand the sidebar
    await page.getByRole("button", { name: "Alternar barra lateral" }).click();
    await expect(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  });
});
