/**
 * Test fixture: a realistic PT-PT legal services contract, generated with the
 * docx lib (same approach as the /tmp/adeu-spike make-fixture script, but with
 * proper PT-PT accents - accent handling in target matching is part of what
 * the suite verifies).
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from 'docx';

const numbering = {
  config: [
    {
      reference: 'clausulas',
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: {
            paragraph: {
              indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) },
            },
          },
        },
      ],
    },
  ],
};

const p = (children: TextRun[], opts: Record<string, unknown> = {}): Paragraph =>
  new Paragraph({ children, spacing: { after: 200 }, ...opts });
const t = (text: string, opts: Record<string, unknown> = {}): TextRun =>
  new TextRun({ text, ...opts });
const clause = (children: TextRun[]): Paragraph =>
  p(children, { numbering: { reference: 'clausulas', level: 0 } });
const heading = (text: string): Paragraph =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(text)] });

export async function makeContratoFixture(): Promise<Buffer> {
  const doc = new Document({
    creator: 'Ekoa Fixture',
    numbering,
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: 24 } } },
    },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [t('CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS', { bold: true })],
          }),
          p([
            t('Entre '),
            t('SILVA & ASSOCIADOS, SOCIEDADE DE ADVOGADOS, SP, RL', { bold: true }),
            t(', com sede na Avenida da Liberdade, n.º 120, em Lisboa, doravante designada por '),
            t('Prestadora', { bold: true }),
            t(', e '),
            t('TECNOVERDE - ENERGIAS RENOVÁVEIS, S.A.', { bold: true }),
            t(', com sede no Porto, doravante designada por '),
            t('Cliente', { bold: true }),
            t(
              ', é celebrado o presente contrato de prestação de serviços, que se rege pelas cláusulas seguintes:',
            ),
          ]),

          heading('CLÁUSULA PRIMEIRA - Objeto'),
          clause([
            t(
              'A Prestadora obriga-se a prestar ao Cliente serviços de consultoria e assessoria jurídica, incluindo, ',
            ),
            t('nomeadamente', { italics: true }),
            t(
              ', a elaboração de pareceres, a revisão de contratos e a representação em processos administrativos.',
            ),
          ]),
          clause([
            t(
              'Os serviços serão prestados nas instalações da Prestadora ou, quando necessário, nas instalações do Cliente.',
            ),
          ]),

          heading('CLÁUSULA SEGUNDA - Prazo'),
          clause([
            t(
              'O presente contrato tem a duração de um ano, renovável automaticamente por períodos sucessivos de igual duração. ',
            ),
            t(
              'Qualquer das partes pode denunciar o contrato mediante aviso prévio de 30 dias, comunicado por carta registada com aviso de receção.',
            ),
          ]),

          heading('CLÁUSULA TERCEIRA - Honorários'),
          clause([
            t('Pela prestação dos serviços, o Cliente pagará à Prestadora uma avença mensal de '),
            t('EUR 4.500,00 (quatro mil e quinhentos euros)', { bold: true }),
            t(
              ', acrescida de IVA à taxa legal em vigor. O pagamento será efetuado até ao dia 8 de cada mês.',
            ),
          ]),
          clause([
            t(
              'As despesas com deslocações fora da área metropolitana de Lisboa serão faturadas separadamente. ',
            ),
            t(
              'A falta de pagamento pontual constitui o Cliente em mora, vencendo juros à taxa legal.',
            ),
          ]),

          heading('CLÁUSULA QUARTA - Confidencialidade'),
          clause([
            t(
              'As partes obrigam-se a manter estrita confidencialidade sobre todas as informações a que tenham acesso no âmbito do presente contrato, ',
            ),
            t('incluindo após a sua cessação', { italics: true }),
            t(
              '. A presente obrigação mantém-se por um período de cinco anos após o termo do contrato.',
            ),
          ]),

          heading('CLÁUSULA QUINTA - Lei aplicável e foro'),
          clause([
            t(
              'O presente contrato rege-se pela lei portuguesa. Para a resolução de qualquer litígio emergente do presente contrato, as partes elegem o foro da comarca de Lisboa, com expressa renúncia a qualquer outro.',
            ),
          ]),

          p([
            t(
              'Feito em duplicado, em Lisboa, aos 15 dias do mês de julho de 2026, ficando cada parte com um exemplar.',
            ),
          ]),
          p([t('')]),
          p([t('Pela Prestadora: ______________________')]),
          p([t('Pelo Cliente: ______________________')]),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
