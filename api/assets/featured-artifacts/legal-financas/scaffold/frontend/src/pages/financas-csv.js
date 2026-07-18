/*
 * CSV do extrato de conta corrente - texto puro e determinístico (sem rede,
 * sem datas implícitas). O ficheiro declara-se SEMPRE como documento de
 * conferência: a contabilidade certificada vive no software de faturação e
 * contabilidade, nunca na Ekoa (mesma regra da emissão - ver REGRA_EMISSAO).
 *
 * Convenções: separador ';' (Excel PT), decimal com vírgula, UTF-8 com BOM,
 * linhas '\r\n'. Créditos levam sinal '-' na coluna Valor, como no ecrã.
 */

export const CSV_DISCLAIMER = 'Documento de conferência gerado pela app Finanças (Ekoa) - não é extrato contabilístico certificado.';

export function csvCampo(value) {
  const s = String(value == null ? '' : value);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function eurCsv(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',');
}

export function extratoCsv({ clienteNome, processoNumero, geradoEm, extrato } = {}) {
  const linhas = [];
  linhas.push(`# Extrato de conta corrente - ${clienteNome || '(sem cliente)'}${processoNumero ? ` - processo ${processoNumero}` : ''}`);
  linhas.push(`# ${CSV_DISCLAIMER}`);
  if (geradoEm) linhas.push(`# Gerado em ${geradoEm}`);
  linhas.push(['Data', 'Tipo', 'Origem', 'Descrição', 'Valor (EUR)', 'Saldo corrente (EUR)'].join(';'));
  for (const m of (Array.isArray(extrato) ? extrato : [])) {
    linhas.push([
      csvCampo(m.data || ''),
      m.tipo === 'credito' ? 'Crédito' : 'Débito',
      csvCampo(m.origemLabel || m.origem || ''),
      csvCampo(m.notas || m.refExterna || ''),
      (m.tipo === 'credito' ? '-' : '') + eurCsv(m.valor),
      eurCsv(m.saldoCorrente),
    ].join(';'));
  }
  return `\uFEFF${linhas.join('\r\n')}\r\n`;
}

export function descarregarCsv(filename, texto) {
  const nome = String(filename || 'extrato').replace(/[^\w\- .]+/g, ' ').trim() || 'extrato';
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = /\.csv$/i.test(nome) ? nome : `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
