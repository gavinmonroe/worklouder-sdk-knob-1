// WD icon set — inline SVG only, no external assets.
// 16×16 grid, stroke currentColor 1.5, round caps/joins, aria-hidden by
// default (pair with a visible label or aria-label on the wrapping control).

import * as React from "react";

export type IconName =
  | "play"
  | "download"
  | "upload"
  | "chevron-down"
  | "chevron-right"
  | "plus"
  | "minus"
  | "rotate-ccw"
  | "keyboard"
  | "cable"
  | "check"
  | "check-circle"
  | "alert-triangle"
  | "x-circle"
  | "x"
  | "info"
  | "copy"
  | "send"
  | "sun"
  | "moon"
  | "search"
  | "terminal"
  | "dial"
  | "clock"
  | "film"
  | "gear"
  | "sidebar"
  | "book";

const GLYPHS: Record<IconName, React.ReactNode> = {
  play: <path d="M5.2 3.2v9.6L13 8 5.2 3.2z" />,
  download: (
    <>
      <path d="M8 2.5v7.8" />
      <path d="m4.8 7.2 3.2 3.2 3.2-3.2" />
      <path d="M2.8 13.5h10.4" />
    </>
  ),
  upload: (
    <>
      <path d="M8 10.5V2.8" />
      <path d="M4.8 6 8 2.8 11.2 6" />
      <path d="M2.8 13.5h10.4" />
    </>
  ),
  "chevron-down": <path d="m4.2 6 3.8 3.8L11.8 6" />,
  "chevron-right": <path d="m6 4.2 3.8 3.8L6 11.8" />,
  plus: (
    <>
      <path d="M8 3.2v9.6" />
      <path d="M3.2 8h9.6" />
    </>
  ),
  minus: <path d="M3.2 8h9.6" />,
  "rotate-ccw": (
    <>
      <path d="M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.5 1.8L2 5.3" />
      <path d="M2 2v3.3h3.3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7.5" rx="1.5" />
      <path d="M4 7h.01" />
      <path d="M6.6 7h.01" />
      <path d="M9.2 7h.01" />
      <path d="M11.8 7h.01" />
      <path d="M5 9.5h6" />
    </>
  ),
  cable: (
    <>
      <path d="M7 1v1.5" />
      <path d="M9 1v1.5" />
      <rect x="5.5" y="2.5" width="5" height="4" rx="1" />
      <path d="M8 6.5v2.5a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 0 3 14v1" />
    </>
  ),
  check: <path d="m3.2 8.6 3 3 6.6-7" />,
  "check-circle": (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.2 8.4 1.9 1.9 3.9-4.4" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="m8 2.2 6.4 11.1a.8.8 0 0 1-.7 1.2H2.3a.8.8 0 0 1-.7-1.2L8 2.2z" />
      <path d="M8 6.5v3.2" />
      <path d="M8 12.2h.01" />
    </>
  ),
  "x-circle": (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m6 6 4 4" />
      <path d="m10 6-4 4" />
    </>
  ),
  x: (
    <>
      <path d="m4 4 8 8" />
      <path d="m12 4-8 8" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v3.6" />
      <path d="M8 5h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5h-.5A1.5 1.5 0 0 1 1 9V3a1.5 1.5 0 0 1 1.5-1.5H9A1.5 1.5 0 0 1 10.5 3v.5" />
    </>
  ),
  send: (
    <>
      <path d="M14.5 1.5 10 14.5l-2.7-6.3-6.3-2.7z" />
      <path d="M14.5 1.5 7.3 8.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.2V3" />
      <path d="M8 13v1.8" />
      <path d="M1.2 8H3" />
      <path d="M13 8h1.8" />
      <path d="m3.2 3.2 1.3 1.3" />
      <path d="m11.5 11.5 1.3 1.3" />
      <path d="m12.8 3.2-1.3 1.3" />
      <path d="m4.5 11.5-1.3 1.3" />
    </>
  ),
  moon: <path d="M8 2a4 4 0 0 0 6 6 6 6 0 1 1-6-6z" />,
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.7" />
      <path d="M10.7 10.7 14 14" />
    </>
  ),
  terminal: (
    <>
      <path d="m3.5 4.5 3.5 3.5-3.5 3.5" />
      <path d="M8.5 11.5H13" />
    </>
  ),
  // Rotary knob: cap circle, pointer tick, and the two end-stop marks.
  dial: (
    <>
      <circle cx="8" cy="8" r="4.8" />
      <path d="m8 8 2.3-2.3" />
      <path d="m2 13.6 1.3-1.3" />
      <path d="m14 13.6-1.3-1.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.4 1.5" />
    </>
  ),
  film: (
    <>
      <rect x="1.8" y="3" width="12.4" height="10" rx="1.5" />
      <path d="M5 3v10" />
      <path d="M11 3v10" />
      <path d="M1.8 6.4h3.2" />
      <path d="M1.8 9.6h3.2" />
      <path d="M11 6.4h3.2" />
      <path d="M11 9.6h3.2" />
    </>
  ),
  // Cog: hub + rim + eight radial teeth.
  gear: (
    <>
      <circle cx="8" cy="8" r="4.1" />
      <circle cx="8" cy="8" r="1.4" />
      <path d="M8 1.6v2.2" />
      <path d="M8 12.2v2.2" />
      <path d="M1.6 8h2.2" />
      <path d="M12.2 8h2.2" />
      <path d="m3.47 3.47 1.56 1.56" />
      <path d="m10.97 10.97 1.56 1.56" />
      <path d="m12.53 3.47-1.56 1.56" />
      <path d="m5.03 10.97-1.56 1.56" />
    </>
  ),
  sidebar: (
    <>
      <rect x="1.8" y="3" width="12.4" height="10" rx="1.5" />
      <path d="M6.2 3v10" />
    </>
  ),
  book: (
    <>
      <path d="M8 3.6C6.9 2.7 5.2 2.3 3 2.5v10.1c2.2-.2 3.9.2 5 1 1.1-.8 2.8-1.2 5-1V2.5c-2.2-.2-3.9.2-5 1.1z" />
      <path d="M8 3.6v10" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  ...rest
}: {
  name: IconName;
  size?: number;
  className?: string;
} & Omit<React.SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}
