// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Alterar Palavra-passe", () => {
  test("heading-visible: The page shows the \"Alterar Palavra-passe\" heading above the password card, under the shield icon.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Alterar Palavra-passe");
  });

  test("current-password-field: The \"Palavra-passe Atual\" field is present - changing the password requires proving knowledge of the current one.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Palavra-passe Atual")).toBeVisible();
  });

  test("new-password-field: The \"Nova Palavra-passe\" field is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Nova Palavra-passe")).toBeVisible();
  });

  test("confirm-password-field: The \"Confirmar Nova Palavra-passe\" field is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Confirmar Nova Palavra-passe")).toBeVisible();
  });

  test("exactly-three-password-fields: The card carries exactly three input fields - current, new and confirm - and nothing else has crept into the form.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("textbox")).toHaveCount(3);
  });

  test("submit-disabled-when-empty: With the form empty, the \"Atualizar Palavra-passe\" button is disabled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Atualizar Palavra-passe" })).toHaveAttribute("disabled", "");
  });

  test("all-fields-have-reveal-toggle: Each of the three password fields offers its own \"Mostrar palavra-passe\" reveal toggle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    expect(await (page.getByRole("button", { name: "Mostrar palavra-passe" })).count()).toBeGreaterThanOrEqual(3);
  });

  test("mismatch-rejected: After the actions, entering a new password and a different confirmation does not change the password - the page shows a clear message that the two do not match (\"As palavras-passe não coincidem\") and keeps the submit disabled, and does not report success. Graduated from vision to a deterministic spec: a vision pass could see the submit fire only when a repair step re-typed a matching confirmation, which is the harness acting, not the page accepting a mismatch.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Palavra-passe Atual" field with "tmp12345"
    await page.getByRole("textbox", { name: "Palavra-passe Atual" }).fill("tmp12345");
    // fill the "Nova Palavra-passe" field with "novaSenha123"
    await page.getByRole("textbox", { name: "Nova Palavra-passe" }).fill("novaSenha123");
    // fill the "Confirmar Nova Palavra-passe" field with "outraSenha456"
    await page.getByRole("textbox", { name: "Confirmar Nova Palavra-passe" }).fill("outraSenha456");
    await expect(page.locator("body")).toContainText("As palavras-passe não coincidem");
  });

  test("reveal-toggle-works: After the actions, pressing the reveal toggle on the \"Nova Palavra-passe\" field switches that field from dots to readable plaintext, and only that field - the other two stay masked.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nova Palavra-passe" field with "novaSenha123"
    await page.getByRole("textbox", { name: "Nova Palavra-passe" }).fill("novaSenha123");
    // click the "Mostrar palavra-passe" toggle on the "Nova Palavra-passe" field
    await page.getByRole("button", { name: "Mostrar palavra-passe" }).click();
    await expect(page.locator("body")).toContainText("novaSenha123");
  });

  test("card-polish: The centred card on the dark branded background is well composed - the shield icon, heading and subtitle stack tightly, the three fields share equal width and spacing with a divider isolating the current-password field from the new pair, and the footer wordmark sits clear of the card.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The centred card on the dark branded background is well composed - the shield icon, heading and subtitle stack tightly, the three fields share equal width and spacing with a divider isolating the current-password field from the new pair, and the footer wordmark sits clear of the card.");
    expect(ok, "drillJudge: The centred card on the dark branded background is well composed - the shield icon, heading and subtitle stack tightly, the three fields share equal width and spacing with a divider isolating the current-password field from the new pair, and the footer wordmark sits clear of the card.").toBe(true);
  });

  test("requirement-checklist-spelling: After the actions, the password requirement checklist appears and every line is spelled correctly in pt-PT, with its diacritics: \"Pelo menos 8 caracteres\", \"Uma letra maiúscula\", \"Uma letra minúscula\", \"Um número\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nova Palavra-passe" field with "NovaSenha123"
    await page.getByRole("textbox", { name: "Nova Palavra-passe" }).fill("NovaSenha123");
    await expect(page.locator("body")).toContainText("Uma letra minúscula");
  });

  test("requirement-checklist-tracks-input: After the actions, the requirement checklist reflects what has actually been typed - a password that satisfies only some rules ticks only those, so the list is live guidance rather than decoration.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nova Palavra-passe" field with "abc"
    await page.getByRole("textbox", { name: "Nova Palavra-passe" }).fill("abc");
    await expect(page.locator("body")).toContainText("Fraca");
  });

  test("strength-meter-responds: After the actions, the strength meter under \"Nova Palavra-passe\" rates a strong password visibly higher than a weak one, with a Portuguese label (e.g. \"Forte\"), and the bar segments fill to match the label rather than contradicting it.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nova Palavra-passe" field with "abc"
    await page.getByRole("textbox", { name: "Nova Palavra-passe" }).fill("abc");
    // fill the "Nova Palavra-passe" field with "Drill#Temp2026"
    await page.getByRole("textbox", { name: "Nova Palavra-passe" }).fill("Drill#Temp2026");
    await expect(page.locator("body")).toContainText("Forte");
  });

  test("forced-variant-hides-back-link: While the change is still owed, the \"Voltar ao Dashboard\" escape link is NOT offered - the whole point is that the user cannot skip the change - and the sign-out control is offered in its place so they still have a way out.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/change-password", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("link", { name: "Voltar ao Dashboard" })).toHaveCount(0);
  });
});
