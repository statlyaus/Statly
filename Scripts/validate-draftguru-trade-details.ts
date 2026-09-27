import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  summariseDraftguruTradeDetailValidation,
  validateDraftguruTradeDetail,
  type DraftguruTradeDetailCacheEntry,
  type DraftguruTradeDetailValidationOutcome,
} from '../src/server/aflTradeIntelligence/development/localDraftguruTradeDetailValidation';

/**
 * Read-only validation of a captured Draftguru full-archive against the parser the ingestion pipeline
 * itself uses. It writes nothing, admits nothing, and reports the season-only date limitation rather
 * than substituting a date.
 *
 * Usage: npx tsx Scripts/validate-draftguru-trade-details.ts <path-to-full-archive>
 */
const archive = resolve(
  process.argv[2] ?? process.env.STATLY_DRAFTGURU_FULL_ARCHIVE ?? '',
);
if (process.argv[2] === undefined && process.env.STATLY_DRAFTGURU_FULL_ARCHIVE === undefined) {
  throw new TypeError('Pass the full-archive directory as the first argument.');
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(archive, file), 'utf8')) as T;

const cache = readJson<{ entries: DraftguruTradeDetailCacheEntry[] }>('detail-cache.json');
const recorded = readJson<{
  recordCount: number;
  indexStructureVerified: boolean;
  partyCountDistribution: Record<string, number>;
} >('structure-verification.json');

const outcomes: (DraftguruTradeDetailValidationOutcome | null)[] = [];
let unreadableBodies = 0;
for (const entry of cache.entries) {
  try {
    outcomes.push(
      validateDraftguruTradeDetail({
        entry,
        html: readFileSync(join(archive, 'detail-bodies', entry.bodyFile), 'utf8'),
      })
    );
  } catch {
    unreadableBodies += 1;
    outcomes.push(null);
  }
}

const summary = summariseDraftguruTradeDetailValidation(outcomes);
const recordedPartyDistribution = Object.entries(recorded.partyCountDistribution)
  .sort(([left], [right]) => Number(left) - Number(right))
  .map(([parties, trades]) => `${parties}:${trades}`)
  .join(' ');

process.stdout.write(
  `${JSON.stringify(
    {
      archive,
      recordedRecordCount: recorded.recordCount,
      indexStructureVerified: recorded.indexStructureVerified,
      recordedPartyDistribution,
      unreadableBodies,
      factsValidatedEntries: cache.entries.filter((entry) => entry.factsValidated).length,
      distinctAuthorities: [...new Set(cache.entries.map((entry) => entry.authority))].sort(),
      ...summary,
      partyDistributionMatchesRecorded: summary.partyDistribution === recordedPartyDistribution,
    },
    null,
    1
  )}\n`
);
