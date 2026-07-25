#!/usr/bin/env node
/**
 * Regenerate web/e2e/fixtures/contrato-redline.docx - the committed .docx the
 * document-redline e2e spec seeds straight into EKOA_DATA_DIR.
 *
 *   npm run build --workspace api && node scripts/make-redline-fixture.mjs
 *
 * The spec must start from a document that ALREADY carries native Word tracked
 * changes and a comment thread (there is no LLM in that spec, and the review UI
 * has nothing to accept/reply to otherwise). Producing those bytes by hand is
 * not practical, so they are generated HERE, with the product's own engine
 * (api/src/services/docx-redline.ts over @adeu/core), and committed. Keeping the
 * generator in the tree is what makes the binary fixture auditable and
 * reproducible when the engine moves.
 *
 * The result deliberately holds THREE anchors:
 *   - two INDEPENDENT tracked replacements, so the spec can accept one and still
 *     assert w:ins/w:del survive in the downloaded file;
 *   - one comment-only change, the thread the spec replies to and resolves.
 *
 * Synthetic data only (house rule): invented parties, no real NIF/NIPC.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun,
} from 'docx';
import { applyRedline, projectDocx } from '../api/dist/services/docx-redline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web/e2e/fixtures/contrato-redline.docx');

const AUTHOR = 'Marta Nunes (Ekoa)';

const p = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text, ...opts })] });
const h = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text })] });

async function baseContract() {
  const doc = new Document({
    creator: 'Ekoa Fixture',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS', bold: true })],
          }),
          p('Entre SILVA & ASSOCIADOS, SOCIEDADE DE ADVOGADOS, SP, RL, com sede em Lisboa, doravante designada por Prestadora, e TECNOVERDE - ENERGIAS RENOVÁVEIS, S.A., com sede no Porto, doravante designada por Cliente, é celebrado o presente contrato.'),
          h('CLÁUSULA PRIMEIRA - Objeto'),
          p('A Prestadora obriga-se a prestar ao Cliente serviços de consultoria e assessoria jurídica, incluindo a elaboração de pareceres e a revisão de contratos.'),
          h('CLÁUSULA SEGUNDA - Prazo'),
          p('O presente contrato tem a duração de um ano, renovável automaticamente por períodos sucessivos de igual duração.'),
          p('Qualquer das partes pode denunciar o contrato mediante aviso prévio de 30 dias, comunicado por carta registada com aviso de receção.'),
          h('CLÁUSULA TERCEIRA - Honorários'),
          p('Pela prestação dos serviços, o Cliente pagará à Prestadora uma avença mensal de EUR 4.500,00, acrescida de IVA à taxa legal em vigor.'),
          h('CLÁUSULA QUARTA - Confidencialidade'),
          p('As partes obrigam-se a manter estrita confidencialidade sobre todas as informações a que tenham acesso no âmbito do presente contrato.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const OPS = [
  // 1. Tracked replacement the spec ACCEPTS in the UI.
  {
    type: 'modify',
    target_text: 'uma avença mensal de EUR 4.500,00',
    new_text: 'uma avença mensal de EUR 5.000,00',
  },
  // 2. A SECOND, independent replacement: it stays pending after (1) is accepted,
  //    so the downloaded .docx still proves w:ins + w:del.
  {
    type: 'modify',
    target_text: 'aviso prévio de 30 dias',
    new_text: 'aviso prévio de 60 dias',
  },
  // 3. Comment-only change (new_text === target_text): the thread the spec
  //    replies to and resolves.
  {
    type: 'modify',
    target_text: 'As partes obrigam-se a manter estrita confidencialidade sobre todas as informações a que tenham acesso no âmbito do presente contrato.',
    new_text: 'As partes obrigam-se a manter estrita confidencialidade sobre todas as informações a que tenham acesso no âmbito do presente contrato.',
    comment: 'Falta o prazo de sobrevivência da obrigação após a cessação do contrato.',
  },
];

const base = Buffer.from(await baseContract());
const { buffer, report } = await applyRedline(base, OPS, { author: AUTHOR });
writeFileSync(OUT, buffer);

console.log(`[fixture] ${OUT} (${buffer.length} bytes)`);
console.log(`[fixture] edits applied: ${report.edits_applied}, skipped: ${report.edits_skipped}`);
console.log('[fixture] projection:\n');
console.log(await projectDocx(buffer));
