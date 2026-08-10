import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from './contentAddress';

export const AFL_TRADE_ARTIFACT_CUSTODY_PROFILE_SCHEMA_VERSION =
  'afl-trade-artifact-custody-profile/v1' as const;

export const AFL_TRADE_ARTIFACT_CUSTODY_CLASSES = [
  'raw_source',
  'capture_metadata',
  'derived_private',
  'public_projection',
] as const;

export const AFL_TRADE_ARTIFACT_CUSTODY_ENVIRONMENTS = [
  'test_fixture',
  'non_production',
  'production',
] as const;

export const AFL_TRADE_ARTIFACT_KEY_DERIVATION = 'profile_sha256_two_level_fanout_v1' as const;
export const AFL_TRADE_ARTIFACT_CONDITIONAL_CREATE = 'if_none_match_star_required' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const boundedTextSchema = z.string().trim().min(1).max(300);
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function addSortedUniqueIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string[],
  label: string
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message: `${label} must be unique.` });
  }
  if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
    context.addIssue({ code: 'custom', path, message: `${label} must be sorted.` });
  }
}

const encryptionRequirementSchema = z
  .object({
    inTransit: z.literal('tls_required'),
    atRest: z.discriminatedUnion('mode', [
      z
        .object({
          mode: z.literal('provider_managed'),
          keyReferenceSha256: z.null(),
        })
        .strict(),
      z
        .object({
          mode: z.literal('customer_managed'),
          keyReferenceSha256: aflTradeSha256Schema,
        })
        .strict(),
    ]),
  })
  .strict();

const deletionRequirementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('maximum_age'),
      maximumDays: positiveSafeIntegerSchema,
      enforcement: z.literal('provider_lifecycle_required'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('no_scheduled_deletion'),
      maximumDays: z.null(),
      enforcement: z.literal('not_applicable'),
    })
    .strict(),
]);

const wormRequirementSchema = z
  .object({
    mode: z.enum(['governance', 'compliance', 'provider_enforced']),
    minimumDays: positiveSafeIntegerSchema,
  })
  .strict();

const artifactCustodyProfileContentBaseSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ARTIFACT_CUSTODY_PROFILE_SCHEMA_VERSION),
    subject: z.literal('afl-trade-intelligence'),
    contractRole: z.literal('requirements_only_not_readiness_or_authorization'),
    repositoryId: publicIdSchema,
    environment: z.enum(AFL_TRADE_ARTIFACT_CUSTODY_ENVIRONMENTS),
    artifactClass: z.enum(AFL_TRADE_ARTIFACT_CUSTODY_CLASSES),
    maximumObjectBytes: positiveSafeIntegerSchema,
    keyDerivation: z.literal(AFL_TRADE_ARTIFACT_KEY_DERIVATION),
    conditionalCreate: z.literal(AFL_TRADE_ARTIFACT_CONDITIONAL_CREATE),
    encryption: encryptionRequirementSchema,
    retention: z
      .object({
        deletion: deletionRequirementSchema,
        deleteOnWithdrawal: z.boolean(),
        worm: wormRequirementSchema.nullable(),
      })
      .strict(),
    residency: z
      .object({
        allowedJurisdictions: z.array(boundedTextSchema).min(1).max(50),
        crossJurisdictionTransfer: z.enum(['prohibited', 'approved_jurisdictions_only']),
      })
      .strict(),
    infrastructureEvidenceIds: z.array(immutableReferenceSchema).min(1).max(100),
  })
  .strict();

type AflTradeArtifactCustodyProfileContent = z.infer<
  typeof artifactCustodyProfileContentBaseSchema
>;

function refineRetentionCompatibility(
  profile: AflTradeArtifactCustodyProfileContent,
  context: z.RefinementCtx
) {
  const { deletion, deleteOnWithdrawal, worm } = profile.retention;
  if (worm === null) return;

  if (deleteOnWithdrawal) {
    context.addIssue({
      code: 'custom',
      path: ['retention', 'worm'],
      message: 'WORM retention cannot be required when withdrawal may require immediate deletion.',
    });
  }
  if (deletion.kind === 'maximum_age' && worm.minimumDays > deletion.maximumDays) {
    context.addIssue({
      code: 'custom',
      path: ['retention', 'worm', 'minimumDays'],
      message: 'Minimum WORM retention cannot exceed the maximum permitted retention age.',
    });
  }
}

export const aflTradeArtifactCustodyProfileContentSchema =
  artifactCustodyProfileContentBaseSchema.superRefine((profile, context) => {
    addSortedUniqueIssues(
      profile.residency.allowedJurisdictions,
      context,
      ['residency', 'allowedJurisdictions'],
      'Allowed jurisdictions'
    );
    addSortedUniqueIssues(
      profile.infrastructureEvidenceIds,
      context,
      ['infrastructureEvidenceIds'],
      'Infrastructure evidence identifiers'
    );
    refineRetentionCompatibility(profile, context);
  });

export const aflTradeArtifactCustodyProfileSchema = z
  .object({
    profileId: aflTradeContentAddressedIdSchema('artifact-custody-profile'),
    content: aflTradeArtifactCustodyProfileContentSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    addAflTradeContentAddressIssue(
      'artifact-custody-profile',
      profile.profileId,
      profile.content,
      context,
      ['profileId']
    );
  });

export type AflTradeArtifactCustodyClass = (typeof AFL_TRADE_ARTIFACT_CUSTODY_CLASSES)[number];
export type AflTradeArtifactCustodyEnvironment =
  (typeof AFL_TRADE_ARTIFACT_CUSTODY_ENVIRONMENTS)[number];
export type AflTradeArtifactCustodyProfile = z.infer<typeof aflTradeArtifactCustodyProfileSchema>;

export function createAflTradeArtifactCustodyProfile(
  content: z.input<typeof aflTradeArtifactCustodyProfileContentSchema>
): AflTradeArtifactCustodyProfile {
  const parsedContent = aflTradeArtifactCustodyProfileContentSchema.parse(content);
  return aflTradeArtifactCustodyProfileSchema.parse({
    profileId: createAflTradeContentAddress('artifact-custody-profile', parsedContent),
    content: parsedContent,
  });
}
