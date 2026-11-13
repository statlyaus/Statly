'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

import { revealFrame, type RevealDraw } from './bloodsuckerDisplay';

/** How often every lobby client re-reads the committed draw (NFR-7: no socket needed). */
export const DRAW_POLL_MS = 3000;

interface LobbyState {
  leagueFormat: string;
  bloodsucker: { memberId: string; teamName: string } | null;
  method: 'DRAW' | 'CHOSEN' | null;
  draw: RevealDraw | null;
  canManage: boolean;
  canDraw: boolean;
  drawBlockedReason: string | null;
  serverNow: string;
}

type DrawCommand =
  { status: 'idle' } | { status: 'saving' } | { status: 'failed'; code: string; message: string };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The draft lobby's "Draw the Bloodsucker" (BR-04b, US-2 AC1b). The server draws and commits; every
 * client, the commissioner's included, replays the same reveal from the committed draw it reads on
 * the poll, timed from the server's `drawnAt`. A refresh reads the same draw and never draws again.
 */
export function BloodsuckerDrawPanel({
  leagueId,
  userId,
  onSettled,
}: {
  leagueId: string;
  userId?: string;
  /** Called once a reveal has finished, so the room can re-read readiness. */
  onSettled?: () => void;
}) {
  const [state, setState] = useState<LobbyState | null>(null);
  const [command, setCommand] = useState<DrawCommand>({ status: 'idle' });
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const settledDrawId = useRef<string | null>(null);
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/bloodsucker/draw`;

  const accept = useCallback((next: LobbyState) => {
    setClockOffsetMs(Date.parse(next.serverNow) - Date.now());
    setState(next);
  }, []);

  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const response = await authenticatedFetch(endpoint, { cache: 'no-store' }, userId);
        if (response.ok && active) accept((await response.json()) as LobbyState);
      } catch {
        // The next poll retries; the last committed state stays on screen.
      }
    };
    void read();
    const interval = window.setInterval(() => void read(), DRAW_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [accept, endpoint, userId]);

  const draw = state?.draw ?? null;
  const frame = draw
    ? prefersReducedMotion()
      ? { memberId: draw.winnerMemberId, done: true }
      : revealFrame(draw, nowMs + clockOffsetMs)
    : null;
  const revealing = frame !== null && !frame.done;

  useEffect(() => {
    if (!revealing) return;
    const tick = window.setInterval(() => setNowMs(Date.now()), 80);
    return () => window.clearInterval(tick);
  }, [revealing]);

  // Only a draw this client saw arrive (or saw mid-reveal) refreshes the room. A draw already
  // settled on the first read is already reflected in the room's readiness, and refreshing then
  // would remount this panel and refresh again.
  const sawUnsettled = useRef(false);
  useEffect(() => {
    if (state && (!draw || revealing)) sawUnsettled.current = true;
  }, [state, draw, revealing]);
  useEffect(() => {
    if (draw && frame?.done && sawUnsettled.current && settledDrawId.current !== draw.drawId) {
      settledDrawId.current = draw.drawId;
      onSettled?.();
    }
  }, [draw, frame?.done, onSettled]);

  const startDraw = async () => {
    setCommand({ status: 'saving' });
    try {
      const response = await authenticatedFetch(endpoint, { method: 'POST' }, userId);
      const body = (await response.json().catch(() => ({}))) as Partial<LobbyState> & {
        code?: string;
        error?: string;
      };
      if (!response.ok) {
        setCommand({
          status: 'failed',
          code: body.code ?? `HTTP_${response.status}`,
          message: body.error ?? 'The draw did not run.',
        });
        return;
      }
      setNowMs(Date.now());
      accept(body as LobbyState);
      setCommand({ status: 'idle' });
    } catch {
      setCommand({
        status: 'failed',
        code: 'NETWORK_ERROR',
        message: 'The draw could not reach the server. Nothing was drawn; try again.',
      });
    }
  };

  if (!state || state.leagueFormat !== 'BLOODSUCKER') return null;

  const shownTeam = frame
    ? draw?.candidates.find((candidate) => candidate.memberId === frame.memberId)?.teamName
    : null;
  const winnerTeam = draw?.candidates.find(
    (candidate) => candidate.memberId === draw.winnerMemberId
  )?.teamName;

  return (
    <section
      aria-labelledby="bloodsucker-draw-title"
      className="mx-4 rounded-lg border border-[color:var(--draft-broadcast-alert)] bg-[color:var(--draft-broadcast-panel)] p-4 text-[color:var(--draft-broadcast-text)] sm:mx-6 sm:p-5 lg:mx-8"
    >
      <h2 id="bloodsucker-draw-title" className="text-base font-semibold sm:text-lg">
        The Bloodsucker
      </h2>
      <p className="mt-1 text-sm text-[color:var(--draft-broadcast-muted)]">
        One team skips the draft, builds from free agents, and takes a player from every team it
        beats.
      </p>

      {draw && frame ? (
        <div className="mt-4">
          <p
            aria-hidden="true"
            className={`text-2xl font-bold tracking-tight sm:text-3xl ${revealing ? 'opacity-80' : ''}`}
          >
            {shownTeam ?? winnerTeam}
          </p>
          <p className="sr-only" aria-live="polite">
            {revealing ? 'Drawing the Bloodsucker.' : `The Bloodsucker is ${winnerTeam}.`}
          </p>
          {!revealing ? (
            <p className="mt-1 text-sm text-[color:var(--draft-broadcast-muted)]">
              Drawn at random from {draw.candidates.length} teams
              {state.bloodsucker && state.bloodsucker.memberId !== draw.winnerMemberId
                ? `. The commissioner has since chosen ${state.bloodsucker.teamName} instead.`
                : '.'}
            </p>
          ) : null}
        </div>
      ) : state.bloodsucker ? (
        <p className="mt-4 text-lg font-semibold">
          {state.bloodsucker.teamName}
          <span className="block text-sm font-normal text-[color:var(--draft-broadcast-muted)]">
            Chosen by the commissioner.
          </span>
        </p>
      ) : (
        <p className="mt-4 text-sm">
          {state.canManage
            ? 'Draw the Bloodsucker at random, or choose a member in league settings.'
            : 'Waiting for the commissioner to choose or draw the Bloodsucker.'}
        </p>
      )}

      {state.canDraw ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void startDraw()}
            disabled={command.status === 'saving'}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-[color:var(--draft-broadcast-text)] px-5 font-semibold text-[color:var(--draft-broadcast-page)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--draft-broadcast-alert)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {command.status === 'saving' ? 'Drawing…' : 'Draw the Bloodsucker'}
          </button>
          <p className="text-xs text-[color:var(--draft-broadcast-muted)]">
            The draw happens once and everyone in the lobby sees it.
          </p>
        </div>
      ) : null}

      {command.status === 'failed' ? (
        <p role="alert" className="mt-3 text-sm">
          <span className="font-semibold">The draw did not run ({command.code}).</span>{' '}
          {command.message}
        </p>
      ) : null}

      {state.canManage && state.bloodsucker && !revealing ? (
        <p className="mt-3 text-sm">
          <Link
            href={`/leagues/${encodeURIComponent(leagueId)}?tab=league-settings`}
            className="font-medium underline underline-offset-2"
          >
            Choose a different member in league settings
          </Link>
          {draw ? ' (the draw cannot be repeated).' : '.'}
        </p>
      ) : null}
    </section>
  );
}
