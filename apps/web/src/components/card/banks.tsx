import type { ReactElement } from 'react';

/**
 * Bank looks: colour association only (TZ 4.3). Palettes, patterns and logo marks are drawn here,
 * no third-party artwork. Names come from the server config.
 */
export interface BankLook {
  /** Gradient stops of the card body. */
  from: string;
  to: string;
  /** Text colour on top of the palette. */
  ink: string;
  /** Highlight of pattern digits; readable on this palette. */
  highlight: string;
  /** Repeating background pattern (inline SVG). */
  pattern: string;
  Logo: () => ReactElement;
}

const svg = (body: string, size = 40) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>${body}</svg>`,
  )}")`;

const stroke = (color: string, opacity = 0.18) =>
  `fill='none' stroke='${color}' stroke-opacity='${opacity}' stroke-width='1.5'`;

const PATTERNS = {
  citrus: svg(
    `<circle cx='20' cy='20' r='12' ${stroke('#5a4300')}/><path d='M20 8v24M8 20h24M11.5 11.5l17 17M28.5 11.5l-17 17' ${stroke('#5a4300', 0.12)}/>`,
  ),
  waves: svg(`<path d='M0 14q10-8 20 0t20 0M0 30q10-8 20 0t20 0' ${stroke('#ffffff')}/>`),
  facets: svg(`<path d='M20 4l12 16-12 16L8 20z' ${stroke('#ffffff')}/>`),
  hex: svg(`<path d='M20 6l12 7v14l-12 7-12-7V13z' ${stroke('#ffffff')}/>`),
  stars: svg(
    `<path d='M20 9l3 7h7l-6 4.5 2.5 7.5-6.5-4.5-6.5 4.5 2.5-7.5-6-4.5h7z' ${stroke('#ffffff', 0.14)}/>`,
  ),
  chevrons: svg(`<path d='M4 14l16 10 16-10M4 28l16 10 16-10' ${stroke('#ffffff')}/>`),
  pines: svg(`<path d='M20 6l10 16H10zM20 16l12 18H8z' ${stroke('#ffffff')}/>`),
  rays: svg(
    `<path d='M20 20L0 0M20 20L40 0M20 20L0 40M20 20L40 40M20 20V0M20 20H40' ${stroke('#4a3300', 0.15)}/>`,
  ),
};

const mark = (children: ReactElement) => () => (
  <svg className="gc-logo" viewBox="0 0 32 32" aria-hidden="true">
    {children}
  </svg>
);

export const BANK_LOOKS: Record<string, BankLook> = {
  lemon: {
    from: '#ffe55c',
    to: '#f2b600',
    ink: '#2b2200',
    highlight: '#a3170a',
    pattern: PATTERNS.citrus,
    Logo: mark(
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="16" cy="16" r="11" />
        <path d="M16 5v22M5 16h22M8.2 8.2l15.6 15.6M23.8 8.2L8.2 23.8" strokeWidth="1.4" />
      </g>,
    ),
  },
  azure: {
    from: '#3b8bff',
    to: '#0b3a9c',
    ink: '#ffffff',
    highlight: '#ffe27a',
    pattern: PATTERNS.waves,
    Logo: mark(
      <path
        d="M3 18q6.5-9 13 0t13 0M3 25q6.5-9 13 0t13 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />,
    ),
  },
  ruby: {
    from: '#f0405a',
    to: '#860b22',
    ink: '#ffffff',
    highlight: '#ffe27a',
    pattern: PATTERNS.facets,
    Logo: mark(
      <path
        d="M8 6h16l5 7-13 14L3 13zM3 13h26M12 6l4 21 4-21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />,
    ),
  },
  emerald: {
    from: '#2fc785',
    to: '#0a6340',
    ink: '#ffffff',
    highlight: '#ffe27a',
    pattern: PATTERNS.hex,
    Logo: mark(
      <path
        d="M16 3l11 6.5v13L16 29 5 22.5v-13zM16 3v26M5 9.5l22 13M27 9.5l-22 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />,
    ),
  },
  liberty: {
    from: '#2a4bb0',
    to: '#0d1a45',
    ink: '#ffffff',
    highlight: '#ffe27a',
    pattern: PATTERNS.stars,
    Logo: mark(
      <path
        d="M16 3l3.6 8.4H28l-7 5.2 2.8 8.9L16 20l-7.8 5.5 2.8-8.9-7-5.2h8.4z"
        fill="currentColor"
      />,
    ),
  },
  eagle: {
    from: '#d81e3c',
    to: '#5e0817',
    ink: '#ffffff',
    highlight: '#ffe27a',
    pattern: PATTERNS.chevrons,
    Logo: mark(
      <path
        d="M2 10l14 8 14-8M6 17l10 6 10-6M10 24l6 4 6-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />,
    ),
  },
  evergreen: {
    from: '#2a9a62',
    to: '#0b3521',
    ink: '#ffffff',
    highlight: '#ffe27a',
    pattern: PATTERNS.pines,
    Logo: mark(
      <path
        d="M16 3l8 11h-4l6 9H6l6-9H8zM16 23v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />,
    ),
  },
  frontier: {
    from: '#f0c766',
    to: '#8a5f10',
    ink: '#2a1c00',
    highlight: '#8f1d06',
    pattern: PATTERNS.rays,
    Logo: mark(
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="16" cy="16" r="6" />
        <path d="M16 2v5M16 25v5M2 16h5M25 16h5M6 6l3.5 3.5M22.5 22.5L26 26M26 6l-3.5 3.5M9.5 22.5L6 26" />
      </g>,
    ),
  },
};

export const FALLBACK_LOOK: BankLook = {
  from: '#5b5f6b',
  to: '#22242a',
  ink: '#ffffff',
  highlight: '#ffe27a',
  pattern: PATTERNS.hex,
  Logo: mark(
    <rect
      x="5"
      y="5"
      width="22"
      height="22"
      rx="5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />,
  ),
};

export function bankLook(bankId: string): BankLook {
  return BANK_LOOKS[bankId] ?? FALLBACK_LOOK;
}
