'use client';

import { useEffect, useId, useState, type CSSProperties, type PointerEvent } from 'react';

import type { MarkKind } from './TradeTree';

/**
 * The trade tree's key (owner, 2026-11-28): a row of icon buttons. Pointing at one with a mouse, or
 * focusing it, shows what it means and lights up its marks in the chart; a click or tap pins it, a
 * second click or Escape clears it. The chart's highlighter is drawn by the server and shown by the
 * stylesheet from this row's `data-active`, so the chart itself stays a server component.
 */

const ORDER: readonly MarkKind[] = ['received', 'other', 'away', 'pick', 'traded'];

/** One plain sentence per mark: no bold run-in (owner, 2026-11-28). */
const MEANING: Record<MarkKind, { readonly name: string; readonly says: string }> = {
  received: {
    name: 'Held by the club that received it',
    says: 'Solid ink is held by the club that received it in this trade, so its PAV counts for that side.',
  },
  other: {
    name: 'Held by the other club in the trade',
    says: 'Grey is held by the other club in the trade.',
  },
  away: {
    name: 'At another club',
    says: 'Hatched is at another club: it left both clubs in the trade, and its PAV counts for neither side.',
  },
  pick: {
    name: 'Still a pick',
    says: 'An outline is still a pick, not yet used. It turns solid at the draft dot, where it became a player.',
  },
  traded: {
    name: 'Traded on',
    says: 'The ring marks where a pick or player was traded on, to the club named under the lane.',
  },
};

const IDLE = 'Point at or tap an icon to find it in the tree.';

function KeyIcon({ kind, hatch }: { kind: MarkKind; hatch: string }) {
  if (kind === 'traded')
    return (
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
        <circle
          cx="10"
          cy="10"
          r="8.5"
          fill="var(--card)"
          stroke="var(--foreground)"
          strokeWidth="1.5"
        />
        <text
          x="10"
          y="14"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="var(--foreground)"
        >
          ⇄
        </text>
      </svg>
    );
  return (
    <svg aria-hidden="true" width="26" height="10" viewBox="0 0 26 10">
      {kind === 'away' ? (
        <defs>
          <pattern
            id={hatch}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill="var(--card)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--foreground)" strokeWidth="2" />
          </pattern>
        </defs>
      ) : null}
      {kind === 'pick' ? (
        <rect
          x="0.6"
          y="2.6"
          width="24.8"
          height="4.8"
          fill="var(--card)"
          stroke="var(--foreground)"
          strokeWidth="1.2"
        />
      ) : (
        <rect
          width="26"
          height="10"
          fill={
            kind === 'received'
              ? 'var(--foreground)'
              : kind === 'other'
                ? 'var(--muted-foreground)'
                : `url(#${hatch})`
          }
        />
      )}
    </svg>
  );
}

export function TradeTreeKey({ kinds }: { kinds: readonly MarkKind[] }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/gu, '');
  const shown = ORDER.filter((kind) => kinds.includes(kind));
  const [pinned, setPinned] = useState<MarkKind | null>(null);
  const [preview, setPreview] = useState<MarkKind | null>(null);
  const active = preview ?? pinned;

  useEffect(() => {
    if (pinned === null) return;
    const clear = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPinned(null);
      setPreview(null);
    };
    document.addEventListener('keydown', clear);
    return () => document.removeEventListener('keydown', clear);
  }, [pinned]);

  // Only a mouse previews on hover: a tap's emulated hover would stick after the tap.
  const onEnter = (kind: MarkKind) => (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setPreview(kind);
  };
  const onLeave = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setPreview(null);
  };

  return (
    <div className="ttk" data-active={active ?? undefined}>
      <div className="ttk-row" role="group" aria-label="Key">
        {shown.map((kind, at) => (
          <button
            key={kind}
            type="button"
            className="ttk-btn"
            aria-pressed={pinned === kind}
            aria-describedby={`${id}-says`}
            style={{ '--ttk-at': at } as CSSProperties}
            onPointerEnter={onEnter(kind)}
            onPointerLeave={onLeave}
            // Keyboard focus previews; the focus a click leaves behind does not.
            onFocus={(event) => {
              if (event.currentTarget.matches(':focus-visible')) setPreview(kind);
            }}
            onBlur={() => setPreview(null)}
            onClick={() => {
              // Unpinning also ends the preview the focus left behind.
              if (pinned === kind) setPreview(null);
              setPinned((now) => (now === kind ? null : kind));
            }}
          >
            <KeyIcon kind={kind} hatch={`${id}-hatch`} />
            <span className="sr-only">{MEANING[kind].name}</span>
          </button>
        ))}
        {active ? (
          <span
            aria-hidden="true"
            className="ttk-marker"
            style={{ '--ttk-at': shown.indexOf(active) } as CSSProperties}
          />
        ) : null}
      </div>
      <p className="ttk-says" id={`${id}-says`}>
        {active ? MEANING[active].says : IDLE}
      </p>
    </div>
  );
}
