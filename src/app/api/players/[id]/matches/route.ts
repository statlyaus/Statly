export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { prisma } from '@/lib/prisma';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';
import { getTeamAbbreviation, getTeamName } from '@/lib/teamLogos';

type MatchRecord = {
  round: number;
  opposition: string;
  opponent: string;
  fantasyScore: number;
  totalValue: number;
  stats: Record<string, number>;
  season: number;
  matchDate: string | null;
  venue: string | null;
  team: string;
};

function titleCaseSlug(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(' ');
}

function buildNameCandidates(id: string): string[] {
  const decodedId = decodeURIComponent(id).trim();
  const words = decodedId.replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const candidates = new Set<string>([decodedId, titleCaseSlug(decodedId)]);

  if (words.length > 2) {
    candidates.add(titleCaseSlug(words.slice(0, -1).join(' ')));
  }

  return Array.from(candidates).filter(Boolean);
}

function readNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

async function resolvePlayerMatchNames(id: string): Promise<string[]> {
  const decodedId = decodeURIComponent(id).trim();
  const candidates = buildNameCandidates(decodedId);
  const dbPlayers = await prisma.player.findMany({
    where: {
      OR: [
        { id: decodedId },
        { name: { in: candidates } },
        { name: { startsWith: candidates[candidates.length - 1] ?? decodedId } },
      ],
    },
    select: { name: true },
    take: 5,
  });

  return Array.from(new Set([...dbPlayers.map((player) => player.name), ...candidates]));
}

function normalizeOpponentKey(opponent: string): string {
  return getTeamAbbreviation(opponent || 'Unknown').toLowerCase();
}

function getMatchCompleteness(match: MatchRecord): number {
  const statTotal = Object.values(match.stats).reduce((sum, value) => sum + Math.abs(value || 0), 0);

  return (
    (match.venue ? 10 : 0) +
    (match.matchDate ? 2 : 0) +
    (match.totalValue > 0 ? 6 : 0) +
    (statTotal > 0 ? 6 : 0)
  );
}

function hasMatchLogPayload(match: MatchRecord): boolean {
  return (
    Boolean(match.venue || match.matchDate) ||
    match.totalValue > 0 ||
    Object.values(match.stats).some((value) => value > 0)
  );
}

function mergeStats(primary: Record<string, number>, secondary: Record<string, number>) {
  const merged: Record<string, number> = {};
  const keys = new Set([...Object.keys(primary), ...Object.keys(secondary)]);

  keys.forEach((key) => {
    const primaryValue = primary[key];
    const secondaryValue = secondary[key];
    merged[key] =
      typeof primaryValue === 'number' && primaryValue !== 0
        ? primaryValue
        : typeof secondaryValue === 'number'
          ? secondaryValue
          : primaryValue || 0;
  });

  return merged;
}

function mergeMatchRows(existing: MatchRecord, incoming: MatchRecord): MatchRecord {
  const incomingIsBetter = getMatchCompleteness(incoming) >= getMatchCompleteness(existing);
  const primary = incomingIsBetter ? incoming : existing;
  const secondary = incomingIsBetter ? existing : incoming;

  return {
    ...primary,
    opposition: primary.opposition !== 'Unknown' ? primary.opposition : secondary.opposition,
    opponent: primary.opponent !== 'Unknown' ? primary.opponent : secondary.opponent,
    fantasyScore: primary.fantasyScore || secondary.fantasyScore,
    totalValue: primary.totalValue || secondary.totalValue,
    stats: mergeStats(primary.stats, secondary.stats),
    matchDate: primary.matchDate || secondary.matchDate,
    venue: primary.venue || secondary.venue,
    team: primary.team !== 'Unknown' ? primary.team : secondary.team,
  };
}

