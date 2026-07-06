/**
 * Serviço de CÁLCULOS JURÍDICOS (legal-calculos) — a camada de plataforma do app
 * de serviço. Governança: a rota é fina (gate + rate-limit + traduz); TODA a
 * lógica vive aqui. O serviço:
 *
 *  - carrega a tabela canónica `assets/legal-engines/tabelas-taxas.json` (fonte
 *    ÚNICA — a mesma que o crawler atualiza e o scaffold do app serve) e sobrepõe
 *    as linhas de overlay que o crawler escreve na espinha (`tabelas_taxas`);
 *  - importa os motores canónicos `juros.mjs` / `custas.mjs` por dynamic import (o
 *    mesmo conteúdo versionado que o app scaffold empacota — nenhuma constante de
 *    taxa nem aritmética duplicada vive no código da plataforma);
 *  - expõe `computeJuros` / `computeCustas` (recebem a tabela mergida como input);
 *  - `verificarAtualizacaoTaxas(now, tabela)` — o ALARME de atualização em falta;
 *  - `emitirAlarmeTabelas(scope, now, deps)` — notificação best-effort, deduplicada.
 *
 * Fronteira (P2-001): nenhuma constante de taxa vive aqui; as taxas vêm da tabela
 * (conteúdo versionado) e os motores fazem a aritmética.
 *
 * Carried from cortex/src/services/legal-calculos.ts (B21, adapt): the engine +
 * table content tree moved from ekoa-data/ to the in-repo api/assets/legal-engines
 * (single source of truth shared with the served-app scaffold). The old app-data
 * store is an INJECTED best-effort seam instead of a hard import.
 */
