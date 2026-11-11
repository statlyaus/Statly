import type { ReactNode } from 'react';

import s from './StatlyIcon.module.css';

/**
 * Statly's animated line icons. Stroke-only, `currentColor`, 24px grid. Secondary
 * strokes are drawn at reduced opacity. Parts animate when the enclosing link or
 * button is hovered or focused, and once on load for the current page; static when
 * the user prefers reduced motion. Decorative: always `aria-hidden`.
 */
export type StatlyIconName =
  | 'home'
  | 'gauge'
  | 'bolt'
  | 'players'
  | 'draft'
  | 'basketball'
  | 'tools'
  | 'stopwatch'
  | 'footy'
  | 'trade'
  | 'ladder'
  | 'team'
  | 'commissioner'
  | 'help';

const cx = (...names: Array<string | undefined | false>) => names.filter(Boolean).join(' ');

/** Path that draws itself on when animated. `pathLength` normalises the dash maths. */
function Draw({ d, className }: { d: string; className?: string }) {
  return <path d={d} pathLength={1} className={cx(s.draw, className)} />;
}

const glyphs: Record<StatlyIconName, ReactNode> = {
  home: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" className={cx(s.soft, s.part, s.swing)} />
    </>
  ),
  gauge: (
    <>
      <path d="M4 17a8 8 0 0 1 16 0" />
      <path
        d="M12 9v1.6M6.3 11.3l1.1 1.1M17.7 11.3l-1.1 1.1M4 17h1.6M20 17h-1.6"
        className={s.soft}
      />
      <path d="M12 17l3.6-4.4" className={cx(s.part, s.originPivotLeft, s.sweep)} />
      <circle cx="12" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <path d="M7 21h10" className={s.soft} />
    </>
  ),
  bolt: (
    <g className={cx(s.part, s.flash)}>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
    </g>
  ),
  players: (
    <g className={cx(s.part, s.originTop, s.sway)}>
      <path d="M9 3 6.5 3.8C7.2 6.2 6.6 8 5 9v12h14V9c-1.6-1-2.2-2.8-1.5-5.2L15 3" />
      <path d="M9 3q3 4 6 0" />
      <Draw d="M10 11.5h4l-2.5 6" className={s.soft} />
    </g>
  ),
  draft: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="1.5" />
      <path d="M8 8h.01M8 12h.01M8 16h.01" strokeWidth={2.5} />
      <Draw d="M11 8h5" className={s.soft} />
      <Draw d="M11 12h5" className={cx(s.soft, s.delay1)} />
      <Draw d="M11 16h3.5" className={cx(s.soft, s.delay2)} />
    </>
  ),
  basketball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <g className={cx(s.soft, s.part, s.spin)}>
        <path d="M3 12h18M12 3v18M5.6 5.6c2.4 2.4 2.4 10.4 0 12.8M18.4 5.6c-2.4 2.4-2.4 10.4 0 12.8" />
      </g>
    </>
  ),
  tools: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" className={s.soft} />
      <circle cx="9" cy="7" r="1.75" fill="currentColor" className={cx(s.part, s.slideRight)} />
      <circle cx="15" cy="12" r="1.75" fill="currentColor" className={cx(s.part, s.slideLeft)} />
      <circle cx="8" cy="17" r="1.75" fill="currentColor" className={cx(s.part, s.slideRight)} />
    </>
  ),
  stopwatch: (
    <>
      <path d="M12 2.5v2" />
      <path d="M17.5 6.5 19 5" className={s.soft} />
      <circle cx="12" cy="13.5" r="8" />
      <path d="M12 13.5V9" className={cx(s.soft, s.part, s.originPivot, s.spin)} />
    </>
  ),
  footy: (
    <g className={cx(s.part, s.wobble)} style={{ transform: 'rotate(-25deg)' }}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6" />
      <path d="M9 12h6" className={s.soft} />
      <path d="M10 10.5v3M12 10.5v3M14 10.5v3" className={s.soft} />
    </g>
  ),
  trade: (
    <>
      <g className={cx(s.part, s.slideRight)}>
        <path d="M4 8h15" />
        <path d="m15.5 4.5 3.5 3.5-3.5 3.5" />
      </g>
      <g className={cx(s.soft, s.part, s.slideLeft)}>
        <path d="M20 16H5" />
        <path d="M8.5 12.5 5 16l3.5 3.5" />
      </g>
    </>
  ),
  ladder: (
    <>
      <path d="M3 21h18" className={s.soft} />
      <path d="M6 21v-7" className={cx(s.part, s.originBottom, s.grow)} />
      <path
        d="M12 21V6"
        className={cx(s.part, s.originBottom, s.grow)}
        style={{ animationDelay: '0.12s' }}
      />
      <path
        d="M18 21v-10"
        className={cx(s.part, s.originBottom, s.grow)}
        style={{ animationDelay: '0.24s' }}
      />
    </>
  ),
  team: (
    <>
      <g className={cx(s.soft, s.part, s.bob)}>
        <circle cx="5.5" cy="9" r="2" />
        <path d="M2 19v-1a3.5 3.5 0 0 1 5-3.2" />
      </g>
      <g className={cx(s.part, s.bob)} style={{ animationDelay: '0.12s' }}>
        <circle cx="12" cy="7.5" r="2.75" />
        <path d="M6.5 20v-1.5a5.5 5.5 0 0 1 11 0V20" />
      </g>
      <g className={cx(s.soft, s.part, s.bob)} style={{ animationDelay: '0.24s' }}>
        <circle cx="18.5" cy="9" r="2" />
        <path d="M22 19v-1a3.5 3.5 0 0 0-5-3.2" />
      </g>
    </>
  ),
  commissioner: (
    <>
      <g className={cx(s.part, s.turn)}>
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
        <circle cx="12" cy="12" r="6" />
      </g>
      <circle cx="12" cy="12" r="2.25" className={s.soft} />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" className={s.soft} />
      <Draw d="M9.25 9.5a2.85 2.85 0 0 1 5.5 1c0 1.9-2.75 2.4-2.75 4" />
      <path d="M12 17.5h.01" strokeWidth={2.5} className={cx(s.part, s.drop)} />
    </>
  ),
};

export interface StatlyIconProps {
  name: StatlyIconName;
  className?: string;
  strokeWidth?: number;
}

export default function StatlyIcon({
  name,
  className = 'h-4 w-4',
  strokeWidth = 2,
}: StatlyIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-statly-icon={name}
      className={cx(s.icon, className)}
    >
      {glyphs[name]}
    </svg>
  );
}
