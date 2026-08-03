import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';

export const AFL_TRADE_SOURCE_USES = [
  'archive_fact',
  'model_training',
  'derived_feature',
  'public_display',
] as const;

export const AFL_TRADE_SOURCE_FIELD_DISPOSITIONS = [
  'allowed',
  'blocked',
  'not_applicable',
] as const;

export const AFL_TRADE_SOURCE_OPERATIONS = [
  'bounded_evaluation_capture',
  'raw_evidence_retention',
  'metadata_hash_retention',
  'internal_quality_evaluation',
  'model_training',
  'derived_feature_creation',
  'public_derived_output',
  'public_fact_display',
  'raw_field_redistribution',
] as const;

export type AflTradeSourceUse = (typeof AFL_TRADE_SOURCE_USES)[number];
export type AflTradeSourceFieldDisposition = (typeof AFL_TRADE_SOURCE_FIELD_DISPOSITIONS)[number];
export type AflTradeSourceOperation = (typeof AFL_TRADE_SOURCE_OPERATIONS)[number];

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);
const dispositionSchema = z.enum(AFL_TRADE_SOURCE_FIELD_DISPOSITIONS);

const operationPermissionsSchema = z
  .object({
    bounded_evaluation_capture: dispositionSchema,
    raw_evidence_retention: dispositionSchema,
    metadata_hash_retention: dispositionSchema,
    internal_quality_evaluation: dispositionSchema,
    model_training: dispositionSchema,
    derived_feature_creation: dispositionSchema,
    public_derived_output: dispositionSchema,
    public_fact_display: dispositionSchema,
    raw_field_redistribution: dispositionSchema,
  })
  .strict();

export const aflTradeSourceFieldUseSchema = z
  .object({
    sourceField: z.string().trim().min(1).max(200),
    normalizedField: z.string().trim().min(1).max(200),
    uses: z
      .object({
        archive_fact: dispositionSchema,
        model_training: dispositionSchema,
        derived_feature: dispositionSchema,
        public_display: dispositionSchema,
      })
      .strict(),
    attributionRequired: z.boolean(),
    notes: boundedTextSchema.nullable(),
  })
  .strict();

const retentionClassSchema = z
  .object({
    disposition: z.enum(['prohibited', 'transient', 'retained']),
    maximumDays: z.number().int().positive().nullable(),
    deleteOnWithdrawal: z.boolean(),
    basis: boundedTextSchema,
  })
  .strict()
  .superRefine((retention, context) => {
    if (retention.disposition === 'transient' && retention.maximumDays === null) {
      context.addIssue({
        code: 'custom',
        path: ['maximumDays'],
        message: 'Transient retention requires a maximum duration.',
      });
    }
    if (retention.disposition === 'prohibited' && retention.maximumDays !== null) {
      context.addIssue({
        code: 'custom',
        path: ['maximumDays'],
        message: 'Prohibited retention cannot declare a retention duration.',
      });
    }
  });

const sourceConditionSchema = z
  .object({
    conditionId: publicIdSchema,
    description: boundedTextSchema,
    appliesToOperations: z.array(z.enum(AFL_TRADE_SOURCE_OPERATIONS)).min(1),
    verificationEvidenceIds: z.array(immutableReferenceSchema).max(50),
  })
  .strict()
  .superRefine((condition, context) => {
    if (new Set(condition.appliesToOperations).size !== condition.appliesToOperations.length) {
      context.addIssue({
        code: 'custom',
        path: ['appliesToOperations'],
        message: 'Condition operations must be unique.',
      });
    }
  });

export const aflTradeSourceRightsProposalContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-source-rights/v1'),
    registerId: publicIdSchema,
    provider: z.string().trim().min(1).max(200),
    dataset: z.string().trim().min(1).max(300),
    datasetVersion: z.string().trim().min(1).max(200),
    intendedPurpose: boundedTextSchema,
    scope: z
      .object({
        competitions: z.array(publicIdSchema).min(1).max(50),
        seasonRanges: z
          .array(
            z
              .object({
                from: z.number().int().min(1897).max(2200),
                to: z.number().int().min(1897).max(2200),
              })
              .strict()
          )
          .min(1)
          .max(50),
        accessMechanism: z.enum([
          'manual_review',
          'provider_export',
          'provider_api',
          'automated_web',
        ]),
      })
      .strict(),
    operations: operationPermissionsSchema,
    automatedAccess: z
      .object({
        permitted: z.boolean(),
        identification: boundedTextSchema.nullable(),
        rateLimit: z
          .object({
            requests: z.number().int().positive(),
            perSeconds: z.number().int().positive(),
            burst: z.number().int().positive(),
          })
          .strict()
          .nullable(),
        cache: z
          .object({
            permitted: z.boolean(),
            maximumSeconds: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      })
      .strict(),
    retention: z
      .object({
        rawEvidence: retentionClassSchema,
        hashesAndMetadata: retentionClassSchema,
        derivedArtifacts: retentionClassSchema,
      })
      .strict(),
    redistribution: z
      .object({
        rawFieldsPermitted: z.boolean(),
        publicDerivedOutputPermitted: z.boolean(),
      })
      .strict(),
    attribution: z
      .object({
        required: z.boolean(),
        text: boundedTextSchema.nullable(),
        placement: boundedTextSchema.nullable(),
      })
      .strict(),
    restrictions: z
      .object({
        geographic: z.array(boundedTextSchema).max(50),
        commercial: z.array(boundedTextSchema).max(50),
        audience: z.array(boundedTextSchema).max(50),
      })
      .strict(),
    fields: z.array(aflTradeSourceFieldUseSchema).min(1).max(1000),
    conditions: z.array(sourceConditionSchema).max(100),
    rightsEvidenceIds: z.array(immutableReferenceSchema).min(1).max(100),
    termsEffectiveAt: isoDateTimeSchema.nullable(),
    termsExpireAt: isoDateTimeSchema.nullable(),
    withdrawalDuties: z
      .object({
        stopCollection: z.boolean(),
        stopNewDerivedWork: z.boolean(),
        reassessPublishedOutputs: z.boolean(),
        deletionInstructions: boundedTextSchema,
        retainableAuditMaterial: boundedTextSchema,
      })
      .strict(),
    proposedAt: isoDateTimeSchema,
    proposedBy: publicIdSchema,
    proposalOrigin: z.enum(['human_authored', 'agent_assisted']),
  })
  .strict()
  .superRefine((rights, context) => {
    const sourceFields = rights.fields.map((field) => field.sourceField);
    const normalizedFields = rights.fields.map((field) => field.normalizedField);
    if (new Set(sourceFields).size !== sourceFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Source fields must be unique.',
      });
    }
    if (new Set(normalizedFields).size !== normalizedFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Normalized field mappings must be unique.',
      });
    }
    const conditionIds = rights.conditions.map((condition) => condition.conditionId);
    if (new Set(conditionIds).size !== conditionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['conditions'],
        message: 'Source-rights conditions must be unique.',
      });
    }
    for (const [index, range] of rights.scope.seasonRanges.entries()) {
      if (range.to < range.from) {
        context.addIssue({
          code: 'custom',
          path: ['scope', 'seasonRanges', index],
          message: 'A season range cannot end before it starts.',
        });
      }
    }
    if (
      rights.scope.accessMechanism === 'automated_web' ||
      rights.scope.accessMechanism === 'provider_api'
    ) {
      if (
        !rights.automatedAccess.permitted ||
        rights.automatedAccess.identification === null ||
        rights.automatedAccess.rateLimit === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['automatedAccess'],
          message: 'Automated access requires permission, identification, and a rate limit.',
        });
      }
    }
    if (
      rights.automatedAccess.cache.permitted &&
      rights.automatedAccess.cache.maximumSeconds === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['automatedAccess', 'cache', 'maximumSeconds'],
        message: 'Permitted caching requires a maximum duration.',
      });
    }
    if (
      rights.attribution.required &&
      (rights.attribution.text === null || rights.attribution.placement === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['attribution'],
        message: 'Required attribution needs exact text and placement.',
      });
    }
    if (
      rights.operations.raw_evidence_retention === 'allowed' &&
      rights.retention.rawEvidence.disposition === 'prohibited'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retention', 'rawEvidence'],
        message: 'Raw retention cannot be allowed when raw evidence retention is prohibited.',
      });
    }
    if (
      rights.operations.metadata_hash_retention === 'allowed' &&
      rights.retention.hashesAndMetadata.disposition === 'prohibited'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retention', 'hashesAndMetadata'],
        message: 'Metadata retention cannot be allowed when hashes and metadata are prohibited.',
      });
    }
    if (
      rights.operations.raw_field_redistribution === 'allowed' &&
      !rights.redistribution.rawFieldsPermitted
    ) {
      context.addIssue({
        code: 'custom',
        path: ['redistribution', 'rawFieldsPermitted'],
        message: 'Raw redistribution requires explicit permission.',
      });
    }
    if (
      rights.operations.public_derived_output === 'allowed' &&
      !rights.redistribution.publicDerivedOutputPermitted
    ) {
      context.addIssue({
        code: 'custom',
        path: ['redistribution', 'publicDerivedOutputPermitted'],
        message: 'Public derived output requires explicit permission.',
      });
    }
    if (
      rights.termsEffectiveAt !== null &&
      rights.termsExpireAt !== null &&
      Date.parse(rights.termsExpireAt) <= Date.parse(rights.termsEffectiveAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['termsExpireAt'],
        message: 'Source terms must expire after they become effective.',
      });
    }
  });

export const aflTradeSourceRightsProposalSchema = z
  .object({
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    content: aflTradeSourceRightsProposalContentSchema,
  })
  .strict()
  .superRefine((rights, context) => {
    addAflTradeContentAddressIssue(
      'source-rights',
      rights.rightsArtifactId,
      rights.content,
      context,
      ['rightsArtifactId']
    );
  });

export type AflTradeSourceFieldUse = z.infer<typeof aflTradeSourceFieldUseSchema>;
export type AflTradeSourceRightsProposal = z.infer<typeof aflTradeSourceRightsProposalSchema>;
