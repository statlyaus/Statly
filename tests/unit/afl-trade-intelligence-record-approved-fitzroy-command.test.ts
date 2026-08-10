import { describe, expect, it } from 'vitest';

import type {
  AflTradeGateDecisionLedgerRepository,
  AflTradeGateLedgerAppendInput,
  AflTradeGateLedgerAppendResult,
  AflTradeGateLedgerBatchAppendInput,
} from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import { runRecordApprovedFitzRoySourcesCommand } from '../../Scripts/record-approved-fitzroy-sources';

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;

const reviewedInput = {
  policy: {
    fieldSets: {
      'afl-tables-player-stats': [
        {
          sourceField: 'Player',
          normalizedField: 'player.displayName',
          uses: {
            archive_fact: 'allowed',
            model_training: 'allowed',
            derived_feature: 'allowed',
            public_display: 'allowed',
          },
          attributionRequired: true,
          notes: null,
        },
      ],
      'footywire-player-stats': [
        {
          sourceField: 'Player',
          normalizedField: 'player.displayName',
          uses: {
            archive_fact: 'allowed',
            model_training: 'allowed',
            derived_feature: 'allowed',
            public_display: 'allowed',
          },
          attributionRequired: true,
          notes: null,
        },
      ],
      'fryzigg-player-stats': [
        {
          sourceField: 'Player',
          normalizedField: 'player.displayName',
          uses: {
            archive_fact: 'allowed',
            model_training: 'allowed',
            derived_feature: 'allowed',
            public_display: 'allowed',
          },
          attributionRequired: true,
          notes: null,
        },
      ],
    },
    conditionEvidence: {
      'afl-tables-player-stats': {
        'full-season-custody': artifact('e'),
        'zero-provenance-review': artifact('f'),
      },
      'footywire-player-stats': {
        'full-season-custody': artifact('1'),
        'html-schema-fingerprint': artifact('2'),
      },
      'fryzigg-player-stats': {
        'complete-rds-custody': artifact('3'),
        'reconciliation-promotion-review': artifact('4'),
      },
    },
    evidence: {
      terms: artifact('a'),
      authority: artifact('b'),
      rateLimit: artifact('c'),
    },
    termsEffectiveAt: '2026-08-08T00:00:00.000Z',
    termsExpireAt: '2027-08-08T00:00:00.000Z',
    proposedAt: '2026-08-08T00:01:00.000Z',
    proposedBy: 'statly-data-governance-owner',
  },
  gate: {
    decidedAt: '2026-08-08T00:02:00.000Z',
    effectiveAt: '2026-08-08T00:02:00.000Z',
    revalidateAt: '2027-08-08T00:00:00.000Z',
    accountableOwner: 'statly-data-governance-owner',
    reviewer: {
      id: 'independent-source-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: artifact('d'),
    },
    authorityEvidenceId: artifact('b'),
    rateLimitEvidenceId: artifact('c'),
  },
};

class FixtureRepository implements AflTradeGateDecisionLedgerRepository {
  private ledger: AflTradeGateDecisionLedger = { proposals: [], decisions: [] };

  async load() {
    return { revision: this.ledger.decisions.length, ledger: this.ledger };
  }

  async append(input: AflTradeGateLedgerAppendInput): Promise<AflTradeGateLedgerAppendResult> {
    this.ledger = {
      proposals: [...this.ledger.proposals, input.proposal],
      decisions: [...this.ledger.decisions, input.decision],
    };
    return {
      revision: this.ledger.decisions.length,
      ledger: this.ledger,
      idempotentReplay: false,
    };
  }

  async appendBatch(input: AflTradeGateLedgerBatchAppendInput) {
    for (const record of input.records) {
      this.ledger = {
        proposals: [...this.ledger.proposals, record.proposal],
        decisions: [...this.ledger.decisions, record.decision],
      };
    }
    return {
      revision: this.ledger.decisions.length,
      ledger: this.ledger,
      idempotentReplays: input.records.map(() => false),
    };
  }

  async resolveAuthorization(_rightsArtifactId: string): Promise<never> {
    throw new Error('Not used by this fixture.');
  }
}

describe('runRecordApprovedFitzRoySourcesCommand', () => {
  it('persists the reviewed file and prints only stable record identities', async () => {
    const output: string[] = [];
    let closed = false;

    const result = await runRecordApprovedFitzRoySourcesCommand(
      {
        argv: ['--input', '/reviewed/source-approval.json'],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.invalid/statly' },
      },
      {
        readFile: async (path) => {
          expect(path).toBe('/reviewed/source-approval.json');
          return JSON.stringify(reviewedInput);
        },
        connect: async (databaseUrl) => {
          expect(databaseUrl).toBe('postgresql://outcomes.invalid/statly');
          return {
            repository: new FixtureRepository(),
            close: async () => {
              closed = true;
            },
          };
        },
        writeOutput: (line) => output.push(line),
      }
    );

    expect(result.revision).toBe(3);
    expect(result.records.map((record) => record.provider)).toEqual([
      'afl_tables',
      'footywire',
      'fryzigg',
    ]);
    expect(output).toHaveLength(1);
    expect(output[0]).not.toContain('postgresql://');
    expect(output[0]).not.toContain('Player');
    expect(closed).toBe(true);
  });

  it('fails before connecting when the reviewed input or explicit database is absent', async () => {
    let connected = false;
    const dependencies = {
      readFile: async () => JSON.stringify(reviewedInput),
      connect: async () => {
        connected = true;
        throw new Error('must not connect');
      },
      writeOutput: () => undefined,
    };

    await expect(
      runRecordApprovedFitzRoySourcesCommand(
        { argv: [], env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.invalid/statly' } },
        dependencies
      )
    ).rejects.toThrow('exactly one --input');
    await expect(
      runRecordApprovedFitzRoySourcesCommand(
        { argv: ['--input', '/reviewed/source-approval.json'], env: {} },
        dependencies
      )
    ).rejects.toThrow('AFL_OUTCOMES_DATABASE_URL');
    expect(connected).toBe(false);
  });
});
