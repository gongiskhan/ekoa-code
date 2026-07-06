import React, { useState, useEffect, useMemo, useRef } from "react";

const COL_TX = "transacoes";
const COL_CFG = "config";
const COL_ANEXOS = "anexos";
const COL_CLIENTES = "clientes";
const COL_BANCOS = "contas-bancarias";
const COL_APARTAMENTOS = "apartamentos";

const TIPO_GESTAO_OPTIONS = ["AL", "LD", "MD"];

function emptyApartamento() {
  return {
    nome: "",
    alias: "",
    tipo: "AL",
    proprietarioNome: "",
    clienteId: "",
    pl: "Principal",
    morada: "",
    codigoPostal: "",
    referencia: "",
    ativo: true,
  };
}

function normalizeMatch(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildApartamentoIndex(apartamentos) {
  const idx = [];
  for (const ap of apartamentos || []) {
    const tokens = [ap.nome, ap.alias, ap.referencia, ap.proprietarioNome]
      .filter(Boolean)
      .map(normalizeMatch)
      .filter((t) => t.length >= 3);
    idx.push({ ap, tokens });
  }
  return idx;
}

function linkTxToApartamento(tx, apartamentoIndex) {
  const haystacks = [tx.descricao, tx.cliente, tx.fornecedor, tx.produto]
    .filter(Boolean)
    .map(normalizeMatch);
  if (!haystacks.length) return null;
  for (const { ap, tokens } of apartamentoIndex) {
    for (const tok of tokens) {
      if (haystacks.some((h) => h.includes(tok))) return ap;
    }
  }
  return null;
}

function linkTxToCliente(tx, clientes) {
  if (!Array.isArray(clientes) || !clientes.length) return null;
  const candidates = [tx.cliente, tx.fornecedor].filter(Boolean).map(normalizeMatch);
  if (!candidates.length) return null;
  for (const c of clientes) {
    const nomeNorm = normalizeMatch(c.nome);
    if (!nomeNorm) continue;
    if (candidates.some((cand) => cand === nomeNorm || cand.includes(nomeNorm) || nomeNorm.includes(cand))) {
      return c;
    }
  }
  return null;
}

function isTaxaTuristica(tx) {
  const text = normalizeMatch([tx.descricao, tx.contabSubGrupo, tx.fatura, tx.produto].join(" "));
  return /taxa\s*tur/i.test(text) || /camara\s*munic/i.test(text) || /tourist\s*tax/i.test(text);
}
const CFG_ID = "main";

const BANCOS_OPTIONS = [
  "Caixa Geral de Depósitos (CGD)",
  "Millennium BCP",
  "Santander Totta",
  "Novo Banco",
  "BPI",
  "ActivoBank",
  "Crédito Agrícola",
  "Outro",
];

const PL_OPTIONS = ["Principal", "Legado"];

// Client/partner/employee match tables — emptied for the Ekoa featured demo
// (no pre-loaded data). Matching logic below safely no-ops on empty arrays.
const LEGADO_CONEXAO_CLIENTS = [];
const LEGADO_SOCIO_CLIENTS = [];

const RATEADO_FUNCIONARIOS = [];

const ENCONTRO_CONTAS_CARRYOVER = {
  ano: 2026,
  saldoAbertura: 0,
  favorecido: "",
  observacao: "",
};

const TAXAS_TURISTICAS_AL = [];
const TAXA_TURISTICA_PROGRAMACAO_DIA = 8;
const TAXA_TURISTICA_DEPOSITO_DIA = 12;
const TAXA_TURISTICA_PAGAMENTO_DIA = 14;
const TAXA_TURISTICA_KEYWORDS = /taxa\s*tur[íi]stica|tax\s*tur|tt\b/i;

const DRIVE_CONTAS_PAGAR_FOLDER_ID = "18uF8oS6cjmxlGv6CiIWlmgn-lF6q9kDx";

async function callGoogleWorkspace(action, params = {}) {
  const candidates = [
    `/integrations/google-workspace/${action}`,
    `/api/integrations/google-workspace/${action}`,
    `/integrations/call`,
  ];
  let lastErr = null;
  for (const path of candidates) {
    try {
      const body = path.endsWith("/call")
        ? JSON.stringify({ integration: "google-workspace", action, params })
        : JSON.stringify(params);
      const res = await window.__ekoa.fetch(path, { method: "POST", body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Falha ao chamar Google Workspace");
}

async function listarFaturasDrive(folderId, yyyyMm) {
  const startIso = `${yyyyMm}-01T00:00:00`;
  const yy = parseInt(yyyyMm.slice(0, 4), 10);
  const mm = parseInt(yyyyMm.slice(5, 7), 10);
  const nextMonth = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
  const endIso = `${nextMonth}-01T00:00:00`;
  const q = `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and modifiedTime >= '${startIso}' and modifiedTime < '${endIso}'`;
  const result = await callGoogleWorkspace("list_files", { q, pageSize: 200, orderBy: "modifiedTime desc" });
  return result?.files || result?.items || result || [];
}

function buildNotifications(txs) {
  const out = [];
  const hoje = todayISO();
  const hojeDia = parseInt(hoje.slice(8, 10), 10);
  const yyyyMm = hoje.slice(0, 7);

  const pendentesPassados = txs.filter(
    (t) => isPendente(t) && t.dtVencimento && t.dtVencimento < hoje
  );
  if (pendentesPassados.length > 0) {
    out.push({
      id: "pendentes-passados",
      kind: "pagar",
      severity: "warn",
      title: `${pendentesPassados.length} lançamento(s) passado(s) pendente(s)`,
      detail: "Vencimento já passou e ainda não foi confirmado como Pago/Recebido.",
      count: pendentesPassados.length,
    });
  }

  const IVA_INICIO = "2025-01-01";
  const isIvaPay = (t) =>
    t.forma === "Despesa" &&
    t.status === "Pago" &&
    /\biva\b|guia\s*de\s*pagamento/i.test(`${t.descricao || ""} ${t.fornecedor || ""} ${t.contabSubGrupo || ""} ${t.contabGrupo || ""}`);
  const ivaQuarters = new Map();
  const ensureQ = (ano, q) => {
    const key = `${ano}-Q${q}`;
    if (!ivaQuarters.has(key)) {
      ivaQuarters.set(key, {
        ano, q, key,
        venc: ivaTrimestreVencimento(`${ano}-${String(q * 3).padStart(2, "0")}-01`),
        retencao: 0, pago: 0,
      });
    }
    return ivaQuarters.get(key);
  };
  for (const t of txs) {
    if (t.status === "Cancelado") continue;
    const dt = t.data || "";
    if (!dt || dt < IVA_INICIO) continue;
    const ano = parseInt(dt.slice(0, 4), 10);
    const q = quarterFromIso(dt);
    if (!ano || !q) continue;
    if (isIvaPay(t)) {
      const m = (t.descricao || "").match(/Q([1-4])[\/\s-]?(\d{4}|\d{2})/i);
      let qPaid = q, yPaid = ano;
      if (m) {
        qPaid = parseInt(m[1], 10);
        yPaid = parseInt(m[2], 10);
        if (yPaid < 100) yPaid += 2000;
      } else {
        const vencMes = parseInt(dt.slice(5, 7), 10);
        if (vencMes === 5) { qPaid = 1; yPaid = ano; }
        else if (vencMes === 8) { qPaid = 2; yPaid = ano; }
        else if (vencMes === 11) { qPaid = 3; yPaid = ano; }
        else if (vencMes === 2) { qPaid = 4; yPaid = ano - 1; }
      }
      ensureQ(yPaid, qPaid).pago += Math.abs(Number(t.valorBruto) || 0);
    } else {
      ensureQ(ano, q).retencao += Math.abs(Number(t.valorRetencao) || 0);
    }
  }
  const ivaSorted = [...ivaQuarters.values()]
    .map((b) => ({ ...b, saldo: b.retencao - b.pago }))
    .filter((b) => b.saldo > 0.005 && b.venc && b.venc > hoje)
    .sort((a, b) => a.venc.localeCompare(b.venc));
  for (const b of ivaSorted) {
    const jaLancado = txs.some(
      (t) =>
        t.status !== "Cancelado" &&
        t.forma === "Despesa" &&
        /\biva\b/i.test(`${t.descricao || ""} ${t.contabSubGrupo || ""} ${t.contabGrupo || ""}`) &&
        (t.dtVencimento || t.data || "").startsWith(b.venc.slice(0, 7))
    );
    if (jaLancado) continue;
    out.push({
      id: `iva-${b.ano}-Q${b.q}`,
      kind: "iva",
      severity: "info",
      title: `IVA Q${b.q}/${b.ano} — saldo a pagar ${fmtEur(b.saldo)}`,
      detail: `Vencimento previsto em ${fmtDate(b.venc)}. Confirme com a Guia de Pagamento enviada pela contabilidade e inclua como conta a pagar.`,
    });
  }

  if (hojeDia >= TAXA_TURISTICA_PROGRAMACAO_DIA && hojeDia < TAXA_TURISTICA_PAGAMENTO_DIA) {
    const contasPagarMes = txs.filter((t) => {
      if (t.forma !== "Despesa") return false;
      if (t.status === "Cancelado" || t.status === "Pago") return false;
      const venc = t.dtVencimento || t.data || "";
      if (!venc.startsWith(yyyyMm)) return false;
      const txt = `${t.descricao || ""} ${t.contabSubGrupo || ""} ${t.contabGrupo || ""} ${t.fornecedor || ""}`;
      return TAXA_TURISTICA_KEYWORDS.test(txt);
    });
    for (const conta of contasPagarMes) {
      const valor = Math.abs(Number(conta.valorBruto) || 0);
      if (!valor) continue;
      const txt = normalizeClienteKey(`${conta.descricao || ""} ${conta.fornecedor || ""} ${conta.cliente || ""}`);
      const cfg = TAXAS_TURISTICAS_AL.find((c) => c.aliases.some((a) => txt.includes(normalizeClienteKey(a))));
      if (!cfg) continue;
      const depositado = txs
        .filter((t) => {
          if (t.status !== "Recebido") return false;
          if ((t.formaPagamento || "Banco") !== "Banco") return false;
          if ((t.data || "").slice(0, 7) !== yyyyMm) return false;
          const k = normalizeClienteKey(`${t.cliente || ""} ${t.descricao || ""} ${t.fornecedor || ""}`);
          return cfg.aliases.some((a) => k.includes(normalizeClienteKey(a)));
        })
        .reduce((acc, t) => acc + Math.abs(Number(t.valorBruto) || 0), 0);
      const falta = Math.max(0, valor - depositado);
      if (falta < 0.005) continue;
      out.push({
        id: `taxa-turistica-${conta.id || conta.fatura || cfg.cliente}`,
        kind: "taxa-turistica",
        severity: "info",
        title: `Taxa Turística pendente — ${cfg.cliente} (${cfg.apartamento})`,
        detail: `Conta a pagar ${fmtEur(valor)} · depositado ${fmtEur(depositado)} · faltam ${fmtEur(falta)} até dia ${TAXA_TURISTICA_DEPOSITO_DIA}. Pagamento dia ${TAXA_TURISTICA_PAGAMENTO_DIA}.`,
      });
    }
  }

  return out;
}

function normalizeClienteKey(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function matchLegadoClient(nome) {
  const k = normalizeClienteKey(nome);
  if (!k) return null;
  for (const c of LEGADO_CONEXAO_CLIENTS) {
    for (const a of c.aliases) if (k.includes(normalizeClienteKey(a))) return { type: "conexao", canonical: c.name };
  }
  for (const c of LEGADO_SOCIO_CLIENTS) {
    for (const a of c.aliases) if (k.includes(normalizeClienteKey(a))) return { type: "socio", canonical: c.name };
  }
  return null;
}

function matchRateadoFuncionario(nome) {
  const k = normalizeClienteKey(nome);
  if (!k) return null;
  for (const f of RATEADO_FUNCIONARIOS) {
    for (const a of f.aliases) if (k.includes(normalizeClienteKey(a))) return f.name;
  }
  return null;
}

const DESPESAS_FIXAS_FORNECEDORES = [
  "ayvens", "societe generale group", "vodafone", "idealista",
  "5a potencia", "5ª potencia", "5a potência",
  "atlantic summit", "camara de comercio portuguesa", "câmara de comércio portuguesa",
  "rd gestao", "rd gestão", "toc online", "toconline", "allianz",
  "certificado de registro criminal", "instituto dos registos e do notariado",
  "smiling cloud", "impic", "seguranca social", "segurança social",
];

const DESPESAS_FIXAS_DESC_PATTERNS = [
  /\bordenado\b/i,
];

const DESPESAS_FORNECEDOR_DESC_COMBOS = [
  {
    forn: /caixa\s*geral\s*de\s*dep[óo]sitos/i,
    desc: /2[,.]0\s*com\s*sb\s*e\s*1\s*com\s*si|tarifa\s*de\s*manuten[çc][ãa]o|imposto\s*(com|de)\s*selo/i,
    fixoVariavel: "Fixa",
  },
  {
    forn: /autoridade\s*tribut[áa]ria/i,
    desc: /\birs\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}\b/i,
    fixoVariavel: "Fixa",
  },
];

function applyFixoVariavelRule(payload) {
  if (!payload) return payload;
  const fornecedor = normalizeClienteKey(payload.fornecedor || "");
  const descricao = normalizeClienteKey(payload.descricao || "");
  for (const c of DESPESAS_FORNECEDOR_DESC_COMBOS) {
    if (c.forn.test(payload.fornecedor || "") && c.desc.test(payload.descricao || "")) {
      return { ...payload, fixoVariavel: c.fixoVariavel };
    }
  }
  for (const f of DESPESAS_FIXAS_FORNECEDORES) {
    if (fornecedor.includes(normalizeClienteKey(f))) {
      return { ...payload, fixoVariavel: "Fixa" };
    }
  }
  for (const p of DESPESAS_FIXAS_DESC_PATTERNS) {
    if (p.test(payload.descricao || "")) {
      return { ...payload, fixoVariavel: "Fixa" };
    }
  }
  return payload;
}

function applyReembolsoRule(payload) {
  if (!payload) return payload;
  if (!/reembolso/i.test(payload.descricao || "")) return payload;
  const grupo = payload.forma === "Receita" ? "Receita NOP" : "Despesa NOP";
  return {
    ...payload,
    contabGrupo: grupo,
    classifContabGrupo: deriveClassifContab(grupo),
  };
}

function applyAllRules(payload) {
  return applyReembolsoRule(applyFixoVariavelRule(applyLegadoRule(payload)));
}

const AUTO_INATIVO_THRESHOLD_DAYS = 365 * 2 + 1;

function findAutoInactivosCandidates(clientes, txs, today) {
  if (!Array.isArray(clientes) || !Array.isArray(txs)) return [];
  const todayMs = today.getTime();
  const thresholdMs = AUTO_INATIVO_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const lastReceitaByClient = new Map();
  for (const t of txs) {
    if (t.forma !== "Receita") continue;
    if (t.status === "Cancelado") continue;
    const key = normalizeName(t.cliente || "");
    if (!key) continue;
    const d = t.data || "";
    if (!d) continue;
    const prev = lastReceitaByClient.get(key);
    if (!prev || d > prev) lastReceitaByClient.set(key, d);
  }
  const out = [];
  for (const c of clientes) {
    if ((c.status || "ativo") !== "ativo") continue;
    if (c.autoInactivatedAt) continue;
    const key = normalizeName(c.nome || "");
    if (!key) continue;
    const last = lastReceitaByClient.get(key);
    if (!last) continue;
    const lastMs = new Date(last + "T00:00:00").getTime();
    if (!Number.isFinite(lastMs)) continue;
    if (todayMs - lastMs > thresholdMs) {
      out.push({ id: c.id, lastReceita: last });
    }
  }
  return out;
}

function applyLegadoRule(payload) {
  if (!payload) return payload;
  const cliente = payload.cliente || "";
  const fornecedor = payload.fornecedor || "";
  const m = matchLegadoClient(cliente) || matchLegadoClient(fornecedor);
  if (!m) return payload;
  return { ...payload, pl: "Legado", legadoCanal: m.type };
}

const CONTAB_GRUPO_OPTIONS = [
  "Receita",
  "Custo",
  "Despesa",
  "Imposto s/ Resultado",
  "Retirada de Lucros",
  "Receita NOP",
  "Despesa NOP",
  "Ativo",
  "Legado Receita",
  "Legado Despesa",
];

const CLASSIF_CONTAB_BY_GRUPO = {
  "Receita": "01.Receita",
  "Custo": "02.Custo",
  "Despesa": "03.Despesa",
  "Imposto s/ Resultado": "04.Imposto s/ Resultado",
  "Retirada de Lucros": "05.Retirada de Lucros",
  "Receita NOP": "06.Receita NOP",
  "Despesa NOP": "07.Despesa NOP",
  "Ativo": "08.Ativo",
  "Legado Receita": "09.Legado Receita",
  "Legado Despesa": "10.Legado Despesa",
};

const CONTAB_SUBGRUPO_GROUPS = {
  "Operacional": [
    "Gestão de Imóveis LD",
    "Gestão de Imóveis AL",
    "Gestão de Imóveis MD",
    "Assessoria",
    "Comissão Compra",
    "Comissão - Arrendamento",
    "Comissão - Venda",
    "Comissão Indicação",
    "Comissão Jurídica",
  ],
  "Custos/Despesas Fixas": [
    "Despesas Bancárias",
    "Telefonia",
    "Contábil",
    "Aluguel",
    "Marketing",
    "Sistemas Operacionais",
    "Despesas Administrativas",
    "Seguros",
    "Máquinas e Equipamentos",
    "Transporte",
  ],
  "Recursos Humanos": [
    "Salários",
    "Salários Adm",
    "Férias",
    "Rescisão",
    "Prêmio",
    "Quilometragem",
    "Ticket Educação",
    "RH",
    "Reembolso Funcionário",
  ],
  "Impostos": [
    "Tributos - Trabalhista",
    "Tributos - IVA",
    "Imposto s/ Resultado",
  ],
  "Outros": [
    "Despesa NOP",
    "Receita NOP",
    "Refeição",
    "Reembolso",
    "Caução",
    "Cartão de Crédito",
    "Jurídico",
    "Patrocínio",
    "Viagem",
    "Benefícios",
    "Retirada de Lucros",
  ],
};

const CONTAB_SUBGRUPO_OPTIONS = Object.values(CONTAB_SUBGRUPO_GROUPS).flat();

const PRODUTO_OPTIONS = [
  "Recorrente",
  "Assessoria",
  "Imobiliária",
  "Financiamento",
  "Gestão",
  "Legado",
];

const PRODUTO_DESDOBRAMENTOS = [
  "Tarifa Bancária",
  "Devolução",
  "Contabilidade",
  "Imposto Trabalhista",
  "Refeição",
  "Prêmios para Funcionários",
  "Marketing",
  "Administrativo",
  "Comissão",
  "Salário",
  "Imposto - IVA",
  "Reembolso",
  "Caução",
  "Rescisão",
  "Ticket Educação",
  "Overhead",
  "Seguro",
  "Quilometragem",
  "Sistema de gestão",
  "Viagem",
  "Férias",
  "Cartão de Crédito",
  "Transporte",
];

const PONTUAL_RECORRENTE_OPTIONS = ["Recorrente", "Pontual"];
const FIXO_VARIAVEL_OPTIONS = ["Fixa", "Variável"];
const IVA_OPTIONS = ["Sim", "Não"];
const ACT_PLAN_OPTIONS = ["Act", "Plan"];
const DIRECAO_OPTIONS = ["Receita", "Despesa"];
const FORMA_PAGAMENTO_OPTIONS = ["Banco", "Cartão de Crédito"];
const STATUS_OPTIONS = [
  "Recebido",
  "Pago",
  "A receber",
  "A pagar",
  "Planejado",
  "Pendente",
  "Atrasado",
  "Cancelado",
];
const STATUS_REALIZADOS = new Set(["Recebido", "Pago"]);

const IVA_TRIM_VENCIMENTOS = {
  1: { mes: 5, dia: 20 },
  2: { mes: 8, dia: 20 },
  3: { mes: 11, dia: 20 },
  4: { mes: 2, dia: 20, anoSeguinte: true },
};

function deriveActPlan(status) {
  return STATUS_REALIZADOS.has(status) ? "Act" : "Plan";
}

function isRealizado(tx) {
  return STATUS_REALIZADOS.has(tx?.status);
}

function isPendente(tx) {
  const s = tx?.status;
  if (!s) return true;
  return s !== "Cancelado" && !STATUS_REALIZADOS.has(s) && s !== "Atrasado";
}

function deriveClassifContab(contabGrupo) {
  return CLASSIF_CONTAB_BY_GRUPO[contabGrupo] || "";
}

function mesCaixa(isoDate) {
  if (!isoDate) return null;
  const m = parseInt(String(isoDate).slice(5, 7), 10);
  return Number.isFinite(m) ? m : null;
}

function dataCaixa(isoDate) {
  if (!isoDate) return "";
  return `${String(isoDate).slice(0, 7)}-01`;
}

function competenciaToFirstDay(comp) {
  if (!comp) return "";
  const s = String(comp);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(0, 7)}-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return s;
}

function competenciaFromAny(value) {
  if (!value) return "";
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}`;
  const br = s.match(/^(\d{1,2})\/(\d{4})/);
  if (br) return `${br[2]}-${String(br[1]).padStart(2, "0")}`;
  return "";
}

function quarterFromIso(isoDate) {
  const m = mesCaixa(isoDate);
  if (!m) return null;
  return Math.ceil(m / 3);
}

function ivaTrimestreVencimento(isoDate) {
  const q = quarterFromIso(isoDate);
  if (!q) return "";
  const ano = parseInt(String(isoDate).slice(0, 4), 10);
  const conf = IVA_TRIM_VENCIMENTOS[q];
  if (!conf) return "";
  const yr = conf.anoSeguinte ? ano + 1 : ano;
  return `${yr}-${String(conf.mes).padStart(2, "0")}-${String(conf.dia).padStart(2, "0")}`;
}

function signedValor(forma, valor) {
  const v = Number(valor) || 0;
  if (!v) return 0;
  return forma === "Despesa" ? -Math.abs(v) : Math.abs(v);
}

function concatContabGrupo(tx) {
  if (!tx) return "";
  const grupo = tx.classifContabGrupo || tx.contabGrupo || "";
  const sub = tx.contabSubGrupo || "";
  return [grupo, sub].filter(Boolean).join(" | ");
}

function concatContabSubGrupo(tx) {
  if (!tx) return "";
  const sub = tx.contabSubGrupo || "";
  const prod = tx.produto || "";
  return [sub, prod].filter(Boolean).join(" | ");
}

function concatDtFlcx(tx) {
  if (!tx?.data) return "";
  return dataCaixa(tx.data);
}

function concatDtFlcx2(tx) {
  if (!tx) return "";
  const dt = concatDtFlcx(tx);
  const grupo = tx.classifContabGrupo || tx.contabGrupo || "";
  return [dt, grupo].filter(Boolean).join(" | ");
}

const SALDO_ANCORA = { valor: 0, data: "2024-12-31" };

function txSignedDelta(tx) {
  if (tx?.origem === "saldo-ancora") return 0;
  const v = Math.abs(Number(tx?.valorBruto) || 0);
  if (!v) return 0;
  if (tx.status === "Cancelado") return 0;
  const c = tx.classifContabGrupo || deriveClassifContab(tx.contabGrupo) || "";
  const isReceita = c.startsWith("01.") || c.startsWith("06.") || c.startsWith("09.") || tx.forma === "Receita";
  return isReceita ? v : -v;
}

function buildSaldoAcumulado(txs, ancora = SALDO_ANCORA) {
  const ordered = [...txs]
    .filter((t) => t.data && t.data > ancora.data && t.status !== "Cancelado")
    .sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.id || "").localeCompare(b.id || ""));
  const map = new Map();
  let saldo = ancora.valor;
  for (const t of ordered) {
    saldo += txSignedDelta(t);
    map.set(t.id, saldo);
  }
  return { map, saldoFinal: saldo, ancora, ordered };
}

function saldoAteData(txs, dataIso, ancora = SALDO_ANCORA, realizadoOnly = false) {
  if (!dataIso || dataIso <= ancora.data) return ancora.valor;
  let saldo = ancora.valor;
  const ordered = [...txs]
    .filter((t) => {
      if (!t.data || t.data <= ancora.data || t.data > dataIso) return false;
      if (t.status === "Cancelado") return false;
      if (realizadoOnly && !STATUS_REALIZADOS.has(t.status)) return false;
      return true;
    })
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  for (const t of ordered) saldo += txSignedDelta(t);
  return saldo;
}

function cleanIncompatibleDates(payload) {
  if (!payload) return payload;
  const out = { ...payload };
  const data = out.data || "";
  if (!data) return out;
  if (out.dtEmissao && out.dtEmissao > data) out.dtEmissao = "";
  if (out.dtVencimento && out.dtVencimento < data && out.status !== "Pago" && out.status !== "Recebido") {
    out.dtVencimento = "";
  }
  if (out.competencia && /^\d{4}-\d{2}/.test(out.competencia)) {
    const compFromData = data.slice(0, 7);
    if (out.competencia.slice(0, 7) !== compFromData) {
      const diffMonths = Math.abs(
        (parseInt(compFromData.slice(0, 4), 10) - parseInt(out.competencia.slice(0, 4), 10)) * 12 +
        (parseInt(compFromData.slice(5, 7), 10) - parseInt(out.competencia.slice(5, 7), 10))
      );
      if (diffMonths > 1) out.competencia = compFromData;
    }
  }
  return out;
}

function normalizeText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  return normalizeText(s).split(" ").filter((t) => t.length >= 3);
}

function jaccardScore(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function suggestCategorization({ descricao, valor, history, regras }) {
  const txt = normalizeText(descricao);
  if (!txt) return { score: 0, suggestions: {}, source: null };

  const rule = matchDeParaRule(regras || [], descricao);
  if (rule) {
    const sug = {};
    for (const k of [
      "fornecedor", "cliente", "forma", "contabGrupo", "classifContabGrupo",
      "contabSubGrupo", "pl", "produto", "pontualRecorrente", "fixoVariavel",
      "iva", "formaPagamento",
    ]) {
      if (rule[k]) sug[k] = rule[k];
    }
    return { score: 1, suggestions: sug, source: `regra: ${rule.padrao}` };
  }

  if (!Array.isArray(history) || !history.length) return { score: 0, suggestions: {}, source: null };

  const tokens = tokenize(descricao);
  let best = null;
  let bestScore = 0;
  for (const tx of history) {
    const candidatos = [tx.fornecedor, tx.cliente, tx.descricao].filter(Boolean);
    for (const c of candidatos) {
      const cn = normalizeText(c);
      if (!cn) continue;
      let score = 0;
      if (txt.includes(cn) || cn.includes(txt)) score = Math.max(score, 0.9);
      const ct = tokenize(c);
      const j = jaccardScore(tokens, ct);
      if (j > score) score = j;
      if (score > bestScore) {
        bestScore = score;
        best = { tx, matched: c };
      }
    }
  }
  if (!best || bestScore < 0.34) return { score: bestScore, suggestions: {}, source: null };

  const tx = best.tx;
  const sameSign = (Number(valor) > 0) === (txSignedDelta(tx) > 0);
  const sug = {
    fornecedor: tx.fornecedor || "",
    cliente: tx.cliente || "",
    forma: sameSign ? tx.forma : (Number(valor) > 0 ? "Receita" : "Despesa"),
    contabGrupo: tx.contabGrupo || "",
    classifContabGrupo: tx.classifContabGrupo || deriveClassifContab(tx.contabGrupo) || "",
    contabSubGrupo: tx.contabSubGrupo || "",
    pl: tx.pl || "Principal",
    produto: tx.produto || "",
    pontualRecorrente: tx.pontualRecorrente || "",
    fixoVariavel: tx.fixoVariavel || "",
    iva: tx.iva || "",
    formaPagamento: tx.formaPagamento || "Banco",
  };
  return { score: bestScore, suggestions: sug, source: `hist: ${best.matched}` };
}

const PRODUTO_CLIENTE_OPTIONS = ["Assessoria", "Imobiliária", "Gestão", "Financiamento"];
const TIPO_CLIENTE_OPTIONS = ["AL", "LD", "MD", "Assessoria"];
const STATUS_CLIENTE_OPTIONS = ["ativo", "inativo", "prospect"];

function emptyCliente() {
  return {
    nome: "",
    nif: "",
    email: "",
    telefone: "",
    telemovel: "",
    endereco: "",
    codigoPostal: "",
    pl: "Principal",
    dataNascimento: "",
    originadorComissao: "",
    status: "ativo",
    produtos: [],
    tipo: "",
    dataInicio: "",
  };
}

function emptyBanco() {
  return {
    nome: "",
    banco: "Caixa Geral de Depósitos (CGD)",
    iban: "",
    bic: "",
    titular: "",
    moeda: "EUR",
    saldoInicial: 0,
    integracao: "manual",
    ativo: true,
  };
}
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const LOGO_URL = "https://app.ekoa.io/ekoa_logo.png";

const MENU = [
  { id: "painel", label: "Painel", icon: "home" },
  { id: "projetado", label: "Fluxo Projetado", icon: "trending" },
  { id: "transacoes", label: "Transações", icon: "list" },
  { id: "pagar", label: "Contas a Pagar", icon: "minus" },
  { id: "receber", label: "Contas a Receber", icon: "plus" },
  { id: "kpis", label: "KPIs e Metas", icon: "target" },
  { id: "dre", label: "DRE", icon: "rows" },
  { id: "fornecedores", label: "Fornecedores", icon: "stack" },
  { id: "clientes", label: "Clientes", icon: "user" },
  { id: "carteira", label: "Carteira", icon: "wallet" },
  { id: "upload", label: "Upload IA", icon: "upload" },
  { id: "encontro", label: "Encontro de Contas", icon: "swap" },
  { id: "definicoes", label: "Definições", icon: "settings" },
];

const DEFINICOES_TABS = [
  { id: "depara", label: "De/Para" },
  { id: "bancarias", label: "Contas Bancárias" },
  { id: "equipa", label: "Equipa" },
  { id: "permissoes", label: "Permissões" },
];

const COL_REGRAS_DEPARA = "regras-depara";
const COL_PERMISSOES = "permissoes";
const COL_EQUIPA = "equipa";

const PERMISSAO_NIVEIS = [
  { id: "admin", label: "Administrador", desc: "Acesso total: vê tudo, edita tudo, gere utilizadores e definições." },
  { id: "financeiro", label: "Financeiro", desc: "Vê e edita transações, importa, edita De/Para; não gere utilizadores." },
  { id: "consulta", label: "Consulta", desc: "Vê dashboards e relatórios; não edita lançamentos." },
  { id: "comissionado", label: "Comissionado", desc: "Vê apenas suas próprias comissões e desempenho." },
];

const PERMISSAO_AREAS = [
  { id: "painel", label: "Painel" },
  { id: "projetado", label: "Fluxo Projetado" },
  { id: "transacoes", label: "Transações" },
  { id: "pagar", label: "Contas a Pagar" },
  { id: "receber", label: "Contas a Receber" },
  { id: "kpis", label: "KPIs e Metas" },
  { id: "dre", label: "DRE" },
  { id: "fornecedores", label: "Fornecedores" },
  { id: "clientes", label: "Clientes" },
  { id: "carteira", label: "Carteira" },
  { id: "upload", label: "Upload IA" },
  { id: "encontro", label: "Encontro de Contas" },
  { id: "definicoes", label: "Definições" },
];

const PERMISSAO_PADRAO = {
  admin: Object.fromEntries(PERMISSAO_AREAS.map((a) => [a.id, "edit"])),
  financeiro: Object.fromEntries(PERMISSAO_AREAS.map((a) => [a.id, a.id === "definicoes" ? "view" : "edit"])),
  consulta: Object.fromEntries(PERMISSAO_AREAS.map((a) => [a.id, a.id === "definicoes" ? "none" : "view"])),
  comissionado: Object.fromEntries(PERMISSAO_AREAS.map((a) => [a.id, ["painel", "carteira"].includes(a.id) ? "view" : "none"])),
};

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTHS_LETTER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function monthList() {
  const out = [];
  const today = new Date();
  for (let y = today.getFullYear(); y >= today.getFullYear() - 3; y--) {
    for (let m = 12; m >= 1; m--) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push({ key, label: `${MONTHS_PT[m - 1]} ${y}` });
    }
  }
  return out;
}

function todayMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtEur(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function fmtFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function emptyTx() {
  const today = todayISO();
  return {
    data: today,
    competencia: todayMonthKey(),
    forma: "Despesa",
    formaPagamento: "Banco",
    actPlan: "Plan",
    dtEmissao: today,
    dtVencimento: today,
    fatura: "N/A",
    fornecedor: "",
    status: "A pagar",
    cliente: "",
    descricao: "",
    originadorComissao: "",
    comentarios: "",
    contabGrupo: "Despesa",
    classifContabGrupo: "03.Despesa",
    contabSubGrupo: "",
    pl: "Principal",
    produto: "",
    pontualRecorrente: "Pontual",
    fixoVariavel: "Variável",
    iva: "Não",
    valorBruto: 0,
    valorRetencao: 0,
    valorLiquido: 0,
    valorSaldo: 0,
    valorSaldoSemIva: 0,
    valorSaldoSemLegadoIva: 0,
    ivaTrProjetado: 0,
  };
}

export default function App() {
  const [active, setActive] = useState("painel");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [txInitialSearch, setTxInitialSearch] = useState("");
  const [txs, setTxs] = useState([]);
  const [cfg, setCfg] = useState({ saldoBanco: 0, saldoBancoData: todayISO(), metaMensal: 0 });
  const [refMonth, setRefMonth] = useState(todayMonthKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyTx());
  const [draftFile, setDraftFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toastDismissed, setToastDismissed] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState({ saldoBanco: 0, saldoBancoData: todayISO() });
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [editingCliente, setEditingCliente] = useState(null);
  const [draftCliente, setDraftCliente] = useState(emptyCliente());
  const [savingCliente, setSavingCliente] = useState(false);
  const [clientesImportPreview, setClientesImportPreview] = useState(null);
  const [bancos, setBancos] = useState([]);
  const [txToDelete, setTxToDelete] = useState(null);
  const [deletingTx, setDeletingTx] = useState(false);

  const fornecedoresOptions = useMemo(() => {
    const set = new Set();
    for (const t of txs) {
      const f = String(t.fornecedor || "").trim();
      if (f && !/^n\/?a$/i.test(f)) set.add(f);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "pt"));
  }, [txs]);

  const clientesOptions = useMemo(() => {
    const set = new Set();
    for (const t of txs) {
      const c = String(t.cliente || "").trim();
      if (c && !/^n\/?a$/i.test(c)) set.add(c);
    }
    for (const c of clientes) {
      const nm = String(c.nome || "").trim();
      if (nm) set.add(nm);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "pt"));
  }, [txs, clientes]);
  const [editingBanco, setEditingBanco] = useState(null);
  const [draftBanco, setDraftBanco] = useState(emptyBanco());
  const [savingBanco, setSavingBanco] = useState(false);
  const [cgdConnect, setCgdConnect] = useState(null);

  const [apartamentos, setApartamentos] = useState([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      window.__ekoa.list(COL_TX),
      window.__ekoa.get(COL_CFG, CFG_ID),
      window.__ekoa.list(COL_CLIENTES),
      window.__ekoa.list(COL_BANCOS),
      window.__ekoa.list(COL_APARTAMENTOS),
    ])
      .then(async ([txList, cfgDoc, clienteList, bancoList, apartList]) => {
        if (!mounted) return;
        let allTxs = Array.isArray(txList) ? txList : [];
        const ancoraLegacy = allTxs.filter((t) => t.origem === "saldo-ancora");
        if (ancoraLegacy.length) {
          for (const a of ancoraLegacy) {
            try { await window.__ekoa.delete(COL_TX, a.id); } catch (_) {}
          }
          allTxs = allTxs.filter((t) => t.origem !== "saldo-ancora");
        }
        setTxs(allTxs);
        if (cfgDoc) setCfg({ ...cfg, ...cfgDoc });
        setClientes(Array.isArray(clienteList) ? clienteList : []);
        setBancos(Array.isArray(bancoList) ? bancoList : []);
        setApartamentos(Array.isArray(apartList) ? apartList : []);
      })
      .catch((err) => mounted && setError(err.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clientes.length || !txs.length) return;
    const today = new Date();
    const candidates = findAutoInactivosCandidates(clientes, txs, today);
    if (!candidates.length) return;
    let cancelled = false;
    (async () => {
      const todayIso = todayISO();
      for (const cand of candidates) {
        if (cancelled) return;
        try {
          const patch = {
            status: "inativo",
            autoInactivatedAt: todayIso,
            autoInactivatedLastReceita: cand.lastReceita,
          };
          const updated = await window.__ekoa.update(COL_CLIENTES, cand.id, patch);
          if (cancelled) return;
          setClientes((prev) => prev.map((c) => (c.id === cand.id ? { ...c, ...updated } : c)));
        } catch (_) { /* skip silently */ }
      }
    })();
    return () => { cancelled = true; };
  }, [clientes, txs]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (txToDelete) { setTxToDelete(null); return; }
      if (editing) { closeTxModal(); return; }
      if (editingCliente) { closeClienteModal(); return; }
      if (editingBalance) { setEditingBalance(false); return; }
      if (importPreview) { setImportPreview(null); setImportError(null); return; }
      if (clientesImportPreview) { setClientesImportPreview(null); return; }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [txToDelete, editing, editingCliente, editingBalance, importPreview, clientesImportPreview]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== "NumpadDecimal") return;
      const el = e.target;
      if (!el || el.tagName !== "INPUT") return;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type !== "number" && type !== "text") return;
      const lang = (document.documentElement.lang || navigator.language || "pt").toLowerCase();
      const usesComma = lang.startsWith("pt") || lang.startsWith("es") || lang.startsWith("fr") || lang.startsWith("de");
      if (!usesComma) return;
      if (type === "number") return;
      e.preventDefault();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + "," + el.value.slice(end);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, newValue);
      else el.value = newValue;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.setSelectionRange(start + 1, start + 1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const monthsAvailable = useMemo(() => monthList(), []);

  const txsRealizadas = useMemo(
    () => txs.filter((t) => t.origem === "saldo-ancora" || isRealizado(t)),
    [txs]
  );

  const txsMonth = useMemo(
    () => txs.filter((t) => t.competencia === refMonth),
    [txs, refMonth]
  );

  const summary = useMemo(() => {
    let faturamentoRealizado = 0;
    let despesasRealizadas = 0;
    let faturamentoPrevisto = 0;
    let pendentesPassados = 0;
    const todayK = todayISO();
    for (const t of txs) {
      const v = Number(t.valorBruto) || 0;
      if (t.competencia === refMonth) {
        if (t.forma === "Receita") {
          faturamentoPrevisto += v;
          if (isRealizado(t)) faturamentoRealizado += v;
        } else if (t.forma === "Despesa" && isRealizado(t)) {
          despesasRealizadas += v;
        }
      }
      if (isPendente(t) && t.dtVencimento && t.dtVencimento < todayK) {
        pendentesPassados += 1;
      }
    }
    const resultado = faturamentoRealizado - despesasRealizadas;
    const rentabilidade = faturamentoRealizado > 0 ? (resultado / faturamentoRealizado) * 100 : null;
    return {
      faturamentoRealizado,
      despesasRealizadas,
      faturamentoPrevisto,
      resultado,
      rentabilidade,
      pendentesPassados,
    };
  }, [txs, refMonth]);

  const reconciliacao = useMemo(() => {
    const apos = txsMonth
      .filter((t) => t.status !== "Cancelado")
      .reduce((acc, t) => {
        const v = Number(t.valorBruto) || 0;
        if (t.forma === "Receita" && isRealizado(t)) return acc + v;
        if (t.forma === "Despesa" && isRealizado(t)) return acc - v;
        return acc;
      }, 0);
    const manuais = txsMonth.filter((t) => isRealizado(t)).length;
    const saldoApp = (Number(cfg.saldoBanco) || 0) + apos;
    return { apos, manuais, saldoApp };
  }, [txsMonth, cfg.saldoBanco]);

  const evolucao = useMemo(() => {
    const yearNow = new Date().getFullYear();
    const monthNow = new Date().getMonth();
    const out = [];
    let saldo = Number(cfg.saldoBanco) || 0;
    const start = saldo;
    for (let m = 0; m < 12; m++) {
      const key = `${yearNow}-${String(m + 1).padStart(2, "0")}`;
      const monthDelta = txs
        .filter((t) => t.competencia === key && isRealizado(t))
        .reduce((acc, t) => {
          const v = Number(t.valorBruto) || 0;
          if (t.forma === "Receita") return acc + v;
          if (t.forma === "Despesa") return acc - v;
          return acc;
        }, 0);
      saldo = (m === 0 ? start : saldo) + monthDelta;
      out.push({ month: m, label: MONTHS_LETTER[m], saldo, isFuture: m > monthNow, isToday: m === monthNow });
    }
    return out;
  }, [txs, cfg.saldoBanco]);

  const previousMonthKey = useMemo(() => {
    const [yy, mm] = refMonth.split("-").map(Number);
    const prev = new Date(yy, mm - 2, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }, [refMonth]);

  const previousMonthRevenue = useMemo(() => {
    return txs
      .filter((t) => t.competencia === previousMonthKey && t.forma === "Receita" && isRealizado(t))
      .reduce((acc, t) => acc + (Number(t.valorBruto) || 0), 0);
  }, [txs, previousMonthKey]);

  const grupoDespesas = useMemo(() => {
    const map = new Map();
    for (const t of txsMonth) {
      if (t.forma !== "Despesa" || !isRealizado(t)) continue;
      const k = t.contabGrupo || "Sem grupo";
      map.set(k, (map.get(k) || 0) + (Number(t.valorBruto) || 0));
    }
    return Array.from(map.entries())
      .map(([grupo, total]) => ({ grupo, total }))
      .sort((a, b) => b.total - a.total);
  }, [txsMonth]);

  const contasHoje = useMemo(() => {
    const today = todayISO();
    return txs.filter(
      (t) => t.forma === "Despesa" && isPendente(t) && t.dtVencimento === today
    );
  }, [txs]);

  function openNewTx() {
    setDraft({ ...emptyTx(), competencia: refMonth });
    setDraftFile(null);
    setEditing("new");
  }
  function openEditTx(tx) {
    setDraft({ ...emptyTx(), ...tx });
    setDraftFile(null);
    setEditing(tx.id);
  }
  function closeTxModal() {
    setEditing(null);
    setDraft(emptyTx());
    setDraftFile(null);
  }

  async function deletePreAncoraTxs() {
    const cutoff = SALDO_ANCORA.data;
    const candidates = txs.filter((t) => (t.data || "") < cutoff);
    if (!candidates.length) {
      alert(`Nenhuma transação anterior a ${fmtDate(cutoff)} encontrada.`);
      return;
    }
    const ok = confirm(
      `Excluir ${candidates.length} transação(ões) anteriores a ${fmtDate(cutoff)}?\n\n` +
      `Esta ação não pode ser desfeita. A âncora ${fmtDate(SALDO_ANCORA.data)} = ${fmtEur(SALDO_ANCORA.valor)} permanece como saldo inicial.`
    );
    if (!ok) return;
    const confirmText = prompt(`Para confirmar a exclusão de ${candidates.length} transação(ões), digite EXCLUIR:`);
    if (confirmText !== "EXCLUIR") {
      alert("Operação cancelada.");
      return;
    }
    setSaving(true);
    let removed = 0, failed = 0;
    try {
      for (const t of candidates) {
        try {
          await window.__ekoa.delete(COL_TX, t.id);
          removed++;
        } catch (_) { failed++; }
      }
      setTxs((prev) => prev.filter((t) => (t.data || "") >= cutoff));
      alert(`${removed} transação(ões) excluída(s)${failed ? ` · ${failed} falhou(aram)` : ""}.`);
    } finally {
      setSaving(false);
    }
  }

  async function applyRulesToAll() {
    if (!confirm("Aplicar regras de Fixo/Variável e PL=Legado a todas as transações existentes?")) return;
    setSaving(true);
    let updated = 0;
    try {
      for (const t of txs) {
        const next = applyAllRules({ ...t });
        const changedFV = (next.fixoVariavel || "") !== (t.fixoVariavel || "");
        const changedPL = (next.pl || "") !== (t.pl || "");
        if (!changedFV && !changedPL) continue;
        const patch = {};
        if (changedFV) patch.fixoVariavel = next.fixoVariavel;
        if (changedPL) { patch.pl = next.pl; patch.legadoCanal = next.legadoCanal; }
        try {
          const res = await window.__ekoa.update(COL_TX, t.id, patch);
          setTxs((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...res } : x)));
          updated++;
        } catch (_) {}
      }
      alert(`Regras aplicadas. ${updated} transação(ões) atualizada(s).`);
    } finally {
      setSaving(false);
    }
  }

  async function saveTx() {
    setSaving(true);
    try {
      const payload = applyAllRules({ ...draft });
      ["valorBruto", "valorLiquido"].forEach((k) => { payload[k] = Number(payload[k]) || 0; });
      if (!payload.valorLiquido) payload.valorLiquido = payload.valorBruto;
      let txRecord;
      if (editing === "new") {
        txRecord = await window.__ekoa.create(COL_TX, payload);
        setTxs((prev) => [txRecord, ...prev]);
      } else {
        const updated = await window.__ekoa.update(COL_TX, editing, payload);
        txRecord = { ...draft, ...updated, id: editing };
        setTxs((prev) => prev.map((t) => (t.id === editing ? { ...t, ...updated } : t)));
      }
      if (draftFile) {
        await attachInvoice(txRecord, draftFile);
      }
      closeTxModal();
    } catch (err) {
      setError(err.message || "Falha ao salvar transação");
    } finally {
      setSaving(false);
    }
  }

  function deleteTx(id) {
    if (!id) {
      console.warn("deleteTx chamado sem id");
      return;
    }
    const tx = txs.find((t) => t.id === id);
    if (!tx) {
      console.warn("deleteTx: tx não encontrada com id", id);
      setTxs((prev) => prev.filter((t) => t.id !== id));
      return;
    }
    setTxToDelete(tx);
  }

  async function confirmDeleteTx() {
    if (!txToDelete) return;
    const id = txToDelete.id;
    setDeletingTx(true);
    try {
      try {
        await window.__ekoa.delete(COL_TX, id);
      } catch (err) {
        console.error("Falha ao excluir no servidor", id, err);
      }
      setTxs((prev) => prev.filter((t) => t.id !== id));
      setTxToDelete(null);
    } finally {
      setDeletingTx(false);
    }
  }

  async function markAsPaid(tx) {
    try {
      const updated = await window.__ekoa.update(COL_TX, tx.id, { status: "Pago" });
      setTxs((prev) => prev.map((t) => (t.id === tx.id ? { ...t, ...updated } : t)));
    } catch (err) {
      setError(err.message);
    }
  }

  function openBalanceEditor() {
    setBalanceDraft({ saldoBanco: cfg.saldoBanco, saldoBancoData: cfg.saldoBancoData });
    setEditingBalance(true);
  }

  async function saveBalance() {
    try {
      const payload = {
        saldoBanco: Number(balanceDraft.saldoBanco) || 0,
        saldoBancoData: balanceDraft.saldoBancoData || todayISO(),
        metaMensal: cfg.metaMensal,
      };
      const existing = await window.__ekoa.get(COL_CFG, CFG_ID);
      let saved;
      if (existing) {
        saved = await window.__ekoa.update(COL_CFG, CFG_ID, payload);
      } else {
        saved = await window.__ekoa.create(COL_CFG, { id: CFG_ID, ...payload });
      }
      setCfg({ ...cfg, ...saved });
      setEditingBalance(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDriveSync() {
    setImportError(null);
    try {
      const hoje = todayISO();
      const yyyyMm = hoje.slice(0, 7);
      const files = await listarFaturasDrive(DRIVE_CONTAS_PAGAR_FOLDER_ID, yyyyMm);
      if (!files.length) {
        setImportError(`Nenhuma fatura encontrada na pasta do Drive para ${fmtDate(yyyyMm + "-01").slice(3)}.`);
        return;
      }
      const existingDriveIds = new Set(
        txs.filter((t) => t.googleDriveFileId).map((t) => String(t.googleDriveFileId))
      );
      const rows = files
        .filter((f) => !existingDriveIds.has(String(f.id)))
        .map((f) => {
          const baseName = String(f.name || "").replace(/\.[^.]+$/, "");
          const dataIso = (f.modifiedTime || f.createdTime || hoje).slice(0, 10);
          return {
            raw: { data: dataIso, descricao: baseName, amount: 0 },
            payload: cleanIncompatibleDates({
              data: dataIso,
              competencia: dataIso.slice(0, 7),
              forma: "Despesa",
              formaPagamento: "Banco",
              actPlan: "Plan",
              dtEmissao: dataIso,
              dtVencimento: dataIso,
              fatura: baseName,
              fornecedor: baseName.slice(0, 80),
              status: "A pagar",
              cliente: "",
              descricao: baseName.slice(0, 200),
              contabGrupo: "",
              classifContabGrupo: "",
              pl: "Principal",
              valorBruto: 0,
              valorLiquido: 0,
              googleDriveFileId: String(f.id),
              googleDriveLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              googleDriveName: f.name,
              origem: "drive",
            }),
          };
        });
      if (!rows.length) {
        setImportError(`Todas as ${files.length} faturas da pasta deste mês já estão sincronizadas.`);
        return;
      }
      setImportPreview({ kind: "drive", fileName: `Drive · ${files.length} arquivo(s) · ${yyyyMm}`, rows });
    } catch (err) {
      setImportError(err.message || "Falha ao sincronizar com o Google Drive. Verifique se a integração Google Workspace está conectada.");
    }
  }

  async function handleImportFile(file, kind) {
    setImportError(null);
    if (!file) return;
    try {
      if (kind === "fatura") {
        const today = todayISO();
        const isPagar = active === "pagar";
        const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
        let draftFromFile = null;
        let avisoCliente = null;
        if (isPdf && !isPagar) {
          try {
            const buf = await file.arrayBuffer();
            const fat = await parseFaturaTOConlinePdf(buf);
            const { tx, naoCadastrado, nomeFaltando, isComissao } = mapFaturaToTx(fat, clientes);
            draftFromFile = applyAllRules(tx);
            if (naoCadastrado) {
              avisoCliente = isComissao
                ? `O fornecedor "${nomeFaltando}" da fatura ${fat.fatura} não está cadastrado. Cadastre-o como cliente para vincular corretamente.`
                : `O cliente "${nomeFaltando}" da fatura ${fat.fatura} não está cadastrado. Cadastre-o antes de salvar.`;
            }
          } catch (errFat) {
            console.warn("parseFaturaTOConlinePdf falhou, abrindo modal vazio", errFat);
          }
        }
        if (!draftFromFile) {
          draftFromFile = {
            ...emptyTx(),
            forma: isPagar ? "Despesa" : "Receita",
            status: isPagar ? "A pagar" : "A receber",
            actPlan: "Plan",
            data: today,
            competencia: todayMonthKey(),
            dtVencimento: today,
            descricao: file.name.replace(/\.[^.]+$/, ""),
            pl: "Principal",
          };
        }
        setDraft(draftFromFile);
        setDraftFile(file);
        setEditing("new");
        if (avisoCliente) {
          setTimeout(() => alert(avisoCliente), 100);
        }
        return;
      }
      let rows;
      if (kind === "extrato") {
        const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
        const isXlsx = /\.xlsx?$/i.test(file.name) ||
          file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          file.type === "application/vnd.ms-excel";
        if (isPdf) {
          const buf = await file.arrayBuffer();
          rows = await parseBankPdf(buf);
        } else if (isXlsx) {
          const buf = await file.arrayBuffer();
          rows = await parseBankXlsx(buf);
        } else {
          const text = await file.text();
          const isOfx = /\.ofx$/i.test(file.name) || /<OFX|<STMTTRN/i.test(text.slice(0, 4096));
          rows = isOfx ? parseBankOfx(text) : parseBankCsv(text);
        }
      } else if (kind === "toconline") {
        const isXlsx = /\.xlsx?$/i.test(file.name);
        if (isXlsx) {
          const buf = await file.arrayBuffer();
          rows = await parseToconlineXlsx(buf);
        } else {
          const text = await file.text();
          rows = parseToconlineCsv(text);
        }
      } else {
        const buf = await file.arrayBuffer();
        rows = await parseFluxoXlsx(buf);
      }
      if (!rows.length) {
        setImportError("Nenhum lançamento detectado no arquivo.");
        return;
      }

      let rules = [];
      try {
        rules = await window.__ekoa.list(COL_REGRAS_DEPARA);
      } catch (_) {}

      const ofxIds = new Set(
        txs.filter((t) => t.ofxFitId).map((t) => String(t.ofxFitId))
      );

      const txKey = (t) => {
        const valor = Math.round(Math.abs(Number(t.valorBruto) || 0) * 100);
        const id = String(t.fornecedor || t.cliente || t.descricao || "")
          .normalize("NFD").replace(/[̀-ͯ]/g, "")
          .toLowerCase().replace(/\s+/g, " ").trim();
        return `${(t.data || "").slice(0, 10)}|${valor}|${id}`;
      };
      const existingKeys = new Set(
        txs.filter((t) => t.status !== "Cancelado").map(txKey)
      );

      const enriched = rows.map((row) => {
        const text = [
          row.payload?.descricao,
          row.payload?.fornecedor,
          row.payload?.cliente,
          row.raw?.descricao,
        ].filter(Boolean).join(" ");

        const dupOfx = row.payload?.ofxFitId && ofxIds.has(String(row.payload.ofxFitId));
        const dupContent = !dupOfx && existingKeys.has(txKey(row.payload));
        const dup = dupOfx || dupContent;

        const rule = matchDeParaRule(rules, text);
        if (rule) {
          return {
            ...row,
            payload: cleanIncompatibleDates(applyDeParaRule(rule, row.payload)),
            matchedRule: rule.padrao,
            suggestion: { score: 1, source: `regra: ${rule.padrao}` },
            duplicate: dup,
            duplicateReason: dupOfx ? "ofx" : (dupContent ? "content" : null),
            skip: dup ? true : row.skip,
          };
        }

        if (kind === "extrato") {
          const sug = suggestCategorization({
            descricao: text,
            valor: row.raw?.amount ?? row.payload?.valorBruto,
            history: txs,
            regras: rules,
          });
          if (sug.score > 0) {
            const merged = { ...row.payload };
            for (const [k, v] of Object.entries(sug.suggestions || {})) {
              if (!merged[k] || merged[k] === "" || merged[k] === "Principal" || merged[k] === "Banco") {
                merged[k] = v;
              }
            }
            if (!merged.classifContabGrupo && merged.contabGrupo) {
              merged.classifContabGrupo = deriveClassifContab(merged.contabGrupo);
            }
            return {
              ...row,
              payload: cleanIncompatibleDates(merged),
              suggestion: { score: sug.score, source: sug.source },
              duplicate: dup,
              duplicateReason: dupOfx ? "ofx" : (dupContent ? "content" : null),
              skip: dup ? true : row.skip,
            };
          }
        }

        return {
          ...row,
          payload: cleanIncompatibleDates(row.payload),
          duplicate: dup,
          duplicateReason: dupOfx ? "ofx" : (dupContent ? "content" : null),
          skip: dup ? true : row.skip,
        };
      });
      setImportPreview({ kind, fileName: file.name, rows: enriched });
    } catch (err) {
      setImportError(err.message || "Falha ao processar o arquivo");
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    setImporting(true);
    setImportError(null);
    const created = [];
    const deletedIds = new Set();
    try {
      if (importPreview.replaceAll && importPreview.kind === "planilha") {
        const stale = txs.filter((t) => t.origem === "fluxo-caixa");
        for (const t of stale) {
          try {
            await window.__ekoa.delete(COL_TX, t.id);
            deletedIds.add(t.id);
          } catch (_) {}
        }
      }
      for (const row of importPreview.rows) {
        if (row.skip) continue;
        const finalPayload = applyAllRules(row.payload);
        const c = await window.__ekoa.create(COL_TX, finalPayload);
        created.push(c);
      }
      setTxs((prev) => {
        const remaining = deletedIds.size
          ? prev.filter((t) => !deletedIds.has(t.id))
          : prev;
        return [...created, ...remaining];
      });
      setImportPreview(null);
    } catch (err) {
      setImportError(err.message || "Falha ao importar lançamentos");
    } finally {
      setImporting(false);
    }
  }

  async function attachInvoice(tx, file) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo: 5 MB.`);
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      if (tx.anexoId) {
        try { await window.__ekoa.delete(COL_ANEXOS, tx.anexoId); } catch (_) {}
      }
      const anexo = await window.__ekoa.create(COL_ANEXOS, {
        transacaoId: tx.id,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        base64,
      });
      const updated = await window.__ekoa.update(COL_TX, tx.id, {
        anexoId: anexo.id,
        anexoNome: file.name,
        anexoTipo: file.type || "application/octet-stream",
      });
      setTxs((prev) => prev.map((t) => (t.id === tx.id ? { ...t, ...updated } : t)));
    } catch (err) {
      setError(err.message || "Falha ao anexar fatura");
    }
  }

  async function viewInvoice(tx) {
    if (!tx.anexoId) return;
    try {
      const anexo = await window.__ekoa.get(COL_ANEXOS, tx.anexoId);
      if (!anexo) {
        setError("Anexo não encontrado.");
        return;
      }
      const blob = base64ToBlob(anexo.base64, anexo.mimeType || "application/octet-stream");
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) {
        const a = document.createElement("a");
        a.href = url;
        a.download = anexo.fileName || "fatura";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || "Falha ao abrir anexo");
    }
  }

  async function removeInvoice(tx) {
    if (!tx.anexoId) return;
    if (!confirm("Remover a fatura anexada?")) return;
    try {
      try { await window.__ekoa.delete(COL_ANEXOS, tx.anexoId); } catch (_) {}
      const updated = await window.__ekoa.update(COL_TX, tx.id, {
        anexoId: null,
        anexoNome: null,
        anexoTipo: null,
      });
      setTxs((prev) => prev.map((t) => (t.id === tx.id ? { ...t, ...updated } : t)));
    } catch (err) {
      setError(err.message || "Falha ao remover anexo");
    }
  }

  function openNewCliente() {
    setDraftCliente(emptyCliente());
    setEditingCliente("new");
  }
  function openEditCliente(c) {
    setDraftCliente({ ...emptyCliente(), ...c });
    setEditingCliente(c.id);
  }
  function closeClienteModal() {
    setEditingCliente(null);
    setDraftCliente(emptyCliente());
  }

  async function saveCliente() {
    setSavingCliente(true);
    try {
      const payload = { ...draftCliente };
      if (!payload.nome || !payload.nome.trim()) {
        throw new Error("O nome do cliente é obrigatório.");
      }
      payload.nome = payload.nome.trim();
      const nomeKey = normalizeName(payload.nome);
      const duplicate = clientes.find(
        (c) => normalizeName(c.nome) === nomeKey && c.id !== editingCliente
      );
      if (duplicate) {
        throw new Error(`Já existe um cliente com o nome "${duplicate.nome}". O nome deve ser único.`);
      }
      if (editingCliente === "new") {
        const created = await window.__ekoa.create(COL_CLIENTES, payload);
        setClientes((prev) => [created, ...prev]);
      } else {
        const updated = await window.__ekoa.update(COL_CLIENTES, editingCliente, payload);
        setClientes((prev) => prev.map((c) => (c.id === editingCliente ? { ...c, ...updated } : c)));
      }
      closeClienteModal();
    } catch (err) {
      setError(err.message || "Falha ao salvar cliente");
    } finally {
      setSavingCliente(false);
    }
  }

  async function deleteCliente(id) {
    if (!confirm("Excluir este cliente? Esta ação não pode ser desfeita.")) return;
    try {
      await window.__ekoa.delete(COL_CLIENTES, id);
      setClientes((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err.message || "Falha ao excluir cliente");
    }
  }

  async function autoImportClientesFromTxs() {
    const cadastrados = new Set(clientes.map((c) => normalizeName(c.nome)));
    const cadastradosApart = new Set((apartamentos || []).map((a) => normalizeName(a.nome)));
    const novosClientes = new Map();
    const aggPorCliente = new Map();

    function emailFrom(txt) {
      const m = String(txt || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      return m ? m[0] : "";
    }

    for (const t of txs) {
      if (t.forma !== "Receita") continue;
      if (t.status === "Cancelado") continue;
      const nome = String(t.cliente || "").trim();
      if (!nome || /^n\/?a$/i.test(nome)) continue;
      const k = normalizeName(nome);
      const agg = aggPorCliente.get(k) || {
        nome,
        emails: new Set(),
        primeiraData: "",
        ultimaData: "",
        originador: "",
        plLegado: false,
      };
      const em = emailFrom(`${t.descricao || ""} ${t.comentarios || ""}`);
      if (em) agg.emails.add(em);
      const dt = t.data || "";
      if (dt) {
        if (!agg.primeiraData || dt < agg.primeiraData) agg.primeiraData = dt;
        if (!agg.ultimaData || dt > agg.ultimaData) agg.ultimaData = dt;
      }
      if (!agg.originador && t.originadorComissao) agg.originador = String(t.originadorComissao).trim();
      if ((t.pl || "").toLowerCase().includes("legad")) agg.plLegado = true;
      aggPorCliente.set(k, agg);
    }

    const SUBGRUPO_TIPO = [
      { rx: /gest[aã]o\s+de\s+im[oó]veis\s+al/i, tipo: "AL" },
      { rx: /gest[aã]o\s+de\s+im[oó]veis\s+ld/i, tipo: "LD" },
      { rx: /gest[aã]o\s+de\s+im[oó]veis\s+md/i, tipo: "MD" },
    ];
    const tipoCountsByCliente = new Map();
    const lastTipoDateByCliente = new Map();
    for (const t of txs) {
      if (t.forma !== "Receita") continue;
      if (t.status === "Cancelado") continue;
      const k = normalizeName(t.cliente || "");
      if (!k) continue;
      const sub = t.contabSubGrupo || "";
      const match = SUBGRUPO_TIPO.find((r) => r.rx.test(sub));
      if (!match) continue;
      const counts = tipoCountsByCliente.get(k) || { AL: 0, LD: 0, MD: 0 };
      counts[match.tipo] = (counts[match.tipo] || 0) + 1;
      tipoCountsByCliente.set(k, counts);
      const dt = t.data || "";
      const prevByTipo = lastTipoDateByCliente.get(k) || {};
      if (!prevByTipo[match.tipo] || dt > prevByTipo[match.tipo]) {
        prevByTipo[match.tipo] = dt;
        lastTipoDateByCliente.set(k, prevByTipo);
      }
    }
    const tipoByCliente = new Map();
    for (const [k, counts] of tipoCountsByCliente) {
      const dates = lastTipoDateByCliente.get(k) || {};
      const entries = ["AL", "LD", "MD"]
        .map((t) => ({ tipo: t, count: counts[t] || 0, lastDate: dates[t] || "" }))
        .filter((e) => e.count > 0)
        .sort((a, b) => {
          if (b.lastDate !== a.lastDate) return (b.lastDate || "").localeCompare(a.lastDate || "");
          return b.count - a.count;
        });
      if (entries.length) tipoByCliente.set(k, entries[0].tipo);
    }

    function canonicalApartFor(nomeCliente) {
      const k = normalizeName(nomeCliente);
      for (const al of TAXAS_TURISTICAS_AL) {
        if (al.aliases.some((a) => k.includes(normalizeName(a)))) {
          return { nome: al.apartamento, alias: al.cliente };
        }
      }
      return null;
    }

    for (const [k, agg] of aggPorCliente) {
      if (cadastrados.has(k)) continue;
      const m = matchLegadoClient(agg.nome);
      const isLegado = agg.plLegado || !!m;
      novosClientes.set(k, {
        ...emptyCliente(),
        nome: agg.nome,
        pl: isLegado ? "Legado" : "Principal",
        originadorComissao: agg.originador,
        email: [...agg.emails][0] || "",
        dataInicio: agg.primeiraData || "",
        tipo: tipoByCliente.get(k) || "",
        status: "ativo",
        legadoCanal: m?.type || "",
      });
    }

    const listaClientes = [...novosClientes.values()];
    const listaApartamentos = [];
    const updatesApartamentos = [];
    const apartByOwnerKey = new Map();
    for (const ap of apartamentos || []) {
      const owner = normalizeName(ap.proprietarioNome || ap.alias || ap.nome || "");
      if (owner) apartByOwnerKey.set(owner, ap);
    }
    for (const al of TAXAS_TURISTICAS_AL) {
      const ownerKey = normalizeName(al.cliente);
      const existing = apartByOwnerKey.get(ownerKey);
      if (existing) continue;
      const hasTx = txs.some((t) => {
        if (t.status === "Cancelado") return false;
        const k = normalizeName(`${t.cliente || ""} ${t.fornecedor || ""} ${t.descricao || ""}`);
        return al.aliases.some((a) => k.includes(normalizeName(a)));
      });
      if (!hasTx) continue;
      if (cadastradosApart.has(normalizeName(al.apartamento))) continue;
      const m = matchLegadoClient(al.cliente);
      const inferredTipo = tipoByCliente.get(ownerKey) || "AL";
      listaApartamentos.push({
        ...emptyApartamento(),
        nome: al.apartamento,
        alias: al.cliente,
        tipo: inferredTipo,
        proprietarioNome: al.cliente,
        pl: m ? "Legado" : "Principal",
      });
    }

    for (const [k, agg] of aggPorCliente) {
      const tipo = tipoByCliente.get(k);
      if (!tipo) continue;
      const existing = apartByOwnerKey.get(k);
      const canon = canonicalApartFor(agg.nome);
      if (existing) continue;
      if (canon) continue;
      if (cadastradosApart.has(k)) continue;
      const m = matchLegadoClient(agg.nome);
      listaApartamentos.push({
        ...emptyApartamento(),
        nome: agg.nome,
        alias: agg.nome,
        tipo,
        proprietarioNome: agg.nome,
        pl: m || agg.plLegado ? "Legado" : "Principal",
      });
    }

    for (const ap of apartamentos || []) {
      const ownerKey = normalizeName(ap.proprietarioNome || ap.alias || ap.nome || "");
      if (!ownerKey) continue;
      const inferred = tipoByCliente.get(ownerKey);
      if (!inferred) continue;
      if (ap.tipo === inferred) continue;
      updatesApartamentos.push({ id: ap.id, oldTipo: ap.tipo || "—", newTipo: inferred, nome: ap.nome });
    }

    if (!listaClientes.length && !listaApartamentos.length && !updatesApartamentos.length) {
      alert("Nenhuma alteração necessária: clientes, apartamentos e tipos já refletem o histórico de transações.");
      return;
    }

    const partes = [];
    if (listaClientes.length) partes.push(`${listaClientes.length} cliente(s) novo(s)`);
    if (listaApartamentos.length) partes.push(`${listaApartamentos.length} apartamento(s) novo(s)`);
    if (updatesApartamentos.length) {
      const detalhes = updatesApartamentos
        .slice(0, 8)
        .map((u) => `${u.nome}: ${u.oldTipo} → ${u.newTipo}`)
        .join(", ");
      const extra = updatesApartamentos.length > 8 ? ` (+${updatesApartamentos.length - 8})` : "";
      partes.push(`${updatesApartamentos.length} tipo(s) corrigido(s) [${detalhes}${extra}]`);
    }
    if (!confirm(`Aplicar alterações na Carteira?\n\n· ${partes.join("\n· ")}`)) return;

    setSavingCliente(true);
    let criadosCli = 0, criadosAp = 0, atualizadosAp = 0;
    try {
      for (const novo of listaClientes) {
        try {
          const c = await window.__ekoa.create(COL_CLIENTES, novo);
          setClientes((prev) => [...prev, c]);
          criadosCli++;
        } catch (_) {}
      }
      for (const ap of listaApartamentos) {
        try {
          const created = await window.__ekoa.create(COL_APARTAMENTOS, ap);
          setApartamentos((prev) => [created, ...prev]);
          criadosAp++;
        } catch (_) {}
      }
      for (const upd of updatesApartamentos) {
        try {
          const updated = await window.__ekoa.update(COL_APARTAMENTOS, upd.id, { tipo: upd.newTipo });
          setApartamentos((prev) => prev.map((a) => (a.id === upd.id ? { ...a, ...updated } : a)));
          atualizadosAp++;
        } catch (_) {}
      }
      const msg = [
        criadosCli > 0 ? `${criadosCli} cliente(s) criado(s)` : null,
        criadosAp > 0 ? `${criadosAp} apartamento(s) cadastrado(s) na Carteira` : null,
        atualizadosAp > 0 ? `${atualizadosAp} apartamento(s) reclassificado(s)` : null,
      ].filter(Boolean).join(" · ");
      alert(`${msg || "Nada a aplicar"}.`);
    } finally {
      setSavingCliente(false);
    }
  }

  async function handleClientesXlsx(file) {
    setError(null);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const rows = await parseClientesFromXlsx(buf);
      const existing = new Set(clientes.map((c) => normalizeName(c.nome)));
      const dedup = [];
      const seen = new Set();
      for (const r of rows) {
        const key = normalizeName(r.nome);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        dedup.push({
          ...r,
          jaExiste: existing.has(key),
          skip: existing.has(key),
        });
      }
      if (!dedup.length) {
        setError("Nenhum cliente encontrado na planilha.");
        return;
      }
      setClientesImportPreview({ fileName: file.name, rows: dedup });
    } catch (err) {
      setError(err.message || "Falha ao ler planilha");
    }
  }

  async function confirmClientesImport() {
    if (!clientesImportPreview) return;
    setSavingCliente(true);
    try {
      const created = [];
      for (const row of clientesImportPreview.rows) {
        if (row.skip) continue;
        const c = await window.__ekoa.create(COL_CLIENTES, {
          nome: row.nome,
          nif: row.nif || "",
          email: row.email || "",
          telefone: row.telefone || "",
          telemovel: row.telemovel || "",
          endereco: row.endereco || "",
          codigoPostal: row.codigoPostal || "",
          pl: row.pl || "Principal",
        });
        created.push(c);
      }
      setClientes((prev) => [...created, ...prev]);
      setClientesImportPreview(null);
    } catch (err) {
      setError(err.message || "Falha ao importar clientes");
    } finally {
      setSavingCliente(false);
    }
  }

  function openNewBanco() {
    setDraftBanco(emptyBanco());
    setEditingBanco("new");
  }
  function openEditBanco(b) {
    setDraftBanco({ ...emptyBanco(), ...b });
    setEditingBanco(b.id);
  }
  function closeBancoModal() {
    setEditingBanco(null);
    setDraftBanco(emptyBanco());
  }
  async function saveBanco() {
    setSavingBanco(true);
    try {
      const payload = { ...draftBanco };
      if (!payload.nome.trim()) throw new Error("Nome obrigatório.");
      payload.saldoInicial = Number(payload.saldoInicial) || 0;
      let saved;
      if (editingBanco === "new") {
        saved = await window.__ekoa.create(COL_BANCOS, payload);
        setBancos((prev) => [saved, ...prev]);
      } else {
        saved = await window.__ekoa.update(COL_BANCOS, editingBanco, payload);
        setBancos((prev) => prev.map((b) => (b.id === editingBanco ? { ...b, ...saved } : b)));
      }
      closeBancoModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingBanco(false);
    }
  }
  async function deleteBanco(id) {
    if (!confirm("Excluir esta conta bancária?")) return;
    try {
      await window.__ekoa.delete(COL_BANCOS, id);
      setBancos((prev) => prev.filter((b) => b.id !== id));
    } catch (err) { setError(err.message); }
  }

  function startCgdConnection() {
    setCgdConnect({
      step: "credentials",
      contractNumber: "",
      accessCode: "",
      accountAlias: "Conta CGD",
      iban: "",
      error: null,
    });
  }
  async function submitCgdConnection() {
    if (!cgdConnect) return;
    if (!cgdConnect.contractNumber || !cgdConnect.accessCode) {
      setCgdConnect({ ...cgdConnect, error: "Preencha contrato e código de acesso." });
      return;
    }
    setCgdConnect({ ...cgdConnect, step: "connecting", error: null });
    try {
      const created = await window.__ekoa.create(COL_BANCOS, {
        nome: cgdConnect.accountAlias || "Conta CGD",
        banco: "Caixa Geral de Depósitos (CGD)",
        iban: cgdConnect.iban || "",
        bic: "CGDIPTPL",
        titular: "",
        moeda: "EUR",
        saldoInicial: 0,
        integracao: "cgd",
        cgdContractMasked: cgdConnect.contractNumber.replace(/\d(?=\d{3})/g, "•"),
        cgdConectadoEm: new Date().toISOString(),
        cgdStatus: "pendente_validacao",
        ativo: true,
      });
      setBancos((prev) => [created, ...prev]);
      setCgdConnect({ ...cgdConnect, step: "done" });
    } catch (err) {
      setCgdConnect({ ...cgdConnect, step: "credentials", error: err.message });
    }
  }

  async function saveMeta(value) {
    try {
      const payload = {
        saldoBanco: cfg.saldoBanco,
        saldoBancoData: cfg.saldoBancoData,
        metaMensal: Number(value) || 0,
      };
      const existing = await window.__ekoa.get(COL_CFG, CFG_ID);
      let saved;
      if (existing) saved = await window.__ekoa.update(COL_CFG, CFG_ID, payload);
      else saved = await window.__ekoa.create(COL_CFG, { id: CFG_ID, ...payload });
      setCfg({ ...cfg, ...saved });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="erp">
      <Sidebar
        active={active}
        onChange={setActive}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      />

      <main className="erp-main">
        <Header
          active={active}
          onNewTx={openNewTx}
          onImport={handleImportFile}
          receberCount={txs.filter((t) => t.forma === "Receita" && (!isRealizado(t) && t.status !== "Cancelado")).length}
          pagarCount={txs.filter((t) => t.forma === "Despesa" && (!isRealizado(t) && t.status !== "Cancelado")).length}
          notifications={buildNotifications(txs)}
          onGoToPending={() => setActive("projetado")}
          onDriveSync={handleDriveSync}
          onApplyRules={applyRulesToAll}
          onDeletePreAncora={deletePreAncoraTxs}
        />

        {error && (
          <div className="erp-alert erp-alert-error">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {loading ? (
          <div className="erp-loading">A carregar dados…</div>
        ) : active === "painel" ? (
          <Painel
            txs={txsRealizadas}
            cfg={cfg}
            refMonth={refMonth}
            setRefMonth={setRefMonth}
            monthsAvailable={monthsAvailable}
            onSaveMeta={saveMeta}
            onEditBalance={openBalanceEditor}
            onShowPending={() => setActive("projetado")}
          />
        ) : active === "transacoes" ? (
          <Transacoes
            txs={txsRealizadas}
            onEdit={openEditTx}
            onDelete={deleteTx}
            onPay={markAsPaid}
            initialSearch={txInitialSearch}
            onConsumedInitialSearch={() => setTxInitialSearch("")}
          />
        ) : active === "pagar" ? (
          <ContasPagar
            txs={txs.filter((t) => t.forma === "Despesa" && t.origem !== "saldo-ancora")}
            realizadasAll={txsRealizadas.filter((t) => t.forma === "Despesa")}
            onEdit={openEditTx}
            onDelete={deleteTx}
            onPay={markAsPaid}
            onAttach={attachInvoice}
            onView={viewInvoice}
          />
        ) : active === "receber" ? (
          <ContasReceber
            txs={txs.filter((t) => t.forma === "Receita" && t.origem !== "saldo-ancora")}
            realizadasAll={txsRealizadas.filter((t) => t.forma === "Receita")}
            onEdit={openEditTx}
            onDelete={deleteTx}
            onPay={markAsPaid}
            onAttach={attachInvoice}
            onView={viewInvoice}
          />
        ) : active === "dre" ? (
          <DRE txs={txsRealizadas} />
        ) : active === "projetado" ? (
          <FluxoProjetado
            txs={txs}
            saldoInicial={Number(cfg.saldoBanco) || 0}
            onEdit={openEditTx}
            onPay={markAsPaid}
          />
        ) : active === "kpis" ? (
          <KpisMetas txs={txsRealizadas} cfg={cfg} onSaveMeta={saveMeta} />
        ) : active === "carteira" ? (
          <Carteira
            txs={txsRealizadas}
            clientes={clientes}
            apartamentos={apartamentos}
            setApartamentos={setApartamentos}
            onAutoImport={autoImportClientesFromTxs}
          />
        ) : active === "definicoes" ? (
          <Definicoes
            bancos={bancos}
            onNewBanco={openNewBanco}
            onEditBanco={openEditBanco}
            onDeleteBanco={deleteBanco}
            onConnectCgd={startCgdConnection}
          />
        ) : active === "encontro" ? (
          <EncontroContas txs={txsRealizadas} bancos={bancos} />
        ) : active === "upload" ? (
          <UploadIA onCreateTx={(prefill, file) => {
            setDraft({ ...emptyTx(), ...prefill });
            setDraftFile(file || null);
            setEditing("new");
          }} />
        ) : active === "clientes" ? (
          <Clientes
            clientes={clientes}
            txs={txsRealizadas}
            onNew={openNewCliente}
            onEdit={openEditCliente}
            onDelete={deleteCliente}
            onImportXlsx={handleClientesXlsx}
            onAutoImport={autoImportClientesFromTxs}
            onViewHistory={(cliente) => {
              setTxInitialSearch(cliente.nome || "");
              setActive("transacoes");
            }}
          />
        ) : active === "fornecedores" ? (
          <Fornecedores txs={txsRealizadas} />
        ) : (
          <Placeholder label={MENU.find((m) => m.id === active)?.label || ""} />
        )}
      </main>

      {!toastDismissed && contasHoje.length > 0 && (
        <ContasHojeToast
          contas={contasHoje}
          onClose={() => setToastDismissed(true)}
          onView={() => { setActive("projetado"); setToastDismissed(true); }}
        />
      )}

      {editing && (
        <TxModal
          isNew={editing === "new"}
          draft={draft}
          setDraft={setDraft}
          file={draftFile}
          setFile={setDraftFile}
          onClose={closeTxModal}
          onSave={saveTx}
          onViewInvoice={viewInvoice}
          onRemoveInvoice={removeInvoice}
          saving={saving}
          fornecedoresList={fornecedoresOptions}
          clientesList={clientesOptions}
          clientesFull={clientes}
          onCreateCliente={async (payload) => {
            const created = await window.__ekoa.create(COL_CLIENTES, payload);
            setClientes((prev) => [created, ...prev]);
            return created;
          }}
        />
      )}

      {editingBalance && (
        <BalanceModal
          draft={balanceDraft}
          setDraft={setBalanceDraft}
          onClose={() => setEditingBalance(false)}
          onSave={saveBalance}
        />
      )}

      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          setPreview={setImportPreview}
          existingPlanilhaCount={txs.filter((t) => t.origem === "fluxo-caixa").length}
          onClose={() => { setImportPreview(null); setImportError(null); }}
          onConfirm={confirmImport}
          importing={importing}
          error={importError}
        />
      )}

      {editingCliente && (
        <ClienteModal
          isNew={editingCliente === "new"}
          draft={draftCliente}
          setDraft={setDraftCliente}
          onClose={closeClienteModal}
          onSave={saveCliente}
          saving={savingCliente}
        />
      )}

      {clientesImportPreview && (
        <ClientesImportModal
          preview={clientesImportPreview}
          setPreview={setClientesImportPreview}
          onClose={() => setClientesImportPreview(null)}
          onConfirm={confirmClientesImport}
          importing={savingCliente}
        />
      )}

      {txToDelete && (
        <ConfirmDeleteTxModal
          tx={txToDelete}
          onCancel={() => setTxToDelete(null)}
          onConfirm={confirmDeleteTx}
          deleting={deletingTx}
        />
      )}

      {editingBanco && (
        <BancoModal
          isNew={editingBanco === "new"}
          draft={draftBanco}
          setDraft={setDraftBanco}
          onClose={closeBancoModal}
          onSave={saveBanco}
          saving={savingBanco}
        />
      )}

      {cgdConnect && (
        <CgdConnectModal
          state={cgdConnect}
          setState={setCgdConnect}
          onSubmit={submitCgdConnection}
          onClose={() => setCgdConnect(null)}
        />
      )}
    </div>
  );
}

function Sidebar({ active, onChange, collapsed, onToggleCollapsed }) {
  return (
    <aside className={`erp-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sb-brand">
        <div className="sb-logo-lockup">
          <img
            src={LOGO_URL}
            alt="Ekoa"
            className="sb-logo"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          {!collapsed && <span className="sb-wordmark">ekoa</span>}
        </div>
        {!collapsed && <span className="sb-tagline">ERP Imobiliário · Gestão Financeira</span>}
        <button
          className="sb-collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <nav className="sb-nav">
        {MENU.map((m) => (
          <button
            key={m.id}
            className={`sb-item ${active === m.id ? "is-active" : ""}`}
            onClick={() => onChange(m.id)}
            title={collapsed ? m.label : undefined}
          >
            <NavIcon name={m.icon} />
            {!collapsed && <span>{m.label}</span>}
          </button>
        ))}
      </nav>
      <div className="sb-user">
        <div className="sb-avatar">F</div>
        {!collapsed && (
          <div className="sb-user-meta">
            <div className="sb-user-name">Financeiro</div>
            <div className="sb-user-role">Admin</div>
          </div>
        )}
        {!collapsed && <button className="sb-logout" title="Sair">Sair</button>}
      </div>
      {!collapsed && (
        <div className="sb-footer">
          <div className="sb-footer-title">Ekoa</div>
          2026 · Construído com Ekoa
        </div>
      )}
    </aside>
  );
}

function NavIcon({ name }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    home: "M3 12l9-9 9 9M5 10v10h14V10",
    trending: "M3 17l6-6 4 4 8-8M17 7h4v4",
    list: "M4 6h16M4 12h16M4 18h10",
    minus: "M12 4v16m-8-8h16",
    plus: "M5 12h14M12 5l7 7-7 7",
    stack: "M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4",
    user: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 20a8 8 0 0116 0",
    wallet: "M3 7h18v13H3zM7 7V5a2 2 0 012-2h6a2 2 0 012 2v2",
    swap: "M7 8l-4 4 4 4M17 16l4-4-4-4M14 4l-4 16",
    rows: "M4 4h16v4H4zM4 10h16v4H4zM4 16h10v4H4z",
    target: "M12 2v20M2 12h20M5 19l5-5 4 4 5-5",
    upload: "M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4-4-4 4M12 8v12",
    team: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2",
    bank: "M3 21h18M3 10h18M5 6l7-3 7 3v4H5zM6 10v8M10 10v8M14 10v8M18 10v8",
    settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

function NotificationCenter({ notifications = [], onGoToPending }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const count = notifications.length;
  return (
    <div className="notif-wrap" ref={ref}>
      <button
        type="button"
        className={`notif-bell ${count > 0 ? "has-unread" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={count > 0 ? `${count} notificação(ões)` : "Sem notificações"}
        aria-label="Notificações"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {count > 0 && <span className="notif-badge">{count}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <strong>Notificações</strong>
            <span className="notif-panel-count">{count}</span>
          </div>
          <div className="notif-panel-body">
            {count === 0 ? (
              <div className="notif-empty">Nenhuma notificação pendente.</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`notif-item notif-${n.severity || "info"}`}>
                  <div className="notif-item-title">{n.title}</div>
                  {n.detail && <div className="notif-item-detail">{n.detail}</div>}
                  {n.kind === "pagar" && onGoToPending && (
                    <button
                      className="btn btn-light btn-tiny"
                      style={{ marginTop: 6 }}
                      onClick={() => { setOpen(false); onGoToPending(); }}
                    >
                      Ver pendentes
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ active, onNewTx, onImport, receberCount = 0, pagarCount = 0, notifications = [], onGoToPending, onDriveSync, onApplyRules, onDeletePreAncora }) {
  const extratoRef = useRef(null);
  const planilhaRef = useRef(null);
  const toconlineRef = useRef(null);
  const faturaRef = useRef(null);
  const labels = {
    painel: { title: "Painel", sub: "Visão geral do fluxo de caixa" },
    projetado: { title: "Fluxo Projetado", sub: "Saldo acumulado realizado vs projetado" },
    transacoes: { title: "Transações", sub: "Lançamentos completos" },
    pagar: { title: "Contas a Pagar", sub: `${pagarCount} contas pendentes a pagar` },
    receber: { title: "Contas a Receber", sub: `${receberCount} contas pendentes a receber` },
    kpis: { title: "KPIs e Metas", sub: "Year-over-Year, metas e origem da receita — apenas realizado por defeito" },
    dre: { title: "DRE", sub: "Demonstrativo de Resultados — apenas entradas e saídas realizadas (status = Pago/Recebido)" },
    fornecedores: { title: "Fornecedores", sub: "Gestão de fornecedores" },
    clientes: { title: "Clientes", sub: "Gestão de clientes" },
    carteira: { title: "Carteira", sub: "Carteira de produtos e serviços" },
    upload: { title: "Upload IA", sub: "Importação assistida por IA" },
    encontro: { title: "Encontro de Contas", sub: "Conciliação bancária" },
    definicoes: { title: "Definições", sub: "De/Para, Contas Bancárias, Equipa e Permissões" },
  };
  const head = labels[active] || labels.painel;

  function handleFile(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onImport(file, kind);
  }

  function newTxButtonLabel() {
    if (active === "pagar") return "+ Conta a Pagar";
    if (active === "receber") return "+ Conta a Receber";
    return "+ Nova Transação";
  }

  return (
    <header className="erp-header">
      <div>
        <h1>{head.title}</h1>
        <div className="erp-header-sub">{head.sub}</div>
      </div>
      <div className="erp-header-actions">
        <NotificationCenter notifications={notifications} onGoToPending={onGoToPending} />
        {active === "transacoes" && (
          <>
            <button className="btn btn-light" onClick={() => extratoRef.current?.click()} title="Extrato bancário em OFX, CSV, XLS/XLSX ou PDF — sistema sugere categorização automática">
              Conciliação Bancária (OFX/CSV/XLS/PDF)
            </button>
            <button className="btn btn-light" onClick={() => planilhaRef.current?.click()}>
              Importar Planilha 2026
            </button>
          </>
        )}
        {active === "receber" && (
          <>
            <button
              className="btn btn-light"
              onClick={() => toconlineRef.current?.click()}
              title="Importar faturas do TOConline (CSV exportado)"
            >
              Importar do TOConline
            </button>
            <button className="btn btn-gold" onClick={() => faturaRef.current?.click()}>
              Upload de Fatura
            </button>
          </>
        )}
        {active === "pagar" && (
          <>
            <button
              className="btn btn-light"
              onClick={onDriveSync}
              title="Lista as faturas da pasta de Contas a Pagar no Google Drive (modificadas no mês corrente) e abre o preview para você revisar e importar."
            >
              Sincronizar Drive (mês atual)
            </button>
            <button className="btn btn-gold" onClick={() => faturaRef.current?.click()}>
              Upload de Fatura
            </button>
          </>
        )}
        {(active === "transacoes" || active === "pagar" || active === "receber") && (
          <button className="btn btn-gold" onClick={onNewTx}>{newTxButtonLabel()}</button>
        )}
        <input
          ref={extratoRef}
          type="file"
          accept=".csv,.ofx,.pdf,.xlsx,.xls,text/csv,text/plain,application/x-ofx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e, "extrato")}
        />
        <input
          ref={planilhaRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e, "planilha")}
        />
        <input
          ref={toconlineRef}
          type="file"
          accept=".csv,text/csv,text/plain,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e, "toconline")}
        />
        <input
          ref={faturaRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e, "fatura")}
        />
      </div>
    </header>
  );
}

function Painel({ txs, cfg, refMonth, setRefMonth, monthsAvailable, onEditBalance, onShowPending }) {
  const [plFilter, setPlFilter] = useState("Todos");
  const [formaPagFilter, setFormaPagFilter] = useState("Todos");
  const [fixoRange, setFixoRange] = useState("12");
  const [comparativoInicio, setComparativoInicio] = useState("1");
  const [comparativoFim, setComparativoFim] = useState("12");
  const [showEvolDetalhes, setShowEvolDetalhes] = useState(false);
  const [receitasProdutoPeriodo, setReceitasProdutoPeriodo] = useState("mes");

  const [yy, mm] = refMonth.split("-").map(Number);
  const ano = yy;
  const mesNum = mm;

  const filteredTxs = useMemo(() => {
    return txs.filter((t) => {
      if (t.status === "Cancelado") return false;
      if (plFilter !== "Todos" && (t.pl || "") !== plFilter) return false;
      if (formaPagFilter !== "Todos" && (t.formaPagamento || "Banco") !== formaPagFilter) return false;
      return true;
    });
  }, [txs, plFilter, formaPagFilter]);

  const ehReceita = (t) => {
    if (t.origem === "saldo-ancora") return false;
    const c = t.classifContabGrupo || deriveClassifContab(t.contabGrupo) || "";
    return c.startsWith("01.") || c.startsWith("06.") || c.startsWith("09.") || t.forma === "Receita";
  };
  const ehDespesa = (t) => {
    if (t.origem === "saldo-ancora") return false;
    const c = t.classifContabGrupo || deriveClassifContab(t.contabGrupo) || "";
    return c.startsWith("02.") || c.startsWith("03.") || c.startsWith("07.") || c.startsWith("10.") ||
      (t.forma === "Despesa" && !c.startsWith("04.") && !c.startsWith("05.") && !c.startsWith("08."));
  };

  const txsMonth = useMemo(
    () => filteredTxs.filter((t) => (t.data || "").startsWith(refMonth)),
    [filteredTxs, refMonth]
  );

  const hojeIso = todayISO();
  const txsMonthRealizadas = useMemo(
    () => txsMonth.filter((t) => isRealizado(t) && (t.data || "") <= hojeIso),
    [txsMonth, hojeIso]
  );
  const totalReceitas = useMemo(
    () => txsMonthRealizadas.filter(ehReceita).reduce((acc, t) => acc + (Number(t.valorBruto) || 0), 0),
    [txsMonthRealizadas]
  );
  const totalDespesas = useMemo(
    () => txsMonthRealizadas.filter(ehDespesa).reduce((acc, t) => acc + Math.abs(Number(t.valorBruto) || 0), 0),
    [txsMonthRealizadas]
  );
  const saldoOperacional = totalReceitas - totalDespesas;

  const IVA_INICIO_TRACKING = "2025-01-01";
  const isPagamentoIva = (t) =>
    t.forma === "Despesa" &&
    t.status === "Pago" &&
    /\biva\b|guia\s*de\s*pagamento/i.test(`${t.descricao || ""} ${t.fornecedor || ""} ${t.contabSubGrupo || ""} ${t.contabGrupo || ""}`);

  const ivaBuckets = useMemo(() => {
    const hoje = todayISO();
    const buckets = new Map();
    const ensureBucket = (ano, q) => {
      const key = `${ano}-Q${q}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          ano,
          q,
          venc: ivaTrimestreVencimento(`${ano}-${String(q * 3).padStart(2, "0")}-01`),
          retencao: 0,
          pago: 0,
        });
      }
      return buckets.get(key);
    };
    for (const t of txs) {
      if (t.status === "Cancelado") continue;
      const dt = t.data || "";
      if (!dt || dt < IVA_INICIO_TRACKING) continue;
      const ano = parseInt(dt.slice(0, 4), 10);
      const q = quarterFromIso(dt);
      if (!ano || !q) continue;
      if (isPagamentoIva(t)) {
        let alvo = null;
        const m = (t.descricao || "").match(/Q([1-4])[\/\s-]?(\d{4}|\d{2})/i);
        if (m) {
          const qPaid = parseInt(m[1], 10);
          let yPaid = parseInt(m[2], 10);
          if (yPaid < 100) yPaid += 2000;
          alvo = ensureBucket(yPaid, qPaid);
        } else {
          const vencMes = parseInt(dt.slice(5, 7), 10);
          const vencAno = ano;
          let qPaid, yPaid;
          if (vencMes === 5) { qPaid = 1; yPaid = vencAno; }
          else if (vencMes === 8) { qPaid = 2; yPaid = vencAno; }
          else if (vencMes === 11) { qPaid = 3; yPaid = vencAno; }
          else if (vencMes === 2) { qPaid = 4; yPaid = vencAno - 1; }
          else { qPaid = q; yPaid = ano; }
          alvo = ensureBucket(yPaid, qPaid);
        }
        alvo.pago += Math.abs(Number(t.valorBruto) || 0);
      } else {
        const b = ensureBucket(ano, q);
        b.retencao += Math.abs(Number(t.valorRetencao) || 0);
      }
    }
    return [...buckets.values()]
      .map((b) => ({ ...b, saldo: b.retencao - b.pago }))
      .sort((a, b) => (a.venc || "").localeCompare(b.venc || ""));
  }, [txs]);

  const ivaTrimestresPendentes = useMemo(() => {
    const hoje = todayISO();
    return ivaBuckets.filter((b) => b.saldo > 0.005 && b.venc && b.venc > hoje);
  }, [ivaBuckets]);

  const ivaTrProjetadoTotal = useMemo(
    () => ivaTrimestresPendentes.reduce((acc, b) => acc + b.saldo, 0),
    [ivaTrimestresPendentes]
  );
  const saldoLegado = useMemo(() => {
    return filteredTxs
      .filter((t) => (t.pl || "").toLowerCase().includes("legad"))
      .reduce((acc, t) => acc + (ehReceita(t) ? 1 : -1) * (Number(t.valorBruto) || 0), 0);
  }, [filteredTxs]);
  const ultimoDiaMes = useMemo(() => {
    const last = new Date(ano, mesNum, 0);
    return `${ano}-${String(mesNum).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  }, [ano, mesNum]);
  const saldoCgdMes = useMemo(() => saldoAteData(filteredTxs, ultimoDiaMes), [filteredTxs, ultimoDiaMes]);
  const saldoFinalCaixa = saldoCgdMes - ivaTrProjetadoTotal - saldoLegado;

  const saldoCaixaHoje = useMemo(() => {
    const hoje = todayISO();
    const realizadasOrdenadas = [...filteredTxs]
      .filter((t) => isRealizado(t) && t.data && t.data <= hoje && t.status !== "Cancelado")
      .sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.id || "").localeCompare(b.id || ""));
    const ultima = [...realizadasOrdenadas].reverse().find((t) => Number(t.valorSaldo) > 0);
    if (ultima) return Number(ultima.valorSaldo);
    return saldoAteData(filteredTxs, hoje, SALDO_ANCORA, true);
  }, [filteredTxs]);

  const saldoLegadoHoje = ENCONTRO_CONTAS_CARRYOVER.saldoAbertura;
  const saldoLiquidoHoje = saldoCaixaHoje - ivaTrProjetadoTotal - saldoLegadoHoje;

  const reconciliacaoBanco = useMemo(() => {
    const banco = Number(cfg.saldoBanco) || 0;
    if (!banco) return { match: null, diff: 0 };
    const diff = saldoCaixaHoje - banco;
    return { match: Math.abs(diff) < 0.005, diff, banco };
  }, [saldoCaixaHoje, cfg.saldoBanco]);

  const evolucaoMensal = useMemo(() => {
    const hoje = todayISO();
    const hojeAno = parseInt(hoje.slice(0, 4), 10);
    const hojeMes = parseInt(hoje.slice(5, 7), 10);
    const ultimoMesRealizado = ano < hojeAno ? 12 : (ano === hojeAno ? hojeMes : 0);
    if (ultimoMesRealizado === 0) return [];
    const arr = Array.from({ length: ultimoMesRealizado }, (_, i) => ({
      mesNum: i + 1,
      label: MONTHS_SHORT[i],
      entradas: 0,
      saidas: 0,
      resultado: 0,
      saldoCaixa: 0,
      saldoLiquido: 0,
    }));
    for (const t of filteredTxs) {
      if (!isRealizado(t)) continue;
      const dt = t.data || "";
      if (!dt.startsWith(`${ano}-`)) continue;
      const m = parseInt(dt.slice(5, 7), 10);
      if (!m || m > ultimoMesRealizado) continue;
      const v = Math.abs(Number(t.valorBruto) || 0);
      if (ehReceita(t)) arr[m - 1].entradas += v;
      else if (ehDespesa(t)) arr[m - 1].saidas += v;
    }
    const txsRealizadasOrdenadas = [...filteredTxs]
      .filter((t) => isRealizado(t) && t.data && (t.data || "").startsWith(`${ano}-`))
      .sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.id || "").localeCompare(b.id || ""));
    for (let i = 0; i < ultimoMesRealizado; i++) {
      const m = i + 1;
      const lastDay = new Date(ano, m, 0).getDate();
      const endIso = `${ano}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const txsDoMesOuAntes = txsRealizadasOrdenadas.filter((t) => (t.data || "") <= endIso);
      const ultimaTxComSaldo = [...txsDoMesOuAntes].reverse().find((t) => Number(t.valorSaldo) > 0);
      const ultimaTxComSaldoLiq = [...txsDoMesOuAntes].reverse().find((t) => Number(t.valorSaldoSemLegadoIva) > 0);
      const saldoCaixa = ultimaTxComSaldo
        ? Number(ultimaTxComSaldo.valorSaldo)
        : saldoAteData(filteredTxs, endIso, SALDO_ANCORA, true);
      let saldoLiquido;
      if (ultimaTxComSaldoLiq) {
        saldoLiquido = Number(ultimaTxComSaldoLiq.valorSaldoSemLegadoIva);
      } else {
        const ivaAcum = filteredTxs
          .filter((t) => {
            if (t.status === "Cancelado") return false;
            const dt = t.data || "";
            if (!dt || dt > endIso || dt < IVA_INICIO_TRACKING) return false;
            return true;
          })
          .reduce((acc, t) => {
            if (t.forma === "Despesa" && t.status === "Pago" &&
                /\biva\b|guia\s*de\s*pagamento/i.test(`${t.descricao || ""} ${t.fornecedor || ""} ${t.contabSubGrupo || ""} ${t.contabGrupo || ""}`)) {
              return acc - Math.abs(Number(t.valorBruto) || 0);
            }
            return acc + Math.abs(Number(t.valorRetencao) || 0);
          }, 0);
        const legadoAcum = filteredTxs
          .filter((t) => isRealizado(t) && (t.pl || "").toLowerCase().includes("legad") && (t.data || "") <= endIso)
          .reduce((acc, t) => acc + (ehReceita(t) ? 1 : -1) * (Number(t.valorBruto) || 0), 0);
        saldoLiquido = saldoCaixa - ivaAcum - legadoAcum;
      }
      arr[i].resultado = arr[i].entradas - arr[i].saidas;
      arr[i].saldoCaixa = saldoCaixa;
      arr[i].saldoLiquido = saldoLiquido;
    }
    return arr;
  }, [filteredTxs, ano]);

  const despesasPorSubGrupo = useMemo(() => {
    const map = new Map();
    for (const t of txsMonth) {
      if (!ehDespesa(t)) continue;
      const k = t.contabSubGrupo || t.contabGrupo || "Sem categoria";
      map.set(k, (map.get(k) || 0) + Math.abs(Number(t.valorBruto) || 0));
    }
    return [...map.entries()]
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total);
  }, [txsMonth]);

  const receitasPorProdutoRange = useMemo(() => {
    const hoje = todayISO();
    const hojeAno = parseInt(hoje.slice(0, 4), 10);
    const hojeMes = parseInt(hoje.slice(5, 7), 10);
    const trimestre = Math.ceil(hojeMes / 3);
    const semestre = hojeMes <= 6 ? 1 : 2;
    if (receitasProdutoPeriodo === "mes") {
      return { inicio: `${ano}-${String(mesNum).padStart(2, "0")}-01`, fim: ultimoDiaMes, label: `${MONTHS_PT[mesNum - 1]} ${ano}` };
    }
    if (receitasProdutoPeriodo === "trimestre") {
      const t = Math.ceil(mesNum / 3);
      const mIni = (t - 1) * 3 + 1, mFim = t * 3;
      const lastDay = new Date(ano, mFim, 0).getDate();
      return { inicio: `${ano}-${String(mIni).padStart(2, "0")}-01`, fim: `${ano}-${String(mFim).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`, label: `Q${t} ${ano}` };
    }
    if (receitasProdutoPeriodo === "semestre") {
      const s = mesNum <= 6 ? 1 : 2;
      const mIni = s === 1 ? 1 : 7, mFim = s === 1 ? 6 : 12;
      const lastDay = new Date(ano, mFim, 0).getDate();
      return { inicio: `${ano}-${String(mIni).padStart(2, "0")}-01`, fim: `${ano}-${String(mFim).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`, label: `S${s} ${ano}` };
    }
    if (receitasProdutoPeriodo === "ano") {
      return { inicio: `${ano}-01-01`, fim: `${ano}-12-31`, label: `${ano}` };
    }
    if (receitasProdutoPeriodo === "anoAnterior") {
      return { inicio: `${ano - 1}-01-01`, fim: `${ano - 1}-12-31`, label: `${ano - 1}` };
    }
    return { inicio: "0000-01-01", fim: "9999-12-31", label: "Histórico completo" };
  }, [receitasProdutoPeriodo, ano, mesNum, ultimoDiaMes]);

  const receitasPorProduto = useMemo(() => {
    const map = new Map();
    const { inicio, fim } = receitasPorProdutoRange;
    for (const t of filteredTxs) {
      if (!ehReceita(t)) continue;
      const d = t.data || "";
      if (!d || d < inicio || d > fim) continue;
      const k = t.produto || t.contabSubGrupo || "Sem categoria";
      map.set(k, (map.get(k) || 0) + (Number(t.valorBruto) || 0));
    }
    return [...map.entries()]
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTxs, receitasPorProdutoRange]);

  const comparativoAnual = useMemo(() => {
    const ini = Math.max(1, Math.min(12, parseInt(comparativoInicio, 10) || 1));
    const fim = Math.max(ini, Math.min(12, parseInt(comparativoFim, 10) || 12));
    const meses = [];
    for (let m = ini; m <= fim; m++) {
      meses.push({
        mesNum: m,
        label: MONTHS_SHORT[m - 1],
        receitasAtual: 0,
        receitasAnterior: 0,
        despesasAtual: 0,
        despesasAnterior: 0,
      });
    }
    const idx = new Map(meses.map((b, i) => [b.mesNum, i]));
    for (const t of filteredTxs) {
      const dt = t.data || "";
      if (!dt) continue;
      const y = parseInt(dt.slice(0, 4), 10);
      const m = parseInt(dt.slice(5, 7), 10);
      const i = idx.get(m);
      if (i == null) continue;
      const v = Math.abs(Number(t.valorBruto) || 0);
      if (y === ano) {
        if (ehReceita(t)) meses[i].receitasAtual += v;
        else if (ehDespesa(t)) meses[i].despesasAtual += v;
      } else if (y === ano - 1) {
        if (ehReceita(t)) meses[i].receitasAnterior += v;
        else if (ehDespesa(t)) meses[i].despesasAnterior += v;
      }
    }
    return meses;
  }, [filteredTxs, ano, comparativoInicio, comparativoFim]);

  const top5CustosFixos = useMemo(() => {
    return txsMonth
      .filter(ehDespesa)
      .filter((t) => (t.fixoVariavel || "").toLowerCase().startsWith("fix"))
      .sort((a, b) => Math.abs(Number(b.valorBruto) || 0) - Math.abs(Number(a.valorBruto) || 0))
      .slice(0, 5);
  }, [txsMonth]);

  const evolucaoCustosFixos = useMemo(() => {
    const today = new Date();
    let monthsBack;
    if (fixoRange === "3") monthsBack = 3;
    else if (fixoRange === "6") monthsBack = 6;
    else if (fixoRange === "12") monthsBack = 12;
    else monthsBack = 60;
    const startY = today.getFullYear();
    const startM = today.getMonth() + 1;
    const buckets = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      let m = startM - i;
      let y = startY;
      while (m <= 0) { m += 12; y -= 1; }
      const key = `${y}-${String(m).padStart(2, "0")}`;
      buckets.push({ key, label: `${MONTHS_SHORT[m - 1]}/${String(y).slice(-2)}`, total: 0 });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const t of filteredTxs) {
      if (!ehDespesa(t)) continue;
      if (!(t.fixoVariavel || "").toLowerCase().startsWith("fix")) continue;
      const k = (t.data || "").slice(0, 7);
      const i = idx.get(k);
      if (i == null) continue;
      buckets[i].total += Math.abs(Number(t.valorBruto) || 0);
    }
    return buckets;
  }, [filteredTxs, fixoRange]);


  return (
    <div className="erp-content">

      <div className="filter-bar">
        <div className="filter-bar-title">Filtros Globais · Resumo</div>
        <div className="filter-field">
          <label>Período (Mês/Ano)</label>
          <select value={refMonth} onChange={(e) => setRefMonth(e.target.value)}>
            {monthsAvailable.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>P&L (Centro de Negócio)</label>
          <select value={plFilter} onChange={(e) => setPlFilter(e.target.value)}>
            <option value="Todos">Todos</option>
            {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Forma de Pagamento</label>
          <select value={formaPagFilter} onChange={(e) => setFormaPagFilter(e.target.value)}>
            <option value="Todos">Todos</option>
            {FORMA_PAGAMENTO_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="filter-meta-info">
          {txsMonth.length} lançamentos no mês · {filteredTxs.length} totais (filtrados)
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard
          label="Total de Receitas"
          value={fmtEur(totalReceitas)}
          hint="Realizado até hoje · 01/06/09 · BRUTO"
          tone="gold"
        />
        <KpiCard
          label="Total Custos / Despesas"
          value={fmtEur(totalDespesas)}
          hint="Realizado até hoje · 02/03/07/10 · BRUTO"
          tone="red"
        />
        <KpiCard
          label="Saldo Operacional"
          value={(saldoOperacional >= 0 ? "+" : "") + fmtEur(saldoOperacional)}
          hint="Receitas − Custos/Despesas (realizado)"
          tone="gold"
        />
        <KpiCard
          label="Saldo Final (Caixa)"
          value={(saldoFinalCaixa >= 0 ? "+" : "") + fmtEur(saldoFinalCaixa)}
          hint="VL_SALDO − IVA TR. PROJETADO − Saldo Legado"
          tone="gold"
        />
      </div>

      <div className="recon-card">
        <div>
          <div className="recon-label">Saldo em Caixa · hoje</div>
          <div className="recon-value">{fmtEur(saldoCaixaHoje)}</div>
          <div className="recon-sub">
            VL_SALDO (CGD) acumulado · {fmtDate(todayISO())}
          </div>
          {reconciliacaoBanco.match === false && (
            <div className="recon-mismatch">
              <strong>Divergência:</strong> banco em {fmtEur(reconciliacaoBanco.banco)} · diferença {(reconciliacaoBanco.diff >= 0 ? "+" : "−")}{fmtEur(Math.abs(reconciliacaoBanco.diff))}.
              <br />
              Confira o extrato bancário (importação OFX/PDF/XLS) ou ajuste o saldo do banco.
              <button className="btn btn-tiny btn-light" style={{ marginTop: 6 }} onClick={onEditBalance}>
                Ajustar saldo do banco
              </button>
            </div>
          )}
          {reconciliacaoBanco.match === true && (
            <div className="recon-match">Bate com saldo bancário registrado ({fmtEur(reconciliacaoBanco.banco)}).</div>
          )}
          {reconciliacaoBanco.match === null && (
            <div className="recon-sub" style={{ marginTop: 4 }}>
              <button className="btn btn-tiny btn-light" onClick={onEditBalance}>
                Registrar saldo bancário para reconciliar
              </button>
            </div>
          )}
        </div>
        <div>
          <div className="recon-label">IVA TR. Projetado · saldo a pagar</div>
          <div className="recon-value is-red">−{fmtEur(ivaTrProjetadoTotal)}</div>
          <div className="recon-sub">
            {ivaTrimestresPendentes.length === 0
              ? "nenhum trimestre pendente"
              : `${ivaTrimestresPendentes.length} trimestre(s) a vencer`}
          </div>
        </div>
        <div>
          <div className="recon-label">Saldo do Legado · hoje</div>
          <div className={`recon-value ${saldoLegadoHoje > 0 ? "is-red" : ""}`}>−{fmtEur(saldoLegadoHoje)}</div>
          <div className="recon-sub">a favor do sócio · encontro de contas</div>
        </div>
        <div>
          <div className="recon-label">Saldo Líquido · hoje</div>
          <div className={`recon-value ${saldoLiquidoHoje < 0 ? "is-red" : ""}`}>{fmtEur(saldoLiquidoHoje)}</div>
          <div className="recon-sub">VL_SALDO − IVA − Legado · disponível</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Evolução do Caixa — {ano} (realizado)</span>
          <button className="btn btn-light" style={{ fontSize: 12 }} onClick={() => setShowEvolDetalhes(true)}>
            Ver detalhes
          </button>
        </div>
        <div className="card-body">
          {evolucaoMensal.length === 0 ? (
            <div className="empty-pad">Sem meses realizados em {ano}.</div>
          ) : (
            <EvolucaoMensalChart data={evolucaoMensal} />
          )}
        </div>
      </div>

      {showEvolDetalhes && (
        <div className="modal-backdrop" onClick={() => setShowEvolDetalhes(false)}>
          <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Evolução do Caixa — {ano}</div>
                <div className="modal-sub">Detalhamento mensal · valores realizados</div>
              </div>
              <button className="btn btn-light" onClick={() => setShowEvolDetalhes(false)}>Fechar</button>
            </div>
            <div className="modal-body">
              <EvolucaoMensalTabela data={evolucaoMensal} />
            </div>
          </div>
        </div>
      )}

      <div className="charts-grid charts-grid-2-equal">
        <div className="card">
          <div className="card-header">Despesas por Sub-Grupo — {MONTHS_PT[mesNum - 1]} {ano}</div>
          <div className="card-body donut-body">
            <DonutCategoria items={despesasPorSubGrupo} tone="red" />
          </div>
        </div>
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>Receitas por Produto — {receitasPorProdutoRange.label}</span>
            <select
              value={receitasProdutoPeriodo}
              onChange={(e) => setReceitasProdutoPeriodo(e.target.value)}
              style={{ fontSize: 12 }}
            >
              <option value="mes">Mês atual</option>
              <option value="trimestre">Trimestre atual</option>
              <option value="semestre">Semestre atual</option>
              <option value="ano">Ano atual</option>
              <option value="anoAnterior">Ano anterior</option>
              <option value="historico">Histórico completo</option>
            </select>
          </div>
          <div className="card-body donut-body">
            <DonutCategoria items={receitasPorProduto} tone="gold" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>Comparativo com ano passado — Receitas e Custos/Despesas (mês a mês)</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "#5a6255" }}>Período:</label>
            <select value={comparativoInicio} onChange={(e) => setComparativoInicio(e.target.value)} style={{ fontSize: 12 }}>
              {MONTHS_SHORT.map((m, i) => <option key={`ci-${i}`} value={i + 1}>{m}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#5a6255" }}>até</span>
            <select value={comparativoFim} onChange={(e) => setComparativoFim(e.target.value)} style={{ fontSize: 12 }}>
              {MONTHS_SHORT.map((m, i) => <option key={`cf-${i}`} value={i + 1}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body">
          <ComparativoAnualBars data={comparativoAnual} anoAtual={ano} anoAnterior={ano - 1} />
        </div>
      </div>

      <div className="charts-grid charts-grid-2">
        <div className="card">
          <div className="card-header">Top 5 Custos Fixos — {MONTHS_PT[mesNum - 1]} {ano}</div>
          <div className="card-body" style={{ padding: 0 }}>
            {top5CustosFixos.length === 0 ? (
              <div className="empty-pad">Nenhum custo fixo no mês selecionado.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Sub-Grupo</th>
                    <th>Produto</th>
                    <th className="num">Valor (BRUTO)</th>
                  </tr>
                </thead>
                <tbody>
                  {top5CustosFixos.map((t) => (
                    <tr key={t.id}>
                      <td className="strong">{t.fornecedor || t.descricao || "—"}</td>
                      <td>{t.contabSubGrupo || "—"}</td>
                      <td>{t.produto || "—"}</td>
                      <td className="num">{fmtEur(Math.abs(Number(t.valorBruto) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>Evolução de Custos Fixos</span>
            <select value={fixoRange} onChange={(e) => setFixoRange(e.target.value)} style={{ fontSize: 12 }}>
              <option value="3">3 meses</option>
              <option value="6">6 meses</option>
              <option value="12">1 ano</option>
              <option value="all">Todos os anos</option>
            </select>
          </div>
          <div className="card-body">
            <CustoFixoBars data={evolucaoCustosFixos} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EvolucaoMensalChart({ data }) {
  const W = 780, H = 340;
  const padL = 48, padR = 48, padT = 40, padB = 60;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxBar = Math.max(1, ...data.map((d) => Math.max(d.entradas, d.saidas)));
  const allSaldos = [
    ...data.map((d) => d.saldoCaixa),
    ...data.map((d) => d.saldoLiquido),
  ];
  const minSaldo = Math.min(0, ...allSaldos);
  const maxSaldo = Math.max(1, ...allSaldos);
  const saldoRange = Math.max(1, maxSaldo - minSaldo);
  const groupW = innerW / Math.max(1, data.length);
  const barW = Math.max(6, (groupW - 12) / 2);
  const yBar = (v) => padT + innerH - (v / maxBar) * innerH;
  const ySaldo = (v) => padT + innerH - ((v - minSaldo) / saldoRange) * innerH;
  const fmtK = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`;

  const lineCaixa = data.map((d, i) => {
    const cx = padL + groupW * i + groupW / 2;
    return `${i === 0 ? "M" : "L"}${cx},${ySaldo(d.saldoCaixa)}`;
  }).join(" ");
  const lineLiquido = data.map((d, i) => {
    const cx = padL + groupW * i + groupW / 2;
    return `${i === 0 ? "M" : "L"}${cx},${ySaldo(d.saldoLiquido)}`;
  }).join(" ");

  const legendY = H - 18;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
      <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke="#e6e0d4" />
      {data.map((d, i) => {
        const cx = padL + groupW * i + groupW / 2;
        const xEnt = cx - barW - 2;
        const xSai = cx + 2;
        const hEnt = (d.entradas / maxBar) * innerH;
        const hSai = (d.saidas / maxBar) * innerH;
        return (
          <g key={i}>
            {d.entradas > 0 && (
              <rect x={xEnt} y={yBar(d.entradas)} width={barW} height={hEnt} fill="#0bbb86" rx="2" />
            )}
            {d.saidas > 0 && (
              <rect x={xSai} y={yBar(d.saidas)} width={barW} height={hSai} fill="#dc2626" rx="2" />
            )}
            <text x={cx} y={padT + innerH + 14} fontSize="10" fill="#5a6255" textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
      <path d={lineCaixa} fill="none" stroke="#004efe" strokeWidth="2.4" />
      <path d={lineLiquido} fill="none" stroke="#0F766E" strokeWidth="2.4" strokeDasharray="5 4" />
      {data.map((d, i) => {
        const cx = padL + groupW * i + groupW / 2;
        return (
          <g key={`pc-${i}`}>
            <circle cx={cx} cy={ySaldo(d.saldoCaixa)} r="3.5" fill="#004efe" />
            <text x={cx} y={Math.max(padT - 4, ySaldo(d.saldoCaixa) - 8)} fontSize="9" fill="#004efe" textAnchor="middle" fontWeight="600">
              {fmtK(d.saldoCaixa)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const cx = padL + groupW * i + groupW / 2;
        return (
          <g key={`pl-${i}`}>
            <circle cx={cx} cy={ySaldo(d.saldoLiquido)} r="3" fill="#0F766E" />
          </g>
        );
      })}
      <g fontSize="10" fill="#5a6255">
        <rect x={padL} y={legendY - 9} width="10" height="10" fill="#0bbb86" rx="2" /><text x={padL + 14} y={legendY}>Entradas</text>
        <rect x={padL + 78} y={legendY - 9} width="10" height="10" fill="#dc2626" rx="2" /><text x={padL + 92} y={legendY}>Saídas</text>
        <line x1={padL + 150} y1={legendY - 4} x2={padL + 168} y2={legendY - 4} stroke="#004efe" strokeWidth="2.4" />
        <text x={padL + 174} y={legendY}>Saldo em Caixa</text>
        <line x1={padL + 274} y1={legendY - 4} x2={padL + 292} y2={legendY - 4} stroke="#0F766E" strokeWidth="2.4" strokeDasharray="5 4" />
        <text x={padL + 298} y={legendY}>Saldo Líquido (s/ IVA e Legado)</text>
      </g>
    </svg>
  );
}

function EvolucaoMensalTabela({ data }) {
  const filtered = data.filter((d) => d.entradas > 0 || d.saidas > 0 || d.saldoCaixa !== 0);
  if (!filtered.length) return null;
  return (
    <div className="evol-tabela-wrap">
      <table className="evol-tabela">
        <thead>
          <tr>
            <th>Mês</th>
            <th className="num">Receitas</th>
            <th className="num">Saídas</th>
            <th className="num">Resultado</th>
            <th className="num">Saldo Líquido</th>
            <th className="num">Saldo em Caixa</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((d) => (
            <tr key={d.mesNum}>
              <td>{d.label}</td>
              <td className="num is-pos">{fmtEur(d.entradas)}</td>
              <td className="num is-neg">−{fmtEur(d.saidas)}</td>
              <td className={`num ${d.resultado < 0 ? "is-neg" : "is-pos"}`}>
                {(d.resultado >= 0 ? "" : "−") + fmtEur(Math.abs(d.resultado))}
              </td>
              <td className="num">{fmtEur(d.saldoLiquido)}</td>
              <td className="num strong">{fmtEur(d.saldoCaixa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DonutCategoria({ items, tone = "gold" }) {
  const total = items.reduce((acc, i) => acc + Math.abs(i.total), 0);
  if (!total) return <div className="empty-pad">Sem dados no período.</div>;
  const palette = tone === "red"
    ? ["#dc2626", "#ef4444", "#f87171", "#fb923c", "#f59e0b", "#fcd34d", "#a16207", "#7c2d12"]
    : ["#0F766E", "#0bbb86", "#004efe", "#00165b", "#0D9488", "#0d9488", "#7c3aed", "#db2777"];
  const cx = 110, cy = 110, r = 90, rInner = 56;
  let acc = 0;
  const slices = items.map((it, i) => {
    const v = Math.abs(it.total);
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += v;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const x3 = cx + rInner * Math.cos(end), y3 = cy + rInner * Math.sin(end);
    const x4 = cx + rInner * Math.cos(start), y4 = cy + rInner * Math.sin(start);
    const large = end - start > Math.PI ? 1 : 0;
    const d = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${large} 0 ${x4},${y4} Z`;
    return { d, color: palette[i % palette.length], it, pct: (v / total) * 100 };
  });
  return (
    <div className="donut-cat">
      <svg width="220" height="220" viewBox="0 0 220 220">
        {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth="1.5" />)}
        <text x="110" y="108" textAnchor="middle" fontSize="20" fontWeight="700" fill="#212121">{fmtEur(total)}</text>
        <text x="110" y="126" textAnchor="middle" fontSize="10" fill="#5a6255">Total</text>
      </svg>
      <div className="donut-cat-legend">
        {slices.slice(0, 8).map((s, i) => (
          <div key={i} className="donut-cat-legend-row">
            <span className="donut-cat-dot" style={{ background: s.color }} />
            <span className="donut-cat-label">{s.it.label}</span>
            <span className="donut-cat-val">{fmtEur(s.it.total)}</span>
            <span className="donut-cat-pct">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustoFixoBars({ data }) {
  if (!data.length) return <div className="empty-pad">Sem dados no período.</div>;
  const W = 720, H = 240;
  const padL = 44, padR = 16, padT = 18, padB = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.total));
  const groupW = innerW / data.length;
  const barW = Math.max(8, groupW - 12);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const fmtK = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
      <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke="#e6e0d4" />
      {data.map((d, i) => {
        const cx = padL + groupW * i + groupW / 2;
        const h = (d.total / max) * innerH;
        return (
          <g key={i}>
            <rect x={cx - barW / 2} y={y(d.total)} width={barW} height={h} fill="#00165b" rx="2" />
            <text x={cx} y={y(d.total) - 6} fontSize="10" fill="#00165b" textAnchor="middle" fontWeight="600">
              {d.total > 0 ? fmtK(d.total) : ""}
            </text>
            <text x={cx} y={H - 14} fontSize="10" fill="#5a6255" textAnchor="middle"
                  transform={data.length > 12 ? `rotate(-30 ${cx} ${H - 14})` : ""}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function KpiCard({ label, value, hint, tone }) {
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-l">{label}</div>
      <div className="kpi-v">{value}</div>
      <div className="kpi-h">{hint}</div>
    </div>
  );
}

function DonutChart({ pct }) {
  const r = 91;
  const arc = Math.PI * r;
  const dash = arc;
  const offset = dash * (1 - pct / 100);
  const color = pct >= 75 ? "#0d9488" : pct >= 40 ? "#0F766E" : "#dc2626";
  return (
    <svg width="200" height="140" viewBox="0 0 200 140">
      <path d={`M 9 110 A ${r} ${r} 0 0 1 191 110`} fill="none" stroke="#ede6d6" strokeWidth="18" strokeLinecap="round" />
      <path
        d={`M 9 110 A ${r} ${r} 0 0 1 191 110`}
        fill="none"
        stroke={color}
        strokeWidth="18"
        strokeLinecap="round"
        strokeDasharray={dash}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s, stroke 0.3s" }}
      />
      <text x="100" y="96" textAnchor="middle" fontSize="32" fontWeight="800" fill="#212121">{Math.round(pct)}%</text>
      <text x="100" y="118" textAnchor="middle" fontSize="11" fill="#5a6255">atingido</text>
    </svg>
  );
}

function ComparativoAnualBars({ data, anoAtual, anoAnterior }) {
  if (!data.length) return <div className="empty-pad">Sem meses no período selecionado.</div>;
  const W = 880, H = 320;
  const padL = 56, padR = 24, padT = 28, padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(
    1,
    ...data.map((d) => Math.max(d.receitasAtual, d.receitasAnterior, d.despesasAtual, d.despesasAnterior))
  );
  const groupW = innerW / data.length;
  const barW = Math.max(6, (groupW - 16) / 4);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const fmtK = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`;

  const totalReceitasAtual = data.reduce((acc, d) => acc + d.receitasAtual, 0);
  const totalReceitasAnt = data.reduce((acc, d) => acc + d.receitasAnterior, 0);
  const totalDespesasAtual = data.reduce((acc, d) => acc + d.despesasAtual, 0);
  const totalDespesasAnt = data.reduce((acc, d) => acc + d.despesasAnterior, 0);

  const ticks = 4;
  const tickValues = [];
  for (let i = 0; i <= ticks; i++) tickValues.push((max * i) / ticks);

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
        {tickValues.map((tv, i) => (
          <g key={`tick-${i}`}>
            <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} stroke="#ede6d6" strokeDasharray={i === 0 ? "" : "2 4"} />
            <text x={padL - 6} y={y(tv) + 3} fontSize="9" fill="#5a6255" textAnchor="end">{fmtK(tv)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const xBase = padL + groupW * i + 8;
          const items = [
            { v: d.receitasAnterior, color: "#0bbb86", opacity: 0.42 },
            { v: d.receitasAtual, color: "#0bbb86", opacity: 1 },
            { v: d.despesasAnterior, color: "#dc2626", opacity: 0.42 },
            { v: d.despesasAtual, color: "#dc2626", opacity: 1 },
          ];
          return (
            <g key={`g-${i}`}>
              {items.map((it, j) => {
                const xb = xBase + j * (barW + 2);
                const h = (it.v / max) * innerH;
                return (
                  <g key={`b-${i}-${j}`}>
                    {it.v > 0 && (
                      <>
                        <rect x={xb} y={y(it.v)} width={barW} height={h} fill={it.color} fillOpacity={it.opacity} rx="2" />
                        <text x={xb + barW / 2} y={y(it.v) - 4} fontSize="8" fill={it.color} textAnchor="middle" fontWeight="600">
                          {fmtK(it.v)}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
              <text x={xBase + (4 * barW + 6) / 2} y={padT + innerH + 14} fontSize="10" fill="#5a6255" textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
        <g fontSize="10" fill="#5a6255">
          <rect x={padL} y={4} width="10" height="10" fill="#0bbb86" fillOpacity="0.42" rx="2" />
          <text x={padL + 14} y={13}>Receitas {anoAnterior}</text>
          <rect x={padL + 110} y={4} width="10" height="10" fill="#0bbb86" rx="2" />
          <text x={padL + 124} y={13}>Receitas {anoAtual}</text>
          <rect x={padL + 215} y={4} width="10" height="10" fill="#dc2626" fillOpacity="0.42" rx="2" />
          <text x={padL + 229} y={13}>Custos/Despesas {anoAnterior}</text>
          <rect x={padL + 360} y={4} width="10" height="10" fill="#dc2626" rx="2" />
          <text x={padL + 374} y={13}>Custos/Despesas {anoAtual}</text>
        </g>
      </svg>
      <div className="comparativo-totals">
        <div className="comparativo-total-card">
          <div className="comparativo-total-label">Total Receitas {anoAnterior}</div>
          <div className="comparativo-total-value" style={{ color: "#0bbb86", opacity: 0.78 }}>{fmtEur(totalReceitasAnt)}</div>
        </div>
        <div className="comparativo-total-card">
          <div className="comparativo-total-label">Total Receitas {anoAtual}</div>
          <div className="comparativo-total-value" style={{ color: "#0bbb86" }}>{fmtEur(totalReceitasAtual)}</div>
          <div className="comparativo-total-delta">
            {totalReceitasAnt > 0
              ? `${(((totalReceitasAtual - totalReceitasAnt) / totalReceitasAnt) * 100).toFixed(1)}% vs ${anoAnterior}`
              : "—"}
          </div>
        </div>
        <div className="comparativo-total-card">
          <div className="comparativo-total-label">Total Custos/Despesas {anoAnterior}</div>
          <div className="comparativo-total-value" style={{ color: "#dc2626", opacity: 0.78 }}>{fmtEur(totalDespesasAnt)}</div>
        </div>
        <div className="comparativo-total-card">
          <div className="comparativo-total-label">Total Custos/Despesas {anoAtual}</div>
          <div className="comparativo-total-value" style={{ color: "#dc2626" }}>{fmtEur(totalDespesasAtual)}</div>
          <div className="comparativo-total-delta">
            {totalDespesasAnt > 0
              ? `${(((totalDespesasAtual - totalDespesasAnt) / totalDespesasAnt) * 100).toFixed(1)}% vs ${anoAnterior}`
              : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function CashEvolutionChart({ data, startBalance }) {
  const W = 700, H = 220;
  const padL = 36, padR = 36, padT = 36, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const minSaldo = Math.min(startBalance, ...data.map((d) => d.saldo));
  const maxSaldo = Math.max(startBalance, ...data.map((d) => d.saldo));
  const range = Math.max(1, maxSaldo - minSaldo);
  const x = (i) => padL + (innerW * i) / (data.length - 1);
  const y = (v) => padT + innerH - ((v - minSaldo) / range) * innerH;
  const todayIdx = data.findIndex((d) => d.isToday);
  const histPath = data.slice(0, todayIdx + 1).map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.saldo)}`).join(" ");
  const futPath = data.slice(todayIdx).map((d, i) => `${i === 0 ? "M" : "L"}${x(todayIdx + i)},${y(d.saldo)}`).join(" ");
  const areaPath = `${histPath} L${x(todayIdx)},${padT + innerH} L${padL},${padT + innerH} Z`;
  const todayX = x(todayIdx);
  const fmtK = (v) => `${(v / 1000).toFixed(0)}k`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="ye-future" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0F766E" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#0F766E" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} stroke="#e6e0d4" strokeDasharray="4 4" />
      <rect x={todayX} y={padT} width={W - padR - todayX} height={innerH} fill="url(#ye-future)" />
      <path d={areaPath} fill="#0F766E" fillOpacity="0.18" />
      <path d={histPath} fill="none" stroke="#0F766E" strokeWidth="2.6" />
      <path d={futPath} fill="none" stroke="#0F766E" strokeWidth="2.2" strokeDasharray="6 5" opacity="0.8" />
      <line x1={todayX} x2={todayX} y1={padT} y2={padT + innerH} stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />
      <text x={todayX} y={padT - 6} fontSize="9" fill="#dc2626" textAnchor="middle" fontWeight="700">HOJE</text>
      {data.map((d, i) => (
        <g key={i} style={{ opacity: d.isFuture ? 0.7 : 1 }}>
          <circle cx={x(i)} cy={y(d.saldo)} r={d.isToday ? 5 : 3} fill={d.isToday ? "#dc2626" : "#0F766E"} />
          <text x={x(i)} y={H - 12} fontSize="11" fill={d.isToday ? "#212121" : "#5a6255"} textAnchor="middle" fontWeight={d.isToday ? 700 : 400}>{d.label}</text>
          <text x={x(i)} y={y(d.saldo) - 8} fontSize="9" fill="#5a6255" textAnchor="middle">{fmtK(d.saldo)}</text>
        </g>
      ))}
      <text x={padL} y={padT - 4} fontSize="10" fill="#5a6255">{fmtEur(startBalance)}</text>
    </svg>
  );
}

function Transacoes({ txs, onEdit, onDelete, onPay, initialSearch = "", onConsumedInitialSearch }) {
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch);
      if (onConsumedInitialSearch) onConsumedInitialSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearch]);
  const [forma, setForma] = useState("");
  const [status, setStatus] = useState("");
  const [vista, setVista] = useState("todos");
  const [periodo, setPeriodo] = useState("tudo");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");

  const periodoRange = useMemo(() => {
    const today = new Date();
    const todayIso = todayISO();
    if (periodo === "tudo") return { de: "", ate: "" };
    if (periodo === "custom") return { de: dataDe || "", ate: dataAte || "" };
    const d = new Date(today);
    if (periodo === "mes") {
      d.setDate(1);
    } else if (periodo === "3meses") {
      d.setMonth(d.getMonth() - 3);
    } else if (periodo === "6meses") {
      d.setMonth(d.getMonth() - 6);
    } else if (periodo === "ano") {
      d.setFullYear(d.getFullYear() - 1);
    }
    return { de: d.toISOString().slice(0, 10), ate: todayIso };
  }, [periodo, dataDe, dataAte]);

  const counts = useMemo(() => {
    let realizado = 0, projetado = 0, atrasado = 0;
    for (const t of txs) {
      if (t.origem === "saldo-ancora") continue;
      if (t.status === "Atrasado") atrasado++;
      if (isRealizado(t)) realizado++;
      else if (t.status !== "Cancelado") projetado++;
    }
    return { realizado, projetado, atrasado };
  }, [txs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hoje = todayISO();
    const { de, ate } = periodoRange;
    return [...txs]
      .filter((t) => t.origem !== "saldo-ancora")
      .filter((t) => {
        if (t.status === "Atrasado") return true;
        if (vista === "realizado") return isRealizado(t);
        if (vista === "projetado") return !isRealizado(t) && t.status !== "Cancelado";
        return true;
      })
      .filter((t) => !forma || t.forma === forma)
      .filter((t) => !status || t.status === status)
      .filter((t) => {
        const d = t.data || "";
        if (de && d && d < de) return false;
        if (ate && d && d > ate) return false;
        return true;
      })
      .filter((t) => {
        if (!q) return true;
        const textMatch = [t.fornecedor, t.cliente, t.descricao, t.fatura, t.contabGrupo, t.contabSubGrupo, t.origem, t.comentarios]
          .some((v) => (v || "").toLowerCase().includes(q));
        if (textMatch) return true;
        const qNorm = q.replace(/\s/g, "").replace(",", ".");
        const qNum = parseFloat(qNorm);
        if (!Number.isFinite(qNum)) return false;
        const v = Math.abs(Number(t.valorBruto) || 0);
        if (Math.abs(v - Math.abs(qNum)) < 0.005) return true;
        const vStr = v.toFixed(2);
        return vStr.includes(qNorm) || vStr.replace(".", ",").includes(q.replace(/\s/g, ""));
      })
      .sort((a, b) => {
        const da = a.data || "";
        const db = b.data || "";
        if (da !== db) return db.localeCompare(da);
        return (b.createdAt || b.id || "").localeCompare(a.createdAt || a.id || "");
      });
  }, [txs, search, forma, status, vista, periodoRange]);

  const saldoResumo = useMemo(() => {
    let entradas = 0, saidas = 0, entradasReal = 0, saidasReal = 0, count = 0;
    for (const t of filtered) {
      if (t.status === "Cancelado") continue;
      const v = Math.abs(Number(t.valorBruto) || 0);
      const realizado = isRealizado(t);
      if (t.forma === "Receita") {
        entradas += v;
        if (realizado) entradasReal += v;
      } else if (t.forma === "Despesa") {
        saidas += v;
        if (realizado) saidasReal += v;
      }
      count++;
    }
    const { de } = periodoRange;
    let saldoAnterior = SALDO_ANCORA.valor;
    if (de && de > SALDO_ANCORA.data) {
      for (const t of txs) {
        if (t.status === "Cancelado") continue;
        if (t.origem === "saldo-ancora") continue;
        if (!isRealizado(t)) continue;
        const d = t.data || "";
        if (!d) continue;
        if (d <= SALDO_ANCORA.data) continue;
        if (d >= de) continue;
        const v = Math.abs(Number(t.valorBruto) || 0);
        if (t.forma === "Receita") saldoAnterior += v;
        else if (t.forma === "Despesa") saldoAnterior -= v;
      }
    }
    const saldoPeriodoRealizado = entradasReal - saidasReal;
    const saldoPeriodoBruto = entradas - saidas;
    const pendentes = saldoPeriodoBruto - saldoPeriodoRealizado;
    return {
      entradas,
      saidas,
      entradasReal,
      saidasReal,
      saldoPeriodoRealizado,
      saldoPeriodoBruto,
      pendentes,
      saldoAnterior,
      saldoFinal: saldoAnterior + saldoPeriodoRealizado,
      saldoFinalProjetado: saldoAnterior + saldoPeriodoBruto,
      count,
    };
  }, [filtered, txs, periodoRange]);

  const saldoByTxId = useMemo(() => {
    const map = new Map();
    const elegiveis = txs.filter((t) => {
      if (t.origem === "saldo-ancora") return false;
      const d = t.data || "";
      if (!d) return false;
      return d > SALDO_ANCORA.data;
    });
    const chrono = [...elegiveis].sort((a, b) => {
      const da = a.data || "";
      const db = b.data || "";
      if (da !== db) return da.localeCompare(db);
      return (a.createdAt || a.id || "").localeCompare(b.createdAt || b.id || "");
    });
    let saldo = SALDO_ANCORA.valor;
    for (const t of chrono) {
      if (t.status === "Cancelado") {
        map.set(t.id, saldo);
        continue;
      }
      const v = Math.abs(Number(t.valorBruto) || 0);
      if (t.forma === "Receita") saldo += v;
      else if (t.forma === "Despesa") saldo -= v;
      map.set(t.id, saldo);
    }
    return map;
  }, [txs]);

  return (
    <div className="erp-content">
      <div className="tx-saldo-banner tx-saldo-banner-4">
        <div className="tx-saldo-card tx-saldo-anterior">
          <div className="tx-saldo-label">Saldo Anterior</div>
          <div className="tx-saldo-value">{fmtEur(saldoResumo.saldoAnterior)}</div>
          <div className="tx-saldo-sub muted">
            {periodoRange.de
              ? `realizado até ${fmtDate(periodoRange.de)}`
              : `âncora ${fmtDate(SALDO_ANCORA.data)}`}
          </div>
        </div>
        <div className="tx-saldo-card tx-saldo-entradas" title={`Total bruto: ${fmtEur(saldoResumo.entradas)} · Realizado: ${fmtEur(saldoResumo.entradasReal)}`}>
          <div className="tx-saldo-label">Entradas (realizadas)</div>
          <div className="tx-saldo-value">{fmtEur(saldoResumo.entradasReal)}</div>
          {saldoResumo.entradas !== saldoResumo.entradasReal && (
            <div className="tx-saldo-sub muted">+ {fmtEur(saldoResumo.entradas - saldoResumo.entradasReal)} pendente(s)</div>
          )}
        </div>
        <div className="tx-saldo-card tx-saldo-saidas" title={`Total bruto: ${fmtEur(saldoResumo.saidas)} · Realizado: ${fmtEur(saldoResumo.saidasReal)}`}>
          <div className="tx-saldo-label">Saídas (realizadas)</div>
          <div className="tx-saldo-value">{fmtEur(saldoResumo.saidasReal)}</div>
          {saldoResumo.saidas !== saldoResumo.saidasReal && (
            <div className="tx-saldo-sub muted">+ {fmtEur(saldoResumo.saidas - saldoResumo.saidasReal)} pendente(s)</div>
          )}
        </div>
        <div className="tx-saldo-card tx-saldo-total" title={`Bate com Saldo em Caixa do Painel. Projetado (incl. pendentes): ${fmtEur(saldoResumo.saldoFinalProjetado)}`}>
          <div className="tx-saldo-label">Saldo em Caixa</div>
          <div className={`tx-saldo-value ${saldoResumo.saldoFinal >= 0 ? "is-green" : "is-out"}`}>
            {fmtEur(saldoResumo.saldoFinal)}
          </div>
          <div className="tx-saldo-sub muted">
            {saldoResumo.count} lançamento(s) · projetado {fmtEur(saldoResumo.saldoFinalProjetado)}
          </div>
        </div>
      </div>
      <div className="filter-tabs">
        <button
          className={`filter-tab ${vista === "realizado" ? "is-active" : ""}`}
          onClick={() => setVista("realizado")}
        >
          Realizado <span className="filter-tab-count">{counts.realizado}</span>
        </button>
        <button
          className={`filter-tab ${vista === "projetado" ? "is-active" : ""}`}
          onClick={() => setVista("projetado")}
        >
          Projetado <span className="filter-tab-count">{counts.projetado}</span>
        </button>
        <button
          className={`filter-tab ${vista === "todos" ? "is-active" : ""}`}
          onClick={() => setVista("todos")}
        >
          Todos
        </button>
        {counts.atrasado > 0 && (
          <span className="filter-tab-hint">
            <strong>{counts.atrasado}</strong> atrasado{counts.atrasado > 1 ? "s" : ""} sempre visíveis em todas as vistas
          </span>
        )}
      </div>
      <div className="filter-bar">
        <div className="filter-field">
          <label>Buscar</label>
          <input
            type="text"
            value={search}
            placeholder="Fornecedor, cliente, descrição, valor (ex: 80,00)..."
            onChange={(e) => setSearch(e.target.value)}
            title="Aceita texto (fornecedor/cliente/descrição/origem) ou valor numérico (ex: 80, 80.00, 80,00)"
          />
        </div>
        <div className="filter-field">
          <label>Forma</label>
          <select value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">Todas</option>
            <option>Receita</option>
            <option>Despesa</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Período</label>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="tudo">Tudo</option>
            <option value="mes">Este mês</option>
            <option value="3meses">Últimos 3 meses</option>
            <option value="6meses">Últimos 6 meses</option>
            <option value="ano">Último ano</option>
            <option value="custom">Definir período…</option>
          </select>
        </div>
        {periodo === "custom" && (
          <>
            <div className="filter-field">
              <label>De</label>
              <input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Até</label>
              <input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
            </div>
          </>
        )}
        <div className="filter-meta-info">{filtered.length} resultados</div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card">Nenhuma transação registada.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Vencimento</th>
                <th>Forma</th>
                <th>Fornecedor / Cliente</th>
                <th>Descrição</th>
                <th>Grupo</th>
                <th>Origem</th>
                <th>Status</th>
                <th className="num">Valor</th>
                <th className="num">Saldo Bruto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const saldoRow = saldoByTxId.get(t.id);
                return (
                <tr key={t.id}>
                  <td>{fmtDate(t.data)}</td>
                  <td>{fmtDate(t.dtVencimento)}</td>
                  <td><span className={`tag tag-${(t.forma || "").toLowerCase()}`}>{t.forma}</span></td>
                  <td className="strong">{t.forma === "Receita" ? t.cliente : t.fornecedor}</td>
                  <td className="truncate" title={t.descricao}>{t.descricao}</td>
                  <td>{t.contabGrupo}</td>
                  <td className="muted" style={{ fontSize: 11 }} title={t.origem || "Lançamento manual"}>
                    {t.origem || "manual"}
                  </td>
                  <td><StatusPill status={t.status} /></td>
                  <td className="num strong">{fmtEur(t.valorBruto)}</td>
                  <td className={`num ${saldoRow >= 0 ? "is-gold" : "is-out"}`} title="Saldo bruto acumulado após esta transação (cronológico, inclui pendentes)">
                    {saldoRow != null ? fmtEur(saldoRow) : "—"}
                  </td>
                  <td className="row-actions">
                    {!isRealizado(t) && (
                      <button
                        type="button"
                        className="btn btn-tiny btn-gold"
                        onClick={(e) => { e.stopPropagation(); onPay(t); }}
                      >Pagar</button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={(e) => { e.stopPropagation(); onEdit(t); }}
                      title="Editar"
                    >✎</button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                      title="Excluir"
                      aria-label="Excluir transação"
                    >×</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContasLista({ type, title, txs, onEdit, onDelete, onPay, onAttach, onView, onRemoveAttach }) {
  const sorted = useMemo(
    () => [...txs].sort((a, b) => (a.dtVencimento || "").localeCompare(b.dtVencimento || "")),
    [txs]
  );
  const totalPendente = sorted.filter((t) => (!isRealizado(t) && t.status !== "Cancelado"))
    .reduce((acc, t) => acc + (Number(t.valorBruto) || 0), 0);
  const totalPago = sorted.filter((t) => isRealizado(t))
    .reduce((acc, t) => acc + (Number(t.valorBruto) || 0), 0);
  const comAnexo = sorted.filter((t) => t.anexoId).length;

  return (
    <div className="erp-content">
      <div className="kpi-row">
        <KpiCard label={`${title} — Pendente`} value={fmtEur(totalPendente)} hint={`${sorted.filter((t) => (!isRealizado(t) && t.status !== "Cancelado")).length} lançamentos`} tone="red" />
        <KpiCard label={`${title} — Pago`} value={fmtEur(totalPago)} hint={`${sorted.filter((t) => isRealizado(t)).length} lançamentos`} tone="gold" />
        <KpiCard label="Faturas anexadas" value={`${comAnexo} / ${sorted.length}`} hint="lançamentos com fatura" tone="gold" />
      </div>

      {sorted.length === 0 ? (
        <div className="empty-card">Sem lançamentos de {type === "Despesa" ? "contas a pagar" : "contas a receber"}.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Documento</th>
                <th>{type === "Despesa" ? "Fornecedor" : "Cliente"}</th>
                <th>Descrição</th>
                <th>Status</th>
                <th className="num">Valor</th>
                <th>Fatura</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.dtVencimento)}</td>
                  <td>{t.fatura}</td>
                  <td className="strong">{type === "Despesa" ? t.fornecedor : t.cliente}</td>
                  <td className="truncate" title={t.descricao}>{t.descricao}</td>
                  <td><StatusPill status={t.status} /></td>
                  <td className="num strong">{fmtEur(t.valorBruto)}</td>
                  <td>
                    <InvoiceCell
                      tx={t}
                      onAttach={onAttach}
                      onView={onView}
                      onRemove={onRemoveAttach}
                    />
                  </td>
                  <td className="row-actions">
                    {(!isRealizado(t) && t.status !== "Cancelado") && (
                      <button className="btn btn-tiny btn-gold" onClick={() => onPay(t)}>{type === "Despesa" ? "Pagar" : "Receber"}</button>
                    )}
                    <button className="icon-btn" onClick={() => onEdit(t)} title="Editar">✎</button>
                    <button className="icon-btn danger" onClick={() => onDelete(t.id)} title="Excluir">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoiceCell({ tx, onAttach, onView, onRemove }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { await onAttach(tx, file); } finally { setBusy(false); }
  }

  if (tx.anexoId) {
    return (
      <div className="invoice-cell">
        <button
          className="invoice-link"
          onClick={() => onView(tx)}
          title={tx.anexoNome}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="invoice-name">{tx.anexoNome || "Fatura"}</span>
        </button>
        <button
          className="icon-btn danger"
          onClick={() => onRemove(tx)}
          title="Remover fatura"
        >×</button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={handleFile}
        />
        <button
          className="invoice-replace"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title="Substituir fatura"
        >
          {busy ? "..." : "↻"}
        </button>
      </div>
    );
  }

  return (
    <div className="invoice-cell">
      <button
        className="btn btn-tiny btn-light invoice-upload"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        {busy ? "A enviar…" : "Anexar"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </div>
  );
}

const DRE_RECEITA_BRUTA_SUBS = new Set([
  "Comissão Compra",
  "Comissão - Venda",
  "Comissão - Arrendamento",
  "Comissão Indicação",
  "Comissão Jurídica",
  "Gestão de Imóveis AL",
  "Gestão de Imóveis LD",
  "Gestão de Imóveis MD",
  "Assessoria",
]);

const DRE_DESPESA_FIXA_SUBS = new Set([
  "Salários",
  "Salários Adm",
  "Férias",
  "Rescisão",
  "Prêmio",
  "Quilometragem",
  "Ticket Educação",
  "RH",
  "Reembolso Funcionário",
  "Marketing",
  "Aluguel",
  "Telefonia",
  "Contábil",
  "Seguros",
  "Sistemas Operacionais",
  "Despesas Bancárias",
  "Despesas Administrativas",
  "Máquinas e Equipamentos",
  "Transporte",
]);

const DRE_PERIODOS = [
  { id: "ano", label: "Ano completo", meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { id: "s1", label: "1º Semestre", meses: [1, 2, 3, 4, 5, 6] },
  { id: "s2", label: "2º Semestre", meses: [7, 8, 9, 10, 11, 12] },
  { id: "q1", label: "Q1 (Jan–Mar)", meses: [1, 2, 3] },
  { id: "q2", label: "Q2 (Abr–Jun)", meses: [4, 5, 6] },
  { id: "q3", label: "Q3 (Jul–Set)", meses: [7, 8, 9] },
  { id: "q4", label: "Q4 (Out–Dez)", meses: [10, 11, 12] },
];

function classifyDreLine(tx) {
  const c = tx.classifContabGrupo || deriveClassifContab(tx.contabGrupo) || "";
  const sub = tx.contabSubGrupo || "";
  if (DRE_RECEITA_BRUTA_SUBS.has(sub)) return "receita_bruta";
  if (c.startsWith("01.") || c.startsWith("06.") || c.startsWith("09.")) return "receita_bruta";
  if (c.startsWith("04.")) return "impostos";
  if (sub === "Tributos - IVA") return "impostos";
  if (c.startsWith("02.")) return "custos_diretos";
  if (DRE_DESPESA_FIXA_SUBS.has(sub)) return "despesa_fixa";
  if (c.startsWith("03.")) return "despesa_fixa";
  if (c.startsWith("05.")) return "retirada_socio";
  return "outros";
}

function DRE({ txs }) {
  const yearNow = new Date().getFullYear();
  const [year, setYear] = useState(yearNow);
  const [periodo, setPeriodo] = useState("ano");
  const [expanded, setExpanded] = useState(new Set());

  const yearsAvailable = useMemo(() => {
    const set = new Set();
    txs.forEach((t) => t.data && set.add(Number(t.data.slice(0, 4))));
    set.add(yearNow);
    return Array.from(set).filter((y) => y && !isNaN(y)).sort().reverse();
  }, [txs, yearNow]);

  const periodoCfg = DRE_PERIODOS.find((p) => p.id === periodo) || DRE_PERIODOS[0];
  const mesesAtivos = new Set(periodoCfg.meses);

  const yearTxs = useMemo(() => {
    return txs.filter((t) => {
      if (t.origem === "saldo-ancora") return false;
      if (!t.data) return false;
      if (t.data.slice(0, 4) !== String(year)) return false;
      if ((t.actPlan || deriveActPlan(t.status)) !== "Act") return false;
      const m = parseInt(t.data.slice(5, 7), 10);
      if (!mesesAtivos.has(m)) return false;
      return true;
    });
  }, [txs, year, periodo]);

  const matrix = useMemo(() => {
    const buckets = {
      receita_bruta: new Map(),
      impostos: new Map(),
      custos_diretos: new Map(),
      despesa_fixa: new Map(),
      retirada_socio: new Map(),
      outros: new Map(),
    };
    for (const t of yearTxs) {
      const bucket = classifyDreLine(t);
      const m = Number(t.data.slice(5, 7)) - 1;
      const v = Math.abs(Number(t.valorBruto) || 0);
      const subKey = t.contabSubGrupo || t.contabGrupo || t.descricao || "—";
      const map = buckets[bucket];
      if (!map.has(subKey)) map.set(subKey, { name: subKey, monthly: new Array(12).fill(0), detail: new Map() });
      const g = map.get(subKey);
      g.monthly[m] += v;
      const detKey = t.fornecedor || t.cliente || t.descricao || "—";
      const det = g.detail.get(detKey) || { name: detKey, monthly: new Array(12).fill(0) };
      det.monthly[m] += v;
      g.detail.set(detKey, det);
    }

    const totalSum = (arr) => arr.reduce((a, b) => a + b, 0);
    const sumGroup = (map) => {
      const monthly = new Array(12).fill(0);
      for (const g of map.values()) {
        for (let i = 0; i < 12; i++) monthly[i] += g.monthly[i];
      }
      return monthly;
    };
    const detailFromMap = (map, sign = 1) => Array.from(map.values())
      .sort((a, b) => totalSum(b.monthly) - totalSum(a.monthly))
      .map((g) => ({
        name: g.name,
        monthly: g.monthly.map((v) => v * sign),
        detail: Array.from(g.detail.values())
          .sort((a, b) => totalSum(b.monthly) - totalSum(a.monthly))
          .map((d) => ({ name: d.name, monthly: d.monthly.map((v) => v * sign) })),
      }));

    const receitaBruta = sumGroup(buckets.receita_bruta);
    const impostos = sumGroup(buckets.impostos);
    const liquida = receitaBruta.map((v, i) => v - impostos[i]);
    const custosDiretos = sumGroup(buckets.custos_diretos);
    const margemContrib = liquida.map((v, i) => v - custosDiretos[i]);
    const despesasFixas = sumGroup(buckets.despesa_fixa);
    const ebitda = margemContrib.map((v, i) => v - despesasFixas[i]);
    const retiradas = sumGroup(buckets.retirada_socio);
    const lucroLiquido = ebitda.map((v, i) => v - retiradas[i]);

    const lines = [
      {
        id: "receita_bruta",
        label: "Receita Bruta Operacional",
        kind: "head", tone: "gold",
        monthly: receitaBruta,
        total: totalSum(receitaBruta),
        detail: detailFromMap(buckets.receita_bruta, 1),
      },
      {
        id: "impostos",
        label: "( - ) Impostos Incidentes",
        kind: "neg",
        monthly: impostos.map((v) => -v),
        total: -totalSum(impostos),
        detail: detailFromMap(buckets.impostos, -1),
      },
      {
        id: "receita_liquida",
        label: "(=) Receita Líquida",
        kind: "subtotal",
        monthly: liquida,
        total: totalSum(liquida),
      },
      {
        id: "custos_diretos",
        label: "( - ) Custos Diretos",
        kind: "neg",
        monthly: custosDiretos.map((v) => -v),
        total: -totalSum(custosDiretos),
        detail: detailFromMap(buckets.custos_diretos, -1),
      },
      {
        id: "margem_contrib",
        label: "(=) Margem de Contribuição (Lucro Bruto)",
        kind: "subtotal",
        monthly: margemContrib,
        total: totalSum(margemContrib),
      },
      {
        id: "despesas_fixas",
        label: "( - ) Despesas Operacionais (Fixas)",
        kind: "neg",
        monthly: despesasFixas.map((v) => -v),
        total: -totalSum(despesasFixas),
        detail: detailFromMap(buckets.despesa_fixa, -1),
      },
      {
        id: "ebitda",
        label: "(=) EBITDA",
        kind: "total",
        monthly: ebitda,
        total: totalSum(ebitda),
      },
    ];

    if (totalSum(retiradas) > 0) {
      lines.push({
        id: "retiradas",
        label: "( - ) Retirada de Lucros",
        kind: "neg",
        monthly: retiradas.map((v) => -v),
        total: -totalSum(retiradas),
        detail: detailFromMap(buckets.retirada_socio, -1),
      });
      lines.push({
        id: "lucro_liquido",
        label: "(=) Lucro Líquido",
        kind: "total",
        monthly: lucroLiquido,
        total: totalSum(lucroLiquido),
      });
    }

    return {
      lines,
      totals: {
        receitaBruta: totalSum(receitaBruta),
        impostos: totalSum(impostos),
        liquida: totalSum(liquida),
        custosDiretos: totalSum(custosDiretos),
        margemContrib: totalSum(margemContrib),
        despesasFixas: totalSum(despesasFixas),
        ebitda: totalSum(ebitda),
        retiradas: totalSum(retiradas),
        lucroLiquido: totalSum(lucroLiquido),
      },
      monthlyEbitda: ebitda,
      monthlyMargem: margemContrib,
      monthlyReceita: receitaBruta,
    };
  }, [yearTxs]);

  function toggle(id) {
    setExpanded((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  }

  const t = matrix.totals;
  const ebitdaMargin = t.liquida > 0 ? (t.ebitda / t.liquida) * 100 : 0;
  const margemBrutaPct = t.liquida > 0 ? (t.margemContrib / t.liquida) * 100 : 0;
  const taxImpact = t.receitaBruta > 0 ? -(t.impostos / t.receitaBruta) * 100 : 0;

  return (
    <div className="erp-content">
      <div className="filter-bar">
        <div className="filter-bar-title">DRE / Análise Financeira</div>
        <div className="filter-field">
          <label>Ano</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Período</label>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {DRE_PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="filter-meta-info">
          {yearTxs.length} lançamentos · apenas <strong>Act/Plan = Act</strong>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Receita Bruta" value={fmtEur(t.receitaBruta)} hint="Comissões + Gestão + Assessoria" tone="gold" />
        <KpiCard label="Receita Líquida" value={fmtEur(t.liquida)} hint={`impostos ${taxImpact.toFixed(1)}%`} tone="gold" />
        <KpiCard label="Margem de Contribuição" value={fmtEur(t.margemContrib)} hint={`margem bruta ${margemBrutaPct.toFixed(1)}%`} tone="gold" />
        <KpiCard label="EBITDA" value={fmtEur(t.ebitda)} hint={`margem EBITDA ${ebitdaMargin.toFixed(1)}%`} tone={t.ebitda >= 0 ? "gold" : "red"} />
      </div>

      <div className="charts-grid charts-grid-2">
        <div className="card">
          <div className="card-header">EBITDA Mensal — {year} ({periodoCfg.label})</div>
          <div className="card-body">
            <DREMonthlyBars data={matrix.monthlyEbitda} ativos={mesesAtivos} />
          </div>
        </div>
        <div className="card">
          <div className="card-header">Composição da Receita Líquida</div>
          <div className="card-body donut-body">
            <DREWaterfall totals={t} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          DRE {year} · {periodoCfg.label}
          <span className="card-header-hint">Clique nas linhas com (+) para abrir o detalhe</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="dre-matrix-wrap">
            <table className="dre-matrix">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th className="dre-row-label">Linha</th>
                  {MONTHS_SHORT.map((m, i) => (
                    <th key={m} className={`num ${mesesAtivos.has(i + 1) ? "" : "dre-col-off"}`}>{m}</th>
                  ))}
                  <th className="num dre-total-col">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.lines.map((line) => {
                  const hasDetail = (line.detail || []).length > 0;
                  const isOpen = expanded.has(line.id);
                  return (
                    <React.Fragment key={line.id}>
                      <tr className={`dre-row dre-row-${line.kind} ${hasDetail ? "is-clickable" : ""}`} onClick={hasDetail ? () => toggle(line.id) : undefined}>
                        <td className="dre-toggle">{hasDetail ? (isOpen ? "−" : "+") : ""}</td>
                        <td className="dre-row-label">{line.label}</td>
                        {line.monthly.map((v, i) => (
                          <td key={i} className={`num ${!mesesAtivos.has(i + 1) ? "dre-col-off muted" : v === 0 ? "muted" : v < 0 ? "is-out" : "is-gold"}`}>
                            {!mesesAtivos.has(i + 1) ? "·" : v === 0 ? "—" : fmtEur(v)}
                          </td>
                        ))}
                        <td className={`num dre-total-col ${line.total < 0 ? "is-out" : "is-gold"}`}>{fmtEur(line.total)}</td>
                      </tr>
                      {isOpen && (line.detail || []).map((d, i) => {
                        const subTotal = d.monthly.reduce((a, b) => a + b, 0);
                        return (
                          <React.Fragment key={`${line.id}-${i}`}>
                            <tr className="dre-row-detail">
                              <td></td>
                              <td className="dre-row-label dre-row-label-sub">{d.name}</td>
                              {d.monthly.map((v, j) => (
                                <td key={j} className={`num ${!mesesAtivos.has(j + 1) ? "dre-col-off muted" : v === 0 ? "muted" : v < 0 ? "is-out" : "is-gold"}`}>
                                  {!mesesAtivos.has(j + 1) ? "·" : v === 0 ? "—" : fmtEur(v)}
                                </td>
                              ))}
                              <td className={`num dre-total-col ${subTotal < 0 ? "is-out" : "is-gold"}`}>{fmtEur(subTotal)}</td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DREMonthlyBars({ data, ativos }) {
  const W = 720, H = 220;
  const padL = 44, padR = 16, padT = 18, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...data.map((v) => Math.abs(v)));
  const groupW = innerW / 12;
  const barW = Math.max(8, groupW - 14);
  const zeroY = padT + innerH / 2;
  const fmtK = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="#e6e0d4" />
      {data.map((v, i) => {
        const cx = padL + groupW * i + groupW / 2;
        const ativo = ativos.has(i + 1);
        const h = (Math.abs(v) / max) * (innerH / 2 - 4);
        const y = v >= 0 ? zeroY - h : zeroY;
        const fill = !ativo ? "#e6e0d4" : v >= 0 ? "#0bbb86" : "#dc2626";
        return (
          <g key={i} opacity={ativo ? 1 : 0.4}>
            <rect x={cx - barW / 2} y={y} width={barW} height={Math.max(1, h)} fill={fill} rx="2" />
            {ativo && Math.abs(v) > 0 && (
              <text x={cx} y={v >= 0 ? y - 5 : y + h + 11} fontSize="9" fill={v >= 0 ? "#0bbb86" : "#dc2626"} textAnchor="middle" fontWeight="600">
                {fmtK(v)}
              </text>
            )}
            <text x={cx} y={H - 14} fontSize="10" fill="#5a6255" textAnchor="middle">{MONTHS_SHORT[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DREWaterfall({ totals }) {
  const items = [
    { label: "Receita Bruta", value: totals.receitaBruta, color: "#0bbb86" },
    { label: "Impostos", value: -totals.impostos, color: "#dc2626" },
    { label: "Custos Diretos", value: -totals.custosDiretos, color: "#f87171" },
    { label: "Despesas Fixas", value: -totals.despesasFixas, color: "#fb923c" },
    { label: "EBITDA", value: totals.ebitda, color: totals.ebitda >= 0 ? "#004efe" : "#dc2626", final: true },
  ];
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div style={{ width: "100%", padding: "8px 4px" }}>
      {items.map((it, i) => {
        const pct = (Math.abs(it.value) / max) * 100;
        return (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span style={{ fontWeight: it.final ? 700 : 500 }}>{it.label}</span>
              <span style={{ fontWeight: 600, color: it.value < 0 ? "var(--red)" : "var(--black)" }}>
                {it.value < 0 ? "−" : ""}{fmtEur(Math.abs(it.value))}
              </span>
            </div>
            <div style={{ height: it.final ? 14 : 10, background: "var(--beige-warm)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: it.color, borderRadius: 3, transition: "width 0.4s" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FluxoProjetado({ txs, saldoInicial, onEdit, onPay }) {
  const [agrupamento, setAgrupamento] = useState("mes");
  const today = todayISO();
  const todayDate = new Date(today);

  const enriched = useMemo(() => {
    return txs
      .filter((t) => t.origem !== "saldo-ancora" && t.data && t.status !== "Cancelado")
      .map((t) => {
        const v = Number(t.valorBruto) || 0;
        const liquido = Number(t.valorLiquido) || v;
        const c = t.classifContabGrupo || deriveClassifContab(t.contabGrupo) || "";
        const isReceita = c.startsWith("01.") || c.startsWith("06.") || c.startsWith("09.") || t.forma === "Receita";
        const delta = isReceita ? v : -v;
        return { ...t, delta, liquido, isPast: t.data <= today, isPaid: isRealizado(t) };
      })
      .sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  }, [txs, today]);

  const [dtInicio, setDtInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    return d.toISOString().slice(0, 10);
  });
  const [dtFim, setDtFim] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  });

  const summary = useMemo(() => {
    const disponivel = saldoAteData(txs, today, SALDO_ANCORA, true);
    const passadosPendentesValor = enriched
      .filter((t) => t.isPast && !t.isPaid)
      .reduce((acc, t) => acc + t.delta, 0);
    const futuro = enriched
      .filter((t) => !t.isPast)
      .reduce((acc, t) => acc + t.delta, 0);
    const realizado = disponivel;
    const passadosPendentes = enriched.filter((t) => t.isPast && !t.isPaid).length;
    return {
      disponivel,
      futuro,
      passadosPendentesValor,
      finalProjetado: disponivel + passadosPendentesValor + futuro,
      realizado,
      passadosPendentes,
    };
  }, [enriched, txs, today]);

  const monthlyProj = useMemo(() => {
    const map = new Map();
    for (const t of enriched) {
      if (t.data < today) continue;
      let chave;
      if (agrupamento === "trimestre") {
        const [yy, mm] = t.data.split("-").map(Number);
        const q = Math.ceil(mm / 3);
        chave = `${yy}-T${q}`;
      } else if (agrupamento === "semestre") {
        const [yy, mm] = t.data.split("-").map(Number);
        const s = mm <= 6 ? 1 : 2;
        chave = `${yy}-S${s}`;
      } else {
        chave = t.data.slice(0, 7);
      }
      if (!map.has(chave)) map.set(chave, { chave, receber: 0, pagar: 0, count: 0 });
      const g = map.get(chave);
      if (t.forma === "Receita") g.receber += Number(t.valorBruto) || 0;
      else g.pagar += Number(t.valorBruto) || 0;
      g.count += 1;
    }
    let saldo = summary.disponivel;
    return Array.from(map.values())
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((g) => {
        saldo += g.receber - g.pagar;
        return { ...g, saldoProj: saldo };
      });
  }, [enriched, today, agrupamento, summary.disponivel]);

  const fmtChave = (k) => {
    if (k.includes("T")) {
      const [y, q] = k.split("-T");
      return `${q}º Trim ${y}`;
    }
    if (k.includes("S")) {
      const [y, s] = k.split("-S");
      return `${s}º Sem ${y}`;
    }
    const [y, m] = k.split("-");
    return `${MONTHS_PT[Number(m) - 1]} ${y}`;
  };

  const proximasPendentes = useMemo(() => {
    return enriched
      .filter((t) => !t.isPaid && t.dtVencimento >= today)
      .sort((a, b) => (a.dtVencimento || "").localeCompare(b.dtVencimento || ""))
      .slice(0, 8);
  }, [enriched, today]);

  return (
    <div className="erp-content">
      {summary.passadosPendentes > 0 && (
        <div className="banner-warn">
          <span className="banner-warn-mark">!</span>
          <div>
            <strong>Atenção:</strong> Existem <strong>{summary.passadosPendentes}</strong> lançamentos passados pendentes de confirmação (data anterior a hoje, mas ainda sem estado &quot;Pago&quot; ou &quot;Recebido&quot;). Verifique e atualize o estado para garantir a paridade com o banco.
          </div>
        </div>
      )}

      <div className="kpi-row">
        <div className="kpi tone-gold">
          <div className="kpi-l">Saldo Disponível (Hoje)</div>
          <div className={`kpi-v ${summary.disponivel < 0 ? "is-red" : ""}`}>{fmtEur(summary.disponivel)}</div>
          <div className="kpi-h">VL_SALDO (CGD) realizado até {fmtDate(today)} · âncora {fmtDate(SALDO_ANCORA.data)} {fmtEur(SALDO_ANCORA.valor)}</div>
        </div>
        <div className="kpi tone-gold">
          <div className="kpi-l">Fluxo Previsto (Futuro)</div>
          <div className={`kpi-v ${summary.futuro < 0 ? "is-red" : ""}`}>{fmtEur(summary.futuro)}</div>
          <div className="kpi-h">Σ líquido onde data &gt; {fmtDate(today)}</div>
        </div>
        <div className="kpi tone-neutral">
          <div className="kpi-l">Saldo Final Projetado</div>
          <div className={`kpi-v ${summary.finalProjetado < 0 ? "is-red" : ""}`}>{fmtEur(summary.finalProjetado)}</div>
          <div className="kpi-h">Disponível + Futuro</div>
        </div>
        <div className="kpi tone-dark">
          <div className="kpi-l">Realizado (apenas Pagos)</div>
          <div className="kpi-v">{fmtEur(summary.realizado)}</div>
          <div className="kpi-h">Confirmado pelo banco</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header card-header-with-controls">
          <span>Saldo Acumulado Diário (Realizado vs Projetado)</span>
          <div className="card-header-controls">
            <input type="date" value={dtInicio} onChange={(e) => setDtInicio(e.target.value)} />
            <span className="muted">até</span>
            <input type="date" value={dtFim} onChange={(e) => setDtFim(e.target.value)} />
          </div>
        </div>
        <div className="card-body">
          <DailyBalanceChart
            enriched={enriched}
            saldoInicial={saldoAteData(txs, dtInicio < SALDO_ANCORA.data ? SALDO_ANCORA.data : (() => {
              const d = new Date(dtInicio);
              d.setDate(d.getDate() - 1);
              return d.toISOString().slice(0, 10);
            })())}
            today={today}
            dtInicio={dtInicio}
            dtFim={dtFim}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header card-header-with-controls">
          <span>Projeção de Fluxo · {agrupamento === "mes" ? "Mensal" : agrupamento === "trimestre" ? "Trimestral" : "Semestral"}</span>
          <div className="seg-control">
            {[
              { id: "mes", label: "Mês" },
              { id: "trimestre", label: "Trimestre" },
              { id: "semestre", label: "Semestre" },
            ].map((o) => (
              <button
                key={o.id}
                className={`seg-btn ${agrupamento === o.id ? "is-active" : ""}`}
                onClick={() => setAgrupamento(o.id)}
              >{o.label}</button>
            ))}
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {monthlyProj.length === 0 ? (
            <div className="empty-pad">Nenhum lançamento futuro projetado.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="num">A receber</th>
                  <th className="num">A pagar</th>
                  <th className="num">Saldo Projetado</th>
                  <th className="num">Lançamentos</th>
                </tr>
              </thead>
              <tbody>
                {monthlyProj.map((g) => (
                  <tr key={g.chave}>
                    <td className="strong">{fmtChave(g.chave)}</td>
                    <td className="num" style={{ color: "var(--gold-strong)" }}>{fmtEur(g.receber)}</td>
                    <td className="num" style={{ color: "var(--red)" }}>−{fmtEur(g.pagar)}</td>
                    <td className={`num strong ${g.saldoProj < 0 ? "is-out" : ""}`}>{fmtEur(g.saldoProj)}</td>
                    <td className="num">{g.count}</td>
                  </tr>
                ))}
                <tr className="dre-total">
                  <td>TOTAL Projetado</td>
                  <td className="num">{fmtEur(monthlyProj.reduce((a, g) => a + g.receber, 0))}</td>
                  <td className="num">−{fmtEur(monthlyProj.reduce((a, g) => a + g.pagar, 0))}</td>
                  <td className="num">{fmtEur(monthlyProj[monthlyProj.length - 1]?.saldoProj || 0)}</td>
                  <td className="num">{monthlyProj.reduce((a, g) => a + g.count, 0)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">Próximas Movimentações Pendentes</div>
        <div className="card-body" style={{ padding: 0 }}>
          {proximasPendentes.length === 0 ? (
            <div className="empty-pad">Sem movimentações pendentes futuras.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Data Prevista</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th className="num">Valor</th>
                  <th className="num">Ações</th>
                </tr>
              </thead>
              <tbody>
                {proximasPendentes.map((t) => (
                  <tr key={t.id}>
                    <td className="receber-date">{fmtDate(t.dtVencimento)}</td>
                    <td>
                      <div className="receber-cliente">{t.descricao || (t.forma === "Receita" ? t.cliente : t.fornecedor) || "—"}</div>
                      {(t.fornecedor || t.cliente) && t.descricao && (
                        <div className="receber-desc">{t.forma === "Receita" ? t.cliente : t.fornecedor}</div>
                      )}
                    </td>
                    <td>
                      <span className={`pill pill-${t.forma === "Receita" ? "pago" : "atrasado"}`}>
                        {t.forma === "Receita" ? "A receber" : "A pagar"}
                      </span>
                    </td>
                    <td className={`num strong ${t.forma === "Receita" ? "" : "is-out"}`}>
                      {t.forma === "Receita" ? "+" : "−"}{fmtEur(t.valorBruto)}
                    </td>
                    <td className="row-actions">
                      <button className="btn btn-tiny btn-gold" onClick={() => onPay(t)}>
                        {t.forma === "Receita" ? "Receber" : "Pagar"}
                      </button>
                      <button className="btn btn-link" onClick={() => onEdit(t)}>Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DailyBalanceChart({ enriched, saldoInicial, today, dtInicio, dtFim }) {
  const W = 920, H = 260;
  const padL = 60, padR = 30, padT = 20, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const series = useMemo(() => {
    const filtered = enriched.filter((t) => t.data >= dtInicio && t.data <= dtFim);
    const dates = new Set();
    let d = new Date(dtInicio);
    const end = new Date(dtFim);
    while (d <= end) {
      dates.add(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    const sortedDates = Array.from(dates).sort();
    const projetadoMap = new Map();
    const realizadoMap = new Map();
    let saldoP = saldoInicial;
    let saldoR = saldoInicial;
    for (const day of sortedDates) {
      const txDay = filtered.filter((t) => t.data === day);
      const deltaP = txDay.reduce((a, t) => a + t.delta, 0);
      const deltaR = txDay.filter((t) => t.isPaid).reduce((a, t) => a + t.delta, 0);
      saldoP += deltaP;
      saldoR += deltaR;
      projetadoMap.set(day, saldoP);
      realizadoMap.set(day, saldoR);
    }
    return { dates: sortedDates, projetado: projetadoMap, realizado: realizadoMap };
  }, [enriched, saldoInicial, dtInicio, dtFim]);

  if (series.dates.length < 2) {
    return <div className="empty-pad">Selecione um intervalo válido.</div>;
  }

  const allValues = [
    ...Array.from(series.projetado.values()),
    ...Array.from(series.realizado.values()),
    saldoInicial,
    0,
  ];
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = Math.max(1, maxV - minV);

  const x = (d) => padL + (innerW * series.dates.indexOf(d)) / (series.dates.length - 1);
  const y = (v) => padT + innerH - ((v - minV) / range) * innerH;
  const todayClamped = today < series.dates[0] ? series.dates[0] : today > series.dates[series.dates.length - 1] ? series.dates[series.dates.length - 1] : today;
  const todayX = x(todayClamped);

  const pastDates = series.dates.filter((d) => d <= today);
  const futureDates = series.dates.filter((d) => d >= today);

  const projPath = (datesArr) =>
    datesArr.map((d, i) => `${i === 0 ? "M" : "L"}${x(d)},${y(series.projetado.get(d))}`).join(" ");
  const realPath = pastDates.map((d, i) => `${i === 0 ? "M" : "L"}${x(d)},${y(series.realizado.get(d))}`).join(" ");

  const areaPath = `${projPath(series.dates)} L${x(series.dates[series.dates.length - 1])},${y(0)} L${x(series.dates[0])},${y(0)} Z`;

  const yTicks = [maxV, (maxV + minV) / 2, minV];
  const fmtK = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k €` : `${Math.round(v)} €`;

  return (
    <>
      <div className="chart-legend">
        <span className="lg-item"><span className="lg-line lg-line-gold" /> Projetado</span>
        <span className="lg-item"><span className="lg-line lg-line-gold-dashed" /> Futuro (projeção)</span>
        <span className="lg-item"><span className="lg-line lg-line-dark" /> Realizado (Pagos)</span>
        <span className="lg-item lg-item-meta">{series.dates.length} dias</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
        <defs>
          <linearGradient id="cash-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0F766E" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0F766E" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e6e0d4" strokeDasharray={t === 0 ? "0" : "4 4"} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={padL - 8} y={y(t) + 4} fontSize="10" fill="#5a6255" textAnchor="end">{fmtK(t)}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#cash-area)" />
        <path d={projPath(pastDates)} fill="none" stroke="#0F766E" strokeWidth="2.4" strokeLinejoin="round" />
        <path d={projPath(futureDates)} fill="none" stroke="#0F766E" strokeWidth="2.2" strokeDasharray="6 4" strokeLinejoin="round" opacity="0.85" />
        <path d={realPath} fill="none" stroke="#212121" strokeWidth="2" strokeLinejoin="round" />
        <line x1={todayX} x2={todayX} y1={padT} y2={padT + innerH} stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx={todayX} cy={y(series.projetado.get(todayClamped))} r="4" fill="#dc2626" />
        <text x={todayX} y={padT - 6} fontSize="10" fill="#dc2626" textAnchor="middle" fontWeight="700">HOJE</text>
        <text x={padL} y={H - 8} fontSize="10" fill="#5a6255" textAnchor="start">{fmtDate(series.dates[0])}</text>
        <text x={W - padR} y={H - 8} fontSize="10" fill="#5a6255" textAnchor="end">{fmtDate(series.dates[series.dates.length - 1])}</text>
      </svg>
    </>
  );
}

function FluxoProjetadoLegacy({ txs, saldoInicial, onEdit, onPay }) {
  const [horizonte, setHorizonte] = useState(90);
  const [agrupamento, setAgrupamento] = useState("dia");
  const [incluirAtrasados, setIncluirAtrasados] = useState(true);

  const today = todayISO();

  const projecao = useMemo(() => {
    const limite = new Date();
    limite.setDate(limite.getDate() + Number(horizonte));
    const limiteISO = limite.toISOString().slice(0, 10);

    const pendentes = txs
      .filter((t) => isPendente(t) || (incluirAtrasados && t.status === "Atrasado"))
      .filter((t) => t.dtVencimento)
      .filter((t) => incluirAtrasados ? t.dtVencimento <= limiteISO : (t.dtVencimento >= today && t.dtVencimento <= limiteISO))
      .sort((a, b) => (a.dtVencimento || "").localeCompare(b.dtVencimento || ""));

    let saldo = saldoInicial;
    let totalReceber = 0;
    let totalPagar = 0;
    let primeiroNegativo = null;
    const linhas = pendentes.map((t) => {
      const v = Number(t.valorBruto) || 0;
      const delta = t.forma === "Receita" ? v : -v;
      saldo += delta;
      if (saldo < 0 && !primeiroNegativo) primeiroNegativo = t.dtVencimento;
      if (t.forma === "Receita") totalReceber += v;
      else totalPagar += v;
      return { ...t, delta, saldoApos: saldo };
    });

    return {
      linhas,
      totalReceber,
      totalPagar,
      saldoFinal: saldo,
      primeiroNegativo,
    };
  }, [txs, saldoInicial, horizonte, incluirAtrasados, today]);

  const grupos = useMemo(() => {
    const map = new Map();
    for (const l of projecao.linhas) {
      let chave;
      if (agrupamento === "semana") {
        const d = new Date(l.dtVencimento);
        const dow = d.getDay();
        const diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        chave = monday.toISOString().slice(0, 10);
      } else if (agrupamento === "mes") {
        chave = l.dtVencimento.slice(0, 7);
      } else {
        chave = l.dtVencimento;
      }
      if (!map.has(chave)) map.set(chave, { chave, linhas: [], entradas: 0, saidas: 0, saldoFinal: 0 });
      const g = map.get(chave);
      g.linhas.push(l);
      if (l.forma === "Receita") g.entradas += Number(l.valorBruto) || 0;
      else g.saidas += Number(l.valorBruto) || 0;
      g.saldoFinal = l.saldoApos;
    }
    return Array.from(map.values());
  }, [projecao.linhas, agrupamento]);

  function fmtGrupoLabel(chave) {
    if (agrupamento === "mes") {
      const [y, m] = chave.split("-");
      return `${MONTHS_PT[Number(m) - 1]} ${y}`;
    }
    if (agrupamento === "semana") {
      const d = new Date(chave);
      const fim = new Date(d);
      fim.setDate(fim.getDate() + 6);
      return `Semana ${fmtDate(chave)} → ${fmtDate(fim.toISOString().slice(0, 10))}`;
    }
    return fmtDate(chave);
  }

  return (
    <div className="erp-content">
      <div className="filter-bar">
        <div className="filter-bar-title">Projeção</div>
        <div className="filter-field">
          <label>Horizonte</label>
          <select value={horizonte} onChange={(e) => setHorizonte(Number(e.target.value))}>
            <option value={30}>Próximos 30 dias</option>
            <option value={60}>Próximos 60 dias</option>
            <option value={90}>Próximos 90 dias</option>
            <option value={180}>Próximos 180 dias</option>
            <option value={365}>Próximos 12 meses</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Agrupar por</label>
          <select value={agrupamento} onChange={(e) => setAgrupamento(e.target.value)}>
            <option value="dia">Dia</option>
            <option value="semana">Semana</option>
            <option value="mes">Mês</option>
          </select>
        </div>
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={incluirAtrasados}
            onChange={(e) => setIncluirAtrasados(e.target.checked)}
          />
          Incluir atrasados
        </label>
        <div className="filter-meta-info">
          {projecao.linhas.length} lançamentos · saldo inicial {fmtEur(saldoInicial)}
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard
          label="A Receber"
          value={fmtEur(projecao.totalReceber)}
          hint={`${projecao.linhas.filter((l) => l.forma === "Receita").length} lançamentos`}
          tone="gold"
        />
        <KpiCard
          label="A Pagar"
          value={fmtEur(projecao.totalPagar)}
          hint={`${projecao.linhas.filter((l) => l.forma === "Despesa").length} lançamentos`}
          tone="red"
        />
        <KpiCard
          label="Saldo Projetado Final"
          value={fmtEur(projecao.saldoFinal)}
          hint={`em ${horizonte} dias`}
          tone={projecao.saldoFinal >= 0 ? "gold" : "red"}
        />
        <KpiCard
          label="Variação"
          value={(projecao.saldoFinal - saldoInicial >= 0 ? "+" : "") + fmtEur(projecao.saldoFinal - saldoInicial)}
          hint="saldo final − inicial"
          tone={projecao.saldoFinal - saldoInicial >= 0 ? "gold" : "red"}
        />
      </div>

      {projecao.primeiroNegativo && (
        <div className="banner-warn">
          <span className="banner-warn-mark">!</span>
          <div>
            <strong>Saldo negativo previsto</strong> a partir de <strong>{fmtDate(projecao.primeiroNegativo)}</strong>. Verifique antecipações de receita ou renegociação de despesas.
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Saldo Projetado — Evolução</div>
        <div className="card-body">
          {projecao.linhas.length === 0 ? (
            <div className="empty-pad">Sem lançamentos pendentes no horizonte selecionado.</div>
          ) : (
            <ProjectedBalanceChart linhas={projecao.linhas} saldoInicial={saldoInicial} />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          Cronograma {agrupamento === "dia" ? "diário" : agrupamento === "semana" ? "semanal" : "mensal"}
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {grupos.length === 0 ? (
            <div className="empty-pad">Nenhum lançamento pendente no horizonte selecionado.</div>
          ) : (
            <div>
              {grupos.map((g) => {
                const isAtrasado = g.chave < today && agrupamento === "dia";
                return (
                  <div className="proj-group" key={g.chave}>
                    <div className={`proj-group-head ${isAtrasado ? "is-atrasado" : ""} ${g.saldoFinal < 0 ? "is-neg" : ""}`}>
                      <div className="proj-group-date">
                        <span className="proj-group-label">{fmtGrupoLabel(g.chave)}</span>
                        {isAtrasado && <span className="tag tag-despesa">Atrasado</span>}
                        <span className="proj-group-count">{g.linhas.length} lançamentos</span>
                      </div>
                      <div className="proj-group-totals">
                        {g.entradas > 0 && <span className="proj-in">+{fmtEur(g.entradas)}</span>}
                        {g.saidas > 0 && <span className="proj-out">−{fmtEur(g.saidas)}</span>}
                        <span className={`proj-saldo ${g.saldoFinal < 0 ? "is-neg" : ""}`}>
                          Saldo {fmtEur(g.saldoFinal)}
                        </span>
                      </div>
                    </div>
                    <table className="proj-table">
                      <tbody>
                        {g.linhas.map((l) => (
                          <tr key={l.id}>
                            <td className="proj-td-date">{fmtDate(l.dtVencimento)}</td>
                            <td>
                              <span className={`tag tag-${(l.forma || "").toLowerCase()}`}>{l.forma}</span>
                            </td>
                            <td className="strong">
                              {l.forma === "Receita" ? l.cliente : l.fornecedor}
                            </td>
                            <td className="truncate" title={l.descricao}>{l.descricao}</td>
                            <td><StatusPill status={l.status} /></td>
                            <td className={`num strong ${l.delta < 0 ? "is-out" : "is-in"}`}>
                              {l.delta >= 0 ? "+" : ""}{fmtEur(l.delta)}
                            </td>
                            <td className={`num ${l.saldoApos < 0 ? "is-out" : ""}`}>
                              {fmtEur(l.saldoApos)}
                            </td>
                            <td className="row-actions">
                              <button className="btn btn-tiny btn-gold" onClick={() => onPay(l)}>
                                {l.forma === "Receita" ? "Receber" : "Pagar"}
                              </button>
                              <button className="icon-btn" onClick={() => onEdit(l)} title="Editar">✎</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectedBalanceChart({ linhas, saldoInicial }) {
  const W = 800, H = 240;
  const padL = 50, padR = 20, padT = 20, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const points = useMemo(() => {
    const pts = [{ date: todayISO(), saldo: saldoInicial }];
    let saldo = saldoInicial;
    for (const l of linhas) {
      saldo += l.delta;
      pts.push({ date: l.dtVencimento, saldo });
    }
    return pts;
  }, [linhas, saldoInicial]);

  if (points.length < 2) return null;

  const minDate = new Date(points[0].date);
  const maxDate = new Date(points[points.length - 1].date);
  const dateRange = Math.max(1, maxDate - minDate);
  const minSaldo = Math.min(0, ...points.map((p) => p.saldo));
  const maxSaldo = Math.max(saldoInicial, ...points.map((p) => p.saldo));
  const range = Math.max(1, maxSaldo - minSaldo);
  const x = (date) => padL + (innerW * (new Date(date) - minDate)) / dateRange;
  const y = (v) => padT + innerH - ((v - minSaldo) / range) * innerH;
  const yZero = y(0);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date)},${y(p.saldo)}`).join(" ");
  const areaPath = `${path} L${x(points[points.length - 1].date)},${yZero} L${x(points[0].date)},${yZero} Z`;

  const ticks = [maxSaldo, (maxSaldo + minSaldo) / 2, minSaldo];
  const fmtK = (v) => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k €`;
    return `${Math.round(v)} €`;
  };
  const dateTicks = [];
  const tickCount = 6;
  for (let i = 0; i <= tickCount; i++) {
    const t = new Date(minDate.getTime() + (dateRange * i) / tickCount);
    dateTicks.push(t.toISOString().slice(0, 10));
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="proj-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F766E" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#0F766E" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e6e0d4" strokeDasharray={t === 0 ? "0" : "4 4"} strokeWidth={t === 0 ? 1.5 : 1} />
          <text x={padL - 8} y={y(t) + 4} fontSize="10" fill="#5a6255" textAnchor="end">{fmtK(t)}</text>
        </g>
      ))}
      <path d={areaPath} fill="url(#proj-area)" />
      <path d={path} fill="none" stroke="#0F766E" strokeWidth="2.4" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.date)} cy={y(p.saldo)} r="3" fill={p.saldo < 0 ? "#dc2626" : "#0F766E"} />
      ))}
      {dateTicks.map((d, i) => (
        <text key={i} x={x(d)} y={H - 10} fontSize="10" fill="#5a6255" textAnchor="middle">
          {fmtDate(d).slice(0, 5)}
        </text>
      ))}
    </svg>
  );
}

function KpisMetas({ txs, cfg, onSaveMeta }) {
  const yearNow = new Date().getFullYear();
  const today = todayISO();
  const [year, setYear] = useState(yearNow);
  const [metric, setMetric] = useState("faturamento");
  const [base, setBase] = useState("bruto");
  const [metaInput, setMetaInput] = useState(cfg.metaMensal || "");
  useEffect(() => { setMetaInput(cfg.metaMensal || ""); }, [cfg.metaMensal]);

  const yearsAvailable = useMemo(() => {
    const set = new Set([yearNow]);
    txs.forEach((t) => t.data && set.add(Number(t.data.slice(0, 4))));
    return Array.from(set).sort().reverse();
  }, [txs, yearNow]);

  const realized = useMemo(() => txs.filter((t) => isRealizado(t) && t.data && t.data <= today), [txs, today]);

  const monthlyByYear = useMemo(() => {
    const calc = (yr) => {
      const arr = new Array(12).fill(0);
      for (const t of realized) {
        if (Number(t.data.slice(0, 4)) !== yr) continue;
        const m = Number(t.data.slice(5, 7)) - 1;
        const v = base === "bruto" ? Number(t.valorBruto) || 0 : Number(t.valorLiquido) || Number(t.valorBruto) || 0;
        if (metric === "faturamento" && t.forma === "Receita") arr[m] += v;
        else if (metric === "despesas" && t.forma === "Despesa") arr[m] += v;
        else if (metric === "resultado") arr[m] += t.forma === "Receita" ? v : -v;
      }
      return arr;
    };
    return { current: calc(year), previous: calc(year - 1) };
  }, [realized, year, metric, base]);

  const sumCurrent = monthlyByYear.current.reduce((a, b) => a + b, 0);
  const sumPrevious = monthlyByYear.previous.reduce((a, b) => a + b, 0);
  const yoy = sumPrevious === 0 ? null : ((sumCurrent - sumPrevious) / Math.abs(sumPrevious)) * 100;
  const monthsElapsed = year === yearNow ? new Date().getMonth() + 1 : 12;
  const meta = Number(cfg.metaMensal) || 0;
  const metaYtd = meta * monthsElapsed;
  const metaPct = metaYtd > 0 ? (sumCurrent / metaYtd) * 100 : null;

  const sourceBreakdown = useMemo(() => {
    const map = new Map();
    realized
      .filter((t) => Number(t.data.slice(0, 4)) === year && t.forma === "Receita")
      .forEach((t) => {
        const key = t.contabGrupo || t.produto || "Outras receitas";
        const v = base === "bruto" ? Number(t.valorBruto) || 0 : Number(t.valorLiquido) || Number(t.valorBruto) || 0;
        map.set(key, (map.get(key) || 0) + v);
      });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [realized, year, base]);

  const sourceTotal = sourceBreakdown.reduce((a, s) => a + s.value, 0);

  function exportCsv() {
    const headers = ["Mês", `${year - 1}`, `${year}`, "Variação YoY %"];
    const rows = MONTHS_PT.map((m, i) => {
      const prev = monthlyByYear.previous[i];
      const curr = monthlyByYear.current[i];
      const v = prev === 0 ? "" : `${(((curr - prev) / Math.abs(prev)) * 100).toFixed(1)}`;
      return [m, prev.toFixed(2), curr.toFixed(2), v];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kpis-${metric}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="erp-content">
      <div className="erp-toolbar">
        <button className="btn btn-light" onClick={exportCsv}>Exportar CSV</button>
      </div>

      <div className="filter-bar">
        <div className="filter-bar-title">FILTROS</div>
        <div className="filter-field">
          <label>Ano de Referência</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Métrica</label>
          <div className="seg-control">
            {[
              { id: "faturamento", label: "Faturamento" },
              { id: "despesas", label: "Despesas" },
              { id: "resultado", label: "Resultado" },
            ].map((o) => (
              <button key={o.id} className={`seg-btn ${metric === o.id ? "is-active" : ""}`} onClick={() => setMetric(o.id)}>{o.label}</button>
            ))}
          </div>
        </div>
        <div className="filter-field">
          <label>Base</label>
          <div className="seg-control">
            <button className={`seg-btn ${base === "bruto" ? "is-active" : ""}`} onClick={() => setBase("bruto")}>Bruto</button>
            <button className={`seg-btn ${base === "liquido" ? "is-active" : ""}`} onClick={() => setBase("liquido")}>Líquido</button>
          </div>
        </div>
        <div className="filter-field">
          <label>Meta Mensal Faturamento (EUR)</label>
          <div className="filter-meta">
            <input type="number" step="100" value={metaInput} onChange={(e) => setMetaInput(e.target.value)} />
            <button className="btn btn-light" onClick={() => onSaveMeta(metaInput)}>Guardar</button>
          </div>
        </div>
        <div className="filter-meta-info">
          Comparativo {year - 1} vs {year} (até hoje) · {realized.length} transações analisadas
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label={`Faturamento Bruto (Realizado) ${year}`} value={fmtEur(sumCurrent)} hint={`YTD · ${monthsElapsed} meses`} tone="gold" />
        <div className="kpi tone-beige">
          <div className="kpi-l">Faturamento {year - 1}</div>
          <div className="kpi-v">{fmtEur(sumPrevious)}</div>
          <div className="kpi-h">período comparável</div>
        </div>
        <div className={`kpi ${yoy != null && yoy < 0 ? "tone-red" : "tone-gold"}`}>
          <div className="kpi-l">Crescimento YoY</div>
          <div className="kpi-v">{yoy == null ? "—" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`}</div>
          <div className="kpi-h">{year} vs {year - 1}</div>
        </div>
        <KpiCard
          label="Meta YTD"
          value={metaPct == null ? "—" : `${metaPct.toFixed(1)}%`}
          hint={meta > 0 ? `${fmtEur(sumCurrent)} / ${fmtEur(metaYtd)}` : "defina meta para ativar"}
          tone="gold"
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">{labelMetric(metric)} — Mensal {year - 1} × {year}</div>
        <div className="card-body">
          <YoyBarChart current={monthlyByYear.current} previous={monthlyByYear.previous} year={year} />
        </div>
      </div>

      <div className="charts-grid charts-grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="card-header">Realizado vs Meta — YTD {year}</div>
          <div className="card-body">
            {meta > 0 ? (
              <div className="meta-progress">
                <div className="meta-progress-bar">
                  <div className="meta-progress-fill" style={{ width: `${Math.min(100, metaPct || 0)}%` }} />
                </div>
                <div className="meta-progress-stats">
                  <div><div className="lg-l">Realizado</div><div className="lg-v lg-gold">{fmtEur(sumCurrent)}</div></div>
                  <div><div className="lg-l">Meta YTD</div><div className="lg-v lg-dark">{fmtEur(metaYtd)}</div></div>
                  <div><div className="lg-l">% atingido</div><div className={`lg-v ${(metaPct || 0) >= 100 ? "lg-gold" : "lg-red"}`}>{(metaPct || 0).toFixed(1)}%</div></div>
                </div>
              </div>
            ) : (
              <div className="empty-pad">Defina uma meta mensal de faturamento no filtro acima para visualizar este painel.</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">Origem da Receita — {year} YTD</div>
          <div className="card-body">
            {sourceBreakdown.length === 0 ? (
              <div className="empty-pad">Sem receitas no período selecionado.</div>
            ) : (
              <SourceDonut data={sourceBreakdown} total={sourceTotal} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function labelMetric(m) {
  return m === "faturamento" ? "Faturamento Bruto (Realizado)" : m === "despesas" ? "Despesas" : "Resultado";
}

function YoyBarChart({ current, previous, year }) {
  const max = Math.max(...current, ...previous, 1);
  const todayMonth = new Date().getMonth();
  return (
    <div>
      <div className="yoy-stage">
        {MONTHS_SHORT.map((m, i) => {
          const c = current[i];
          const p = previous[i];
          const yoy = p === 0 ? null : ((c - p) / Math.abs(p)) * 100;
          const hC = (c / max) * 160;
          const hP = (p / max) * 160;
          const isCurrentMonth = i === todayMonth;
          return (
            <div className="yoy-month" key={i}>
              <div className={`yoy-pct ${yoy != null && yoy < 0 ? "is-red" : "is-gold"}`}>
                {yoy == null ? "—" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(0)}%`}
              </div>
              <div className="yoy-bars">
                <div className="yoy-bar yoy-bar-prev" style={{ height: `${Math.max(2, hP)}px` }} title={`${year - 1}: ${fmtEur(p)}`} />
                <div className="yoy-bar yoy-bar-curr" style={{ height: `${Math.max(2, hC)}px` }} title={`${year}: ${fmtEur(c)}`} />
              </div>
              <div className={`yoy-month-label ${isCurrentMonth ? "is-current" : ""}`}>{m}</div>
            </div>
          );
        })}
      </div>
      <div className="yoy-legend">
        <span className="lg-item"><span className="lg-swatch lg-swatch-prev" /> {year - 1}</span>
        <span className="lg-item"><span className="lg-swatch lg-swatch-curr" /> {year}</span>
      </div>
    </div>
  );
}

const SOURCE_PALETTE = ["#0F766E", "#854d0e", "#5a6255", "#a07005", "#0D9488", "#7a5510", "#b45309", "#92400e"];

function SourceDonut({ data, total }) {
  const size = 240;
  const r = 90;
  const cx = size / 2;
  const cy = size / 2;
  let offset = 0;
  const segments = data.map((d, i) => {
    const pct = d.value / (total || 1);
    const start = offset;
    offset += pct;
    return { ...d, pct, start, end: offset, color: SOURCE_PALETTE[i % SOURCE_PALETTE.length] };
  });
  return (
    <div className="donut-flex">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((s, i) => {
          const startA = s.start * 2 * Math.PI - Math.PI / 2;
          const endA = s.end * 2 * Math.PI - Math.PI / 2;
          const x1 = cx + r * Math.cos(startA);
          const y1 = cy + r * Math.sin(startA);
          const x2 = cx + r * Math.cos(endA);
          const y2 = cy + r * Math.sin(endA);
          const large = s.pct > 0.5 ? 1 : 0;
          return (
            <path
              key={i}
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={s.color}
            />
          );
        })}
        <circle cx={cx} cy={cy} r="50" fill="white" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="10" fill="#5a6255" fontWeight="600">Total Receita</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="13" fill="#212121" fontWeight="800">{fmtEur(total)}</text>
      </svg>
      <div className="donut-list">
        {segments.map((s, i) => (
          <div className="donut-item" key={i}>
            <span className="donut-color" style={{ background: s.color }} />
            <span className="donut-name">{s.name}</span>
            <span className="donut-value">{fmtEur(s.value)}</span>
            <span className="donut-pct">{(s.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Carteira({ txs, clientes, apartamentos, setApartamentos, onAutoImport }) {
  const [tab, setTab] = useState("imoveis");
  const [period, setPeriod] = useState("todos");
  const [search, setSearch] = useState("");
  const [selectedClienteId, setSelectedClienteId] = useState(null);
  const [selectedApartId, setSelectedApartId] = useState(null);
  const [editingApart, setEditingApart] = useState(null);
  const [draftApart, setDraftApart] = useState(emptyApartamento());
  const [savingApart, setSavingApart] = useState(false);

  const realTxs = useMemo(
    () => txs.filter((t) => t.origem !== "saldo-ancora" && t.status !== "Cancelado"),
    [txs]
  );
  const inPeriod = useMemo(
    () => period === "todos" ? realTxs : realTxs.filter((t) => t.data && t.data.startsWith(period)),
    [realTxs, period]
  );

  const apartamentoIndex = useMemo(() => buildApartamentoIndex(apartamentos), [apartamentos]);

  const txsByApart = useMemo(() => {
    const map = new Map();
    for (const ap of apartamentos) map.set(ap.id, []);
    map.set("__sem", []);
    for (const t of inPeriod) {
      const ap = linkTxToApartamento(t, apartamentoIndex);
      const key = ap?.id || "__sem";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    return map;
  }, [inPeriod, apartamentos, apartamentoIndex]);

  const txsByCliente = useMemo(() => {
    const map = new Map();
    for (const c of clientes) map.set(c.id, []);
    map.set("__sem", []);
    for (const t of inPeriod) {
      const c = linkTxToCliente(t, clientes);
      const key = c?.id || "__sem";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    return map;
  }, [inPeriod, clientes]);

  const apartStats = useMemo(() => {
    return apartamentos.map((ap) => {
      const ts = txsByApart.get(ap.id) || [];
      let receita = 0, receitaSemIva = 0, custos = 0, taxaColetada = 0, taxaRepassada = 0;
      const porAno = new Map();
      const taxaByMonth = new Map();
      for (const t of ts) {
        const v = Math.abs(Number(t.valorBruto) || 0);
        const vLiq = Math.abs(Number(t.valorLiquido) || 0) || v;
        const c = t.classifContabGrupo || deriveClassifContab(t.contabGrupo) || "";
        const isReceita = c.startsWith("01.") || c.startsWith("06.") || c.startsWith("09.") || t.forma === "Receita";
        const isGestaoReceita = /gest[aã]o\s+de\s+im[oó]veis/i.test(t.contabSubGrupo || "");
        const ano = (t.data || "").slice(0, 4);
        const mes = (t.data || "").slice(0, 7);
        if (isReceita) {
          if (isGestaoReceita) {
            receita += v;
            receitaSemIva += vLiq;
            if (ano) porAno.set(ano, (porAno.get(ano) || 0) + vLiq);
          }
          if (isTaxaTuristica(t)) {
            taxaColetada += v;
            if (mes) {
              const entry = taxaByMonth.get(mes) || { coletada: 0, repassada: 0, txsCol: [], txsRep: [] };
              entry.coletada += v;
              entry.txsCol.push(t);
              taxaByMonth.set(mes, entry);
            }
          }
        } else {
          custos += v;
          if (isTaxaTuristica(t)) {
            taxaRepassada += v;
            if (mes) {
              const entry = taxaByMonth.get(mes) || { coletada: 0, repassada: 0, txsCol: [], txsRep: [] };
              entry.repassada += v;
              entry.txsRep.push(t);
              taxaByMonth.set(mes, entry);
            }
          }
        }
      }
      const taxaMismatches = [];
      for (const [mes, e] of taxaByMonth) {
        const diff = e.coletada - e.repassada;
        if (Math.abs(diff) > 0.01) {
          taxaMismatches.push({ mes, coletada: e.coletada, repassada: e.repassada, diff, txsCol: e.txsCol, txsRep: e.txsRep });
        }
      }
      taxaMismatches.sort((a, b) => a.mes.localeCompare(b.mes));
      return {
        ...ap,
        receita,
        receitaSemIva,
        custos,
        liquido: receita - custos,
        liquidoSemIva: receitaSemIva - custos,
        porAno,
        taxaColetada,
        taxaRepassada,
        taxaSaldo: taxaColetada - taxaRepassada,
        taxaMismatches,
        count: ts.length,
      };
    }).sort((a, b) => b.receitaSemIva - a.receitaSemIva);
  }, [apartamentos, txsByApart]);

  const anosDisponiveis = useMemo(() => {
    const set = new Set();
    for (const a of apartStats) for (const y of a.porAno.keys()) set.add(y);
    return [...set].sort();
  }, [apartStats]);

  const totalReceitaSemIvaPorAno = useMemo(() => {
    const acc = {};
    for (const y of anosDisponiveis) acc[y] = 0;
    for (const a of apartStats) {
      for (const [y, v] of a.porAno) acc[y] = (acc[y] || 0) + v;
    }
    return acc;
  }, [apartStats, anosDisponiveis]);

  const totaisPorTipo = useMemo(() => {
    const acc = {
      AL: { receita: 0, receitaSemIva: 0, custos: 0, count: 0 },
      LD: { receita: 0, receitaSemIva: 0, custos: 0, count: 0 },
      MD: { receita: 0, receitaSemIva: 0, custos: 0, count: 0 },
    };
    for (const a of apartStats) {
      const t = (a.tipo || "AL").toUpperCase();
      if (acc[t]) {
        acc[t].receita += a.receita;
        acc[t].receitaSemIva += a.receitaSemIva;
        acc[t].custos += a.custos;
        acc[t].count += 1;
      }
    }
    return acc;
  }, [apartStats]);

  const maisRentavel = apartStats.length ? apartStats[0] : null;

  const taxaTotal = apartStats.reduce((acc, a) => ({
    coletada: acc.coletada + a.taxaColetada,
    repassada: acc.repassada + a.taxaRepassada,
  }), { coletada: 0, repassada: 0 });
  const taxaPendente = taxaTotal.coletada - taxaTotal.repassada;

  const yearsAvailable = useMemo(() => {
    const set = new Set();
    txs.forEach((t) => t.data && set.add(t.data.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [txs]);

  const filteredClientes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      [c.nome, c.email, c.nif].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [clientes, search]);

  const filteredAparts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apartStats;
    return apartStats.filter((a) =>
      [a.nome, a.alias, a.proprietarioNome, a.tipo].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [apartStats, search]);

  function openNewApart() {
    setDraftApart(emptyApartamento());
    setEditingApart("new");
  }
  function openEditApart(ap) {
    setDraftApart({ ...emptyApartamento(), ...ap });
    setEditingApart(ap.id);
  }
  async function saveApart() {
    if (!draftApart.nome?.trim()) return;
    setSavingApart(true);
    try {
      const payload = { ...draftApart, nome: draftApart.nome.trim() };
      if (editingApart === "new") {
        const created = await window.__ekoa.create(COL_APARTAMENTOS, payload);
        setApartamentos((prev) => [created, ...prev]);
      } else {
        const updated = await window.__ekoa.update(COL_APARTAMENTOS, editingApart, payload);
        setApartamentos((prev) => prev.map((a) => (a.id === editingApart ? { ...a, ...updated } : a)));
      }
      setEditingApart(null);
    } finally {
      setSavingApart(false);
    }
  }
  async function removeApart(id) {
    if (!confirm("Remover este imóvel da carteira?")) return;
    await window.__ekoa.delete(COL_APARTAMENTOS, id);
    setApartamentos((prev) => prev.filter((a) => a.id !== id));
    if (selectedApartId === id) setSelectedApartId(null);
  }

  const selectedAp = selectedApartId ? apartStats.find((a) => a.id === selectedApartId) : null;
  const selectedCliente = selectedClienteId ? clientes.find((c) => c.id === selectedClienteId) : null;
  const txsForSelectedAp = selectedAp ? (txsByApart.get(selectedAp.id) || []) : [];
  const txsForSelectedCliente = selectedCliente ? (txsByCliente.get(selectedCliente.id) || []) : [];

  return (
    <div className="erp-content">
      <div className="filter-bar">
        <div className="filter-bar-title">Gestão de Carteira · CRM de Imóveis</div>
        <div className="seg-control">
          {[
            { id: "imoveis", label: "Imóveis" },
            { id: "anual", label: "Ganho por Ano" },
            { id: "clientes", label: "Clientes" },
            { id: "taxa", label: "Taxa Turística" },
          ].map((o) => (
            <button key={o.id} className={`seg-btn ${tab === o.id ? "is-active" : ""}`} onClick={() => setTab(o.id)}>{o.label}</button>
          ))}
        </div>
        <div className="filter-field">
          <label>Período</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="todos">Todos os anos</option>
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="filter-field" style={{ flex: 1 }}>
          <label>Pesquisar</label>
          <input
            type="text"
            placeholder={tab === "clientes" ? "Cliente, NIF, e-mail..." : "Imóvel, alias, proprietário..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tab === "imoveis" && (
          <>
            {onAutoImport && (
              <button
                className="btn btn-light"
                onClick={onAutoImport}
                title="Sincronizar Carteira com base no histórico de transações (cria novos imóveis e corrige tipos AL/MD/LD)"
              >
                Importar das transações
              </button>
            )}
            <button className="btn btn-gold" onClick={openNewApart}>+ Novo Imóvel</button>
          </>
        )}
      </div>

      <div className="kpi-row">
        <KpiCard
          label="Gestão AL · Ganho s/ IVA"
          value={fmtEur(totaisPorTipo.AL.receitaSemIva)}
          hint={`${totaisPorTipo.AL.count} imóveis · bruto ${fmtEur(totaisPorTipo.AL.receita)}`}
          tone="gold"
        />
        <KpiCard
          label="Gestão LD · Ganho s/ IVA"
          value={fmtEur(totaisPorTipo.LD.receitaSemIva)}
          hint={`${totaisPorTipo.LD.count} imóveis · bruto ${fmtEur(totaisPorTipo.LD.receita)}`}
          tone="gold"
        />
        <KpiCard
          label="Gestão MD · Ganho s/ IVA"
          value={fmtEur(totaisPorTipo.MD.receitaSemIva)}
          hint={`${totaisPorTipo.MD.count} imóveis · bruto ${fmtEur(totaisPorTipo.MD.receita)}`}
          tone="gold"
        />
        <div className="kpi tone-neutral">
          <div className="kpi-l">Imóvel com maior ganho</div>
          <div className="kpi-v" style={{ fontSize: 16 }}>{maisRentavel?.nome || "—"}</div>
          <div className="kpi-h">{maisRentavel ? `s/ IVA ${fmtEur(maisRentavel.receitaSemIva)}` : "Cadastre imóveis"}</div>
        </div>
      </div>

      {tab === "taxa" && taxaPendente !== 0 && (
        <div className="taxa-turistica-banner">
          <strong>Taxa Turística:</strong>
          {fmtEur(taxaTotal.coletada)} coletada · {fmtEur(taxaTotal.repassada)} repassada à Câmara Municipal ·
          <strong style={{ color: taxaPendente > 0 ? "var(--red)" : "var(--gold-strong)" }}>
            {taxaPendente > 0 ? `${fmtEur(taxaPendente)} pendente de repasse` : `${fmtEur(Math.abs(taxaPendente))} antecipado`}
          </strong>
        </div>
      )}

      {tab === "imoveis" && (
        <div className="crm-grid">
          <div className="crm-list">
            {filteredAparts.length === 0 ? (
              <div className="crm-detail-empty">
                <strong>Nenhum imóvel cadastrado.</strong>
                <br />Use <strong>+ Novo Imóvel</strong> para iniciar.
              </div>
            ) : filteredAparts.map((ap) => (
              <button
                key={ap.id}
                className={`crm-item ${selectedApartId === ap.id ? "is-active" : ""}`}
                onClick={() => setSelectedApartId(ap.id)}
              >
                <div className="crm-item-name">
                  <span className={`pill-tipo pill-tipo-${(ap.tipo || "AL").toLowerCase()}`}>{ap.tipo}</span>
                  &nbsp;{ap.nome}
                </div>
                <div className="crm-item-meta">
                  <span>{ap.proprietarioNome || "—"}</span>
                  <span
                    style={{ fontWeight: 600, color: "var(--gold-strong)" }}
                    title="Ganho de gestão sem IVA (VL_LÍQUIDO acumulado no período)"
                  >
                    {fmtEur(ap.receitaSemIva)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {selectedAp ? (
            <ApartamentoFicha
              ap={selectedAp}
              txs={txsForSelectedAp}
              onEdit={() => openEditApart(selectedAp)}
              onDelete={() => removeApart(selectedAp.id)}
            />
          ) : (
            <div className="crm-detail-empty">
              Selecione um imóvel à esquerda para ver a ficha completa, lançamentos e métricas.
            </div>
          )}
        </div>
      )}

      {tab === "anual" && (
        <div className="card">
          <div className="card-header">Ganho de Gestão por Imóvel · sem IVA (VL_LÍQUIDO) · matriz por ano</div>
          <div className="card-body" style={{ padding: 0, overflowX: "auto" }}>
            {filteredAparts.length === 0 ? (
              <div className="empty-pad">Nenhum imóvel cadastrado.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Imóvel</th>
                    <th>Tipo</th>
                    <th>Proprietário</th>
                    {anosDisponiveis.map((y) => <th key={y} className="num">{y}</th>)}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAparts.map((a) => (
                    <tr key={a.id}>
                      <td className="strong">{a.nome}</td>
                      <td><span className={`pill-tipo pill-tipo-${(a.tipo || "AL").toLowerCase()}`}>{a.tipo}</span></td>
                      <td className="muted">{a.proprietarioNome || "—"}</td>
                      {anosDisponiveis.map((y) => (
                        <td key={y} className="num">{a.porAno.get(y) ? fmtEur(a.porAno.get(y)) : "—"}</td>
                      ))}
                      <td className="num strong">{fmtEur(a.receitaSemIva)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--beige-warm)", background: "var(--beige)" }}>
                    <td className="strong">Total por ano</td>
                    <td></td>
                    <td></td>
                    {anosDisponiveis.map((y) => (
                      <td key={y} className="num strong">{fmtEur(totalReceitaSemIvaPorAno[y] || 0)}</td>
                    ))}
                    <td className="num strong">
                      {fmtEur(filteredAparts.reduce((acc, a) => acc + a.receitaSemIva, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "clientes" && (
        <div className="crm-grid">
          <div className="crm-list">
            {filteredClientes.length === 0 ? (
              <div className="crm-detail-empty">Nenhum cliente cadastrado.</div>
            ) : filteredClientes.map((c) => {
              const ts = txsByCliente.get(c.id) || [];
              const total = ts.reduce((acc, t) => acc + (Number(t.valorBruto) || 0) * (linkSign(t)), 0);
              return (
                <button
                  key={c.id}
                  className={`crm-item ${selectedClienteId === c.id ? "is-active" : ""}`}
                  onClick={() => setSelectedClienteId(c.id)}
                >
                  <div className="crm-item-name">{c.nome}</div>
                  <div className="crm-item-meta">
                    <span className={`crm-item-pl ${(c.pl || "").toLowerCase().includes("legad") ? "is-legado" : ""}`}>
                      {c.pl || "Principal"}
                    </span>
                    <span style={{ fontWeight: 600, color: total >= 0 ? "var(--gold-strong)" : "var(--red)" }}>
                      {fmtEur(total)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedCliente ? (
            <ClienteFicha
              cliente={selectedCliente}
              txs={txsForSelectedCliente}
              apartamentos={apartamentos}
              apartamentoIndex={apartamentoIndex}
            />
          ) : (
            <div className="crm-detail-empty">
              Selecione um cliente à esquerda (ex.: Elizabeth, Antonino, Josep Maria…) para ver todo o histórico de receitas e despesas amarradas a ele e o P&L correspondente.
            </div>
          )}
        </div>
      )}

      {tab === "taxa" && (
        <div className="card">
          <div className="card-header">Taxa Turística por Imóvel · Câmara Municipal</div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Tipo</th>
                  <th>Proprietário</th>
                  <th className="num">Coletada</th>
                  <th className="num">Repassada</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {apartStats.filter((a) => a.taxaColetada > 0 || a.taxaRepassada > 0).map((a) => (
                  <tr key={a.id}>
                    <td className="strong">{a.nome}</td>
                    <td><span className={`pill-tipo pill-tipo-${(a.tipo || "AL").toLowerCase()}`}>{a.tipo}</span></td>
                    <td className="muted">{a.proprietarioNome || "—"}</td>
                    <td className="num" style={{ color: "var(--gold-strong)" }}>{fmtEur(a.taxaColetada)}</td>
                    <td className="num" style={{ color: "var(--text)" }}>{fmtEur(a.taxaRepassada)}</td>
                    <td className={`num strong ${a.taxaSaldo > 0 ? "is-out" : "is-gold"}`}>
                      {a.taxaSaldo > 0 ? `${fmtEur(a.taxaSaldo)} a repassar` : a.taxaSaldo < 0 ? `${fmtEur(Math.abs(a.taxaSaldo))} antecipado` : "✓ em dia"}
                    </td>
                  </tr>
                ))}
                {apartStats.filter((a) => a.taxaColetada > 0 || a.taxaRepassada > 0).length === 0 && (
                  <tr><td colSpan={6}><div className="empty-pad">Nenhuma taxa turística detectada nos lançamentos do período.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "taxa" && (() => {
        const apsAlComMismatch = apartStats.filter(
          (a) => (a.tipo || "").toUpperCase() === "AL" && a.taxaMismatches.length > 0
        );
        if (!apsAlComMismatch.length) return null;
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-header" style={{ color: "var(--red)" }}>
              Desencontros de Caixa · Taxa Turística (AL)
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Imóvel</th>
                    <th>Mês</th>
                    <th className="num">Recebido (cliente)</th>
                    <th className="num">Pago (Câmara)</th>
                    <th className="num">Diferença</th>
                    <th>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {apsAlComMismatch.flatMap((a) =>
                    a.taxaMismatches.map((m, i) => {
                      const diffPositivo = m.diff > 0;
                      const detalhe = diffPositivo
                        ? `Cliente depositou mas a Câmara ainda não foi paga (ou pagamento de mês posterior)`
                        : (m.coletada === 0
                            ? `Pagamento à Câmara sem depósito correspondente do cliente`
                            : `Pagamento maior que o recebido — confira valor`);
                      return (
                        <tr key={`${a.id}-${m.mes}-${i}`}>
                          <td className="strong">{a.nome}</td>
                          <td>{m.mes}</td>
                          <td className="num" style={{ color: "var(--gold-strong)" }}>{fmtEur(m.coletada)}</td>
                          <td className="num">{fmtEur(m.repassada)}</td>
                          <td className={`num strong ${diffPositivo ? "is-out" : "is-gold"}`}>
                            {diffPositivo ? `+${fmtEur(m.diff)}` : `−${fmtEur(Math.abs(m.diff))}`}
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>{detalhe}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {editingApart && (
        <ApartamentoModal
          isNew={editingApart === "new"}
          draft={draftApart}
          setDraft={setDraftApart}
          clientes={clientes}
          onClose={() => setEditingApart(null)}
          onSave={saveApart}
          saving={savingApart}
        />
      )}
    </div>
  );
}

function linkSign(tx) {
  const c = tx.classifContabGrupo || deriveClassifContab(tx.contabGrupo) || "";
  const isReceita = c.startsWith("01.") || c.startsWith("06.") || c.startsWith("09.") || tx.forma === "Receita";
  return isReceita ? 1 : -1;
}

function ApartamentoFicha({ ap, txs, onEdit, onDelete }) {
  const sorted = [...txs].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const taxaCol = ap.taxaColetada || 0;
  const taxaRep = ap.taxaRepassada || 0;
  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            <span className={`pill-tipo pill-tipo-${(ap.tipo || "AL").toLowerCase()}`}>{ap.tipo}</span>
            &nbsp;<strong>{ap.nome}</strong>
            {ap.alias && <span className="muted"> · {ap.alias}</span>}
          </span>
          <div className="row-actions">
            <button className="btn btn-light btn-tiny" onClick={onEdit}>Editar</button>
            <button className="btn btn-link btn-link-danger" onClick={onDelete}>Remover</button>
          </div>
        </div>
        <div className="card-body" style={{ paddingBottom: 8 }}>
          <div className="crm-summary">
            <div className="crm-sum-card">
              <div className="crm-sum-l">Receita Total</div>
              <div className="crm-sum-v" style={{ color: "var(--gold-strong)" }}>{fmtEur(ap.receita)}</div>
              <div className="crm-sum-h">{ap.count} lançamento{ap.count === 1 ? "" : "s"}</div>
            </div>
            <div className="crm-sum-card">
              <div className="crm-sum-l">Custos</div>
              <div className="crm-sum-v" style={{ color: "var(--red)" }}>{fmtEur(ap.custos)}</div>
            </div>
            <div className="crm-sum-card">
              <div className="crm-sum-l">Líquido</div>
              <div className="crm-sum-v" style={{ color: ap.liquido >= 0 ? "var(--gold-strong)" : "var(--red)" }}>
                {fmtEur(ap.liquido)}
              </div>
              <div className="crm-sum-h">margem {ap.receita > 0 ? `${((ap.liquido / ap.receita) * 100).toFixed(1)}%` : "—"}</div>
            </div>
            <div className="crm-sum-card">
              <div className="crm-sum-l">Taxa Turística</div>
              <div className="crm-sum-v">{fmtEur(taxaCol)}</div>
              <div className="crm-sum-h">
                repassada {fmtEur(taxaRep)} ·
                {ap.taxaSaldo > 0 ? <span style={{ color: "var(--red)" }}> {fmtEur(ap.taxaSaldo)} pendente</span> : <span style={{ color: "var(--gold-strong)" }}> ✓ em dia</span>}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            <strong>Proprietário:</strong> {ap.proprietarioNome || "—"} · <strong>P&L:</strong> {ap.pl} · <strong>Morada:</strong> {ap.morada || "—"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Histórico de Lançamentos · {sorted.length}</div>
        <div className="card-body" style={{ padding: 0 }}>
          {sorted.length === 0 ? (
            <div className="empty-pad">Nenhum lançamento associado a este imóvel ainda.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Forma</th>
                  <th>Descrição</th>
                  <th>Sub-Grupo</th>
                  <th>Status</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.data)}</td>
                    <td><span className={`tag tag-${(t.forma || "").toLowerCase()}`}>{t.forma}</span></td>
                    <td className="truncate" title={t.descricao}>
                      {t.descricao || t.fornecedor || t.cliente || "—"}
                    </td>
                    <td>{t.contabSubGrupo || "—"}</td>
                    <td><StatusPill status={t.status} /></td>
                    <td className={`num strong ${t.forma === "Receita" ? "is-gold" : "is-out"}`}>
                      {t.forma === "Receita" ? "+" : "−"}{fmtEur(t.valorBruto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ClienteFicha({ cliente, txs, apartamentos, apartamentoIndex }) {
  const sorted = [...txs].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  let receita = 0, despesa = 0;
  const apartsLinked = new Map();
  for (const t of sorted) {
    const v = Math.abs(Number(t.valorBruto) || 0);
    if (linkSign(t) > 0) receita += v; else despesa += v;
    const ap = linkTxToApartamento(t, apartamentoIndex);
    if (ap) apartsLinked.set(ap.id, ap);
  }
  const liquido = receita - despesa;

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            <strong>{cliente.nome}</strong>
            {cliente.nif && <span className="muted"> · NIF {cliente.nif}</span>}
          </span>
          <span className={`crm-item-pl ${(cliente.pl || "").toLowerCase().includes("legad") ? "is-legado" : ""}`}>
            {cliente.pl || "Principal"}
          </span>
        </div>
        <div className="card-body" style={{ paddingBottom: 8 }}>
          <div className="crm-summary">
            <div className="crm-sum-card">
              <div className="crm-sum-l">Receitas</div>
              <div className="crm-sum-v" style={{ color: "var(--gold-strong)" }}>{fmtEur(receita)}</div>
            </div>
            <div className="crm-sum-card">
              <div className="crm-sum-l">Despesas</div>
              <div className="crm-sum-v" style={{ color: "var(--red)" }}>{fmtEur(despesa)}</div>
            </div>
            <div className="crm-sum-card">
              <div className="crm-sum-l">Líquido</div>
              <div className="crm-sum-v" style={{ color: liquido >= 0 ? "var(--gold-strong)" : "var(--red)" }}>{fmtEur(liquido)}</div>
            </div>
            <div className="crm-sum-card">
              <div className="crm-sum-l">Imóveis Vinculados</div>
              <div className="crm-sum-v">{apartsLinked.size}</div>
              <div className="crm-sum-h">
                {Array.from(apartsLinked.values()).slice(0, 3).map((a) => a.nome).join(" · ") || "—"}
              </div>
            </div>
          </div>
          {cliente.email && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>📧 {cliente.email}</div>}
          {cliente.telefone && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>☎ {cliente.telefone}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-header">Histórico de Lançamentos · {sorted.length}</div>
        <div className="card-body" style={{ padding: 0 }}>
          {sorted.length === 0 ? (
            <div className="empty-pad">Nenhum lançamento associado a este cliente ainda.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Forma</th>
                  <th>Descrição</th>
                  <th>Sub-Grupo</th>
                  <th>Status</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.data)}</td>
                    <td><span className={`tag tag-${(t.forma || "").toLowerCase()}`}>{t.forma}</span></td>
                    <td className="truncate" title={t.descricao}>{t.descricao || "—"}</td>
                    <td>{t.contabSubGrupo || "—"}</td>
                    <td><StatusPill status={t.status} /></td>
                    <td className={`num strong ${linkSign(t) > 0 ? "is-gold" : "is-out"}`}>
                      {linkSign(t) > 0 ? "+" : "−"}{fmtEur(t.valorBruto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ApartamentoModal({ isNew, draft, setDraft, clientes, onClose, onSave, saving }) {
  function up(k, v) { setDraft({ ...draft, [k]: v }); }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? "Novo Imóvel" : "Editar Imóvel"}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f f-wide">
              <label>Nome / Identificação <span className="req">*</span></label>
              <input
                type="text"
                value={draft.nome}
                placeholder="Ex: Antonino (Italian), Pombalino, Elizabeth..."
                onChange={(e) => up("nome", e.target.value)}
                autoFocus
              />
            </div>
            <div className="f">
              <label>Alias / Apelido</label>
              <input type="text" value={draft.alias || ""} onChange={(e) => up("alias", e.target.value)} />
            </div>
            <div className="f">
              <label>Tipo de Gestão</label>
              <select value={draft.tipo} onChange={(e) => up("tipo", e.target.value)}>
                {TIPO_GESTAO_OPTIONS.map((t) => <option key={t} value={t}>Gestão {t}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Proprietário (nome)</label>
              <input
                type="text"
                value={draft.proprietarioNome || ""}
                placeholder="Ex: Josep Maria"
                onChange={(e) => up("proprietarioNome", e.target.value)}
              />
            </div>
            <div className="f">
              <label>Cliente vinculado</label>
              <select value={draft.clienteId || ""} onChange={(e) => up("clienteId", e.target.value)}>
                <option value="">— Sem vínculo —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="f">
              <label>P&L</label>
              <select value={draft.pl || "Principal"} onChange={(e) => up("pl", e.target.value)}>
                {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f f-wide">
              <label>Morada</label>
              <input type="text" value={draft.morada || ""} onChange={(e) => up("morada", e.target.value)} />
            </div>
            <div className="f">
              <label>Código Postal</label>
              <input type="text" value={draft.codigoPostal || ""} onChange={(e) => up("codigoPostal", e.target.value)} />
            </div>
            <div className="f">
              <label>Referência interna</label>
              <input
                type="text"
                value={draft.referencia || ""}
                placeholder="Ex: AL-001, LD-EL-12"
                onChange={(e) => up("referencia", e.target.value)}
              />
            </div>
            <div className="f">
              <label>Estado</label>
              <select
                value={draft.ativo === false ? "inativo" : "ativo"}
                onChange={(e) => up("ativo", e.target.value === "ativo")}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
          <div className="depara-info" style={{ marginTop: 16 }}>
            <strong>Modelo relacional:</strong> os lançamentos do Fluxo de Caixa são vinculados a este imóvel quando
            o nome, alias, referência ou proprietário aparecem na <code>descrição</code>, <code>cliente</code>,
            <code>fornecedor</code> ou <code>produto</code> da transação. Quanto mais sinônimos no Alias/Referência,
            mais transações casam.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave} disabled={saving || !draft.nome?.trim()}>
            {saving ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function detectarTipoImovel(t) {
  const text = `${t.produto || ""} ${t.contabGrupo || ""} ${t.descricao || ""}`.toLowerCase();
  if (/\bal\b|alojamento local|airbnb|booking/i.test(text)) return "AL";
  if (/\bld\b|longa duração|long stay/i.test(text)) return "LD";
  if (/\bmd\b|média duração|mid stay/i.test(text)) return "MD";
  return "AL";
}

function Definicoes({ bancos, onNewBanco, onEditBanco, onDeleteBanco, onConnectCgd }) {
  const [tab, setTab] = useState("depara");
  return (
    <div className="erp-content">
      <div className="def-tabs">
        {DEFINICOES_TABS.map((t) => (
          <button
            key={t.id}
            className={`def-tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "depara" && <DePara />}
      {tab === "bancarias" && (
        <ContasBancarias
          bancos={bancos}
          onNew={onNewBanco}
          onEdit={onEditBanco}
          onDelete={onDeleteBanco}
          onConnectCgd={onConnectCgd}
        />
      )}
      {tab === "equipa" && <Equipa />}
      {tab === "permissoes" && <Permissoes />}
    </div>
  );
}

function emptyDeParaRule() {
  return {
    padrao: "",
    fornecedor: "",
    cliente: "",
    forma: "Despesa",
    contabGrupo: "Custo",
    classifContabGrupo: "02.Custo",
    contabSubGrupo: "",
    pl: "Principal",
    produto: "",
    pontualRecorrente: "Recorrente",
    fixoVariavel: "Fixa",
    iva: "Não",
    formaPagamento: "Banco",
    ativo: true,
  };
}

function applyDeParaRule(rule, payload) {
  if (!rule) return payload;
  const out = { ...payload };
  const overrideKeys = [
    "fornecedor", "cliente", "forma", "contabGrupo", "classifContabGrupo",
    "contabSubGrupo", "pl", "produto", "pontualRecorrente", "fixoVariavel",
    "iva", "formaPagamento",
  ];
  for (const k of overrideKeys) {
    const v = rule[k];
    if (v !== undefined && v !== "" && v !== null) {
      if (!out[k] || out[k] === "" || out[k] === "Despesa" || out[k] === "Banco") {
        out[k] = v;
      }
    }
  }
  return out;
}

function matchDeParaRule(rules, text) {
  if (!Array.isArray(rules) || !rules.length) return null;
  const haystack = String(text || "").toLowerCase();
  if (!haystack) return null;
  for (const r of rules) {
    if (r.ativo === false) continue;
    const padrao = String(r.padrao || "").trim().toLowerCase();
    if (!padrao) continue;
    if (haystack.includes(padrao)) return r;
  }
  return null;
}

function DePara() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyDeParaRule());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    window.__ekoa.list(COL_REGRAS_DEPARA)
      .then((rs) => setRules(Array.isArray(rs) ? rs : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function openNew() {
    setDraft(emptyDeParaRule());
    setEditing("new");
  }
  function openEdit(rule) {
    setDraft({ ...emptyDeParaRule(), ...rule });
    setEditing(rule.id);
  }
  function close() {
    setEditing(null);
    setDraft(emptyDeParaRule());
  }

  async function save() {
    if (!draft.padrao || !draft.padrao.trim()) return;
    setSaving(true);
    try {
      const payload = { ...draft, padrao: draft.padrao.trim() };
      if (editing === "new") {
        const created = await window.__ekoa.create(COL_REGRAS_DEPARA, payload);
        setRules((prev) => [created, ...prev]);
      } else {
        const updated = await window.__ekoa.update(COL_REGRAS_DEPARA, editing, payload);
        setRules((prev) => prev.map((r) => (r.id === editing ? { ...r, ...updated } : r)));
      }
      close();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm("Eliminar esta regra de classificação?")) return;
    await window.__ekoa.delete(COL_REGRAS_DEPARA, id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function toggleAtivo(rule) {
    const updated = await window.__ekoa.update(COL_REGRAS_DEPARA, rule.id, { ativo: !rule.ativo });
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...updated } : r)));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) =>
      [r.padrao, r.fornecedor, r.contabSubGrupo, r.produto, r.contabGrupo]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [rules, search]);

  return (
    <div>
      <div className="erp-toolbar">
        <div className="filter-field" style={{ flex: 1 }}>
          <label>Pesquisar regras</label>
          <input
            type="text"
            placeholder="Padrão, fornecedor, sub-grupo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-gold" onClick={openNew}>+ Nova Regra</button>
      </div>
      <div className="depara-info">
        Cada regra reconhece um <strong>padrão de texto</strong> presente no descritivo do extrato/fatura e aplica
        automaticamente Fornecedor, CONTAB_GRUPO, CONTAB_SUB-GRUPO, PRODUTO, PONTUAL/RECORRENTE e mais.
        Exemplo: padrão <code>vodafone</code> → Fornecedor: Vodafone, Grupo: Custo, Sub-Grupo: Telefonia,
        Produto: Overhead, Recorrência: Recorrente. As regras são avaliadas em ordem — a primeira correspondência ganha.
      </div>
      <div className="card">
        <div className="card-header">Regras de Classificação ({filtered.length})</div>
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-pad">Carregando regras…</div>
          ) : filtered.length === 0 ? (
            <div className="empty-pad">
              <strong>Nenhuma regra ativa.</strong>
              <br />Clique em <strong>+ Nova Regra</strong> para criar a primeira.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Padrão</th>
                  <th>Fornecedor / Cliente</th>
                  <th>Grupo</th>
                  <th>Sub-Grupo</th>
                  <th>Produto</th>
                  <th>Recorrência</th>
                  <th>Fixo/Var.</th>
                  <th>P&L</th>
                  <th>Estado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="strong"><code>{r.padrao}</code></td>
                    <td>{r.forma === "Receita" ? r.cliente : r.fornecedor}</td>
                    <td className="muted">{r.contabGrupo}</td>
                    <td>{r.contabSubGrupo}</td>
                    <td>{r.produto}</td>
                    <td>{r.pontualRecorrente}</td>
                    <td>{r.fixoVariavel}</td>
                    <td>{r.pl}</td>
                    <td>
                      <button
                        className={`pill ${r.ativo === false ? "pill-atrasado" : "pill-pago"}`}
                        onClick={() => toggleAtivo(r)}
                        style={{ border: "none", cursor: "pointer" }}
                      >
                        {r.ativo === false ? "Inativa" : "Ativa"}
                      </button>
                    </td>
                    <td className="row-actions">
                      <button className="btn btn-link" onClick={() => openEdit(r)}>Editar</button>
                      <button className="btn btn-link btn-link-danger" onClick={() => remove(r.id)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editing && (
        <DeParaModal
          isNew={editing === "new"}
          draft={draft}
          setDraft={setDraft}
          onClose={close}
          onSave={save}
          saving={saving}
        />
      )}
    </div>
  );
}

function DeParaModal({ isNew, draft, setDraft, onClose, onSave, saving }) {
  function up(k, v) { setDraft({ ...draft, [k]: v }); }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? "Nova Regra De/Para" : "Editar Regra"}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f f-wide">
              <label>Padrão de texto <span className="req">*</span></label>
              <input
                type="text"
                value={draft.padrao}
                placeholder="Ex: vodafone, edp, ifthenpay, salário..."
                onChange={(e) => up("padrao", e.target.value)}
                autoFocus
              />
            </div>
            <div className="f">
              <label>Direção</label>
              <select value={draft.forma} onChange={(e) => up("forma", e.target.value)}>
                {DIRECAO_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="f">
              <label>{draft.forma === "Receita" ? "Cliente" : "Fornecedor"}</label>
              <input
                type="text"
                value={draft.forma === "Receita" ? (draft.cliente || "") : (draft.fornecedor || "")}
                onChange={(e) => up(draft.forma === "Receita" ? "cliente" : "fornecedor", e.target.value)}
              />
            </div>
            <div className="f">
              <label>FORMA (Pagamento)</label>
              <select value={draft.formaPagamento || ""} onChange={(e) => up("formaPagamento", e.target.value)}>
                <option value="">—</option>
                {FORMA_PAGAMENTO_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="f">
              <label>CONTAB_GRUPO</label>
              <select
                value={draft.contabGrupo}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({ ...draft, contabGrupo: v, classifContabGrupo: deriveClassifContab(v) });
                }}
              >
                <option value="">—</option>
                {CONTAB_GRUPO_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="f">
              <label>CLASSIF_CONTAB_GRUPO</label>
              <input type="text" value={draft.classifContabGrupo || ""} readOnly />
            </div>
            <div className="f">
              <label>CONTAB_SUB-GRUPO</label>
              <select value={draft.contabSubGrupo || ""} onChange={(e) => up("contabSubGrupo", e.target.value)}>
                <option value="">—</option>
                {Object.entries(CONTAB_SUBGRUPO_GROUPS).map(([grp, opts]) => (
                  <optgroup key={grp} label={grp}>
                    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="f">
              <label>P&L</label>
              <select value={draft.pl} onChange={(e) => up("pl", e.target.value)}>
                {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>PRODUTO</label>
              <select value={draft.produto || ""} onChange={(e) => up("produto", e.target.value)}>
                <option value="">—</option>
                <optgroup label="Categoria">
                  {PRODUTO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </optgroup>
                <optgroup label="Desdobramento">
                  {PRODUTO_DESDOBRAMENTOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="f">
              <label>PONTUAL/RECORRENTE</label>
              <select value={draft.pontualRecorrente || ""} onChange={(e) => up("pontualRecorrente", e.target.value)}>
                {PONTUAL_RECORRENTE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>FIXO/VARIÁVEL</label>
              <select value={draft.fixoVariavel || ""} onChange={(e) => up("fixoVariavel", e.target.value)}>
                {FIXO_VARIAVEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>IVA?</label>
              <select value={draft.iva || ""} onChange={(e) => up("iva", e.target.value)}>
                {IVA_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Estado</label>
              <select
                value={draft.ativo === false ? "inativa" : "ativa"}
                onChange={(e) => up("ativo", e.target.value === "ativa")}
              >
                <option value="ativa">Ativa</option>
                <option value="inativa">Inativa</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave} disabled={saving || !draft.padrao?.trim()}>
            {saving ? "A guardar…" : "Guardar Regra"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CENTRO_CUSTO_OPTIONS = ["Principal", "Legado", "Rateado"];

function emptyMembro() {
  return {
    nome: "",
    email: "",
    funcao: "",
    nivel: "financeiro",
    iban: "",
    centroCusto: "Principal",
    rateioConexaoPct: 100,
    rateioLegadoPct: 0,
    ativo: true,
  };
}

function Equipa() {
  const [membros, setMembros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyMembro());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.__ekoa.list(COL_EQUIPA)
      .then((m) => setMembros(Array.isArray(m) ? m : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function openNew() { setDraft(emptyMembro()); setEditing("new"); }
  function openEdit(m) { setDraft({ ...emptyMembro(), ...m }); setEditing(m.id); }
  function close() { setEditing(null); setDraft(emptyMembro()); }

  async function save() {
    if (!draft.nome?.trim() || !draft.email?.trim()) return;
    setSaving(true);
    try {
      const payload = { ...draft, nome: draft.nome.trim(), email: draft.email.trim() };
      if (editing === "new") {
        const created = await window.__ekoa.create(COL_EQUIPA, payload);
        setMembros((prev) => [created, ...prev]);
      } else {
        const updated = await window.__ekoa.update(COL_EQUIPA, editing, payload);
        setMembros((prev) => prev.map((m) => (m.id === editing ? { ...m, ...updated } : m)));
      }
      close();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm("Remover este membro da equipa?")) return;
    await window.__ekoa.delete(COL_EQUIPA, id);
    setMembros((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div>
      <div className="erp-toolbar">
        <div style={{ flex: 1 }}>
          <strong>Equipa</strong> · {membros.length} membro{membros.length === 1 ? "" : "s"}
        </div>
        <button className="btn btn-gold" onClick={openNew}>+ Novo Membro</button>
      </div>
      <div className="card">
        <div className="card-header">Membros da Equipa</div>
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-pad">Carregando…</div>
          ) : membros.length === 0 ? (
            <div className="empty-pad">
              <strong>Nenhum membro cadastrado.</strong>
              <br />Adicione membros para gerir permissões e responsabilidades.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Função</th>
                  <th>Centro de Custo</th>
                  <th>IBAN</th>
                  <th>Nível</th>
                  <th>Estado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {membros.map((m) => {
                  const cc = m.centroCusto || "Principal";
                  const ccDetalhe = cc === "Rateado"
                    ? `${m.rateioConexaoPct ?? 50}% / ${m.rateioLegadoPct ?? 50}%`
                    : "";
                  const ccClass = cc === "Legado" ? "pl-legado" : cc === "Rateado" ? "pl-rateado" : "pl-principal";
                  return (
                    <tr key={m.id}>
                      <td className="strong">{m.nome}</td>
                      <td>{m.email}</td>
                      <td>{m.funcao || "—"}</td>
                      <td>
                        <span className={`pl-tag ${ccClass}`}>{cc}</span>
                        {ccDetalhe && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{ccDetalhe}</span>}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }} title={m.iban || ""}>
                        {m.iban ? `${m.iban.slice(0, 4)}…${m.iban.slice(-4)}` : "—"}
                      </td>
                      <td>{PERMISSAO_NIVEIS.find((n) => n.id === m.nivel)?.label || m.nivel}</td>
                      <td>
                        <span className={`pill ${m.ativo === false ? "pill-atrasado" : "pill-pago"}`}>
                          {m.ativo === false ? "Inativo" : "Ativo"}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn btn-link" onClick={() => openEdit(m)}>Editar</button>
                        <button className="btn btn-link btn-link-danger" onClick={() => remove(m.id)}>Remover</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editing && (
        <MembroModal
          isNew={editing === "new"}
          draft={draft}
          setDraft={setDraft}
          onClose={close}
          onSave={save}
          saving={saving}
        />
      )}
    </div>
  );
}

function MembroModal({ isNew, draft, setDraft, onClose, onSave, saving }) {
  function up(k, v) { setDraft({ ...draft, [k]: v }); }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? "Novo Membro" : "Editar Membro"}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f f-wide">
              <label>Nome <span className="req">*</span></label>
              <input type="text" value={draft.nome} onChange={(e) => up("nome", e.target.value)} autoFocus />
            </div>
            <div className="f f-wide">
              <label>E-mail <span className="req">*</span></label>
              <input type="email" value={draft.email} onChange={(e) => up("email", e.target.value)} />
            </div>
            <div className="f">
              <label>Função</label>
              <input
                type="text"
                value={draft.funcao || ""}
                placeholder="Ex: Financeiro, Comercial, Diretor"
                onChange={(e) => up("funcao", e.target.value)}
              />
            </div>
            <div className="f">
              <label>Nível de Acesso</label>
              <select value={draft.nivel} onChange={(e) => up("nivel", e.target.value)}>
                {PERMISSAO_NIVEIS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
            <div className="f f-wide">
              <label>IBAN (conta de pagamento)</label>
              <input
                type="text"
                value={draft.iban || ""}
                placeholder="PT50 0000 0000 0000 0000 0000 0"
                onChange={(e) => up("iban", e.target.value.toUpperCase().replace(/[^0-9A-Z ]/g, ""))}
                style={{ fontFamily: "monospace", letterSpacing: "0.5px" }}
              />
            </div>
            <div className="f">
              <label>Centro de Custo</label>
              <select
                value={draft.centroCusto || "Principal"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "Principal") setDraft({ ...draft, centroCusto: v, rateioConexaoPct: 100, rateioLegadoPct: 0 });
                  else if (v === "Legado") setDraft({ ...draft, centroCusto: v, rateioConexaoPct: 0, rateioLegadoPct: 100 });
                  else setDraft({ ...draft, centroCusto: v });
                }}
              >
                {CENTRO_CUSTO_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {draft.centroCusto === "Rateado" && (
              <>
                <div className="f">
                  <label>% Principal</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.rateioConexaoPct ?? 50}
                    onChange={(e) => {
                      const c = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      setDraft({ ...draft, rateioConexaoPct: c, rateioLegadoPct: 100 - c });
                    }}
                  />
                </div>
                <div className="f">
                  <label>% Legado</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.rateioLegadoPct ?? 50}
                    onChange={(e) => {
                      const l = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      setDraft({ ...draft, rateioLegadoPct: l, rateioConexaoPct: 100 - l });
                    }}
                  />
                </div>
              </>
            )}
            <div className="f f-wide">
              <label>Estado</label>
              <select
                value={draft.ativo === false ? "inativo" : "ativo"}
                onChange={(e) => up("ativo", e.target.value === "ativo")}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
          <div className="depara-info" style={{ marginTop: 16 }}>
            {PERMISSAO_NIVEIS.find((n) => n.id === draft.nivel)?.desc}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave} disabled={saving || !draft.nome?.trim() || !draft.email?.trim()}>
            {saving ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Permissoes() {
  const [perfis, setPerfis] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingNivel, setSavingNivel] = useState(null);
  const [activeNivel, setActiveNivel] = useState(PERMISSAO_NIVEIS[0].id);

  useEffect(() => {
    (async () => {
      try {
        const list = await window.__ekoa.list(COL_PERMISSOES);
        const map = {};
        for (const item of (list || [])) {
          if (item?.nivel) map[item.nivel] = item;
        }
        setPerfis(map);
      } catch (_) {} finally {
        setLoading(false);
      }
    })();
  }, []);

  function getMatriz(nivel) {
    const stored = perfis[nivel]?.matriz;
    return { ...PERMISSAO_PADRAO[nivel], ...(stored || {}) };
  }

  async function setAreaPermissao(nivel, area, valor) {
    const matriz = { ...getMatriz(nivel), [area]: valor };
    setSavingNivel(nivel);
    try {
      const existing = perfis[nivel];
      if (existing?.id) {
        const updated = await window.__ekoa.update(COL_PERMISSOES, existing.id, { matriz });
        setPerfis((prev) => ({ ...prev, [nivel]: { ...existing, ...updated, matriz } }));
      } else {
        const created = await window.__ekoa.create(COL_PERMISSOES, { nivel, matriz });
        setPerfis((prev) => ({ ...prev, [nivel]: created }));
      }
    } finally {
      setSavingNivel(null);
    }
  }

  async function resetNivel(nivel) {
    if (!confirm(`Restaurar permissões padrão de ${PERMISSAO_NIVEIS.find((n) => n.id === nivel)?.label}?`)) return;
    setSavingNivel(nivel);
    try {
      const existing = perfis[nivel];
      const matriz = { ...PERMISSAO_PADRAO[nivel] };
      if (existing?.id) {
        const updated = await window.__ekoa.update(COL_PERMISSOES, existing.id, { matriz });
        setPerfis((prev) => ({ ...prev, [nivel]: { ...existing, ...updated, matriz } }));
      } else {
        const created = await window.__ekoa.create(COL_PERMISSOES, { nivel, matriz });
        setPerfis((prev) => ({ ...prev, [nivel]: created }));
      }
    } finally {
      setSavingNivel(null);
    }
  }

  if (loading) return <div className="empty-pad">Carregando permissões…</div>;

  const matriz = getMatriz(activeNivel);
  const nivelInfo = PERMISSAO_NIVEIS.find((n) => n.id === activeNivel);

  return (
    <div>
      <div className="depara-info">
        Defina o que cada nível de acesso pode <strong>ver</strong> ou <strong>editar</strong> em cada área do sistema.
        Os membros da Equipa herdam estas permissões pelo nível atribuído.
      </div>
      <div className="perm-grid">
        <div className="perm-side">
          {PERMISSAO_NIVEIS.map((n) => (
            <button
              key={n.id}
              className={`perm-side-item ${activeNivel === n.id ? "is-active" : ""}`}
              onClick={() => setActiveNivel(n.id)}
            >
              <div className="perm-side-label">{n.label}</div>
              <div className="perm-side-desc">{n.desc}</div>
            </button>
          ))}
        </div>
        <div className="card perm-card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{nivelInfo?.label} · Matriz de Permissões</span>
            <button className="btn btn-link" onClick={() => resetNivel(activeNivel)} disabled={savingNivel === activeNivel}>
              Restaurar Padrão
            </button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Área</th>
                  <th style={{ width: 110, textAlign: "center" }}>Sem acesso</th>
                  <th style={{ width: 110, textAlign: "center" }}>Visualizar</th>
                  <th style={{ width: 110, textAlign: "center" }}>Editar</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSAO_AREAS.map((area) => {
                  const v = matriz[area.id] || "none";
                  return (
                    <tr key={area.id}>
                      <td className="strong">{area.label}</td>
                      {["none", "view", "edit"].map((opt) => (
                        <td key={opt} style={{ textAlign: "center" }}>
                          <input
                            type="radio"
                            name={`perm-${activeNivel}-${area.id}`}
                            checked={v === opt}
                            onChange={() => setAreaPermissao(activeNivel, area.id, opt)}
                            disabled={savingNivel === activeNivel}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function EncontroContas({ txs, bancos }) {
  const cgdAccounts = bancos.filter((b) => /cgd|caixa geral/i.test(b.banco || ""));

  const cenarios = useMemo(() => {
    const acc = { A: { total: 0, count: 0 }, B: { total: 0, count: 0 }, C: { total: 0, count: 0 }, D: { total: 0, count: 0 } };
    for (const t of txs) {
      if (t.status === "Cancelado") continue;
      const v = Number(t.valorBruto) || 0;
      const isLegado = (t.pl || "").toLowerCase().includes("legad");
      const isConexao = (t.pl || "").toLowerCase().includes("conex") || !isLegado;
      const isCgd = /cgd|caixa geral/i.test(t.contabGrupo || "") || /cgd/i.test(t.descricao || "");
      if (isLegado && isCgd && t.forma === "Receita") { acc.A.total += v; acc.A.count++; }
      if (isLegado && isCgd && t.forma === "Despesa") { acc.C.total += v; acc.C.count++; }
      if (isConexao && !isCgd && t.forma === "Receita") { acc.D.total += v; acc.D.count++; }
      if (isConexao && !isCgd && t.forma === "Despesa") { acc.B.total += v; acc.B.count++; }
    }
    return acc;
  }, [txs]);

  const movimentoAno = (cenarios.A.total + cenarios.B.total) - (cenarios.C.total + cenarios.D.total);
  const carryover = ENCONTRO_CONTAS_CARRYOVER.saldoAbertura;
  const owedToSocio = movimentoAno + carryover;
  const empresaDeveSocio = owedToSocio > 0;

  return (
    <div className="erp-content">
      <div className="encontro-grid">
        <div className="card encontro-hero">
          <div className="encontro-hero-left">
            <div className="encontro-hero-label">SALDO FINAL · CONTA CORRENTE DO MÚTUO</div>
            <div className={`encontro-hero-value ${empresaDeveSocio ? "is-red" : "is-green"}`}>
              {empresaDeveSocio ? "−" : "+"}{fmtEur(Math.abs(owedToSocio))}
            </div>
            <div className={`encontro-hero-msg ${empresaDeveSocio ? "is-red" : "is-green"}`}>
              {empresaDeveSocio
                ? "Principal deve ao Sócio · empresa precisa transferir esta verba ao sócio."
                : "Sócio deve à Principal · sócio precisa transferir esta verba à empresa."}
            </div>
            <button className="btn btn-gold" style={{ marginTop: 12 }}>Liquidar Saldo</button>
          </div>
          <div className="encontro-hero-right">
            <div className="encontro-formula">
              <div>Saldo abertura {ENCONTRO_CONTAS_CARRYOVER.ano} = {fmtEur(carryover)}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>(a favor do {ENCONTRO_CONTAS_CARRYOVER.favorecido})</div>
              <div style={{ height: 8 }} />
              <div>(A+B) = {fmtEur(cenarios.A.total + cenarios.B.total)}</div>
              <div>(C+D) = {fmtEur(cenarios.C.total + cenarios.D.total)}</div>
              <div className="encontro-divider" />
              <div className="encontro-saldo">Saldo = {fmtEur(owedToSocio)}</div>
            </div>
          </div>
        </div>

        <CenarioCard letra="A" cor="red" titulo="Cliente do Legado pagou na CGD" pill="→ Sócio" valor={cenarios.A.total} count={cenarios.A.count} pl="Legado" conta="CGD" tipo="Receita" />
        <CenarioCard letra="B" cor="red" titulo="Sócio pagou conta da Principal" pill="→ Sócio" valor={cenarios.B.total} count={cenarios.B.count} pl="Principal" conta="Externa" tipo="Despesa" />
        <CenarioCard letra="C" cor="green" titulo="Principal pagou conta do Legado" pill="→ Empresa" valor={cenarios.C.total} count={cenarios.C.count} pl="Legado" conta="CGD" tipo="Despesa" />
        <CenarioCard letra="D" cor="green" titulo="Cliente da Principal pagou no Sócio" pill="→ Empresa" valor={cenarios.D.total} count={cenarios.D.count} pl="Principal" conta="Externa" tipo="Receita" />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">Extrato do Mútuo · {cenarios.A.count + cenarios.B.count + cenarios.C.count + cenarios.D.count} lançamentos</div>
        <div className="card-body">
          <div className="empty-pad">
            Cruzamento conta bancária × P&L. {cgdAccounts.length === 0 ? "Adicione uma conta CGD em Contas Bancárias para ativar o cruzamento automático." : `Conta CGD detectada: ${cgdAccounts[0].nome}.`}
          </div>
        </div>
      </div>
    </div>
  );
}

function CenarioCard({ letra, cor, titulo, pill, valor, count, pl, conta, tipo }) {
  return (
    <div className={`cenario-card cenario-${cor}`}>
      <div className="cenario-head">
        <span className="cenario-letra">CENÁRIO {letra}</span>
        <span className={`cenario-pill cenario-pill-${cor}`}>{pill}</span>
      </div>
      <div className="cenario-titulo">{titulo}</div>
      <div className={`cenario-valor cenario-valor-${cor}`}>{fmtEur(valor)}</div>
      <div className="cenario-meta">{count} lançamentos · P&L = {pl} · Conta = {conta} · {tipo}</div>
    </div>
  );
}

function UploadIA({ onCreateTx }) {
  const [drafts, setDrafts] = useState([]);
  const [tipoPadrao, setTipoPadrao] = useState("Despesa");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  function handleFiles(files) {
    const list = Array.from(files);
    const newDrafts = list.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      fileName: f.name,
      fileSize: f.size,
      status: "aguardando",
      tipo: tipoPadrao,
      detectedAmount: null,
      detectedDate: null,
    }));
    setDrafts((prev) => [...newDrafts, ...prev]);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  function approve(d) {
    onCreateTx({
      forma: d.tipo,
      status: d.tipo === "Despesa" ? "A pagar" : "A receber",
      actPlan: "Plan",
      data: todayISO(),
      competencia: todayMonthKey(),
      dtVencimento: todayISO(),
      descricao: d.fileName.replace(/\.[^.]+$/, ""),
      pl: "Principal",
      valorBruto: d.detectedAmount || 0,
    }, d.file);
    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
  }

  function reject(id) {
    setDrafts((prev) => prev.filter((x) => x.id !== id));
  }

  const aguardando = drafts.filter((d) => d.status === "aguardando").length;
  const processando = drafts.filter((d) => d.status === "processando").length;
  const erro = drafts.filter((d) => d.status === "erro").length;

  return (
    <div className="erp-content">
      <div className="upload-banner">
        <div className="upload-banner-eyebrow">CAIXA PARTILHADA · INBOX DE COMPROVATIVOS</div>
        <div className="upload-banner-body">
          Sócios e contadores podem encaminhar comprovativos por e-mail. O sistema processa automaticamente e cria rascunhos para aprovação.
        </div>
        <div className="upload-banner-row">
          <code className="upload-mono">inbox+4f2ebd88@uploads.ekoa.io</code>
          <span className="upload-soon">EM BREVE</span>
          <div style={{ marginLeft: "auto" }}>
            <button className="btn btn-gold">↻ Sincronizar Caixa</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header card-header-with-controls">
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Upload Inteligente de Comprovativos</div>
            <div className="receber-desc" style={{ marginTop: 2 }}>OCR + classificação por padrões + aprovação manual</div>
          </div>
          <div className="filter-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <label style={{ marginBottom: 0 }}>Tipo padrão</label>
            <select value={tipoPadrao} onChange={(e) => setTipoPadrao(e.target.value)}>
              <option>Despesa</option>
              <option>Receita</option>
            </select>
          </div>
        </div>
        <div className="card-body">
          <div
            className={`dropzone ${dragOver ? "is-over" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <div className="dropzone-title">Arraste comprovantes para aqui ou clique para escolher</div>
            <div className="dropzone-hint">PDF, PNG, JPEG, WEBP até 8 MB cada</div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
            />
          </div>
        </div>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <KpiCard label="Aguardam Revisão" value={aguardando} hint="rascunhos" tone="gold" />
        <div className="kpi tone-neutral">
          <div className="kpi-l">A Processar</div>
          <div className="kpi-v">{processando}</div>
          <div className="kpi-h">OCR em curso</div>
        </div>
        <div className="kpi tone-red">
          <div className="kpi-l">Com Erro</div>
          <div className="kpi-v">{erro}</div>
          <div className="kpi-h">requer atenção</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">Rascunhos ({drafts.length})</div>
        <div className="card-body" style={{ padding: 0 }}>
          {drafts.length === 0 ? (
            <div className="empty-pad">Sem rascunhos. Arraste comprovantes acima para começar.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Tamanho</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th className="num">Ações</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td className="strong">{d.fileName}</td>
                    <td>{fmtFileSize(d.fileSize)}</td>
                    <td>{d.tipo}</td>
                    <td><span className="pill pill-pendente">Aguarda revisão</span></td>
                    <td className="row-actions">
                      <button className="btn btn-tiny btn-gold" onClick={() => approve(d)}>Aprovar e criar</button>
                      <button className="btn btn-link btn-link-danger" onClick={() => reject(d.id)}>Rejeitar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">Como funciona o motor de OCR</div>
        <div className="card-body">
          <ul className="upload-help-list">
            <li><strong>PDF.js + Tesseract.js</strong> extraem texto de PDFs e imagens diretamente no navegador.</li>
            <li><strong>Classificação em 3 camadas</strong>: regras De/Para → histórico de transações → keywords genéricas.</li>
            <li><strong>Privacidade</strong>: nada é enviado para servidores externos. Todo o OCR roda localmente.</li>
            <li><strong>Aprovação obrigatória</strong>: nenhum rascunho vira lançamento sem revisão humana.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Placeholder({ label }) {
  return (
    <div className="erp-content">
      <div className="empty-card big">
        <div className="empty-card-title">{label}</div>
        <p>Esta secção está em construção. As funcionalidades aparecerão aqui à medida que forem implementadas.</p>
      </div>
    </div>
  );
}

function Fornecedores({ txs }) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const map = new Map();
    for (const t of txs) {
      if (t.status === "Cancelado") continue;
      const nome = String(t.fornecedor || "").trim();
      if (!nome || /^n\/?a$/i.test(nome)) continue;
      const key = nome.toLowerCase();
      const v = Math.abs(Number(t.valorBruto) || 0);
      const existing = map.get(key) || { nome, total: 0, count: 0, ultimaData: "", pl: "" };
      if (t.forma === "Despesa") existing.total += v;
      existing.count += 1;
      if (!existing.ultimaData || (t.data || "") > existing.ultimaData) existing.ultimaData = t.data || "";
      if (!existing.pl && t.pl) existing.pl = t.pl;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt"));
  }, [txs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.nome.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="erp-content">
      <div className="kpi-row">
        <KpiCard label="Total Fornecedores" value={String(rows.length)} hint="únicos com lançamentos" tone="gold" />
        <KpiCard
          label="Total Despesas (Fornecedores)"
          value={fmtEur(rows.reduce((acc, r) => acc + r.total, 0))}
          hint="histórico acumulado (BRUTO)"
          tone="red"
        />
      </div>
      <div className="filter-bar" style={{ marginTop: 12 }}>
        <div className="filter-field" style={{ flex: 1 }}>
          <label>Pesquisar</label>
          <input
            type="text"
            value={search}
            placeholder="Nome do fornecedor..."
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header">Fornecedores ({filtered.length}) · extraídos das transações</div>
        <div className="card-body" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty-pad">Nenhum fornecedor encontrado.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>P&L</th>
                  <th className="num">Lançamentos</th>
                  <th className="num">Total Despesas</th>
                  <th>Último lançamento</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.nome}>
                    <td className="strong">{r.nome}</td>
                    <td>{r.pl || "—"}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{fmtEur(r.total)}</td>
                    <td>{fmtDate(r.ultimaData) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`pill pill-${(status || "").toLowerCase()}`}>{status || "—"}</span>;
}

function ContasHojeToast({ contas, onClose, onView }) {
  const total = contas.reduce((acc, t) => acc + (Number(t.valorBruto) || 0), 0);
  const first = contas[0];
  const detail = first
    ? `${first.fornecedor || first.descricao || "—"}${contas.length > 1 ? ` e mais ${contas.length - 1}` : ""}`
    : "";
  return (
    <div className="toast-wrap">
      <div className="toast">
        <div className="toast-body">
          <div className="toast-title">{contas.length} conta{contas.length > 1 ? "s" : ""} a pagar hoje</div>
          <div className="toast-detail">Total: {fmtEur(total)} · {detail}</div>
          <button className="toast-cta" onClick={onView}>Ver Contas</button>
        </div>
        <button className="toast-close" onClick={onClose}>×</button>
      </div>
    </div>
  );
}

function ConfirmDeleteTxModal({ tx, onCancel, onConfirm, deleting }) {
  const detalhe = tx
    ? `${tx.data ? fmtDate(tx.data) : "—"} · ${tx.forma || "?"} · ${fmtEur(tx.valorBruto)} · ${tx.fornecedor || tx.cliente || tx.descricao || "—"}`
    : "";
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h2>Excluir transação?</h2>
          <button className="icon-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>
            Esta ação <strong>não pode ser desfeita</strong>. A transação abaixo será removida permanentemente.
          </p>
          <div style={{ background: "var(--beige-soft)", padding: "10px 12px", borderRadius: 6, fontSize: 13 }}>
            {detalhe}
            {tx?.origem && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Origem: {tx.origem}</div>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onCancel} disabled={deleting}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? "A excluir…" : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClienteSelect({ value, onChange, clientes, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState({ nome: "", email: "", endereco: "", telefone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setOpen(false);
        setCreating(false);
        setQuery("");
        setErr("");
      }
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const list = Array.isArray(clientes) ? clientes : [];
  const q = normalizeText(query);
  const filtered = useMemo(() => {
    if (!q) return list;
    return list.filter((c) => {
      const n = normalizeText(c.nome);
      const e = normalizeText(c.email);
      return n.includes(q) || e.includes(q);
    });
  }, [list, q]);

  const selected = list.find((c) => normalizeName(c.nome) === normalizeName(value));
  const displayValue = value || "";
  const hasExactMatch = !!list.find((c) => normalizeName(c.nome) === normalizeName(query));

  function selectCliente(c) {
    onChange(c.nome);
    setOpen(false);
    setQuery("");
    setCreating(false);
    setErr("");
  }

  function clearCliente() {
    onChange("");
    setQuery("");
    setOpen(false);
    setErr("");
  }

  function similarMatches(draft) {
    const nQ = normalizeText(draft.nome);
    const eQ = normalizeText(draft.email);
    const addrQ = normalizeText(draft.endereco);
    const tokensN = tokenize(draft.nome);
    const out = [];
    for (const c of list) {
      const reasons = [];
      const nC = normalizeText(c.nome);
      const eC = normalizeText(c.email);
      const addrC = normalizeText(c.endereco);
      if (nQ && nC) {
        if (nC === nQ) reasons.push("nome igual");
        else if (nC.includes(nQ) || nQ.includes(nC)) reasons.push("nome parecido");
        else {
          const j = jaccardScore(tokensN, tokenize(c.nome));
          if (j >= 0.5) reasons.push(`nome parecido (${Math.round(j * 100)}%)`);
        }
      }
      if (eQ && eC && eQ === eC) reasons.push("e-mail igual");
      if (addrQ && addrC) {
        if (addrC === addrQ) reasons.push("endereço igual");
        else if (addrC.includes(addrQ) || addrQ.includes(addrC)) reasons.push("endereço parecido");
      }
      if (reasons.length) out.push({ cliente: c, reasons });
    }
    return out.slice(0, 5);
  }

  async function confirmCreate(force = false) {
    setErr("");
    const nome = (newDraft.nome || "").trim();
    if (!nome) { setErr("Nome do cliente é obrigatório."); return; }
    if (!force) {
      const sim = similarMatches({ ...newDraft, nome });
      if (sim.length) {
        const reasons = sim.map((s) => `• ${s.cliente.nome} — ${s.reasons.join(", ")}`).join("\n");
        const ok = confirm(`Encontramos cliente(s) parecido(s):\n\n${reasons}\n\nDeseja criar mesmo assim?`);
        if (!ok) return;
      }
    }
    setBusy(true);
    try {
      const created = await onCreate({
        nome,
        email: (newDraft.email || "").trim(),
        endereco: (newDraft.endereco || "").trim(),
        telefone: (newDraft.telefone || "").trim(),
      });
      if (created?.nome) onChange(created.nome);
      setOpen(false);
      setCreating(false);
      setQuery("");
      setNewDraft({ nome: "", email: "", endereco: "", telefone: "" });
    } catch (e) {
      setErr(e.message || "Falha ao criar cliente.");
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setCreating(true);
    setNewDraft({ nome: query || "", email: "", endereco: "", telefone: "" });
    setErr("");
  }

  return (
    <div className="cliente-select" ref={wrapRef}>
      {!open ? (
        <div className="cs-display" onClick={() => setOpen(true)}>
          <span className={selected ? "" : "muted"}>
            {displayValue || "Selecione um cliente…"}
          </span>
          <div className="cs-actions">
            {displayValue && (
              <button
                type="button"
                className="cs-clear"
                onClick={(e) => { e.stopPropagation(); clearCliente(); }}
                title="Limpar"
              >×</button>
            )}
            <span className="cs-caret">▾</span>
          </div>
        </div>
      ) : (
        <div className="cs-popover">
          {!creating ? (
            <>
              <input
                type="text"
                className="cs-search"
                autoFocus
                placeholder="Buscar cliente por nome ou e-mail…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="cs-list">
                {filtered.length === 0 && (
                  <div className="cs-empty">Nenhum cliente cadastrado bate com a busca.</div>
                )}
                {filtered.map((c) => (
                  <button
                    type="button"
                    key={c.id || c.nome}
                    className="cs-item"
                    onClick={() => selectCliente(c)}
                  >
                    <span className="cs-item-name">{c.nome}</span>
                    {c.email && <span className="cs-item-sub">{c.email}</span>}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="cs-create-trigger"
                onClick={startCreate}
              >
                + Cadastrar novo cliente{query ? `: "${query}"` : ""}
              </button>
              {query && hasExactMatch && (
                <div className="cs-hint">Cliente já cadastrado — selecione acima.</div>
              )}
            </>
          ) : (
            <div className="cs-create">
              <div className="cs-create-title">Novo cliente</div>
              <div className="cs-create-fields">
                <input
                  type="text"
                  placeholder="Nome *"
                  value={newDraft.nome}
                  onChange={(e) => setNewDraft({ ...newDraft, nome: e.target.value })}
                />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={newDraft.email}
                  onChange={(e) => setNewDraft({ ...newDraft, email: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Endereço"
                  value={newDraft.endereco}
                  onChange={(e) => setNewDraft({ ...newDraft, endereco: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Telefone"
                  value={newDraft.telefone}
                  onChange={(e) => setNewDraft({ ...newDraft, telefone: e.target.value })}
                />
              </div>
              {(() => {
                const sim = similarMatches(newDraft);
                if (!sim.length) return null;
                return (
                  <div className="cs-warning">
                    <div className="cs-warning-title">Atenção: cliente(s) parecido(s) já cadastrado(s):</div>
                    <ul>
                      {sim.map((s) => (
                        <li key={s.cliente.id || s.cliente.nome}>
                          <button
                            type="button"
                            className="cs-link"
                            onClick={() => selectCliente(s.cliente)}
                          >
                            {s.cliente.nome}
                          </button>
                          <span className="muted"> — {s.reasons.join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
              {err && <div className="cs-error">{err}</div>}
              <div className="cs-create-actions">
                <button type="button" className="btn btn-light btn-tiny" onClick={() => { setCreating(false); setErr(""); }}>
                  Voltar
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-tiny"
                  disabled={busy}
                  onClick={() => confirmCreate(false)}
                >
                  {busy ? "Salvando…" : "Criar e selecionar"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TxModal({ isNew, draft, setDraft, file, setFile, onClose, onSave, onViewInvoice, onRemoveInvoice, saving, fornecedoresList = [], clientesList = [], clientesFull = [], onCreateCliente }) {
  const fileRef = useRef(null);
  function up(k, v) {
    setDraft((d) => {
      const next = { ...d, [k]: v };
      if (k === "valorBruto") next.valorLiquido = Number(v) || 0;
      if (k === "data") {
        const dt = new Date(v);
        if (!isNaN(dt)) next.competencia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      }
      return next;
    });
  }
  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_ATTACHMENT_BYTES) {
      alert(`Arquivo muito grande (${(f.size / 1024 / 1024).toFixed(1)} MB). Máximo: 5 MB.`);
      return;
    }
    setFile(f);
  }
  async function handleRemoveExisting() {
    if (draft.id) {
      await onRemoveInvoice({ id: draft.id, anexoId: draft.anexoId });
      setDraft({ ...draft, anexoId: null, anexoNome: null, anexoTipo: null });
    }
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? "Nova Transação" : "Editar Transação"}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f">
              <label>Direção (Receita/Despesa)</label>
              <select value={draft.forma} onChange={(e) => up("forma", e.target.value)}>
                {DIRECAO_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Status</label>
              <select
                value={draft.status}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({ ...draft, status: v, actPlan: deriveActPlan(v) });
                }}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="f">
              <label>FORMA (Pagamento)</label>
              <select value={draft.formaPagamento || ""} onChange={(e) => up("formaPagamento", e.target.value)}>
                <option value="">—</option>
                {FORMA_PAGAMENTO_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Act/Plan</label>
              <input type="text" value={draft.actPlan || ""} readOnly placeholder="Derivado do status" />
            </div>
            <div className="f">
              <label>Data (efetiva)</label>
              <input type="date" value={draft.data} onChange={(e) => up("data", e.target.value)} />
            </div>
            <div className="f">
              <label>DT_EMISSÃO</label>
              <input type="date" value={draft.dtEmissao || ""} onChange={(e) => up("dtEmissao", e.target.value)} />
            </div>
            <div className="f">
              <label>DT_VENCIMENTO</label>
              <input type="date" value={draft.dtVencimento} onChange={(e) => up("dtVencimento", e.target.value)} />
            </div>
            <div className="f">
              <label>Competência (mês)</label>
              <input
                type="month"
                value={(draft.competencia || "").slice(0, 7)}
                onChange={(e) => up("competencia", e.target.value)}
              />
            </div>
            <div className="f">
              <label>Fornecedor</label>
              <input
                type="text"
                list="dl-fornecedores"
                value={draft.fornecedor || ""}
                onChange={(e) => up("fornecedor", e.target.value)}
              />
              <datalist id="dl-fornecedores">
                {(fornecedoresList || []).map((f) => <option key={`fr-${f}`} value={f} />)}
              </datalist>
            </div>
            <div className="f">
              <label>Cliente</label>
              <ClienteSelect
                value={draft.cliente || ""}
                onChange={(v) => up("cliente", v)}
                clientes={clientesFull}
                onCreate={onCreateCliente}
              />
            </div>
            <div className="f">
              <label>Fatura / Documento</label>
              <input type="text" value={draft.fatura} onChange={(e) => up("fatura", e.target.value)} />
            </div>
            <div className="f f-wide">
              <label>Descrição</label>
              <input type="text" value={draft.descricao} onChange={(e) => up("descricao", e.target.value)} />
            </div>
            <div className="f">
              <label>CONTAB_GRUPO</label>
              <select
                value={draft.contabGrupo}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({ ...draft, contabGrupo: v, classifContabGrupo: deriveClassifContab(v) });
                }}
              >
                <option value="">—</option>
                {CONTAB_GRUPO_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="f">
              <label>CLASSIF_CONTAB_GRUPO</label>
              <input type="text" value={draft.classifContabGrupo || ""} readOnly placeholder="Derivado do grupo" />
            </div>
            <div className="f">
              <label>CONTAB_SUB-GRUPO</label>
              <select value={draft.contabSubGrupo || ""} onChange={(e) => up("contabSubGrupo", e.target.value)}>
                <option value="">—</option>
                {Object.entries(CONTAB_SUBGRUPO_GROUPS).map(([grp, opts]) => (
                  <optgroup key={grp} label={grp}>
                    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="f">
              <label>P&L</label>
              <select value={draft.pl} onChange={(e) => up("pl", e.target.value)}>
                {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>PRODUTO</label>
              <select value={draft.produto || ""} onChange={(e) => up("produto", e.target.value)}>
                <option value="">—</option>
                <optgroup label="Categoria">
                  {PRODUTO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </optgroup>
                <optgroup label="Desdobramento">
                  {PRODUTO_DESDOBRAMENTOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="f">
              <label>PONTUAL/RECORRENTE</label>
              <select value={draft.pontualRecorrente || ""} onChange={(e) => up("pontualRecorrente", e.target.value)}>
                <option value="">—</option>
                {PONTUAL_RECORRENTE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>FIXO/VARIÁVEL</label>
              <select value={draft.fixoVariavel || ""} onChange={(e) => up("fixoVariavel", e.target.value)}>
                <option value="">—</option>
                {FIXO_VARIAVEL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>IVA?</label>
              <select value={draft.iva || ""} onChange={(e) => up("iva", e.target.value)}>
                <option value="">—</option>
                {IVA_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Originador Comissão</label>
              <input type="text" value={draft.originadorComissao || ""} onChange={(e) => up("originadorComissao", e.target.value)} />
            </div>
            <div className="f">
              <label>Valor (EUR)</label>
              <input
                type="number"
                step="0.01"
                value={draft.valorBruto || 0}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  setDraft({ ...draft, valorBruto: v, valorLiquido: v });
                }}
              />
            </div>
            <div className="f f-wide">
              <label>Comentários</label>
              <input type="text" value={draft.comentarios || ""} onChange={(e) => up("comentarios", e.target.value)} placeholder="Observações adicionais" />
            </div>
          </div>

          <div className="invoice-section">
            <div className="invoice-section-head">
              <span>Fatura / Documento (PDF ou imagem, até 5 MB)</span>
            </div>
            {file ? (
              <div className="invoice-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div className="invoice-chip-meta">
                  <div className="invoice-chip-name">{file.name}</div>
                  <div className="invoice-chip-size">{fmtFileSize(file.size)} · será anexada ao guardar</div>
                </div>
                <button className="icon-btn danger" onClick={() => setFile(null)} title="Cancelar anexo">×</button>
              </div>
            ) : draft.anexoId ? (
              <div className="invoice-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div className="invoice-chip-meta">
                  <div className="invoice-chip-name">{draft.anexoNome || "Fatura anexada"}</div>
                  <div className="invoice-chip-size">Já anexada · clique para abrir</div>
                </div>
                <button className="btn btn-tiny btn-light" onClick={() => onViewInvoice(draft)}>Ver</button>
                <button className="btn btn-tiny btn-light" onClick={() => fileRef.current?.click()}>Substituir</button>
                <button className="icon-btn danger" onClick={handleRemoveExisting} title="Remover fatura">×</button>
              </div>
            ) : (
              <button className="invoice-dropzone" onClick={() => fileRef.current?.click()} type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span>Clique para selecionar um arquivo</span>
                <small>PDF, JPG, PNG · até 5 MB</small>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              style={{ display: "none" }}
              onChange={pickFile}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave} disabled={saving}>{saving ? "A guardar…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function BalanceModal({ draft, setDraft, onClose, onSave }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Editar Saldo do Banco</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f">
              <label>Saldo do Banco (EUR)</label>
              <input type="number" step="0.01" value={draft.saldoBanco} onChange={(e) => setDraft({ ...draft, saldoBanco: e.target.value })} />
            </div>
            <div className="f">
              <label>Data do saldo</label>
              <input type="date" value={draft.saldoBancoData} onChange={(e) => setDraft({ ...draft, saldoBancoData: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function ContasBancarias({ bancos, onNew, onEdit, onDelete, onConnectCgd }) {
  const totalSaldo = bancos.reduce((acc, b) => acc + (Number(b.saldoInicial) || 0), 0);
  const cgdAtivos = bancos.filter((b) => b.integracao === "cgd").length;
  return (
    <div className="erp-content">
      <div className="erp-toolbar">
        <button className="btn btn-light" onClick={onConnectCgd}>
          <span className="cgd-mark">CGD</span>
          Conectar Caixa Geral de Depósitos
        </button>
        <button className="btn btn-gold" onClick={onNew}>+ Nova Conta Bancária</button>
      </div>

      <div className="kpi-row">
        <KpiCard label="Contas Cadastradas" value={bancos.length} hint={`${bancos.filter((b) => b.ativo).length} ativas`} tone="gold" />
        <KpiCard label="Saldo Inicial Consolidado" value={fmtEur(totalSaldo)} hint="soma das contas" tone="gold" />
        <div className="kpi tone-dark">
          <div className="kpi-l">Integrações Bancárias</div>
          <div className="kpi-v">{cgdAtivos}</div>
          <div className="kpi-h">contas ligadas via CGD</div>
        </div>
      </div>

      {bancos.length === 0 ? (
        <div className="empty-card big">
          <div className="empty-card-title">Sem contas bancárias</div>
          <p>
            Adicione manualmente uma conta com <strong>+ Nova Conta Bancária</strong> ou conecte
            diretamente à <strong>Caixa Geral de Depósitos</strong> para sincronizar movimentos.
          </p>
        </div>
      ) : (
        <div className="banco-grid">
          {bancos.map((b) => (
            <div className={`banco-card ${b.integracao === "cgd" ? "is-cgd" : ""}`} key={b.id}>
              <div className="banco-head">
                <div>
                  <div className="banco-name">{b.nome}</div>
                  <div className="banco-bank">{b.banco}</div>
                </div>
                {b.integracao === "cgd" ? (
                  <span className="banco-tag banco-tag-cgd">CGD · sincronizado</span>
                ) : (
                  <span className="banco-tag">Manual</span>
                )}
              </div>
              <div className="banco-body">
                <div className="banco-iban">
                  <div className="banco-iban-label">IBAN</div>
                  <div className="banco-iban-value">{b.iban || "—"}</div>
                </div>
                <div className="banco-meta">
                  <div>
                    <div className="banco-meta-l">Titular</div>
                    <div className="banco-meta-v">{b.titular || "—"}</div>
                  </div>
                  <div>
                    <div className="banco-meta-l">BIC/SWIFT</div>
                    <div className="banco-meta-v">{b.bic || "—"}</div>
                  </div>
                  <div>
                    <div className="banco-meta-l">Saldo Inicial</div>
                    <div className="banco-meta-v">{fmtEur(b.saldoInicial)}</div>
                  </div>
                  <div>
                    <div className="banco-meta-l">Moeda</div>
                    <div className="banco-meta-v">{b.moeda || "EUR"}</div>
                  </div>
                </div>
                {b.integracao === "cgd" && (
                  <div className="banco-cgd-info">
                    Contrato: {b.cgdContractMasked || "•••"} · ligado em {b.cgdConectadoEm ? fmtDate(b.cgdConectadoEm.slice(0, 10)) : "—"}
                  </div>
                )}
              </div>
              <div className="banco-foot">
                <button className="btn btn-link" onClick={() => onEdit(b)}>Editar</button>
                <button className="btn btn-link btn-link-danger" onClick={() => onDelete(b.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BancoModal({ isNew, draft, setDraft, onClose, onSave, saving }) {
  function up(k, v) { setDraft({ ...draft, [k]: v }); }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? "Nova Conta Bancária" : "Editar Conta Bancária"}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f f-wide">
              <label>Nome / Apelido <span className="req">*</span></label>
              <input type="text" value={draft.nome} onChange={(e) => up("nome", e.target.value)} placeholder="Ex: Conta Operacional CGD" autoFocus />
            </div>
            <div className="f">
              <label>Banco</label>
              <select value={draft.banco} onChange={(e) => up("banco", e.target.value)}>
                {BANCOS_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Moeda</label>
              <select value={draft.moeda} onChange={(e) => up("moeda", e.target.value)}>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="BRL">BRL</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div className="f f-wide">
              <label>IBAN</label>
              <input type="text" value={draft.iban} placeholder="PT50 0000 0000 0000 0000 0000 0" onChange={(e) => up("iban", e.target.value)} />
            </div>
            <div className="f">
              <label>BIC / SWIFT</label>
              <input type="text" value={draft.bic} onChange={(e) => up("bic", e.target.value)} />
            </div>
            <div className="f">
              <label>Titular</label>
              <input type="text" value={draft.titular} onChange={(e) => up("titular", e.target.value)} />
            </div>
            <div className="f">
              <label>Saldo Inicial</label>
              <input type="number" step="0.01" value={draft.saldoInicial} onChange={(e) => up("saldoInicial", e.target.value)} />
            </div>
            <div className="f">
              <label>Estado</label>
              <select value={draft.ativo ? "true" : "false"} onChange={(e) => up("ativo", e.target.value === "true")}>
                <option value="true">Ativa</option>
                <option value="false">Inativa</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave} disabled={saving}>{saving ? "A guardar…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function CgdConnectModal({ state, setState, onSubmit, onClose }) {
  return (
    <div className="modal-back" onClick={state.step === "connecting" ? undefined : onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>
              <span className="cgd-mark cgd-mark-lg">CGD</span>
              Conectar Caixa Geral de Depósitos
            </h2>
            <div className="modal-sub-title">Sincronização via Open Banking PSD2</div>
          </div>
          {state.step !== "connecting" && (
            <button className="icon-btn" onClick={onClose}>×</button>
          )}
        </div>
        <div className="modal-body">
          {state.step === "credentials" && (
            <>
              <div className="cgd-info">
                As credenciais são utilizadas apenas para autorizar o acesso aos extratos da sua conta. Depois da autorização, a sincronização funciona via tokens (OAuth/PSD2) — nunca armazenamos as suas credenciais em texto plano.
              </div>
              {state.error && <div className="erp-alert erp-alert-error" style={{ margin: "0 0 12px" }}>{state.error}</div>}
              <div className="fg">
                <div className="f f-wide">
                  <label>Apelido da conta</label>
                  <input type="text" value={state.accountAlias} onChange={(e) => setState({ ...state, accountAlias: e.target.value })} />
                </div>
                <div className="f f-wide">
                  <label>Número de Contrato CaixaDirecta <span className="req">*</span></label>
                  <input type="text" value={state.contractNumber} onChange={(e) => setState({ ...state, contractNumber: e.target.value })} autoFocus />
                </div>
                <div className="f f-wide">
                  <label>Código de Acesso <span className="req">*</span></label>
                  <input type="password" value={state.accessCode} onChange={(e) => setState({ ...state, accessCode: e.target.value })} />
                </div>
                <div className="f f-wide">
                  <label>IBAN da conta a sincronizar</label>
                  <input type="text" value={state.iban} placeholder="PT50 0035 …" onChange={(e) => setState({ ...state, iban: e.target.value })} />
                </div>
              </div>
            </>
          )}
          {state.step === "connecting" && (
            <div className="cgd-loading">
              <div className="cgd-spinner" />
              <p>A estabelecer ligação segura com a Caixa Geral de Depósitos…</p>
            </div>
          )}
          {state.step === "done" && (
            <div className="cgd-success">
              <div className="cgd-success-mark">✓</div>
              <h3>Conta CGD adicionada</h3>
              <p>
                A conta foi registada com a integração marcada como <strong>pendente de validação</strong>. Após a autenticação multifator no aplicativo da CGD, os extratos passarão a sincronizar automaticamente.
              </p>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {state.step === "credentials" && (
            <>
              <button className="btn btn-light" onClick={onClose}>Cancelar</button>
              <button className="btn btn-gold" onClick={onSubmit}>Conectar</button>
            </>
          )}
          {state.step === "done" && (
            <button className="btn btn-gold" onClick={onClose}>Concluir</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContasPagar({ txs, realizadasAll = [], onEdit, onDelete, onPay, onAttach, onView }) {
  const [filter, setFilter] = useState("proximos");

  const today = todayISO();
  const limite10 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  }, []);

  const liquidacaoByPendId = useMemo(() => {
    const map = new Map();
    const tolerancia = 0.02;
    const janelaDias = 20;
    for (const pend of txs) {
      if (isRealizado(pend) || pend.status === "Cancelado") continue;
      const valor = Math.abs(Number(pend.valorBruto) || 0);
      if (!valor) continue;
      const dtBase = pend.dtVencimento || pend.data;
      if (!dtBase) continue;
      const baseMs = new Date(dtBase + "T00:00:00").getTime();
      const fornNorm = normalizeText(pend.fornecedor || "");
      const fornTokens = tokenize(pend.fornecedor || "");
      let melhor = null;
      let melhorScore = -1;
      for (const real of realizadasAll) {
        if (real.id === pend.id) continue;
        if (real.origem === "saldo-ancora") continue;
        const vReal = Math.abs(Number(real.valorBruto) || 0);
        if (Math.abs(vReal - valor) > tolerancia) continue;
        const dReal = real.data || real.dtVencimento || "";
        if (!dReal) continue;
        const realMs = new Date(dReal + "T00:00:00").getTime();
        const deltaDias = Math.abs(realMs - baseMs) / (1000 * 60 * 60 * 24);
        if (deltaDias > janelaDias) continue;
        const realForn = normalizeText(real.fornecedor || "");
        const realTokens = tokenize(real.fornecedor || "");
        let fornScore = 0;
        if (fornNorm && realForn) {
          if (fornNorm === realForn) fornScore = 1;
          else if (fornNorm.includes(realForn) || realForn.includes(fornNorm)) fornScore = 0.8;
          else fornScore = jaccardScore(fornTokens, realTokens);
        }
        const score = fornScore - deltaDias / janelaDias * 0.3;
        if (score > melhorScore) {
          melhorScore = score;
          melhor = { real, deltaDias, fornScore };
        }
      }
      if (melhor && melhor.fornScore >= 0.4) {
        map.set(pend.id, melhor);
      }
    }
    return map;
  }, [txs, realizadasAll]);

  const enriched = useMemo(() => {
    return txs.map((t) => {
      const bruto = Number(t.valorBruto) || 0;
      const liquido = Number(t.valorLiquido) || bruto;
      const iva = Math.max(0, bruto - liquido);
      const isOverdue = isPendente(t) && t.dtVencimento && t.dtVencimento < today;
      const isToday = t.dtVencimento === today && (!isRealizado(t) && t.status !== "Cancelado");
      let diasAtraso = 0;
      if (isOverdue && t.dtVencimento) {
        diasAtraso = Math.floor((new Date(today) - new Date(t.dtVencimento)) / (1000 * 60 * 60 * 24));
      }
      const liquidacao = liquidacaoByPendId.get(t.id);
      return { ...t, bruto, liquido, iva, isOverdue, isToday, diasAtraso, liquidacao };
    });
  }, [txs, today, liquidacaoByPendId]);

  const liquidadosCount = useMemo(
    () => enriched.filter((t) => t.liquidacao && !isRealizado(t) && t.status !== "Cancelado").length,
    [enriched]
  );


  const counts = useMemo(() => {
    const pendentes = enriched.filter((t) => (!isRealizado(t) && t.status !== "Cancelado"));
    return {
      hoje: pendentes.filter((t) => t.isToday).length,
      atrasados: pendentes.filter((t) => t.isOverdue).length,
      proximos: pendentes.filter((t) => t.dtVencimento >= today && t.dtVencimento <= limite10).length,
      depois: pendentes.filter((t) => t.dtVencimento > limite10).length,
      todas: enriched.length,
    };
  }, [enriched, today, limite10]);

  const filtered = useMemo(() => {
    return enriched
      .filter((t) => {
        if (filter === "todas") return true;
        if (isRealizado(t) || t.status === "Cancelado") return false;
        if (filter === "liquidados") return !!t.liquidacao;
        if (filter === "hoje") return t.isToday;
        if (filter === "atrasados") return t.isOverdue;
        if (filter === "proximos") return t.isOverdue || (t.dtVencimento >= today && t.dtVencimento <= limite10);
        if (filter === "depois") return t.dtVencimento > limite10;
        return true;
      })
      .sort((a, b) => (a.dtVencimento || "").localeCompare(b.dtVencimento || ""));
  }, [enriched, filter, today, limite10]);

  const summary = useMemo(() => {
    const pendentes = enriched.filter((t) => (!isRealizado(t) && t.status !== "Cancelado"));
    const hoje = pendentes.filter((t) => t.isToday).reduce((acc, t) => acc + t.bruto, 0);
    const proximos = pendentes
      .filter((t) => t.isOverdue || (t.dtVencimento >= today && t.dtVencimento <= limite10))
      .reduce((acc, t) => acc + t.bruto, 0);
    const filteredLiq = filtered.reduce((acc, t) => acc + t.liquido, 0);
    const filteredIva = filtered.reduce((acc, t) => acc + t.iva, 0);
    return {
      hojeBruto: hoje,
      proximosBruto: proximos,
      filteredLiq,
      filteredIva,
      totalPendentes: pendentes.length,
      atrasados: pendentes.filter((t) => t.isOverdue).length,
    };
  }, [enriched, filtered, today, limite10]);

  return (
    <div className="erp-content">
      <div className="kpi-row">
        <div className="kpi tone-red">
          <div className="kpi-l">A Pagar Hoje</div>
          <div className="kpi-v">{fmtEur(summary.hojeBruto)}</div>
          <div className="kpi-h">{counts.hoje} contas</div>
        </div>
        <KpiCard
          label="Próximos 10 Dias (c/ atrasos)"
          value={fmtEur(summary.proximosBruto)}
          hint={`${counts.proximos} contas · até ${fmtDate(limite10)}`}
          tone="gold"
        />
        <div className="kpi tone-neutral">
          <div className="kpi-l">Total Filtrado</div>
          <div className="kpi-v">{fmtEur(summary.filteredLiq + summary.filteredIva)}</div>
          <div className="kpi-h">Líq. {fmtEur(summary.filteredLiq)} · IVA {fmtEur(summary.filteredIva)}</div>
        </div>
        <div className="kpi tone-dark">
          <div className="kpi-l">Total Pendentes</div>
          <div className="kpi-v">{summary.totalPendentes}</div>
          <div className="kpi-h">{summary.atrasados} em atraso</div>
        </div>
      </div>

      {liquidadosCount > 0 && (
        <div className="liquidados-banner">
          <div>
            <strong>{liquidadosCount}</strong> conta{liquidadosCount > 1 ? "s" : ""} a pagar com correspondência no extrato realizado — possível duplicidade.
          </div>
          <button
            className="pill-filter"
            onClick={() => setFilter("liquidados")}
          >Ver liquidados</button>
        </div>
      )}

      <div className="pill-filters">
        {[
          { id: "proximos", label: "Próximos 10 dias", count: counts.proximos },
          { id: "hoje", label: "Vencem hoje", count: counts.hoje },
          { id: "atrasados", label: "Em atraso", count: counts.atrasados },
          { id: "depois", label: "Após 10 dias", count: counts.depois },
          { id: "liquidados", label: "Já liquidados (sugestão)", count: liquidadosCount },
          { id: "todas", label: "Todas", count: counts.todas },
        ].map((f) => (
          <button
            key={f.id}
            className={`pill-filter ${filter === f.id ? "is-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="pill-filter-count">{f.count}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card">Nenhuma conta para o filtro selecionado.</div>
      ) : (
        <div className="table-wrap">
          <table className="table receber-table">
            <thead>
              <tr>
                <th>Data Prevista</th>
                <th>Fornecedor / Descrição</th>
                <th>Categoria</th>
                <th className="num">Líquido</th>
                <th className="num">IVA</th>
                <th className="num">Bruto</th>
                <th>Estado</th>
                <th>Fatura</th>
                <th className="num">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const liq = t.liquidacao;
                const liqDate = liq?.real?.data || liq?.real?.dtVencimento;
                return (
                <tr
                  key={t.id}
                  className={`${t.isOverdue ? "row-overdue" : t.isToday ? "row-today" : ""}${liq ? " row-liquidado-sugerido" : ""}`}
                >
                  <td className={`receber-date ${t.isOverdue ? "is-overdue" : ""}`}>
                    {t.isToday ? <span className="hoje-badge">HOJE</span> : fmtDate(t.dtVencimento)}
                    {t.isOverdue && (
                      <div className="receber-desc atraso-sub">atrasada {t.diasAtraso}d</div>
                    )}
                  </td>
                  <td>
                    <div className="receber-cliente">{t.fornecedor || "—"}</div>
                    {t.descricao && <div className="receber-desc">{t.descricao}</div>}
                    {liq && (
                      <div className="liquidado-badge" title={`Possível duplicidade: tx realizada em ${fmtDate(liqDate)} · ${liq.real.fornecedor || "—"} · ${fmtEur(liq.real.valorBruto)}`}>
                        Liquidado em <strong>{fmtDate(liqDate)}</strong> · {fmtEur(liq.real.valorBruto)}
                      </div>
                    )}
                  </td>
                  <td className="muted">{t.contabGrupo || "—"}</td>
                  <td className="num muted">{t.liquido ? fmtEur(t.liquido) : "—"}</td>
                  <td className="num iva">{t.iva ? fmtEur(t.iva) : "—"}</td>
                  <td className="num strong">{fmtEur(t.bruto)}</td>
                  <td>
                    <span className={`pill pill-${t.isOverdue ? "atrasado" : (t.status || "").toLowerCase()}`}>
                      {t.isOverdue ? "Em atraso" : t.status}
                    </span>
                  </td>
                  <td>
                    <InvoiceCell tx={t} onAttach={onAttach} onView={onView} onRemove={() => onAttach(t, null)} />
                  </td>
                  <td className="row-actions">
                    {liq && (!isRealizado(t) && t.status !== "Cancelado") && (
                      <button
                        className="btn btn-tiny btn-danger"
                        onClick={() => onDelete(t.id)}
                        title="Esta conta já foi paga (lançamento realizado no extrato). Elimine para evitar duplicidade."
                      >
                        Já pago — eliminar
                      </button>
                    )}
                    {(!isRealizado(t) && t.status !== "Cancelado") && !liq && (
                      <button className="btn btn-tiny btn-gold" onClick={() => onPay(t)}>Pagar</button>
                    )}
                    <button className="btn btn-link" onClick={() => onEdit(t)}>Editar</button>
                    <button className="btn btn-link btn-link-danger" onClick={() => onDelete(t.id)}>Eliminar</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContasReceber({ txs, realizadasAll = [], onEdit, onDelete, onPay, onAttach, onView }) {
  const [filter, setFilter] = useState("pendentes");
  const [search, setSearch] = useState("");

  const today = todayISO();

  const liquidacaoByPendId = useMemo(() => {
    const map = new Map();
    const tolerancia = 0.02;
    const janelaDias = 20;
    for (const pend of txs) {
      if (isRealizado(pend) || pend.status === "Cancelado") continue;
      const valor = Math.abs(Number(pend.valorBruto) || 0);
      if (!valor) continue;
      const dtBase = pend.dtVencimento || pend.data;
      if (!dtBase) continue;
      const baseMs = new Date(dtBase + "T00:00:00").getTime();
      const cliNorm = normalizeText(pend.cliente || pend.fornecedor || "");
      const cliTokens = tokenize(pend.cliente || pend.fornecedor || "");
      let melhor = null;
      let melhorScore = -1;
      for (const real of realizadasAll) {
        if (real.id === pend.id) continue;
        if (real.origem === "saldo-ancora") continue;
        const vReal = Math.abs(Number(real.valorBruto) || 0);
        if (Math.abs(vReal - valor) > tolerancia) continue;
        const dReal = real.data || real.dtVencimento || "";
        if (!dReal) continue;
        const realMs = new Date(dReal + "T00:00:00").getTime();
        const deltaDias = Math.abs(realMs - baseMs) / (1000 * 60 * 60 * 24);
        if (deltaDias > janelaDias) continue;
        const realCli = normalizeText(real.cliente || real.fornecedor || "");
        const realTokens = tokenize(real.cliente || real.fornecedor || "");
        let cliScore = 0;
        if (cliNorm && realCli) {
          if (cliNorm === realCli) cliScore = 1;
          else if (cliNorm.includes(realCli) || realCli.includes(cliNorm)) cliScore = 0.8;
          else cliScore = jaccardScore(cliTokens, realTokens);
        }
        const score = cliScore - deltaDias / janelaDias * 0.3;
        if (score > melhorScore) {
          melhorScore = score;
          melhor = { real, deltaDias, cliScore };
        }
      }
      if (melhor && melhor.cliScore >= 0.4) {
        map.set(pend.id, melhor);
      }
    }
    return map;
  }, [txs, realizadasAll]);

  const enriched = useMemo(() => {
    return txs.map((t) => {
      const bruto = Number(t.valorBruto) || 0;
      const liquido = Number(t.valorLiquido) || bruto;
      const iva = Math.max(0, bruto - liquido);
      const overdue = isPendente(t) && t.dtVencimento && t.dtVencimento < today;
      const liquidacao = liquidacaoByPendId.get(t.id);
      return {
        ...t,
        bruto,
        liquido,
        iva,
        statusEffective: overdue ? "Atrasado" : t.status,
        liquidacao,
      };
    });
  }, [txs, today, liquidacaoByPendId]);

  const liquidadosCount = useMemo(
    () => enriched.filter((t) => t.liquidacao && t.statusEffective !== "Pago" && t.statusEffective !== "Cancelado").length,
    [enriched]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((t) => {
        if (filter === "liquidados") return !!t.liquidacao && t.statusEffective !== "Pago" && t.statusEffective !== "Cancelado";
        if (filter === "pendentes") return t.statusEffective !== "Pago" && t.statusEffective !== "Cancelado";
        if (filter === "pagos") return t.statusEffective === "Pago";
        if (filter === "atrasados") return t.statusEffective === "Atrasado";
        return true;
      })
      .filter((t) => {
        if (!q) return true;
        return [t.cliente, t.descricao, t.fatura, t.contabGrupo]
          .some((v) => (v || "").toLowerCase().includes(q));
      })
      .sort((a, b) => (a.dtVencimento || "").localeCompare(b.dtVencimento || ""));
  }, [enriched, filter, search]);

  const summary = useMemo(() => {
    const pendentes = enriched.filter((t) => t.statusEffective !== "Pago" && t.statusEffective !== "Cancelado");
    return {
      totalReceber: pendentes.reduce((acc, t) => acc + t.bruto, 0),
      totalLiquido: pendentes.reduce((acc, t) => acc + t.liquido, 0),
      totalIva: pendentes.reduce((acc, t) => acc + t.iva, 0),
      countPendentes: pendentes.length,
    };
  }, [enriched]);

  return (
    <div className="erp-content">
      <div className="kpi-row">
        <KpiCard
          label="Total a Receber"
          value={fmtEur(summary.totalReceber)}
          hint="bruto pendente"
          tone="gold"
        />
        <div className="kpi tone-neutral">
          <div className="kpi-l">Valor Líquido</div>
          <div className="kpi-v">{fmtEur(summary.totalLiquido)}</div>
          <div className="kpi-h">após IVA</div>
        </div>
        <KpiCard
          label="IVA Liquidado"
          value={fmtEur(summary.totalIva)}
          hint="a entregar ao Estado"
          tone="gold"
        />
        <div className="kpi tone-dark">
          <div className="kpi-l">Nº Faturas Pendentes</div>
          <div className="kpi-v">{summary.countPendentes}</div>
          <div className="kpi-h">contas em aberto</div>
        </div>
      </div>

      {liquidadosCount > 0 && (
        <div className="liquidados-banner">
          <div>
            <strong>{liquidadosCount}</strong> conta{liquidadosCount > 1 ? "s" : ""} a receber com correspondência no extrato realizado — possível duplicidade.
          </div>
          <button
            className="pill-filter"
            onClick={() => setFilter("liquidados")}
          >Ver liquidados</button>
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-tabs">
          {[
            { id: "pendentes", label: "Pendentes" },
            { id: "atrasados", label: "Atrasados" },
            { id: "liquidados", label: `Já liquidados${liquidadosCount > 0 ? ` (${liquidadosCount})` : ""}` },
            { id: "pagos", label: "Recebidos" },
            { id: "todos", label: "Todos" },
          ].map((f) => (
            <button
              key={f.id}
              className={`filter-tab ${filter === f.id ? "is-active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="filter-field" style={{ flex: 1 }}>
          <label>Buscar</label>
          <input
            type="text"
            value={search}
            placeholder="Cliente, descrição, fatura..."
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-meta-info">{filtered.length} resultados</div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card">
          <div className="empty-card-title">Nenhuma conta encontrada</div>
          <p>
            Use <strong>+ Conta a Receber</strong> para criar manualmente ou <strong>Upload de Fatura</strong> para criar uma a partir de um PDF/imagem.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table receber-table">
            <thead>
              <tr>
                <th>Data Prevista</th>
                <th>Cliente / Descrição</th>
                <th>Emissão</th>
                <th className="num">Líquido</th>
                <th className="num">IVA</th>
                <th className="num">Bruto</th>
                <th>Estado</th>
                <th>Fatura</th>
                <th className="num">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const overdue = t.statusEffective === "Atrasado";
                const liq = t.liquidacao;
                const liqDate = liq?.real?.data || liq?.real?.dtVencimento;
                return (
                  <tr key={t.id} className={liq ? "row-liquidado-sugerido" : ""}>
                    <td className={`receber-date ${overdue ? "is-overdue" : ""}`}>
                      {fmtDate(t.dtVencimento) || "—"}
                    </td>
                    <td>
                      <div className="receber-cliente">{t.cliente || "—"}</div>
                      {t.descricao && <div className="receber-desc">{t.descricao}</div>}
                      {liq && (
                        <div className="liquidado-badge" title={`Possível duplicidade: tx realizada em ${fmtDate(liqDate)} · ${liq.real.cliente || liq.real.fornecedor || "—"} · ${fmtEur(liq.real.valorBruto)}`}>
                          Recebido em <strong>{fmtDate(liqDate)}</strong> · {fmtEur(liq.real.valorBruto)}
                        </div>
                      )}
                    </td>
                    <td className="muted">{fmtDate(t.dtEmissao) || "—"}</td>
                    <td className="num muted">{t.liquido ? fmtEur(t.liquido) : "—"}</td>
                    <td className="num iva">{t.iva ? fmtEur(t.iva) : "—"}</td>
                    <td className="num strong">{fmtEur(t.bruto)}</td>
                    <td>
                      <span className={`pill pill-${overdue ? "atrasado" : (t.status || "").toLowerCase()}`}>
                        {overdue ? "Em atraso" : (t.status || "—")}
                      </span>
                    </td>
                    <td>
                      <InvoiceCell tx={t} onAttach={onAttach} onView={onView} onRemove={() => onAttach(t, null)} />
                    </td>
                    <td className="row-actions">
                      {liq && t.statusEffective !== "Pago" && t.statusEffective !== "Cancelado" && (
                        <button
                          className="btn btn-tiny btn-danger"
                          onClick={() => onDelete(t.id)}
                          title="Esta conta já foi recebida (lançamento realizado no extrato). Elimine para evitar duplicidade."
                        >
                          Já recebido — eliminar
                        </button>
                      )}
                      {!liq && t.statusEffective !== "Pago" && t.statusEffective !== "Cancelado" && (
                        <button className="btn btn-tiny btn-gold" onClick={() => onPay(t)}>Receber</button>
                      )}
                      <button className="btn btn-link" onClick={() => onEdit(t)}>Editar</button>
                      <button className="btn btn-link btn-link-danger" onClick={() => onDelete(t.id)}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function normalizeHeader(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const FLUXO_HEADER_MAP = {
  data: ["data"],
  competencia: ["competencia"],
  formaPagamento: ["forma"],
  actPlan: ["act_plan", "actplan", "act"],
  dtEmissao: ["dt_emissao", "dtemissao", "data_emissao"],
  dtVencimento: ["dt_vencimento", "dtvencimento", "data_vencimento", "vencimento"],
  fatura: ["fatura_doc", "fatura", "documento", "doc"],
  fornecedor: ["fornecedor"],
  status: ["status"],
  cliente: ["cliente"],
  descricao: ["descricao"],
  originadorComissao: ["originador_comissao", "originador"],
  comentarios: ["comentarios", "observacoes", "obs"],
  contabGrupo: ["contab_grupo", "grupo_contabil"],
  classifContabGrupo: ["classif_contab_grupo", "classif_contab", "classificacao_contabil"],
  contabSubGrupo: ["contab_sub_grupo", "sub_grupo", "subgrupo"],
  pl: ["p_l", "pl", "p&l"],
  produto: ["produto"],
  pontualRecorrente: ["pontual_recorrente", "pontual"],
  fixoVariavel: ["fixo_variavel", "fixo"],
  iva: ["iva"],
  mesCaixa: ["mes_caixa"],
  dataCaixa: ["data_caixa"],
  valorBruto: ["vl_bruto_cgd", "vl_bruto", "valor_bruto", "bruto"],
  valorRetencao: ["vl_retencao_cgd", "vl_retencao", "valor_retencao", "retencao"],
  valorLiquido: ["vl_liquido_cgd", "vl_liquido", "valor_liquido", "liquido"],
  valorSaldo: ["vl_saldo_cgd", "vl_saldo", "valor_saldo", "saldo"],
  valorSaldoSemIva: ["vl_saldo_s_iva", "saldo_sem_iva", "vl_saldo_sem_iva"],
  valorSaldoSemLegadoIva: ["vl_saldo_s_legado_e_iva", "saldo_sem_legado_iva", "vl_saldo_sem_legado_iva"],
  ivaTrProjetado: ["iva_tr_projetado", "iva_projetado"],
};

function matchFluxoColumn(headerNormalized, candidates) {
  for (const cand of candidates) {
    const idx = headerNormalized.findIndex((h) => h === cand);
    if (idx >= 0) return idx;
  }
  for (const cand of candidates) {
    const idx = headerNormalized.findIndex((h) => h.includes(cand));
    if (idx >= 0) return idx;
  }
  return -1;
}

const FLUXO_MAX_COL_INDEX = 29;
const FLUXO_SHEET_PATTERNS = [
  /fluxo.*caixa.*conex/i,
];

function isFluxoConexaoSheet(sheetName) {
  const n = String(sheetName || "").trim();
  return FLUXO_SHEET_PATTERNS.some((rx) => rx.test(n));
}

function fixYearAgainst(targetIso, refIso) {
  if (!targetIso || !refIso || targetIso.length < 10 || refIso.length < 10) {
    return { fixed: targetIso, mismatch: false };
  }
  const ty = targetIso.slice(0, 4);
  const ry = refIso.slice(0, 4);
  if (ty === ry) return { fixed: targetIso, mismatch: false };
  return { fixed: ry + targetIso.slice(4), mismatch: true };
}

async function parseFluxoCaixaXlsx(buffer) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const out = [];
  const targetSheets = wb.SheetNames.filter(isFluxoConexaoSheet);
  if (!targetSheets.length) {
    throw new Error(
      `Aba "FLUXO DE CAIXA CONEXÃO" não encontrada. Abas disponíveis: ${wb.SheetNames.join(", ")}`
    );
  }
  for (const sheetName of targetSheets) {
    const sheet = wb.Sheets[sheetName];
    const fullData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (!fullData.length) continue;
    const data = fullData.map((row) => Array.isArray(row) ? row.slice(0, FLUXO_MAX_COL_INDEX) : row);

    let headerIdx = -1;
    let header = null;
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i].map(normalizeHeader);
      const hits = ["data", "fornecedor", "vl_bruto", "contab_grupo", "competencia"]
        .filter((k) => row.some((c) => c.includes(k))).length;
      if (hits >= 3) {
        headerIdx = i;
        header = row;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const cols = {};
    for (const [key, candidates] of Object.entries(FLUXO_HEADER_MAP)) {
      cols[key] = matchFluxoColumn(header, candidates);
    }

    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => String(c || "").trim() === "")) continue;

      const dataIso = cols.data >= 0 ? parseDateAny(row[cols.data]) : null;
      const dtEmissaoIsoRaw = cols.dtEmissao >= 0 ? parseDateAny(row[cols.dtEmissao]) : null;
      const dtVencimentoIsoRaw = cols.dtVencimento >= 0 ? parseDateAny(row[cols.dtVencimento]) : null;
      const baseData = dataIso || dtEmissaoIsoRaw || dtVencimentoIsoRaw || todayISO();
      const yearMismatches = [];
      const dtEmissaoFix = fixYearAgainst(dtEmissaoIsoRaw, baseData);
      if (dtEmissaoFix.mismatch) yearMismatches.push(`dt_emissao ${dtEmissaoIsoRaw} → ${dtEmissaoFix.fixed}`);
      const dtVencimentoFix = fixYearAgainst(dtVencimentoIsoRaw, baseData);
      if (dtVencimentoFix.mismatch) yearMismatches.push(`dt_vencimento ${dtVencimentoIsoRaw} → ${dtVencimentoFix.fixed}`);
      const dtEmissaoIso = dtEmissaoFix.fixed;
      const dtVencimentoIso = dtVencimentoFix.fixed;

      const formaPagRaw = cols.formaPagamento >= 0 ? String(row[cols.formaPagamento] || "").trim() : "";
      const formaPagamento = /cart[aã]o|credit/i.test(formaPagRaw) ? "Cartão de Crédito" :
                             /banco|cgd|transf/i.test(formaPagRaw) ? "Banco" :
                             formaPagRaw || "Banco";

      const statusRaw = cols.status >= 0 ? String(row[cols.status] || "").trim() : "";
      const naLower = statusRaw.toLowerCase();
      let status = "";
      if (/recebid/i.test(naLower)) status = "Recebido";
      else if (/^pago$|paid|liquidad/i.test(naLower)) status = "Pago";
      else if (/a\s*receber/i.test(naLower)) status = "A receber";
      else if (/a\s*pagar/i.test(naLower)) status = "A pagar";
      else if (/planejad|projetad|previst/i.test(naLower)) status = "Planejado";
      else if (/atrasad|vencid|overdue/i.test(naLower)) status = "Atrasado";
      else if (/cancel|anulad/i.test(naLower)) status = "Cancelado";
      else if (/pendente|aberto|open/i.test(naLower)) status = "Pendente";

      const contabGrupoRaw = cols.contabGrupo >= 0 ? String(row[cols.contabGrupo] || "").trim() : "";
      const contabGrupo = CONTAB_GRUPO_OPTIONS.find(
        (g) => g.toLowerCase() === contabGrupoRaw.toLowerCase()
      ) || contabGrupoRaw;
      const classifFromSheet = cols.classifContabGrupo >= 0 ? String(row[cols.classifContabGrupo] || "").trim() : "";
      const classifContabGrupo = classifFromSheet || deriveClassifContab(contabGrupo);

      const competenciaRaw = cols.competencia >= 0 ? String(row[cols.competencia] || "").trim() : "";
      let competencia = competenciaFromAny(competenciaRaw) || baseData.slice(0, 7);
      if (/^\d{4}-\d{2}/.test(competencia) && competencia.slice(0, 4) !== baseData.slice(0, 4)) {
        const before = competencia;
        competencia = baseData.slice(0, 4) + competencia.slice(4);
        yearMismatches.push(`competencia ${before} → ${competencia}`);
      }

      const valorBrutoRaw = cols.valorBruto >= 0 ? parseAmount(row[cols.valorBruto]) : 0;
      const valorBrutoSign = Math.sign(valorBrutoRaw) || 0;
      const valorBruto = Math.abs(valorBrutoRaw);
      const valorRetencao = Math.abs(cols.valorRetencao >= 0 ? parseAmount(row[cols.valorRetencao]) : 0);
      const valorLiquido = Math.abs(cols.valorLiquido >= 0 ? parseAmount(row[cols.valorLiquido]) : (valorBruto - valorRetencao));
      const valorSaldo = cols.valorSaldo >= 0 ? parseAmount(row[cols.valorSaldo]) : 0;
      const valorSaldoSemIva = cols.valorSaldoSemIva >= 0 ? parseAmount(row[cols.valorSaldoSemIva]) : 0;
      const valorSaldoSemLegadoIva = cols.valorSaldoSemLegadoIva >= 0 ? parseAmount(row[cols.valorSaldoSemLegadoIva]) : 0;
      const ivaTrProjetado = cols.ivaTrProjetado >= 0 ? parseAmount(row[cols.ivaTrProjetado]) : 0;

      const fornecedorRaw = cols.fornecedor >= 0 ? String(row[cols.fornecedor] || "").trim() : "";
      const clienteRaw = cols.cliente >= 0 ? String(row[cols.cliente] || "").trim() : "";
      const fornecedor = /^n\/?a$/i.test(fornecedorRaw) ? "" : fornecedorRaw;
      const cliente = /^n\/?a$/i.test(clienteRaw) ? "" : clienteRaw;
      const descricao = cols.descricao >= 0 ? String(row[cols.descricao] || "").trim() : "";

      if (!valorBruto || Math.abs(valorBruto) < 0.005) continue;

      let forma = "Despesa";
      if (valorBrutoSign > 0 && (cliente || /receita|recebid|a\s*receber/i.test(naLower))) forma = "Receita";
      else if (valorBrutoSign < 0) forma = "Despesa";
      else if (cliente && !fornecedor) forma = "Receita";
      else if (fornecedor && !cliente) forma = "Despesa";
      else if (/receita|recebid|a\s*receber/i.test(naLower)) forma = "Receita";
      else if (CLASSIF_CONTAB_BY_GRUPO[contabGrupo]?.startsWith("01") || CLASSIF_CONTAB_BY_GRUPO[contabGrupo]?.startsWith("06") || CLASSIF_CONTAB_BY_GRUPO[contabGrupo]?.startsWith("09")) forma = "Receita";

      if (!status) status = forma === "Receita" ? "A receber" : "A pagar";

      const actPlanRaw = cols.actPlan >= 0 ? String(row[cols.actPlan] || "").trim() : "";
      const actPlan = /act/i.test(actPlanRaw) ? "Act" :
                      /plan/i.test(actPlanRaw) ? "Plan" :
                      deriveActPlan(status);

      const plRaw = cols.pl >= 0 ? String(row[cols.pl] || "").trim() : "";
      const pl = PL_OPTIONS.find((p) => p.toLowerCase() === plRaw.toLowerCase()) || plRaw || "Principal";

      const subGrupoRaw = cols.contabSubGrupo >= 0 ? String(row[cols.contabSubGrupo] || "").trim() : "";
      const contabSubGrupo = CONTAB_SUBGRUPO_OPTIONS.find(
        (s) => s.toLowerCase() === subGrupoRaw.toLowerCase()
      ) || subGrupoRaw;

      const ivaRaw = cols.iva >= 0 ? String(row[cols.iva] || "").trim() : "";
      const iva = /^s|sim|yes|true|1$/i.test(ivaRaw) ? "Sim" :
                  /^n|nao|no|false|0$/i.test(ivaRaw) ? "Não" :
                  ivaRaw;

      const fixoRaw = cols.fixoVariavel >= 0 ? String(row[cols.fixoVariavel] || "").trim() : "";
      const fixoVariavel = /fix/i.test(fixoRaw) ? "Fixa" :
                           /vari/i.test(fixoRaw) ? "Variável" :
                           fixoRaw;

      const pontualRaw = cols.pontualRecorrente >= 0 ? String(row[cols.pontualRecorrente] || "").trim() : "";
      const pontualRecorrente = /recorrent/i.test(pontualRaw) ? "Recorrente" :
                                /pontual/i.test(pontualRaw) ? "Pontual" :
                                pontualRaw;

      const faturaRaw = cols.fatura >= 0 ? String(row[cols.fatura] || "").trim() : "";
      const fatura = faturaRaw || "N/A";

      const basePayload = {
        data: baseData,
        competencia,
        forma,
        formaPagamento,
        actPlan,
        dtEmissao: dtEmissaoIso || baseData,
        dtVencimento: dtVencimentoIso || baseData,
        fatura,
        fornecedor,
        status,
        cliente,
        descricao,
        originadorComissao: cols.originadorComissao >= 0 ? String(row[cols.originadorComissao] || "").trim() : "",
        comentarios: cols.comentarios >= 0 ? String(row[cols.comentarios] || "").trim() : "",
        contabGrupo,
        classifContabGrupo,
        contabSubGrupo,
        pl,
        produto: cols.produto >= 0 ? String(row[cols.produto] || "").trim() : "",
        pontualRecorrente,
        fixoVariavel,
        iva,
        valorBruto,
        valorRetencao,
        valorLiquido,
        valorSaldo,
        valorSaldoSemIva,
        valorSaldoSemLegadoIva,
        ivaTrProjetado,
        origem: "fluxo-caixa",
      };
      const correctedPayload = applyAllRules(basePayload);
      const plCorrected = correctedPayload.pl !== basePayload.pl;
      out.push({
        raw: { data: baseData, descricao: descricao || fornecedor || cliente, amount: valorBruto },
        yearMismatches,
        legadoCorrected: plCorrected ? correctedPayload.legadoCanal : null,
        payload: correctedPayload,
      });
    }
  }
  return out;
}

async function parseToconlineXlsx(buffer) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const out = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (!data.length) continue;
    let headerIdx = -1;
    let header = null;
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i].map((c) => String(c || "").toLowerCase());
      if (row.some((c) => c.includes("cliente") || c.includes("entidade")) &&
          row.some((c) => c.includes("total") || c.includes("valor"))) {
        headerIdx = i;
        header = row;
        break;
      }
    }
    if (headerIdx < 0) continue;
    const findCol = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const cols = {
      data: findCol("data emiss", "data documento", "data"),
      vencimento: findCol("vencim"),
      fatura: findCol("documento", "número", "numero", "nº"),
      cliente: findCol("cliente", "entidade"),
      descricao: findCol("descri", "observa"),
      liquido: findCol("líquido", "liquido", "incidência", "incidencia", "valor s/iva"),
      iva: findCol("iva", "imposto"),
      bruto: findCol("total", "valor c/iva", "bruto"),
      estado: findCol("estado", "status"),
    };
    if (cols.cliente < 0 || cols.bruto < 0) continue;

    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      const cliente = String(row[cols.cliente] || "").trim();
      if (!cliente) continue;
      const bruto = parseAmount(row[cols.bruto]);
      if (!bruto) continue;
      const liquido = cols.liquido >= 0 ? parseAmount(row[cols.liquido]) : bruto;
      const dataEmissao = parseDateAny(row[cols.data]) || todayISO();
      const dtVencimento = parseDateAny(row[cols.vencimento]) || dataEmissao;
      const estadoRaw = cols.estado >= 0 ? String(row[cols.estado] || "").toLowerCase() : "";
      let status = "Pendente";
      if (estadoRaw.includes("pag") || estadoRaw.includes("liquidad")) status = "Pago";
      else if (estadoRaw.includes("anulad") || estadoRaw.includes("cancel")) status = "Cancelado";

      out.push({
        raw: { data: dataEmissao, descricao: cliente, amount: bruto },
        payload: {
          data: dataEmissao,
          competencia: dataEmissao.slice(0, 7),
          dtEmissao: dataEmissao,
          dtVencimento,
          forma: "Receita",
          status,
          fatura: String(row[cols.fatura] || "").trim(),
          cliente,
          descricao: cols.descricao >= 0 ? String(row[cols.descricao] || "").trim() : "",
          contabGrupo: "TOConline",
          pl: "Principal",
          valorBruto: bruto,
          valorLiquido: liquido || bruto,
          origem: "toconline",
        },
      });
    }
  }
  return out;
}

function parseToconlineCsv(text) {
  const cleaned = text.replace(/^﻿/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV vazio ou inválido.");
  const delim = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const findCol = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const cols = {
    data: findCol("data emiss", "data documento", "data"),
    vencimento: findCol("vencim"),
    fatura: findCol("documento", "número", "numero", "nº"),
    cliente: findCol("cliente", "entidade"),
    descricao: findCol("descri", "observa"),
    liquido: findCol("líquido", "liquido", "incidência", "incidencia", "valor s/iva"),
    iva: findCol("iva", "imposto"),
    bruto: findCol("total", "valor c/iva", "bruto"),
    estado: findCol("estado", "status"),
  };
  if (cols.cliente < 0 || cols.bruto < 0) {
    throw new Error("CSV não parece ser do TOConline (faltam colunas Cliente/Total).");
  }
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i], delim);
    const cliente = (row[cols.cliente] || "").trim();
    if (!cliente) continue;
    const bruto = parseAmount(row[cols.bruto]);
    if (!bruto) continue;
    const liquido = cols.liquido >= 0 ? parseAmount(row[cols.liquido]) : bruto;
    const dataEmissao = parseDateAny(row[cols.data]) || todayISO();
    const dtVencimento = parseDateAny(row[cols.vencimento]) || dataEmissao;
    const estadoRaw = cols.estado >= 0 ? (row[cols.estado] || "").toLowerCase() : "";
    let status = "Pendente";
    if (estadoRaw.includes("pag") || estadoRaw.includes("liquidad")) status = "Pago";
    else if (estadoRaw.includes("anulad") || estadoRaw.includes("cancel")) status = "Cancelado";
    out.push({
      raw: { data: dataEmissao, descricao: cliente, amount: bruto },
      payload: {
        data: dataEmissao,
        competencia: dataEmissao.slice(0, 7),
        dtEmissao: dataEmissao,
        dtVencimento,
        forma: "Receita",
        status,
        fatura: (row[cols.fatura] || "").trim(),
        cliente,
        descricao: cols.descricao >= 0 ? (row[cols.descricao] || "").trim() : "",
        contabGrupo: "TOConline",
        pl: "Principal",
        valorBruto: bruto,
        valorLiquido: liquido || bruto,
        origem: "toconline",
      },
    });
  }
  return out;
}

function Clientes({ clientes, txs, onNew, onEdit, onDelete, onImportXlsx, onAutoImport, onViewHistory }) {
  const xlsxRef = useRef(null);
  const [search, setSearch] = useState("");
  const [pl, setPl] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [produtoFilter, setProdutoFilter] = useState("");
  const [ltvMin, setLtvMin] = useState("");
  const [ltvMax, setLtvMax] = useState("");
  const [modDesde, setModDesde] = useState("");
  const [page, setPage] = useState(1);
  const [viewingCliente, setViewingCliente] = useState(null);
  const PAGE_SIZE = 25;
  useEffect(() => {
    setPage(1);
  }, [search, pl, statusFilter, produtoFilter, ltvMin, ltvMax, modDesde]);

  const stats = useMemo(() => {
    const map = new Map();
    for (const t of txs) {
      if (t.forma !== "Receita" || !t.cliente) continue;
      const k = normalizeName(t.cliente);
      if (!k) continue;
      const existing = map.get(k) || { totalReceita: 0, ultimoLancamento: null, primeiroLancamento: null, count: 0 };
      existing.totalReceita += Number(t.valorBruto) || 0;
      existing.count += 1;
      if (!existing.ultimoLancamento || (t.data || "") > existing.ultimoLancamento) {
        existing.ultimoLancamento = t.data;
      }
      if (!existing.primeiroLancamento || (t.data || "") < existing.primeiroLancamento) {
        existing.primeiroLancamento = t.data;
      }
      map.set(k, existing);
    }
    for (const [k, s] of map) {
      s.ltv = s.totalReceita;
      if (s.primeiroLancamento && s.ultimoLancamento) {
        const d1 = new Date(s.primeiroLancamento);
        const d2 = new Date(s.ultimoLancamento);
        const meses = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24 * 30.4375)) + 1);
        s.ltvMensal = s.totalReceita / meses;
        s.mesesAtivo = meses;
      } else {
        s.ltvMensal = 0;
        s.mesesAtivo = 0;
      }
    }
    return map;
  }, [txs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = parseFloat(ltvMin) || -Infinity;
    const max = parseFloat(ltvMax) || Infinity;
    return [...clientes]
      .filter((c) => !pl || c.pl === pl)
      .filter((c) => !statusFilter || (c.status || "ativo") === statusFilter)
      .filter((c) => !produtoFilter || (Array.isArray(c.produtos) && c.produtos.includes(produtoFilter)))
      .filter((c) => {
        if (!modDesde) return true;
        const ref = (c.updatedAt || c.createdAt || "").slice(0, 10);
        return ref && ref >= modDesde;
      })
      .filter((c) => {
        if (!q) return true;
        return [c.nome, c.nif, c.email, c.telefone, c.telemovel, c.originadorComissao]
          .some((v) => (v || "").toLowerCase().includes(q));
      })
      .filter((c) => {
        if (min === -Infinity && max === Infinity) return true;
        const k = normalizeName(c.nome);
        const s = stats.get(k);
        const ltv = s ? s.ltv : 0;
        return ltv >= min && ltv <= max;
      })
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [clientes, search, pl, statusFilter, produtoFilter, ltvMin, ltvMax, modDesde, stats]);

  const totalConexao = clientes.filter((c) => c.pl === "Principal").length;
  const totalLegado = clientes.filter((c) => c.pl === "Legado").length;

  function handleFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onImportXlsx(f);
  }

  const pagedTotal = filtered.length;
  const totalPages = Math.max(1, Math.ceil(pagedTotal / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="erp-content">
      <div className="erp-toolbar" style={{ alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>Carteira de Clientes</h2>
        <input
          ref={xlsxRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ display: "none" }}
          onChange={handleFile}
        />
        <button className="btn btn-light" onClick={() => xlsxRef.current?.click()}>
          Importar da Planilha 2026
        </button>
        {onAutoImport && (
          <button
            className="btn btn-light"
            onClick={onAutoImport}
            title="Varre as transações de Receita e cria automaticamente: clientes (com PL e tipo inferidos via regras Legado/AL) e apartamentos AL na aba Carteira. Datas, e-mails e originadores extraídos quando disponíveis."
          >
            Importar das transações
          </button>
        )}
        <button className="btn btn-gold" onClick={onNew}>+ Adicionar Cliente</button>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total de Clientes" value={clientes.length} hint={`${filtered.length} listados`} tone="gold" />
        <KpiCard label="Principal" value={totalConexao} hint="P&L Principal" tone="gold" />
        <KpiCard label="Legado" value={totalLegado} hint="P&L Legado" tone="gold" />
      </div>

      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        <div className="filter-field" style={{ flex: 1, minWidth: 220 }}>
          <label>Buscar</label>
          <input
            type="text"
            value={search}
            placeholder="Nome, NIF, e-mail, telefone, originador..."
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label>P&L</label>
          <select value={pl} onChange={(e) => setPl(e.target.value)}>
            <option value="">Todos</option>
            {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Produto</label>
          <select value={produtoFilter} onChange={(e) => setProdutoFilter(e.target.value)}>
            <option value="">Todos</option>
            {PRODUTO_CLIENTE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>LTV min (€)</label>
          <input type="number" step="0.01" value={ltvMin} placeholder="0" onChange={(e) => setLtvMin(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>LTV máx (€)</label>
          <input type="number" step="0.01" value={ltvMax} placeholder="∞" onChange={(e) => setLtvMax(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Modificado desde</label>
          <input type="date" value={modDesde} onChange={(e) => setModDesde(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card">
          <div className="empty-card-title">Nenhum cliente {clientes.length === 0 ? "cadastrado" : "encontrado"}</div>
          <p>
            {clientes.length === 0
              ? "Clique em + Novo Cliente ou Importar da Planilha 2026 para começar."
              : "Ajuste os filtros para encontrar clientes."}
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>CLIENTE</th>
                  <th>STATUS</th>
                  <th>P&amp;L</th>
                  <th>TIPO</th>
                  <th>CONTATO</th>
                  <th>DATA INÍCIO</th>
                  <th>ÚLTIMA TRANSAÇÃO</th>
                  <th className="num">LTV</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((c, idx) => {
                  const k = normalizeName(c.nome);
                  const s = stats.get(k);
                  const status = c.status || "ativo";
                  const statusLabel = status === "ativo" ? "Ativo" : status === "inativo" ? "Inativo" : "Prospect";
                  const idShort = c.id ? String(c.id).slice(-6).toUpperCase() : String(pageStart + idx + 1).padStart(4, "0");
                  const contato = c.email || c.telemovel || c.telefone || "";
                  return (
                    <tr key={c.id}>
                      <td className="muted" title={c.id} style={{ fontFamily: "monospace", fontSize: 11 }}>{idShort}</td>
                      <td className="strong">
                        <button
                          type="button"
                          className="cliente-name-link"
                          onClick={() => setViewingCliente(c)}
                          title="Ver resumo financeiro e histórico de transações"
                        >
                          {c.nome}
                        </button>
                      </td>
                      <td>
                        <span className={`status-pill status-${status}`}>{statusLabel}</span>
                        {c.autoInactivatedAt && status === "inativo" && (
                          <span
                            className="auto-inativo-flag"
                            title={`Inativado automaticamente em ${fmtDate(c.autoInactivatedAt)} · última receita ${c.autoInactivatedLastReceita ? fmtDate(c.autoInactivatedLastReceita) : "—"} (> 2 anos sem receita)`}
                          >auto</span>
                        )}
                      </td>
                      <td><span className={`pl-tag pl-${(c.pl || "").toLowerCase()}`}>{c.pl || "—"}</span></td>
                      <td>{c.tipo ? <span className={`pill-tipo pill-tipo-${(c.tipo || "").toLowerCase()}`}>{c.tipo}</span> : "—"}</td>
                      <td>
                        {c.email
                          ? <a href={`mailto:${c.email}`} className="link">{c.email}</a>
                          : (contato || "—")}
                      </td>
                      <td>{c.dataInicio ? fmtDate(c.dataInicio) : "—"}</td>
                      <td>{s?.ultimoLancamento ? fmtDate(s.ultimoLancamento) : "—"}</td>
                      <td className="num strong" title={s ? `${s.count} lançamento(s) · ${s.mesesAtivo} mês(es) ativo · LTV/mês ${fmtEur(s.ltvMensal)}` : ""}>
                        {s ? fmtEur(s.ltv) : "—"}
                      </td>
                      <td className="row-actions">
                        <button className="icon-btn" onClick={() => onEdit(c)} title="Editar">✎</button>
                        {onViewHistory && (
                          <button className="icon-btn" onClick={() => onViewHistory(c)} title="Ver histórico no Fluxo de Caixa">📊</button>
                        )}
                        <button className="icon-btn danger" onClick={() => onDelete(c.id)} title="Excluir">🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-light btn-tiny"
                disabled={currentPage === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Anterior
              </button>
              <span className="pagination-info">
                Página {currentPage} de {totalPages} · {pagedTotal} cliente(s)
              </span>
              <button
                className="btn btn-light btn-tiny"
                disabled={currentPage === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}

      {viewingCliente && (
        <ClienteResumoModal
          cliente={viewingCliente}
          txs={txs}
          onClose={() => setViewingCliente(null)}
        />
      )}
    </div>
  );
}

function ClienteResumoModal({ cliente, txs, onClose }) {
  const target = normalizeName(cliente.nome);
  const clienteTxs = useMemo(() => {
    return txs
      .filter((t) => {
        if (t.status === "Cancelado") return false;
        const k1 = normalizeName(t.cliente);
        const k2 = normalizeName(t.fornecedor);
        return k1 === target || k2 === target;
      })
      .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  }, [txs, target]);

  const summary = useMemo(() => {
    let receitas = 0, despesas = 0, receitasNop = 0, despesasNop = 0;
    for (const t of clienteTxs) {
      const v = Math.abs(Number(t.valorBruto) || 0);
      const grupo = t.contabGrupo || "";
      if (t.forma === "Receita") {
        if (grupo === "Receita NOP") receitasNop += v;
        else receitas += v;
      } else if (t.forma === "Despesa") {
        if (grupo === "Despesa NOP") despesasNop += v;
        else despesas += v;
      }
    }
    return { receitas, despesas, receitasNop, despesasNop, lucroBruto: receitas - despesas };
  }, [clienteTxs]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{cliente.nome}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="resumo-cliente">
            <div className="resumo-card resumo-receita">
              <div className="resumo-label">Receitas</div>
              <div className="resumo-value">{fmtEur(summary.receitas)}</div>
              {summary.receitasNop > 0 && (
                <div className="resumo-sub muted">+ {fmtEur(summary.receitasNop)} em reembolsos (NOP — não contabilizados)</div>
              )}
            </div>
            <div className="resumo-card resumo-despesa">
              <div className="resumo-label">Despesas</div>
              <div className="resumo-value">{fmtEur(summary.despesas)}</div>
              {summary.despesasNop > 0 && (
                <div className="resumo-sub muted">+ {fmtEur(summary.despesasNop)} reembolsadas (NOP — excluídas)</div>
              )}
            </div>
            <div className="resumo-card resumo-lucro">
              <div className="resumo-label">Lucro Bruto</div>
              <div className={`resumo-value ${summary.lucroBruto >= 0 ? "is-gold" : "is-out"}`}>
                {fmtEur(summary.lucroBruto)}
              </div>
              <div className="resumo-sub muted">Receitas − Despesas (excluindo NOP)</div>
            </div>
          </div>

          <div className="resumo-section-title">
            Histórico de transações · {clienteTxs.length} lançamento(s)
          </div>
          {clienteTxs.length === 0 ? (
            <div className="empty-pad">Nenhum lançamento encontrado para este cliente.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Forma</th>
                    <th>Status</th>
                    <th>Sub-Grupo</th>
                    <th>Descrição</th>
                    <th className="num">Valor Bruto</th>
                  </tr>
                </thead>
                <tbody>
                  {clienteTxs.map((t) => {
                    const isNop = (t.contabGrupo || "").includes("NOP");
                    const sinal = t.forma === "Receita" ? "+" : "−";
                    return (
                      <tr key={t.id} className={isNop ? "tx-row-nop" : ""}>
                        <td>{t.data ? fmtDate(t.data) : "—"}</td>
                        <td>
                          <span className={`pill-forma pill-forma-${(t.forma || "").toLowerCase()}`}>{t.forma}</span>
                          {isNop && <span className="auto-inativo-flag" title="Reembolso (NOP) — excluído do lucro">NOP</span>}
                        </td>
                        <td>{t.status || "—"}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{t.contabSubGrupo || t.contabGrupo || "—"}</td>
                        <td>{t.descricao || "—"}</td>
                        <td className={`num strong ${t.forma === "Receita" ? "is-gold" : "is-out"}`}>
                          {sinal}{fmtEur(Math.abs(Number(t.valorBruto) || 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function ClienteModal({ isNew, draft, setDraft, onClose, onSave, saving }) {
  function up(k, v) { setDraft({ ...draft, [k]: v }); }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? "Novo Cliente" : "Editar Cliente"}</h2>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <div className="f f-wide">
              <label>Nome <span className="req">*</span></label>
              <input type="text" value={draft.nome} onChange={(e) => up("nome", e.target.value)} autoFocus />
            </div>
            <div className="f">
              <label>NIF</label>
              <input type="text" value={draft.nif} onChange={(e) => up("nif", e.target.value)} placeholder="Ex: 500000000" />
            </div>
            <div className="f">
              <label>P&L</label>
              <select value={draft.pl} onChange={(e) => up("pl", e.target.value)}>
                {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="f">
              <label>E-mail</label>
              <input type="email" value={draft.email} onChange={(e) => up("email", e.target.value)} />
            </div>
            <div className="f">
              <label>Telefone</label>
              <input type="tel" value={draft.telefone} onChange={(e) => up("telefone", e.target.value)} />
            </div>
            <div className="f">
              <label>Telemóvel</label>
              <input type="tel" value={draft.telemovel} onChange={(e) => up("telemovel", e.target.value)} />
            </div>
            <div className="f">
              <label>Código Postal</label>
              <input type="text" value={draft.codigoPostal} onChange={(e) => up("codigoPostal", e.target.value)} placeholder="Ex: 1000-000" />
            </div>
            <div className="f f-wide">
              <label>Endereço</label>
              <input type="text" value={draft.endereco} onChange={(e) => up("endereco", e.target.value)} />
            </div>
            <div className="f">
              <label>Data de Nascimento</label>
              <input type="date" value={draft.dataNascimento || ""} onChange={(e) => up("dataNascimento", e.target.value)} />
            </div>
            <div className="f">
              <label>Originador Comissão</label>
              <input type="text" value={draft.originadorComissao || ""} onChange={(e) => up("originadorComissao", e.target.value)} placeholder="Quem originou o cliente" />
            </div>
            <div className="f">
              <label>Status</label>
              <select value={draft.status || "ativo"} onChange={(e) => up("status", e.target.value)}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
                <option value="prospect">Prospect</option>
              </select>
            </div>
            <div className="f">
              <label>Tipo</label>
              <select value={draft.tipo || ""} onChange={(e) => up("tipo", e.target.value)}>
                <option value="">—</option>
                {TIPO_CLIENTE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="f">
              <label>Data Início</label>
              <input type="date" value={draft.dataInicio || ""} onChange={(e) => up("dataInicio", e.target.value)} />
            </div>
            <div className="f f-wide">
              <label>Produtos (selecione um ou mais)</label>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "4px 0" }}>
                {PRODUTO_CLIENTE_OPTIONS.map((p) => {
                  const checked = Array.isArray(draft.produtos) && draft.produtos.includes(p);
                  return (
                    <label key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = Array.isArray(draft.produtos) ? [...draft.produtos] : [];
                          if (e.target.checked) {
                            if (!cur.includes(p)) cur.push(p);
                          } else {
                            const idx = cur.indexOf(p);
                            if (idx >= 0) cur.splice(idx, 1);
                          }
                          up("produtos", cur);
                        }}
                      />
                      {p}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold" onClick={onSave} disabled={saving}>{saving ? "A guardar…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function ClientesImportModal({ preview, setPreview, onClose, onConfirm, importing }) {
  const total = preview.rows.length;
  const selected = preview.rows.filter((r) => !r.skip).length;
  const novos = preview.rows.filter((r) => !r.skip && !r.jaExiste).length;

  function toggle(i) {
    setPreview({ ...preview, rows: preview.rows.map((r, idx) => idx === i ? { ...r, skip: !r.skip } : r) });
  }
  function update(i, key, value) {
    setPreview({ ...preview, rows: preview.rows.map((r, idx) => idx === i ? { ...r, [key]: value } : r) });
  }
  function toggleAll(skip) {
    setPreview({
      ...preview,
      rows: preview.rows.map((r) => ({ ...r, skip: skip || r.jaExiste })),
    });
  }

  return (
    <div className="modal-back" onClick={importing ? undefined : onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Importar Clientes da Planilha</h2>
            <div className="modal-sub-title">
              {preview.fileName} · {selected}/{total} selecionados · {novos} novos
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={importing}>×</button>
        </div>
        <div className="modal-body modal-body-tight">
          <div className="import-toolbar">
            <button className="btn btn-light btn-tiny" onClick={() => toggleAll(false)} disabled={importing}>Selecionar todos</button>
            <button className="btn btn-light btn-tiny" onClick={() => toggleAll(true)} disabled={importing}>Deselecionar todos</button>
            <span className="filter-meta-info" style={{ marginLeft: "auto" }}>
              Clientes já cadastrados aparecem desmarcados por padrão
            </span>
          </div>
          <div className="import-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Nome</th>
                  <th>NIF</th>
                  <th>P&L</th>
                  <th className="num">Lançamentos</th>
                  <th className="num">Total Receita</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className={r.skip ? "row-skipped" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!r.skip}
                        onChange={() => toggle(i)}
                        disabled={importing}
                      />
                    </td>
                    <td className="strong">{r.nome}</td>
                    <td>
                      <input
                        type="text"
                        className="inline-input"
                        value={r.nif || ""}
                        onChange={(e) => update(i, "nif", e.target.value)}
                        disabled={importing}
                      />
                    </td>
                    <td>
                      <select
                        className="inline-input"
                        value={r.pl || "Principal"}
                        onChange={(e) => update(i, "pl", e.target.value)}
                        disabled={importing}
                      >
                        {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="num">{r.count || 0}</td>
                    <td className="num strong">{fmtEur(r.totalReceita || 0)}</td>
                    <td>
                      {r.jaExiste && <span className="badge-existing">Já cadastrado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={importing}>Cancelar</button>
          <button className="btn btn-gold" onClick={onConfirm} disabled={importing || selected === 0}>
            {importing ? "A importar…" : `Importar ${selected} clientes`}
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function parseClientesFromXlsx(buffer) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const aggregated = new Map();

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (!data.length) continue;

    let headerIdx = -1;
    let header = null;
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i].map((c) => String(c || "").toLowerCase());
      if (row.some((c) => c.includes("cliente"))) {
        headerIdx = i;
        header = row;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const findCol = (...names) =>
      header.findIndex((h) => names.some((n) => h.includes(n)));

    const idxCliente = findCol("cliente");
    const idxNif = findCol("nif", "contribuinte", "tax id");
    const idxEmail = findCol("e-mail", "email", "correio");
    const idxTel = findCol("telefone");
    const idxMov = findCol("telem", "móvel", "movel", "celular");
    const idxEnd = findCol("endere", "morada", "endereço");
    const idxCp = findCol("código postal", "codigo postal", "cp");
    const idxPl = findCol("p&l", "p_l", "pl");
    const idxValor = findCol("vl_bruto", "bruto", "valor");
    const idxForma = findCol("forma");
    const idxProduto = findCol("produto");

    if (idxCliente < 0) continue;

    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      const nome = String(row[idxCliente] || "").trim();
      if (!nome) continue;
      const formaRaw = idxForma >= 0 ? String(row[idxForma] || "").trim().toLowerCase() : "";
      const isReceita = !formaRaw || formaRaw.includes("receita") || formaRaw.includes("entrada");
      if (!isReceita && idxForma >= 0) continue;

      const key = normalizeName(nome);
      const existing = aggregated.get(key) || {
        nome,
        nif: "",
        email: "",
        telefone: "",
        telemovel: "",
        endereco: "",
        codigoPostal: "",
        pl: "Principal",
        count: 0,
        totalReceita: 0,
      };
      if (!existing.nif && idxNif >= 0) existing.nif = String(row[idxNif] || "").trim();
      if (!existing.email && idxEmail >= 0) existing.email = String(row[idxEmail] || "").trim();
      if (!existing.telefone && idxTel >= 0) existing.telefone = String(row[idxTel] || "").trim();
      if (!existing.telemovel && idxMov >= 0) existing.telemovel = String(row[idxMov] || "").trim();
      if (!existing.endereco && idxEnd >= 0) existing.endereco = String(row[idxEnd] || "").trim();
      if (!existing.codigoPostal && idxCp >= 0) existing.codigoPostal = String(row[idxCp] || "").trim();

      const plRaw = [
        idxPl >= 0 ? String(row[idxPl] || "") : "",
        idxProduto >= 0 ? String(row[idxProduto] || "") : "",
      ].join(" ").toLowerCase();
      if (plRaw.includes("legad")) existing.pl = "Legado";
      else if (plRaw.includes("conex")) existing.pl = "Principal";

      if (idxValor >= 0) existing.totalReceita += parseAmount(row[idxValor]);
      existing.count += 1;
      aggregated.set(key, existing);
    }
  }

  return Array.from(aggregated.values()).sort((a, b) => b.totalReceita - a.totalReceita);
}

// ===== Importadores =====

function detectDelimiter(line) {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDateAny(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const s = String(value).trim();
  if (!s) return null;
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, "0")}-${String(isoMatch[3]).padStart(2, "0")}`;
  }
  const ptMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (ptMatch) {
    let [, d, m, y] = ptMatch;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  let s = String(value).trim().replace(/[€$\s]/g, "").replace(/[ ]/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseBankOfx(text) {
  const out = [];
  if (!text || typeof text !== "string") throw new Error("OFX vazio.");
  const cleaned = text.replace(/\r/g, "");

  const stmtRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  const tagRegex = (tag) => new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  let m;
  while ((m = stmtRegex.exec(cleaned)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = block.match(tagRegex(tag));
      return r ? String(r[1] || "").trim() : "";
    };
    const dt = get("DTPOSTED") || get("DTUSER");
    if (!dt) continue;
    const yyyy = dt.slice(0, 4);
    const mmdd = `${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    if (!yyyy || !/^\d{4}$/.test(yyyy)) continue;
    const dataIso = `${yyyy}-${mmdd}`;
    const amountStr = get("TRNAMT").replace(",", ".");
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const name = get("NAME") || get("PAYEE");
    const memo = get("MEMO");
    const fitid = get("FITID");
    const descricao = [name, memo].filter(Boolean).join(" — ").slice(0, 240) || "Lançamento bancário";
    const isReceita = amount > 0;
    out.push({
      raw: { data: dataIso, descricao, amount, fitid },
      payload: cleanIncompatibleDates({
        data: dataIso,
        competencia: dataIso.slice(0, 7),
        dtEmissao: dataIso,
        dtVencimento: dataIso,
        forma: isReceita ? "Receita" : "Despesa",
        actPlan: "Act",
        status: isReceita ? "Recebido" : "Pago",
        formaPagamento: "Banco",
        fornecedor: isReceita ? "" : (name || descricao).slice(0, 80),
        cliente: isReceita ? (name || descricao).slice(0, 80) : "",
        descricao: descricao.slice(0, 200),
        fatura: fitid || "N/A",
        contabGrupo: "",
        classifContabGrupo: "",
        pl: "Principal",
        valorBruto: Math.abs(amount),
        valorLiquido: Math.abs(amount),
        origem: "ofx",
        ofxFitId: fitid || null,
      }),
    });
  }
  if (!out.length) throw new Error("Nenhuma transação <STMTTRN> encontrada no OFX.");
  return out;
}

function parseBankCsv(text) {
  const cleaned = text.replace(/^﻿/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("Arquivo CSV vazio ou inválido.");
  const delim = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());

  const findCol = (...names) =>
    header.findIndex((h) => names.some((n) => h.includes(n)));

  const idxData = findCol("data", "date");
  const idxDesc = findCol("descri", "histó", "histo", "description", "memo");
  const idxValor = findCol("valor", "montante", "amount", "movimento");
  const idxCredito = findCol("crédito", "credito", "credit", "entrada");
  const idxDebito = findCol("débito", "debito", "debit", "saída", "saida");

  if (idxData < 0) throw new Error("Coluna de data não encontrada no CSV.");
  if (idxValor < 0 && idxCredito < 0 && idxDebito < 0)
    throw new Error("Coluna de valor não encontrada no CSV.");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    const data = parseDateAny(cols[idxData]);
    if (!data) continue;
    let amount = 0;
    if (idxValor >= 0) amount = parseAmount(cols[idxValor]);
    else {
      const c = idxCredito >= 0 ? parseAmount(cols[idxCredito]) : 0;
      const d = idxDebito >= 0 ? parseAmount(cols[idxDebito]) : 0;
      amount = c - d;
    }
    if (!amount) continue;
    const descricao = (idxDesc >= 0 ? cols[idxDesc] : "") || "Lançamento bancário";
    const isReceita = amount > 0;
    const competencia = data.slice(0, 7);
    rows.push({
      raw: { data, descricao, amount },
      payload: cleanIncompatibleDates({
        data,
        competencia,
        dtEmissao: data,
        dtVencimento: data,
        forma: isReceita ? "Receita" : "Despesa",
        actPlan: "Act",
        status: isReceita ? "Recebido" : "Pago",
        formaPagamento: "Banco",
        fornecedor: isReceita ? "" : descricao.slice(0, 80),
        cliente: isReceita ? descricao.slice(0, 80) : "",
        descricao: descricao.slice(0, 200),
        fatura: "N/A",
        contabGrupo: "",
        classifContabGrupo: "",
        pl: "Principal",
        valorBruto: Math.abs(amount),
        valorLiquido: Math.abs(amount),
        origem: "extrato",
      }),
    });
  }
  return rows;
}

let xlsxLibPromise = null;
function loadXlsx() {
  if (!xlsxLibPromise) {
    xlsxLibPromise = import("https://esm.sh/xlsx@0.18.5");
  }
  return xlsxLibPromise;
}

let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("https://esm.sh/pdfjs-dist@4.4.168/build/pdf.mjs").then(async (mod) => {
      const pdfjs = mod.default || mod;
      pdfjs.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs";
      return pdfjs;
    });
  }
  return pdfjsLibPromise;
}

async function parseBankXlsx(buffer) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const out = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (!data.length) continue;
    let headerIdx = -1;
    let header = null;
    for (let i = 0; i < Math.min(25, data.length); i++) {
      const row = data[i].map((c) => String(c || "").toLowerCase());
      const hasData = row.some((c) => /data|date/.test(c));
      const hasValor = row.some((c) => /valor|montante|amount|movimento|crédito|credito|débito|debito/.test(c));
      const hasDesc = row.some((c) => /descri|hist[óo]|memo|description/.test(c));
      if (hasData && hasValor && hasDesc) {
        headerIdx = i;
        header = row;
        break;
      }
    }
    if (headerIdx < 0) continue;
    const findCol = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const idxData = findCol("data", "date");
    const idxDesc = findCol("descri", "histó", "histo", "description", "memo");
    const idxValor = findCol("valor", "montante", "amount", "movimento");
    const idxCredito = findCol("crédito", "credito", "credit", "entrada");
    const idxDebito = findCol("débito", "debito", "debit", "saída", "saida");
    const idxSaldo = findCol("saldo", "balance");
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => String(c || "").trim() === "")) continue;
      const dataIso = parseDateAny(row[idxData]);
      if (!dataIso) continue;
      let amount = 0;
      if (idxValor >= 0) amount = parseAmount(row[idxValor]);
      else {
        const c = idxCredito >= 0 ? parseAmount(row[idxCredito]) : 0;
        const d = idxDebito >= 0 ? parseAmount(row[idxDebito]) : 0;
        amount = c - d;
      }
      if (!amount || Math.abs(amount) < 0.005) continue;
      const descricao = (idxDesc >= 0 ? String(row[idxDesc] || "").trim() : "") || "Lançamento bancário";
      const valorSaldo = idxSaldo >= 0 ? parseAmount(row[idxSaldo]) : 0;
      const isReceita = amount > 0;
      out.push({
        raw: { data: dataIso, descricao, amount },
        payload: cleanIncompatibleDates({
          data: dataIso,
          competencia: dataIso.slice(0, 7),
          dtEmissao: dataIso,
          dtVencimento: dataIso,
          forma: isReceita ? "Receita" : "Despesa",
          actPlan: "Act",
          status: isReceita ? "Recebido" : "Pago",
          formaPagamento: "Banco",
          fornecedor: isReceita ? "" : descricao.slice(0, 80),
          cliente: isReceita ? descricao.slice(0, 80) : "",
          descricao: descricao.slice(0, 200),
          fatura: "N/A",
          contabGrupo: "",
          classifContabGrupo: "",
          pl: "Principal",
          valorBruto: Math.abs(amount),
          valorLiquido: Math.abs(amount),
          valorSaldo: valorSaldo || 0,
          origem: "extrato-xlsx",
        }),
      });
    }
    if (out.length) break;
  }
  if (!out.length) throw new Error("Nenhuma transação detectada no extrato XLS.");
  return out;
}

async function parseBankPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  const allRows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const txt = await page.getTextContent();
    const items = txt.items
      .map((it) => ({
        str: String(it.str || "").trim(),
        x: it.transform?.[4] ?? 0,
        y: it.transform?.[5] ?? 0,
      }))
      .filter((it) => it.str);
    const buckets = [];
    for (const it of items) {
      let bucket = buckets.find((b) => Math.abs(b.y - it.y) < 3);
      if (!bucket) {
        bucket = { y: it.y, items: [] };
        buckets.push(bucket);
      }
      bucket.items.push(it);
    }
    buckets.sort((a, b) => b.y - a.y);
    for (const b of buckets) {
      b.items.sort((a, b2) => a.x - b2.x);
      allRows.push({
        page: p,
        cells: b.items.map((it) => ({ str: it.str, x: it.x })),
        text: b.items.map((it) => it.str).join(" "),
      });
    }
  }

  const dateOnlyRegex = /^\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}$/;
  const dateInTextRegex = /\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}/;
  const amountStrRegex = /^-?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}$/;

  const out = [];
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const { dataIso, amount, valorSaldo, descricaoParts } = pending;
    pending = null;
    if (!amount || Math.abs(amount) < 0.005) return;
    const descricao = descricaoParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 200) || "Lancamento bancario";
    const isReceita = amount > 0;
    out.push({
      raw: { data: dataIso, descricao, amount },
      payload: cleanIncompatibleDates({
        data: dataIso,
        competencia: dataIso.slice(0, 7),
        dtEmissao: dataIso,
        dtVencimento: dataIso,
        forma: isReceita ? "Receita" : "Despesa",
        actPlan: "Act",
        status: isReceita ? "Recebido" : "Pago",
        formaPagamento: "Banco",
        fornecedor: isReceita ? "" : descricao.slice(0, 80),
        cliente: isReceita ? descricao.slice(0, 80) : "",
        descricao,
        fatura: "N/A",
        contabGrupo: "",
        classifContabGrupo: "",
        pl: "Principal",
        valorBruto: Math.abs(amount),
        valorLiquido: Math.abs(amount),
        valorSaldo: valorSaldo || 0,
        origem: "extrato-pdf",
      }),
    });
  };

  let inTable = false;
  for (const row of allRows) {
    const lower = row.text.toLowerCase();
    if (!inTable) {
      if (lower.includes("data mov") && lower.includes("descri") && lower.includes("saldo")) {
        inTable = true;
      }
      continue;
    }
    if (/caixa\s+geral\s+de\s+dep/i.test(row.text)) {
      flush();
      continue;
    }
    if (lower.startsWith("data mov") || lower.includes("apos movimento") || lower.includes("após movimento")) continue;

    const cells = row.cells;
    const firstCell = cells[0]?.str || "";

    if (dateOnlyRegex.test(firstCell)) {
      flush();
      const dataMov = parseDateAny(firstCell);
      let descStart = 1;
      let dataValor = null;
      if (cells[1] && dateOnlyRegex.test(cells[1].str)) {
        dataValor = parseDateAny(cells[1].str);
        descStart = 2;
      }
      const dataIso = dataValor || dataMov;
      if (!dataIso) continue;
      let amountIdx = -1;
      for (let i = descStart; i < cells.length; i++) {
        if (amountStrRegex.test(cells[i].str)) { amountIdx = i; break; }
      }
      let saldoIdx = -1;
      if (amountIdx >= 0) {
        for (let i = amountIdx + 1; i < cells.length; i++) {
          if (amountStrRegex.test(cells[i].str)) { saldoIdx = i; break; }
        }
      }
      const amount = amountIdx >= 0 ? parseAmount(cells[amountIdx].str) : 0;
      const valorSaldo = saldoIdx >= 0 ? parseAmount(cells[saldoIdx].str) : 0;
      const descCells = cells.slice(descStart, amountIdx >= 0 ? amountIdx : cells.length);
      const descricaoParts = [descCells.map((c) => c.str).join(" ").trim()];
      pending = { dataIso, amount, valorSaldo, descricaoParts };
    } else if (pending && cells.length && !dateInTextRegex.test(row.text) && !amountStrRegex.test(firstCell)) {
      const cont = cells.map((c) => c.str).join(" ").trim();
      if (cont) pending.descricaoParts.push(cont);
    }
  }
  flush();

  if (!out.length) {
    throw new Error("Nenhuma transacao detectada no PDF do extrato. Verifique se o PDF tem texto pesquisavel (nao e imagem) e segue o layout CGD.");
  }
  return out;
}

async function parseFluxoXlsx(buffer) {
  return parseFluxoCaixaXlsx(buffer);
}

const NIF_CONEXAO = "516741500";

async function parseFaturaTOConlinePdf(buffer) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const txt = await page.getTextContent();
    const items = txt.items
      .map((it) => ({
        str: String(it.str || "").trim(),
        x: it.transform?.[4] ?? 0,
        y: it.transform?.[5] ?? 0,
      }))
      .filter((it) => it.str);
    const buckets = [];
    for (const it of items) {
      let b = buckets.find((b) => Math.abs(b.y - it.y) < 3);
      if (!b) { b = { y: it.y, items: [] }; buckets.push(b); }
      b.items.push(it);
    }
    buckets.sort((a, b) => b.y - a.y);
    for (const b of buckets) {
      b.items.sort((a, b2) => a.x - b2.x);
      rows.push(b.items.map((it) => it.str).join(" "));
    }
  }
  const full = rows.join("\n");

  const out = {
    fatura: "",
    atcud: "",
    data: "",
    dtVencimento: "",
    moeda: "EUR",
    clienteNome: "",
    clienteNif: "",
    clienteMorada: "",
    descricao: "",
    codigoServico: "",
    quantidade: 1,
    precoUnitario: 0,
    iva: "",
    valorLiquido: 0,
    totalIva: 0,
    valorBruto: 0,
    descontos: 0,
  };

  const numFatRe = /(FT|FR|NC|ND|RE|FS)\s*(\d{4})\/(\d+)/i;
  const mFat = full.match(numFatRe);
  if (mFat) out.fatura = `${mFat[1].toUpperCase()} ${mFat[2]}/${mFat[3]}`;

  const atcudRe = /ATCUD\s*:\s*([A-Z0-9]+-\d+)/i;
  const mAt = full.match(atcudRe);
  if (mAt) out.atcud = mAt[1];

  const isoDateRe = /(20\d{2})-(\d{2})-(\d{2})/g;
  const datas = [...full.matchAll(isoDateRe)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
  if (datas.length >= 1) out.data = datas[0];
  if (datas.length >= 2) out.dtVencimento = datas[1];

  const idxCliente = rows.findIndex((r) => /^cliente$/i.test(r.trim()) || /\bcliente\b/i.test(r) && r.length < 25);
  if (idxCliente >= 0 && idxCliente + 1 < rows.length) {
    out.clienteNome = rows[idxCliente + 1].trim().replace(/^Cliente\s*/i, "");
  }
  if (!out.clienteNome) {
    for (let i = 0; i < rows.length; i++) {
      if (/^cliente\b/i.test(rows[i].trim())) {
        const next = rows[i + 1]?.trim() || "";
        if (next && !/morada|nif|data|cliente/i.test(next)) {
          out.clienteNome = next;
          break;
        }
      }
    }
  }

  const allNifs = [...full.matchAll(/\b(\d{9})\b/g)].map((m) => m[1]);
  const clienteNif = allNifs.find((n) => n !== NIF_CONEXAO);
  if (clienteNif) out.clienteNif = clienteNif;

  const idxMorada = rows.findIndex((r) => /^morada$/i.test(r.trim()));
  if (idxMorada >= 0 && idxMorada + 1 < rows.length) {
    out.clienteMorada = rows[idxMorada + 1].trim().replace(/^Morada\s*/i, "");
  }

  const linhaItemIdx = rows.findIndex((r) =>
    /^[A-Z]{1,4}\s+.+\d+[,.]\d{2}\s+\d+%/i.test(r)
  );
  if (linhaItemIdx >= 0) {
    const linha = rows[linhaItemIdx];
    const mLinha = linha.match(/^([A-Z]{1,4})\s+(.+?)\s+(\d+[,.]\d{2})\s+\S+\s+(\d+[,.]\d{2})\s+(\d+)%/i);
    if (mLinha) {
      out.codigoServico = mLinha[1];
      out.descricao = mLinha[2].trim();
      out.quantidade = parseFloat(mLinha[3].replace(",", ".")) || 1;
      out.precoUnitario = parseFloat(mLinha[4].replace(",", ".")) || 0;
      out.iva = `${mLinha[5]}%`;
    } else {
      out.descricao = linha.replace(/^[A-Z]{1,4}\s+/, "").replace(/\s+\d+[,.]\d{2}.*$/, "").trim();
    }
  }

  function valorApos(label) {
    for (let i = 0; i < rows.length; i++) {
      if (new RegExp(`^\\s*${label}\\b`, "i").test(rows[i])) {
        const m = rows[i].match(/(-?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2})/);
        if (m) return parseFloat(m[1].replace(/\./g, "").replace(/\s/g, "").replace(",", "."));
        if (i + 1 < rows.length) {
          const n = rows[i + 1].match(/(-?\d{1,3}(?:[.\s]\d{3})*[,.]\d{2})/);
          if (n) return parseFloat(n[1].replace(/\./g, "").replace(/\s/g, "").replace(",", "."));
        }
      }
    }
    return null;
  }

  const totalLiq = valorApos("Total\\s*L[íi]quido");
  if (totalLiq != null) out.valorLiquido = totalLiq;
  const totalIva = valorApos("Total\\s*IVA");
  if (totalIva != null) out.totalIva = totalIva;
  const desc = valorApos("Descontos\\s*de\\s*linha");
  if (desc != null) out.descontos = desc;

  let totalBruto = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const m = r.match(/^Total\s+(\d{1,3}(?:[.\s]\d{3})*[,.]\d{2})\s*$/i);
    if (m) {
      totalBruto = parseFloat(m[1].replace(/\./g, "").replace(/\s/g, "").replace(",", "."));
      break;
    }
  }
  if (totalBruto == null) totalBruto = out.valorLiquido + out.totalIva;
  out.valorBruto = totalBruto;

  if (!out.fatura) {
    throw new Error("Não foi possível identificar o número da fatura. Verifique se o PDF é uma fatura TOConline original.");
  }
  return out;
}

function mapFaturaToTx(fat, clientes = []) {
  const descLower = (fat.descricao || "").toLowerCase();
  const isComissao = /comiss[ãa]o|partilha\s+imobili[áa]ria|partilha/i.test(descLower);
  const isAssessoria = /assessoria/i.test(descLower);
  const isGestao = /gest[ãa]o/i.test(descLower);
  const isFinanciamento = /financiamento/i.test(descLower);

  const tx = {
    ...emptyTx(),
    forma: "Receita",
    status: "A receber",
    actPlan: "Plan",
    data: fat.data || todayISO(),
    competencia: (fat.data || todayISO()).slice(0, 7),
    dtEmissao: fat.data || "",
    dtVencimento: fat.dtVencimento || fat.data || "",
    fatura: fat.fatura || "",
    descricao: fat.descricao || "",
    valorBruto: fat.valorBruto || 0,
    valorLiquido: fat.valorLiquido || fat.valorBruto || 0,
    valorRetencao: fat.totalIva || 0,
    iva: fat.iva || "",
    contabGrupo: "Receita",
    classifContabGrupo: "01.Receita",
    pl: "Principal",
    origem: "fatura-toconline",
    comentarios: [
      fat.atcud ? `ATCUD: ${fat.atcud}` : null,
      fat.clienteNif ? `NIF cliente: ${fat.clienteNif}` : null,
      fat.clienteMorada ? `Morada: ${fat.clienteMorada}` : null,
    ].filter(Boolean).join(" · "),
  };

  if (isAssessoria) {
    tx.cliente = fat.clienteNome || "";
    tx.contabSubGrupo = "Assessoria";
    tx.produto = "Assessoria";
  } else if (isComissao) {
    tx.fornecedor = fat.clienteNome || "";
    tx.cliente = "";
    if (/compra/i.test(descLower)) tx.contabSubGrupo = "Comissão Compra";
    else if (/venda/i.test(descLower)) tx.contabSubGrupo = "Comissão - Venda";
    else if (/arrend/i.test(descLower)) tx.contabSubGrupo = "Comissão - Arrendamento";
    else if (/indica/i.test(descLower)) tx.contabSubGrupo = "Comissão Indicação";
    else tx.contabSubGrupo = "Comissão - Venda";
    tx.produto = "Imobiliária";
  } else if (isGestao) {
    tx.cliente = fat.clienteNome || "";
    if (/\bal\b/i.test(descLower) || /alojamento\s+local/i.test(descLower)) tx.contabSubGrupo = "Gestão de Imóveis AL";
    else if (/\bld\b/i.test(descLower) || /longa\s+dura/i.test(descLower)) tx.contabSubGrupo = "Gestão de Imóveis LD";
    else if (/\bmd\b/i.test(descLower) || /m[eé]dia\s+dura/i.test(descLower)) tx.contabSubGrupo = "Gestão de Imóveis MD";
    else tx.contabSubGrupo = "Gestão de Imóveis AL";
    tx.produto = "Gestão";
  } else if (isFinanciamento) {
    tx.cliente = fat.clienteNome || "";
    tx.produto = "Financiamento";
  } else {
    tx.cliente = fat.clienteNome || "";
  }

  const nomeBusca = (tx.cliente || tx.fornecedor || "").toLowerCase().trim();
  const clienteCadastrado = clientes.find((c) => (c.nome || "").toLowerCase().trim() === nomeBusca);
  const naoCadastrado = !!nomeBusca && !clienteCadastrado;

  return { tx, naoCadastrado, nomeFaltando: nomeBusca, isComissao, isAssessoria };
}

function ImportPreviewModal({ preview, setPreview, onClose, onConfirm, importing, error, existingPlanilhaCount = 0 }) {
  const total = preview.rows.length;
  const selected = preview.rows.filter((r) => !r.skip).length;
  const totalValue = preview.rows
    .filter((r) => !r.skip)
    .reduce((acc, r) => acc + (r.payload.forma === "Receita" ? r.payload.valorBruto : -r.payload.valorBruto), 0);
  const isExtrato = preview.kind === "extrato";
  const sugeridos = preview.rows.filter((r) => r.suggestion?.score > 0).length;
  const duplicados = preview.rows.filter((r) => r.duplicate).length;

  function toggleRow(idx) {
    setPreview({
      ...preview,
      rows: preview.rows.map((r, i) => (i === idx ? { ...r, skip: !r.skip } : r)),
    });
  }
  function toggleAll(skip) {
    setPreview({
      ...preview,
      rows: preview.rows.map((r) => ({ ...r, skip: skip || r.duplicate })),
    });
  }
  function updateField(idx, key, value) {
    setPreview({
      ...preview,
      rows: preview.rows.map((r, i) => {
        if (i !== idx) return r;
        const payload = { ...r.payload, [key]: value };
        if (key === "contabGrupo") payload.classifContabGrupo = deriveClassifContab(value);
        return { ...r, payload, edited: true };
      }),
    });
  }
  function aprovarSugestoes() {
    setPreview({
      ...preview,
      rows: preview.rows.map((r) => (r.suggestion?.score > 0 && !r.duplicate ? { ...r, skip: false } : r)),
    });
  }

  const titulo = isExtrato
    ? "Conciliação Bancária · Revisão de Lançamentos"
    : preview.kind === "drive"
      ? "Sincronizar Drive · Contas a Pagar"
      : "Importar Planilha";

  return (
    <div className="modal-back" onClick={importing ? undefined : onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{titulo}</h2>
            <div className="modal-sub-title">
              {preview.fileName} · {selected}/{total} lançamentos · saldo {fmtEur(totalValue)}
              {isExtrato && (
                <> · <strong>{sugeridos}</strong> com sugestão automática
                {duplicados > 0 && <> · <span style={{ color: "var(--red)" }}>{duplicados} duplicados ignorados</span></>}
                </>
              )}
              {!isExtrato && preview.rows.some((r) => r.yearMismatches?.length > 0) && (
                <> · <span style={{ color: "var(--red)" }}>
                  {preview.rows.filter((r) => r.yearMismatches?.length > 0).length} linha(s) com ano corrigido pela data efetiva
                </span></>
              )}
              {preview.rows.some((r) => r.legadoCorrected) && (
                <> · <span style={{ color: "var(--gold)" }}>
                  {preview.rows.filter((r) => r.legadoCorrected).length} cliente(s) Legado reclassificado(s)
                </span></>
              )}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={importing}>×</button>
        </div>
        <div className="modal-body modal-body-tight">
          {error && <div className="erp-alert erp-alert-error" style={{ margin: "0 0 12px" }}>{error}</div>}
          {isExtrato && (
            <div className="erp-alert" style={{ marginBottom: 12 }}>
              <strong>Como funciona:</strong> cada linha do extrato foi cruzada contra as <strong>regras De/Para</strong> e o
              <strong> histórico de transações</strong> (fornecedor/cliente). Onde houve coincidência, a categorização foi sugerida.
              Edite o que precisar e clique em <strong>Importar</strong>. Linhas duplicadas (mesmo FITID OFX) já são desmarcadas.
            </div>
          )}
          {!isExtrato && existingPlanilhaCount > 0 && (
            <div
              className={`erp-alert ${preview.replaceAll ? "erp-alert-error" : ""}`}
              style={{ marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <input
                type="checkbox"
                id="chk-replace-all"
                checked={!!preview.replaceAll}
                onChange={(e) => setPreview({ ...preview, replaceAll: e.target.checked })}
                disabled={importing}
                style={{ marginTop: 3 }}
              />
              <label htmlFor="chk-replace-all" style={{ cursor: "pointer", lineHeight: 1.45 }}>
                <strong>Substituir tudo</strong> · apagar as <strong>{existingPlanilhaCount}</strong> transações
                já importadas da planilha (origem <code>fluxo-caixa</code>) antes de criar as novas.
                Lançamentos manuais e conciliações OFX não são afetados.
                {preview.replaceAll && (
                  <span style={{ display: "block", marginTop: 4, color: "var(--red)", fontWeight: 600 }}>
                    Atenção: esta operação não pode ser desfeita.
                  </span>
                )}
              </label>
            </div>
          )}
          <div className="import-toolbar">
            <button className="btn btn-light btn-tiny" onClick={() => toggleAll(false)} disabled={importing}>Selecionar todos</button>
            <button className="btn btn-light btn-tiny" onClick={() => toggleAll(true)} disabled={importing}>Deselecionar todos</button>
            {isExtrato && sugeridos > 0 && (
              <button className="btn btn-light btn-tiny" onClick={aprovarSugestoes} disabled={importing}>
                Aprovar {sugeridos} sugestões
              </button>
            )}
          </div>
          <div className="import-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th className="num">Valor</th>
                  {isExtrato && <th>Fornecedor / Cliente</th>}
                  {isExtrato && <th>CONTAB_GRUPO</th>}
                  {isExtrato && <th>SUB-GRUPO</th>}
                  {isExtrato && <th>P&L</th>}
                  {!isExtrato && <th>Forma</th>}
                  {!isExtrato && <th>Status</th>}
                  {isExtrato && <th>Sugestão</th>}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className={`${r.skip ? "row-skipped" : ""} ${r.duplicate ? "row-duplicate" : ""}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!r.skip}
                        onChange={() => toggleRow(i)}
                        disabled={importing}
                      />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(r.payload.data)}
                      {r.yearMismatches?.length > 0 && (
                        <span
                          title={`Ano corrigido pela data efetiva:\n${r.yearMismatches.join("\n")}`}
                          style={{ marginLeft: 6, color: "var(--red)", fontWeight: 700, cursor: "help" }}
                        >!</span>
                      )}
                    </td>
                    <td className="truncate" title={r.payload.descricao} style={{ maxWidth: 220 }}>
                      <div>{r.payload.descricao || r.raw?.descricao || "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        <span className={`tag tag-${(r.payload.forma || "").toLowerCase()}`}>{r.payload.forma}</span>
                        {r.duplicate && (
                          <span style={{ marginLeft: 6, color: "var(--red)" }}>
                            · duplicado{r.duplicateReason === "ofx" ? " OFX" : r.duplicateReason === "content" ? " (mesma data, valor e fornecedor)" : ""}
                          </span>
                        )}
                        {r.yearMismatches?.length > 0 && <span style={{ marginLeft: 6, color: "var(--red)" }}>· ano corrigido</span>}
                        {r.legadoCorrected && (
                          <span style={{ marginLeft: 6, color: "var(--gold)" }}>
                            · PL ajustado para Legado{r.legadoCorrected === "socio" ? " (paga via sócio)" : " (paga na CGD)"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num strong">{fmtEur(r.payload.valorBruto)}</td>
                    {isExtrato ? (
                      <>
                        <td>
                          <input
                            type="text"
                            className="cell-input"
                            value={r.payload.forma === "Receita" ? (r.payload.cliente || "") : (r.payload.fornecedor || "")}
                            onChange={(e) => updateField(i, r.payload.forma === "Receita" ? "cliente" : "fornecedor", e.target.value)}
                            disabled={importing}
                          />
                        </td>
                        <td>
                          <select
                            className="cell-input"
                            value={r.payload.contabGrupo || ""}
                            onChange={(e) => updateField(i, "contabGrupo", e.target.value)}
                            disabled={importing}
                          >
                            <option value="">—</option>
                            {CONTAB_GRUPO_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </td>
                        <td>
                          <select
                            className="cell-input"
                            value={r.payload.contabSubGrupo || ""}
                            onChange={(e) => updateField(i, "contabSubGrupo", e.target.value)}
                            disabled={importing}
                          >
                            <option value="">—</option>
                            {Object.entries(CONTAB_SUBGRUPO_GROUPS).map(([grp, opts]) => (
                              <optgroup key={grp} label={grp}>
                                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="cell-input"
                            value={r.payload.pl || ""}
                            onChange={(e) => updateField(i, "pl", e.target.value)}
                            disabled={importing}
                          >
                            {PL_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td>
                          {r.suggestion?.score > 0 ? (
                            <span className="pill pill-pago" title={r.suggestion.source}>
                              {(r.suggestion.score * 100).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="pill pill-atrasado">manual</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td><span className={`tag tag-${(r.payload.forma || "").toLowerCase()}`}>{r.payload.forma}</span></td>
                        <td><StatusPill status={r.payload.status} /></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-light" onClick={onClose} disabled={importing}>Cancelar</button>
          <button className="btn btn-gold" onClick={onConfirm} disabled={importing || selected === 0}>
            {importing
              ? "A importar…"
              : preview.replaceAll
                ? `Substituir tudo · Apagar ${existingPlanilhaCount} e importar ${selected}`
                : `Importar ${selected} lançamentos`}
          </button>
        </div>
      </div>
    </div>
  );
}
