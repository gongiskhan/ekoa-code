---
name: Cobranças
purpose: Contas a receber e recuperação de créditos de um escritório de advogados — dívidas (com prestações), planos de lembretes por perfil, envio de emails pelas Integrações do espaço de trabalho, reconciliação de extratos bancários e linha do tempo auditável por dívida e por cliente.

data_model:
  dividas:
    fields:
      id: string
      clienteId: string            # id na coleção PARTILHADA `clientes` (base comum do espaço de trabalho)
      descricao: string
      numeroFatura: string?
      valor: number                # EUR, 2 casas
      dataVencimento: iso_date
      estado: string               # aberta | parcial | paga | promessa | disputada | litigio | incobravel | pausada
      origem: string               # manual | fatura | honorarios
      origemId: string?            # honorários: id do documento partilhado (chave de deduplicação da sincronização)
      origemRunRef: string?
      origemSnapshot: object?      # instantâneo dos campos mapeados (deteção de discrepâncias)
      prestacoes: array?           # [{ id, valor, dataVencimento, estado, promessaData? }]
      promessaData: iso_date?
      jurosAplicados: object?      # { valor, custoFixo, ate, aplicadoEm } — só por ação explícita do utilizador
      notas: string?
    indexed_by: id
  clientes_cobranca:
    fields:
      id: string
      clienteId: string            # overlay sobre a base comum de clientes; nunca duplica o cliente
      perfilId: string?
      idioma: string               # pt | en — idioma de comunicação com o cliente
      naoContactar: boolean
      chasingPausado: boolean
      emLitigio: boolean
      insolvente: boolean
      notas: string?
    indexed_by: id
  perfis:
    fields:
      id: string
      nome: string
      tom: string                  # suave | assertivo
      lembretes: array             # plano de escalonamento [{ id, offsetDias, tipoAcao, templateGrupo, ativo }]
      templates: array             # [{ id, grupo, idioma, tipo, nome, assunto?, corpo }]
      acoesAuto: object            # { email: 'tarefa' | 'rascunho' | 'auto' } — 'rascunho' por omissão (aprovação prévia)
      coalescerEmails: boolean
      limites: object              # { maxEmailsPorSemana, horasSilencio: { inicio, fim } }
      juros: object                # { ativo, tipo, custoFixoRecuperacao } — sugestões, nunca aplicação automática
    indexed_by: id
  tipos_acao:
    fields:
      id: string
      chave: string
      nomePt: string
      nomeEn: string
      icone: string
      autoExecutavel: boolean
      embutido: boolean
    indexed_by: id
  tarefas_cobranca:
    fields:
      id: string
      dividaId: string
      prestacaoId: string?
      clienteId: string
      tipoAcao: string
      titulo: string
      conteudo: string             # guião/carta já renderizados, prontos a usar
      estado: string               # pendente | concluida | ignorada
      resultado: string?           # atendido | voicemail | promessa | disputa | sem-resposta
      promessaData: iso_date?
      lembreteChave: string?       # chave do passo executado (deduplicação do escalonamento)
    indexed_by: id
  fila_envios:
    fields:
      id: string
      clienteId: string
      destinatario: string
      assunto: string
      corpo: string
      itens: array                 # [{ dividaId, prestacaoId? }] — digest quando > 1
      estado: string               # rascunho | enviado | erro | ignorada
      erro: string?
      integrationKey: string?
      actionName: string?
      enviadoEm: iso_date?
      lembreteChaves: array?       # chaves de passo cobertas por este envio (deduplicação)
      draftId: string?             # rascunho criado na caixa do fornecedor (Outlook/Gmail)
      draftWebLink: string?        # ligação direta para abrir o rascunho no email
      draftIntegrationKey: string?
      draftErro: string?           # falha visível na criação do rascunho no fornecedor
    indexed_by: id
  linha_tempo:
    fields:
      id: string
      clienteId: string
      dividaId: string?
      prestacaoId: string?
      tipo: string                 # email-enviado | erro-envio | tarefa-criada | contacto | promessa | pagamento | estado | sync | match | ...
      titulo: string
      detalhe: string?
      conteudo: string?            # conteúdo renderizado, para auditoria/tribunal
      data: iso_date
    indexed_by: id
  pagamentos:
    fields:
      id: string
      clienteId: string
      dividaId: string
      prestacaoId: string?
      valor: number
      data: iso_date
      metodo: string?
      transacaoId: string?         # transação de extrato que originou o pagamento
      notas: string?
    indexed_by: id
  extratos_transacoes:
    fields:
      id: string
      fingerprint: string          # data|valor|descritivo-normalizado — deduplicação entre extratos sobrepostos
      data: iso_date
      descricao: string
      descricaoNormalizada: string
      valor: number
      tipo: string                 # credito | debito
      saldo: number?
      origemFicheiro: string?
      estado: string               # nova | sugerida | conciliada | ignorada
      matchDividaId: string?
      matchPrestacaoId: string?
      pagamentoId: string?
      matchAuto: boolean?
      sugestoes: array?            # candidatos apresentados ao utilizador (confiança + motivos)
      matchInfo: string?
    indexed_by: id
  regras_correspondencia:
    fields:
      id: string
      clienteId: string
      padrao: string               # descritivo normalizado (assinatura estável do pagador)
      ativa: boolean
      criadaDeTransacaoId: string?
    indexed_by: id
  sync_avisos:
    fields:
      id: string
      dividaId: string
      documentoId: string
      tipo: string                 # alterado | removido
      detalhe: string
      estado: string               # aberto | resolvido
    indexed_by: id
  definicoes:
    fields:
      id: string
      chave: string                # 'singleton'
      idioma: string               # pt | en — idioma da interface, persistido servidor-side
      emailIntegrationKey: string? # integração de email escolhida (classificada 'email-send' pela plataforma)
      emailActionName: string?
      alocacao: string             # antiga-primeiro | recente-primeiro
      prazoPagamentoHonorarios: number
      iban: string?
      scoreLimiares: object
    indexed_by: id

