import { describe, expect, it } from 'vitest';

import {
  appendAflTradeGateDecision,
  type AflTradeGateDecisionLedger,
} from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type {
  AflTradeGateDecisionLedgerRepository,
  AflTradeGateLedgerAppendInput,
  AflTradeGateLedgerBatchAppendInput,
} from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { recordApprovedAflTradeExternalSources } from '@/server/aflTradeIntelligence/governance/recordApprovedExternalDraftTradeSources';
import { createApprovedAflTradeExternalGateRecords } from '@/server/aflTradeIntelligence/source/approvedExternalDraftTradeGateRecords';
import {
  APPROVED_AFL_TRADE_EXTERNAL_CAPABILITIES,
  createApprovedAflTradeExternalSourcePolicies,
} from '@/server/aflTradeIntelligence/source/approvedExternalDraftTradeSourcePolicies';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/sourceContracts';

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;
const field = {
  sourceField: 'recorded_value',
  normalizedField: 'evidence.recordedValue',
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
      'draftguru-trade-index': [field],
      'draftguru-trade-detail': [field],
      'draftguru-year-page': [field],
      'footywire-draft-results': [field],
      'official-afl-indicative-draft-order': [field],
    },
    datasetVersions: {
      'draftguru-trade-index': '2026-08-09',
      'draftguru-trade-detail': '2026-08-09',
      'draftguru-year-page': '2026-08-09',
      'footywire-draft-results': '2026-08-09',
      'official-afl-indicative-draft-order': '2026-08-09',
    },
    parserVersions: {
      'draftguru-trade-index': 'draftguru-trade-index-parser/v1',
      'draftguru-trade-detail': 'draftguru-trade-parser/v1',
      'draftguru-year-page': 'draftguru-year-parser/v1',
      'footywire-draft-results': 'footywire-draft-parser/v1',
      'official-afl-indicative-draft-order': 'official-afl-order-parser/v1',
    },
    conditionEvidence: {
      'draftguru-trade-index': {
        'discovery-field-boundary': artifact('9'),
        'html-schema-fingerprint': artifact('0'),
      },
      'draftguru-trade-detail': {
        'transaction-field-boundary': artifact('1'),
        'html-schema-fingerprint': artifact('2'),
      },
      'draftguru-year-page': {
        'selection-field-boundary': artifact('3'),
        'html-schema-fingerprint': artifact('4'),
      },
      'footywire-draft-results': {
        'selection-corroboration-only': artifact('5'),
        'html-schema-fingerprint': artifact('6'),
      },
      'official-afl-indicative-draft-order': {
        'indicative-order-not-final-selection': artifact('7'),
        'article-schema-fingerprint': artifact('8'),
      },
    },
    evidence: { terms: artifact('a'), authority: artifact('b'), egress: artifact('d') },
    termsEffectiveAt: '2026-08-09T00:00:00.000Z',
    termsExpireAt: '2027-08-09T00:00:00.000Z',
    proposedAt: '2026-08-09T00:01:00.000Z',
    proposedBy: 'statly-data-governance-owner',
  },
  gate: {
    environment: 'production' as const,
    decidedAt: '2026-08-09T00:02:00.000Z',
    effectiveAt: '2026-08-09T00:02:00.000Z',
    revalidateAt: '2027-08-09T00:00:00.000Z',
    accountableOwner: 'statly-data-governance-owner',
    reviewer: {
      id: 'independent-source-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: artifact('c'),
    },
    authorityEvidenceId: artifact('b'),
  },
};

class FixtureRepository implements AflTradeGateDecisionLedgerRepository {
  ledger: AflTradeGateDecisionLedger = { proposals: [], decisions: [] };
  batches: AflTradeGateLedgerBatchAppendInput[] = [];

  async load() {
    return { revision: this.ledger.decisions.length, ledger: this.ledger };
  }

  async append(_input: AflTradeGateLedgerAppendInput): Promise<never> {
    throw new Error('Single append is not permitted by this fixture.');
  }

  async appendBatch(input: AflTradeGateLedgerBatchAppendInput) {
    this.batches.push(input);
    const idempotentReplays: boolean[] = [];
    let next = this.ledger;
    for (const record of input.records) {
      const replay = next.decisions.some(
        ({ decisionId }) => decisionId === record.decision.decisionId
      );
      idempotentReplays.push(replay);
      if (!replay) next = appendAflTradeGateDecision(next, record.proposal, record.decision);
    }
    this.ledger = next;
    return { revision: next.decisions.length, ledger: next, idempotentReplays };
  }

  async resolveAuthorization(_rightsArtifactId: string): Promise<never> {
    throw new Error('Not used by this fixture.');
  }
}

