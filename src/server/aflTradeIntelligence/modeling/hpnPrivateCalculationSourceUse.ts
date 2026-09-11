import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceRights';
import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  type AflTradePrivateReviewedEvidenceEvaluationAdmission,
} from '../valuation/privateReviewedEvidenceEvaluation';

export const AFL_TRADE_HPN_PRIVATE_SOURCE_USE_REASONS = [
  'private_evaluation_not_authorized',
  'reviewed_evidence_not_exact',
  'rights_scope_mismatch',
  'rights_not_current',
  'authority_is_overbroad',
  'derived_feature_operation_blocked',
  'source_field_not_registered',
  'derived_source_field_blocked',
  'derived_artifact_retention_blocked',
  'withdrawal_controls_missing',
] as const;

export type AflTradeHpnPrivateSourceUseReason =
  (typeof AFL_TRADE_HPN_PRIVATE_SOURCE_USE_REASONS)[number];

export type AflTradeHpnPrivateCalculationSourceUseAssessment = Readonly<{
  assessmentId: string;
  content: AflTradeHpnPrivateCalculationSourceUseAssessmentContent;
}>;

export type AflTradeHpnPrivateCalculationSourceUseAssessmentContent = Readonly<{
  schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v1';
  environment: 'non_production';
  purpose: 'private_confirmed_realized_hpn_pav';
  competition: string;
  seasonYear: number;
  valuationScopeKey: string | null;
  evaluationDecisionId: string | null;
  state: 'permitted_private_calculation' | 'not_permitted';
  rightsArtifactId: string;
  evidenceBundleId: string;
  fields: readonly Readonly<{
    sourceField: string;
    state: 'permitted_private_calculation' | 'not_permitted';
    reasons: readonly AflTradeHpnPrivateSourceUseReason[];
  }>[];
  reasons: readonly AflTradeHpnPrivateSourceUseReason[];
  evidenceRefs: readonly AflTradeArtifactRef[];
  effectiveRestriction: Readonly<{
    mode: 'narrowed_private_evaluation';
    baseRightsArtifactId: string;
    evaluationDecisionId: string;
    operation: 'derived_feature_creation';
    commercialContext: 'internal-evaluation';
    audience: 'internal';
    modelTraining: 'blocked';
    publicDerivedOutput: 'blocked';
    publicFactDisplay: 'blocked';
    rawFieldRedistribution: 'blocked';
  }> | null;
  evaluatedAt: string;
  publicationEligible: false;
  publicationProhibited: true;
}>;

type AssessmentInput = Readonly<{
  rights: unknown;
  rightsArtifact: AflTradeArtifactRef;
  evidenceBundle: unknown;
  admission: AflTradePrivateReviewedEvidenceEvaluationAdmission;
  competition: string;
  seasonYear: number;
  sourceFields: readonly string[];
  evaluatedAt: string;
}>;

function uniqueReasons(
  reasons: readonly AflTradeHpnPrivateSourceUseReason[]
): readonly AflTradeHpnPrivateSourceUseReason[] {
  return AFL_TRADE_HPN_PRIVATE_SOURCE_USE_REASONS.filter((reason) => reasons.includes(reason));
}

function hasExactRightsEvidence(
  rightsArtifact: AflTradeArtifactRef,
  evidenceRefs: readonly AflTradeArtifactRef[]
): boolean {
  return evidenceRefs.some((reference) =>
    doAflTradeArtifactRefsExactlyMatch(reference, rightsArtifact)
  );
}

function isCurrentForEvaluation(
  rights: AflTradeSourceRightsProposal,
  evaluatedAt: string
): boolean {
  const evaluationTime = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluationTime)) {
    throw new TypeError('A valid HPN source-use evaluation timestamp is required.');
  }
  const effectiveTime =
    rights.content.termsEffectiveAt === null ? null : Date.parse(rights.content.termsEffectiveAt);
  const expiryTime =
    rights.content.termsExpireAt === null ? null : Date.parse(rights.content.termsExpireAt);
  return (
    (effectiveTime === null || evaluationTime >= effectiveTime) &&
    (expiryTime === null || evaluationTime < expiryTime)
  );
}

function isOverbroad(rights: AflTradeSourceRightsProposal): boolean {
  return (
    rights.content.operations.model_training !== 'blocked' ||
    rights.content.operations.public_derived_output !== 'blocked' ||
    rights.content.operations.public_fact_display !== 'blocked' ||
    rights.content.operations.raw_field_redistribution !== 'blocked' ||
    rights.content.redistribution.rawFieldsPermitted ||
    rights.content.redistribution.publicDerivedOutputPermitted ||
    rights.content.fields.some(
      (field) => field.uses.model_training !== 'blocked' || field.uses.public_display !== 'blocked'
    )
  );
}

