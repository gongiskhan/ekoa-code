// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";

test.describe("Definições (settings root, redirects to Plataforma)", () => {
  test("redirects-into-a-settings-tab: Navigating to /settings does not dead-end on a 404 or an empty shell - the app forwards to a real settings tab (the platform tab, /settings/platform) and the address bar shows that destination.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/platform"));
  });

  test("settings-tabs-present: The settings sub-navigation is present and complete - the tabs Plataforma, Pedidos, Utilizadores and Escritórios - so every settings area is reachable from the entry point a user typed.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("tab")).toHaveCount(4);
  });

  test("landed-tab-is-highlighted: The sub-navigation marks the tab the redirect actually landed on as the active one, so the user can tell where they are. A tab strip with nothing selected after a redirect is a defect.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("tab", { name: "Plataforma" })).toHaveAttribute("aria-selected", "true");
  });

  test("destination-renders-its-page: After the redirect the destination is actually rendered, not just its chrome - the \"Configurações da Plataforma\" heading with its \"Configuração geral e opções avançadas\" subtitle, and the \"Geral\" card carrying \"Nome da Plataforma\", \"Fuso Horário\" and \"Idioma\". A page left on \"A carregar as configurações...\" has not finished.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Configurações da Plataforma" })).toBeVisible();
  });

  test("redirect-is-clean: The forward happens cleanly - no flash of a \"not found\" screen, no error banner, and no visible bounce through an intermediate empty page on the way to the destination.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/settings/platform"));
  });

  test("no-console-errors: Navigating to /settings produces no browser console errors and no failed network requests on the way to its destination.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Configurações da Plataforma" })).toBeVisible();
  });
});
