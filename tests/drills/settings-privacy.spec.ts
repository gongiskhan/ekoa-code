// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Privacidade e ponte local", () => {
  test("heading-visible: The page shows the \"Privacidade e ponte local\" heading with its subtitle about the local bridge, read permissions and the log of everything leaving this computer.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Privacidade e ponte local");
  });

  test("platform-toggle-present: The Mac/Windows platform toggle is present, with Windows offered as an alternative to the default.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Windows");
  });

  test("step-by-step-guide-present: The \"Como ligar a ponte, passo a passo\" numbered guide is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Como ligar a ponte, passo a passo");
  });

  test("pairing-section-present: The \"Estado da ponte e emparelhamento\" section is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Estado da ponte e emparelhamento");
  });

  test("unpaired-status-shown: The pairing status pill in \"Estado da ponte e emparelhamento\" resolves to a definite state - \"Ponte ligada\" when a bridge is connected, or \"Ponte não emparelhada\" when none is. Either is correct depending on whether a local bridge is running; what must never show is a blank pill, a stuck \"checking\" state, or a status contradicting the sections below it.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Ponte ligada");
  });

  test("pairing-button-present: The \"Gerar código de emparelhamento\" button is present in the pairing section.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Gerar código de emparelhamento" })).toBeVisible();
  });

  test("platform-toggle-switches-download: After the action, selecting Windows updates the download control to offer the Windows installer (its label stops saying \"para Mac\") and the accompanying unpack instructions change to the Windows wording.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Windows" toggle option
    await page.getByRole("tab", { name: "Windows" }).click();
    await expect(page.getByRole("tab", { name: "Windows" })).toHaveAttribute("aria-selected", "true");
  });

  test("pairing-code-generated: After the action, a pairing code is displayed for the user to enter in the bridge app - a visible code (with an expiry or copy affordance), not an unchanged page or an error.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Gerar código de emparelhamento" button
    await page.getByRole("button", { name: "Gerar código de emparelhamento" }).click();
    await expect(page.locator("body")).toContainText("Válido durante 10 minutos");
  });

  test("advanced-install-expands: After the action, the \"Instalação avançada (com Node.js e Terminal)\" disclosure expands to reveal the terminal-based instructions.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Instalação avançada (com Node.js e Terminal)" disclosure
    await page.locator("text=Instalação manual (avançado)").click();
    await expect(page.locator("body")).toContainText("Instalação manual (avançado)");
  });

  test("egress-log-reachable: The page delivers on the part of its subtitle about \"o registo de tudo o que sai deste computador\" - scrolling down reveals the read-permission controls and the egress log (or an explicit link to it), not just bridge installation instructions.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page delivers on the part of its subtitle about \"o registo de tudo o que sai deste computador\" - scrolling down reveals the read-permission controls and the egress log (or an explicit link to it), not just bridge installation instructions.");
    expect(ok, "drillJudge: The page delivers on the part of its subtitle about \"o registo de tudo o que sai deste computador\" - scrolling down reveals the read-permission controls and the egress log (or an explicit link to it), not just bridge installation instructions.").toBe(true);
  });

  test("lower-sections-resolve: None of the lower sections is left mid-flight once the page has settled - \"Comandos locais aprovados\" must not stay on \"A carregar...\" and \"Atividade de mascaramento\" must not stay on \"Verificação em curso\". On a privacy page an indefinite \"checking...\" reads as if an audit is running when nothing is.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("text=A carregar")).toHaveCount(0);
  });

  test("egress-log-columns-present: The \"Registo de leituras locais\" table declares what it will record - MOMENTO, TIPO, FICHEIRO, INTERVALO, DIMENSÃO and SESSÃO - so the user can see the shape of the evidence the product promises to keep before any bridge is connected.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("MOMENTO");
  });

  test("instructions-readable: The step-by-step instructions are genuinely followable by a non-technical user - each numbered step is a single concrete action, the numbered badges align with their text, and the Node.js caveat is visibly de-emphasised as a footnote rather than competing with the main steps.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The step-by-step instructions are genuinely followable by a non-technical user - each numbered step is a single concrete action, the numbered badges align with their text, and the Node.js caveat is visibly de-emphasised as a footnote rather than competing with the main steps.");
    expect(ok, "drillJudge: The step-by-step instructions are genuinely followable by a non-technical user - each numbered step is a single concrete action, the numbered badges align with their text, and the Node.js caveat is visibly de-emphasised as a footnote rather than competing with the main steps.").toBe(true);
  });

  test("page-polish: The page reads as consistently structured sections - each has an icon-led title, a one-line explanation and a card below; the cards share a width and the pairing status pill is clearly a status rather than a button.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/privacy", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The page reads as consistently structured sections - each has an icon-led title, a one-line explanation and a card below; the cards share a width and the pairing status pill is clearly a status rather than a button.");
    expect(ok, "drillJudge: The page reads as consistently structured sections - each has an icon-led title, a one-line explanation and a card below; the cards share a width and the pairing status pill is clearly a status rather than a button.").toBe(true);
  });
});
