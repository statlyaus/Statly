import { describe, expect, it } from 'vitest';

import {
  appendAflTradeGateDecision,
  type AflTradeGateDecisionLedger,
} from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type {
  AflTradeGateDecisionLedgerRepository,
  AflTradeGateLedgerAppendInput,
  AflTradeGateLedgerAppendResult,
  AflTradeGateLedgerBatchAppendInput,
} from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { recordApprovedAflTradeFitzRoySources } from '@/server/aflTradeIntelligence/governance/recordApprovedFitzRoySources';
import { APPROVED_AFL_TRADE_FITZROY_PLAYER_STAT_CAPABILITIES } from '@/server/aflTradeIntelligence/source/approvedFitzRoySourcePolicies';

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;

class FixtureGateRepository implements AflTradeGateDecisionLedgerRepository {
  private ledger: AflTradeGateDecisionLedger = { proposals: [], decisions: [] };
  readonly appends: AflTradeGateLedgerAppendInput[] = [];
  readonly batches: AflTradeGateLedgerBatchAppendInput[] = [];

  async load() {
    return { revision: this.ledger.decisions.length, ledger: this.ledger };
  }

  async append(input: AflTradeGateLedgerAppendInput): Promise<AflTradeGateLedgerAppendResult> {
    this.appends.push(input);
    const existing = this.ledger.decisions.find(
      (decision) => decision.decisionId === input.decision.decisionId
    );
    if (existing !== undefined) {
      return {
        revision: this.ledger.decisions.length,
        ledger: this.ledger,
        idempotentReplay: true,
      };
    }
    if (input.expectedRevision !== this.ledger.decisions.length) {
      throw new Error('fixture stale revision');
    }
    this.ledger = appendAflTradeGateDecision(this.ledger, input.proposal, input.decision);
    return {
      revision: this.ledger.decisions.length,
      ledger: this.ledger,
      idempotentReplay: false,
    };
  }

  async appendBatch(input: AflTradeGateLedgerBatchAppendInput) {
    this.batches.push(input);
    const idempotentReplays: boolean[] = [];
    let next = this.ledger;
    for (const record of input.records) {
      const existing = next.decisions.some(
        (decision) => decision.decisionId === record.decision.decisionId
      );
      idempotentReplays.push(existing);
      if (!existing) next = appendAflTradeGateDecision(next, record.proposal, record.decision);
    }
    this.ledger = next;
    return { revision: next.decisions.length, ledger: next, idempotentReplays };
  }

  async resolveAuthorization(_rightsArtifactId: string): Promise<never> {
    throw new Error('Not used by this fixture.');
  }
}

const field = {
  sourceField: 'Player',
  normalizedField: 'player.displayName',
  uses: {
    archive_fact: 'allowed' as const,
    model_training: 'allowed' as const,
    derived_feature: 'allowed' as const,
    public_display: 'allowed' as const,
  },
  attributionRequired: true,
  notes: null,
};

const input = {
  policy: {
    fieldSets: {
      'afl-tables-player-stats': [field],
      'footywire-player-stats': [field],
      'fryzigg-player-stats': [field],
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

describe('recordApprovedAflTradeFitzRoySources', () => {
  it('records each named provider as a separate source policy and Gate decision', async () => {
    const repository = new FixtureGateRepository();

    const result = await recordApprovedAflTradeFitzRoySources(repository, input);

    expect(result.revision).toBe(3);
    expect(result.records).toHaveLength(3);
    expect(result.records.map(({ sourceRights }) => sourceRights.content.provider)).toEqual([
      'afl_tables',
      'footywire',
      'fryzigg',
    ]);
    expect(
      result.records.map(({ sourceRights }) => {
        const acquisition = sourceRights.content.acquisition;
        return acquisition.kind === 'fitzroy'
          ? acquisition.capabilities[0]?.capabilityId
          : undefined;
      })
    ).toEqual(APPROVED_AFL_TRADE_FITZROY_PLAYER_STAT_CAPABILITIES);
    expect(repository.batches).toHaveLength(1);
    expect(repository.batches[0]).toMatchObject({ expectedRevision: 0 });
    expect(repository.batches[0]?.records).toHaveLength(3);
    expect(result.records.every(({ idempotentReplay }) => !idempotentReplay)).toBe(true);
  });

  it('replays all three exact records without advancing the durable ledger', async () => {
    const repository = new FixtureGateRepository();
    await recordApprovedAflTradeFitzRoySources(repository, input);

    const replay = await recordApprovedAflTradeFitzRoySources(repository, input);

    expect(replay.revision).toBe(3);
    expect(replay.ledger.decisions).toHaveLength(3);
    expect(replay.records.every(({ idempotentReplay }) => idempotentReplay)).toBe(true);
    expect(repository.batches).toHaveLength(2);
    expect(repository.batches[1]).toMatchObject({ expectedRevision: 3 });
  });

  it('renews changed approvals as one linear v2 batch for all three capabilities', async () => {
    const repository = new FixtureGateRepository();
    const initial = await recordApprovedAflTradeFitzRoySources(repository, input);

    const renewal = await recordApprovedAflTradeFitzRoySources(repository, {
      policy: {
        ...input.policy,
        termsEffectiveAt: '2027-08-08T00:00:00.000Z',
        termsExpireAt: '2028-08-08T00:00:00.000Z',
        proposedAt: '2027-08-08T00:01:00.000Z',
      },
      gate: {
        ...input.gate,
        decidedAt: '2027-08-08T00:02:00.000Z',
        effectiveAt: '2027-08-08T00:02:00.000Z',
        revalidateAt: '2028-08-08T00:00:00.000Z',
      },
    });

    expect(renewal.revision).toBe(6);
    expect(renewal.records.map(({ decision }) => decision.content.version)).toEqual([2, 2, 2]);
    expect(renewal.records.map(({ decision }) => decision.content.supersedesDecisionId)).toEqual(
      initial.records.map(({ decision }) => decision.decisionId)
    );
    expect(renewal.records.every(({ idempotentReplay }) => !idempotentReplay)).toBe(true);
    expect(repository.batches[1]).toMatchObject({ expectedRevision: 3 });
  });
});
