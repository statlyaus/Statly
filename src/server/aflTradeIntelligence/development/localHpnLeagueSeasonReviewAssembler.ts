import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  createAflTradeHpnCalculationEligibilityReport,
} from '../modeling/hpnCalculationEligibility';
import {
  aflTradeHpnFieldMapCandidateSchema,
  listAflTradeHpnCandidateSourceFields,
  type AflTradeHpnFieldMapCandidate,
} from '../modeling/hpnFieldMapCandidate';
import { createAflTradeHpnLeagueSeasonReviewPacket } from '../modeling/hpnLeagueSeasonReviewPacket';
import {
  aflTradeHpnFieldMapReviewDecisionSchema,
  aflTradeHpnProjectedFieldMapSchema,
  createAflTradeHpnProjectedFieldMap,
} from '../modeling/hpnProjectedFieldMap';
import { aflTradeHpnPavMethodSchema } from '../modeling/hpnPlayerApproximateValue';
import { assessAflTradeHpnPrivateCalculationSourceUse } from '../modeling/hpnPrivateCalculationSourceUse';
import type { AflTradeHpnPrivateCalculationSourceUseAssessment } from '../modeling/hpnPrivateCalculationSourceUse';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateReviewedEvidenceBundleSchema,
  createAflTradePrivateReviewedEvidenceEvaluationAdmission,
  parseAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '../valuation/privateReviewedEvidenceEvaluation';
import {
  createLocalAflTradeHpnCompletedResultFieldMapCandidate,
  createLocalAflTradeHpnPlayerFieldMapCandidate,
} from './localHpnFieldMapCandidates';
import {
  createSelectedLocalAflTradeHpnFields,
} from './localHpnReviewFieldAssessments';
import {
  loadLocalAflTradeHpnReviewSnapshot,
  type LocalAflTradeHpnReviewSnapshot,
} from './localHpnReviewSnapshot';

type DocumentBinding = Readonly<{ artifactRef: AflTradeArtifactRef; document: unknown }>;

