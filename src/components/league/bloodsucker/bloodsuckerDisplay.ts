// Display helpers for the Bloodsucker screens (#1286). Pure, so every client renders the same thing
// from the same committed data.

export type SlotGroup = 'DEF' | 'MID' | 'RUC' | 'FWD' | 'UTIL' | 'NON_SCORING';
/**
 * The statuses this build knows, plus any the server adds later: the screens must render a status
 * they have never seen rather than break on it.
 */
export type BiteStatus =
  'OPEN' | 'WAITING_LOCK' | 'EXECUTED' | 'AUTO_EXECUTED' | 'CANCELLED' | (string & {});

/** A bite the Bloodsucker can still make. Every other status, known or not, is finished. */
export const isBiteOpen = (status: BiteStatus) => status === 'OPEN' || status === 'WAITING_LOCK';

export const SLOT_GROUP_LABELS: Record<SlotGroup, string> = {
  DEF: 'Defence',
  MID: 'Midfield',
  RUC: 'Ruck',
  FWD: 'Forward',
  UTIL: 'Utility',
  NON_SCORING: 'Interchange and bench',
};

export function biteStatusLabel(status: BiteStatus): string {
  switch (status) {
    case 'OPEN':
      return 'Waiting for the bite';
    case 'WAITING_LOCK':
      return 'Waiting for the round to end';
    case 'EXECUTED':
      return 'Bitten';
    case 'AUTO_EXECUTED':
      return 'Bitten by the system at the deadline';
    case 'CANCELLED':
      return 'Cancelled';
    case 'UNPAIRABLE':
      return 'Ended without a swap';
    default: {
      // A status added after this build: show its own name in plain words.
      const words = status.toLowerCase().replaceAll('_', ' ').trim();
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown state';
    }
  }
}

/**
 * The honest heading for each refusal code a Bloodsucker screen can show (NFR-5). The server's own
 * message follows it, so a heading says what kind of block this is and never guesses the detail.
 */
const REFUSAL_HEADINGS = new Map<string, string>([
  ['EARLIER_BITE_PENDING', 'An earlier bite comes first'],
  ['BITE_SUSPENDED', 'This bite is on hold'],
  ['ROUND_IN_PROGRESS', 'A round is in progress'],
  ['BITE_NOT_OPEN', 'This bite is finished'],
  ['BITE_NOT_EXECUTED', 'This bite has not been made'],
  ['BITE_UNPAIRABLE', 'This bite ended because a roster was empty'],
  ['ROSTER_CHANGED', 'A roster has changed'],
  ['BITE_PENDING', 'A bite is waiting on your team'],
  ['LAST_PLAYER_BITE_HELD', 'Your last player stays while you hold a bite'],
  ['BLOODSUCKER_WINDOW_OPEN', "The Bloodsucker's exclusive window is open"],
  ['BLOODSUCKER_SELF_OVERRIDE', 'You are part of this matchup'],
  ['FORBIDDEN', 'You cannot do this'],
  ['UNAUTHORIZED', 'Sign in again'],
  ['NOT_FOUND', 'Not found'],
  ['INVALID_INPUT', 'Check what you entered'],
  ['NETWORK_ERROR', 'The server could not be reached'],
]);

export function refusalHeading(code: string): string {
  return REFUSAL_HEADINGS.get(code) ?? 'The server refused this';
}

export interface Refusal {
  code: string;
  message: string;
}

/** "Heading (CODE). Server message": the code is always shown, known or not. */
export function formatRefusal(refusal: Refusal): string {
  return `${refusalHeading(refusal.code)} (${refusal.code}). ${refusal.message}`;
}

/**
 * Reads a failed response body without dropping its code. Routes answer either
 * `{ error: string, code }` or `{ error: { message, code } }`; a body with no code is named by its
 * HTTP status.
 */
export function readRefusal(
  payload: unknown,
  httpStatus: number,
  fallbackMessage: string
): Refusal {
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const nested = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<
    string,
    unknown
  >;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return {
    code: text(body.code) ?? text(nested.code) ?? `HTTP_${httpStatus}`,
    message: text(body.error) ?? text(nested.message) ?? text(body.message) ?? fallbackMessage,
  };
}

export interface RevealDraw {
  drawId: string;
  drawnAt: string;
  winnerMemberId: string;
  candidates: ReadonlyArray<{ memberId: string; teamName: string }>;
  revealMs: number;
}

/** A small deterministic hash so every client derives the same spin from the draw id. */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/**
 * The reveal frame at a moment in server time. The spin slows as it goes (each step longer than the
 * last) and its last step is the committed winner, so a client that joins mid-reveal sees the same
 * frame as everyone else, and one that joins afterwards sees the winner.
 */
export function revealFrame(
  draw: RevealDraw,
  serverNowMs: number
): { memberId: string; done: boolean } {
  const elapsed = serverNowMs - Date.parse(draw.drawnAt);
  const count = draw.candidates.length;
  if (!Number.isFinite(elapsed) || elapsed >= draw.revealMs || count < 2) {
    return { memberId: draw.winnerMemberId, done: elapsed >= draw.revealMs || count < 2 };
  }
  const steps = 24;
  // Step k starts at revealMs * (k / steps)^2: quick at first, slow at the end.
  const progress = Math.sqrt(Math.max(0, elapsed) / draw.revealMs);
  const step = Math.min(steps - 1, Math.floor(progress * steps));
  const winnerIndex = Math.max(
    0,
    draw.candidates.findIndex((candidate) => candidate.memberId === draw.winnerMemberId)
  );
  // Walk back from the winner by a stride the draw id fixes, so the last step lands on the winner.
  const stride = 1 + (seedOf(draw.drawId) % (count - 1));
  const index = (winnerIndex + (steps - 1 - step) * stride) % count;
  return { memberId: draw.candidates[index]?.memberId ?? draw.winnerMemberId, done: false };
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** The countdown's text equivalent (NFR-8): words, not a ticking clock. */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return 'now';
  const totalMinutes = Math.floor(remainingMs / 60000);
  if (totalMinutes < 1) return 'less than a minute';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? plural(days, 'day') : null,
    hours ? plural(hours, 'hour') : null,
    minutes ? plural(minutes, 'minute') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!;
}
