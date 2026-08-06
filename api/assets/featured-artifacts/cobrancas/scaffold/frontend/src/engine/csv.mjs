/*
 * Interpretação de EXTRATOS BANCÁRIOS em CSV - puro, sem I/O. Bancos
 * portugueses exportam CSV com separador ';' (por vezes ',' ou tab), cabeçalho
 * com sinónimos vários e montantes '1.234,56'. Este módulo:
 *   1. deteta o separador (o mais frequente na linha de cabeçalho);
 *   2. encontra a linha de cabeçalho (a primeira com uma coluna de data E uma
 *      de montante/descritivo reconhecíveis) - linhas de preâmbulo caem;
 *   3. mapeia sinónimos: data (data mov., data valor, data operação, date),
 *      descricao (descritivo, descrição, movimento, description), valor
 *      (montante, valor, importância, amount) OU par débito/crédito em
 *      colunas separadas, saldo (saldo, balance);
 *   4. interpreta datas flexíveis e montantes pt/int; crédito = valor > 0 ou
 *      coluna de crédito preenchida.
 * Devolve { transacoes, erros } - linhas ilegíveis contam como erro visível,
 * nunca desaparecem em silêncio.
 */
import { parseMontante, round2 } from './dinheiro.mjs';
import { parseDataFlex } from './datas.mjs';

const SIN_DATA = ['data mov', 'data valor', 'data operacao', 'data operação', 'data', 'date', 'data lanc'];
const SIN_DESC = ['descritivo', 'descricao', 'descrição', 'movimento', 'description', 'historico', 'histórico', 'detalhe'];
const SIN_VALOR = ['montante', 'valor', 'importancia', 'importância', 'amount', 'quantia'];
const SIN_DEBITO = ['debito', 'débito', 'debit', 'a debito', 'a débito'];
const SIN_CREDITO = ['credito', 'crédito', 'credit', 'a credito', 'a crédito'];
const SIN_SALDO = ['saldo', 'balance', 'saldo cont'];

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function encontraColuna(cabecalho, sinonimos) {
  for (let i = 0; i < cabecalho.length; i += 1) {
    const c = norm(cabecalho[i]);
    if (!c) continue;
    for (const s of sinonimos) {
      if (c === s || c.startsWith(s)) return i;
    }
  }
  return -1;
}

/** Divide uma linha CSV respeitando aspas. */
function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function detectaSeparador(linha) {
  const contagens = [';', ',', '\t'].map((sep) => ({ sep, n: linha.split(sep).length }));
  contagens.sort((a, b) => b.n - a.n);
  return contagens[0].n > 1 ? contagens[0].sep : ';';
}

/**
 * @param {string} textoCsv  conteúdo completo do ficheiro
 * @returns {{ transacoes: Array<{data, descricao, valor, tipo, saldo}>, erros: string[] }}
 */
export function parseCsvExtrato(textoCsv) {
  const linhas = String(textoCsv || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const erros = [];
  if (linhas.length === 0) return { transacoes: [], erros: ['Ficheiro vazio.'] };

  // Encontra a linha de cabeçalho + separador.
  let header = null;
  let headerIdx = -1;
  let sep = ';';
  for (let i = 0; i < Math.min(linhas.length, 25); i += 1) {
    const s = detectaSeparador(linhas[i]);
    const cols = splitCsvLine(linhas[i], s);
    const temData = encontraColuna(cols, SIN_DATA) >= 0;
    const temValor = encontraColuna(cols, SIN_VALOR) >= 0
      || (encontraColuna(cols, SIN_DEBITO) >= 0 && encontraColuna(cols, SIN_CREDITO) >= 0);
    if (temData && temValor) {
      header = cols;
      headerIdx = i;
      sep = s;
      break;
    }
  }
  if (!header) {
    return { transacoes: [], erros: ['Não foi encontrado um cabeçalho reconhecível (data + montante/descritivo).'] };
  }

  const iData = encontraColuna(header, SIN_DATA);
  const iDesc = encontraColuna(header, SIN_DESC);
  const iValor = encontraColuna(header, SIN_VALOR);
  const iDeb = encontraColuna(header, SIN_DEBITO);
  const iCred = encontraColuna(header, SIN_CREDITO);
  const iSaldo = encontraColuna(header, SIN_SALDO);

  const transacoes = [];
  for (let i = headerIdx + 1; i < linhas.length; i += 1) {
    const cols = splitCsvLine(linhas[i], sep);
    if (cols.every((c) => !c)) continue;
    const data = parseDataFlex(cols[iData]);
    if (!data) {
      erros.push(`Linha ${i + 1}: data ilegível ("${cols[iData] ?? ''}").`);
      continue;
    }
    let valor = null;
    let tipo = null;
    if (iValor >= 0 && cols[iValor]) {
      const v = parseMontante(cols[iValor]);
      if (v == null) {
        erros.push(`Linha ${i + 1}: montante ilegível ("${cols[iValor]}").`);
        continue;
      }
      valor = round2(Math.abs(v));
      tipo = v >= 0 ? 'credito' : 'debito';
    } else {
      const deb = iDeb >= 0 && cols[iDeb] ? parseMontante(cols[iDeb]) : null;
      const cred = iCred >= 0 && cols[iCred] ? parseMontante(cols[iCred]) : null;
      if (cred != null && cred !== 0) { valor = round2(Math.abs(cred)); tipo = 'credito'; }
      else if (deb != null && deb !== 0) { valor = round2(Math.abs(deb)); tipo = 'debito'; }
      else {
        erros.push(`Linha ${i + 1}: sem montante nas colunas de débito/crédito.`);
        continue;
      }
    }
    const saldoRaw = iSaldo >= 0 && cols[iSaldo] ? parseMontante(cols[iSaldo]) : null;
    transacoes.push({
      data,
      descricao: iDesc >= 0 ? (cols[iDesc] || '') : '',
      valor,
      tipo,
      saldo: saldoRaw,
    });
  }
  return { transacoes, erros };
}
