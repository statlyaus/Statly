#!/usr/bin/env node
/**
 * Records an AFL game abandoned without a result as ABANDONED in `AflMatchResult` (DATABASE_URL, the
 * fantasy PostgreSQL), so No Losers counts its players in full (BR-15, #1315). Footywire posts no
 * match page for such a game, so the results ingest never records it. Writes one row in one locked
 * transaction, or nothing; re-running it changes nothing.
 *
 *   npm run record-abandoned -- --season 2026 --round 5 --home Geelong --away Hawthorn [--match-id 11234]
 *
 * Clubs as the fixture names them, home first. See docs/runbooks/monitoring-and-alerts.md.
 */
import { Pool } from 'pg';

import { recordAbandonedResult } from './resultIngest';
import { pgResultStore } from './resultStore';

export function parseAbandonedArgs(argv: readonly string[]): {
  season: number;
  round: number;
  homeTeam: string;
  awayTeam: string;
  matchId?: string;
} {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected "--flag value" pairs, got "${argv.join(' ')}"`);
    }
    flags.set(flag.slice(2), value);
  }
  const unknown = [...flags.keys()].filter(
    (flag) => !['season', 'round', 'home', 'away', 'match-id'].includes(flag)
  );
  if (unknown.length > 0) throw new Error(`Unknown flag --${unknown[0]}`);
  const required = (flag: string) => {
    const value = flags.get(flag);
    if (!value) throw new Error(`--${flag} is required`);
    return value;
  };
  return {
    season: Number(required('season')),
    round: Number(required('round')),
    homeTeam: required('home'),
    awayTeam: required('away'),
    ...(flags.has('match-id') ? { matchId: flags.get('match-id') } : {}),
  };
}

async function main(): Promise<void> {
  const input = parseAbandonedArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to record an AFL result');

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const summary = await recordAbandonedResult(input, {
      store: pgResultStore(pool),
      fetchedAt: new Date(),
    });
    console.log(`Abandoned AFL result recorded: ${JSON.stringify({ ...input, ...summary })}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Recording the abandoned AFL result failed; nothing was written:', error);
    process.exit(1);
  });
}
