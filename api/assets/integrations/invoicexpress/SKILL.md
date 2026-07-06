---
description: InvoiceXpress - faturacao certificada pela AT (Autoridade Tributaria) para Portugal. Criar, finalizar, obter e enviar faturas, obter o PDF e exportar o SAF-T. Unico caminho de emissao de faturas em Ekoa.
---

# InvoiceXpress

Integracao com a **InvoiceXpress**, software de faturacao **certificado pela Autoridade Tributaria (AT)** para Portugal. Ekoa **NUNCA emite faturas nativamente** - toda a emissao legal de faturas passa por esta integracao. Uma fatura so tem valor fiscal depois de **finalizada**, momento em que a InvoiceXpress lhe atribui o **ATCUD**, o **numero de serie** e o **codigo QR** exigidos pela AT.

## Credenciais

| Campo | Descricao |
|-------|-----------|
| `account_name` | Nome da conta (subdominio), ex.: `aminhaempresa`. |
| `api_key` | Chave de API. Enviada como parametro `api_key` em cada pedido. |
| `api_base` | URL completo da conta, sem barra final: `https://<account_name>.app.invoicexpress.com`. |

Todos os pedidos usam `{{api_base}}` como base e a `api_key` e injetada como parametro de query em execucao - a chave nunca e exposta ao agente.

## Ciclo de vida de uma fatura

1. **`create_invoice`** - cria a fatura em **rascunho** (`draft`). Args: `date` (dd/mm/aaaa), `due_date`, `client` (objeto: `name`, `code`, `email`, `fiscal_id`, ...), `items` (lista de linhas: `name`, `unit_price`, `quantity`, `tax`, ...), `tax_exemption` (opcional), `observations` (opcional). Os campos `client` e `items` sao enviados **tal como fornecidos** (objeto e lista). Devolve o `id` da fatura.
2. **`finalize_invoice`** - muda o estado para `finalized`. Args: `invoice_id`. **Ato fiscal certificado e irreversivel**: e aqui que sao gerados o **ATCUD**, o **numero de serie** e o **codigo QR**. Depois de finalizada, a fatura nao pode ser apagada nem editada (apenas anulada por nota de credito).
3. **`get_invoice`** - le a fatura. Args: `invoice_id`. Quando ja finalizada, a resposta traz o `atcud`, o `sequence_number` (numero de serie) e o `qr_code_url` / `permalink`. **Estes campos vem sempre da resposta da InvoiceXpress, nunca sao inventados por Ekoa.**

## PDF e SAF-T (202-depois-repetir)

- **`get_invoice_pdf`** - obtem o PDF. Args: `invoice_id`. A InvoiceXpress gera o PDF de forma assincrona: a **primeira** chamada pode responder **202** (a gerar). Nesse caso, **volte a chamar** ate receber **200** com o URL do PDF em `output.pdfUrl`. O executor faz **uma** chamada por invocacao - a repeticao (poll) e responsabilidade de quem chama a acao.
- **`export_saft`** - exporta o ficheiro SAF-T de um mes/ano. Args: `month` (1-12), `year`. Tal como o PDF, pode responder **202** antes de devolver o URL do ficheiro; volte a chamar ate obter o URL.

## Envio por email

- **`email_invoice`** - envia a fatura por email. Args: `invoice_id`, `message` (objeto: `client` { `email`, `save` }, `subject`, `body`). O objeto `message` e enviado tal como fornecido.

## Regras (cited-or-silent)

- Nunca invente `atcud`, numero de serie, codigo QR ou qualquer campo fiscal. Estes valores **so** existem depois de `finalize_invoice` e sao lidos da resposta de `get_invoice`.
- A finalizacao e irreversivel. Confirme os dados (cliente, linhas, IVA, isencao) **antes** de chamar `finalize_invoice`.
- Se a serie de documentos ou o regime de IVA nao estiverem configurados na InvoiceXpress, a finalizacao falha - trate o erro devolvido, nao contorne a certificacao.
