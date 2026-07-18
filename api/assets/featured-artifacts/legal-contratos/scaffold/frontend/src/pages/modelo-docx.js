/*
 * Construtor de documento em .docx a partir do CORPO já substituído de um modelo
 * de contrato - MÓDULO PURO.
 *
 * Usa a biblioteca `docx` (v9), com o `Document` a ser empacotado no BROWSER via
 * `Packer.toBlob(doc)` (Promise<Blob>) - a mesma via de geração de .docx do resto
 * da suite. Constrói a partir de texto livre com {{chaves}} já resolvidas.
 *
 * QUALIDADE Word (não apenas negrito): o corpo é classificado linha a linha em
 *   - TÍTULO do documento (1.ª linha em maiúsculas)        -> estilo Title
 *   - CABEÇALHO de cláusula/secção ("CLÁUSULA PRIMEIRA…",
 *     "I. DOS FACTOS", "EXMO. SENHOR…")                    -> Heading 1
 *   - ITEM NUMERADO ("1. …", "1.º …")                      -> lista numerada real
 *   - corpo normal                                          -> parágrafo justificado
 * Os cabeçalhos ganham estilos de título REAIS do Word (styleId Heading1/Title),
 * pelo que o painel de navegação do Word/LibreOffice mostra a árvore do documento
 * e os itens numerados usam uma numeração automática (w:numPr no document.xml).
 *
 * O módulo não toca em `window`, não chama `new Date()` ao nível do módulo e não
 * tem efeitos colaterais - recebe o corpo já substituído.
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  convertInchesToTwip,
} from 'docx';

/* Referência única da lista numerada das cláusulas/artigos do corpo. */
const NUMBERING_REF = 'ekoa-clausulas';

/*
 * Prefixos estruturais de uma cláusula/secção jurídica. Permitem reconhecer um
 * cabeçalho mesmo com um rótulo parentético em caixa mista, ex.:
 * "CLÁUSULA PRIMEIRA (Objecto)" ou "ARTIGO 5.º (Renda)".
 */
const HEADING_PREFIX = /^(?:CL[ÁA]USULA|ARTIGO|ART\.?º?|CAP[ÍI]TULO|SEC[ÇC][ÃA]O|T[ÍI]TULO)\b/i;

/*
 * Uma linha é CABEÇALHO quando, aparada, tem pelo menos duas letras e ou está
 * inteiramente em MAIÚSCULAS (as linhas estruturais das minutas, como
 * "CONTRATO DE PRESTAÇÃO DE SERVIÇOS" ou "EXMO. SENHOR DOUTOR JUIZ DE DIREITO"),
 * ou é uma cláusula/secção com um rótulo parentético em caixa mista
 * ("CLÁUSULA PRIMEIRA (Objecto)") - a parte antes do parêntese continua em
 * maiúsculas, só o rótulo entre parênteses é minúsculo.
 */
function isHeading(line) {
  const t = line.trim();
  if (!t) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 2) return false;
  if (t === t.toUpperCase() && /[A-ZÀ-Þ]/.test(t)) return true;
  if (HEADING_PREFIX.test(t)) {
    const beforeParen = t.replace(/\(.*$/, '').trim();
    const bletters = beforeParen.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (bletters.length >= 2 && beforeParen === beforeParen.toUpperCase()) return true;
  }
  return false;
}

/*
 * Uma linha é ITEM NUMERADO quando começa por um número seguido de ponto (com o
 * "º"/"ª" ordinal opcional) e um espaço: "1. ", "2.º ", "10. ". Devolve o texto
 * já sem o marcador (a numeração passa a ser gerada pelo Word). Caso contrário
 * devolve null.
 */
function stripNumberedItem(line) {
  const m = line.match(/^\s*\d+\s*[.ºª)]\s+(.*)$/);
  return m ? m[1] : null;
}

/*
 * Constrói o Document a partir do corpo (texto com quebras de linha já
 * substituído). A primeira linha em maiúsculas é o título do documento; as
 * restantes linhas em maiúsculas são cabeçalhos de secção; as linhas "N. …" são
 * itens de uma lista numerada real; o resto é corpo justificado. As linhas em
 * branco viram parágrafos vazios (espaçamento).
 */
export function buildModeloDocx({ corpo }) {
  const text = String(corpo == null ? '' : corpo);
  const lines = text.split('\n');

  let tituloUsado = false;
  const children = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return new Paragraph({ spacing: { after: 120 }, children: [] });
    }

    // Primeiro cabeçalho do documento -> Título (Title); restantes -> Heading 1.
    if (isHeading(trimmed)) {
      if (!tituloUsado) {
        tituloUsado = true;
        return new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: trimmed })],
        });
      }
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: trimmed })],
      });
    }

    // Item numerado -> parágrafo de lista numerada (numeração gerada pelo Word).
    const item = stripNumberedItem(line);
    if (item != null) {
      return new Paragraph({
        numbering: { reference: NUMBERING_REF, level: 0 },
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120 },
        children: [new TextRun({ text: item })],
      });
    }

    // Corpo normal -> parágrafo justificado.
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 120 },
      children: [new TextRun({ text: line })],
    });
  });

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  }

  return new Document({
    numbering: {
      config: [
        {
          reference: NUMBERING_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });
}
