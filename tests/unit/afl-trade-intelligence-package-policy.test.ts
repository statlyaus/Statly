import { describe, expect, it } from 'vitest';

import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradePackagePolicyContent } from '@/server/aflTradeIntelligence/valuation/packagePolicy';
import {
  aflTradePackagePolicyContentSchema,
  aflTradePackagePolicySchema,
  createAflTradePackagePolicy,
} from '@/server/aflTradeIntelligence/valuation/packagePolicy';

function digest(character: string): string {
  return character.repeat(64);
}

function artifact(character: string): AflTradeArtifactRef {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function content(): AflTradePackagePolicyContent {
  return {
    schemaVersion: 'afl-trade-package-policy/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationBundleId: `valuation-bundle:${digest('1')}`,
    valueUnitId: 'scoreboard-contribution-above-replacement-v1',
    universalValueLayers: {
      calculationOrder: 'gross_then_list_spot_opportunity_cost_then_scarcity_adjustment',
      gross: {
        aggregation: 'sum_supported_lineage_frontier_contribution_exactly_once',
        negativeContributionTreatment: 'retain_without_flooring',
      },
      listSpot: {
        method: 'per_season_ranked_positive_contributors',
        ranking: 'descending_contribution_then_asset_id',
        unconstrainedPositiveContributorsPerSeason: 1,
        overflowRetentionTiers: [
          { firstOverflowRank: 3, lastOverflowRank: null, retentionRate: 0.25 },
          { firstOverflowRank: 1, lastOverflowRank: 2, retentionRate: 0.5 },
        ],
        nonPositiveContributionTreatment: 'retain_without_consuming_positive_slot',
        policyArtifact: artifact('2'),
      },
      scarcity: {
        method: 'piecewise_linear_marginal_contribution_transform',
        input: 'post_list_spot_positive_asset_season_contribution',
        segments: [
          { lowerBoundInclusive: 10, upperBoundExclusive: null, marginalMultiplier: 1.5 },
          { lowerBoundInclusive: 0, upperBoundExclusive: 10, marginalMultiplier: 1 },
        ],
        nonPositiveContributionTreatment: 'retain_unchanged',
        policyArtifact: artifact('3'),
      },
    },
    clubUtility: {
      status: 'available',
      calculation:
        'separate_club_specific_timing_and_role_congestion_never_relabels_universal_value',
      riskTreatment: 'distribution_reported_without_opaque_preference_collapse',
      profiles: [
        {
          aflClubId: 'club-b',
          profileEvidenceArtifact: artifact('4'),
          defaultSeasonTimingMultiplier: 1,
          seasonTimingMultipliers: [
            { seasonOffset: 2, multiplier: 0.8 },
            { seasonOffset: 0, multiplier: 1.2 },
          ],
          roleRules: [
            {
              roleKey: 'key-forward',
              uncongestedContributorsPerSeason: 1,
              overflowRetentionRate: 0.4,
            },
          ],
          assetRoleAssignments: [
            { assetId: 'asset-b', roleKey: 'key-forward', evidenceArtifact: artifact('5') },
          ],
        },
        {
          aflClubId: 'club-a',
          profileEvidenceArtifact: artifact('6'),
          defaultSeasonTimingMultiplier: 1,
          seasonTimingMultipliers: [],
          roleRules: [
            {
              roleKey: 'midfield',
              uncongestedContributorsPerSeason: 2,
              overflowRetentionRate: 0.5,
            },
            {
              roleKey: 'defender',
              uncongestedContributorsPerSeason: 1,
              overflowRetentionRate: 0.3,
            },
          ],
          assetRoleAssignments: [
            { assetId: 'asset-a', roleKey: 'midfield', evidenceArtifact: artifact('7') },
          ],
        },
      ],
    },
    excludedValueConcepts: {
      marketValue: 'separate_not_calculated_by_this_policy',
      contractValue: 'separate_and_unavailable_without_supported_data',
      commercialValue: 'separate_and_unavailable_without_supported_data',
    },
    legacySourceMetricsTreatment: 'excluded_from_every_policy_calculation',
    limitation:
      'Policy parameters require separately approved evidence and are not production defaults, source approval, model calibration, Gate approval, or publication readiness.',
  };
}

describe('AFL trade package policy', () => {
  it('canonicalizes every ordered policy dimension before content addressing', () => {
    const policy = createAflTradePackagePolicy(content());

    expect(
      policy.content.universalValueLayers.listSpot.overflowRetentionTiers.map(
        (tier) => tier.firstOverflowRank
      )
    ).toEqual([1, 3]);
    expect(
      policy.content.universalValueLayers.scarcity.segments.map(
        (segment) => segment.lowerBoundInclusive
      )
    ).toEqual([0, 10]);
    expect(policy.content.clubUtility.status).toBe('available');
    if (policy.content.clubUtility.status !== 'available') return;
    expect(policy.content.clubUtility.profiles.map((profile) => profile.aflClubId)).toEqual([
      'club-a',
      'club-b',
    ]);
    expect(policy.content.clubUtility.profiles[0].roleRules.map((rule) => rule.roleKey)).toEqual([
      'defender',
      'midfield',
    ]);
    expect(policy.content.clubUtility.profiles[1].seasonTimingMultipliers).toEqual([
      { seasonOffset: 0, multiplier: 1.2 },
      { seasonOffset: 2, multiplier: 0.8 },
    ]);
    expect(aflTradePackagePolicySchema.parse(policy)).toEqual(policy);
  });

  it.each([
    ['start after one', [{ firstOverflowRank: 2, lastOverflowRank: null, retentionRate: 0.5 }]],
    [
      'contain a gap',
      [
        { firstOverflowRank: 1, lastOverflowRank: 1, retentionRate: 0.5 },
        { firstOverflowRank: 3, lastOverflowRank: null, retentionRate: 0.25 },
      ],
    ],
    [
      'open before the final tier',
      [
        { firstOverflowRank: 1, lastOverflowRank: null, retentionRate: 0.5 },
        { firstOverflowRank: 2, lastOverflowRank: null, retentionRate: 0.25 },
      ],
    ],
    [
      'end without an open tier',
      [{ firstOverflowRank: 1, lastOverflowRank: 2, retentionRate: 0.5 }],
    ],
  ])('rejects overflow tiers that %s', (_label, overflowRetentionTiers) => {
    const candidate = content();
    candidate.universalValueLayers.listSpot.overflowRetentionTiers = overflowRetentionTiers;
    expect(aflTradePackagePolicyContentSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    [
      'start above zero',
      [{ lowerBoundInclusive: 1, upperBoundExclusive: null, marginalMultiplier: 1 }],
    ],
    [
      'contain a gap',
      [
        { lowerBoundInclusive: 0, upperBoundExclusive: 10, marginalMultiplier: 1 },
        { lowerBoundInclusive: 11, upperBoundExclusive: null, marginalMultiplier: 1.5 },
      ],
    ],
    [
      'open before the final segment',
      [
        { lowerBoundInclusive: 0, upperBoundExclusive: null, marginalMultiplier: 1 },
        { lowerBoundInclusive: 10, upperBoundExclusive: null, marginalMultiplier: 1.5 },
      ],
    ],
    [
      'end without an open segment',
      [{ lowerBoundInclusive: 0, upperBoundExclusive: 10, marginalMultiplier: 1 }],
    ],
  ])('rejects scarcity segments that %s', (_label, segments) => {
    const candidate = content();
    candidate.universalValueLayers.scarcity.segments = segments;
    expect(aflTradePackagePolicyContentSchema.safeParse(candidate).success).toBe(false);
  });

  it('requires canonical, unique, internally referenced club utility roles and assets', () => {
    const candidate = createAflTradePackagePolicy(content()).content;
    if (candidate.clubUtility.status !== 'available') throw new Error('Expected utility profiles.');
    const profile = candidate.clubUtility.profiles[0];

    for (const invalidProfile of [
      { ...profile, roleRules: [...profile.roleRules].reverse() },
      { ...profile, roleRules: [profile.roleRules[0], profile.roleRules[0]] },
      {
        ...profile,
        assetRoleAssignments: [{ ...profile.assetRoleAssignments[0], roleKey: 'undeclared-role' }],
      },
      {
        ...profile,
        assetRoleAssignments: [profile.assetRoleAssignments[0], profile.assetRoleAssignments[0]],
      },
    ]) {
      expect(
        aflTradePackagePolicyContentSchema.safeParse({
          ...candidate,
          clubUtility: { ...candidate.clubUtility, profiles: [invalidProfile] },
        }).success
      ).toBe(false);
    }
  });

  it('supports an explicit unavailable club-utility state without inventing preferences', () => {
    const candidate = content();
    candidate.clubUtility = {
      status: 'unavailable',
      reasonCode: 'no-approved-club-policy',
      explanation: 'No evidence-backed club utility profile is approved for this valuation.',
    };

    expect(createAflTradePackagePolicy(candidate).content.clubUtility).toEqual(
      candidate.clubUtility
    );
  });

  it.each(['userId', 'fantasyTeamId', 'rosterOwnerId', 'legacyExpectedValue'])(
    'rejects forbidden or undeclared calculation field %s',
    (field) => {
      expect(
        aflTradePackagePolicyContentSchema.safeParse({ ...content(), [field]: 'forbidden' }).success
      ).toBe(false);
    }
  );

  it('rejects invalid policy evidence and content-address tampering', () => {
    const invalidEvidence = content();
    invalidEvidence.universalValueLayers.listSpot.policyArtifact = {
      ...artifact('8'),
      storageUri: `artifact://sha256/${digest('9')}`,
    };
    expect(aflTradePackagePolicyContentSchema.safeParse(invalidEvidence).success).toBe(false);

    const policy = createAflTradePackagePolicy(content());
    expect(
      aflTradePackagePolicySchema.safeParse({
        ...policy,
        content: { ...policy.content, valueUnitId: 'tampered-unit' },
      }).success
    ).toBe(false);
  });
});
