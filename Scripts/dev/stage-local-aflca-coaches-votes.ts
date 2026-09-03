import { resolve } from 'node:path';

import { stageLocalAflcaCoachesVotes } from '../../src/server/aflTradeIntelligence/development/localAflcaCoachesVotesStaging';
import { withLocalOutcomesStagingRuntime } from './local-outcomes-staging-runtime';

await withLocalOutcomesStagingRuntime({
  label: 'AFLCA staging',
  statementTimeoutMs: 240_000,
  async run({ client, artifactRoot, runtimeNonce }) {
    const result = await stageLocalAflcaCoachesVotes(client, {
      artifactRootDirectory: resolve(artifactRoot, 'aflca-coaches-votes'),
      expectedRuntimeNonce: runtimeNonce,
    });
    process.stdout.write(
      `Retained ${result.captures.length} private AFLCA coaches-votes captures for ` +
        `${result.captures.map(({ seasonYear }) => seasonYear).join('-')}. ` +
        `Player-contribution evaluation remains blocked (${result.readiness.blockerCode}): ` +
        `${result.readiness.requiredRemedy}\n`
    );
  },
});
