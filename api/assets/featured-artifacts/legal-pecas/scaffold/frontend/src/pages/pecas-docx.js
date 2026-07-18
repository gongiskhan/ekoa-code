/*
 * Construtor de documento em .docx a partir do CORPO de uma peça - MÓDULO PURO.
 *
 * Mesma via de geração de .docx do resto da suite (Contratos): a biblioteca
 * `docx` (v9) constrói o `Document`, empacotado no BROWSER via
 * `Packer.toBlob(doc)`. O módulo não toca em `window`, não chama `new Date()` ao
 * nível do módulo e não tem efeitos colaterais - recebe o corpo já pronto.
 *
 * PARIDADE DE QUALIDADE com os Contratos: os cabeçalhos das peças ganham estilos
 * de título REAIS do Word (Title/Heading 1), pelo que o painel de navegação do
 * Word/LibreOffice mostra a árvore da peça ("I. DOS FACTOS", "II. DO DIREITO",
 * "III. DO PEDIDO"); os articulados numerados ("1. …") usam uma lista numerada
 * automática (w:numPr no document.xml). A 1.ª linha em maiúsculas (o
 * endereçamento "EXMO. SENHOR DOUTOR JUIZ DE DIREITO") é o título do documento.
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

/* Referência única da lista numerada dos articulados da peça. */
const NUMBERING_REF = 'ekoa-articulados';

/*
 * Prefixos estruturais de uma cláusula/secção jurídica. Permitem reconhecer um
 * cabeçalho mesmo com um rótulo parentético em caixa mista, ex.:
 * "CLÁUSULA PRIMEIRA (Objecto)" ou "ARTIGO 5.º (Renda)".
 */
const HEADING_PREFIX = /^(?:CL[ÁA]USULA|ARTIGO|ART\.?º?|CAP[ÍI]TULO|SEC[ÇC][ÃA]O|T[ÍI]TULO)\b/i;

/*
 * Uma linha é CABEÇALHO quando, aparada, tem pelo menos duas letras e ou está
 * inteiramente em MAIÚSCULAS (os cabeçalhos das peças, como "I. DOS FACTOS" ou
 * "EXMO. SENHOR DOUTOR JUIZ DE DIREITO"), ou é uma cláusula/secção com um rótulo
 * parentético em caixa mista - a parte antes do parêntese continua em maiúsculas.
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
 * Uma linha é ARTICULADO NUMERADO quando começa por um número seguido de ponto
 * (com o "º"/"ª" ordinal opcional) e um espaço: "1. ", "2.º ", "10. ". Devolve o
 * texto já sem o marcador (a numeração passa a ser gerada pelo Word). Caso
 * contrário devolve null.
 */
function stripNumberedItem(line) {
  const m = line.match(/^\s*\d+\s*[.ºª)]\s+(.*)$/);
  return m ? m[1] : null;
}

/*
 * Constrói o Document a partir do corpo (texto com quebras de linha). A primeira
 * linha em maiúsculas é o título do documento; as restantes linhas em maiúsculas
 * são cabeçalhos de secção; as linhas "N. …" são articulados de uma lista
 * numerada real; o resto é corpo justificado. As linhas em branco viram
 * parágrafos vazios (espaçamento).
 */
export function buildPecaDocx({ corpo }) {
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

    // Articulado numerado -> parágrafo de lista numerada (numeração do Word).
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
