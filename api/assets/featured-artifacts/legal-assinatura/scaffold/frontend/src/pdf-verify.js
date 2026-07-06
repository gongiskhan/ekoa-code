/*
 * Verificação de PRESENÇA de assinatura digital num PDF - âmbito honesto.
 *
 * NÃO valida a assinatura criptograficamente nem afere validade jurídica. Faz um
 * varrimento determinístico dos bytes do PDF à procura dos marcadores de um
 * dicionário de assinatura (/ByteRange, /SubFilter, /Type /Sig) e reporta o que
 * encontrou. A validação qualificada faz-se no validador oficial
 * (validador.autenticacao.gov.pt) - a UI apresenta sempre esse aviso e o link.
 *
 * Trabalha diretamente sobre o ArrayBuffer (sem pdf-lib): os tokens de estrutura
 * de um PDF são ASCII, pelo que um varrimento em Latin1 é fiável e barato, e
 * evita empacotar a biblioteca só para ler cabeçalhos.
 */

/** Ligação para o validador oficial de assinaturas do Estado. */
export const VALIDADOR_OFICIAL_URL = 'https://validador.autenticacao.gov.pt';

/** Aviso formal, invariável, apresentado com qualquer resultado. */
export const AVISO_VERIFICACAO =
  'Verificação de presença de assinatura, não de validade jurídica. A validação qualificada é feita no validador oficial.';

/** SubFilter -> descrição legível do formato de assinatura. */
const SUBFILTER_DESC = {
  'adbe.pkcs7.detached': 'PKCS#7 destacada (Adobe)',
  'adbe.pkcs7.sha1': 'PKCS#7 SHA-1 (Adobe)',
  'adbe.x509.rsa_sha1': 'X.509 RSA SHA-1 (Adobe)',
  'ETSI.CAdES.detached': 'CAdES destacada (ETSI - PAdES)',
  'ETSI.RFC3161': 'Carimbo do tempo (ETSI RFC 3161)',
};

/** Bytes (Uint8Array/ArrayBuffer) -> string Latin1 para varrimento de tokens ASCII. */
function toLatin1(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('latin1').decode(u8);
  } catch {
    // Fallback sem TextDecoder: reconstrói em blocos.
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return s;
  }
}

/**
 * Analisa os bytes de um PDF e devolve um resumo da presença de assinatura.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {{
 *   assinado: boolean,
 *   temByteRange: boolean,
 *   dicionariosSig: number,
 *   subFilters: string[],
 *   subFilterPrincipal: string|null,
 *   subFilterDescricao: string|null,
 *   ehPdf: boolean,
 *   aviso: string,
 *   validadorUrl: string
 * }}
 */
export function verificarAssinaturaPdf(bytes) {
  const texto = toLatin1(bytes);
  const ehPdf = texto.slice(0, 1024).includes('%PDF-');

  const temByteRange = /\/ByteRange\s*\[/.test(texto);
  const dicionariosSig = (texto.match(/\/Type\s*\/Sig\b/g) || []).length;

  const subFilters = [];
  const re = /\/SubFilter\s*\/([A-Za-z0-9.\-_]+)/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    if (!subFilters.includes(m[1])) subFilters.push(m[1]);
  }

  const subFilterPrincipal = subFilters[0] || null;
  const subFilterDescricao = subFilterPrincipal ? (SUBFILTER_DESC[subFilterPrincipal] || subFilterPrincipal) : null;

  // "Contém assinatura digital": um /ByteRange (o intervalo assinado) mais um
  // dicionário de assinatura OU um /SubFilter de assinatura. Um /ByteRange
  // isolado não basta; um /SubFilter de assinatura com /ByteRange é conclusivo.
  const assinado = ehPdf && temByteRange && (dicionariosSig > 0 || subFilters.length > 0);

  return {
    assinado,
    temByteRange,
    dicionariosSig,
    subFilters,
    subFilterPrincipal,
    subFilterDescricao,
    ehPdf,
    aviso: AVISO_VERIFICACAO,
    validadorUrl: VALIDADOR_OFICIAL_URL,
  };
}

/** Lê um File/Blob do browser e verifica-o. */
export async function verificarFicheiro(file) {
  const buf = await file.arrayBuffer();
  return verificarAssinaturaPdf(buf);
}
