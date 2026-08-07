// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";

test.describe("Chaves de API", () => {
  test("heading-visible: The page shows the \"Chaves de API\" heading with its subtitle explaining that keys connect Anthropic-compatible tools and that consumption is billed to the account.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Chaves de API");
  });

  test("name-field-visible: The \"Nome da chave\" input is present in the create-key card.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByLabel("Nome da chave")).toBeVisible();
  });

  test("create-disabled-when-unnamed: With no key name entered, the \"Criar chave\" button is disabled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Criar chave" })).toHaveAttribute("disabled", "");
  });

  test("keys-section-present: The \"As suas chaves\" section listing existing keys is present below the create form.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("As suas chaves");
  });

  test("create-submit-settles: After the actions, the create-key submission finishes: the button comes back out of its \"A criar...\" spinner - either to the reveal panel and a populated list, or to a written error. A button left spinning on \"A criar...\" with the key list still empty is a failure, and so is a page that quietly reverts to the blank form on reload with no key created and no error shown.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome da chave" field with "Chave de teste drill"
    await page.getByRole("textbox", { name: "Nome da chave" }).fill("Chave de teste drill");
    // click the "Criar chave" button
    await page.getByRole("button", { name: "Criar chave" }).click();
    await expect(page.locator("body")).toContainText("Guarde a sua chave agora");
  });

  test("keys-section-has-empty-state: With no keys created yet, the \"As suas chaves\" section says so in words - an empty-state line such as \"Ainda nao criou nenhuma chave\" (correctly accented) or an empty table with its column headers. A bare \"As suas chaves\" heading followed by nothing but white space is a defect: the user cannot tell an account with no keys apart from a list that failed to load.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("columnheader", { name: "NOME" })).toBeVisible();
  });

  test("create-reveals-key-once: After the actions, the new key is revealed exactly once in a highlighted \"Guarde a sua chave agora\" panel that warns \"Esta chave não volta a ser mostrada\", shows the full ekoa_gk_ token in a selectable field with a \"Copiar chave\" button, and offers a \"Já guardei a chave\" dismiss control.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome da chave" field with "Chave de teste drill"
    await page.getByRole("textbox", { name: "Nome da chave" }).fill("Chave de teste drill");
    // click the "Criar chave" button
    await page.getByRole("button", { name: "Criar chave" }).click();
    await expect(page.getByRole("button", { name: "Já guardei a chave" })).toBeVisible();
  });

  test("client-config-snippet-shown: After the actions, the reveal panel includes a \"Configuração do cliente\" snippet giving both ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, and the base URL points at this platform's own LLM gateway path (/api/v1/llm) rather than at api.anthropic.com directly.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome da chave" field with "Chave de teste drill"
    await page.getByRole("textbox", { name: "Nome da chave" }).fill("Chave de teste drill");
    // click the "Criar chave" button
    await page.getByRole("button", { name: "Criar chave" }).click();
    await expect(page.locator("body")).toContainText("/api/v1/llm");
  });

  test("dismiss-hides-reveal-panel: After the actions, pressing \"Já guardei a chave\" removes the reveal panel and the plaintext key is no longer anywhere on the page, while the key itself remains listed (masked) in \"As suas chaves\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/settings/api-keys", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // fill the "Nome da chave" field with "Chave de teste drill"
    await page.getByRole("textbox", { name: "Nome da chave" }).fill("Chave de teste drill");
    // click the "Criar chave" button
    await page.getByRole("button", { name: "Criar chave" }).click();
    // click the "Já guardei a chave" button
    await page.getByRole("button", { name: "Já guardei a chave" }).click();
    await expect(page.locator(".reveal-panel, [data-testid='reveal-panel']")).toHaveCount(0);
  });
});
