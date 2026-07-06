/*
 * Ponte fina para a biblioteca `pdf-lib` (v1) - o ÚNICO sítio da app que toca em
 * PDF. Mantém o resto da app (páginas, motor) livre de pdf-lib: aqui detetam-se
 * os campos AcroForm, preenchem-se e achata-se (flatten) o formulário, tudo no
 * BROWSER. Os PDF do utilizador nunca saem da página até serem exportados para o
 * dossiê. O motor determinístico (impressão digital, mapeamento) vive à parte em
 * ../engine/forms.mjs e não depende deste módulo.
 *
 * Usa `instanceof` (não `constructor.name`) para classificar os campos, de modo
 * a ser imune à minificação do bundle.
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
} from 'pdf-lib';

/* base64 -> Uint8Array (decodifica em bloco, sem estourar a pilha). */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* Uint8Array -> base64 (em blocos de 32 KiB para não exceder o limite de args). */
export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* Lê um File/Blob do browser para bytes. */
export async function fileToBytes(file) {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/* Classifica um campo AcroForm no vocabulário da app: text|checkbox|dropdown. */
function tipoDoCampo(field) {
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
    return 'dropdown';
  }
  if (field instanceof PDFTextField) return 'text';
  // Assinaturas/botões e afins não são preenchíveis por texto - tratamo-los como
  // texto só para os listar; o preenchimento ignora-os com segurança.
  return 'text';
}

/**
 * Deteta a estrutura de um PDF a partir dos seus bytes. Não muta nada.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{
 *   tipoPdf: 'acroform'|'plano',
 *   paginas: number,
 *   pageSizes: Array<{width:number, height:number}>,
 *   camposDetectados: Array<{nome:string, tipo:string, pagina:number,
 *     x?:number, y?:number, w?:number, h?:number}>,
 *   fieldNames: string[]
 * }>}
 */
export async function detectForm(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const pageSizes = pages.map((p) => {
    const s = p.getSize();
    return { width: s.width, height: s.height };
  });
  const refToIndex = new Map();
  pages.forEach((p, i) => refToIndex.set(p.ref, i));

  let fields = [];
  try {
    fields = doc.getForm().getFields();
  } catch {
    fields = [];
  }

  const camposDetectados = [];
  for (const field of fields) {
    const nome = field.getName();
    if (!nome) continue;
    const tipo = tipoDoCampo(field);
    let pagina = 0;
    let rect = null;
    try {
      for (const w of field.acroField.getWidgets()) {
        const p = typeof w.P === 'function' ? w.P() : undefined;
        if (p && refToIndex.has(p)) pagina = refToIndex.get(p);
        try {
          const r = w.getRectangle();
          rect = { x: r.x, y: r.y, w: r.width, h: r.height };
        } catch {
          /* alguns widgets não têm rectângulo legível - fica sem rect */
        }
      }
    } catch {
      /* sem widgets legíveis: fica na página 0, sem rect */
    }
    const campo = { nome, tipo, pagina };
    if (rect) Object.assign(campo, rect);
    camposDetectados.push(campo);
  }

  return {
    tipoPdf: camposDetectados.length > 0 ? 'acroform' : 'plano',
    paginas: pages.length,
    pageSizes,
    camposDetectados,
    fieldNames: camposDetectados.map((c) => c.nome),
  };
}

/** Um valor de checkbox conta como "marcado"? (aceita bool, 'sim', 'true', '1', 'x'.) */
function marca(valor) {
  const s = String(valor == null ? '' : valor).trim().toLowerCase();
  return s === 'true' || s === 'sim' || s === '1' || s === 'x' || s === 'on' || s === 'yes';
}

/**
 * Preenche o AcroForm do PDF-base com os valores resolvidos e achata o
 * formulário (os valores deixam de ser editáveis, ficam impressos). Cada campo é
 * tratado num try/catch próprio: um campo problemático é ignorado sem abortar o
 * preenchimento dos restantes.
 *
 * @param {{ pdfBase64: string,
 *   resolved: Array<{campo:string, valor:string}>,
 *   camposDetectados: Array<{nome:string, tipo:string}> }} input
 * @returns {Promise<Uint8Array>} bytes do PDF preenchido e achatado
 */
export async function fillAndFlatten({ pdfBase64, resolved, camposDetectados }) {
  const doc = await PDFDocument.load(base64ToBytes(pdfBase64), { ignoreEncryption: true });
  const form = doc.getForm();
  const valorByCampo = new Map((resolved || []).map((r) => [r.campo, r.valor]));
  const tipoByCampo = new Map((camposDetectados || []).map((c) => [c.nome, c.tipo]));

  for (const field of form.getFields()) {
    const nome = field.getName();
    if (!valorByCampo.has(nome)) continue;
    const valor = valorByCampo.get(nome);
    const tipo = tipoByCampo.get(nome) || 'text';
    try {
      if (tipo === 'checkbox') {
        const cb = form.getCheckBox(nome);
        if (marca(valor)) cb.check(); else cb.uncheck();
      } else if (tipo === 'dropdown') {
        const dd = form.getDropdown(nome);
        const opts = dd.getOptions();
        if (valor && opts.includes(valor)) dd.select(valor);
      } else {
        form.getTextField(nome).setText(String(valor == null ? '' : valor));
      }
    } catch {
      /* campo não preenchível ou em conflito de tipo: ignora-o */
    }
  }

  try {
    form.flatten();
  } catch {
    /* se o flatten falhar, exporta na mesma o PDF com os valores preenchidos */
  }
  return doc.save();
}
