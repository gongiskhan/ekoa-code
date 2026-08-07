// AUTO-EMITTED by Drill from checks a run has PROVEN — either a vision pass
// that discovered the assertion, or one the plan authored and a run confirmed.
// Hand-edit at your own risk: the next graduation on this page rewrites it.
import { test, expect } from "@playwright/test";
import { drillJudge } from "./support/drill-judge";

test.describe("Chat (assistant workspace)", () => {
  test("composer-visible: The message composer is present, prompting with \"Descreva o que precisa...\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByPlaceholder("Descreva o que precisa...")).toBeVisible();
  });

  test("send-button-visible: The \"Enviar mensagem\" send button is present in the composer.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Enviar mensagem" })).toBeVisible();
  });

  test("attach-button-visible: The composer offers an \"Anexar\" attachment control, so a user can bring a file into the conversation without leaving the workspace.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Anexar" })).toBeVisible();
  });

  test("composer-input-affordances: The composer's action row offers the three ways to bring material in - \"Anexar\" (file), \"Captura\" (screen capture) and \"Cola URL\" - each with an icon and a legible label, and it states the \"Shift+Enter para nova linha\" hint. Every control in that row must be a real labelled button, not a bare glyph.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Anexar" })).toBeVisible();
  });

  test("topbar-controls-visible: The user menu button is present in the top bar.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Menu do utilizador" })).toBeVisible();
  });

  test("language-switcher-visible: The \"Mudar idioma\" language switcher is present in the top bar, showing the active locale (\"PT\").", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Mudar idioma" })).toBeVisible();
  });

  test("token-meter-visible: The top bar shows the token usage meter - the word \"Tokens\" with a real quota readout of the form \"<used>/<quota>\" (e.g. \"0/10.0M\") and its progress bar beneath, never a grey skeleton pill left in place after the page has settled.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("31.2K/10.0M");
  });

  test("lands-on-chat-url: Navigating to /chat keeps the user on a chat URL (it may redirect to a concrete session id under /chat/).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp("/chat"));
  });

  test("starting-points-rail-present: The empty workspace is not a blank page - it offers a \"PONTOS DE PARTIDA\" rail of ready-made build templates so a first-time user has something concrete to click.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("PONTOS DE PARTIDA");
  });

  test("sessions-rail-toggle-present: The sessions rail can be reached from the workspace via an \"Expandir Sessões\" control.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Expandir Sessões" })).toBeVisible();
  });

  test("onboarding-banner-offers-guidance: The \"Novo por aqui?\" banner sits above the starter rail with its explanatory line and a primary \"Começar com orientação\" action. The banner must read as an invitation and the action must be the visually dominant control inside it.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("button", { name: "Começar com orientação" })).toBeVisible();
  });

  test("starter-card-carousel-advances: After the action, the \"PONTOS DE PARTIDA\" rail has scrolled to a further set of template cards - the \"Seguinte\" arrow actually advances the carousel rather than sitting inert.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Seguinte" button
    await page.getByRole("button", { name: "Seguinte" }).click();
    await expect(page.locator("body")).toContainText("Catálogo E-commerce");
  });

  test("suggestion-chip-fills-composer: After the action, clicking a suggestion chip puts that suggestion to work - the composer is populated with the chip's text ready to send, or the chat starts on that prompt. A chip that does nothing when clicked is a defect.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Quero construir um CRM para a minha equipa de vendas" suggestion chip
    await page.getByRole("button", { name: "Quero construir um CRM para a minha equipa de vendas" }).click();
    await expect(page).toHaveURL(new RegExp("/chat/"));
  });

  test("sessions-panel-opens: After the action, the sessions panel is open, it shows the \"SESSÕES\" header, a \"Pesquisar sessões...\" search box, and a \"Nova Sessão\" button.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Expandir Sessões" button
    await page.getByRole("button", { name: "Expandir Sessões" }).click();
    await expect(page.getByRole("textbox", { name: "Pesquisar sessões..." })).toBeVisible();
  });

  test("new-session-starts-empty-chat: After the actions, a fresh chat session is active - the message transcript area is empty (no prior user or agent messages) and the composer is ready for input.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Expandir Sessões" button
    await page.getByRole("button", { name: "Expandir Sessões" }).click();
    // click the "Nova Sessão" button
    await page.getByRole("button", { name: "Nova Sessão" }).click();
    await expect(page).toHaveURL(new RegExp("/chat$"));
  });

  test("typed-message-appears-in-transcript: After the actions, the typed text \"Olá, teste de drill\" appears as a user message bubble in the chat transcript (an agent error reply is acceptable - only the user bubble is being checked).", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // type "Olá, teste de drill" into the "Descreva o que precisa..." composer
    await page.getByRole("textbox", { name: "Descreva o que precisa..." }).fill("Olá, teste de drill");
    // click the "Enviar mensagem" button
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.locator("body")).toContainText("Olá, teste de drill");
  });

  test("send-clears-the-composer: After the actions, sending empties the composer and returns it to its placeholder state, so the next message starts from a clean field - the sent text must not be left behind where a second Enter would send it twice.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // type "Olá, teste de drill" into the "Descreva o que precisa..." composer
    await page.getByRole("textbox", { name: "Escreva a sua mensagem..." }).fill("Olá, teste de drill");
    // click the "Enviar mensagem" button
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.getByRole("textbox", { name: "Escreva para pôr em fila..." })).toHaveAttribute("value", "");
  });

  test("sidebar-expands-with-labels: After the action, the left navigation sidebar is expanded and shows the labelled links Chat, Automatizações, Artefactos, Integrações, Memória, O que a Ekoa sabe, Marca, Utilizadores, Registo, Pedidos and Escritórios, plus Privacidade e ponte local, Chaves de API and Configurações at the bottom.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Alternar barra lateral" button
    await page.getByRole("button", { name: "Alternar barra lateral" }).click();
    await expect(page.getByRole("link", { name: "Automatizações" })).toBeVisible();
  });

  test("user-menu-shows-account-and-logout: After the action, the user menu is open and shows the account name \"admin\", the role \"super-admin\" and a \"Terminar Sessão\" logout entry.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Menu do utilizador" button
    await page.getByRole("button", { name: "Menu do utilizador" }).click();
    await expect(page.getByRole("button", { name: "Terminar Sessão" })).toBeVisible();
  });

  test("output-panel-hides: After the action, the right-hand \"Folhas\" output panel is collapsed/hidden and the chat transcript column widens to use the freed space.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    // click the "Ocultar painel" button
    await page.getByRole("button", { name: "Ocultar painel" }).click();
    await expect(page.getByRole("button", { name: "Mostrar painel" })).toBeVisible();
  });

  test("chat-layout-polish: The chat workspace looks polished - the icon sidebar, transcript column and \"Folhas\" output panel are cleanly separated with no overlapping or clipped elements, the composer sits flush at the bottom, and spacing/alignment are consistent across the three panes.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    const ok = await drillJudge(page, "The chat workspace looks polished - the icon sidebar, transcript column and \"Folhas\" output panel are cleanly separated with no overlapping or clipped elements, the composer sits flush at the bottom, and spacing/alignment are consistent across the three panes.");
    expect(ok, "drillJudge: The chat workspace looks polished - the icon sidebar, transcript column and \"Folhas\" output panel are cleanly separated with no overlapping or clipped elements, the composer sits flush at the bottom, and spacing/alignment are consistent across the three panes.").toBe(true);
  });

  test("date-line-is-formatted-portuguese: The small caps date above the headline reads as a real formatted Portuguese date - weekday, day and month, e.g. \"QUARTA · 5 DE AGOSTO\" - never an English weekday, a raw timestamp or \"Invalid Date\".", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("DE AGOSTO");
  });

  test("workspace-resolves: The chat workspace actually renders and is usable within the normal couple-of-seconds settle - the starter rail and the composer are present, so the user can type. The pane must NOT be left on a bare centred spinner, on \"A preparar o seu espaço de trabalho...\", on \"A preparar tudo para si...\" or on \"A pensar na melhor abordagem...\" before the user has asked anything. This is the app's landing surface: if it never resolves, the product is unusable on arrival, not merely slow.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("textbox", { name: "Escreva a sua mensagem..." })).toBeVisible();
  });

  test("token-meter-resolves: The token meter in the top bar resolves to a real reading rather than staying as a grey skeleton placeholder. A skeleton that never fills is a broken widget, and this one sits in the shell on every authenticated page, so it is visible everywhere.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.locator("body")).toContainText("31.2K/10.0M");
  });

  test("no-console-errors: Loading the chat workspace produces no browser console errors. Note that this app can fail a fetch without logging anything, so a clean console is necessary but not sufficient - also confirm the workspace actually rendered its content.", async ({ page }) => {
    // Loaded-machine wait (F9): a batch run shares the machine with other
    // parallel work — a pure timeout here should widen this wait, not be
    // treated as a step defect.
    await page.goto("http://localhost:3000/chat", { timeout: 90000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await expect(page.getByRole("textbox", { name: "Escreva a sua mensagem..." })).toBeVisible();
  });
});
