---
name: citius
description: Integração com o CITIUS / eTribunal (Portal dos Mandatários). Consulta notificações e processos, vai buscar todos os documentos de um processo e submete peças por automação semi-atendida com sessão capturada do advogado; escuta notificações por listener; consulta pública de distribuição sem autenticação. Não existe API oficial.
---

# CITIUS / eTribunal

Integração com o CITIUS e o seu sucessor eTribunal (IGFEJ / Ministério da Justiça) para o trabalho do mandatário: notificações, consulta de processos, documentos de um processo e submissão de peças, mais a consulta pública de distribuição. Corre em **automação semi-atendida** sobre uma **sessão capturada** do advogado.

## Realidade de arquitetura (importante)

Não existe API oficial do CITIUS/eTribunal. A superfície do mandatário é o Portal dos Mandatários (https://portal.tribunais.org.pt), cuja autenticação é sempre interativa - certificado digital da Ordem dos Advogados ou Chave Móvel Digital / Cartão de Cidadão via autenticacao.gov.pt, com autenticação de dois fatores. Não há credenciais de máquina.

Por isso, as três ações do mandatário são feitas por **automação semi-atendida**: o Ekoa conduz o portal com a **sessão capturada** do advogado (cookies obtidos após uma autenticação interativa), reutilizada até expirar. Esta integração é fina - guarda apenas configuração e delega o trabalho nas automações (padrão "integração por automação", via `automationBinding`).

A consulta pública de distribuição não precisa de sessão e é servida pelo serviço `citius-etribunal.ts` (`consultaPublica`).

## Modelo de segurança

Esta integração **não guarda palavra-passe**. A sessão do portal é capturada interativamente a partir do Ekoa local do advogado e guardada cifrada; nunca chega a um prompt de modelo nem a um log. Nas ações por automação, a sessão é entregue à automação apenas em `inputs.credentials` (fronteira de credenciais existente), com `passCredentials: true`.

## Ligação (uma vez)

A integração declara `authType: browser_session` e um bloco `sessionConnect` (`loginUrl`, `successUrlContains`, `guidePt`) no `config.json`. O fluxo genérico de ligação (`ekoa.integrations`: `connect-session` / `session-status` / `provision-automations`) usa-o assim:

1. A partir do Ekoa local, inicia a ligação desta integração (`connect-session`).
2. Abre-se uma janela do Portal dos Mandatários no perfil persistente de automação do utilizador; autentica-se uma vez (certificado da OA ou Chave Móvel Digital / Cartão de Cidadão).
3. O Ekoa captura a sessão, guarda-a cifrada no registo da integração (sempre por utilizador) e materializa as automações. A sessão é reutilizada até expirar; nessa altura pede nova autenticação.

## Ações disponíveis

Todas as ações do mandatário correm por **automação semi-atendida** sobre a **sessão capturada** (ver "Modelo de segurança"). A consulta pública não precisa de sessão.

### consultar_notificacoes (por automação; requer sessão)
Lista as notificações pendentes do mandatário (processo, data, tribunal, tipo de acto, se tem documento associado e o prazo).
- `desde` (string, opcional): data a partir da qual listar (AAAA-MM-DD).

### consultar_processo (por automação; requer sessão)
Consulta o estado e a tramitação completa (movimentos: data + acto) de um processo.
- `numeroProcesso` (string, obrigatório): número único de processo (ex.: `1234/26.0T8LSB`).

### fetch_documentos_processo (por automação; requer sessão)
Vai buscar **TODOS** os documentos/peças de um processo: enumera cada documento, descarrega o ficheiro e trata a paginação. Devolve a lista estruturada `[{nome, tipo, data, ficheiroRef}]`, destinada ao **dossiê** do processo (coleção `documentos`, `origem: 'citius'`) - ver `docs/integrations-citius.md`, secção "Documentos → dossiê".
- `numeroProcesso` (string, obrigatório).

### submeter_peca (por automação; requer sessão; altera dados)
Submete uma peça processual num processo e captura o comprovativo. Como altera dados, a primeira execução é sempre atendida pelo advogado.
- `numeroProcesso` (string, obrigatório)
- `tipoPeca` (string, obrigatório): ex. Requerimento, Contestação.
- `ficheiroBase64` (string, obrigatório): documento da peça em base64.

### consulta_publica_distribuicao (sem sessão)
Consulta pública da distribuição de processos em www.citius.mj.pt/portal/consultas. Apenas dados publicados; não acede ao processado privado.
- `numeroProcesso` (string) **ou** `nome` (string).

O resultado estruturado (nº processo / tribunal / data / espécie) é produzido pelo serviço `citius-etribunal.ts` (`consultaPublica`), que faz o parse da página WebForms.

## Escutar notificações (listener)

A skill declara um `listenerConfig` (ação de sondagem `consultar_notificacoes`). Ao ligar, o fluxo de ligação regista um **listener** (`ekoa.triggers create`, `kind: listener`) que sonda periodicamente a automação de notificações e despacha cada **NOVA** notificação para o backend do artefacto `legal-citius` (o mesmo alvo do intake de email). A deduplicação é por **marca de água** (`dedupCitiusNotificacoes`) reforçada pela restrição UNIQUE da fila durável. O **alerta IMAP** de email do tribunal (`legal-citius/onEmail`) continua a ser o sinal de **baixa latência**; a automação de notificações é o **fetcher** autoritativo. Ver `citius-connect.ts` (`buildCitiusNotificationTrigger`) e `docs/integrations-citius.md`.

## Ligação ação -> automação

As quatro ações do mandatário ligam-se a automações por `automationBinding`, com o marcador `automationTemplate` (`notificacoes`, `processo`, `documentos`, `submissao`). Os **modelos são conteúdo**: vivem em `automations/<templateKey>.json` nesta pasta e são carregados pelo serviço genérico (`integration-automations.ts`), com override em runtime. O provisionamento (`provision-automations`, ou `citius-connect.ts` -> `provisionCitiusAutomations`) materializa, por advogado, uma automação por modelo com id determinista `citius-<templateKey>-<utilizador>` e `source: {integrationKey, templateKey}`, grava uma **cópia por-advogado** da skill no sandbox e reescreve cada `automationId` para o da automação criada. Antes disso, as ações do mandatário devolvem `unknown_automation` - é o comportamento honesto até haver sessão e automações materializadas.

## Costura para a futura API (IGFEJ)

O serviço expõe uma interface `CitiusBackend` com duas implementações: `PortalAutomationBackend` (hoje - portal por automação) e `FutureApiBackend` (esboço - lança `not_available`). Quando a API de interoperabilidade do IGFEJ existir, liga-se aí sem alterar os chamadores (contacto: apoio@igfej.mj.pt).
