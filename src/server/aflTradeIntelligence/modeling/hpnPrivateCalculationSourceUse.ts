import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
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
  return AFL_TRADE_HPN_PRIVATE_SOURCE_USE_REASONS.filter((reason) =>
    reasons.includes(reason)
  );
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
    rights.content.termsEffectiveAt === null
      ? null
      : Date.parse(rights.content.termsEffectiveAt);
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
      (field) =>
        field.uses.model_training !== 'blocked' || field.uses.public_display !== 'blocked'
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
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false,
    publicationProhibited: true,
  };
}

function sealAssessment(
  content: AflTradeHpnPrivateCalculationSourceUseAssessmentContent
): AflTradeHpnPrivateCalculationSourceUseAssessment {
  return {
    assessmentId: createAflTradeContentAddress(
      'hpn-private-source-use-assessment',
      content
    ),
    content,
  };
}

export function assessAflTradeHpnPrivateCalculationSourceUse(
  input: AssessmentInput
): AflTradeHpnPrivateCalculationSourceUseAssessment {
  const rights = aflTradeSourceRightsProposalSchema.parse(input.rights);
  const evidenceBundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(
    input.evidenceBundle
  );
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
    sealAssessment(unavailableAssessment({
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
    }));

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
    !hasExactRightsEvidence(
      input.rightsArtifact,
      evidenceBundle.content.sourceRightsEvidenceRefs
    )
  ) {
    return unavailable(['reviewed_evidence_not_exact']);
  }

  const inScope =
    rights.content.scope.competitions.includes(input.competition) &&
    rights.content.scope.seasonRanges.some(
      (range) => input.seasonYear >= range.from && input.seasonYear <= range.to
    ) &&
    rights.content.restrictions.commercial.includes('internal-evaluation') &&
    rights.content.restrictions.audience.includes('internal');
  if (!inScope) return unavailable(['rights_scope_mismatch']);
  if (!isCurrentForEvaluation(rights, input.evaluatedAt)) {
    return unavailable(['rights_not_current']);
  }
  if (isOverbroad(rights)) return unavailable(['authority_is_overbroad']);

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
    evaluatedAt: input.evaluatedAt,
    publicationEligible: false,
    publicationProhibited: true,
  });
}
