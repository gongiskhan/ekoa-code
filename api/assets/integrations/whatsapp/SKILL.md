---
description: WhatsApp Business (Meta Cloud API) — receber mensagens por webhook (assinatura via app secret, verificação hub.challenge) e enviar texto, modelos aprovados e marcações de leitura.
---

# WhatsApp Business (Meta Cloud API)

Integração com a **WhatsApp Business Platform** (Cloud API) da Meta. Permite:

- **Receber** mensagens de WhatsApp através de um webhook assinado pela Meta.
- **Enviar** mensagens de texto (`send_message`), mensagens de modelo aprovado (`send_template`), marcar mensagens como lidas (`mark_read`) e resolver o URL de descarga de media recebida (`get_media_url`).

A Meta assina cada webhook com a **chave secreta da app** (app secret), não com o segredo do trigger — por isso o `webhookConfig.secretSource` aponta para o campo de credencial `app_secret`. A verificação inicial do webhook (o handshake `hub.challenge` em GET) usa o **segredo gerado pelo trigger** como *verify token*.

## Credenciais

| Campo | Descrição |
|-------|-----------|
| `access_token` | Token de acesso permanente (System User, permissão `whatsapp_business_messaging`). Bearer das chamadas à Graph API. |
| `phone_number_id` | Identificador do número de telefone WhatsApp Business (não é o número em si). |
| `app_secret` | Chave secreta da app da Meta. Usada para verificar a assinatura `X-Hub-Signature-256` de cada webhook. |
| `graph_base_url` | Base da Graph API com versão, ex.: `https://graph.facebook.com/v20.0`. |

## Configuração na consola da Meta (manual)

O registo do webhook é **manual** (a Meta não expõe uma API de auto-registo de webhooks de conta WhatsApp). Depois de ligar a integração em Ekoa e criar um trigger de webhook:

1. Copie o **URL de callback** e o **token de verificação** que o Ekoa devolve ao criar o trigger.
2. Em **Meta for Developers > a sua app > WhatsApp > Configuração > Webhooks**:
   - **Callback URL** = o URL de callback do Ekoa (`.../hooks/<triggerId>`).
   - **Verify token** = o token (segredo) do trigger.
   - Clique em **Verificar e guardar**. A Meta faz um `GET` ao URL com `hub.mode=subscribe`, `hub.verify_token=<token>` e `hub.challenge=<valor>`; o Ekoa devolve o `hub.challenge` quando o token coincide.
3. Em **Campos de webhook**, subscreva o campo **`messages`**. Passa a receber uma notificação por cada mensagem recebida.

Cada mensagem recebida gera o evento **`message.received`** e é entregue ao backend do artefacto de destino (uma invocação por mensagem no envelope).

### Idempotência (importante para os backends)

A de-duplicação ao nível do webhook usa o **hash do corpo bruto** (o `dedupKey` é deliberadamente omitido): um envelope da Meta agrupa várias mensagens, pelo que usar o id da primeira mensagem descartaria um envelope posterior `[m1, m2]` cujo `m1` já tinha sido visto e **perderia o `m2`**. Assim, só se de-duplicam as re-entregas byte-a-byte idênticas da Meta. **O backend do artefacto TEM de de-duplicar por `id` da mensagem (wamid)** — a mesma mensagem pode ser entregue mais do que uma vez (re-tentativas de dispatch ou envelopes distintos que reincluam a mesma mensagem).

## Ações

- **`send_message`** — envia texto. Args: `to` (E.164 sem `+`, ex.: `351912345678`), `text`.
- **`send_template`** — envia um modelo aprovado (obrigatório para iniciar conversas fora da janela de 24 h). Args: `to`, `template_name`, `language` (ex.: `pt_PT`).
- **`mark_read`** — marca uma mensagem recebida como lida. Args: `message_id` (wamid).
- **`get_media_url`** — resolve o URL temporário de descarga de um ficheiro de media recebido. Args: `media_id`.

Todas as ações de envio usam `POST {{graph_base_url}}/{{phone_number_id}}/messages`; `get_media_url` usa `GET {{graph_base_url}}/{{media_id}}`. O cabeçalho `Authorization: Bearer {{access_token}}` é injetado em execução — as credenciais nunca são expostas ao agente.
