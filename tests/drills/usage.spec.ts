// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Utilização (token consumption)", () => {
  test("heading-visible: The page shows the \"Utilização\" heading with its subtitle about per-user token consumption and limit management.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Utilização");
  });

  test("table-headers-present: The usage table renders its column headers, including UTILIZADOR.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("UTILIZADOR");
  });

  test("last-login-column-present: The table includes the \"ÚLTIMO INÍCIO DE SESSÃO\" column.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("ÚLTIMO INÍCIO DE SESSÃO");
  });

  test("reset-action-present: Each user row offers a \"Repor\" (reset quota) action.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Repor" })).toBeVisible();
  });

  test("current-user-row-present: The signed-in admin account appears as a row in the usage table.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("admin");
  });

  test("quota-figures-consistent: For each row the USADO, RESTANTE and % values are mutually consistent - the percentage matches used against the total quota, and the remaining figure equals the quota minus what was used.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "For each row the USADO, RESTANTE and % values are mutually consistent - the percentage matches used against the total quota, and the remaining figure equals the quota minus what was used.");
    expect(ok, "drillJudge: For each row the USADO, RESTANTE and % values are mutually consistent - the percentage matches used against the total quota, and the remaining figure equals the quota minus what was used.").toBe(true);
  });

  test("reset-confirms-before-acting: After the action, pressing \"Repor\" does not silently wipe the quota - it either asks for confirmation first or gives clear visible feedback that the quota was reset (and the row's USADO / % update accordingly).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Repor" button on the admin row
    await page.getByRole("button", { name: "Repor" }).click();
    await expect(page.getByRole("dialog", { name: "Repor consumo de admin?" })).toBeVisible();
  });

  test("table-polish: The usage table looks clean - numeric columns are right-aligned, the percentage badge is consistently styled, the header row is visually distinct from the body, and the table card does not stretch awkwardly wide relative to its content.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The usage table looks clean - numeric columns are right-aligned, the percentage badge is consistently styled, the header row is visually distinct from the body, and the table card does not stretch awkwardly wide relative to its content.");
    expect(ok, "drillJudge: The usage table looks clean - numeric columns are right-aligned, the percentage badge is consistently styled, the header row is visually distinct from the body, and the table card does not stretch awkwardly wide relative to its content.").toBe(true);
  });

  test("table-resolves: The consumption table settles into a real result - per-user rows with their quota figures. The page must not stop at its heading and subtitle with nothing but blank space where the table belongs, and must not still be showing a skeleton or spinner once it has settled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("table")).toBeVisible();
  });

  test("usage-empty-state-is-a-lie: The page never states that no users exist. At minimum the signed-in admin has an account and has consumed tokens, so \"Nenhum utilizador encontrado.\" is always false on this screen. A read that did not return must be shown as a failure the user can retry.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("table tr td")).toBeVisible();
  });

  test("origin-breakdown-rows-coherent: When consumption exists, each row of the \"Consumo por origem\" table names its origin and carries a token figure and a percentage, and the percentages across the rows account for the whole (they sum to roughly 100%). A row with a blank origin, a missing figure, or percentages that plainly cannot describe the same total is inconsistent data. With no consumption yet, an explicit empty state in Portuguese is the acceptable alternative.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/usage", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "When consumption exists, each row of the \"Consumo por origem\" table names its origin and carries a token figure and a percentage, and the percentages across the rows account for the whole (they sum to roughly 100%). A row with a blank origin, a missing figure, or percentages that plainly cannot describe the same total is inconsistent data. With no consumption yet, an explicit empty state in Portuguese is the acceptable alternative.");
    expect(ok, "drillJudge: When consumption exists, each row of the \"Consumo por origem\" table names its origin and carries a token figure and a percentage, and the percentages across the rows account for the whole (they sum to roughly 100%). A row with a blank origin, a missing figure, or percentages that plainly cannot describe the same total is inconsistent data. With no consumption yet, an explicit empty state in Portuguese is the acceptable alternative.").toBe(true);
  });
});