function unavailableAssessment(input: {
  competition: string;
  seasonYear: number;
  valuationScopeKey: string | null;
  evaluationDecisionId: string | null;
  rightsArtifactId: string;
  evidenceBundleId: string;
  sourceFields: readonly string[];
  fieldReasons?: ReadonlyMap<string, readonly AflTradeHpnPrivateSourceUseReason[]>;
  reasons: readonly AflTradeHpnPrivateSourceUseReason[];
  evidenceRefs: readonly AflTradeArtifactRef[];
  effectiveRestriction?: AflTradeHpnPrivateCalculationSourceUseAssessmentContent['effectiveRestriction'];
  evaluatedAt: string;
}): AflTradeHpnPrivateCalculationSourceUseAssessmentContent {
  const reasons = uniqueReasons(input.reasons);
  return {
    schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v1',
    environment: 'non_production',
    purpose: 'private_confirmed_realized_hpn_pav',
    competition: input.competition,
    seasonYear: input.seasonYear,
    valuationScopeKey: input.valuationScopeKey,
    evaluationDecisionId: input.evaluationDecisionId,
    state: 'not_permitted',
    rightsArtifactId: input.rightsArtifactId,
    evidenceBundleId: input.evidenceBundleId,
    fields: input.sourceFields.map((sourceField) => ({
      sourceField,
      state: 'not_permitted',
      reasons: uniqueReasons(input.fieldReasons?.get(sourceField) ?? reasons),
    })),
    reasons,
    evidenceRefs: input.evidenceRefs,
    effectiveRestriction: input.effectiveRestriction ?? null,
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false,
    publicationProhibited: true,
  };
}

function sealAssessment(
  content: AflTradeHpnPrivateCalculationSourceUseAssessmentContent
): AflTradeHpnPrivateCalculationSourceUseAssessment {
  return {
    assessmentId: createAflTradeContentAddress('hpn-private-source-use-assessment', content),
    content,
  };
}

