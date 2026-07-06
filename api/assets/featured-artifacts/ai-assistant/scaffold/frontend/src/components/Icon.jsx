/**
 * Inline SVG icon library. Every icon uses currentColor so it inherits the
 * surrounding text colour via CSS variables — never a literal hex.
 */
export function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3v6" />
          <path d="M12 15v6" />
          <path d="M3 12h6" />
          <path d="M15 12h6" />
          <path d="M5.6 5.6l4.2 4.2" />
          <path d="M14.2 14.2l4.2 4.2" />
          <path d="M18.4 5.6l-4.2 4.2" />
          <path d="M9.8 14.2l-4.2 4.2" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="M4 12l16-8-6 16-3-7-7-1z" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12" />
          <path d="M18 6l-12 12" />
        </svg>
      );
    case 'book':
      return (
        <svg {...common}>
          <path d="M4 4h10a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z" />
          <path d="M17 4h3v16h-3" />
          <path d="M7 8h7" />
          <path d="M7 12h7" />
        </svg>
      );
    case 'rules':
      return (
        <svg {...common}>
          <path d="M5 4h11l3 3v13H5z" />
          <path d="M16 4v4h4" />
          <path d="M9 13h7" />
          <path d="M9 17h5" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="M6 7l1 13h10l1-13" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...common}>
          <path d="M4 20h4l11-11-4-4L4 16v4z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12l4 4 10-10" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...common}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.3-4.3" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...common}>
          <path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8-8-8z" />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" />
        </svg>
      );
    case 'message':
      return (
        <svg {...common}>
          <path d="M4 5h16v11H8l-4 4z" />
        </svg>
      );
    default:
      return null;
  }
}
