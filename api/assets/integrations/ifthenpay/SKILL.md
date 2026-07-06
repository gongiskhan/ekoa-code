---
description: Ifthenpay (Portugal) - gerar referencias Multibanco, iniciar pagamentos MB WAY e receber a confirmacao de pagamento por callback GET validado com a chave anti-phishing.
---

# Ifthenpay

Integracao com a **Ifthenpay**, o agregador de pagamentos portugues. Permite:

- **Gerar** referencias **Multibanco** (Entidade + Referencia) para uma encomenda (`generate_multibanco_reference`).
- **Iniciar** pagamentos **MB WAY** e consultar o seu estado (`mbway_payment`, `mbway_status`).
- **Receber** a confirmacao de pagamento por **callback** quando o cliente paga.

A Ifthenpay nao expoe webhooks POST assinados por HMAC. A confirmacao chega por um **GET** ao URL de callback, com os dados do pagamento em parametros de query e uma **chave anti-phishing** partilhada no parametro `chave`. Por isso a integracao declara `webhookConfig.getCallback`: o Ekoa trata esse GET como um evento real, valida a `chave` em tempo constante contra a chave anti-phishing guardada, e so depois enfileira o evento.

## Credenciais

| Campo | Descricao |
|-------|-----------|
| `api_base` | Base da API da Ifthenpay, sem barra final. Normalmente `https://api.ifthenpay.com`. |
| `mb_key` | Chave Multibanco (MB Key). Usada para gerar referencias Multibanco. |
| `mbway_key` | Chave MB WAY (SPG). Necessaria apenas para MB WAY. |
| `anti_phishing_key` | Chave anti-phishing. Valida cada callback de pagamento (parametro `chave`). |
| `backoffice_key` | Chave de backoffice (opcional), para operacoes administrativas. |

## Callback de pagamento (registo manual)

O registo do URL de callback e **manual** no backoffice da Ifthenpay. Depois de ligar a integracao em Ekoa e criar um trigger de webhook:

1. Copie o **URL de callback** que o Ekoa devolve ao criar o trigger (`.../hooks/<triggerId>`).
2. No backoffice da Ifthenpay, em **Definicoes > Callback**, registe o URL no formato:

   ```
   <origem-cortex>/hooks/<triggerId>?chave=[ANTI_PHISHING_KEY]&referencia=[REFERENCIA]&valor=[VALOR]&datahorapag=[DATA_HORA_PAGAMENTO]
   ```

   A Ifthenpay substitui os campos entre parenteses retos (`[...]`) pelos valores reais de cada pagamento. O `chave=[ANTI_PHISHING_KEY]` transporta a sua chave anti-phishing.
3. Cada pagamento confirmado gera o evento **`payment.confirmed`**, entregue ao destino do trigger (automacao ou backend do artefacto). O corpo do evento e o objeto de parametros de query do callback (`referencia`, `valor`, `datahorapag`, ...).

### Validacao e idempotencia

- **Validacao:** o Ekoa compara o parametro `chave` com a chave anti-phishing guardada, em tempo constante. Se nao coincidir, o callback e rejeitado com **401** e nada e enfileirado. A `chave` correta responde **200** com o corpo `OK` (a Ifthenpay reenvia o callback ate ver exatamente `OK`).
- **Idempotencia:** a de-duplicacao usa o hash dos valores de `referencia`, `valor` e `datahorapag` (nunca inclui a `chave`). Um reenvio identico do mesmo pagamento devolve **200 OK** sem criar um segundo evento.

## Acoes

- **`generate_multibanco_reference`** - gera uma referencia Multibanco. Args: `order_id`, `amount` (ex.: `10.50`), `description` (opcional), `expiry_days` (opcional). Devolve `Entidade` + `Referencia`.
- **`mbway_payment`** - inicia um pagamento MB WAY. Args: `order_id`, `amount`, `mobile_number` (ex.: `351#912345678`), `description` (opcional). Devolve um `RequestId`.
- **`mbway_status`** - consulta o estado de um pagamento MB WAY. Args: `request_id` (o `RequestId` devolvido por `mbway_payment`).

Todas as acoes usam `{{api_base}}` como base e injetam as chaves (`mb_key`, `mbway_key`) em execucao - as credenciais nunca sao expostas ao agente. A confirmacao final de que um pagamento foi concluido chega **sempre** pelo callback (`payment.confirmed`), nao pela resposta sincrona de `generate_multibanco_reference` (que apenas cria a referencia).
