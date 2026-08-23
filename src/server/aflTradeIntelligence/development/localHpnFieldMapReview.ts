import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  listAflTradeHpnCandidateSourceFields,
  type AflTradeHpnFieldMapCandidate,
} from '../modeling/hpnFieldMapCandidate';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
  type AflTradeHpnFieldMapReviewDecision,
  type AflTradeHpnProjectedFieldMap,
} from '../modeling/hpnProjectedFieldMap';
import type { AflTradeHpnPrivateCalculationSourceUseAssessment } from '../modeling/hpnPrivateCalculationSourceUse';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '../modeling/postgresHpnProjectedFieldMapAuthority';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { assembleLocalAflTradeHpnLeagueSeasonReviewPacket } from './localHpnLeagueSeasonReviewAssembler';

type CandidateBinding = Readonly<{
  seasonYear: number;
  candidate: AflTradeHpnFieldMapCandidate;
  artifact: AflTradeArtifactRef;
}>;

type AssessmentBinding = Readonly<{
  seasonYear: number;
  assessment: AflTradeHpnPrivateCalculationSourceUseAssessment;
  artifact: AflTradeArtifactRef;
}>;

type ProjectionWriter = Pick<
  PostgresAflTradeHpnProjectedFieldMapAuthority,
  'registerApprovedProjection'
>;

export type LocalAflTradeHpnFieldMapApproval = Readonly<{
  seasonYear: number;
  decision: AflTradeHpnFieldMapReviewDecision;
  decisionArtifact: AflTradeArtifactRef;
  map: AflTradeHpnProjectedFieldMap;
}>;

function sourceFields(candidate: AflTradeHpnFieldMapCandidate): readonly string[] {
  return [...new Set(
    candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
  )].sort();
}

function exactFields(
  candidate: AflTradeHpnFieldMapCandidate,
  assessment: AflTradeHpnPrivateCalculationSourceUseAssessment
): boolean {
  const expected = sourceFields(candidate);
  const actual = assessment.content.fields.map(({ sourceField }) => sourceField).sort();
  return expected.length === actual.length &&
    expected.every((field, index) => field === actual[index]);
}

export async function approveLocalAflTradeHpnFieldMapCandidates(
  input: Readonly<{
    candidates: readonly CandidateBinding[];
    assessments: readonly AssessmentBinding[];
    reviewerId: string;
    reviewedAt: string;
  }>,
  authority: ProjectionWriter
): Promise<readonly LocalAflTradeHpnFieldMapApproval[]> {
  const keys = input.candidates.map(
    ({ seasonYear, candidate }) =>
      `${seasonYear}:${candidate.content.provider}:${candidate.content.capabilityId}:${candidate.content.inputKind}`
  );
  if (
    input.candidates.length === 0 ||
    new Set(keys).size !== keys.length ||
    input.candidates.some(
      ({ seasonYear, candidate, artifact }) =>
        seasonYear < candidate.content.validFromSeason ||
        seasonYear > candidate.content.validThroughSeason ||
        !doesAflTradeArtifactRefMatchCanonicalJson(artifact, candidate)
    )
  ) {
    throw new TypeError('HPN field-map review requires unique exact season candidates.');
  }

  const approvals: LocalAflTradeHpnFieldMapApproval[] = [];
  for (const binding of input.candidates) {
    const matchingAssessments = input.assessments.filter(
      ({ seasonYear, assessment, artifact }) =>
        seasonYear === binding.seasonYear &&
        assessment.content.seasonYear === binding.seasonYear &&
        assessment.content.state === 'permitted_private_calculation' &&
        assessment.content.fields.every(
          ({ state }) => state === 'permitted_private_calculation'
        ) &&
        exactFields(binding.candidate, assessment) &&
        doesAflTradeArtifactRefMatchCanonicalJson(artifact, assessment)
    );
    if (matchingAssessments.length !== 1) {
      throw new TypeError(
        'Each HPN candidate requires one exact permitted source-field assessment.'
      );
    }
    const sourceUse = matchingAssessments[0]!;
    const decision = createAflTradeHpnFieldMapReviewDecision({
      candidate: binding.candidate,
      candidateArtifact: binding.artifact,
      sourceUseAssessment: sourceUse.assessment,
      sourceUseAssessmentArtifact: sourceUse.artifact,
      decision: 'approved',
      reviewerId: input.reviewerId,
      rationale:
        `Approve the exact ${binding.candidate.content.inputKind} projection for ` +
        `${binding.seasonYear} private non-production HPN calculation only.`,
      decidedAt: input.reviewedAt,
    });
    const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(
      decision,
      input.reviewedAt
    );
    const map = createAflTradeHpnProjectedFieldMap({
      candidate: binding.candidate,
      candidateArtifact: binding.artifact,
      decision,
      decisionArtifact,
    });
    const registered = await authority.registerApprovedProjection({
      candidate: binding.candidate,
      candidateArtifact: binding.artifact,
      sourceUseAssessment: sourceUse.assessment,
      sourceUseAssessmentArtifact: sourceUse.artifact,
      reviewDecision: decision,
      decisionArtifact,
      projectedFieldMap: map,
    });
    if (
      registered.fieldMapId !== map.fieldMapId ||
      !doAflTradeArtifactRefsExactlyMatch(
        registered.content.approvalDecisionArtifact,
        decisionArtifact
      )
    ) {
      throw new Error('The durable HPN projection does not match its exact approval.');
    }
    approvals.push({ seasonYear: binding.seasonYear, decision, decisionArtifact, map });
  }
  return approvals;
}

export async function reviewLocalAflTradeHpnFieldMaps(
  client: AflOutcomeSqlClient,
  input: Readonly<{
    valuationScopeKey: string;
    fromSeason: number;
    throughSeason: number;
    reviewerId: string;
  }>
) {
  const assembled = await assembleLocalAflTradeHpnLeagueSeasonReviewPacket(client, input);
  const expectedCount = assembled.eligibilityReports.reduce(
    (count, { report }) =>
      count + report.content.sources.filter(({ selectionState }) => selectionState === 'selected').length,
    0
  );
  if (
    assembled.fieldMapCandidates.length !== expectedCount ||
    assembled.sourceUseAssessments.length !== expectedCount
  ) {
    throw new TypeError('The complete requested HPN field-map review set was not assembled.');
  }
  const approvals = await approveLocalAflTradeHpnFieldMapCandidates(
    {
      candidates: assembled.fieldMapCandidates,
      assessments: assembled.sourceUseAssessments,
      reviewerId: input.reviewerId,
      reviewedAt: assembled.packet.content.createdAt,
    },
    new PostgresAflTradeHpnProjectedFieldMapAuthority(client)
  );
  if (approvals.length !== expectedCount) {
    throw new TypeError('The complete requested HPN field-map review set was not approved.');
  }
  return { packet: assembled.packet, packetArtifact: assembled.packetArtifact, approvals };
}
