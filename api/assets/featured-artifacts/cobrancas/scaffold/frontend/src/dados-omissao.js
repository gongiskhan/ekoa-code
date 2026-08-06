/*
 * DADOS POR OMISSÃO da app - os dois perfis de cobrança, os tipos de ação
 * embutidos e a linha de definições. Fonte ÚNICA para a auto-sementeira
 * (instância featured/nova arranca vazia) e ESPELHO de seed-data.json
 * (usado pela plataforma ao criar forks) - um teste garante que não divergem.
 */
import { listar, criar, disponivel } from './ekoa.js';

export const DADOS_OMISSAO = {
  "tipos_acao": [
    {
      "chave": "email",
      "nomePt": "Email",
      "nomeEn": "Email",
      "icone": "email",
      "autoExecutavel": true,
      "embutido": true
    },
    {
      "chave": "telefone",
      "nomePt": "Chamada telefónica",
      "nomeEn": "Phone call",
      "icone": "telefone",
      "autoExecutavel": false,
      "embutido": true
    },
    {
      "chave": "carta",
      "nomePt": "Carta",
      "nomeEn": "Letter",
      "icone": "carta",
      "autoExecutavel": false,
      "embutido": true
    }
  ],
  "definicoes": [
    {
      "chave": "singleton",
      "idioma": "pt",
      "emailIntegrationKey": null,
      "emailActionName": null,
      "alocacao": "antiga-primeiro",
      "prazoPagamentoHonorarios": 30,
      "iban": "",
      "scoreLimiares": {
        "sugerirSuave": 70,
        "sugerirAssertivo": 40
      }
    }
  ],
  "perfis": [
    {
      "nome": "Cliente recorrente",
      "tom": "suave",
      "descricao": "Clientes de casa: menos contactos, tom cordial, intervalos largos. Escalada tardia para passos formais.",
      "coalescerEmails": true,
      "acoesAuto": {
        "email": "rascunho"
      },
      "limites": {
        "maxEmailsPorSemana": 1,
        "horasSilencio": {
          "inicio": "20:00",
          "fim": "08:00"
        }
      },
      "juros": {
        "ativo": false,
        "tipo": "comercial",
        "custoFixoRecuperacao": 40
      },
      "lembretes": [
        {
          "id": "l1",
          "offsetDias": -3,
          "tipoAcao": "email",
          "templateGrupo": "email-pre-aviso",
          "ativo": true
        },
        {
          "id": "l2",
          "offsetDias": 10,
          "tipoAcao": "email",
          "templateGrupo": "email-lembrete",
          "ativo": true
        },
        {
          "id": "l3",
          "offsetDias": 30,
          "tipoAcao": "telefone",
          "templateGrupo": "guiao-chamada",
          "ativo": true
        },
        {
          "id": "l4",
          "offsetDias": 55,
          "tipoAcao": "carta",
          "templateGrupo": "carta-interpelacao",
          "ativo": true
        }
      ],
      "templates": [
        {
          "id": "rec-email-pre-aviso-pt",
          "grupo": "email-pre-aviso",
          "idioma": "pt",
          "tipo": "email",
          "nome": "Pré-aviso de vencimento",
          "assunto": "Aviso de vencimento próximo — {{descricao}}",
          "corpo": "Exmo.(a) Sr.(a) {{nome}},\n\nPermitimo-nos recordar que a fatura {{descricao}}, no valor de {{valor}}, tem vencimento em {{dataVencimento}}.\n\nCaso o pagamento já esteja agendado, agradecemos que desconsidere esta mensagem.\n\nIBAN para pagamento: {{iban}}\n\nCom os melhores cumprimentos,"
        },
        {
          "id": "rec-email-pre-aviso-en",
          "grupo": "email-pre-aviso",
          "idioma": "en",
          "tipo": "email",
          "nome": "Due date reminder",
          "assunto": "Upcoming due date — {{descricao}}",
          "corpo": "Dear {{nome}},\n\nThis is a courtesy reminder that invoice {{descricao}}, in the amount of {{valor}}, is due on {{dataVencimento}}.\n\nIf payment has already been arranged, please disregard this message.\n\nIBAN for payment: {{iban}}\n\nKind regards,"
        },
        {
          "id": "rec-email-lembrete-pt",
          "grupo": "email-lembrete",
          "idioma": "pt",
          "tipo": "email",
          "nome": "Lembrete cordial",
          "assunto": "Lembrete de pagamento — {{descricao}}",
          "corpo": "Exmo.(a) Sr.(a) {{nome}},\n\nVerificamos que se encontram por regularizar os seguintes valores:\n\n{{listaDividas}}\n\nTotal em dívida: {{saldoTotal}}\n\nAgradecemos a regularização na sua melhor conveniência. Para qualquer esclarecimento, o escritório está ao dispor.\n\nIBAN para pagamento: {{iban}}\n\nCom os melhores cumprimentos,"
        },
        {
          "id": "rec-email-lembrete-en",
          "grupo": "email-lembrete",
          "idioma": "en",
          "tipo": "email",
          "nome": "Courtesy reminder",
          "assunto": "Payment reminder — {{descricao}}",
          "corpo": "Dear {{nome}},\n\nOur records show the following amounts outstanding:\n\n{{listaDividas}}\n\nTotal outstanding: {{saldoTotal}}\n\nWe would appreciate settlement at your earliest convenience. Should you have any questions, we remain at your disposal.\n\nIBAN for payment: {{iban}}\n\nKind regards,"
        },
        {
          "id": "rec-guiao-chamada-pt",
          "grupo": "guiao-chamada",
          "idioma": "pt",
          "tipo": "telefone",
          "nome": "Guião de chamada",
          "assunto": null,
          "corpo": "Guião — chamada de acompanhamento\n\nCliente: {{nome}}\nValores em dívida:\n{{listaDividas}}\nTotal: {{saldoTotal}}\n\n1. Cumprimentar e identificar o escritório.\n2. Confirmar que fala com a pessoa responsável pelos pagamentos.\n3. Referir os valores em aberto acima e perguntar se existe algum impedimento.\n4. Se possível, obter uma data concreta de pagamento (registar como promessa).\n5. Agradecer e confirmar os dados de pagamento (IBAN: {{iban}})."
        },
        {
          "id": "rec-guiao-chamada-en",
          "grupo": "guiao-chamada",
          "idioma": "en",
          "tipo": "telefone",
          "nome": "Call script",
          "assunto": null,
          "corpo": "Script — follow-up call\n\nCustomer: {{nome}}\nOutstanding items:\n{{listaDividas}}\nTotal: {{saldoTotal}}\n\n1. Greet and identify the firm.\n2. Confirm you are speaking with the person responsible for payments.\n3. Mention the outstanding amounts above and ask whether anything is blocking payment.\n4. Where possible, obtain a concrete payment date (record it as a promise to pay).\n5. Thank them and confirm payment details (IBAN: {{iban}})."
        },
        {
          "id": "rec-carta-interpelacao-pt",
          "grupo": "carta-interpelacao",
          "idioma": "pt",
          "tipo": "carta",
          "nome": "Carta de interpelação",
          "assunto": "Interpelação para pagamento",
          "corpo": "REGISTADA COM AVISO DE RECEÇÃO\n\nExmo.(a) Sr.(a) {{nome}},\n\nAssunto: Interpelação para pagamento — {{descricao}}\n\nNa qualidade de mandatários do credor, vimos pela presente interpelar V. Exa. para, no prazo máximo de 10 (dez) dias a contar da receção desta carta, proceder ao pagamento da quantia de {{valor}}, correspondente a {{descricao}}, vencida em {{dataVencimento}} e há {{diasAtraso}} dias por regularizar.\n\nO pagamento deverá ser efetuado por transferência bancária para o IBAN {{iban}}.\n\nDecorrido o prazo indicado sem que se mostre efetuado o pagamento, serão acionados, sem nova interpelação, os meios judiciais competentes para cobrança coerciva do crédito, acrescido dos juros de mora vencidos e vincendos e das despesas de cobrança legalmente devidas.\n\nCom os melhores cumprimentos,"
        }
      ]
    },
    {
      "nome": "Cliente pontual",
      "tom": "assertivo",
      "descricao": "Clientes pontuais: primeiro lembrete cedo, cadência apertada, escalada rápida para passos formais.",
      "coalescerEmails": true,
      "acoesAuto": {
        "email": "rascunho"
      },
      "limites": {
        "maxEmailsPorSemana": 2,
        "horasSilencio": {
          "inicio": "20:00",
          "fim": "08:00"
        }
      },
      "juros": {
        "ativo": false,
        "tipo": "comercial",
        "custoFixoRecuperacao": 40
      },
      "lembretes": [
        {
          "id": "l1",
          "offsetDias": -5,
          "tipoAcao": "email",
          "templateGrupo": "email-pre-aviso",
          "ativo": true
        },
        {
          "id": "l2",
          "offsetDias": 1,
          "tipoAcao": "email",
          "templateGrupo": "email-firme",
          "ativo": true
        },
        {
          "id": "l3",
          "offsetDias": 8,
          "tipoAcao": "email",
          "templateGrupo": "email-urgente",
          "ativo": true
        },
        {
          "id": "l4",
          "offsetDias": 15,
          "tipoAcao": "telefone",
          "templateGrupo": "guiao-chamada",
          "ativo": true
        },
        {
          "id": "l5",
          "offsetDias": 25,
          "tipoAcao": "carta",
          "templateGrupo": "carta-interpelacao",
          "ativo": true
        }
      ],
      "templates": [
        {
          "id": "pon-email-pre-aviso-pt",
          "grupo": "email-pre-aviso",
          "idioma": "pt",
          "tipo": "email",
          "nome": "Pré-aviso de vencimento",
          "assunto": "Vencimento em {{dataVencimento}} — {{descricao}}",
          "corpo": "Exmo.(a) Sr.(a) {{nome}},\n\nInformamos que a fatura {{descricao}}, no valor de {{valor}}, vence em {{dataVencimento}}.\n\nSolicitamos que assegure o pagamento até essa data, por transferência para o IBAN {{iban}}.\n\nCom os melhores cumprimentos,"
        },
        {
          "id": "pon-email-pre-aviso-en",
          "grupo": "email-pre-aviso",
          "idioma": "en",
          "tipo": "email",
          "nome": "Due date notice",
          "assunto": "Due on {{dataVencimento}} — {{descricao}}",
          "corpo": "Dear {{nome}},\n\nPlease note that invoice {{descricao}}, in the amount of {{valor}}, falls due on {{dataVencimento}}.\n\nKindly ensure payment by that date, by bank transfer to IBAN {{iban}}.\n\nKind regards,"
        },
        {
          "id": "pon-email-firme-pt",
          "grupo": "email-firme",
          "idioma": "pt",
          "tipo": "email",
          "nome": "Aviso de fatura vencida",
          "assunto": "Fatura vencida — {{descricao}}",
          "corpo": "Exmo.(a) Sr.(a) {{nome}},\n\nVerificamos que os seguintes valores se encontram vencidos e por regularizar:\n\n{{listaDividas}}\n\nTotal em dívida: {{saldoTotal}}\n\nSolicitamos a regularização no prazo de 5 dias úteis, por transferência para o IBAN {{iban}}. Caso o pagamento já tenha sido efetuado, agradecemos o envio do respetivo comprovativo.\n\nCom os melhores cumprimentos,"
        },
        {
          "id": "pon-email-firme-en",
          "grupo": "email-firme",
          "idioma": "en",
          "tipo": "email",
          "nome": "Overdue invoice notice",
          "assunto": "Overdue invoice — {{descricao}}",
          "corpo": "Dear {{nome}},\n\nThe following amounts are overdue:\n\n{{listaDividas}}\n\nTotal outstanding: {{saldoTotal}}\n\nWe request settlement within 5 business days, by bank transfer to IBAN {{iban}}. If payment has already been made, please send us the corresponding proof.\n\nKind regards,"
        },
        {
          "id": "pon-email-urgente-pt",
          "grupo": "email-urgente",
          "idioma": "pt",
          "tipo": "email",
          "nome": "Último aviso antes de escalada",
          "assunto": "Último aviso — {{descricao}} vencida há {{diasAtraso}} dias",
          "corpo": "Exmo.(a) Sr.(a) {{nome}},\n\nApesar dos avisos anteriores, os seguintes valores permanecem por regularizar:\n\n{{listaDividas}}\n\nTotal em dívida: {{saldoTotal}}\n\nNa ausência de pagamento ou de contacto de V. Exa. nos próximos 5 dias, o assunto seguirá para os passos formais de cobrança, com os encargos adicionais legalmente devidos.\n\nIBAN para pagamento imediato: {{iban}}\n\nCom os melhores cumprimentos,"
        },
        {
          "id": "pon-email-urgente-en",
          "grupo": "email-urgente",
          "idioma": "en",
          "tipo": "email",
          "nome": "Final notice before escalation",
          "assunto": "Final notice — {{descricao}} overdue by {{diasAtraso}} days",
          "corpo": "Dear {{nome}},\n\nDespite previous notices, the following amounts remain unpaid:\n\n{{listaDividas}}\n\nTotal outstanding: {{saldoTotal}}\n\nIn the absence of payment or contact from you within the next 5 days, this matter will proceed to formal collection steps, with the additional charges legally due.\n\nIBAN for immediate payment: {{iban}}\n\nKind regards,"
        },
        {
          "id": "pon-guiao-chamada-pt",
          "grupo": "guiao-chamada",
          "idioma": "pt",
          "tipo": "telefone",
          "nome": "Guião de chamada",
          "assunto": null,
          "corpo": "Guião — chamada de cobrança\n\nCliente: {{nome}}\nValores vencidos:\n{{listaDividas}}\nTotal: {{saldoTotal}}\n\n1. Cumprimentar e identificar o escritório.\n2. Confirmar que fala com a pessoa responsável pelos pagamentos.\n3. Referir que os valores acima estão vencidos apesar dos avisos escritos.\n4. Pedir uma data CONCRETA de pagamento (registar como promessa) ou o motivo do não pagamento (registar como disputa, se for o caso).\n5. Informar que, sem pagamento, o processo segue para interpelação formal.\n6. Confirmar os dados de pagamento (IBAN: {{iban}})."
        },
        {
          "id": "pon-guiao-chamada-en",
          "grupo": "guiao-chamada",
          "idioma": "en",
          "tipo": "telefone",
          "nome": "Call script",
          "assunto": null,
          "corpo": "Script — collection call\n\nCustomer: {{nome}}\nOverdue items:\n{{listaDividas}}\nTotal: {{saldoTotal}}\n\n1. Greet and identify the firm.\n2. Confirm you are speaking with the person responsible for payments.\n3. State that the amounts above are overdue despite written notices.\n4. Ask for a CONCRETE payment date (record as a promise) or the reason for non-payment (record as a dispute, if applicable).\n5. Explain that without payment the matter proceeds to a formal demand letter.\n6. Confirm payment details (IBAN: {{iban}})."
        },
        {
          "id": "pon-carta-interpelacao-pt",
          "grupo": "carta-interpelacao",
          "idioma": "pt",
          "tipo": "carta",
          "nome": "Carta de interpelação",
          "assunto": "Interpelação para pagamento",
          "corpo": "REGISTADA COM AVISO DE RECEÇÃO\n\nExmo.(a) Sr.(a) {{nome}},\n\nAssunto: Interpelação para pagamento — {{descricao}}\n\nNa qualidade de mandatários do credor, vimos pela presente interpelar V. Exa. para, no prazo máximo de 10 (dez) dias a contar da receção desta carta, proceder ao pagamento da quantia de {{valor}}, correspondente a {{descricao}}, vencida em {{dataVencimento}} e há {{diasAtraso}} dias por regularizar.\n\nO pagamento deverá ser efetuado por transferência bancária para o IBAN {{iban}}.\n\nDecorrido o prazo indicado sem que se mostre efetuado o pagamento, serão acionados, sem nova interpelação, os meios judiciais competentes para cobrança coerciva do crédito, acrescido dos juros de mora vencidos e vincendos e das despesas de cobrança legalmente devidas.\n\nCom os melhores cumprimentos,"
        }
      ]
    }
  ]
};

let promessaSementeira = null;

async function semear() {
  if (!disponivel()) return;
  // Cada coleção só se semeia se estiver VAZIA após leitura bem-sucedida -
  // idempotente e auto-recuperável (padrão seedSpine da suite jurídica).
  for (const nome of ['perfis', 'tipos_acao', 'definicoes']) {
    let existentes;
    try { existentes = await listar(nome); } catch { continue; }
    if (existentes.length > 0) continue;
    const linhas = DADOS_OMISSAO[nome] || [];
    try { await Promise.all(linhas.map((l) => criar(nome, l))); } catch { /* não fatal */ }
  }
}

/** Sementeira idempotente, uma vez por sessão, exclusiva entre abas. */
export function semearOmissao() {
  if (!promessaSementeira) {
    const correr = () => semear().catch(() => {});
    promessaSementeira =
      typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function'
        ? navigator.locks.request('cobrancas-semear-omissao', correr)
        : correr();
  }
  return promessaSementeira;
}
