/*
 * CSV app-local do Núcleo - geração determinista com escaping RFC 4180:
 * um campo vai entre aspas quando contém vírgula, aspas ou quebras de linha,
 * e as aspas interiores duplicam-se. O BOM UTF-8 inicial faz o Excel abrir
 * os acentos PT corretamente. Sem dependências: Blob + âncora para descarga.
 */

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* headers: string[]; rows: Array<Array<string|number|null>>. Linhas CRLF. */
export function buildCsv(headers, rows) {
  const linhas = [headers, ...rows].map((r) => r.map(csvEscape).join(','));
  return '\uFEFF' + linhas.join('\r\n') + '\r\n';
}

export function downloadCsv(filename, headers, rows) {
  const blob = new Blob([buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
