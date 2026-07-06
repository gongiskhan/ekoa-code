/*
 * Helpers de LEITURA de prazos partilhados pelo Radar e pela lista - locais a
 * este app (o Prazos é o único a apresentar prazos com urgência). Só derivam
 * vistas a partir das linhas da espinha; nunca escrevem.
 *
 * Compatibilidade de esquema: as linhas mais antigas do registo foram gravadas
 * pela calculadora com `titulo` e sem `origem`; as novas trazem `descricao` +
 * `origem`. Estas funções aceitam ambas.
 */

import { diasRestantes } from '../shared.js';

/* Rótulo principal de um prazo: descrição nova, senão o título antigo. */
export function prazoDescricao(pr) {
  return (pr && (pr.descricao || pr.titulo)) || 'Prazo';
}

/* Origem normalizada: 'citius' ou 'manual' (por omissão). */
export function prazoOrigem(pr) {
  return pr && pr.origem === 'citius' ? 'citius' : 'manual';
}

/*
 * Estado DERIVADO para apresentação/filtragem:
 *  - 'cumprido' quando o prazo foi marcado cumprido;
 *  - 'vencido'  quando ainda pendente mas a data-limite já passou;
 *  - 'pendente' nos restantes casos (por vencer).
 */
export function estadoDerivado(pr) {
  if (!pr) return 'pendente';
  if (pr.estado === 'cumprido') return 'cumprido';
  const d = diasRestantes(pr.dataLimite);
  if (Number.isFinite(d) && d < 0) return 'vencido';
  return 'pendente';
}

/* Texto humano dos dias que faltam: "há N dias" / "hoje" / "em N dias". */
export function diasLabel(d) {
  if (!Number.isFinite(d)) return 'sem data';
  if (d === 0) return 'hoje';
  if (d < 0) {
    const n = Math.abs(d);
    return `há ${n} dia${n === 1 ? '' : 's'}`;
  }
  return `em ${d} dia${d === 1 ? '' : 's'}`;
}

/* Tom do distintivo de urgência para um número de dias restantes. */
export function diasTone(d) {
  if (!Number.isFinite(d)) return 'neutral';
  if (d < 0) return 'alta'; // vencido - vermelho
  if (d <= 7) return 'media'; // hoje ou próximos 7 dias - âmbar
  return 'info'; // mais longe - azul
}

/*
 * Data-limite da janela de multa (art. 139.º n.º 5 CPC), se o prazo a
 * transportar. Aceita o campo novo `multaAte` e as duas formas antigas gravadas
 * em `showWork` (`multaDias[]` do motor actual, `janelaMulta[]` do legado).
 */
export function multaAteOf(pr) {
  if (!pr) return null;
  if (pr.multaAte) return pr.multaAte;
  const sw = pr.showWork;
  if (sw) {
    if (Array.isArray(sw.multaDias) && sw.multaDias.length) {
      return sw.multaDias[sw.multaDias.length - 1];
    }
    if (Array.isArray(sw.janelaMulta) && sw.janelaMulta.length) {
      const last = sw.janelaMulta[sw.janelaMulta.length - 1];
      return last && last.data ? last.data : null;
    }
  }
  return null;
}
