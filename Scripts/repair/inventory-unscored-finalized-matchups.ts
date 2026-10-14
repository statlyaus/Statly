#!/usr/bin/env tsx

/**
 * Read-only inventory for bug-report #10: every unscored side of a finalized regular-season matchup,
 * classified by when each of its players was set relative to that player's game.
 *
 * Writes nothing to the database. Reads run inside a READ ONLY transaction, so an accidental write
 * fails. Output is NDJSON in the file named by --out, which must not already exist and must sit
 * outside the repository. See docs/runbooks/unscored-finalized-matchups.md.
 *
 *   npx tsx Scripts/repair/inventory-unscored-finalized-matchups.ts --out /path/outside/repo/inventory.ndjson
 */

import { createWriteStream } from 'node:fs';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../src/lib/prisma';
import { loadRoundPlayerGameStarts } from '../../src/server/leagues/lineupService';
import {
  classifyUnscoredSide,
  type UnscoredSideAssessment,
} from '../../src/server/leagues/unscoredMatchupInventory';

const ROUNDS_PER_BATCH = 100;

interface UnscoredSideRow {
  matchupId: string;
  memberId: string;
  lineup: {
    createdAt: Date;
    updatedAt: Date;
    players: { playerId: string; club: string | null; setAt: Date }[];
  } | null;
}

interface FinalRoundRow {
  id: string;
  leagueId: string;
  fixtureVersion: number;
  round: number;
  aflRound: number | null;
  seasonId: string | null;
  seasonYear: number | null;
  /** Another competition round of the league has the same round number (lineups do not carry season or fixture version). */
  lineupScopeAmbiguous: boolean;
  unscoredSides: UnscoredSideRow[];
}

async function loadBatch(
  tx: Prisma.TransactionClient,
  afterId: string | undefined
): Promise<{ lastId: string | undefined; rounds: FinalRoundRow[] }> {
  const rounds = await tx.leagueCompetitionRound.findMany({
    where: { status: 'FINAL', ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: 'asc' },
    take: ROUNDS_PER_BATCH,
    select: {
      id: true,
      leagueId: true,
      fixtureVersion: true,
      round: true,
      aflRound: true,
      seasonId: true,
      season: { select: { year: true } },
    },
  });

  const flagged: FinalRoundRow[] = [];
  for (const round of rounds) {
    // Matchups linked to this competition round, plus legacy rows with no link in the same fixture.
    const matchups = await tx.leagueMatchup.findMany({
      where: {
        OR: [
          { competitionRoundId: round.id },
          {
            competitionRoundId: null,
            leagueId: round.leagueId,
            fixtureVersion: round.fixtureVersion,
            round: round.round,
          },
        ],
        phase: 'REGULAR',
        homeMemberId: { not: null },
        awayMemberId: { not: null },
      },
      select: {
        id: true,
        homeMemberId: true,
        awayMemberId: true,
        scores: { where: { status: 'FINAL' }, select: { memberId: true } },
      },
    });

    const unscoredSides: UnscoredSideRow[] = [];
    for (const matchup of matchups) {
      const scored = new Set(matchup.scores.map((score) => score.memberId));
      for (const memberId of [matchup.homeMemberId, matchup.awayMemberId]) {
        if (!memberId || scored.has(memberId)) continue;
        const lineup = await tx.leagueLineup.findUnique({
          where: {
            leagueId_memberId_round: { leagueId: round.leagueId, memberId, round: round.round },
          },
          select: {
            createdAt: true,
            updatedAt: true,
            players: {
              select: { playerId: true, createdAt: true, player: { select: { club: true } } },
            },
          },
        });
        unscoredSides.push({
          matchupId: matchup.id,
          memberId,
          lineup: lineup
            ? {
                createdAt: lineup.createdAt,
                updatedAt: lineup.updatedAt,
                players: lineup.players.map((player) => ({
                  playerId: player.playerId,
                  club: player.player.club,
                  setAt: player.createdAt,
                })),
              }
            : null,
        });
      }
    }

    if (unscoredSides.length > 0) {
      const sharedRoundNumber = await tx.leagueCompetitionRound.count({
        where: { leagueId: round.leagueId, round: round.round, id: { not: round.id } },
      });
      flagged.push({
        id: round.id,
        leagueId: round.leagueId,
        fixtureVersion: round.fixtureVersion,
        round: round.round,
        aflRound: round.aflRound,
        seasonId: round.seasonId,
        seasonYear: round.season?.year ?? null,
        lineupScopeAmbiguous: sharedRoundNumber > 0,
        unscoredSides,
      });
    }
  }

  return { lastId: rounds.at(-1)?.id, rounds: flagged };
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (!outPath) {
    console.error('Usage: inventory-unscored-finalized-matchups.ts --out <file outside the repo>');
    process.exitCode = 2;
    return;
  }

  // Fail on connection before creating the output file, so a failed run leaves nothing behind.
  await prisma.$queryRaw`SELECT 1`;

  // 'wx' refuses to overwrite an earlier inventory.
  const out = createWriteStream(outPath, { flags: 'wx' });
  const tally = new Map<string, number>();
  let roundsWithGaps = 0;
  let sidesWritten = 0;
  let afterId: string | undefined;

  for (;;) {
    const batch = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return loadBatch(tx, afterId);
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
    if (!batch.lastId) break;
    afterId = batch.lastId;

    // Timing calls go to the AFL data source, so they run outside the database transaction.
    for (const round of batch.rounds) {
      roundsWithGaps += 1;
      for (const side of round.unscoredSides) {
        const players = side.lineup?.players ?? [];
        let gameStartsByPlayerId: Map<string, Date> | null = null;
        if (
          players.length > 0 &&
          !round.lineupScopeAmbiguous &&
          round.aflRound !== null &&
          round.seasonYear !== null
        ) {
          const timing = await loadRoundPlayerGameStarts({
            aflRound: round.aflRound,
            players,
            season: round.seasonYear,
          });
          if (timing.ok) gameStartsByPlayerId = timing.gameStartsByPlayerId;
        }

        const assessment: UnscoredSideAssessment = classifyUnscoredSide({
          lineupCreatedAt: side.lineup?.createdAt ?? null,
          lineupUpdatedAt: side.lineup?.updatedAt ?? null,
          players,
          lineupScopeAmbiguous: round.lineupScopeAmbiguous,
          gameStartsByPlayerId,
        });
        tally.set(assessment.classification, (tally.get(assessment.classification) ?? 0) + 1);
        sidesWritten += 1;

        out.write(
          `${JSON.stringify({
            roundId: round.id,
            leagueId: round.leagueId,
            fixtureVersion: round.fixtureVersion,
            round: round.round,
            aflRound: round.aflRound,
            seasonId: round.seasonId,
            seasonYear: round.seasonYear,
            matchupId: side.matchupId,
            memberId: side.memberId,
            lineupCreatedAt: side.lineup?.createdAt.toISOString() ?? null,
            lineupUpdatedAt: side.lineup?.updatedAt.toISOString() ?? null,
            timingAvailable: gameStartsByPlayerId !== null,
            ...assessment,
          })}\n`
        );
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    out.on('error', reject);
    out.end(resolve);
  });

  console.log(`Finalized rounds with unscored sides: ${roundsWithGaps}`);
  console.log(`Unscored sides written: ${sidesWritten} -> ${outPath}`);
  for (const [classification, count] of [...tally.entries()].sort()) {
    console.log(`  ${classification}: ${count}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
