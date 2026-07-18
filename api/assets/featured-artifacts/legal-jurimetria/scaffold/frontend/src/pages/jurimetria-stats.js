/*
 * Lógica pura da Jurimetria - app-local (vive só neste app). Sem estado, sem I/O;
 * testável isoladamente. Constrói as estatísticas descritivas do comparador
 * interno com a PROVENIÊNCIA de cada número (fonte + período), e impõe a regra da
 * honestidade estatística: uma média só é mostrada com uma amostra suficiente;
 * abaixo disso o estado é "sem dados suficientes", nunca um número enganador.
 *
 * PRINCÍPIO: nenhuma estatística sem fonte+período. A média interna cita a própria
 * amostra do escritório e o intervalo de datas de fecho dos processos findos; a
 * média pública cita a referência DGPJ e o seu período (referencias.json). Uma
 * área sem referência publicada di-lo ("sem referência"), nunca inventa um valor.
 */

/* Amostra mínima para publicar uma média interna. Abaixo disto, a dispersão de 1-2
 * processos torna a média enganadora - preferimos dizer "sem dados suficientes". */
export const AMOSTRA_MINIMA = 3;

/* Meses entre duas datas ISO (aproximação a 30,44 dias/mês - suficiente para
 * médias históricas). Null quando qualquer data é inválida. */
export function mesesEntre(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.max(0, (db.getTime() - da.getTime()) / (30.44 * 86400000));
}

function arredonda1(x) {
  return Math.round(x * 10) / 10;
}

/* Ordena datas ISO e devolve o par [mais_antiga, mais_recente] (ano). Vazio -> null. */
function intervaloAnos(datas) {
  const validas = datas.filter(Boolean).map((d) => String(d).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)).sort();
  if (validas.length === 0) return null;
  const min = validas[0];
  const max = validas[validas.length - 1];
  return min === max ? min : `${min}-${max}`;
}

/*
 * Constrói as linhas do comparador por área a partir dos processos findos do
 * escritório e das referências públicas. Cada linha traz:
 *   { area, n, mediaMeses|null, suficiente, periodoInterno, refMeses|null,
 *     refFonte|null, refPeriodo|null }
 * - `suficiente` é false quando n < AMOSTRA_MINIMA: a média interna NÃO é mostrada
 *   (estado honesto "sem dados suficientes").
 */
export function construirLinhas(processos, referencias) {
  const grupos = {};
  for (const p of processos || []) {
    if (!p || p.estado !== 'arquivado' || !p.dataAbertura || !p.dataFecho) continue;
    const m = mesesEntre(p.dataAbertura, p.dataFecho);
    if (m == null) continue;
    (grupos[p.area || 'Outra'] ||= []).push({ meses: m, fecho: p.dataFecho });
  }

  const refByArea = new Map((referencias && referencias.referencias ? referencias.referencias : []).map((r) => [r.area, r]));
  const refFonte = (referencias && referencias.fonte) || null;
  const refPeriodo = (referencias && referencias.periodo) || null;

  return Object.entries(grupos)
    .map(([area, amostra]) => {
      const n = amostra.length;
      const suficiente = n >= AMOSTRA_MINIMA;
      const mediaMeses = suficiente ? arredonda1(amostra.reduce((s, x) => s + x.meses, 0) / n) : null;
      const periodoInterno = intervaloAnos(amostra.map((x) => x.fecho));
      const ref = refByArea.get(area) || null;
      return {
        area,
        n,
        mediaMeses,
        suficiente,
        periodoInterno,
        refMeses: ref ? ref.duracaoMediaMeses : null,
        refFonte: ref ? refFonte : null,
        refPeriodo: ref ? refPeriodo : null,
      };
    })
    .sort((a, b) => b.n - a.n);
}

/* Total de processos findos usados no comparador (soma das amostras por área). */
export function totalFindos(linhas) {
  return (linhas || []).reduce((s, l) => s + l.n, 0);
}

/* Verdadeiro quando NENHUMA área tem amostra suficiente para publicar uma média -
 * o comparador está honestamente sem dados. */
export function comparadorSemDados(linhas) {
  return (linhas || []).every((l) => !l.suficiente);
}

/* Texto da proveniência da média interna de uma linha (fonte + período), para
 * mostrar a par de cada número. Nunca vazio quando há média. */
export function fonteInterna(linha) {
  if (!linha || !linha.suficiente) return null;
  const periodo = linha.periodoInterno ? ` · fechos ${linha.periodoInterno}` : '';
  return `Amostra interna (n=${linha.n}${periodo})`;
}

/* Texto da proveniência da média pública de uma linha (fonte + período). Null
 * quando a área não tem referência publicada. */
export function fontePublica(linha) {
  if (!linha || linha.refMeses == null || !linha.refFonte) return null;
  return `${linha.refFonte}${linha.refPeriodo ? ` · ${linha.refPeriodo}` : ''}`;
}
