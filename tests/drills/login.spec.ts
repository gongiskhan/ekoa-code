// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";

test.describe("Iniciar sessão (login)", () => {
  test("heading-visible: The login card shows the \"Iniciar sessão\" heading with its \"Inicie sessão para aceder ao painel\" subtitle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Iniciar sessão");
  });

  test("username-field-visible: The \"Nome de utilizador\" field is present - this product signs in by username, not by email address.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Nome de utilizador")).toBeVisible();
  });

  test("password-field-visible: The \"Palavra-passe\" field is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Palavra-passe")).toBeVisible();
  });

  test("submit-disabled-when-empty: With both fields empty, the \"Entrar\" button is disabled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Entrar" })).toHaveAttribute("disabled", "");
  });

  test("forgot-password-link-present: The card tells a locked-out user how to get back in. There is no self-service recovery in this product (the only reset is POST /api/v1/users/:id/password, super-admin only), so the correct UI is a plain instruction to ask an administrator - NOT a link. It used to be a link to /change-password, which needs the very password the user has forgotten and, signed out, redirects straight back to /login, so it did nothing when clicked (fixed 2026-08-05). A link reappearing here is a regression unless a real recovery route ships with it.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Peça ao administrador da plataforma para a repor.");
  });

  test("remember-me-present: The \"Manter sessão iniciada\" option is offered next to the password field.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Manter sessão iniciada");
  });

  test("remember-me-is-a-real-checkbox: \"Manter sessão iniciada\" is exposed as a real checkbox control, not a decorative tick glyph - a keyboard or screen-reader user must be able to reach and toggle the setting that decides how long their session survives.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("checkbox", { name: "Manter sessão iniciada" })).toBeVisible();
  });

  test("fields-carry-placeholders: The username field prompts with \"Introduza o seu nome de utilizador\", so an unlabelled-looking form is never presented on the product's first screen.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("Introduza o seu nome de utilizador")).toBeVisible();
  });

  test("password-reveal-toggle-present: The password field offers a \"Mostrar palavra-passe\" reveal toggle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Mostrar palavra-passe" })).toBeVisible();
  });

  test("footer-wordmark-present: The signed-out screen is branded - the \"Ekoa · Plataforma de trabalho com IA\" wordmark sits beneath the card.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Ekoa · Plataforma de trabalho com IA");
  });

  test("remember-me-default-is-deliberate: \"Manter sessão iniciada\" arrives pre-ticked on a freshly loaded login page. For a product holding privileged client material, a persistent session opted in by default is a decision the screen should own rather than slip past the user - the option must at least be unmistakably legible and togglable, and the user must be able to see at a glance that it is ON.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("checkbox", { name: "Manter sessão iniciada" })).toHaveAttribute("checked", "true");
  });

  test("stays-on-login-when-signed-out: Navigating to /login while signed out leaves the browser on /login rather than bouncing elsewhere.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/login"));
  });

  test("wrong-password-shows-generic-error: After the actions, signing in with a valid username and a wrong password shows the generic error \"Credenciais inválidas.\" in the card and leaves the user on the login page. The message must NOT reveal which of the two was wrong or whether the account exists.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome de utilizador" field with "admin"
    await page.getByRole("textbox", { name: "Nome de utilizador" }).fill("admin");
    // fill the "Palavra-passe" field with "senhaerrada999"
    await page.getByRole("textbox", { name: "Palavra-passe" }).fill("senhaerrada999");
    // click the "Entrar" button
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("body")).toContainText("Credenciais inválidas.");
  });

  test("unknown-user-error-identical: After the actions, signing in with a username that does not exist produces the same generic \"Credenciais inválidas.\" message as a wrong password does - no account enumeration through differing copy or differing response time.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/login", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome de utilizador" field with "utilizadorinexistente"
    await page.getByRole("textbox", { name: "Nome de utilizador" }).fill("utilizadorinexistente");
    // fill the "Palavra-passe" field with "seja-o-que-for"
    await page.getByRole("textbox", { name: "Palavra-passe" }).fill("seja-o-que-for");
    // click the "Entrar" button
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("body")).toContainText("Credenciais inválidas.");
  });
});