function authenticateProjectedFieldMap(value: unknown) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const projection = value as Record<string, unknown>;
  const candidate = aflTradeHpnFieldMapCandidateSchema.parse(projection.candidate);
  const candidateArtifact = aflTradeArtifactRefSchema.parse(projection.candidateArtifact);
  const decision = aflTradeHpnFieldMapReviewDecisionSchema.parse(projection.decision);
  const decisionArtifact = aflTradeArtifactRefSchema.parse(projection.decisionArtifact);
  const sourceUseAssessment =
    projection.sourceUseAssessment as AflTradeHpnPrivateCalculationSourceUseAssessment;
  const sourceUseAssessmentArtifact = aflTradeArtifactRefSchema.parse(
    projection.sourceUseAssessmentArtifact
  );
  const map = aflTradeHpnProjectedFieldMapSchema.parse(projection.map);
  const reconstructed = createAflTradeHpnProjectedFieldMap({
    candidate,
    candidateArtifact,
    decision,
    decisionArtifact,
  });
  if (
    canonicalizeAflTradeJson(reconstructed) !== canonicalizeAflTradeJson(map) ||
    sourceUseAssessment.assessmentId !== createAflTradeContentAddress(
      'hpn-private-source-use-assessment',
      sourceUseAssessment.content
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      sourceUseAssessmentArtifact,
      sourceUseAssessment
    ) ||
    decision.content.sourceUseAssessmentId !== sourceUseAssessment.assessmentId ||
    !doAflTradeArtifactRefsExactlyMatch(
      decision.content.sourceUseAssessmentArtifact,
      sourceUseAssessmentArtifact
    )
  ) {
    throw new TypeError('The current projected HPN field map has inexact review ancestry.');
  }
  return {
    candidate,
    candidateArtifact,
    decision,
    decisionArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    map,
    mapArtifact: createAflTradeCanonicalJsonArtifactRef(map, map.content.createdAt),
  };
}

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

  type SnapshotSource = LocalAflTradeHpnReviewSnapshot['sources'][number];
  const requireAtMostOne = (
    values: readonly SnapshotSource[],
    description: string
  ): SnapshotSource | undefined => {
    if (values.length > 1) {
      throw new TypeError(`The local HPN ${description} source selection is ambiguous.`);
    }
    return values[0];
  };

  const prepareResultSource = (source: SnapshotSource | undefined, seasonYear: number) => {
    if (!source) {
      return {
        selectionState: 'missing' as const,
        normalizationRunId: null,
        provider: null,
        inputKind: 'completed_match_result' as const,
        role: null,
        selectionEvidenceRefs: [authoritySnapshotArtifact],
      };
    }
    addDocument(source.rights, source.rightsArtifact);
    const retained = authenticateProjectedFieldMap(source.hpnResultProjection);
    const provisionalDecodeMapArtifact = createAflTradeCanonicalJsonArtifactRef(
      source.providerDecodeMap,
      snapshot.trustedAt
    );
    const candidate = retained?.candidate ??
      createLocalAflTradeHpnCompletedResultFieldMapCandidate({
        seasonYear,
        providerDecodeMap: source.providerDecodeMap,
        providerDecodeMapArtifact: provisionalDecodeMapArtifact,
        createdAt: snapshot.trustedAt,
      });
    const candidateArtifact = retained?.candidateArtifact ??
      createAflTradeCanonicalJsonArtifactRef(candidate, snapshot.trustedAt);
    const decodeMapArtifact = candidate.content.providerDecodeMapArtifact;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(
      decodeMapArtifact,
      source.providerDecodeMap
    )) {
      throw new TypeError('The result projection does not bind the current decode map.');
    }
    addDocument(source.providerDecodeMap, decodeMapArtifact);
    addDocument(candidate, candidateArtifact);
    if (retained) {
      addDocument(retained.sourceUseAssessment, retained.sourceUseAssessmentArtifact);
      addDocument(retained.decision, retained.decisionArtifact);
      addDocument(retained.map, retained.mapArtifact);
    }
    fieldMapCandidates.push({ seasonYear, candidate, artifact: candidateArtifact });
    const sourceFields = [...new Set(
      candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
    )].sort();
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      rights: source.rights,
      rightsArtifact: source.rightsArtifact,
      evidenceBundle,
      admission,
      competition: 'AFLM',
      seasonYear,
      sourceFields,
      evaluatedAt: snapshot.trustedAt,
    });
    const assessmentArtifact = createAflTradeCanonicalJsonArtifactRef(
      assessment,
      snapshot.trustedAt
    );
    addDocument(assessment, assessmentArtifact);
    sourceUseAssessments.push({ seasonYear, assessment, artifact: assessmentArtifact });
    return {
      selectionState: 'selected' as const,
      normalizationRunId: source.normalizationRunId,
      provider: source.provider,
      inputKind: 'completed_match_result' as const,
      role: null,
      selectionEvidenceRefs: [authoritySnapshotArtifact],
      fields: createSelectedLocalAflTradeHpnFields({
        candidate,
        candidateArtifact,
        decodeMapArtifact,
        sourceUseAssessment: assessment,
        sourceUseAssessmentArtifact: assessmentArtifact,
        currentMap: retained?.map ?? null,
        currentMapArtifact: retained?.mapArtifact ?? null,
        factualRunId: null,
        hpnResolutionsCurrent: false,
        authoritySnapshotArtifact,
      }),
    };
  };

  const preparePlayerSource = (
    source: SnapshotSource | undefined,
    seasonYear: number,
    role: 'primary' | 'corroborating'
  ) => {
    if (!source) {
      return {
        selectionState: 'missing' as const,
        normalizationRunId: null,
        provider: null,
        inputKind: 'player_match_stats' as const,
        role,
        selectionEvidenceRefs: [authoritySnapshotArtifact],
      };
    }
    addDocument(source.rights, source.rightsArtifact);
    const retained = authenticateProjectedFieldMap(source.hpnPlayerProjection);
    const provisionalDecodeMapArtifact = createAflTradeCanonicalJsonArtifactRef(
      source.providerDecodeMap,
      snapshot.trustedAt
    );
    const candidate = retained?.candidate ?? createLocalAflTradeHpnPlayerFieldMapCandidate({
      provider: source.provider,
      seasonYear,
      providerDecodeMap: source.providerDecodeMap,
      providerDecodeMapArtifact: provisionalDecodeMapArtifact,
      createdAt: snapshot.trustedAt,
    });
    const candidateArtifact = retained?.candidateArtifact ??
      createAflTradeCanonicalJsonArtifactRef(candidate, snapshot.trustedAt);
    const decodeMapArtifact = candidate.content.providerDecodeMapArtifact;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(
      decodeMapArtifact,
      source.providerDecodeMap
    )) {
      throw new TypeError('The player projection does not bind the current decode map.');
    }
    addDocument(source.providerDecodeMap, decodeMapArtifact);
    addDocument(candidate, candidateArtifact);
    if (retained) {
      addDocument(retained.sourceUseAssessment, retained.sourceUseAssessmentArtifact);
      addDocument(retained.decision, retained.decisionArtifact);
      addDocument(retained.map, retained.mapArtifact);
    }
    fieldMapCandidates.push({ seasonYear, candidate, artifact: candidateArtifact });
    const sourceFields = [...new Set(
      candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
    )].sort();
    const assessment = assessAflTradeHpnPrivateCalculationSourceUse({
      rights: source.rights,
      rightsArtifact: source.rightsArtifact,
      evidenceBundle,
      admission,
      competition: 'AFLM',
      seasonYear,
      sourceFields,
      evaluatedAt: snapshot.trustedAt,
    });
    const assessmentArtifact = createAflTradeCanonicalJsonArtifactRef(
      assessment,
      snapshot.trustedAt
    );
    addDocument(assessment, assessmentArtifact);
    sourceUseAssessments.push({ seasonYear, assessment, artifact: assessmentArtifact });
    return {
      selectionState: 'selected' as const,
      normalizationRunId: source.normalizationRunId,
      provider: source.provider,
      inputKind: 'player_match_stats' as const,
      role,
      selectionEvidenceRefs: [authoritySnapshotArtifact],
      fields: createSelectedLocalAflTradeHpnFields({
        candidate,
        candidateArtifact,
        decodeMapArtifact,
        sourceUseAssessment: assessment,
        sourceUseAssessmentArtifact: assessmentArtifact,
        currentMap: retained?.map ?? null,
        currentMapArtifact: retained?.mapArtifact ?? null,
        factualRunId: source.factualRunId,
        hpnResolutionsCurrent: source.hpnResolutionsCurrent,
        authoritySnapshotArtifact,
      }),
    };
  };

  for (let seasonYear = input.fromSeason; seasonYear <= input.throughSeason; seasonYear += 1) {
    const selected = snapshot.sources.filter((source) => source.seasonYear === seasonYear);
    const resultSource = prepareResultSource(
      requireAtMostOne(
        selected.filter(({ capabilityId }) => capabilityId === 'afl-tables-results'),
        'completed-results'
      ),
      seasonYear
    );
    const primarySource = preparePlayerSource(
      requireAtMostOne(
        selected.filter(
          ({ provider, capabilityId }) =>
            provider === 'afl_tables' && capabilityId === 'afl-tables-player-stats'
        ),
        'primary player-stat'
      ),
      seasonYear,
      'primary'
    );
    const corroboratingSource = preparePlayerSource(
      requireAtMostOne(
        selected.filter(
          ({ provider, capabilityId }) =>
            provider === 'official_afl' && capabilityId === 'official-afl-player-stats'
        ),
        'corroborating player-stat'
      ),
      seasonYear,
      'corroborating'
    );

    const report = createAflTradeHpnCalculationEligibilityReport({
      valuationScopeKey: input.valuationScopeKey,
      seasonYear,
      method: calculationMethod,
      authoritySnapshotArtifact,
      sources: [
        resultSource,
        primarySource,
        corroboratingSource,
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
