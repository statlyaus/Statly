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
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeHpnFieldMapCandidateSchema,
  type AflTradeHpnFieldMapCandidate,
} from './hpnFieldMapCandidate';

export const AFL_TRADE_HPN_FIELD_MAP_REVIEW_DECISION_SCHEMA_VERSION =
  'afl-trade-hpn-field-map-review-decision/v1' as const;
export const AFL_TRADE_HPN_PROJECTED_FIELD_MAP_SCHEMA_VERSION =
  'afl-trade-hpn-projected-field-map/v1' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const decisionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_FIELD_MAP_REVIEW_DECISION_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    purpose: z.literal('private_confirmed_realized_hpn_pav_review'),
    candidateId: aflTradeContentAddressedIdSchema('hpn-field-map-candidate'),
    candidateArtifact: aflTradeArtifactRefSchema,
    decision: z.enum(['approved', 'rejected']),
    reviewerId: publicIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
    decidedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private non-production field-map review only; this decision grants no factual release, model training, publication, production, activation, or live-capture authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    if (Date.parse(content.candidateArtifact.createdAt) > Date.parse(content.decidedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['candidateArtifact'],
        message: 'The reviewed candidate must exist before its decision.',
      });
    }
  });

export const aflTradeHpnFieldMapReviewDecisionSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('hpn-field-map-review-decision'),
    content: decisionContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'hpn-field-map-review-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

const projectedMapContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_PROJECTED_FIELD_MAP_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    purpose: z.literal('private_confirmed_realized_hpn_pav'),
    competition: z.literal('AFLM'),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    sourceSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    inputKind: z.enum(['completed_match_result', 'player_match_stats']),
    validFromSeason: z.number().int().min(1998).max(2200),
    validThroughSeason: z.number().int().min(1998).max(2200),
    candidateId: aflTradeContentAddressedIdSchema('hpn-field-map-candidate'),
    candidateArtifact: aflTradeArtifactRefSchema,
    approvalDecisionId: aflTradeContentAddressedIdSchema(
      'hpn-field-map-review-decision'
    ),
    approvalDecisionArtifact: aflTradeArtifactRefSchema,
    semanticBindings: aflTradeHpnFieldMapCandidateSchema.shape.content.shape.semanticBindings,
    completionRule: aflTradeHpnFieldMapCandidateSchema.shape.content.shape.completionRule,
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private non-production projection map only; it grants no factual release, model training, publication, production, activation, or live-capture authority.'
    ),
  })
  .strict();

export const aflTradeHpnProjectedFieldMapSchema = z
  .object({
    fieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    content: projectedMapContentSchema,
  })
  .strict()
  .superRefine((fieldMap, context) => {
    addAflTradeContentAddressIssue(
      'hpn-pav-field-map',
      fieldMap.fieldMapId,
      fieldMap.content,
      context,
      ['fieldMapId']
    );
  });

export type AflTradeHpnFieldMapReviewDecision = z.infer<
  typeof aflTradeHpnFieldMapReviewDecisionSchema
>;
export type AflTradeHpnProjectedFieldMap = z.infer<
  typeof aflTradeHpnProjectedFieldMapSchema
>;

export function createAflTradeHpnFieldMapReviewDecision(input: {
  readonly candidate: unknown;
  readonly candidateArtifact: AflTradeArtifactRef;
  readonly decision: 'approved' | 'rejected';
  readonly reviewerId: string;
  readonly rationale: string;
  readonly decidedAt: string;
}): AflTradeHpnFieldMapReviewDecision {
  const candidate = aflTradeHpnFieldMapCandidateSchema.parse(input.candidate);
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.candidateArtifact, candidate)) {
    throw new TypeError('An exact candidate artifact is required for HPN field-map review.');
  }
  const content = decisionContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_FIELD_MAP_REVIEW_DECISION_SCHEMA_VERSION,
    environment: 'non_production',
    purpose: 'private_confirmed_realized_hpn_pav_review',
    candidateId: candidate.candidateId,
    candidateArtifact: input.candidateArtifact,
    decision: input.decision,
    reviewerId: input.reviewerId,
    rationale: input.rationale,
    decidedAt: input.decidedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private non-production field-map review only; this decision grants no factual release, model training, publication, production, activation, or live-capture authority.',
  });
  return aflTradeHpnFieldMapReviewDecisionSchema.parse({
    decisionId: createAflTradeContentAddress('hpn-field-map-review-decision', content),
    content,
  });
}

export function createAflTradeHpnProjectedFieldMap(input: {
  readonly candidate: unknown;
  readonly candidateArtifact: AflTradeArtifactRef;
  readonly decision: unknown;
  readonly decisionArtifact: AflTradeArtifactRef;
}): AflTradeHpnProjectedFieldMap {
  const candidate: AflTradeHpnFieldMapCandidate =
    aflTradeHpnFieldMapCandidateSchema.parse(input.candidate);
  const decision = aflTradeHpnFieldMapReviewDecisionSchema.parse(input.decision);
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(input.candidateArtifact, candidate) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.decisionArtifact, decision) ||
    decision.content.decision !== 'approved' ||
    decision.content.candidateId !== candidate.candidateId ||
    !doAflTradeArtifactRefsExactlyMatch(
      decision.content.candidateArtifact,
      input.candidateArtifact
    )
  ) {
    throw new TypeError(
      'A projected HPN field map requires the exact candidate and its approved review decision.'
    );
  }
  const content = projectedMapContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_PROJECTED_FIELD_MAP_SCHEMA_VERSION,
    environment: 'non_production',
    purpose: 'private_confirmed_realized_hpn_pav',
    competition: candidate.content.competition,
    provider: candidate.content.provider,
    capabilityId: candidate.content.capabilityId,
    sourceSchemaSha256: candidate.content.sourceSchemaSha256,
    inputKind: candidate.content.inputKind,
    validFromSeason: candidate.content.validFromSeason,
    validThroughSeason: candidate.content.validThroughSeason,
    candidateId: candidate.candidateId,
    candidateArtifact: input.candidateArtifact,
    approvalDecisionId: decision.decisionId,
    approvalDecisionArtifact: input.decisionArtifact,
    semanticBindings: candidate.content.semanticBindings,
    completionRule: candidate.content.completionRule,
    createdAt: decision.content.decidedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private non-production projection map only; it grants no factual release, model training, publication, production, activation, or live-capture authority.',
  });
  return aflTradeHpnProjectedFieldMapSchema.parse({
    fieldMapId: createAflTradeContentAddress('hpn-pav-field-map', content),
    content,
  });
}
