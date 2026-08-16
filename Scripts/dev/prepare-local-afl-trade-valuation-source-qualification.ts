import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeValuationSourceQualification } from '../../src/server/aflTradeIntelligence/valuation/postgresValuationSourceQualification';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const publicIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u;

function argumentValue(arguments_: readonly string[], name: string): string | null {
  const index = arguments_.indexOf(name);
  if (index === -1) return null;
  const value = arguments_[index + 1]?.trim();
  if (!value || !publicIdPattern.test(value)) {
    throw new TypeError(`${name} requires one bounded identifier.`);
  }
  return value;
}

const arguments_ = process.argv.slice(2);
const valuationScopeKey = argumentValue(arguments_, '--scope');
const releaseScopeKey = argumentValue(arguments_, '--release-scope');
const requestedReleaseId = argumentValue(arguments_, '--release');
if (!valuationScopeKey || (!releaseScopeKey && !requestedReleaseId)) {
  throw new TypeError(
    'Provide --scope and either --release or --release-scope for the admitted local factual release.'
  );
}

const databaseUrl = process.env.AFL_OUTCOMES_DATABASE_URL?.trim();
const runtimeNonce = process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
if (!databaseUrl || !runtimeNonce || !/^[a-f0-9]{64}$/u.test(runtimeNonce)) {
  throw new Error('The admitted local outcomes database URL and runtime nonce are required.');
}
const database = new URL(databaseUrl);
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !LOOPBACK_HOSTS.has(database.hostname) ||
  database.pathname !== '/statly_outcomes_test'
) {
  throw new Error('Source qualification requires disposable loopback PostgreSQL.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  application_name: 'statly-local-valuation-source-qualification',
  connectionTimeoutMillis: 5_000,
  max: 1,
});
try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const factualReleaseId =
    requestedReleaseId ??
    (
      await pool.query<{ release_id: string }>(
        `SELECT release_id FROM outcome_active_release WHERE scope_key=$1`,
        [releaseScopeKey]
      )
    ).rows[0]?.release_id;
  if (!factualReleaseId) {
    throw new Error('No active local factual release exists for the requested release scope.');
  }
  const result = await new PostgresAflTradeValuationSourceQualification(
    createPgAflOutcomeSqlClient(pool)
  ).prepare({ factualReleaseId, valuationScopeKey });
  const report = result.qualificationReport;
  process.stdout.write(
    `${JSON.stringify(
      {
        state: result.state,
        qualificationReportId: report.qualificationReportId,
        factualReleaseId: report.content.factualReleaseId,
        valuationScopeKey: report.content.valuationScopeKey,
        qualificationOperation: report.content.operation,
        decision: report.content.decision.state,
        tradeCount: report.content.releaseTradeIds.length,
        ...(result.state === 'blocked'
          ? {
            preparedInputSetId: result.preparedInputSet.preparedInputSetId,
            blockerCodes: [
              ...new Set(
                result.preparedInputSet.content.entries.flatMap((entry) =>
                  entry.state === 'blocked' ? entry.blockers.map(({ code }) => code) : []
                )
              ),
            ].sort(),
            }
          : {}),
      },
      null,
      2
    )}\n`
  );
} finally {
  await pool.end();
}
