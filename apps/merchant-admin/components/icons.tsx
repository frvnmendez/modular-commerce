import type { SVGProps } from 'react';

/** Iconos propios de trazo (24×24, 1.75 px). Sin dependencias: cada uno es un <path> pequeño. */
type P = SVGProps<SVGSVGElement> & { size?: number };
function make(d: React.ReactNode) {
  return function Icon({ size = 18, ...p }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...p}>{d}</svg>
    );
  };
}

export const IconHome = make(<><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>);
export const IconTag = make(<><path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l7.9 7.9a1.4 1.4 0 0 1 0 2l-6.1 6.1a1.4 1.4 0 0 1-2 0z" /><circle cx="8.5" cy="8.5" r="1.4" /></>);
export const IconBox = make(<><path d="m12 3 8 4v10l-8 4-8-4V7z" /><path d="m4 7 8 4 8-4M12 11v10" /></>);
export const IconFactory = make(<><path d="M3 20V10l5 3V10l5 3V6h3l1 0v14z" /><path d="M3 20h18M17 6V3h3v17" /></>);
export const IconInbox = make(<><path d="M4 13.5 6.2 5.7A1 1 0 0 1 7.2 5h9.6a1 1 0 0 1 1 .7L20 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" /></>);
export const IconTruck = make(<><path d="M3 6h11v10H3zM14 9.5h4l3 3.5v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></>);
export const IconReturn = make(<><path d="M9 7 4.5 11.5 9 16" /><path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2" /></>);
export const IconUser = make(<><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>);
export const IconUsers = make(<><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.2a6 6 0 0 1 3.5 5.3" /></>);
export const IconPulse = make(<><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></>);
export const IconGear = make(<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>);
export const IconMenu = make(<><path d="M4 7h16M4 12h16M4 17h16" /></>);
export const IconClose = make(<><path d="M6 6l12 12M18 6 6 18" /></>);
export const IconCheck = make(<><path d="m5 12.5 4.5 4.5L19 7.5" /></>);
export const IconChevronDown = make(<><path d="m6 9 6 6 6-6" /></>);
export const IconChevronRight = make(<><path d="m9 6 6 6-6 6" /></>);
export const IconArrowLeft = make(<><path d="M19 12H5M11 6l-6 6 6 6" /></>);
export const IconStore = make(<><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5 11.5V20h14v-8.5M10 20v-5h4v5" /></>);
export const IconCopy = make(<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>);
export const IconPlus = make(<><path d="M12 5v14M5 12h14" /></>);
export const IconLogout = make(<><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>);
export const IconShield = make(<><path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>);
export const IconSparkle = make(<><path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l1.8 1.8M15.2 15.2 17 17M7 17l1.8-1.8M15.2 8.8 17 7" /></>);
export const IconCard = make(<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>);
export const IconGlobe = make(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5S9.6 6.1 12 3.5" /></>);
export const IconExternal = make(<><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5" /></>);
export const IconMail = make(<><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconShirt = make(<><path d="M8.5 4 4 6.5l1.8 4 2.2-1V20h8V9.5l2.2 1 1.8-4L15.5 4a3.5 3.5 0 0 1-7 0" /></>);
export const IconDrop = make(<><path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5" /></>);
export const IconSofa = make(<><path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" /><path d="M3.5 12.5a1.5 1.5 0 0 1 3 0V14h11v-1.5a1.5 1.5 0 0 1 3 0V18h-17zM6 18v2M18 18v2" /></>);
export const IconChip = make(<><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" /></>);
export const IconApple = make(<><path d="M12 8c-1.5-1.3-6-1.6-6 3.6 0 3.8 2.6 8.4 4.3 8.4.9 0 1-.5 1.7-.5s.8.5 1.7.5c1.7 0 4.3-4.6 4.3-8.4C18 6.4 13.5 6.7 12 8" /><path d="M12 8c0-2 1-3.5 3-4" /></>);
export const IconDownload = make(<><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></>);
export const IconWrench = make(<><path d="M14.5 5.5a4 4 0 0 0 5 5L13 17a2.8 2.8 0 0 1-4-4z" /><path d="M9 13 4 18l2 2 5-5" /></>);
export const IconDots = make(<><circle cx="5.5" cy="12" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="18.5" cy="12" r=".9" fill="currentColor" /></>);

/** Marca propia: cuatro módulos, uno destacado. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect x="2" y="2" width="13" height="13" rx="4" fill="#8b85f4" />
      <rect x="17" y="2" width="13" height="13" rx="4" fill="currentColor" opacity=".9" />
      <rect x="2" y="17" width="13" height="13" rx="4" fill="currentColor" opacity=".9" />
      <rect x="17" y="17" width="13" height="13" rx="6.5" fill="currentColor" opacity=".45" />
    </svg>
  );
}