function mergeDuplicateMatches(matches: MatchRecord[]): MatchRecord[] {
  const matchesByGame = new Map<string, MatchRecord>();

  matches.forEach((match) => {
    const key = `${match.season}:${match.round}:${normalizeOpponentKey(match.opponent)}`;
    const existing = matchesByGame.get(key);
    matchesByGame.set(key, existing ? mergeMatchRows(existing, match) : match);
  });

  return Array.from(matchesByGame.values()).sort(
    (a, b) =>
      b.season - a.season ||
      b.round - a.round ||
      a.opponent.localeCompare(b.opponent)
  );
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const playerNames = await resolvePlayerMatchNames(id);

    console.log(`🔍 Fetching matches for player: ${id}`, { playerNames });

    const snapshots = await Promise.all(
      playerNames.map((name) =>
        adminDb.collection('player_match_stats').where('player_name', '==', name).get()
      )
    );
    const docsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((doc) => {
        docsById.set(doc.id, doc);
      });
    });
    const docs = Array.from(docsById.values());

    console.log(`📊 Found ${docs.length} match records for ${id}`);

    if (docs.length === 0) {
      return successResponse([]);
    }

    const rawMatches = docs
      .map((doc) => {
        const data = doc.data();
        const opponent = getTeamName(data.opposition || 'Unknown') || 'Unknown';
        const round = readNumber(data.round);
        const season = readNumber(data.season, 2025);
        console.log(`📋 Processing match: Round ${data.round} vs ${data.opposition}`);

        // Create PlayerStats object for custom scoring calculation
        const playerStats: PlayerStats = {
          games: 1, // This is a single match
          kicks: data.kicks || 0,
          handballs: data.handballs || 0,
          marks: data.marks || 0,
          tackles: data.tackles || 0,
          goals: data.goals || 0,
          hitouts: data.hitouts || 0,
          clearances: data.clearances || 0,
          inside50s: data.inside_50s || 0,
          rebound50s: data.rebound_50s || 0,
          clangers: data.clangers || 0,
          contestedPossessions: data.contested_possessions || 0,
          uncontestedPossessions: data.uncontested_possessions || 0,
          freesFor: data.frees_for || 0,
          freesAgainst: data.frees_against || 0,
          onePercenters: data.one_percenters || 0,
          goalAssists: data.goal_assists || 0,
          timeOnGroundPct: data.time_on_ground_percentage || 85, // Default if missing
          disposalEffPct: data.disposal_efficiency || 75, // Default if missing
          turnovers: data.turnovers || 0,
          intercepts: data.intercepts || 0,
          metresGained: data.metres_gained || 0,
          contestedMarks: data.contested_marks || 0,
          effectiveDisposals: data.effective_disposals || 0,
          scoreInvolvements: data.score_involvements || 0,
        };

        // Calculate custom fantasy score using your algorithm
        const customFantasyScore = calculateTotalValue(playerStats);

        return {
          round,
          opposition: opponent,
          opponent, // Frontend expects both fields
          fantasyScore: customFantasyScore, // Using custom scoring instead of SuperCoach
          totalValue: customFantasyScore, // Use same value for consistency
          stats: {
            disposals: data.disposals || 0,
            kicks: data.kicks || 0,
            handballs: data.handballs || 0,
            marks: data.marks || 0,
            goals: data.goals || 0,
            behinds: data.behinds || 0,
            tackles: data.tackles || 0,
            hitouts: data.hitouts || 0,
            inside_50s: data.inside_50s || 0,
            rebound_50s: data.rebound_50s || 0,
            clangers: data.clangers || 0,
            contested_possessions: data.contested_possessions || 0,
            uncontested_possessions: data.uncontested_possessions || 0,
            effective_disposals: data.effective_disposals || 0,
            disposal_efficiency: data.disposal_efficiency || 0,
            contested_marks: data.contested_marks || 0,
            intercepts: data.intercepts || 0,
            clearances: data.clearances || 0,
            metres_gained: data.metres_gained || 0,
            score_involvements: data.score_involvements || 0,
            goal_assists: data.goal_assists || 0,
            frees_for: data.frees_for || 0,
            frees_against: data.frees_against || 0,
            one_percenters: data.one_percenters || 0,
            turnovers: data.turnovers || 0,
            time_on_ground_percentage: data.time_on_ground_percentage || 0,
          },
          season,
          matchDate: data.date || null,
          venue: data.venue || null,
          team: data.team || 'Unknown', // Player's team
        };
      });

    const mergedMatches = mergeDuplicateMatches(rawMatches);
    const matches = mergedMatches.filter(hasMatchLogPayload);

    console.log(`✅ Returning ${matches.length} matches for ${id}`, {
      rawMatches: rawMatches.length,
      mergedDuplicates: rawMatches.length - mergedMatches.length,
      filteredEmptyRows: mergedMatches.length - matches.length,
    });
    return successResponse(matches);
  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player matches', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}
