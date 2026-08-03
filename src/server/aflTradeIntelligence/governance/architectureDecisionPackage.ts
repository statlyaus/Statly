import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_AUTHORITY_CONCERNS,
  addAflTradeExactSetIssues,
  aflTradeArchitectureCurrentStateSchema,
  type AflTradeArchitectureCurrentState,
  type AflTradeAuthorityConcern,
} from './architectureCurrentState';

export const AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS = [
  'current_state',
  'target_schema_integrity',
  'temporal_correction',
  'bounded_reads',
  'immutable_artifacts',
  'projection_parity',
  'migration',
  'rollback',
  'retention',
  'capacity',
  'operations_ownership',
  'activation_retirement',
  'rejected_alternatives',
] as const;

export const AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS = [
  'gate1_accepts_design_only',
  'readiness_requires_observed_evidence',
  'operations_require_separate_authorization',
  'authority_changes_only_via_transition',
  'content_addresses_prove_integrity_only',
  'other_gates_remain_conjunctive',
  'publication_registry_owns_activation',
  'protected_fantasy_authority_is_observed_only',
  'analytical_database_has_independent_lifecycle',
  'public_identities_have_no_fantasy_ownership',
  'valuation_projection_has_separate_pointer',
] as const;

const boundedTextSchema = z.string().trim().min(1).max(4000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

const authorityMatrixEntrySchema = z
  .object({
    concern: z.enum(AFL_TRADE_AUTHORITY_CONCERNS),
    currentAuthority: boundedTextSchema,
    targetAuthority: boundedTextSchema,
    transitionRequired: z.boolean(),
    currentAuthorityDisposition: z.literal('unchanged_until_authorized_activation'),
    targetAuthorityStatus: z.literal('proposed_not_authoritative'),
    activationOwner: publicIdSchema,
    activationConditions: z.array(boundedTextSchema).min(1).max(50),
    retirementConditions: z.array(boundedTextSchema).min(1).max(50),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.transitionRequired === (entry.currentAuthority === entry.targetAuthority)) {
      context.addIssue({
        code: 'custom',
        path: ['transitionRequired'],
        message: 'A changed authority requires a transition; an unchanged authority does not.',
      });
    }
  });

const sectionSchema = z
  .object({
    section: z.enum(AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS),
    decision: boundedTextSchema,
    owner: publicIdSchema,
    acceptanceCriteria: z.array(boundedTextSchema).min(1).max(100),
    evidenceIds: z.array(immutableReferenceSchema).min(1).max(100),
    sourceReferences: z.array(boundedTextSchema).min(1).max(100),
  })
  .strict();

const isolationContractSchema = z
  .object({
    protectedFantasyAuthority: z.literal('observed_unchanged_outside_trade_engine'),
    analyticalDatabase: z
      .object({
        deploymentBoundary: z.literal('independent_database_or_isolated_database_and_role'),
        credentials: z.literal('separate_pooled_and_direct'),
        migrationHistory: z.literal('separate_postgresql_native'),
        backupRestore: z.literal('separate_evidence_required'),
        connectionBudget: z.literal('separate'),
        relationalDependencies: z.literal('no_fantasy_foreign_keys'),
      })
      .strict(),
    publicIdentities: z.literal('source_native_no_fantasy_ownership'),
    valuationProjectionPointer: z.literal('separate_from_legacy_archive_pointer'),
  })
  .strict();

export const aflTradeArchitectureDecisionPackageContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-architecture-decision-package/v1'),
    subject: z.literal('afl-trade-intelligence'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    decisionKey: publicIdSchema,
    packageVersion: z.number().int().positive(),
    currentStateSnapshotId: aflTradeContentAddressedIdSchema('architecture-current-state'),
    preparedAt: isoDateTimeSchema,
    preparedBy: publicIdSchema,
    packageState: z.literal('proposal_only'),
    productionClaim: z.literal(false),
    infrastructureReadiness: z.literal('not_asserted'),
    operationalAuthorization: z.literal('not_granted'),
    authorityTransfer: z.literal('not_executed'),
    integrityStatement: z.literal('content_address_proves_integrity_not_truth_or_authority'),
    designAssertions: z
      .array(z.enum(AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS))
      .length(AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS.length),
    isolationContract: isolationContractSchema,
    authorityMatrix: z
      .array(authorityMatrixEntrySchema)
      .length(AFL_TRADE_AUTHORITY_CONCERNS.length),
    sections: z.array(sectionSchema).length(AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS.length),
    readinessEvidenceRequirements: z.array(boundedTextSchema).min(1).max(100),
    operationalAuthorizationRequirements: z.array(boundedTextSchema).min(1).max(100),
    limitations: z.array(boundedTextSchema).min(1).max(100),
  })
  .strict()
  .superRefine((decisionPackage, context) => {
    addAflTradeExactSetIssues(
      decisionPackage.designAssertions,
      AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS,
      context,
      ['designAssertions'],
      'Design assertions'
    );
    addAflTradeExactSetIssues(
      decisionPackage.authorityMatrix.map((entry) => entry.concern),
      AFL_TRADE_AUTHORITY_CONCERNS,
      context,
      ['authorityMatrix'],
      'Authority matrix concerns'
    );
    addAflTradeExactSetIssues(
      decisionPackage.sections.map((section) => section.section),
      AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS,
      context,
      ['sections'],
      'Architecture package sections'
    );

    const protectedFantasyAuthority = decisionPackage.authorityMatrix.find(
      (entry) => entry.concern === 'protected_fantasy_relational_state'
    );
    if (
      protectedFantasyAuthority &&
      (protectedFantasyAuthority.currentAuthority !== protectedFantasyAuthority.targetAuthority ||
        protectedFantasyAuthority.transitionRequired)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorityMatrix'],
        message:
          'Protected fantasy relational authority is observed context and cannot be transferred by the trade-engine package.',
      });
    }
  });

export const aflTradeArchitectureDecisionPackageSchema = z
  .object({
    packageId: aflTradeContentAddressedIdSchema('architecture-decision-package'),
    content: aflTradeArchitectureDecisionPackageContentSchema,
  })
  .strict()
  .superRefine((decisionPackage, context) => {
    addAflTradeContentAddressIssue(
      'architecture-decision-package',
      decisionPackage.packageId,
      decisionPackage.content,
      context,
      ['packageId']
    );
  });

export type AflTradeArchitecturePackageSection =
  (typeof AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS)[number];
export type AflTradeArchitectureAuthorityMatrixEntry = z.infer<
  typeof authorityMatrixEntrySchema
> & { concern: AflTradeAuthorityConcern };
export type AflTradeArchitectureDecisionPackage = z.infer<
  typeof aflTradeArchitectureDecisionPackageSchema
>;

export type AflTradeArchitecturePackageContextIssueCode =
  | 'invalid_current_state'
  | 'invalid_decision_package'
  | 'current_state_reference_mismatch'
  | 'environment_mismatch'
  | 'current_authority_mismatch';

export interface AflTradeArchitecturePackageContextValidation {
  valid: boolean;
  issues: Array<{
    code: AflTradeArchitecturePackageContextIssueCode;
    message: string;
  }>;
}

export function validateAflTradeArchitecturePackageContext(
  currentState: AflTradeArchitectureCurrentState,
  decisionPackage: AflTradeArchitectureDecisionPackage
): AflTradeArchitecturePackageContextValidation {
  const currentStateResult = aflTradeArchitectureCurrentStateSchema.safeParse(currentState);
  const packageResult = aflTradeArchitectureDecisionPackageSchema.safeParse(decisionPackage);
  const issues: AflTradeArchitecturePackageContextValidation['issues'] = [];

  if (!currentStateResult.success) {
    issues.push({
      code: 'invalid_current_state',
      message: 'The architecture package references an invalid current-state snapshot.',
    });
  }
  if (!packageResult.success) {
    issues.push({
      code: 'invalid_decision_package',
      message: 'The architecture decision package is invalid.',
    });
  }
  if (!currentStateResult.success || !packageResult.success) return { valid: false, issues };

  if (packageResult.data.content.currentStateSnapshotId !== currentStateResult.data.snapshotId) {
    issues.push({
      code: 'current_state_reference_mismatch',
      message: 'The package must reference the exact current-state snapshot under review.',
    });
  }
  if (packageResult.data.content.environment !== currentStateResult.data.content.environment) {
    issues.push({
      code: 'environment_mismatch',
      message: 'The architecture package and current-state snapshot environments must match.',
    });
  }
  const snapshotAuthorities = new Map(
    currentStateResult.data.content.authorities.map((entry) => [
      entry.concern,
      entry.currentAuthority,
    ])
  );
  for (const entry of packageResult.data.content.authorityMatrix) {
    if (snapshotAuthorities.get(entry.concern) !== entry.currentAuthority) {
      issues.push({
        code: 'current_authority_mismatch',
        message: `The package current authority for ${entry.concern} must match its snapshot.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
