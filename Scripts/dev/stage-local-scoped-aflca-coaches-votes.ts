import { resolve } from 'node:path';

import { stageLocalScopedAflcaCoachesVotes } from '../../src/server/aflTradeIntelligence/development/localScopedAflcaCoachesVotesStaging';
import { withLocalOutcomesStagingRuntime } from './local-outcomes-staging-runtime';

await withLocalOutcomesStagingRuntime({
  label: 'Scoped AFLCA staging',
  statementTimeoutMs: 300_000,
  async run({ client, artifactRoot, runtimeNonce }) {
    const result = await stageLocalScopedAflcaCoachesVotes(client, {
      artifactRootDirectory: resolve(artifactRoot, 'scoped-aflca-coaches-votes'),
      expectedRuntimeNonce: runtimeNonce,
    });
    process.stdout.write(
      `Admitted ${result.reconciliation.voteRowCount} scoped AFLCA vote rows across ` +
        `${result.reconciliation.matchCount} reviewed home-and-away matches; ` +
        `evidence ${result.reconciliation.evidenceSetSha256}.\n`
    );
  },
});