describe('approved external draft and trade sources', () => {
  it('creates one exact provider-web policy per approved capability', () => {
    const policies = createApprovedAflTradeExternalSourcePolicies(input.policy);

    expect(policies).toHaveLength(5);
    expect(
      policies.map(({ content }) =>
        content.acquisition.kind === 'provider_web' ? content.acquisition.capabilityId : undefined
      )
    ).toEqual(APPROVED_AFL_TRADE_EXTERNAL_CAPABILITIES);
    expect(policies.map(({ content }) => content.provider)).toEqual([
      'draftguru',
      'draftguru',
      'draftguru',
      'footywire',
      'official_afl',
    ]);
    expect(new Set(policies.map(({ rightsArtifactId }) => rightsArtifactId))).toHaveLength(5);
    for (const policy of policies) {
      expect(policy.content.operations.raw_field_redistribution).toBe('blocked');
      expect(policy.content.termsExpireAt).toBe('2027-08-09T00:00:00.000Z');
    }
  });

  it('produces mechanically eligible decisions for the exact external scope', () => {
    for (const sourceRights of createApprovedAflTradeExternalSourcePolicies(input.policy)) {
      const records = createApprovedAflTradeExternalGateRecords({
        ...input.gate,
        sourceRights,
        version: 1,
        supersedesDecisionId: null,
      });
      const result = evaluateAflTradeGate0A(
        { proposals: [records.proposal], decisions: [records.decision] },
        sourceRights,
        {
          decisionKey: records.decision.content.decisionKey,
          environment: 'production',
          rightsArtifactId: sourceRights.rightsArtifactId,
          evaluatedAt: '2026-08-10T00:00:00.000Z',
          competition: 'AFLM',
          season: 2026,
          accessMechanism: 'automated_web',
          capabilityId: null,
          geography: 'global',
          commercialContext: 'public-research',
          audience: 'public',
          operations: ['bounded_evaluation_capture', 'raw_evidence_retention'],
          fieldUses: sourceRights.content.fields.map(({ sourceField }) => ({
            sourceField,
            use: 'archive_fact' as const,
          })),
          rawRetentionDays: 365,
          metadataRetentionDays: null,
          cacheSeconds: sourceRights.content.automatedAccess.cache.maximumSeconds,
        }
      );

      expect(result).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
      expect(records.proposal.content.scope.scopeKey).toBe(
        `afl-trade-${sourceRights.content.acquisition.capabilityId}`
      );
    }
  });

  it('isolates non-production Gate authority from production decisions', () => {
    const sourceRights = createApprovedAflTradeExternalSourcePolicies(input.policy)[0];
    if (!sourceRights) throw new Error('Expected one approved external source policy.');

    const records = createApprovedAflTradeExternalGateRecords({
      ...input.gate,
      environment: 'non_production',
      sourceRights,
      version: 1,
      supersedesDecisionId: null,
    });

    expect(records.proposal.content).toMatchObject({
      decisionKey: 'draftguru-trade-index-non_production',
      environment: 'non_production',
      scope: {
        scopeKey: 'afl-trade-draftguru-trade-index-non_production',
        description:
          'Non-production authority for draftguru-trade-index in the public AFL trade-intelligence boundary.',
      },
    });
    expect(records.decision.content).toMatchObject({
      decisionKey: 'draftguru-trade-index-non_production',
      environment: 'non_production',
    });
  });

  it('records, replays and renews all capabilities as atomic batches', async () => {
    const repository = new FixtureRepository();
    const initial = await recordApprovedAflTradeExternalSources(repository, input);
    const replay = await recordApprovedAflTradeExternalSources(repository, input);
    const renewed = await recordApprovedAflTradeExternalSources(repository, {
      policy: {
        ...input.policy,
        termsEffectiveAt: '2027-08-09T00:00:00.000Z',
        termsExpireAt: '2028-08-09T00:00:00.000Z',
        proposedAt: '2027-08-09T00:01:00.000Z',
      },
      gate: {
        ...input.gate,
        decidedAt: '2027-08-09T00:02:00.000Z',
        effectiveAt: '2027-08-09T00:02:00.000Z',
        revalidateAt: '2028-08-09T00:00:00.000Z',
      },
    });

    expect(initial.revision).toBe(5);
    expect(replay.revision).toBe(5);
    expect(replay.records.every(({ idempotentReplay }) => idempotentReplay)).toBe(true);
    expect(renewed.revision).toBe(10);
    expect(renewed.records.map(({ decision }) => decision.content.version)).toEqual([
      2, 2, 2, 2, 2,
    ]);
    expect(repository.batches).toHaveLength(3);
    expect(repository.batches.every(({ records }) => records.length === 5)).toBe(true);
  });

  it('records production and non-production decisions as independent histories', async () => {
    const repository = new FixtureRepository();
    await recordApprovedAflTradeExternalSources(repository, input);

    const nonProduction = await recordApprovedAflTradeExternalSources(repository, {
      ...input,
      gate: { ...input.gate, environment: 'non_production' },
    });

    expect(nonProduction.revision).toBe(10);
    expect(
      nonProduction.records.map(({ decision }) => ({
        decisionKey: decision.content.decisionKey,
        environment: decision.content.environment,
        version: decision.content.version,
        supersedesDecisionId: decision.content.supersedesDecisionId,
      }))
    ).toEqual(
      APPROVED_AFL_TRADE_EXTERNAL_CAPABILITIES.map((capabilityId) => ({
        decisionKey: `${capabilityId}-non_production`,
        environment: 'non_production',
        version: 1,
        supersedesDecisionId: null,
      }))
    );
  });

  it('rejects missing field or condition authority', () => {
    expect(() =>
      createApprovedAflTradeExternalSourcePolicies({
        ...input.policy,
        fieldSets: { ...input.policy.fieldSets, 'draftguru-year-page': [] },
      })
    ).toThrow(/field set/);
    expect(() =>
      createApprovedAflTradeExternalSourcePolicies({
        ...input.policy,
        conditionEvidence: {
          ...input.policy.conditionEvidence,
          'draftguru-year-page': { 'selection-field-boundary': artifact('3') },
        },
      })
    ).toThrow(/exact condition set/);
  });
});
