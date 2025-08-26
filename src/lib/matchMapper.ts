// Shared mapper for MatchEvent Firestore docs to DTO used by API and pages

export interface RoundMatchDTO {
  id: string;
  matchDate: string | null;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  round: number;
}

// Narrow type for timestamp-like values we may see from Admin or Client SDK
type TimestampLike = { toDate: () => Date } | Date | undefined | null;

function hasToDate(input: TimestampLike): input is { toDate: () => Date } {
  return !!input && typeof (input as { toDate?: unknown }).toDate === 'function';
}

export function normalizeMatchDate(input: TimestampLike): string | null {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString();
  try {
    if (hasToDate(input)) {
      return input.toDate().toISOString();
    }
  } catch {
    // ignore
  }
  return null;
}

export function mapMatchEventToDTO(
  id: string,
  data: {
    matchDate?: TimestampLike;
    homeTeam: string;
    awayTeam: string;
    scoreHome?: number | null;
    scoreAway?: number | null;
    round: number;
  }
): RoundMatchDTO {
  return {
    id,
    matchDate: normalizeMatchDate(data.matchDate ?? null),
    homeTeam: data.homeTeam,
    awayTeam: data.awayTeam,
    scoreHome: data.scoreHome ?? null,
    scoreAway: data.scoreAway ?? null,
    round: data.round,
  };
}
