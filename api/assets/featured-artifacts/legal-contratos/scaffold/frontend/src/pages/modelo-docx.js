/*
 * Construtor de documento em .docx a partir do CORPO já substituído de um modelo
 * de contrato - MÓDULO PURO.
 *
 * Usa a biblioteca `docx` (v9), com o `Document` a ser empacotado no BROWSER via
 * `Packer.toBlob(doc)` (Promise<Blob>) - a mesma via de geração de .docx do resto
 * da suite. Constrói a partir de texto livre com {{chaves}} já resolvidas.
 *
 * O módulo não toca em `window`, não chama `new Date()` ao nível do módulo e não
 * tem efeitos colaterais - recebe o corpo já substituído.
 */

import { Document, Paragraph, TextRun } from 'docx';

/*
 * Heurística de título: uma linha não vazia, com pelo menos duas letras, escrita
 * inteiramente em MAIÚSCULAS (as linhas de cabeçalho das minutas, como
 * "CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS" ou "CLÁUSULA PRIMEIRA (Objecto)").
 * Estas saem a negrito, dando ao documento uma estrutura limpa e editável.
 */
function isHeading(line) {
  const t = line.trim();
  if (!t) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 2) return false;
  return t === t.toUpperCase() && /[A-ZÀ-Þ]/.test(t);
}

/*
 * Constrói o Document a partir do corpo (texto com quebras de linha já
 * substituído). Cada linha vira um parágrafo; as linhas em branco viram
 * parágrafos vazios (espaçamento); os cabeçalhos saem a negrito.
 */
export function buildModeloDocx({ corpo }) {
  const text = String(corpo == null ? '' : corpo);
  const lines = text.split('\n');

  const children = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return new Paragraph({ spacing: { after: 120 }, children: [] });
    }
    const heading = isHeading(trimmed);
    return new Paragraph({
      spacing: { before: heading ? 160 : 0, after: heading ? 140 : 120 },
      children: [new TextRun({ text: line, bold: heading })],
    });
  });

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  }

  return new Document({ sections: [{ properties: {}, children }] });
}
