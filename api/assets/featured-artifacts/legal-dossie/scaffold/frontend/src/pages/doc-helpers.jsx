/*
 * Utilitários do workspace de documentos do Dossiê (locais a este app, não
 * sincronizados). Classificam o tipo de um ficheiro, escolhem o ícone certo,
 * formatam tamanhos e rótulos, e respondem a perguntas de capacidade
 * (pré-visualizável? editável no Office?). São puros - sem estado, sem I/O.
 */

import {
  IconFilePdf,
  IconFileDoc,
  IconFileXls,
  IconFileImg,
  IconFileText,
  IconFileGeneric,
  IconMail,
} from '../components/Icons.jsx';

/* Extensão em minúsculas de um nome de ficheiro (sem ponto), ou ''. */
function extOf(name) {
  const n = String(name || '').toLowerCase();
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i + 1) : '';
}

/*
 * Classifica um File/Blob do browser no vocabulário de `documentos.tipo`:
 * pdf | docx | xlsx | imagem | msg | outro. Combina o MIME e a extensão -
 * o MIME manda, a extensão desempata quando o MIME é genérico.
 */
export function tipoFromFile(file) {
  const mime = String((file && file.type) || '').toLowerCase();
  const ext = extOf(file && file.name);
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    return 'docx';
  }
  if (
    mime.includes('spreadsheetml') ||
    mime === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) {
    return 'xlsx';
  }
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return 'imagem';
  }
  if (ext === 'msg' || ext === 'eml' || mime === 'message/rfc822') return 'msg';
  return 'outro';
}

/* Ícone SVG para um tipo de documento (nunca emoji). */
export function DocTypeIcon({ tipo, size = 18, ...props }) {
  switch (tipo) {
    case 'pdf':
      return <IconFilePdf size={size} {...props} />;
    case 'docx':
      return <IconFileDoc size={size} {...props} />;
    case 'xlsx':
      return <IconFileXls size={size} {...props} />;
    case 'imagem':
      return <IconFileImg size={size} {...props} />;
    case 'msg':
      return <IconMail size={size} {...props} />;
    case 'nota':
      return <IconFileText size={size} {...props} />;
    default:
      return <IconFileGeneric size={size} {...props} />;
  }
}

/* Tamanho legível a partir de bytes: "12 KB", "3,4 MB". '' se desconhecido. */
export function formatBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/* Rótulo PT-PT da origem de um documento (badge). */
const ORIGEM_LABEL = {
  upload: 'Carregado',
  contratos: 'Contratos',
  honorarios: 'Honorários',
  email: 'Email',
  whatsapp: 'WhatsApp',
  nota: 'Nota',
  // mega-run E5 (BRIEF §8 gate): documentos rows attachPortalDocument writes
  // (certidão comercial/predial/civil, DGSI/DRE) carry origem:'portal' — this
  // tab renders them with zero other code changes (08-portal-audit.md pin 2),
  // but without this entry the badge fell back to the raw string "portal"
  // instead of a PT-PT label.
  portal: 'Portal',
};
export function origemLabel(o) {
  return ORIGEM_LABEL[o] || o || 'Outro';
}

/* Tom (cor do badge) por origem. */
export function origemTone(o) {
  if (o === 'upload' || o === 'portal') return 'info';
  if (o === 'nota') return 'neutral';
  if (o === 'email' || o === 'whatsapp') return 'ok';
  return 'neutral';
}

export function isNota(doc) {
  return doc && doc.tipo === 'nota';
}
export function isOfficeTipo(tipo) {
  return tipo === 'docx' || tipo === 'xlsx';
}
export function isPreviewableTipo(tipo) {
  return tipo === 'pdf' || tipo === 'imagem';
}

/* 'YYYY-MM-DD' de hoje (local) - calculado na chamada, nunca no topo do módulo. */
export function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/*
 * Mapeia dias restantes até uma data-limite para uma urgência (alta/media/baixa)
 * - partilhado pela Visão Geral e pelo seletor de processos.
 */
export function urgenciaDeDias(dias) {
  if (!Number.isFinite(dias)) return 'baixa';
  if (dias <= 2) return 'alta';
  if (dias <= 7) return 'media';
  return 'baixa';
}