export function assessAflTradeHpnPrivateCalculationSourceUse(
  input: AssessmentInput
): AflTradeHpnPrivateCalculationSourceUseAssessment {
  const rights = aflTradeSourceRightsProposalSchema.parse(input.rights);
  const evidenceBundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(input.evidenceBundle);
  const sourceFields = [...input.sourceFields].sort((left, right) => left.localeCompare(right));
  if (
    sourceFields.length === 0 ||
    new Set(sourceFields).size !== sourceFields.length ||
    sourceFields.some((sourceField) => sourceField.trim() !== sourceField || sourceField === '')
  ) {
    throw new TypeError('HPN source fields must be a non-empty unique canonical set.');
  }

  const evidenceRefs = [input.rightsArtifact];
  const unavailable = (
    reasons: readonly AflTradeHpnPrivateSourceUseReason[],
    fieldReasons?: ReadonlyMap<string, readonly AflTradeHpnPrivateSourceUseReason[]>
  ) =>
    sealAssessment(
      unavailableAssessment({
        competition: input.competition,
        seasonYear: input.seasonYear,
        valuationScopeKey:
          input.admission.state === 'authorized'
            ? input.admission.authority.valuationScopeKey
            : null,
        evaluationDecisionId:
          input.admission.state === 'authorized'
            ? input.admission.authority.decisionId
            : input.admission.decisionId,
        rightsArtifactId: rights.rightsArtifactId,
        evidenceBundleId: evidenceBundle.evidenceBundleId,
        sourceFields,
        fieldReasons,
        reasons,
        evidenceRefs,
        evaluatedAt: input.evaluatedAt,
      })
    );

  if (input.admission.state !== 'authorized') {
    return unavailable(['private_evaluation_not_authorized']);
  }
  evidenceRefs.push(input.admission.authority.evidenceBundleArtifact);
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(input.rightsArtifact, rights) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      input.admission.authority.evidenceBundleArtifact,
      evidenceBundle
    ) ||
    input.admission.authority.evidenceBundleId !== evidenceBundle.evidenceBundleId ||
    !hasExactRightsEvidence(input.rightsArtifact, evidenceBundle.content.sourceRightsEvidenceRefs)
  ) {
    return unavailable(['reviewed_evidence_not_exact']);
  }

  const restrictionIncludes = (values: readonly string[], value: string) =>
    values.length === 0 || values.includes(value);
  const inScope =
    rights.content.scope.competitions.includes(input.competition) &&
    rights.content.scope.seasonRanges.some(
      (range) => input.seasonYear >= range.from && input.seasonYear <= range.to
    ) &&
    restrictionIncludes(rights.content.restrictions.commercial, 'internal-evaluation') &&
    restrictionIncludes(rights.content.restrictions.audience, 'internal');
  if (!inScope) return unavailable(['rights_scope_mismatch']);
  if (!isCurrentForEvaluation(rights, input.evaluatedAt)) {
    return unavailable(['rights_not_current']);
  }
  const effectiveRestriction = isOverbroad(rights)
    ? {
        mode: 'narrowed_private_evaluation' as const,
        baseRightsArtifactId: rights.rightsArtifactId,
        evaluationDecisionId: input.admission.authority.decisionId,
        operation: 'derived_feature_creation' as const,
        commercialContext: 'internal-evaluation' as const,
        audience: 'internal' as const,
        modelTraining: 'blocked' as const,
        publicDerivedOutput: 'blocked' as const,
        publicFactDisplay: 'blocked' as const,
        rawFieldRedistribution: 'blocked' as const,
      }
    : null;

  const reasons: AflTradeHpnPrivateSourceUseReason[] = [];
  if (rights.content.operations.derived_feature_creation !== 'allowed') {
    reasons.push('derived_feature_operation_blocked');
  }
  if (
    rights.content.retention.derivedArtifacts.disposition === 'prohibited' ||
    !rights.content.retention.derivedArtifacts.deleteOnWithdrawal
  ) {
    reasons.push('derived_artifact_retention_blocked');
  }
  if (!rights.content.withdrawalDuties.stopNewDerivedWork) {
    reasons.push('withdrawal_controls_missing');
  }

  const fieldReasons = new Map<string, readonly AflTradeHpnPrivateSourceUseReason[]>();
  for (const sourceField of sourceFields) {
    const field = rights.content.fields.find((candidate) => candidate.sourceField === sourceField);
    if (field === undefined) {
      reasons.push('source_field_not_registered');
      fieldReasons.set(sourceField, ['source_field_not_registered']);
    } else if (field.uses.derived_feature !== 'allowed') {
      reasons.push('derived_source_field_blocked');
      fieldReasons.set(sourceField, ['derived_source_field_blocked']);
    } else {
      fieldReasons.set(sourceField, []);
    }
  }

  const canonicalReasons = uniqueReasons(reasons);
  if (canonicalReasons.length > 0) return unavailable(canonicalReasons, fieldReasons);
  return sealAssessment({
    schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v1',
    environment: 'non_production',
    purpose: 'private_confirmed_realized_hpn_pav',
    competition: input.competition,
    seasonYear: input.seasonYear,
    valuationScopeKey: input.admission.authority.valuationScopeKey,
    evaluationDecisionId: input.admission.authority.decisionId,
    state: 'permitted_private_calculation',
    rightsArtifactId: rights.rightsArtifactId,
    evidenceBundleId: evidenceBundle.evidenceBundleId,
    fields: sourceFields.map((sourceField) => ({
      sourceField,
      state: 'permitted_private_calculation',
      reasons: [],
    })),
    reasons: [],
    evidenceRefs,
    effectiveRestriction,
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false,
    publicationProhibited: true,
  });
}

const sourceFirstContextSchema = z
  .object({
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    sourceArtifact: aflTradeArtifactRefSchema,
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    normalizationFinalizationSha256: aflTradeSha256Schema,
    providerDecodeMapId: z.string().trim().min(1).max(240),
    providerDecodeMapSha256: aflTradeSha256Schema,
    sourceSchemaSha256: aflTradeSha256Schema,
    gateDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gateProposalId: aflTradeContentAddressedIdSchema('gate-proposal'),
    gateDecisionKey: z.string().trim().min(1).max(240),
  })
  .strict();

const sourceFirstAssessmentContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-hpn-private-source-use-assessment/v2'),
    environment: z.literal('non_production'),
    purpose: z.literal('private_confirmed_realized_hpn_pav'),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    valuationScopeKey: z.string().trim().min(1).max(240),
    source: sourceFirstContextSchema,
    state: z.enum(['permitted_private_calculation', 'not_permitted']),
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    fields: z
      .array(
        z
          .object({
            sourceField: z.string().trim().min(1),
            state: z.enum(['permitted_private_calculation', 'not_permitted']),
            reasons: z.array(z.enum(AFL_TRADE_HPN_PRIVATE_SOURCE_USE_REASONS)),
          })
          .strict()
      )
      .min(1),
    reasons: z.array(z.enum(AFL_TRADE_HPN_PRIVATE_SOURCE_USE_REASONS)),
    evidenceRefs: z.tuple([aflTradeArtifactRefSchema]),
    evaluatedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Retained source-use assessment only; current source, field-map review, and database authority remain required. No model training or publication authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const names = content.fields.map((field) => field.sourceField);
    if (
      new Set(names).size !== names.length ||
      names.some((name, index) => index > 0 && names[index - 1].localeCompare(name) >= 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source fields must be a unique canonical set.',
      });
    }
    if (
      [content.source.sourceArtifact, ...content.evidenceRefs].some(
        (ref) => Date.parse(ref.createdAt) > Date.parse(content.evaluatedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source-use evidence must exist before assessment.',
      });
    }
    if (
      content.state === 'permitted_private_calculation' &&
      (content.reasons.length > 0 ||
        content.fields.some((field) => field.state !== content.state || field.reasons.length > 0))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A permitted assessment cannot contain blocked fields or reasons.',
      });
    }
  });