external_dependencies:
  integrations:
    - microsoft-365            # ação send_email (capability email-send) — envio via /api/app-email
    - google-workspace         # ações send_email / send_email_simple (capability email-send)
  artifacts:
    - legal-honorarios         # leitura ESTRITA das pré-faturas emitidas (coleção partilhada `documentos`, origem 'honorarios')

capabilities:
  - name: listar_dividas
    description: Lista todas as dívidas registadas na app Cobranças.
    inputs: {}
    recipe:
      - { op: store.list, collection: dividas, returnAs: dividas }
    result_template: "{{captured.dividas.length}} dívida(s) na carteira de cobranças."
    mutates: false

  - name: listar_dividas_do_cliente
    description: Lista as dívidas de um cliente (pelo id do cliente na base comum do espaço de trabalho).
    inputs:
      clienteId: { type: string, required: true }
    recipe:
      - { op: store.query, collection: dividas, where: { field: clienteId, op: eq, value: "{{inputs.clienteId}}" }, returnAs: dividas }
    result_template: "{{captured.dividas.length}} dívida(s) do cliente."
    mutates: false

  - name: registar_divida
    description: Regista uma dívida manual (cliente da base comum, valor em EUR, vencimento ISO).
    inputs:
      clienteId: { type: string, required: true }
      descricao: { type: string, required: true }
      valor: { type: number, required: true }
      dataVencimento: { type: string, required: true }
      numeroFatura: { type: string, required: false }
    recipe:
      - { op: data.validate, rule: iso_date, input: "{{inputs.dataVencimento}}", failMessage: "dataVencimento tem de ser uma data ISO (AAAA-MM-DD)" }
      - { op: data.now, returnAs: agora }
      - op: store.create
        collection: dividas
        data:
          clienteId: "{{inputs.clienteId}}"
          descricao: "{{inputs.descricao}}"
          numeroFatura: "{{inputs.numeroFatura}}"
          valor: "{{inputs.valor}}"
          dataVencimento: "{{inputs.dataVencimento}}"
          estado: "aberta"
          origem: "manual"
        returnAs: divida
    result_template: "Dívida '{{captured.divida.descricao}}' registada (id {{captured.divida.id}})."
    mutates: true

  - name: listar_fila_de_envios
    description: Lista os emails de cobrança em rascunho à espera de aprovação.
    inputs: {}
    recipe:
      - { op: store.query, collection: fila_envios, where: { field: estado, op: eq, value: "rascunho" }, returnAs: rascunhos }
    result_template: "{{captured.rascunhos.length}} email(s) em rascunho por aprovar."
    mutates: false

  - name: listar_avisos_sincronizacao
    description: Lista as discrepâncias abertas entre dívidas sincronizadas e as pré-faturas de origem no Honorários.
    inputs: {}
    recipe:
      - { op: store.query, collection: sync_avisos, where: { field: estado, op: eq, value: "aberto" }, returnAs: avisos }
    result_template: "{{captured.avisos.length}} aviso(s) de sincronização em aberto."
    mutates: false

