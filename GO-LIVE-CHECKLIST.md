# Checklist de go-live — ekoa-code

## Preparação e testes

- [ ] Correr a bateria completa de testes automatizados do `ekoa-code` e registar os resultados.
- [ ] Fazer um apanhado incremental das divergências entre a versão antiga e a nova, incluindo as correções mais recentes, e migrar o que estiver em falta.
- [ ] Importar para o `ekoa-code` o artefacto do ERP Brasil Salomão atualmente em produção e corrigir todos os problemas de importação encontrados.
- [ ] Correr a bateria de testes existente do artefacto BSM no `ekoa-code` e corrigir até ficar verde.
- [ ] Testar exaustivamente o ERP no ambiente novo com o agente e resolver as falhas encontradas.
- [ ] Confirmar que a integração referida como “do ouro” é Outlook e migrar as integrações SharePoint e Outlook para o `ekoa-code`.
- [ ] Testar manualmente, de ponta a ponta, o fluxo crítico de assinatura e SharePoint.
- [ ] Rever o relatório do Nicolas, o email com as últimas falhas e os pedidos anteriores; consolidar tudo numa lista única.
- [ ] Dar a lista completa ao agente e verificar, item a item, que tudo funciona na versão nova.

## Drill

- [ ] Correr um drill completo do Garrison sobre o `ekoa-code` e guardar o resultado.
- [ ] Se o drill revelar problemas, registá-los para seguimento; o resultado do drill não bloqueia esta fase.

## Go-live

- [ ] Confirmar que os testes, migrações e verificações acima estão concluídos e que eventuais falhas não bloqueantes estão registadas e têm responsável.
- [ ] Autorizar o go-live do `ekoa-code`.
- [ ] Após o go-live, trabalhar apenas na versão nova; limitar alterações na versão antiga a emergências de cliente.