import { resolve, join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tipos partilhados com o motor (mantidos deliberadamente laxos: o motor valida).
// ---------------------------------------------------------------------------

export interface TabelaUcRow {
  ano: number;
  valor: number;
  base?: string;
  nota?: string;
}
export interface TabelaComercialRow {
  semestre: string;
  taxa: number;
  aviso: string | null;
  vigenciaInicio: string;
  vigenciaFim: string;
  nota?: string;
}
export interface TabelaTaxas {
  versao?: number;
  atualizadoEm?: string;
  jurosCivis?: { taxa: number; base?: string; vigenciaInicio?: string };
  retencaoIrs?: { taxa: number; base?: string; anterior?: { taxa: number; ate: string } };
  uc?: TabelaUcRow[];
  jurosComerciais?: TabelaComercialRow[];
  alarme?: { descricao?: string; diaLimiteConfirmacao?: number };
  [k: string]: unknown;
}

export interface JurosParams {
  valor?: number;
  capitalCentavos?: number;
  dataVencimento: string;
  dataFim: string;
  /** 'civil' | 'comercial' | 'estado' — mapeado para o motor. */
  tipoJuro?: string;
}
export interface CustasParams {
  valorAcao: number;
  tabela?: string;
  ano?: number;
}

export interface AlarmeTabelas {
  alarme: boolean;
  detalhe: string;
  semestre: string;
  motivo: 'ok' | 'graca' | 'em-falta' | 'por-confirmar';
}

interface JurosEngine {
  computeJuros: (input: unknown) => Record<string, unknown>;
}
interface CustasEngine {
  computeCustas: (input: unknown) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Resolução do content tree + carregamento dos motores canónicos.
// ---------------------------------------------------------------------------

/** The versioned legal-engines content tree. `api/assets/legal-engines/` from src
 *  OR dist (both are two levels under `api/`); overridable for tests. */
function legalEnginesDir(): string {
  return process.env.EKOA_LEGAL_ENGINES_DIR || resolve(__dirname, '..', '..', 'assets', 'legal-engines');
}

let enginesPromise: Promise<{ juros: JurosEngine; custas: CustasEngine }> | null = null;
async function loadEngines(): Promise<{ juros: JurosEngine; custas: CustasEngine }> {
  if (!enginesPromise) {
    const dir = legalEnginesDir();
    enginesPromise = Promise.all([
      import(pathToFileURL(join(dir, 'juros.mjs')).href) as Promise<JurosEngine>,
      import(pathToFileURL(join(dir, 'custas.mjs')).href) as Promise<CustasEngine>,
    ]).then(([juros, custas]) => ({ juros, custas }));
  }
  return enginesPromise;
}

/** Lê a tabela canónica do disco (sem cache — o crawler pode reescrever o overlay,
 *  mas a canónica só muda por deploy; reler é barato e evita estado obsoleto). */
export function loadCanonicalTabela(): TabelaTaxas {
  const raw = readFileSync(join(legalEnginesDir(), 'tabelas-taxas.json'), 'utf-8');
  return JSON.parse(raw) as TabelaTaxas;
}

// ---------------------------------------------------------------------------
// Merge canónico + overlay (linhas escritas pelo crawler na espinha).
// ---------------------------------------------------------------------------

/**
 * Sobrepõe as linhas de overlay à tabela canónica. O overlay ganha sobre a
 * canónica com a mesma chave (semestre / ano); linhas novas são acrescentadas.
 * O overlay é opcional e nunca falha o cálculo.
 */
export function mergeTabela(canonical: TabelaTaxas, overlayRows: Array<Record<string, unknown>> = []): TabelaTaxas {
  const out: TabelaTaxas = {
    ...canonical,
    jurosComerciais: Array.isArray(canonical.jurosComerciais) ? [...canonical.jurosComerciais] : [],
    uc: Array.isArray(canonical.uc) ? [...canonical.uc] : [],
  };
  const comerciais = new Map<string, TabelaComercialRow>();
  for (const r of out.jurosComerciais ?? []) comerciais.set(r.semestre, r);
  const ucByAno = new Map<number, TabelaUcRow>();
  for (const r of out.uc ?? []) ucByAno.set(Number(r.ano), r);

  for (const row of Array.isArray(overlayRows) ? overlayRows : []) {
    if (!row || typeof row !== 'object') continue;
    const kind = String((row as { kind?: unknown }).kind || (row as { tipo?: unknown }).tipo || '');
    const isComercial = kind === 'jurosComerciais' || kind === 'juros_comerciais' || (row as { semestre?: unknown }).semestre != null;
    const isUc = kind === 'uc' || (kind !== 'juros_comerciais' && (row as { ano?: unknown }).ano != null);
    if (isComercial) {
      const semestre = String((row as { semestre?: unknown }).semestre || '');
      const taxa = Number((row as { taxa?: unknown }).taxa);
      if (!semestre || !Number.isFinite(taxa)) continue;
      comerciais.set(semestre, {
        semestre,
        taxa,
        aviso: String((row as { aviso?: unknown }).aviso || 'Overlay (crawler)'),
        vigenciaInicio: String((row as { vigenciaInicio?: unknown }).vigenciaInicio || ''),
        vigenciaFim: String((row as { vigenciaFim?: unknown }).vigenciaFim || ''),
        ...((row as { nota?: unknown }).nota ? { nota: String((row as { nota?: unknown }).nota) } : {}),
      });
    } else if (isUc) {
      const ano = Number((row as { ano?: unknown }).ano);
      const valor = Number((row as { valor?: unknown }).valor);
      if (!Number.isInteger(ano) || !Number.isFinite(valor)) continue;
      ucByAno.set(ano, {
        ano,
        valor,
        base: String((row as { base?: unknown }).base || 'Overlay (crawler)'),
        ...((row as { nota?: unknown }).nota ? { nota: String((row as { nota?: unknown }).nota) } : {}),
      });
    }
  }

  out.jurosComerciais = [...comerciais.values()].sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio));
  out.uc = [...ucByAno.values()].sort((a, b) => a.ano - b.ano);
  return out;
}

// ---------------------------------------------------------------------------
// computeJuros / computeCustas — recebem a tabela mergida como input.
// ---------------------------------------------------------------------------

export async function computeJuros(params: JurosParams, tabela: TabelaTaxas): Promise<Record<string, unknown>> {
  const { juros } = await loadEngines();
  return juros.computeJuros({
    valor: params.valor,
    capitalCentavos: params.capitalCentavos,
    dataVencimento: params.dataVencimento,
    dataFim: params.dataFim,
    tipo: params.tipoJuro,
    tabela,
  });
}

export async function computeCustas(params: CustasParams, tabela: TabelaTaxas): Promise<Record<string, unknown>> {
  const { custas } = await loadEngines();
  return custas.computeCustas({
    valorAcao: params.valorAcao,
    tabela: params.tabela,
    ano: params.ano,
    uc: tabela.uc,
  });
}

