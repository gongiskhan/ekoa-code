export default function Revenue() {
  // Trailing 4 quarters of revenue in millions of euros.
  // The plan series is the second band on each bar.
  const data = [
    { label: 'Q4 25', actual: 4.2, plan: 4.0 },
    { label: 'Q1 26', actual: 4.8, plan: 4.6 },
    { label: 'Q2 26', actual: 5.6, plan: 5.4 },
    { label: 'Q3 26', actual: 6.82, plan: 6.3 },
  ];

  const max = 8;
  const chartWidth = 720;
  const chartHeight = 280;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const innerW = chartWidth - padLeft - padRight;
  const innerH = chartHeight - padTop - padBottom;
  const groupW = innerW / data.length;
  const barW = (groupW - 24) / 2;

  // Y-axis ticks at 0, 2, 4, 6, 8 (millions)
  const ticks = [0, 2, 4, 6, 8];

  return (
    <section className="slide">
      <div className="slide-eyebrow">02 &middot; Receita</div>
      <h1>Quatro trimestres consecutivos acima do plano.</h1>

      <div className="chart-frame">
        <div className="chart-header">
          <h3>Receita trimestral &middot; Real vs. plano (milhoes de euros)</h3>
          <span className="chart-legend">
            <span className="swatch" /> Plano
            <span className="swatch accent" style={{ marginLeft: '16px' }} /> Real
          </span>
        </div>

        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Receita trimestral real vs. plano">
          {/* Axis ticks */}
          {ticks.map((t) => {
            const y = padTop + innerH - (t / max) * innerH;
            return (
              <g key={t}>
                <line x1={padLeft} y1={y} x2={chartWidth - padRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray={t === 0 ? '0' : '2 4'} />
                <text x={padLeft - 12} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace">
                  {t},0
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {data.map((d, i) => {
            const xGroup = padLeft + i * groupW + 12;
            const planH = (d.plan / max) * innerH;
            const actualH = (d.actual / max) * innerH;
            const planY = padTop + innerH - planH;
            const actualY = padTop + innerH - actualH;

            return (
              <g key={d.label}>
                <rect x={xGroup} y={planY} width={barW} height={planH} rx="3" fill="var(--color-primary, #0F766E)" opacity="0.55" />
                <rect x={xGroup + barW + 6} y={actualY} width={barW} height={actualH} rx="3" fill="var(--color-accent, #14B8A6)" />

                <text x={xGroup + barW + 6 + barW / 2} y={actualY - 8} textAnchor="middle" fontSize="11" fill="var(--color-bg, #FFFFFF)" fontWeight="600" fontFamily="ui-monospace, monospace">
                  {d.actual.toFixed(1)}
                </text>

                <text x={xGroup + barW + 3} y={chartHeight - 12} textAnchor="middle" fontSize="11" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace" letterSpacing="0.12em">
                  {d.label}
                </text>
              </g>
            );
          })}

          {/* Y-axis line */}
          <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + innerH} stroke="rgba(255,255,255,0.12)" />
          <line x1={padLeft} y1={padTop + innerH} x2={chartWidth - padRight} y2={padTop + innerH} stroke="rgba(255,255,255,0.12)" />
        </svg>

        <div className="chart-summary">
          <div className="item">
            <span className="item-label">Receita do trimestre</span>
            <span className="item-value">6,82 M&euro;</span>
            <span className="item-detail">Acima do plano em 0,52 M&euro;.</span>
          </div>
          <div className="item">
            <span className="item-label">Crescimento homologo</span>
            <span className="item-value">+38%</span>
            <span className="item-detail">Comparado com o terceiro trimestre de 2025.</span>
          </div>
          <div className="item">
            <span className="item-label">ARR final do trimestre</span>
            <span className="item-value">24,1 M&euro;</span>
            <span className="item-detail">Sinal positivo para a actualizacao de planeamento de Q4.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