export const aflTradeHpnSourceFirstCalculationSourceUseAssessmentSchema = z
  .object({
    assessmentId: aflTradeContentAddressedIdSchema('hpn-private-source-use-assessment'),
    content: sourceFirstAssessmentContentSchema,
  })
  .strict()
  .superRefine((assessment, context) => {
    addAflTradeContentAddressIssue(
      'hpn-private-source-use-assessment',
      assessment.assessmentId,
      assessment.content,
      context,
      ['assessmentId']
    );
  });

export type AflTradeHpnSourceFirstCalculationSourceUseAssessment = z.infer<
  typeof aflTradeHpnSourceFirstCalculationSourceUseAssessmentSchema
>;

/** Evidence assessment, not authentication of caller-supplied source identifiers. */
export function assessAflTradeHpnSourceFirstCalculationSourceUse(
  input: Readonly<{
    rights: unknown;
    rightsArtifact: AflTradeArtifactRef;
    competition: string;
    seasonYear: number;
    valuationScopeKey: string;
    source: z.input<typeof sourceFirstContextSchema>;
    sourceFields: readonly string[];
    evaluatedAt: string;
  }>
): AflTradeHpnSourceFirstCalculationSourceUseAssessment {
  const rights = aflTradeSourceRightsProposalSchema.parse(input.rights);
  const reasons: AflTradeHpnPrivateSourceUseReason[] = [];
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.rightsArtifact, rights))
    reasons.push('reviewed_evidence_not_exact');
  const permitsRestriction = (values: readonly string[], value: string) =>
    values.length === 0 || values.includes(value);
  if (
    !rights.content.scope.competitions.includes(input.competition) ||
    !rights.content.scope.seasonRanges.some(
      (range) => range.from <= input.seasonYear && input.seasonYear <= range.to
    ) ||
    !permitsRestriction(rights.content.restrictions.commercial, 'internal-evaluation') ||
    !permitsRestriction(rights.content.restrictions.audience, 'internal')
  )
    reasons.push('rights_scope_mismatch');
  if (
    !isCurrentForEvaluation(rights, input.evaluatedAt) ||
    Date.parse(rights.content.proposedAt) > Date.parse(input.evaluatedAt)
  )
    reasons.push('rights_not_current');
  if (rights.content.operations.derived_feature_creation !== 'allowed')
    reasons.push('derived_feature_operation_blocked');
  if (
    rights.content.retention.derivedArtifacts.disposition === 'prohibited' ||
    !rights.content.retention.derivedArtifacts.deleteOnWithdrawal
  )
    reasons.push('derived_artifact_retention_blocked');
  if (!rights.content.withdrawalDuties.stopNewDerivedWork)
    reasons.push('withdrawal_controls_missing');
  const registeredFields = new Map(
    rights.content.fields.map((field) => [field.sourceField, field])
  );
  for (const sourceField of input.sourceFields) {
    const field = registeredFields.get(sourceField);
    if (field === undefined) reasons.push('source_field_not_registered');
    else if (field.uses.derived_feature !== 'allowed') reasons.push('derived_source_field_blocked');
  }
  const canonicalReasons = uniqueReasons(reasons);
  const state = canonicalReasons.length === 0 ? 'permitted_private_calculation' : 'not_permitted';
  const content = sourceFirstAssessmentContentSchema.parse({
    schemaVersion: 'afl-trade-hpn-private-source-use-assessment/v2',
    environment: 'non_production',
    purpose: 'private_confirmed_realized_hpn_pav',
    competition: input.competition,
    seasonYear: input.seasonYear,
    valuationScopeKey: input.valuationScopeKey,
    source: input.source,
    state,
    rightsArtifactId: rights.rightsArtifactId,
    fields: [...input.sourceFields]
      .sort((left, right) => left.localeCompare(right))
      .map((sourceField) => ({ sourceField, state, reasons: canonicalReasons })),
    reasons: canonicalReasons,
    evidenceRefs: [input.rightsArtifact],
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Retained source-use assessment only; current source, field-map review, and database authority remain required. No model training or publication authority.',
  });
  return aflTradeHpnSourceFirstCalculationSourceUseAssessmentSchema.parse({
    assessmentId: createAflTradeContentAddress('hpn-private-source-use-assessment', content),
    content,
  });
}
