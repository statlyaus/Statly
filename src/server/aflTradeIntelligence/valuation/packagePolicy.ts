import { z } from 'zod';

import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const finiteNumberSchema = z.number().finite();

const overflowRetentionTierSchema = z
  .object({
    firstOverflowRank: z.number().int().positive().max(100),
    lastOverflowRank: z.number().int().positive().max(100).nullable(),
    retentionRate: finiteNumberSchema.min(0).max(1),
  })
  .strict()
  .superRefine((tier, context) => {
    if (tier.lastOverflowRank !== null && tier.lastOverflowRank < tier.firstOverflowRank) {
      context.addIssue({
        code: 'custom',
        path: ['lastOverflowRank'],
        message: 'An overflow-retention tier cannot end before it begins.',
      });
    }
  });

const scarcitySegmentSchema = z
  .object({
    lowerBoundInclusive: finiteNumberSchema.nonnegative(),
    upperBoundExclusive: finiteNumberSchema.positive().nullable(),
    marginalMultiplier: finiteNumberSchema.nonnegative().max(10),
  })
  .strict()
  .superRefine((segment, context) => {
    if (
      segment.upperBoundExclusive !== null &&
      segment.upperBoundExclusive <= segment.lowerBoundInclusive
    ) {
      context.addIssue({
        code: 'custom',
        path: ['upperBoundExclusive'],
        message: 'A scarcity segment must have positive width.',
      });
    }
  });

const clubTimingMultiplierSchema = z
  .object({
    seasonOffset: z.number().int().nonnegative().max(30),
    multiplier: finiteNumberSchema.nonnegative().max(10),
  })
  .strict();

const clubRoleRuleSchema = z
  .object({
    roleKey: aflTradePublicIdSchema,
    uncongestedContributorsPerSeason: z.number().int().nonnegative().max(100),
    overflowRetentionRate: finiteNumberSchema.min(0).max(1),
  })
  .strict();

const assetRoleAssignmentSchema = z
  .object({
    assetId: aflTradePublicIdSchema,
    roleKey: aflTradePublicIdSchema,
    evidenceArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const clubUtilityProfileSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    profileEvidenceArtifact: aflTradeArtifactRefSchema,
    defaultSeasonTimingMultiplier: finiteNumberSchema.nonnegative().max(10),
    seasonTimingMultipliers: z.array(clubTimingMultiplierSchema).max(31),
    roleRules: z.array(clubRoleRuleSchema).min(1).max(100),
    assetRoleAssignments: z.array(assetRoleAssignmentSchema).min(1).max(100),
  })
  .strict()
  .superRefine((profile, context) => {
    const offsets = profile.seasonTimingMultipliers.map((item) => item.seasonOffset);
    if (
      new Set(offsets).size !== offsets.length ||
      offsets.some((offset, index) => offset !== [...offsets].sort((a, b) => a - b)[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seasonTimingMultipliers'],
        message: 'Club timing overrides must have unique season offsets in canonical order.',
      });
    }

    const roleKeys = profile.roleRules.map((rule) => rule.roleKey);
    if (
      new Set(roleKeys).size !== roleKeys.length ||
      roleKeys.some((roleKey, index) => roleKey !== [...roleKeys].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['roleRules'],
        message: 'Club role rules must have unique role keys in canonical order.',
      });
    }

    const assignmentIds = profile.assetRoleAssignments.map((assignment) => assignment.assetId);
    if (
      new Set(assignmentIds).size !== assignmentIds.length ||
      assignmentIds.some((assetId, index) => assetId !== [...assignmentIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assetRoleAssignments'],
        message: 'Asset role assignments must use unique asset identities in canonical order.',
      });
    }

    const knownRoles = new Set(roleKeys);
    if (profile.assetRoleAssignments.some((assignment) => !knownRoles.has(assignment.roleKey))) {
      context.addIssue({
        code: 'custom',
        path: ['assetRoleAssignments'],
        message: 'Every asset role assignment must reference a declared club role rule.',
      });
    }
  });

