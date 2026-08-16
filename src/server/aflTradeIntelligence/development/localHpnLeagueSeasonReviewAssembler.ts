import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  createAflTradeHpnCalculationEligibilityReport,
  type AflTradeHpnCalculationFieldAssessmentInput,
} from '../modeling/hpnCalculationEligibility';
import {
  listAflTradeHpnCandidateSourceFields,
  type AflTradeHpnFieldMapCandidate,
} from '../modeling/hpnFieldMapCandidate';
import { createAflTradeHpnLeagueSeasonReviewPacket } from '../modeling/hpnLeagueSeasonReviewPacket';
import { aflTradeHpnPavFieldMapSchema } from '../modeling/hpnPavInputContracts';
import { aflTradeHpnPavMethodSchema } from '../modeling/hpnPlayerApproximateValue';
import { assessAflTradeHpnPrivateCalculationSourceUse } from '../modeling/hpnPrivateCalculationSourceUse';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '../valuation/privateReviewedEvidenceEvaluation';
import { createLocalAflTradeHpnPlayerFieldMapCandidate } from './localHpnFieldMapCandidates';
import {
  createSelectedLocalAflTradeHpnFields,
} from './localHpnReviewFieldAssessments';
import {
  loadLocalAflTradeHpnReviewSnapshot,
} from './localHpnReviewSnapshot';

type DocumentBinding = Readonly<{ artifactRef: AflTradeArtifactRef; document: unknown }>;

