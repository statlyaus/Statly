import type { CSSProperties, ReactNode } from 'react';

/**
 * The pieces a story collage is made of: a stage, ink sketches, masking tape, handwriting and taped
 * notes. Each is placed by percentages of its stage, so a collage keeps its arrangement at any width.
 */

export interface Place {
  readonly left?: string;
  readonly right?: string;
  readonly top?: string;
  readonly width?: string;
  readonly height?: string;
  readonly rotate?: number;
  readonly z?: number;
}

export const place = ({ left, right, top, width, height, rotate, z }: Place): CSSProperties => ({
  position: 'absolute',
  left,
  right,
  top,
  width,
  height,
  transform: rotate === undefined ? undefined : `rotate(${rotate}deg)`,
  zIndex: z,
});

/** One collage. Screen readers get the description; the pieces inside are the picture. */
export function Stage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sc-stage" role="img" aria-label={label}>
      {children}
    </div>
  );
}

/** An original ink sketch from /Assets/stories/cameron. */
export function Sketch({ name, style, ...box }: Place & { name: string; style?: CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a decorative SVG placed by percentages
    <img
      src={`/Assets/stories/cameron/${name}.svg`}
      alt=""
      aria-hidden="true"
      className={`sc-sk-${name}`}
      style={{ ...place(box), ...style }}
    />
  );
}

export function Tape(box: Place) {
  return <span aria-hidden="true" className="sc-tape" style={place(box)} />;
}

/** A handwritten line. */
export function Hand({
  size = 'lg',
  red = false,
  weight,
  children,
  ...box
}: Place & { size?: 'xl' | 'lg' | 'md'; red?: boolean; weight?: number; children: ReactNode }) {
  return (
    <p
      className={`sc-hand sc-hand-${size}`}
      style={{
        ...place({ z: 6, ...box }),
        color: red ? 'var(--sc-red)' : undefined,
        fontWeight: weight,
      }}
    >
      {children}
    </p>
  );
}

/** A number on a taped note, with a handwritten caption. */
export function Note({
  value,
  circled = false,
  children,
  ...box
}: Place & { value: string; circled?: boolean; children: ReactNode }) {
  return (
    <div className="sc-note" style={place(box)}>
      <Tape left="30%" top="-14px" width="40%" rotate={-3} />
      <b className="sc-label">
        {circled ? (
          <Sketch
            name="circle"
            left="-24%"
            top="-10%"
            width="148%"
            z={0}
            style={{ height: '120%' }}
          />
        ) : null}
        <span style={{ position: 'relative' }}>{value}</span>
      </b>
      <p className="sc-hand sc-hand-sm">{children}</p>
    </div>
  );
}
