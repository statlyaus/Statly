import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadAflTradeAssetLedgerLabels } from '../src/server/aflTradeIntelligence/development/postgresAssetLedgerLabels';
import { loadAflTradeRealizedTradeGradeInputs } from '../src/server/aflTradeIntelligence/development/postgresRealizedTradeGradeInputs';
import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { canonicalizeAflTradeJson } from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeAssetLedger } from '../src/server/aflTradeIntelligence/valuation/assetLedger';
import type { AflTradeAssetLedgerContent } from '../src/server/aflTradeIntelligence/valuation/assetLedgerContracts';
import {
  parseGradeRealizedTradesArguments,
  requireOutAbsent,
  writeStoredOutputFile,
} from './grade-realized-trades';

/**
 * Exports the private asset ledger (#789): every player's club stints and every pick's custody and
 * outcome, from the realized grader's own inputs, as a content-addressed JSON artifact in the
 * registered store. It takes the grader's arguments and reads in the same way; the one write is the
 * ledger's evidence record, as the runbook section "Exporting the asset ledger" describes.
 *
 * Usage:
 *   npm run outcomes:grading:asset-ledger -- --candidate <external-reconciliation:...> \
 *     --method <hpn-pav-method:...> --seasons 2019-2026 --official-seasons <seasons> \
 *     --benchmark <hpn-pick-benchmark:...> --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'asset-ledgers';
const MAXIMUM_LEDGER_BYTES = 64 * 1024 * 1024;

/** Stores the sealed ledger as private derived output: it is a read model, not a source. */
export function storeAssetLedger(
  client: AflOutcomeSqlClient,
  storeId: string,
  bytes: Uint8Array
): Promise<AflTradeStoredEvidence> {
  return storeLocalAflTradeEvidence(client, {
    storeId,
    repositoryId: REPOSITORY_ID,
    artifactClass: 'derived_private',
    bytes,
    mediaType: 'application/json',
    maximumObjectBytes: MAXIMUM_LEDGER_BYTES,
  });
}

export interface ExportAssetLedgerResult {
  ledgerId: string;
  summary: AflTradeAssetLedgerContent['summary'];
  out: string;
  stored: AflTradeStoredEvidence | null;
}

export async function runExportAssetLedgerCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<ExportAssetLedgerResult> {
  const parsed = parseGradeRealizedTradesArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out, 'ledger');
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const now = new Date().toISOString();
    const inputs = await loadAflTradeRealizedTradeGradeInputs(client, {
      candidateId: parsed.candidateId,
      methodId: parsed.methodId,
      seasons: parsed.seasons,
      officialSeasons: parsed.officialSeasons,
      pickProjectionBenchmarkId: parsed.benchmarkId,
      spellCutoffAt: now,
      gradedAt: now,
    });
    const { ledger } = createAflTradeAssetLedger(
      inputs,
      await loadAflTradeAssetLedgerLabels(client)
    );
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(ledger));
    if (bytes.byteLength > MAXIMUM_LEDGER_BYTES)
      throw new RangeError(`The ledger exceeds ${MAXIMUM_LEDGER_BYTES} bytes.`);
    const stored = parsed.dryRun ? null : await storeAssetLedger(client, parsed.storeId!, bytes);
    await writeStoredOutputFile(parsed.out, bytes, stored, 'ledger');
    const result = {
      ledgerId: ledger.ledgerId,
      summary: ledger.content.summary,
      out: parsed.out,
      stored,
    };
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        ledgerId: result.ledgerId,
        summary: result.summary,
        out: result.out,
        artifactId: stored?.reference.artifactId ?? null,
        dryRun: parsed.dryRun,
      })
    );
    return result;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runExportAssetLedgerCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Asset ledger export stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
