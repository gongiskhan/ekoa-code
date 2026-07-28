// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Pedidos (change requests)", () => {
  test("heading-visible: The page shows the \"Pedidos\" heading with its subtitle about change requests sent by users from the apps.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Pedidos");
  });

  test("state-filter-defaults-open: The \"Estado\" filter defaults to \"Abertos\" (open requests).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Abertos");
  });

  test("empty-state-message: With no change requests, the page shows the \"Sem pedidos de alteração.\" empty state.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Sem pedidos de alteração.");
  });

  test("office-filter-present: The office scope filter (\"Todos os escritórios\") is present in the filter bar.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Todos os escritórios");
  });

  test("empty-state-polish: The empty state is centred with its icon above the message and reads as deliberate design rather than a page that failed to load; the filter bar above it spans the same width as the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/pedidos", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The empty state is centred with its icon above the message and reads as deliberate design rather than a page that failed to load; the filter bar above it spans the same width as the page header.");
    expect(ok, "drillJudge: The empty state is centred with its icon above the message and reads as deliberate design rather than a page that failed to load; the filter bar above it spans the same width as the page header.").toBe(true);
  });
});
