import type { ReactNode } from 'react';

/** 디자인 시안의 선 아이콘 (24 격자, 1.8 선) */
function Svg({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

type P = { size?: number };

export const IconToday = ({ size }: P) => (
  <Svg size={size}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);
export const IconBoard = ({ size }: P) => (
  <Svg size={size}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="11" rx="1.5" />
    <rect x="17" y="4" width="4" height="7" rx="1.5" />
  </Svg>
);
export const IconIdeas = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 13h4l2 3h4l2-3h4" />
    <path d="M6 4h12l2 9v6H4v-6z" />
  </Svg>
);
export const IconRuns = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 17l5-5-5-5" />
    <path d="M12 19h8" />
  </Svg>
);
export const IconCosts = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 20h16" />
    <path d="M7 16v-5" />
    <path d="M12 16V6" />
    <path d="M17 16v-8" />
  </Svg>
);
export const IconRules = ({ size }: P) => (
  <Svg size={size}>
    <path d="M9 6h11" />
    <path d="M9 12h11" />
    <path d="M9 18h11" />
    <path d="M4 6h1" />
    <path d="M4 12h1" />
    <path d="M4 18h1" />
  </Svg>
);
export const IconApps = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 7h9" />
    <path d="M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3" />
    <path d="M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);
export const IconSearch = ({ size = 16 }: P) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
export const IconMenu = ({ size = 22 }: P) => (
  <Svg size={size}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </Svg>
);
export const IconClose = ({ size = 20 }: P) => (
  <Svg size={size}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </Svg>
);
export const IconBack = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const IconCopy = ({ size = 16 }: P) => (
  <Svg size={size}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Svg>
);
export const IconExternal = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const IconGithub = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M9 19c-4 1.5-4-2-6-2.5" />
    <path d="M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </Svg>
);
export const IconGlobe = ({ size = 16 }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  </Svg>
);
export const IconPhone = ({ size = 16 }: P) => (
  <Svg size={size}>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </Svg>
);
export const IconDoc = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </Svg>
);
export const IconCheck = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M5 12l5 5 9-10" />
  </Svg>
);
export const IconPlus = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);
export const IconCode = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M8 7l-5 5 5 5" />
    <path d="M16 7l5 5-5 5" />
  </Svg>
);
export const IconChevronDown = ({ size = 12 }: P) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const IconClock = ({ size = 18 }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconMine = ({ size }: P) => (
  <Svg size={size}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M3 13h18" />
  </Svg>
);
export const IconPlug = ({ size }: P) => (
  <Svg size={size}>
    <path d="M9 3v5" />
    <path d="M15 3v5" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 17v4" />
  </Svg>
);
export const IconSpark = ({ size }: P) => (
  <Svg size={size}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
  </Svg>
);
export const IconChat = ({ size }: P) => (
  <Svg size={size}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
    <path d="M8.5 8.5h7M8.5 11.5h4.5" />
  </Svg>
);
