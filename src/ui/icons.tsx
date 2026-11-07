import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>;

function make(paths: ReactNode, defaults: { stroke?: number } = {}) {
  return function Icon({ size = 20, strokeWidth, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth ?? defaults.stroke ?? 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconNote = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h5" /></>);
export const IconBoard = make(<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>);
export const IconColumn = make(<><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10 8h4" /></>);
export const IconTasks = make(<><rect x="3" y="5" width="5" height="5" rx="1" /><path d="M4.5 7.5l1 1 1.5-2" /><path d="M11 7.5h10M3 16h5M11 16h10" /></>);
export const IconLink = make(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>);
export const IconMedia = make(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>);
export const IconTable = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>);
export const IconScript = make(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h3M9 16h7" /></>);
export const IconLine = make(<><path d="M5 19L19 5" /><path d="M13 5h6v6" /></>);
export const IconDraw = make(<><path d="M4 20c4 0 4-4 8-4" /><path d="M14 14l6-6-3-3-6 6z" /></>);
export const IconTrash = make(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />);
export const IconHome = make(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>, { stroke: 2 });
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>, { stroke: 2 });
export const IconUndo = make(<><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></>, { stroke: 2 });
export const IconRedo = make(<><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></>, { stroke: 2 });
export const IconMoon = make(<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />, { stroke: 2 });
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, { stroke: 2 });
export const IconMinus = make(<path d="M5 12h14" />, { stroke: 2.2 });
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, { stroke: 2.2 });
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />, { stroke: 2.4 });
export const IconBullets = make(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>, { stroke: 2 });
export const IconNumbers = make(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1.5v4M3.5 9h3M3.5 14.5a1.5 1.5 0 013 .5L3.5 19h3" /></>, { stroke: 1.8 });
export const IconCheckbox = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>, { stroke: 2 });
export const IconQuote = make(<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6" />, { stroke: 2 });
export const IconCode = make(<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />, { stroke: 2 });
export const IconCenter = make(<path d="M5 6h14M8 10h8M5 14h14M8 18h8" />, { stroke: 2 });
export const IconLock = make(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>, { stroke: 2 });
export const IconPresent = make(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8" /></>, { stroke: 2 });
export const IconInbox = make(<><path d="M4 13l3-8h10l3 8v6H4z" /><path d="M4 13h5l1 2h4l1-2h5" /></>, { stroke: 2 });
export const IconFile = make(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>);
export const IconPlay = make(<path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />);
export const IconExternal = make(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>, { stroke: 2 });
export const IconSwatch = make(<><path d="M12 3a9 9 0 100 18c1.1 0 1.5-.9 1.2-1.7-.4-1 .3-2.3 1.5-2.3H17a4 4 0 004-4c0-5-4-10-9-10z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>);
export const IconTag = make(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8" r="1.5" /></>);
export const IconSketch = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15c2-4 4 1 6-2s3-2 4-1" /></>);