ui_actions:
  version: 1
  actions:
    - { id: ir-painel, kind: navigate, route: "/", labelPt: "Abrir o painel", description: "Navega para o painel de envelhecimento da dívida." }
    - { id: ir-dividas, kind: navigate, route: "/dividas", labelPt: "Abrir as dívidas", description: "Navega para a lista de dívidas." }
    - { id: nova-divida, kind: navigate, route: "/nova", labelPt: "Nova dívida", description: "Abre o formulário de registo de uma nova dívida (manual ou por leitura de fatura)." }
    - { id: ir-clientes, kind: navigate, route: "/clientes", labelPt: "Abrir os clientes", description: "Navega para a lista de clientes com o estado de cobrança." }
    - { id: novo-cliente, kind: navigate, route: "/clientes", labelPt: "Novo cliente", description: "Abre a lista de clientes, onde o botão Novo cliente cria um cliente na base comum do espaço de trabalho." }
    - { id: ir-fila, kind: navigate, route: "/fila", labelPt: "Abrir a fila de trabalho", description: "Navega para a fila de emails por aprovar e tarefas de cobrança." }
    - { id: ir-reconciliacao, kind: navigate, route: "/reconciliacao", labelPt: "Abrir a reconciliação", description: "Navega para a reconciliação de extratos bancários." }
    - { id: ir-perfis, kind: navigate, route: "/perfis", labelPt: "Abrir os perfis", description: "Navega para os perfis de cobrança (planos de lembretes e templates)." }
    - { id: ir-definicoes, kind: navigate, route: "/definicoes", labelPt: "Abrir as definições", description: "Navega para as definições (integração de email, idioma, IBAN, regras)." }
    - { id: destacar-envelhecimento, kind: highlight, target: painel-envelhecimento, labelPt: "Mostrar o envelhecimento", description: "Destaca os escalões de envelhecimento da dívida no painel." }
    - { id: sincronizar-honorarios, kind: custom, labelPt: "Sincronizar Honorários", description: "Importa como dívidas as pré-faturas emitidas no app Honorários (idempotente, nunca duplica)." }
    - { id: executar-correspondencia, kind: custom, labelPt: "Executar correspondência", description: "Corre a correspondência entre créditos bancários por conciliar e dívidas em aberto." }
    - { id: processar-lembretes, kind: custom, labelPt: "Processar lembretes", description: "Calcula os lembretes devidos hoje e cria os rascunhos de email e as tarefas correspondentes." }
---

# Cobranças

Aplicação de contas a receber e recuperação de créditos para escritórios de
advogados (edição jurídica Ekoa). Os clientes vêm da base COMUM do espaço de
trabalho (coleção partilhada `clientes`); a app acrescenta-lhes estado de
cobrança, nunca cria uma segunda base de clientes. As pré-faturas emitidas no
app Honorários entram como dívidas por sincronização idempotente (leitura
estrita). Todo o email sai exclusivamente pelas Integrações do espaço de
trabalho, através da classificação `email-send` da plataforma.