const unavailableClubUtilitySchema = z
  .object({
    status: z.literal('unavailable'),
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();

const availableClubUtilitySchema = z
  .object({
    status: z.literal('available'),
    calculation: z.literal(
      'separate_club_specific_timing_and_role_congestion_never_relabels_universal_value'
    ),
    riskTreatment: z.literal('distribution_reported_without_opaque_preference_collapse'),
    profiles: z.array(clubUtilityProfileSchema).min(1).max(18),
  })
  .strict()
  .superRefine((utility, context) => {
    const clubIds = utility.profiles.map((profile) => profile.aflClubId);
    if (
      new Set(clubIds).size !== clubIds.length ||
      clubIds.some((clubId, index) => clubId !== [...clubIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profiles'],
        message: 'Club utility profiles must use unique AFL clubs in canonical order.',
      });
    }
  });

export const aflTradePackagePolicyContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-package-policy/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valueUnitId: aflTradePublicIdSchema,
    universalValueLayers: z
      .object({
        calculationOrder: z.literal(
          'gross_then_list_spot_opportunity_cost_then_scarcity_adjustment'
        ),
        gross: z
          .object({
            aggregation: z.literal('sum_supported_lineage_frontier_contribution_exactly_once'),
            negativeContributionTreatment: z.literal('retain_without_flooring'),
          })
          .strict(),
        listSpot: z
          .object({
            method: z.literal('per_season_ranked_positive_contributors'),
            ranking: z.literal('descending_contribution_then_asset_id'),
            unconstrainedPositiveContributorsPerSeason: z.number().int().positive().max(100),
            overflowRetentionTiers: z.array(overflowRetentionTierSchema).min(1).max(100),
            nonPositiveContributionTreatment: z.literal('retain_without_consuming_positive_slot'),
            policyArtifact: aflTradeArtifactRefSchema,
          })
          .strict(),
        scarcity: z
          .object({
            method: z.literal('piecewise_linear_marginal_contribution_transform'),
            input: z.literal('post_list_spot_positive_asset_season_contribution'),
            segments: z.array(scarcitySegmentSchema).min(1).max(100),
            nonPositiveContributionTreatment: z.literal('retain_unchanged'),
            policyArtifact: aflTradeArtifactRefSchema,
          })
          .strict(),
      })
      .strict(),
    clubUtility: z.discriminatedUnion('status', [
      unavailableClubUtilitySchema,
      availableClubUtilitySchema,
    ]),
    excludedValueConcepts: z
      .object({
        marketValue: z.literal('separate_not_calculated_by_this_policy'),
        contractValue: z.literal('separate_and_unavailable_without_supported_data'),
        commercialValue: z.literal('separate_and_unavailable_without_supported_data'),
      })
      .strict(),
    legacySourceMetricsTreatment: z.literal('excluded_from_every_policy_calculation'),
    limitation: z.literal(
      'Policy parameters require separately approved evidence and are not production defaults, source approval, model calibration, Gate approval, or publication readiness.'
    ),
  })
  .strict()
  .superRefine((policy, context) => {
    const tiers = policy.universalValueLayers.listSpot.overflowRetentionTiers;
    for (const [index, tier] of tiers.entries()) {
      if (index === 0 && tier.firstOverflowRank !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['universalValueLayers', 'listSpot', 'overflowRetentionTiers', index],
          message: 'Overflow-retention tiers must begin at overflow rank one.',
        });
      }
      const previous = tiers[index - 1];
      if (previous) {
        if (
          previous.lastOverflowRank === null ||
          tier.firstOverflowRank !== previous.lastOverflowRank + 1
        ) {
          context.addIssue({
            code: 'custom',
            path: ['universalValueLayers', 'listSpot', 'overflowRetentionTiers', index],
            message: 'Overflow-retention tiers must be contiguous and open-ended only at the end.',
          });
        }
      }
      if (index === tiers.length - 1 && tier.lastOverflowRank !== null) {
        context.addIssue({
          code: 'custom',
          path: ['universalValueLayers', 'listSpot', 'overflowRetentionTiers', index],
          message: 'The final overflow-retention tier must be open-ended.',
        });
      }
    }

    const segments = policy.universalValueLayers.scarcity.segments;
    for (const [index, segment] of segments.entries()) {
      if (index === 0 && segment.lowerBoundInclusive !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['universalValueLayers', 'scarcity', 'segments', index],
          message: 'Scarcity segments must begin at zero.',
        });
      }
      const previous = segments[index - 1];
      if (previous) {
        if (
          previous.upperBoundExclusive === null ||
          segment.lowerBoundInclusive !== previous.upperBoundExclusive
        ) {
          context.addIssue({
            code: 'custom',
            path: ['universalValueLayers', 'scarcity', 'segments', index],
            message: 'Scarcity segments must be contiguous and open-ended only at the end.',
          });
        }
      }
      if (index === segments.length - 1 && segment.upperBoundExclusive !== null) {
        context.addIssue({
          code: 'custom',
          path: ['universalValueLayers', 'scarcity', 'segments', index],
          message: 'The final scarcity segment must be open-ended.',
        });
      }
    }
  });

export const aflTradePackagePolicySchema = z
  .object({
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    content: aflTradePackagePolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue(
      'package-policy',
      policy.packagePolicyId,
      policy.content,
      context,
      ['packagePolicyId']
    );
  });

export type AflTradePackagePolicyContent = z.infer<typeof aflTradePackagePolicyContentSchema>;
export type AflTradePackagePolicy = z.infer<typeof aflTradePackagePolicySchema>;

export function createAflTradePackagePolicy(
  unparsedContent: AflTradePackagePolicyContent
): AflTradePackagePolicy {
  const clubUtility =
    unparsedContent.clubUtility.status === 'available'
      ? {
          ...unparsedContent.clubUtility,
          profiles: [...unparsedContent.clubUtility.profiles]
            .sort((left, right) => left.aflClubId.localeCompare(right.aflClubId))
            .map((profile) => ({
              ...profile,
              seasonTimingMultipliers: [...profile.seasonTimingMultipliers].sort(
                (left, right) => left.seasonOffset - right.seasonOffset
              ),
              roleRules: [...profile.roleRules].sort((left, right) =>
                left.roleKey.localeCompare(right.roleKey)
              ),
              assetRoleAssignments: [...profile.assetRoleAssignments].sort((left, right) =>
                left.assetId.localeCompare(right.assetId)
              ),
            })),
        }
      : unparsedContent.clubUtility;
  const content = aflTradePackagePolicyContentSchema.parse({
    ...unparsedContent,
    clubUtility,
    universalValueLayers: {
      ...unparsedContent.universalValueLayers,
      listSpot: {
        ...unparsedContent.universalValueLayers.listSpot,
        overflowRetentionTiers: [
          ...unparsedContent.universalValueLayers.listSpot.overflowRetentionTiers,
        ].sort((left, right) => left.firstOverflowRank - right.firstOverflowRank),
      },
      scarcity: {
        ...unparsedContent.universalValueLayers.scarcity,
        segments: [...unparsedContent.universalValueLayers.scarcity.segments].sort(
          (left, right) => left.lowerBoundInclusive - right.lowerBoundInclusive
        ),
      },
    },
  });
  return aflTradePackagePolicySchema.parse({
    packagePolicyId: createAflTradeContentAddress('package-policy', content),
    content,
  });
}
