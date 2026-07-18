/*
 * Divisão CONSERVADORA de um texto colado em várias notificações Citius.
 * Determinística e com viés para NÃO dividir: um falso split podia fabricar
 * uma linha de revisão fantasma; sem split, o parser continua a proteger
 * (vários processos no mesmo texto => "vários números de processo" => revisão).
 *
 * Regras, por ordem:
 *  1. Linhas separadoras explícitas (---, ===, ___ com 3+) dividem sempre -
 *     são intenção inequívoca de quem colou.
 *  2. Sem separadores: blocos por linha em branco SÓ dividem quando há 2+
 *     blocos e TODOS parecem notificações completas (número de processo E
 *     (ato conhecido OU rótulo "data do acto")). Um cabeçalho órfão ou um
 *     rodapé nunca passam este teste, logo nunca geram uma "notificação".
 *  3. Caso contrário: um único segmento (comportamento histórico intacto).
 */
import { ATOS } from '../engine/citius-parser.mjs';

const RE_SEPARADOR = /^[ \t]*[-_=]{3,}[ \t]*$/;
// O mesmo padrão de número de processo do parser (sem flag global: só teste).
const RE_PROCESSO = /\b\d{1,6}\/\d{2}\.\d[A-Z]\d?[A-Z]{2,4}\b/;
const RE_DATA_ROTULADA = /\bdata\s+d[oae]\s+(?:acto|ato|notifica[çc][ãa]o)\b/i;

function parecemNotificacao(bloco) {
  if (!RE_PROCESSO.test(bloco)) return false;
  return ATOS.some((a) => a.re.test(bloco)) || RE_DATA_ROTULADA.test(bloco);
}

/** @returns {string[]} 1+ segmentos não vazios; [texto] quando não divide. */
export function splitNotificacoes(raw) {
  const texto = String(raw == null ? '' : raw).trim();
  if (!texto) return [texto];

  const linhas = texto.split(/\r?\n/);
  const grupos = [[]];
  let temSeparador = false;
  for (const linha of linhas) {
    if (RE_SEPARADOR.test(linha)) {
      temSeparador = true;
      grupos.push([]);
    } else {
      grupos[grupos.length - 1].push(linha);
    }
  }
  if (temSeparador) {
    const segmentos = grupos.map((g) => g.join('\n').trim()).filter(Boolean);
    return segmentos.length > 0 ? segmentos : [texto];
  }

  const blocos = texto
    .split(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocos.length >= 2 && blocos.every(parecemNotificacao)) return blocos;

  return [texto];
}
