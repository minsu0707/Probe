/** The few icons the app needs, as inline SVG paths (24×24, stroked, so they follow `color`). */
const PATHS = {
  services: 'M4 6h16M4 12h16M4 18h10',
  learn: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z',
  monitor: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  results: 'M12 3.5 21 19H3zM12 10v4M12 16.5v.01',
  settings: 'M5 7h9M18 7h1M5 17h1M10 17h9M14 4v6M6 14v6',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  drive: 'M8 4h8l5 9-4 7H7l-4-7zM8 4l5 9h8M13 13l-4 7',
  check: 'M5 12.5 10 17.5 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A probe tip: a ring with a crosshair and a centre dot. */
export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--accent)" strokeWidth="3" />
      <path d="M16 2v7M16 23v7M2 16h7M23 16h7" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.5" fill="var(--accent)" />
    </svg>
  );
}
