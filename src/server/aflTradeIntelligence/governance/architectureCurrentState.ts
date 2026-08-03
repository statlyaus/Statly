import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';

export const AFL_TRADE_AUTHORITY_CONCERNS = [
  'protected_fantasy_relational_state',
  'legacy_trade_archive',
  'analytical_records',
  'immutable_artifacts',
  'public_projection',
  'publication_activation',
] as const;

export const AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS = [
  'protected_fantasy_relational_provider_sqlite',
  'legacy_firestore_pointer_cache',
  'legacy_firestore_fallback',
  'legacy_numeric_zero_coercion',
  'legacy_search_separate_pointer',
  'legacy_import_pointer_without_cas',
  'protected_fantasy_postgres_cutover_unexecuted',
  'analytical_postgres_target_absent',
  'analytical_isolation_controls_unverified',
  'immutable_artifact_repository_absent',
  'decision_evidence_registry_absent',
] as const;

const boundedTextSchema = z.string().trim().min(1).max(2000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const repositoryRevisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

const verificationSchema = z
  .object({
    verificationId: publicIdSchema,
    command: boundedTextSchema,
    outcome: z.enum(['confirmed', 'not_observed', 'inconclusive']),
    observedAt: isoDateTimeSchema,
    evidenceIds: z.array(immutableReferenceSchema).min(1).max(20),
  })
  .strict();

const authorityObservationSchema = z
  .object({
    concern: z.enum(AFL_TRADE_AUTHORITY_CONCERNS),
    implementationState: z.enum(['implemented', 'legacy_only', 'planned', 'not_implemented']),
    currentAuthority: boundedTextSchema,
    readPath: boundedTextSchema,
    writePath: boundedTextSchema,
    sourceReferences: z.array(boundedTextSchema).min(1).max(50),
    limitations: z.array(boundedTextSchema).min(1).max(50),
  })
  .strict();

const requiredObservationSchema = z
  .object({
    observation: z.enum(AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS),
    finding: boundedTextSchema,
    sourceReferences: z.array(boundedTextSchema).min(1).max(50),
    verificationIds: z.array(publicIdSchema).min(1).max(20),
  })
  .strict();

export function addAflTradeExactSetIssues(
  values: readonly string[],
  requiredValues: readonly string[],
  context: z.RefinementCtx,
  path: string[],
  label: string
) {
  const actual = new Set(values);
  const required = new Set(requiredValues);
  if (actual.size !== values.length) {
    context.addIssue({ code: 'custom', path, message: `${label} must not contain duplicates.` });
  }
  const missing = requiredValues.filter((value) => !actual.has(value));
  const unexpected = values.filter((value) => !required.has(value));
  if (missing.length > 0 || unexpected.length > 0) {
    context.addIssue({
      code: 'custom',
      path,
      message: `${label} must cover the exact required set. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`,
    });
  }
}

export const aflTradeArchitectureCurrentStateContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-architecture-current-state/v1'),
    subject: z.literal('afl-trade-intelligence'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    repositoryRevision: repositoryRevisionSchema,
    capturedAt: isoDateTimeSchema,
    capturedBy: publicIdSchema,
    captureMethod: z.literal('repository_inspection'),
    productionClaim: z.literal(false),
    integrityStatement: z.literal('content_address_proves_integrity_not_truth_or_authority'),
    verifications: z.array(verificationSchema).min(1).max(100),
    authorities: z.array(authorityObservationSchema).length(AFL_TRADE_AUTHORITY_CONCERNS.length),
    requiredObservations: z
      .array(requiredObservationSchema)
      .length(AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS.length),
    unresolvedQuestions: z.array(boundedTextSchema).min(1).max(100),
  })
  .strict()
  .superRefine((snapshot, context) => {
    addAflTradeExactSetIssues(
      snapshot.authorities.map((authority) => authority.concern),
      AFL_TRADE_AUTHORITY_CONCERNS,
      context,
      ['authorities'],
      'Authority observations'
    );
    addAflTradeExactSetIssues(
      snapshot.requiredObservations.map((observation) => observation.observation),
      AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS,
      context,
      ['requiredObservations'],
      'Required current-state observations'
    );

    const verificationIds = snapshot.verifications.map(
      (verification) => verification.verificationId
    );
    if (new Set(verificationIds).size !== verificationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['verifications'],
        message: 'Verification identifiers must be unique.',
      });
    }
    const knownVerificationIds = new Set(verificationIds);
    snapshot.requiredObservations.forEach((observation, index) => {
      const unknown = observation.verificationIds.filter((id) => !knownVerificationIds.has(id));
      if (unknown.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['requiredObservations', index, 'verificationIds'],
          message: `Observation references unknown verifications: ${unknown.join(', ')}.`,
        });
      }
    });
  });

export const aflTradeArchitectureCurrentStateSchema = z
  .object({
    snapshotId: aflTradeContentAddressedIdSchema('architecture-current-state'),
    content: aflTradeArchitectureCurrentStateContentSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    addAflTradeContentAddressIssue(
      'architecture-current-state',
      snapshot.snapshotId,
      snapshot.content,
      context,
      ['snapshotId']
    );
  });

export type AflTradeAuthorityConcern = (typeof AFL_TRADE_AUTHORITY_CONCERNS)[number];
export type AflTradeArchitectureCurrentState = z.infer<
  typeof aflTradeArchitectureCurrentStateSchema
>;
