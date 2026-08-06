import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  aflDraftTradeCanonicalIdentitySchema,
  aflDraftTradeOutcomeEvaluationSetSchema,
  aflDraftTradeOutcomeObservationSchema,
  createAflDraftTradeOutcomeEvaluationSet,
  reconcileAflDraftTradeOutcomeMetric,
  type AflDraftTradeOutcomeObservation,
  type AflDraftTradeOutcomeScope,
} from '@/server/aflTradeIntelligence/modeling/draftTradeOutcomeContracts';

const H = 'a'.repeat(64);
const CREATED_AT = '2026-08-06T08:00:00.000Z';
const scope = {
  competition: 'AFL' as const,
  basis: 'after_event' as const,
  clubScope: 'all_subsequent_afl_clubs' as const,
  season: null,
  effectiveFrom: '2020-11-01T00:00:00.000Z',
  effectiveThrough: CREATED_AT,
};
const artifact = createAflTradeCanonicalJsonArtifactRef({ fixture: true }, CREATED_AT);
const provenance = {
  evidenceItemId: `evidence-item:${H}`,
  sourceArtifact: artifact,
  rightsReceiptId: `gate0a-evaluation:${H}`,
  rightsDisposition: 'approved' as const,
  locator: {
    sourceRecordId: '2020_0001',
    sheet: '2020',
    row: 2,
    field: 'games',
  },
  adapterVersion: 'workbook-evaluation-v1',
};

function exact(
  sourceRole: 'recorded' | 'independently_observed',
  value: number,
  rightsDisposition: 'approved' | 'blocked' = 'approved',
  observationScope: AflDraftTradeOutcomeScope = scope
): AflDraftTradeOutcomeObservation {
  return aflDraftTradeOutcomeObservationSchema.parse({
    metricCode: 'games',
    sourceRole,
    scope: observationScope,
    provenance: { ...provenance, rightsDisposition },
    availability: 'exact',
    value,
    rawValue: String(value),
  });
}

function unavailable(
  sourceRole: 'recorded' | 'independently_observed'
): AflDraftTradeOutcomeObservation {
  return aflDraftTradeOutcomeObservationSchema.parse({
    metricCode: 'games',
    sourceRole,
    scope,
    availability: 'unavailable',
    value: null,
    rawValue: '',
    reasonCode: sourceRole === 'recorded' ? 'not_recorded' : 'source_not_supplied',
    provenance: sourceRole === 'recorded' ? provenance : null,
  });
}

function partialRecorded(): AflDraftTradeOutcomeObservation {
  return aflDraftTradeOutcomeObservationSchema.parse({
    metricCode: 'games',
    sourceRole: 'recorded',
    scope,
    provenance,
    availability: 'partial',
    value: null,
    rawValue: '268 (231)',
    reasonCode: 'ambiguous_composite_scope',
    components: [
      { ordinal: 1, value: 268 },
      { ordinal: 2, value: 231 },
    ],
  });
}

describe('AFL Draft and Trade outcome contracts', () => {
  it('derives every reconciliation state without conflating zero and missing', () => {
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        exact('recorded', 0),
        exact('independently_observed', 0)
      )
    ).toMatchObject({
      state: 'matched',
      publicationEligible: true,
    });
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        exact('recorded', 0),
        exact('independently_observed', 1)
      ).state
    ).toBe('different');
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        exact('recorded', 0),
        unavailable('independently_observed')
      ).state
    ).toBe('recorded_only');
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        unavailable('recorded'),
        exact('independently_observed', 0)
      ).state
    ).toBe('source_only');
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        unavailable('recorded'),
        unavailable('independently_observed')
      ).state
    ).toBe('unavailable');
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        partialRecorded(),
        exact('independently_observed', 268)
      )
    ).toMatchObject({
      state: 'partial',
      publicationEligible: false,
    });
    expect(
      reconcileAflDraftTradeOutcomeMetric(
        'games',
        exact('recorded', 12),
        exact('independently_observed', 12, 'approved', {
          ...scope,
          clubScope: 'destination_afl_club_only',
        })
      )
    ).toMatchObject({ state: 'partial', publicationEligible: false });
  });

  it('requires approved evidence for every source value exposed by publication', () => {
    const blockedObserved = reconcileAflDraftTradeOutcomeMetric(
      'games',
      exact('recorded', 12),
      exact('independently_observed', 12, 'blocked')
    );
    expect(blockedObserved).toMatchObject({ state: 'matched', publicationEligible: false });
    expect(blockedObserved.independentlyObserved).toMatchObject({
      provenance: { rightsReceiptId: `gate0a-evaluation:${H}`, rightsDisposition: 'blocked' },
    });

    const blockedRecorded = reconcileAflDraftTradeOutcomeMetric(
      'games',
      exact('recorded', 12, 'blocked'),
      exact('independently_observed', 12)
    );
    expect(blockedRecorded).toMatchObject({ state: 'matched', publicationEligible: false });
    expect(blockedRecorded.recorded).toMatchObject({
      provenance: { rightsReceiptId: `gate0a-evaluation:${H}`, rightsDisposition: 'blocked' },
    });
  });

  it('keeps canonical identity source-native and makes ambiguity explicit', () => {
    expect(
      aflDraftTradeCanonicalIdentitySchema.safeParse({
        kind: 'player',
        state: 'resolved',
        canonicalId: 'fantasy:user-123',
        resolutionEvidenceId: `evidence-item:${H}`,
      }).success
    ).toBe(false);
    expect(
      aflDraftTradeCanonicalIdentitySchema.safeParse({
        kind: 'player',
        state: 'unresolved',
        canonicalId: null,
        reasonCode: 'ambiguous_canonical_match',
        candidateCanonicalIds: ['afl-player:one'],
      }).success
    ).toBe(false);
    expect(
      aflDraftTradeCanonicalIdentitySchema.parse({
        kind: 'player',
        state: 'unresolved',
        canonicalId: null,
        reasonCode: 'ambiguous_canonical_match',
        candidateCanonicalIds: ['afl-player:one', 'afl-player:two'],
      })
    ).toMatchObject({ state: 'unresolved', canonicalId: null });
  });

  it('content-addresses the canonical evaluation set and detects tampering', () => {
    const set = createAflDraftTradeOutcomeEvaluationSet({
      schemaVersion: 'afl-draft-trade-outcome-evaluation/v1',
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
      createdAt: CREATED_AT,
      metricDefinitionVersion: 'metric-definition-v1',
      records: [],
      missingnessPolicy: 'zero_is_observed_and_missing_is_explicitly_unavailable',
      limitation:
        'Source-independent evaluation contract only; no record creates user or fantasy ownership and no value is publishable without independently observed, rights-approved evidence.',
    });

    expect(set.outcomeEvaluationSetId).toMatch(/^outcome-evaluation:[a-f0-9]{64}$/);
    expect(
      aflDraftTradeOutcomeEvaluationSetSchema.safeParse({
        ...set,
        content: { ...set.content, metricDefinitionVersion: 'metric-definition-v2' },
      }).success
    ).toBe(false);
  });
});
