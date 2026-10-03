import { useId } from 'react';

import type { Guernsey } from '@/lib/clubGuernseys';

/**
 * Drawing for the lineup field: the oval and a club guernsey. Decorative only; the players and
 * spots on top are real buttons.
 */

const BODY =
  'M9 5 L16 2 L20 9 L24 2 L31 5 L37 15 Q32 17 31 22 L31 42 Q20 44 9 42 L9 22 Q8 17 3 15 Z';

export function GuernseyIcon({
  guernsey,
  className = '',
}: {
  guernsey: Guernsey;
  className?: string;
}): React.JSX.Element {
  const clipId = useId();
  const { base, trim, accent = trim, pattern } = guernsey;
  return (
    <svg viewBox="0 0 40 46" aria-hidden="true" className={className}>
      <defs>
        <clipPath id={clipId}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="40" height="46" fill={base} />
        {pattern === 'hoops' ? (
          <>
            <rect y="17" width="40" height="5" fill={trim} />
            <rect y="22" width="40" height="2" fill={accent} />
            <rect y="30" width="40" height="5" fill={trim} />
          </>
        ) : null}
        {pattern === 'band' ? (
          <>
            <rect y="19" width="40" height="3" fill={accent} />
            <rect y="22" width="40" height="5" fill={trim} />
            <rect y="27" width="40" height="3" fill={accent} />
          </>
        ) : null}
        {pattern === 'stripes'
          ? [11, 19, 27].map((x) => <rect key={x} x={x} width="4" height="46" fill={trim} />)
          : null}
        {pattern === 'sash' ? <path d="M6 4 L15 1 L38 40 L30 46 Z" fill={trim} /> : null}
        {pattern === 'yoke' ? (
          <>
            <rect width="40" height="15" fill={trim} />
            {accent !== trim ? <rect y="15" width="40" height="2" fill={accent} /> : null}
          </>
        ) : null}
        {pattern === 'vee' ? (
          <>
            <path d="M0 8 L20 24 L40 8 L40 13 L20 29 L0 13 Z" fill={trim} />
            {accent !== trim ? (
              <path d="M0 13 L20 29 L40 13 L40 15 L20 31 L0 15 Z" fill={accent} />
            ) : null}
          </>
        ) : null}
        {pattern === 'halves' ? <rect x="20" width="20" height="46" fill={trim} /> : null}
        {pattern === 'panels' ? (
          <>
            <rect width="15" height="46" fill={trim} />
            <rect x="15" width="10" height="46" fill={accent} />
          </>
        ) : null}
      </g>
      <path d={BODY} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth="1.2" />
    </svg>
  );
}

const GRASS = {
  backgroundColor: '#2f7a31',
  backgroundImage:
    'repeating-linear-gradient(to bottom, #2f7a31 0, #2f7a31 8%, #37853a 8%, #37853a 16%)',
} as const;

/**
 * An AFL oval, attacking end at the top. Built from boxes so the circles stay round whatever the
 * field's height; it stretches to fill its parent. Every marking sits inside the boundary line,
 * which clips them, so the 50m arcs meet the boundary instead of running over it.
 */
export function FieldOval(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden rounded-[50%] shadow-inner ring-4 ring-[#256328]"
      style={GRASS}
    >
      <div className="absolute inset-[3%] overflow-hidden rounded-[50%] border-2 border-white/85">
        <div className="absolute left-1/2 top-[-42%] aspect-square w-[84%] -translate-x-1/2 rounded-full border-2 border-white/60" />
        <div className="absolute bottom-[-42%] left-1/2 aspect-square w-[84%] -translate-x-1/2 rounded-full border-2 border-white/60" />
        <div className="absolute left-1/2 top-1/2 aspect-square w-[38%] -translate-x-1/2 -translate-y-1/2 border-2 border-white/60" />
        <div className="absolute left-1/2 top-1/2 aspect-square w-[17%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60" />
        <div className="absolute left-1/2 top-1/2 aspect-square w-[5%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60" />
        <div className="absolute left-1/2 top-0 h-[5%] w-[12%] -translate-x-1/2 border-2 border-t-0 border-white/85" />
        <div className="absolute bottom-0 left-1/2 h-[5%] w-[12%] -translate-x-1/2 border-2 border-b-0 border-white/85" />
      </div>
    </div>
  );
}
