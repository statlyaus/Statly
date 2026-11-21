import type { CSSProperties } from 'react';

/**
 * The Statly wordmark, copied from the approved design system (`ds2/a-core.html`, owner 2026-11-20):
 * lowercase "statly" in Geist 900 with the hand-drawn Sherrin tilted −14° resting on the tip of the
 * y. One source for the app bar, the public header, the footer and the home masthead. The ball
 * takes the text colour, so it is white on cobalt and ink on light grounds.
 */
export function StatlyWordmark({
  size = 'bar',
  className = '',
}: {
  size?: 'bar' | 'mast';
  className?: string;
}) {
  const text: CSSProperties =
    size === 'mast'
      ? {
          font: '900 clamp(4.4rem, 17vw, 15rem)/0.78 var(--font-display)',
          letterSpacing: '-0.07em',
        }
      : { font: '900 1.6rem/0.85 var(--font-display)', letterSpacing: '-0.045em' };
  const ball: CSSProperties =
    size === 'mast'
      ? { width: '0.9em', left: 'calc(100% - 0.2em)' }
      : { width: '1.15em', left: 'calc(100% - 0.3em)' };
  return (
    <span className={`relative inline-block ${className}`} style={text}>
      statly
      <SherrinMark className="absolute bottom-[52%] -rotate-[14deg]" style={ball} />
    </span>
  );
}

/** The hand-drawn Sherrin from the design system, with its rough-pencil wobble. */
export function SherrinMark({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 120 80"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      <defs>
        <filter id="statly-sherrin-rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
      </defs>
      <g
        filter="url(#statly-sherrin-rough)"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path strokeWidth="3" d="M10 42 C 22 14, 92 6, 110 36 C 98 66, 30 72, 10 42 Z" />
        <path strokeWidth="2" d="M48 24 L 74 22 M52 19 l2 9 M58 18 l1 9 M64 18 l1 9 M70 18 l0 8" />
        <path strokeWidth="2" d="M24 46 C 46 52, 76 50, 98 40" />
        <circle cx="46" cy="38" r="2.6" fill="currentColor" stroke="none" />
        <circle cx="58" cy="37" r="2.6" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
