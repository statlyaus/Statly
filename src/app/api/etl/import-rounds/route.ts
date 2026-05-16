import { type NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import { importFootywireRounds, listFootywireImportableRounds } from '@/lib/footywireImporter';
import { importAdvancedFootywireRounds } from '@/lib/footywireStatsIngestion';
import { refreshPlayerReadModels } from '@/server/readModels/playerReadModels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ADVANCED_STATS_DATA_SOURCE = 'afltables,footywire_match';

const bodySchema = z.object({
  season: z.number().int().min(2020).max(2035),
  rounds: z.array(z.number().int().min(0).max(40)).min(1).optional(),
  dryRun: z.boolean().optional().default(false),
  dataSource: z.string().trim().min(1).optional().default(DEFAULT_ADVANCED_STATS_DATA_SOURCE),
});

function isAuthorized(request: NextRequest): boolean {
  const configuredToken = process.env.ETL_IMPORT_TOKEN?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV === 'development';
  }
  return request.headers.get('x-etl-import-token') === configuredToken;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const rawBody = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const rounds =
    parsed.data.rounds ??
    (await listFootywireImportableRounds({
      season: parsed.data.season,
    }));
  if (rounds.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: `No rounds found to import for season ${parsed.data.season}`,
      },
      { status: 400 }
    );
  }

  const metadataImportParams = {
    season: parsed.data.season,
    rounds,
    dryRun: parsed.data.dryRun,
  };
  const advancedImportParams = {
    ...metadataImportParams,
    dataSource: parsed.data.dataSource,
  };
  const rematerializationParams = {
    season: parsed.data.season,
    rounds,
  };

  const metadataResult = await importFootywireRounds(metadataImportParams);
  const statsResult = await importAdvancedFootywireRounds(advancedImportParams);
  const publicationResult = metadataImportParams.dryRun
    ? null
    : await refreshPlayerReadModels({
        season: rematerializationParams.season,
        rounds: rematerializationParams.rounds,
      });
  const verifierCommand = `npm run verify:player-read-models -- --season ${rematerializationParams.season} --rounds ${rematerializationParams.rounds.join(',')} --data-source ${advancedImportParams.dataSource} --json`;
  const statsSourceNames = Array.from(
    new Set([
      ...advancedImportParams.dataSource
        .split(',')
        .map((source) => source.trim())
        .filter(Boolean),
      ...(statsResult?.sourceDiagnostics?.map((diagnostic) => diagnostic.source) ?? []),
    ])
  );

  return NextResponse.json({
    success: true,
    result: {
      season: metadataImportParams.season,
      rounds: metadataImportParams.rounds,
      dryRun: metadataImportParams.dryRun,
      dataSource: advancedImportParams.dataSource,
      metadata: metadataResult,
      stats: statsResult,
      publication: publicationResult,
      audit: {
        rawImport: {
          sourceNames: ['footywire_metadata', ...statsSourceNames],
          metadataMatches: metadataResult?.importedMatches ?? null,
          metadataPlayerStats: metadataResult?.importedPlayerStats ?? null,
          statsFetchedRows: statsResult?.fetchedRows ?? null,
          statsWrittenRows: statsResult?.written ?? null,
        },
        rematerialization: publicationResult
          ? {
              refreshedPlayerIds: publicationResult.refreshedPlayerIds,
              refreshedRounds: publicationResult.refreshedRounds,
              rankingsDirty: publicationResult.rankingsDirty,
              rostersDirty: publicationResult.rostersDirty,
              published: publicationResult.published,
            }
          : null,
        verifierCommand,
      },
    },
  });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message:
      'POST { season, rounds?, dryRun? } to import Footywire fixtures and player stats. If rounds are omitted, the route repairs all importable rounds from the Footywire fixture list for that season.',
  });
}
