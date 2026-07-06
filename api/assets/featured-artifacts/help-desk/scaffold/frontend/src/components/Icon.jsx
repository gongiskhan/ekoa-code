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
    case 'lifebuoy':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <path d="M4.93 4.93l3.54 3.54" />
          <path d="M15.54 15.54l3.54 3.54" />
          <path d="M19.07 4.93l-3.54 3.54" />
          <path d="M8.46 15.54l-3.54 3.54" />
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
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 20c1.2-3.4 4-5 6-5s4.8 1.6 6 5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M14 14c1.5 0 4 .5 5.6 3.4" />
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
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M4 13h4l1 3h6l1-3h4" />
          <path d="M4 13V5h16v8" />
          <path d="M4 13v6h16v-6" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 7 9-7" />
        </svg>
      );
    case 'mail-check':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 7 9-7" />
          <path d="M16 14l2 2 4-4" />
        </svg>
      );
    case 'mail-x':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 7 9-7" />
          <path d="M19 17l-3-3" />
          <path d="M19 14l-3 3" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12" />
          <path d="M18 6l-12 12" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12l4 4 10-10" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="5" />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg {...common}>
          <path d="M15 6l-6 6 6 6" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...common}>
          <path d="M4 20h4l11-11-4-4L4 16v4z" />
          <path d="M14 6l4 4" />
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
    case 'priority-high':
      return (
        <svg {...common}>
          <path d="M12 4v10" />
          <circle cx="12" cy="18" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'priority-low':
      return (
        <svg {...common}>
          <path d="M12 6v8" />
          <path d="M9 11l3 3 3-3" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common}>
          <path d="M9 8V3" />
          <path d="M15 8V3" />
          <rect x="7" y="8" width="10" height="6" rx="2" />
          <path d="M12 14v4a3 3 0 0 0 3 3" />
        </svg>
      );
    default:
      return null;
  }
}
