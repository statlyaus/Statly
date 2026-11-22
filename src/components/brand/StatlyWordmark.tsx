import type { CSSProperties } from 'react';

/**
 * The Statly wordmark, copied from the approved design system (`ds2/a-core.html`, owner 2026-11-20):
 * lowercase "statly" in Geist 900 with the hand-drawn Sherrin tilted −14° resting on the tip of the
 * y. One source for the app bar, the public header, the footer, the home masthead and the sign-in
 * pages. In `bar` and `mast` the ball takes the text colour (white on cobalt, ink on light grounds);
 * `lockup` is the brand board's hero lockup: ink word, cobalt ball filled white, on a light ground.
 */
export function StatlyWordmark({
  size = 'bar',
  className = '',
}: {
  size?: 'bar' | 'mast' | 'lockup';
  className?: string;
}) {
  const { text, ball } = SIZES[size];
  return (
    <span className={`relative inline-block ${className}`} style={text}>
      statly
      <SherrinMark
        solid={size === 'lockup'}
        className={`absolute -rotate-[14deg] ${size === 'lockup' ? 'text-primary' : ''}`}
        style={ball}
      />
    </span>
  );
}

const SIZES: Record<'bar' | 'mast' | 'lockup', { text: CSSProperties; ball: CSSProperties }> = {
  bar: {
    text: { font: '900 1.6rem/0.85 var(--font-display)', letterSpacing: '-0.045em' },
    ball: { width: '1.15em', left: 'calc(100% - 0.3em)', bottom: '52%' },
  },
  mast: {
    text: {
      font: '900 clamp(4.4rem, 17vw, 15rem)/0.78 var(--font-display)',
      letterSpacing: '-0.07em',
    },
    ball: { width: '0.9em', left: 'calc(100% - 0.2em)', bottom: '52%' },
  },
  lockup: {
    text: {
      font: '900 clamp(4.2rem, 11vw, 8.5rem)/0.85 var(--font-display)',
      letterSpacing: '-0.045em',
    },
    ball: { width: '1.2em', left: 'calc(100% - 0.3em)', bottom: '47%' },
  },
};

/** The hand-drawn Sherrin from the design system, with its rough-pencil wobble. */
export function SherrinMark({
  className = '',
  style,
  solid = false,
}: {
  className?: string;
  style?: CSSProperties;
  /** Fill the ball with the page ground under the outline (the board's white `sherrin-solid`), for light grounds. */
  solid?: boolean;
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
        {solid ? (
          <path
            fill="var(--background)"
            stroke="none"
            d="M10 42 C 22 14, 92 6, 110 36 C 98 66, 30 72, 10 42 Z"
          />
        ) : null}
        <path strokeWidth="3" d="M10 42 C 22 14, 92 6, 110 36 C 98 66, 30 72, 10 42 Z" />
        <path strokeWidth="2" d="M48 24 L 74 22 M52 19 l2 9 M58 18 l1 9 M64 18 l1 9 M70 18 l0 8" />
        <path strokeWidth="2" d="M24 46 C 46 52, 76 50, 98 40" />
        <circle cx="46" cy="38" r="2.6" fill="currentColor" stroke="none" />
        <circle cx="58" cy="37" r="2.6" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
