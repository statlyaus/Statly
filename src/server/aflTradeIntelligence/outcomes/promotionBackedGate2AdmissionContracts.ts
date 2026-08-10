import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  resolveAflTradeGateEligibility,
  type AflTradeGateDecisionLedger,
} from '../governance/gateDecisionLedger';
import type { AflTradeGovernedArtifactRef } from '../governance/gateDecisionTypes';
import {
  parseAflTradePromotionBackedFactualLineage,
  type AflTradePromotionBackedFactualLineage,
} from './promotionBackedFactualLineageContracts';

export const AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_SCHEMA_VERSION =
  'afl-trade-corpus-factual-lineage-admission/v1' as const;
export const AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_AUTHORITY_BOUNDARY =
  'gate_2_corpus_lineage_only_no_model_grade_publication_or_activation_authority' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const boundedIdSchema = z.string().trim().min(1).max(1_000);

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    scopeKey: boundedIdSchema,
    competition: z.string().trim().min(1).max(40),
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
    admittedAt: instantSchema,
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    lineageSha256: aflTradeSha256Schema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    gate2DecisionKey: boundedIdSchema,
    gate2ProposalId: aflTradeContentAddressedIdSchema('gate-proposal'),
    gate2DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gate2DecisionVersion: z.number().int().positive(),
    gateLedgerRevision: z.number().int().positive(),
    gate2EffectiveAt: instantSchema,
    gate2RevalidateAt: instantSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    if (admission.lineageId !== `corpus-factual-lineage:${admission.lineageSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['lineageSha256'],
        message: 'Admission lineage content address mismatch.',
      });
    }
    if (
      admission.validThroughSeason < admission.validFromSeason ||
      Date.parse(admission.gate2EffectiveAt) > Date.parse(admission.admittedAt) ||
      Date.parse(admission.gate2RevalidateAt) <= Date.parse(admission.admittedAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Gate 2 admission chronology is invalid.' });
    }
  });

export const aflTradePromotionBackedGate2AdmissionSchema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    content: contentSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    addAflTradeContentAddressIssue(
      'corpus-factual-lineage-admission',
      admission.admissionId,
      admission.content,
      context,
      ['admissionId']
    );
  });

export type AflTradePromotionBackedGate2Admission = z.infer<
  typeof aflTradePromotionBackedGate2AdmissionSchema
>;

export function createAflTradePromotionBackedGate2DecisionKey(
  lineage: AflTradePromotionBackedFactualLineage
): string {
  return `gate2:${parseAflTradePromotionBackedFactualLineage(lineage).lineageId}`;
}

export function createAflTradePromotionBackedGate2AffectedArtifacts(
  input: AflTradePromotionBackedFactualLineage
): AflTradeGovernedArtifactRef[] {
  const lineage = parseAflTradePromotionBackedFactualLineage(input);
  return [
    { kind: 'corpus_manifest', artifactId: lineage.content.corpusId },
    { kind: 'factual_release', artifactId: lineage.content.factualReleaseId },
    { kind: 'factual_release_candidate', artifactId: lineage.content.factualCandidateId },
    { kind: 'corpus_factual_lineage', artifactId: lineage.lineageId },
  ];
}

function exactArtifacts(
  actual: readonly AflTradeGovernedArtifactRef[],
  expected: readonly AflTradeGovernedArtifactRef[]
): boolean {
  const sort = (values: readonly AflTradeGovernedArtifactRef[]) =>
    [...values].sort((left, right) =>
      `${left.kind}\0${left.artifactId}`.localeCompare(`${right.kind}\0${right.artifactId}`)
    );
  return canonicalizeAflTradeJson(sort(actual)) === canonicalizeAflTradeJson(sort(expected));
}

function exactScope(
  lineage: AflTradePromotionBackedFactualLineage,
  scope: AflTradeGateDecisionLedger['decisions'][number]['content']['scope']
): boolean {
  const expectedDimensions = [
    { name: 'competition', values: [lineage.content.competition] },
    { name: 'valid_from_season', values: [String(lineage.content.validFromSeason)] },
    { name: 'valid_through_season', values: [String(lineage.content.validThroughSeason)] },
  ];
  return (
    scope.scopeKey === lineage.content.scopeKey &&
    canonicalizeAflTradeJson(scope.dimensions) === canonicalizeAflTradeJson(expectedDimensions)
  );
}

export function createAflTradePromotionBackedGate2Admission(input: {
  lineage: unknown;
  ledger: AflTradeGateDecisionLedger;
  ledgerRevision: number;
  evaluatedAt: string;
}): AflTradePromotionBackedGate2Admission {
  const lineage = parseAflTradePromotionBackedFactualLineage(input.lineage);
  if (input.ledgerRevision !== input.ledger.decisions.length || input.ledgerRevision < 1) {
    throw new TypeError('Gate 2 admission requires the exact authenticated ledger revision.');
  }
  const decisionKey = createAflTradePromotionBackedGate2DecisionKey(lineage);
  const resolution = resolveAflTradeGateEligibility(input.ledger, {
    gate: 'gate_2_corpus_lineage',
    decisionKey,
    environment: lineage.content.environment,
    evaluatedAt: input.evaluatedAt,
  });
  if (resolution.status !== 'mechanically_eligible' || resolution.decision === null) {
    throw new TypeError('The exact Gate 2 decision is not currently eligible.');
  }
  const decision = resolution.decision;
  const proposal = input.ledger.proposals.find(
    ({ proposalId }) => proposalId === decision.content.proposalId
  );
  const expectedArtifacts = createAflTradePromotionBackedGate2AffectedArtifacts(lineage);
  if (
    proposal === undefined ||
    !exactArtifacts(decision.content.affectedArtifacts, expectedArtifacts) ||
    !exactArtifacts(proposal.content.affectedArtifacts, expectedArtifacts) ||
    !exactScope(lineage, decision.content.scope) ||
    !exactScope(lineage, proposal.content.scope)
  ) {
    throw new TypeError('Gate 2 scope or affected artifact set does not match the exact lineage.');
  }
  if (
    Date.parse(proposal.content.proposedAt) < Date.parse(lineage.content.createdAt) ||
    decision.content.decidedAt === null ||
    decision.content.effectiveAt === null ||
    decision.content.revalidateAt === null ||
    Date.parse(decision.content.decidedAt) < Date.parse(proposal.content.proposedAt) ||
    Date.parse(decision.content.decidedAt) > Date.parse(input.evaluatedAt)
  ) {
    throw new TypeError('Gate 2 decision chronology does not follow immutable lineage creation.');
  }
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: lineage.content.environment,
    scopeKey: lineage.content.scopeKey,
    competition: lineage.content.competition,
    validFromSeason: lineage.content.validFromSeason,
    validThroughSeason: lineage.content.validThroughSeason,
    admittedAt: input.evaluatedAt,
    lineageId: lineage.lineageId,
    lineageSha256: lineage.lineageId.split(':')[1],
    corpusId: lineage.content.corpusId,
    factualReleaseId: lineage.content.factualReleaseId,
    factualCandidateId: lineage.content.factualCandidateId,
    sourceMemberSetSha256: lineage.content.sourceMemberSetSha256,
    canonicalMemberSetSha256: lineage.content.canonicalMemberSetSha256,
    gate2DecisionKey: decisionKey,
    gate2ProposalId: proposal.proposalId,
    gate2DecisionId: decision.decisionId,
    gate2DecisionVersion: decision.content.version,
    gateLedgerRevision: input.ledgerRevision,
    gate2EffectiveAt: decision.content.effectiveAt,
    gate2RevalidateAt: decision.content.revalidateAt,
  });
  return aflTradePromotionBackedGate2AdmissionSchema.parse({
    admissionId: createAflTradeContentAddress('corpus-factual-lineage-admission', content),
    content,
  });
}

export function parseAflTradePromotionBackedGate2Admission(
  input: unknown
): AflTradePromotionBackedGate2Admission {
  return aflTradePromotionBackedGate2AdmissionSchema.parse(input);
}
