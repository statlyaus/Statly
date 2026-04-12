import '../src/lib/loadEnv';

import { DRAFT_REPAIR_EVENT, inngest } from '@/lib/inngest/client';

function parseArgs(argv: string[]): { draftId: string; leagueId: string; season: number } {
  const draftId = argv
    .find((arg) => arg.startsWith('--draft='))
    ?.split('=')[1]
    ?.trim();
  const leagueId = argv
    .find((arg) => arg.startsWith('--league='))
    ?.split('=')[1]
    ?.trim();
  const seasonValue = argv
    .find((arg) => arg.startsWith('--season='))
    ?.split('=')[1]
    ?.trim();
  const season = seasonValue ? Number(seasonValue) : new Date().getFullYear();

  if (!draftId) {
    throw new Error('Missing --draft=<draftId>');
  }

  if (!leagueId) {
    throw new Error('Missing --league=<leagueId>');
  }

  if (!Number.isFinite(season)) {
    throw new Error('Invalid --season value');
  }

  return { draftId, leagueId, season };
}

async function main() {
  const { draftId, leagueId, season } = parseArgs(process.argv.slice(2));

  const payload = {
    draftId,
    leagueId,
    season,
    requestedAt: new Date().toISOString(),
  };

  const result = await inngest.send({
    name: DRAFT_REPAIR_EVENT,
    data: payload,
  });

  console.log(
    JSON.stringify(
      {
        queued: true,
        event: DRAFT_REPAIR_EVENT,
        payload,
        result,
      },
      null,
      2
    )
  );
}

void main();