export async function assembleLocalAflTradeHpnLeagueSeasonReviewPacket(
  client: AflOutcomeSqlClient,
  input: Readonly<{
    valuationScopeKey: string;
    fromSeason: number;
    throughSeason: number;
  }>
) {
  const snapshot = await loadLocalAflTradeHpnReviewSnapshot(client, input);
  if (!snapshot.evidenceCurrent) {
    throw new TypeError('The retained reviewed evidence is not current.');
  }
  const evidenceBundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(
    snapshot.reviewedEvidenceBundle
  );
  const decision = parseAflTradePrivateReviewedEvidenceEvaluationDecision(
    snapshot.reviewedEvaluationDecision
  );
  const admission = createAflTradePrivateReviewedEvidenceEvaluationAdmission(decision);
  if (
    admission.state !== 'authorized' ||
    admission.authority.valuationScopeKey !== input.valuationScopeKey ||
    admission.authority.evidenceBundleId !== evidenceBundle.evidenceBundleId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      admission.authority.evidenceBundleArtifact,
      evidenceBundle
    )
  ) {
    throw new TypeError('The private reviewed-evidence admission failed exact authentication.');
  }

  if (
    (snapshot.methodCount === 1 &&
      (snapshot.method === null || snapshot.methodRegisteredAt === null)) ||
    (snapshot.methodCount !== 1 &&
      (snapshot.method !== null || snapshot.methodRegisteredAt !== null))
  ) {
    throw new TypeError('The local HPN method snapshot is internally inconsistent.');
  }
  const registeredMethod =
    snapshot.methodCount === 1
      ? aflTradeHpnPavMethodSchema.parse(snapshot.method)
      : null;
  if (
    snapshot.methodRegisteredAt !== null &&
    Date.parse(snapshot.methodRegisteredAt) > Date.parse(snapshot.trustedAt)
  ) {
    throw new TypeError('The local HPN method was registered after the trusted snapshot time.');
  }
  const registeredMethodArtifact =
    registeredMethod === null || snapshot.methodRegisteredAt === null
      ? null
      : createAflTradeCanonicalJsonArtifactRef(
          registeredMethod,
          snapshot.methodRegisteredAt
        );

  const authoritySnapshot = {
    schemaVersion: 'afl-trade-local-hpn-review-snapshot/v1',
    valuationScopeKey: input.valuationScopeKey,
    trustedAt: snapshot.trustedAt,
    evidenceBundleId: evidenceBundle.evidenceBundleId,
    evaluationDecisionId: decision.decisionId,
    evidenceCurrent: snapshot.evidenceCurrent,
    hpnMethodCount: snapshot.methodCount,
    hpnMethodId: registeredMethod?.methodId ?? null,
    sources: snapshot.sources.map((source) => ({
      seasonYear: source.seasonYear,
      captureId: source.captureId,
      provider: source.provider,
      capabilityId: source.capabilityId,
      normalizationRunId: source.normalizationRunId,
      rightsArtifactId: source.rightsArtifact.artifactId,
      factualRunId: source.factualRunId,
      hpnResolutionsCurrent: source.hpnResolutionsCurrent,
    })),
    publicationEligible: false,
    publicationProhibited: true,
  } as const;
  const authoritySnapshotArtifact = createAflTradeCanonicalJsonArtifactRef(
    authoritySnapshot,
    snapshot.trustedAt
  );
  const documents = new Map<string, DocumentBinding>();
  const addDocument = (document: unknown, artifactRef: AflTradeArtifactRef) => {
    if (!doesAflTradeArtifactRefMatchCanonicalJson(artifactRef, document)) {
      throw new TypeError('A generated HPN review document failed exact authentication.');
    }
    const retained = documents.get(artifactRef.artifactId);
    if (retained && !doAflTradeArtifactRefsExactlyMatch(retained.artifactRef, artifactRef)) {
      throw new TypeError('HPN review document custody conflicts at one artifact identity.');
    }
    documents.set(artifactRef.artifactId, { artifactRef, document });
  };
  addDocument(authoritySnapshot, authoritySnapshotArtifact);
  addDocument(evidenceBundle, admission.authority.evidenceBundleArtifact);
  if (registeredMethod !== null && registeredMethodArtifact !== null) {
    addDocument(registeredMethod, registeredMethodArtifact);
  }

  const calculationMethod =
    registeredMethod !== null && registeredMethodArtifact !== null
      ? {
          state: 'authenticated' as const,
          method: registeredMethod,
          methodArtifact: registeredMethodArtifact,
        }
      : {
          state: 'missing' as const,
          evidenceRefs: [authoritySnapshotArtifact],
        };

  const fieldMapCandidates: Array<{
    seasonYear: number;
    candidate: AflTradeHpnFieldMapCandidate;
    artifact: AflTradeArtifactRef;
  }> = [];
  const sourceUseAssessments: Array<{
    seasonYear: number;
    assessment: ReturnType<typeof assessAflTradeHpnPrivateCalculationSourceUse>;
    artifact: AflTradeArtifactRef;
  }> = [];
  const eligibilityReports: Array<{
    report: ReturnType<typeof createAflTradeHpnCalculationEligibilityReport>;
    artifact: AflTradeArtifactRef;
  }> = [];

  for (let seasonYear = input.fromSeason; seasonYear <= input.throughSeason; seasonYear += 1) {
    const selected = snapshot.sources.filter((source) => source.seasonYear === seasonYear);
    if (selected.length > 1) {
      throw new TypeError('The local HPN primary source selection is ambiguous.');
    }
    const primary = selected[0];
    let primarySource:
      | {
          selectionState: 'selected';
          normalizationRunId: string;
          provider: string;
          inputKind: 'player_match_stats';
          role: 'primary';
          selectionEvidenceRefs: readonly AflTradeArtifactRef[];
          fields: readonly AflTradeHpnCalculationFieldAssessmentInput[];
        }
      | {
          selectionState: 'missing';
          normalizationRunId: null;
          provider: null;
          inputKind: 'player_match_stats';
          role: 'primary';
          selectionEvidenceRefs: readonly AflTradeArtifactRef[];
        };
    if (!primary) {
      primarySource = {
        selectionState: 'missing', normalizationRunId: null, provider: null,
        inputKind: 'player_match_stats', role: 'primary',
        selectionEvidenceRefs: [authoritySnapshotArtifact],
      };
    } else {
      const decodeMapArtifact = createAflTradeCanonicalJsonArtifactRef(
        primary.providerDecodeMap,
        snapshot.trustedAt
      );
      addDocument(primary.providerDecodeMap, decodeMapArtifact);
      addDocument(primary.rights, primary.rightsArtifact);
      const candidate = createLocalAflTradeHpnPlayerFieldMapCandidate({
        provider: primary.provider,
        seasonYear,
        providerDecodeMap: primary.providerDecodeMap,
        providerDecodeMapArtifact: decodeMapArtifact,
        createdAt: snapshot.trustedAt,
      });
      const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(
        candidate,
        snapshot.trustedAt
      );
      addDocument(candidate, candidateArtifact);
      fieldMapCandidates.push({ seasonYear, candidate, artifact: candidateArtifact });

      const requiredSourceFields = [...new Set(
        candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
      )].sort();
      const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
        rights: primary.rights,
        rightsArtifact: primary.rightsArtifact,
        evidenceBundle,
        admission,
        competition: 'AFLM',
        seasonYear,
        sourceFields: requiredSourceFields,
        evaluatedAt: snapshot.trustedAt,
      });
      const assessmentArtifact = createAflTradeCanonicalJsonArtifactRef(
        assessment,
        snapshot.trustedAt
      );
      addDocument(assessment, assessmentArtifact);
      sourceUseAssessments.push({ seasonYear, assessment, artifact: assessmentArtifact });

      let currentMapArtifact: AflTradeArtifactRef | null = null;
      let currentMap: ReturnType<typeof aflTradeHpnPavFieldMapSchema.parse> | null = null;
      if (primary.hpnFieldMap !== null) {
        currentMap = aflTradeHpnPavFieldMapSchema.parse(primary.hpnFieldMap);
        if (primary.hpnFieldMapCreatedAt === null) {
          throw new TypeError('A current HPN field map is missing its custody time.');
        }
        currentMapArtifact = createAflTradeCanonicalJsonArtifactRef(
          currentMap,
          primary.hpnFieldMapCreatedAt
        );
        addDocument(currentMap, currentMapArtifact);
      }
      const fields = createSelectedLocalAflTradeHpnFields({
        candidate,
        candidateArtifact,
        decodeMapArtifact,
        sourceUseAssessment: assessment,
        sourceUseAssessmentArtifact: assessmentArtifact,
        currentMap,
        currentMapArtifact,
        factualRunId: primary.factualRunId,
        hpnResolutionsCurrent: primary.hpnResolutionsCurrent,
        authoritySnapshotArtifact,
      });
      primarySource = {
        selectionState: 'selected', normalizationRunId: primary.normalizationRunId,
        provider: primary.provider, inputKind: 'player_match_stats', role: 'primary',
        selectionEvidenceRefs: [authoritySnapshotArtifact], fields,
      };
    }

    const report = createAflTradeHpnCalculationEligibilityReport({
      valuationScopeKey: input.valuationScopeKey,
      seasonYear,
      method: calculationMethod,
      authoritySnapshotArtifact,
      sources: [
        {
          selectionState: 'missing', normalizationRunId: null, provider: null,
          inputKind: 'completed_match_result', role: null,
          selectionEvidenceRefs: [authoritySnapshotArtifact],
        },
        primarySource,
        {
          selectionState: 'missing', normalizationRunId: null, provider: null,
          inputKind: 'player_match_stats', role: 'corroborating',
          selectionEvidenceRefs: [authoritySnapshotArtifact],
        },
      ],
      evaluatedAt: snapshot.trustedAt,
    });
    const artifact = createAflTradeCanonicalJsonArtifactRef(report, snapshot.trustedAt);
    addDocument(report, artifact);
    eligibilityReports.push({ report, artifact });
  }

  const packet = createAflTradeHpnLeagueSeasonReviewPacket({
    valuationScopeKey: input.valuationScopeKey,
    fromSeason: input.fromSeason,
    throughSeason: input.throughSeason,
    reports: eligibilityReports.map(({ report, artifact }) => ({
      eligibilityReport: report,
      eligibilityReportArtifact: artifact,
    })),
    createdAt: snapshot.trustedAt,
  });
  const packetArtifact = createAflTradeCanonicalJsonArtifactRef(packet, snapshot.trustedAt);
  addDocument(packet, packetArtifact);
  return {
    packet,
    packetArtifact,
    eligibilityReports,
    fieldMapCandidates,
    sourceUseAssessments,
    documents: [...documents.values()].sort((left, right) =>
      left.artifactRef.artifactId.localeCompare(right.artifactRef.artifactId)
    ),
  };
}
