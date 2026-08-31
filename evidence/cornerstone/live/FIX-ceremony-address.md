# Cornerstone live evidence - the ceremony address fix

Date: 2026-08-31. Machine: goncalos-macbook-pro (Apple Silicon). Stack: main + the siteUrl fix.

## Before the fix - the daemon guessed https and dropped the port
```
Aviso: a pagina nao abriu automaticamente (page.goto: net::ERR_CONNECTION_TIMED_OUT at https://127.0.0.1/
  - navigating to "https://127.0.0.1/", waiting until "domcontentloaded"
).
Escreva o endereco na janela: https://127.0.0.1
```

## After the fix - the halt carries the address the run actually resolved
```json
{
  "runId": "48e9b0cc-a06d-4129-b9f1-52b9469e1bd2",
  "status": "needs_credentials",
  "credentialRequest": {
    "stepIndex": 1,
    "resumeFromStepIndex": 0,
    "origin": "127.0.0.1",
    "siteUrl": "http://127.0.0.1:45180",
    "integrationKey": "browser",
    "portalDeepLink": "/cofre?origin=127.0.0.1&siteUrl=http%3A%2F%2F127.0.0.1%3A45180",
    "mode": "ceremony",
    "reason": "127.0.0.1 answered with a sign-in wall, and only a person at your machine can get past it",
    "ceremony": {
      "operation": "login",
      "relayId": "rly_29a4052b80d246029575",
      "automationName": "Listar pedidos pendentes no painel",
      "siteOrigin": "127.0.0.1",
      "siteUrl": "http://127.0.0.1:45180",
      "reason": "127.0.0.1 answered with a sign-in wall, and only a person at your machine can get past it",
      "expiresAt": "2026-08-31T10:02:24.771Z"
    }
  }
}
```

## After the fix - the daemon opens the real address (no warning, no timeout)
```
  AUTENTICAÇÃO NECESSÁRIA NESTE COMPUTADOR
==============================================================
  Iniciar sessão em 127.0.0.1 para continuar a automação
  Endereço: http://127.0.0.1:45180

  Abre-se uma janela normal do Chrome (a sua sessão fica guardada,
  por isso só precisa de fazer isto uma vez por site).
```

## The window landed on the fixture
```
$ osascript -e "tell application \"System Events\" to tell (first process whose unix id is 92568) to get name of windows"
Translate this page?, Portal Fixture - Google Chrome

$ osascript -e "tell application \"Google Chrome\" to get URL of active tab of every window"
http://127.0.0.1:45180/
```

Chrome profile dir is now port-aware: ~/.ekoa-bridge/ceremony-profiles/127.0.0.1-45180
