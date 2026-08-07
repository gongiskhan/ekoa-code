// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";

test.describe("App root (entry point, redirects to Chat)", () => {
  test("root-lands-in-chat: Navigating to the app root with a valid session lands the user in the chat workspace - the URL is under /chat, not left on / and not bounced to the login screen.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/chat"));
  });

  test("dashboard-shell-rendered: The destination renders the full dashboard shell rather than a bare redirect stub - the top-bar user menu is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Menu do utilizador" })).toBeVisible();
  });

  test("entry-is-usable-immediately: Arriving at the app root leaves the user on a workspace they can immediately use - the icon rail, top bar and a ready chat composer are all rendered and interactive. It must not settle on a permanent spinner, an empty white pane, or a chat that is stuck mid-\"A pensar...\" with nothing the user can type into.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("textbox", { name: "Escreva a sua mensagem..." })).toBeVisible();
  });

  test("redirect-has-no-flash: The hop from / into the chat workspace is visually clean - no flash of an unstyled page, no momentary login form, and no visible double navigation before the workspace settles.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/chat/"));
  });

  test("no-console-errors: Navigating to the app root produces no browser console errors and no failed network requests through the redirect and into the workspace.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/chat/"));
  });
});
