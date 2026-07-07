---
description: Contrato do spine partilhado da Edição Legal (coleções, chaves, seeding)
---
# Contrato do Spine Legal v1

O contrato versionado que todas as aplicações do pack legal respeitam. As aplicações
(Núcleo, Prazos, Caixa Citius, Honorários, Contratos, Dossiê) são artefactos separados
que leem e escrevem estas coleções no espaço **partilhado da conta**
(`window.__ekoa.shared.*`, com `manifest.sharedData: true`, âmbito do proprietário).
Como são construídas independentemente, a deriva de esquema corrompe silenciosamente os
dados partilhados — por isso este contrato é a fonte de verdade copiada para o scaffold
de cada aplicação.

## Coleções partilhadas e chaves estrangeiras

```
clientes (raiz)
  └─ processos.clienteId → clientes.id
       ├─ prazos.processoId        → processos.id
       ├─ documentos.processoId    → processos.id
       ├─ eventos.processoId       → processos.id   (linha do tempo)
       ├─ lancamentos.processoId   → processos.id   (honorários; apenas pré-faturas)
       └─ tarefas.processoId       → processos.id   (FK opcional; tarefas avulsas permitidas)
```

Convenções de Portugal — `nif` (não CPF), `tribunal`/`comarca`, `numeroProcesso`,
`area`, `estado`. Strings PT-PT, sem emoji. O armazém é sem esquema fixo.

## Regra de seeding
Só o **Núcleo** semeia o spine, uma vez, quando vazio. Os satélites nunca semeiam: leem
o que o Núcleo escreveu (ou mostram vazio até existir).

## Partilhado vs local
As sete coleções acima são o spine PARTILHADO. O estado de UI e rascunhos próprios de
cada aplicação ficam nos dados privados dessa aplicação (`window.__ekoa.*`, isolamento
por defeito), nunca no spine.

## Versionamento
Alterações aditivas (novos campos opcionais) são retrocompatíveis. Uma alteração
disruptiva é um novo `spine-v2` com migração; nunca se muda em silêncio o significado
de um campo enquanto aplicações v1 ainda o leem.

> Nota de migração: este pacote é um subconjunto curado, agente-visível, do material em
> `ekoa-data/legal-spine/`. A lógica determinística (formas de campos, seeding, validação)
> é reimplementada em TypeScript tipado no módulo `legal/` (ch08 §8.1 regra sem-executáveis,
> linha 11/16); a importação completa da baseline é o passo de cutover (ch10).
