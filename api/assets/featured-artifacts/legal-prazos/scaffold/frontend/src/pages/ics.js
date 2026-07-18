// Exportação .ics dos prazos pendentes (RFC 5545), 100% determinística:
// PRODID fixo, UID derivado do id do prazo na espinha, DTSTAMP derivado do
// createdAt (nunca de "agora"), eventos de dia inteiro (VALUE=DATE) com
// alarme DISPLAY a D-2 (TRIGGER:-P2D), fuso Europe/Lisbon declarado,
// quebras CRLF e folding a 74 octetos. O mesmo conjunto de prazos produz
// sempre exactamente os mesmos bytes - exportar duas vezes dá ficheiros iguais.
// Sem imports de React/shared: o módulo é puro e corre em node tal-e-qual.

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

// Mesma semântica de prazo-view.js (duplicada de propósito: este módulo tem de
// ficar puro): linhas antigas usam `titulo` e não têm `origem`.
function descricaoDe(pr) {
  return (pr && (pr.descricao || pr.titulo)) || 'Prazo';
}
function origemDe(pr) {
  return pr && pr.origem === 'citius' ? 'Citius' : 'Manual';
}

// Bloco VTIMEZONE estático de Europe/Lisbon (WET/WEST, regra UE).
const VTIMEZONE_LISBOA = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Lisbon',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:WEST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:WET',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function compacta(ymd) {
  return ymd.replaceAll('-', '');
}

// Dia seguinte em aritmética UTC (DTEND exclusivo de eventos de dia inteiro).
function diaSeguinte(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}${mm}${dd}`;
}

// DTSTAMP determinístico: derivado do createdAt do registo; sem createdAt
// válido, cai na meia-noite UTC da data-limite. Nunca usa o relógio local.
function dtstampDe(pr) {
  const t = Date.parse(pr.createdAt || '');
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }
  return `${compacta(pr.dataLimite)}T000000Z`;
}

// Escapa TEXT nos termos do RFC 5545 §3.3.11.
function escapaTexto(valor) {
  return String(valor)
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Folding a 74 octetos (limite RFC: 75), contando bytes UTF-8 reais para os
// acentos PT; as linhas de continuação começam por um espaço.
function dobraLinha(linha) {
  const enc = new TextEncoder();
  if (enc.encode(linha).length <= 74) return linha;
  const partes = [];
  let atual = '';
  let bytes = 0;
  for (const ch of linha) {
    const b = enc.encode(ch).length;
    if (bytes + b > 74) {
      partes.push(atual);
      atual = ` ${ch}`;
      bytes = 1 + b;
    } else {
      atual += ch;
      bytes += b;
    }
  }
  if (atual) partes.push(atual);
  return partes.join('\r\n');
}

/**
 * Constrói o calendário .ics dos prazos recebidos. Só entram prazos com
 * dataLimite válida (YYYY-MM-DD); os restantes são contados como ignorados
 * para o aviso honesto na UI. Ordenação estável por (dataLimite, id).
 */
export function construirIcsPrazos(prazos, { processoNumero } = {}) {
  const numeroDe = typeof processoNumero === 'function' ? processoNumero : () => '';
  const incluidos = [];
  let ignorados = 0;
  for (const pr of prazos) {
    if (RE_YMD.test(String(pr.dataLimite || ''))) incluidos.push(pr);
    else ignorados += 1;
  }
  incluidos.sort((a, b) => {
    if (a.dataLimite !== b.dataLimite) return a.dataLimite < b.dataLimite ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });

  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ekoa Legal//legal-prazos//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Prazos pendentes - Ekoa Legal',
    'X-WR-TIMEZONE:Europe/Lisbon',
    ...VTIMEZONE_LISBOA,
  ];

  for (const pr of incluidos) {
    const desc = descricaoDe(pr);
    const numero = numeroDe(pr.processoId);
    const origem = origemDe(pr);
    const notas = [];
    if (numero) notas.push(`Processo: ${numero}`);
    notas.push(`Origem: ${origem}`);
    if (pr.regraAplicada) notas.push(`Regra: ${pr.regraAplicada}`);
    if (pr.multaAte) notas.push(`Multa (CPC art. 139.º n.º 5) até: ${pr.multaAte}`);

    linhas.push(
      'BEGIN:VEVENT',
      `UID:prazo-${pr.id}@ekoa-legal`,
      `DTSTAMP:${dtstampDe(pr)}`,
      `DTSTART;VALUE=DATE:${compacta(pr.dataLimite)}`,
      `DTEND;VALUE=DATE:${diaSeguinte(pr.dataLimite)}`,
      `SUMMARY:${escapaTexto(`Prazo: ${desc}`)}`,
      `DESCRIPTION:${escapaTexto(notas.join('\n'))}`,
      'CATEGORIES:PRAZO',
      'STATUS:CONFIRMED',
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapaTexto(`D-2: ${desc}`)}`,
      'TRIGGER:-P2D',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  linhas.push('END:VCALENDAR');
  const conteudo = `${linhas.map(dobraLinha).join('\r\n')}\r\n`;
  return { conteudo, incluidos: incluidos.length, ignorados };
}

/** Descarrega o conteúdo .ics como ficheiro via Blob + âncora. */
export function descarregarIcs(conteudo, nomeFicheiro = 'prazos-pendentes.ics') {
  const blob = new Blob([conteudo], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFicheiro;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
