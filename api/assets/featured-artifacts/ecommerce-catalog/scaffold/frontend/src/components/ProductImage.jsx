/**
 * Imagem inline em SVG para representar o produto.
 * Não utiliza ficheiros raster; gera um rectângulo colorido com o nome ou
 * iniciais do produto sobre uma forma geométrica simples.
 */

function initials(name) {
  if (!name) return '?';
  const parts = String(name).split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

export default function ProductImage({ name, tone, category }) {
  const fillTone = tone || 'var(--color-primary, #0F766E)';
  const label = initials(name);
  const subtitle = (category || '').toUpperCase();

  return (
    <svg
      className="product-image"
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={name}
    >
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-surface, #F8FAFC)" />
          <stop offset="100%" stopColor="var(--color-surface-muted, #F1F5F9)" />
        </linearGradient>
      </defs>
      <rect width="320" height="240" fill="url(#bgGrad)" />
      <circle cx="240" cy="60" r="44" fill={fillTone} opacity="0.18" />
      <circle cx="240" cy="60" r="22" fill={fillTone} opacity="0.32" />
      <rect x="32" y="148" width="180" height="14" rx="4" fill="var(--color-text-subtle, #64748B)" opacity="0.2" />
      <rect x="32" y="172" width="120" height="10" rx="3" fill="var(--color-text-subtle, #64748B)" opacity="0.16" />
      <g transform="translate(32, 60)">
        <rect width="84" height="64" rx="14" fill={fillTone} />
        <text
          x="42"
          y="42"
          textAnchor="middle"
          fontSize="28"
          fontWeight="700"
          fontFamily="var(--font-sans, system-ui, sans-serif)"
          fill="var(--color-bg, #FFFFFF)"
        >
          {label}
        </text>
      </g>
      {subtitle ? (
        <text
          x="32"
          y="220"
          fontSize="10"
          fontWeight="600"
          letterSpacing="2"
          fontFamily="var(--font-sans, system-ui, sans-serif)"
          fill="var(--color-text-subtle, #64748B)"
        >
          {subtitle}
        </text>
      ) : null}
    </svg>
  );
}
