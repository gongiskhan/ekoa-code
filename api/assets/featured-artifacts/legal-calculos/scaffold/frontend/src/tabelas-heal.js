// Cura das linhas-marcador de `tabelas_taxas` - app-local do dono (Cálculos).
//
// A espinha semeia linhas-marcador com aviso/nota 'confirmar' para semestres
// que na altura da sementeira não estavam confirmados. Quando a tabela canónica
// do serviço passa a trazer esses períodos VERIFICADOS (Avisos citados), as
// linhas-marcador deixam de acrescentar informação e passam a SOBREPOR-SE à
// tabela verificada (o overlay da espinha ganha ao canónico por semestre/ano).
//
// Esta rotina remove APENAS linhas-marcador literais ('confirmar'); nunca toca
// em linhas escritas pelo crawler/sessão de configuração com um Aviso real, e
// nunca esvazia a colecção (a sementeira só volta a semear uma colecção VAZIA,
// e as linhas de juros civis / retenção IRS ficam sempre).
import { listShared, deleteShared } from './shared.js';

function ehMarcador(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.tipo === 'juros_comerciais') return row.aviso === 'confirmar';
  if (row.tipo === 'uc') return row.nota === 'confirmar';
  return false;
}

let healPromise = null;

export function curarTabelasTaxas() {
  if (!healPromise) {
    healPromise = (async () => {
      const rows = await listShared('tabelas_taxas');
      if (!Array.isArray(rows) || rows.length === 0) return { removidas: 0 };
      const marcadores = rows.filter(ehMarcador);
      // Nunca esvaziar: se (por dados inesperados) tudo fosse marcador, ficar
      // quieto - apagar tudo faria a sementeira repor os marcadores em loop.
      if (marcadores.length === 0 || marcadores.length >= rows.length) return { removidas: 0 };
      let removidas = 0;
      for (const row of marcadores) {
        try {
          await deleteShared('tabelas_taxas', row.id);
          removidas += 1;
        } catch { /* uma falha de rede não pode bloquear o arranque */ }
      }
      return { removidas };
    })().catch(() => ({ removidas: 0 }));
  }
  return healPromise;
}
