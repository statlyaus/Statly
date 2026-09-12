import { createPublicKey } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';

import { stageLocalAflTradeFiveSeasonAflTablesOutcomes } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesStaging';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeEgressSigningAuthority } from '@/server/aflTradeIntelligence/development/localEgressSigningAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

it('retains the five-season signing identity before capture and reuses it after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'statly-five-season-signing-'));
  const nonce = 'a'.repeat(64);
  const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(2021);
  // Synthetic database boundary stops before any network capture; all signing custody is real.
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string) {
      let rows: unknown[] = [];
      if (sql.includes('SELECT runtime_nonce')) rows = [{ runtime_nonce: nonce }];
      else if (sql.includes('FROM outcome_gate_ledger_head'))
        rows = [{ revision: authority.capture.ledger.decisions.length }];
      else if (sql.includes('FROM outcome_gate_proposal'))
        rows = authority.capture.ledger.proposals.map((proposal_json) => ({ proposal_json }));
      else if (sql.includes('FROM outcome_gate_decision'))
        rows = authority.capture.ledger.decisions.map((decision_json) => ({ decision_json }));
      else if (sql.includes('SELECT DISTINCT ON'))
        throw new Error('Synthetic database unavailable before capture');
      else if (
        !sql.includes('INSERT INTO outcome_competition_season') &&
        !sql.includes('INSERT INTO outcome_metric_definition')
      )
        throw new Error('Unexpected SQL boundary request');
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async transaction(work) {
      return work(client);
    },
  };
  try {
    const start = () =>
      stageLocalAflTradeFiveSeasonAflTablesOutcomes(client, {
        artifactRootDirectory: root,
        expectedRuntimeNonce: nonce,
      });
    await expect(start()).rejects.toThrow('Synthetic database unavailable before capture');
    expect(
      (await stat(join(root, 'current-valuation-evidence', 'egress-signing-key.pem'))).mode & 0o777
    ).toBe(0o600);
    const first = createLocalAflTradeEgressSigningAuthority({ artifactRoot: root });
    const firstPublicKey = createPublicKey(first.signingKey.privateKey).export({
      type: 'spki',
      format: 'der',
    });
    await expect(start()).rejects.toThrow('Synthetic database unavailable before capture');
    const restarted = createLocalAflTradeEgressSigningAuthority({ artifactRoot: root });
    expect(
      createPublicKey(restarted.signingKey.privateKey).export({ type: 'spki', format: 'der' })
    ).toEqual(firstPublicKey);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
