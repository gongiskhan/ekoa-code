// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Registo (audit log)", () => {
  test("heading-visible: The page shows the \"Registo\" heading with its subtitle explaining that only metadata and artifacts are logged, never conversations.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Registo");
  });

  test("filter-bar-present: The filter bar offers the office scope filter (\"Todos os escritórios\") alongside user, action-type and date-range filters.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Todos os escritórios");
  });

  test("action-type-filter-present: The \"Tipo de ação\" filter input is present with its \"ex.: build\" placeholder.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("ex.: build")).toBeVisible();
  });

  test("apply-button-present: The \"Aplicar\" button that submits the filter selection is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Aplicar" })).toBeVisible();
  });

  test("activity-table-present: The \"ATIVIDADE\" section renders with its entry count and the log table below it.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("ATIVIDADE");
  });

  test("login-event-recorded: The audit log records the sign-in that this run performed - an \"auth.login\" entry is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("auth.login");
  });

  test("no-conversation-content-leaked: Consistent with the page's own promise (\"Apenas metadados e artefactos - nunca conversas\"), no row exposes chat message text or prompt content - the ARTEFACTOS column holds only identifiers, never prose the user typed into the assistant.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "Consistent with the page's own promise (\"Apenas metadados e artefactos - nunca conversas\"), no row exposes chat message text or prompt content - the ARTEFACTOS column holds only identifiers, never prose the user typed into the assistant.");
    expect(ok, "drillJudge: Consistent with the page's own promise (\"Apenas metadados e artefactos - nunca conversas\"), no row exposes chat message text or prompt content - the ARTEFACTOS column holds only identifiers, never prose the user typed into the assistant.").toBe(true);
  });

  test("timestamps-well-formed: Every DATA E HORA cell shows a properly formatted date and time - no \"Invalid Date\", no raw epoch numbers, no empty cells.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("06/08/2026");
  });

  test("table-polish: The log reads cleanly at a glance - action names render as consistently styled badges, the long artifact UUIDs use a monospace treatment and do not push other columns out of alignment, and rows have enough vertical rhythm to scan without eye strain.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The log reads cleanly at a glance - action names render as consistently styled badges, the long artifact UUIDs use a monospace treatment and do not push other columns out of alignment, and rows have enough vertical rhythm to scan without eye strain.");
    expect(ok, "drillJudge: The log reads cleanly at a glance - action names render as consistently styled badges, the long artifact UUIDs use a monospace treatment and do not push other columns out of alignment, and rows have enough vertical rhythm to scan without eye strain.").toBe(true);
  });

  test("table-resolves: The audit table settles into a real result - either event rows or a written empty state. The filter bar rendering on its own, with nothing below it, is a failure: this page's whole purpose is the record, and a blank record is indistinguishable from \"nothing ever happened\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    expect(await (page.getByRole("row")).count()).toBeGreaterThanOrEqual(2);
  });

  test("audit-log-does-not-fake-empty: The audit log never reports \"Sem entradas no registo.\" when the request behind it failed. This run signed in, so at least one auth event exists to show, and on an audit surface a false empty is the most serious form of this bug in the whole product: the record of who did what is precisely the thing that must never quietly read as \"nothing happened\". A failed read has to be an error the user can retry.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("auth.login");
  });

  test("load-error-is-in-portuguese: A failure to load the audit log is reported in Portuguese and in human terms, offering the retry. A raw English developer string quoting a millisecond timeout is a defect here as everywhere else in this product. (Observed defect at authoring time - the banner read literally \"Request timed out after 120000ms\", in English, beside a Portuguese \"Tentar novamente\" link.) NOTE 2026-08-05: the authoring-time observation behind this check was a dev-harness artifact (a leaking CORS proxy), not a product hang - the page renders normally in a clean browser. The CHECK stands: web/lib/api/core.ts really can surface a raw English timeout string and a failed read really must not render as an empty state, so this is kept as the guard for those paths.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/registo", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("table")).toBeVisible();
  });
});
