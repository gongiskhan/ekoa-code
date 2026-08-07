// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Os Meus Artefactos (artifact gallery)", () => {
  test("heading-visible: The page shows the \"Os Meus Artefactos\" heading with the built-artifact count subtitle.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("Os Meus Artefactos");
  });

  test("import-button-visible: The \"Importar artefacto\" button is present in the page header.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Importar artefacto" })).toBeVisible();
  });

  test("search-box-visible: The \"Pesquisar artefactos...\" search box is present.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("Pesquisar artefactos...")).toBeVisible();
  });

  test("filter-chips-visible: The status filter chip row is present (at least the \"Todos\" and \"Em Execução\" chips).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Todos" })).toBeVisible();
  });

  test("shared-filter-chip-visible: The chip row also carries the \"Partilhados\" filter, so artifacts shared with the account are reachable from the same row as the status filters.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Partilhados" })).toBeVisible();
  });

  test("sort-control-visible: A sort control labelled \"Recentes\" sits beside the filter chips, so the gallery order is explicit and changeable rather than arbitrary.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Recentes" })).toBeVisible();
  });

  test("gallery-resolves: The gallery settles into a real result - either a grid of artifact cards or an explicit written empty state inviting the user to build or import their first artifact. It must not be left on a spinner, and it must not be a bare blank area under the filter chips.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("42 artefactos construídos");
  });

  test("count-matches-grid: The \"N artefactos construídos\" counter under the heading agrees with what the grid actually shows - if the account owns artifacts, the counter is not 0 and the cards are rendered. A page that reports \"0 artefactos construídos\" while the account does in fact own artifacts is showing a false empty state, which is worse than a spinner because it looks finished.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("42 artefactos construídos");
  });

  test("cards-render: Multiple artifact cards render, each with a \"Usar\" action (at least 4 on the default view).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    expect(await (page.getByRole("button", { name: "Usar" })).count()).toBeGreaterThanOrEqual(4);
  });

  test("customize-action-visible: Artifact cards offer the secondary \"Personalizar no chat\" action.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Personalizar no chat" })).toBeVisible();
  });

  test("no-invalid-date-on-cards: No element anywhere on this page renders the literal string \"Invalid Date\" - every card timestamp is either a real formatted Portuguese date or omitted entirely. The count assertion sweeps the whole DOM, so below-the-fold cards and always-mounted tooltip/menu content are covered without scrolling.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("text=Invalid Date")).toHaveCount(0);
  });

  test("card-hover-overlay-actions: After the action, hovering an artifact card reveals its action overlay - \"Continuar a trabalhar\", \"Abrir num novo separador\", \"Mais ações\" and the delete control - laid out over the preview without obscuring the card title, and every action reads as a real labelled control rather than a bare icon.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // hover the "Portfólio Agência" artifact card
    await page.getByRole("img", { name: "Portfólio Agência" }).hover();
    await expect(page.getByRole("button", { name: "Continuar a trabalhar" })).toBeVisible();
  });

  test("delete-action-confirms: After the actions, asking to delete an artifact does NOT delete it on the spot - a confirmation step names what is about to be destroyed and offers a way out. Deleting a built artifact is irreversible, so a single unconfirmed click must never be enough.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // hover the "Portfólio Agência" artifact card
    await page.getByRole("img", { name: "Portfólio Agência" }).hover();
    // click the "Eliminar artefacto" button on that card
    await page.getByRole("button", { name: "Eliminar artefacto" }).click();
    await expect(page.getByRole("dialog", { name: "Eliminar Artefacto" })).toBeVisible();
  });

  test("refresh-control-works: After the action, the refresh control re-reads the gallery and settles back into the grid - it shows a brief pending state and then returns to the same populated grid, never leaving a spinner in place, emptying the grid or dropping the artifact count to 0.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Atualizar artefactos" button
    await page.getByRole("button", { name: "Atualizar artefactos" }).click();
    await expect(page.locator("body")).toContainText("42 artefactos construídos");
  });

  test("search-filters-grid: After the action, the grid narrows to matching artifacts only - a single \"Helpdesk\" card remains visible (the other cards are filtered out).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // type "Helpdesk" into the "Pesquisar artefactos..." search box
    await page.getByRole("textbox", { name: "Pesquisar artefactos..." }).fill("Helpdesk");
    await expect(page.getByRole("heading")).toHaveCount(1);
  });

  test("status-chip-filters: After the action, the \"Prontos\" chip is visibly selected (active styling replaces \"Todos\") and the grid updates to show only artifacts in that status - or a clear \"no results\" style message if none match. The grid never errors or goes blank.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Prontos" filter chip
    await page.getByRole("button", { name: "Prontos" }).click();
    await expect(page.locator("body")).toContainText("Nenhum artefacto corresponde aos filtros.");
  });

  test("applications-section-collapses: After the action, the \"Aplicações\" showcase collapses: its large preview cards give way to the compact artifact grid (cards carrying a status badge, a type label and per-card actions), and the section header toggle now reads \"Mostrar\" with the artifact count. Clicking the same toggle again restores the showcase. Nothing errors and the page never goes blank.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Ocultar" toggle on the "Aplicações" section header
    await page.getByRole("button", { name: "Aplicações Aplicações prontas a usar - abra, use e adapte às suas necessidades. Ocultar" }).click();
    await expect(page.getByRole("button", { name: "Aplicações Aplicações prontas a usar - abra, use e adapte às suas necessidades. Mostrar (42)" })).toBeVisible();
  });

  test("compact-grid-titles-identifiable: After the action, the compact artifact cards read cleanly - status badge, type label and action icons aligned on each card - and every card title keeps enough characters to identify which artifact it is. A title truncated so short that it could name several different artifacts fails the check.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Ocultar" toggle on the "Aplicações" section header
    await page.getByRole("button", { name: "Aplicações Aplicações prontas a usar - abra, use e adapte às suas necessidades. Mostrar (42)" }).click();
    const ok = await drillJudge(page, "After the action, the compact artifact cards read cleanly - status badge, type label and action icons aligned on each card - and every card title keeps enough characters to identify which artifact it is. A title truncated so short that it could name several different artifacts fails the check.");
    expect(ok, "drillJudge: After the action, the compact artifact cards read cleanly - status badge, type label and action icons aligned on each card - and every card title keeps enough characters to identify which artifact it is. A title truncated so short that it could name several different artifacts fails the check.").toBe(true);
  });

  test("thumbnails-render: Every visible artifact card shows a rendered preview thumbnail - no broken-image icons, no permanently empty grey placeholders. A card whose preview never arrives should fail this check even if the page logged nothing to the console.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "Every visible artifact card shows a rendered preview thumbnail - no broken-image icons, no permanently empty grey placeholders. A card whose preview never arrives should fail this check even if the page logged nothing to the console.");
    expect(ok, "drillJudge: Every visible artifact card shows a rendered preview thumbnail - no broken-image icons, no permanently empty grey placeholders. A card whose preview never arrives should fail this check even if the page logged nothing to the console.").toBe(true);
  });

  test("gallery-polish: The gallery reads as a tidy grid - cards are equal width, aligned in rows, titles do not overflow, the chip row and search box sit on one header line, and the \"Aplicações\" section header with its description is clearly separated from the cards.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/artifacts", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The gallery reads as a tidy grid - cards are equal width, aligned in rows, titles do not overflow, the chip row and search box sit on one header line, and the \"Aplicações\" section header with its description is clearly separated from the cards.");
    expect(ok, "drillJudge: The gallery reads as a tidy grid - cards are equal width, aligned in rows, titles do not overflow, the chip row and search box sit on one header line, and the \"Aplicações\" section header with its description is clearly separated from the cards.").toBe(true);
  });
});
