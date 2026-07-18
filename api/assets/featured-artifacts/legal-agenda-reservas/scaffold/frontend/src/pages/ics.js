/*
 * iCalendar (RFC 5545) app-local e DETERMINISTA: o mesmo estado da espinha
 * produz sempre byte-a-byte o mesmo ficheiro.
 *  - PRODID fixo; sem "agora": o DTSTAMP deriva de updatedAt/createdAt da linha
 *    (com recuo fixo quando falta) e o UID deriva do id da entidade.
 *  - Horas em relógio de parede com TZID=Europe/Lisbon (VTIMEZONE incluído,
 *    regras WET/WEST vigentes); eventos só-de-dia saem como VALUE=DATE.
 *  - Linhas CRLF, dobradas a 75 octetos (continuação com espaço) e texto
 *    escapado (\\ ; , e quebras de linha) por RFC 5545.
 */

export const ICS_PRODID = '-//Ekoa Legal//Agenda//PT';
export const ICS_TZID = 'Europe/Lisbon';

/* Fuso Europe/Lisbon: WET (UTC+0) com verão WEST (UTC+1), últimas
 * madrugadas de domingo de março/outubro (regra UE vigente). */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${ICS_TZID}`,
  'BEGIN:STANDARD',
  'DTSTART:19961027T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:WET',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19960331T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:WEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/* Escapa texto por RFC 5545: \ ; , e quebras de linha. */
export function icsEscape(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* Dobra uma linha a 75 octetos UTF-8; as continuações começam por um espaço. */
export function dobrarLinha(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const partes = [];
  let atual = '';
  let octetos = 0;
  let limite = 75;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (octetos + l > limite) {
      partes.push(atual);
      atual = ch;
      octetos = l;
      limite = 74; // a continuação gasta 1 octeto no espaço inicial
    } else {
      atual += ch;
      octetos += l;
    }
  }
  if (atual) partes.push(atual);
  return partes.map((p, i) => (i === 0 ? p : ` ${p}`)).join('\r\n');
}

/* 'YYYY-MM-DDTHH:mm[:ss]' (relógio de parede) -> 'YYYYMMDDTHHMMSS'. */
export function dtLocal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(iso || ''));
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] || '00'}`;
}

/* 'YYYY-MM-DD' -> 'YYYYMMDD'. */
export function dtDia(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/* Dia seguinte de 'YYYY-MM-DD' (DTEND exclusivo dos eventos só-de-dia). */
function diaSeguinte(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/*
 * DTSTAMP determinista: deriva do updatedAt/createdAt (ISO UTC atribuído pela
 * plataforma) da própria linha; sem carimbo válido usa um recuo fixo. Nunca
 * consulta o relógio.
 */
export function dtStampDe(row) {
  const iso = (row && (row.updatedAt || row.createdAt)) || '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '20260101T000000Z';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/*
 * VEVENT de um evento da espinha. Eventos com inicio+fim saem com hora
 * (TZID Europe/Lisbon); os restantes saem só-de-dia sobre `data`.
 */
export function eventoParaVevent(evento) {
  if (!evento || !evento.id) return null;
  const linhas = ['BEGIN:VEVENT', `UID:evento-${evento.id}@ekoa-legal`, `DTSTAMP:${dtStampDe(evento)}`];
  const inicio = dtLocal(evento.inicio);
  const fim = dtLocal(evento.fim);
  if (inicio && fim) {
    linhas.push(`DTSTART;TZID=${ICS_TZID}:${inicio}`, `DTEND;TZID=${ICS_TZID}:${fim}`);
  } else {
    const dia = dtDia(evento.data);
    if (!dia) return null;
    linhas.push(`DTSTART;VALUE=DATE:${dia}`, `DTEND;VALUE=DATE:${dtDia(diaSeguinte(evento.data))}`);
  }
  linhas.push(`SUMMARY:${icsEscape(evento.titulo || 'Evento')}`);
  if (evento.descricao) linhas.push(`DESCRIPTION:${icsEscape(evento.descricao)}`);
  linhas.push('END:VEVENT');
  return linhas;
}

/* VEVENT de uma reserva (marcação com hora). `tipoNome` é o nome do tipo de sessão. */
export function reservaParaVevent(reserva, tipoNome) {
  if (!reserva || !reserva.id) return null;
  const inicio = dtLocal(reserva.inicio);
  const fim = dtLocal(reserva.fim);
  if (!inicio || !fim) return null;
  const titulo = `${tipoNome || 'Sessão'} - ${reserva.nome || 'Cliente'}`;
  const linhas = [
    'BEGIN:VEVENT',
    `UID:reserva-${reserva.id}@ekoa-legal`,
    `DTSTAMP:${dtStampDe(reserva)}`,
    `DTSTART;TZID=${ICS_TZID}:${inicio}`,
    `DTEND;TZID=${ICS_TZID}:${fim}`,
    `SUMMARY:${icsEscape(titulo)}`,
  ];
  if (reserva.email) linhas.push(`DESCRIPTION:${icsEscape(`Reserva de ${reserva.nome || 'cliente'} (${reserva.email})`)}`);
  linhas.push('END:VEVENT');
  return linhas;
}

/* Calendário completo a partir de listas de linhas VEVENT (ignora nulos). */
export function construirIcs(vevents) {
  const corpo = (vevents || []).filter(Boolean).flat();
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    ...corpo,
    'END:VCALENDAR',
  ];
  return `${linhas.map(dobrarLinha).join('\r\n')}\r\n`;
}

/* Descarga do .ics via Blob + âncora (sem rede). */
export function descarregarIcs(filename, texto) {
  const blob = new Blob([texto], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