// ---------------------------------------------------------------------------
// Alarme de atualização em falta (§3.3) — puro, injectável no relógio.
// ---------------------------------------------------------------------------

function semestreDe(now: Date): { ano: number; semestre: 'S1' | 'S2'; chave: string; primeiroMes: number } {
  const ano = now.getUTCFullYear();
  const semestre: 'S1' | 'S2' = now.getUTCMonth() <= 5 ? 'S1' : 'S2';
  return { ano, semestre, chave: `${ano}-${semestre}`, primeiroMes: semestre === 'S1' ? 0 : 6 };
}

/**
 * O ALARME §3.3. Dispara quando, DEPOIS do dia-limite de confirmação (por omissão
 * 15) do primeiro mês do semestre corrente: não existe linha de juros comerciais
 * para o semestre corrente, OU existe mas está marcada `nota:'confirmar'`. Antes
 * do dia-limite há PERÍODO DE GRAÇA — não dispara.
 */
export function verificarAtualizacaoTaxas(now: Date, tabela: TabelaTaxas = loadCanonicalTabela()): AlarmeTabelas {
  const { chave, primeiroMes } = semestreDe(now);
  const diaLimite = tabela.alarme?.diaLimiteConfirmacao ?? 15;

  const emGraca = now.getUTCMonth() === primeiroMes && now.getUTCDate() < diaLimite;
  const rows = Array.isArray(tabela.jurosComerciais) ? tabela.jurosComerciais : [];
  const row = rows.find((r) => r.semestre === chave);

  if (emGraca) {
    return { alarme: false, detalhe: `Semestre ${chave} em período de graça até ao dia ${diaLimite}.`, semestre: chave, motivo: 'graca' };
  }
  if (!row) {
    return {
      alarme: true,
      detalhe: `Não há taxa de juros comerciais publicada para o semestre ${chave}. Verifique o novo Aviso da DGTF no DRE.`,
      semestre: chave,
      motivo: 'em-falta',
    };
  }
  if (row.nota === 'confirmar') {
    return {
      alarme: true,
      detalhe: `A taxa de juros comerciais do semestre ${chave} (${row.taxa}% - ${row.aviso}) está por confirmar contra o DRE.`,
      semestre: chave,
      motivo: 'por-confirmar',
    };
  }
  return { alarme: false, detalhe: `Taxa do semestre ${chave} confirmada (${row.taxa}%).`, semestre: chave, motivo: 'ok' };
}

// ---------------------------------------------------------------------------
// Emissão da notificação de alarme na espinha (best-effort, deduplicada).
// ---------------------------------------------------------------------------

export interface AlarmeStore {
  list: (scope: string, collection: string) => Promise<Array<Record<string, unknown>>>;
  create: (scope: string, collection: string, data: Record<string, unknown>) => Promise<unknown>;
}
export interface EmitAlarmeDeps {
  /** Injected owner-spine store. Absent => best-effort skip of the write. */
  store?: AlarmeStore;
  tabela?: TabelaTaxas;
}

/**
 * Escreve uma notificação de alarme na espinha do dono (`scope` = `usr.<id>`),
 * sem duplicar: se já existe uma notificação NÃO LIDA do mesmo semestre, não cria
 * outra. Best-effort — nunca lança. Devolve sempre o resultado do alarme.
 */
export async function emitirAlarmeTabelas(scope: string, now: Date, deps: EmitAlarmeDeps = {}): Promise<AlarmeTabelas> {
  const tabela = deps.tabela ?? loadCanonicalTabela();
  const res = verificarAtualizacaoTaxas(now, tabela);
  if (!res.alarme) return res;
  const store = deps.store;
  if (!store) return res;
  try {
    const existentes = await store.list(scope, 'notificacoes');
    const jaExiste = (Array.isArray(existentes) ? existentes : []).some((n) => {
      const row = n as Record<string, unknown>;
      return row.tipo === 'tabelas' && row.semestre === res.semestre && row.lida !== true;
    });
    if (jaExiste) return res;
    await store.create(scope, 'notificacoes', {
      tipo: 'tabelas',
      titulo: 'Atualização de taxas em falta',
      corpo: res.detalhe,
      semestre: res.semestre,
      href: '/apps/legal-calculos/',
      lida: false,
      data: now.toISOString(),
    });
  } catch {
    /* best-effort — nunca fatal */
  }
  return res;
}
