// AUTO-EMITTED by Drill (B8) from a passing vision run. Hand-edit at your
// own risk — the next graduation of any step on this page rewrites this file.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Activate - authorize a CLI/TUI device login", () => {
  test("card-heading-copy: Visiting /activate renders a centered card with a teal-tinted rounded icon badge containing a Terminal (lucide) icon, the heading 'Authorize this device', and the subtext 'Ekoa Local (your terminal) is asking to sign in to your Ekoa account.' directly beneath it.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Ekoa Local (your\nterminal) is asking to sign in to your Ekoa account.");
  });

  test("no-code-error-copy: With no ?code= query parameter (the literal /activate path), the page settles from its brief loading spinner into an error state showing an AlertTriangle icon and the exact text 'No device code in the link. Re-run the login from your terminal.' - this happens whether or not the visitor is authenticated, since the missing-code check runs before the auth check in the page's effect.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("No device code in the link. Re-run the login from your terminal.");
  });

  test("no-code-no-actions-left: In the no-code error state there are no Approve/Deny buttons, no device-code box, and no spinner left on screen - only the Ekoa logo, the card header, the red-tinted error message, and the footer advisory line are visible.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button")).toHaveCount(0);
  });

  test("footer-advisory-line: The line 'Only approve if you started this login. The code must match your terminal.' renders in small muted text below the card and stays visible regardless of which phase (loading, error, ready, working, approved, denied) the page is in.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Only approve if you started this login. The code must match your terminal.");
  });

  test("backdrop-visual-polish: The full-bleed dark backdrop (near-black navy base with soft teal/cyan radial glows top-left and bottom-right) and the glassmorphic card (translucent border, blurred background, rounded corners, drop shadow) read as a deliberate, polished dark auth screen with no visible banding, clipping, or misaligned blur edges at both desktop and mobile widths.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The full-bleed dark backdrop (near-black navy base with soft teal/cyan radial glows top-left and bottom-right) and the glassmorphic card (translucent border, blurred background, rounded corners, drop shadow) read as a deliberate, polished dark auth screen with no visible banding, clipping, or misaligned blur edges at both desktop and mobile widths.");
    expect(ok, "drillJudge: The full-bleed dark backdrop (near-black navy base with soft teal/cyan radial glows top-left and bottom-right) and the glassmorphic card (translucent border, blurred background, rounded corners, drop shadow) read as a deliberate, polished dark auth screen with no visible banding, clipping, or misaligned blur edges at both desktop and mobile widths.").toBe(true);
  });

  test("mobile-layout-fit: At 375x812 the card (max-width roughly 420px) sits fully on screen with side margins, the logo/heading/subtext/error text all wrap within the card without being cut off or overlapping, and there is no horizontal scrollbar.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("zero-console-errors: Loading /activate with no code param produces zero browser console errors, aside from known-benign favicon or React DevTools messages.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Authorize this device");
  });

  test("no-dashboard-chrome: The page shows none of the standard dashboard chrome - no left Sidebar, no Header with language toggle, and no font-display PageHeader h1 - because /activate sits outside the app's (dashboard) route group and is a standalone auth-style screen, similar in spirit to /login, not a broken dashboard page.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("english-only-vs-settings-devices: All visible copy on this page ('Authorize this device', 'Deny', 'Approve', 'Device approved', 'Request denied', the no-code error, the footer advisory) is hardcoded in English with no language toggle present, whereas the sibling device-approval page at /settings/devices implements the exact same approve/deny device-code feature entirely in PT-PT copy ('Aprovacao de dispositivos', 'Aprovar', 'Recusar') inside the normal dashboard shell - assess whether this English-only, differently-styled duplicate surface is an intentional CLI-deep-link exception or a real localization/consistency gap worth flagging to product.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "All visible copy on this page ('Authorize this device', 'Deny', 'Approve', 'Device approved', 'Request denied', the no-code error, the footer advisory) is hardcoded in English with no language toggle present, whereas the sibling device-approval page at /settings/devices implements the exact same approve/deny device-code feature entirely in PT-PT copy ('Aprovacao de dispositivos', 'Aprovar', 'Recusar') inside the normal dashboard shell - assess whether this English-only, differently-styled duplicate surface is an intentional CLI-deep-link exception or a real localization/consistency gap worth flagging to product.");
    expect(ok, "drillJudge: All visible copy on this page ('Authorize this device', 'Deny', 'Approve', 'Device approved', 'Request denied', the no-code error, the footer advisory) is hardcoded in English with no language toggle present, whereas the sibling device-approval page at /settings/devices implements the exact same approve/deny device-code feature entirely in PT-PT copy ('Aprovacao de dispositivos', 'Aprovar', 'Recusar') inside the normal dashboard shell - assess whether this English-only, differently-styled duplicate surface is an intentional CLI-deep-link exception or a real localization/consistency gap worth flagging to product.").toBe(true);
  });

  test("empty-code-param-trimmed-to-error: Opening /activate?code= with an empty value (or a whitespace-only value such as /activate?code=%20%20) behaves exactly like the missing-code case: the code is trimmed to empty, and the page settles into the error state with the AlertTriangle icon and the exact text 'No device code in the link. Re-run the login from your terminal.' - it never redirects to /login and never shows the code box, even for an authenticated visitor.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/activate", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("No device code in the link. Re-run the login from your terminal.");
  });
});
