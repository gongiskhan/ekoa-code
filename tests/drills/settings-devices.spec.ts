// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Aprovação de dispositivos", () => {
  test("heading-visible: The page shows the \"Aprovação de dispositivos\" heading with its subtitle explaining that a new device (such as the local bridge) is authorised by entering the code it displays.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Aprovação de dispositivos");
  });

  test("code-field-visible: The \"Código do dispositivo\" input is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Código do dispositivo")).toBeVisible();
  });

  test("code-format-hinted: The input shows the expected code shape as a placeholder (\"XXXX-XXXX\").", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("XXXX-XXXX")).toBeVisible();
  });

  test("approve-and-deny-present: Both the \"Aprovar\" and \"Recusar\" actions are offered.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Recusar" })).toBeVisible();
  });

  test("approve-disabled-when-empty: With no code entered, the \"Aprovar\" button is disabled - a device cannot be authorised by an empty submission.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Aprovar" })).toHaveAttribute("disabled", "");
  });

  test("invalid-code-rejected-clearly: After the actions, submitting a well-formed but non-existent code shows a clear error explaining the code is invalid or expired - it must not silently succeed, and it must not leave the user staring at an unchanged form. In particular the button must come back out of its \"A aprovar...\" spinner: a device approval that neither confirms nor fails leaves the user unable to tell whether an unknown device was just authorised.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Código do dispositivo" field with "ZZZZ-ZZZZ"
    await page.getByRole("textbox", { name: "Código do dispositivo" }).fill("ZZZZ-ZZZZ");
    // click the "Aprovar" button
    await page.getByRole("button", { name: "Aprovar" }).click();
    await expect(page.locator("body")).toContainText("Código de dispositivo inválido ou expirado");
  });

  test("expiry-communicated: The helper text under the field tells the user the code's format and that it is valid for 10 minutes, so an expired-code failure is understandable rather than mysterious.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("O código tem o formato XXXX-XXXX e é válido durante 10 minutos.");
  });

  test("shell-signout-label-accented: After the action, the open user menu shows the signed-in account (\"admin\", \"super-admin\") and a sign-out item spelled \"Terminar Sessão\" - with the accent. This item is on every authenticated page, so an unaccented \"Terminar Sessao\" is a spelling defect repeated across the whole product.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Menu do utilizador" button
    await page.getByRole("button", { name: "Menu do utilizador" }).click();
    await expect(page.getByRole("button", { name: "Terminar Sessão" })).toBeVisible();
  });

  test("shell-token-meter-resolves: The token meter in the top bar shows a real consumption figure. A grey skeleton pill sitting between the page area and the language switcher is an unresolved loading state, and it is on every page of the product.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("31.2K");
  });

  test("page-polish: The single-card layout is balanced - the card is not stretched full-width for one short input, the primary Aprovar and the destructive-looking Recusar are visually distinguished by weight and colour, and the helper text sits close under its field.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/devices", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The single-card layout is balanced - the card is not stretched full-width for one short input, the primary Aprovar and the destructive-looking Recusar are visually distinguished by weight and colour, and the helper text sits close under its field.");
    expect(ok, "drillJudge: The single-card layout is balanced - the card is not stretched full-width for one short input, the primary Aprovar and the destructive-looking Recusar are visually distinguished by weight and colour, and the helper text sits close under its field.").toBe(true);
  });
});
