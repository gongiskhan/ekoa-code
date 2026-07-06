import { useMemo } from 'react';
import { formatMonthYear, toYMD } from './format';

const DOW_LABELS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/**
 * CalendarGrid — month view. Mon-first week.
 * Props:
 *  - cursor: Date pinning the month
 *  - selectedYMD: 'YYYY-MM-DD' or null
 *  - bookingsByDate: { 'YYYY-MM-DD': Booking[] }
 *  - onSelectDate(ymd)
 *  - onPrev / onNext / onToday
 */
export default function CalendarGrid({ cursor, selectedYMD, bookingsByDate, onSelectDate, onPrev, onNext, onToday }) {
  const cells = useMemo(() => buildCells(cursor), [cursor]);
  const todayYMD = toYMD(new Date());

  return (
    <div>
      <div className="calendar-toolbar">
        <div className="calendar-month-label">{formatMonthYear(cursor.getFullYear(), cursor.getMonth())}</div>
        <div className="calendar-nav" role="group" aria-label="Navegação de mês">
          <button type="button" onClick={onPrev} aria-label="Mês anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button type="button" onClick={onToday}>Hoje</button>
          <button type="button" onClick={onNext} aria-label="Mês seguinte">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="calendar-grid" role="grid">
        {DOW_LABELS.map((label) => (
          <div key={label} className="calendar-dow" role="columnheader">{label}</div>
        ))}
        {cells.map((cell) => {
          const ymd = toYMD(cell.date);
          const list = bookingsByDate[ymd] || [];
          const visible = list.slice(0, 3);
          const more = list.length - visible.length;
          return (
            <button
              type="button"
              key={ymd + (cell.outOfMonth ? '-out' : '')}
              className={
                'calendar-day' +
                (cell.outOfMonth ? ' out-of-month' : '') +
                (ymd === todayYMD ? ' today' : '') +
                (ymd === selectedYMD ? ' selected' : '')
              }
              role="gridcell"
              aria-label={ymd + ' — ' + list.length + ' marcações'}
              onClick={() => onSelectDate(ymd)}
            >
              <span className="day-number">{cell.date.getDate()}</span>
              <div className="day-bookings">
                {visible.map((b) => (
                  <span key={b.id} className={'day-booking ' + (b.status || 'confirmed')}>
                    {(b.time || '').slice(0, 5)} {b.serviceName || ''}
                  </span>
                ))}
                {more > 0 && <span className="day-more">+ {more} mais</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildCells(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // Mon-first: getDay() returns 0 for Sun. Convert to 0=Mon..6=Sun.
  const dow = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - dow);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: d, outOfMonth: d.getMonth() !== month });
  }
  return cells;
}
