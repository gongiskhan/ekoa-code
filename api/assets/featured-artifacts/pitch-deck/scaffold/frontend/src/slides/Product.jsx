export default function Product() {
  return (
    <section className="slide">
      <div className="slide-eyebrow">04 &middot; Produto</div>
      <h1>Um terminal pensado para luvas, ruido e turnos de oito horas.</h1>

      <div className="two-col">
        <div className="two-col-block">
          <h3>Tres ecras essenciais</h3>
          <ul>
            <li>Planeamento &mdash; arrastar e fixar tarefas de turno.</li>
            <li>Execucao &mdash; estado por linha, paragens, alarmes.</li>
            <li>Painel &mdash; OEE, custos e margem por encomenda.</li>
          </ul>
        </div>

        <div className="mockup">
          <svg viewBox="0 0 480 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mockup do painel Lumera">
            <defs>
              <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-text, #0F172A)" />
                <stop offset="100%" stopColor="var(--color-text, #0F172A)" stopOpacity="0.65" />
              </linearGradient>
            </defs>

            <rect x="0" y="0" width="480" height="300" rx="12" fill="url(#bg)" stroke="rgba(255,255,255,0.08)" />

            <rect x="0" y="0" width="480" height="36" rx="12" fill="rgba(255,255,255,0.04)" />
            <circle cx="20" cy="18" r="5" fill="var(--color-danger, #DC2626)" />
            <circle cx="38" cy="18" r="5" fill="var(--color-warning, #D97706)" />
            <circle cx="56" cy="18" r="5" fill="var(--color-success, #16A34A)" />
            <rect x="200" y="11" width="80" height="14" rx="7" fill="rgba(255,255,255,0.06)" />

            <rect x="20" y="56" width="200" height="14" rx="4" fill="var(--color-bg, #FFFFFF)" opacity="0.9" />
            <rect x="20" y="76" width="120" height="8" rx="4" fill="var(--color-bg, #FFFFFF)" opacity="0.45" />

            <g transform="translate(20, 104)">
              <rect width="130" height="80" rx="8" fill="rgba(255,255,255,0.04)" />
              <text x="14" y="24" fontSize="9" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace">OEE</text>
              <text x="14" y="50" fontSize="20" fill="var(--color-accent, #14B8A6)" fontWeight="700">86,4%</text>
              <rect x="14" y="58" width="100" height="4" rx="2" fill="rgba(255,255,255,0.08)" />
              <rect x="14" y="58" width="86" height="4" rx="2" fill="var(--color-accent, #14B8A6)" />
            </g>

            <g transform="translate(160, 104)">
              <rect width="130" height="80" rx="8" fill="rgba(255,255,255,0.04)" />
              <text x="14" y="24" fontSize="9" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace">Paragens</text>
              <text x="14" y="50" fontSize="20" fill="var(--color-bg, #FFFFFF)" fontWeight="700">4</text>
              <text x="46" y="50" fontSize="10" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace">esta semana</text>
              <rect x="14" y="58" width="100" height="4" rx="2" fill="rgba(255,255,255,0.08)" />
              <rect x="14" y="58" width="34" height="4" rx="2" fill="var(--color-warning, #D97706)" />
            </g>

            <g transform="translate(300, 104)">
              <rect width="160" height="80" rx="8" fill="rgba(255,255,255,0.04)" />
              <text x="14" y="24" fontSize="9" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace">Custo / unidade</text>
              <text x="14" y="50" fontSize="20" fill="var(--color-bg, #FFFFFF)" fontWeight="700">3,18&euro;</text>
              <text x="80" y="50" fontSize="10" fill="var(--color-success, #16A34A)" fontFamily="ui-monospace, monospace">-7%</text>
              <rect x="14" y="58" width="130" height="4" rx="2" fill="rgba(255,255,255,0.08)" />
              <rect x="14" y="58" width="84" height="4" rx="2" fill="var(--color-primary, #0F766E)" />
            </g>

            <rect x="20" y="204" width="440" height="76" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)" />
            <text x="34" y="226" fontSize="10" fill="var(--color-text-subtle, #64748B)" fontFamily="ui-monospace, monospace">Linha A &mdash; Embalagem</text>
            <text x="34" y="252" fontSize="14" fill="var(--color-bg, #FFFFFF)" fontWeight="600">A trabalhar &middot; 1240 / 1400 unidades</text>
            <rect x="34" y="262" width="412" height="6" rx="3" fill="rgba(255,255,255,0.08)" />
            <rect x="34" y="262" width="365" height="6" rx="3" fill="var(--color-accent, #14B8A6)" />
          </svg>
        </div>
      </div>
    </section>
  );
}
