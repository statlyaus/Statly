import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { aflTradeCorpusFactualLineageSchema } from '../artifacts/valuationDatasetAdmissionContracts';
import {
  loadAuthenticatedAflTradeCompletedPlayerModelRunChain,
  type AflTradeAuthenticatedCompletedPlayerModelRunChain,
} from '../modeling/postgresAdmittedModelRunAuthority';
import {
  loadAuthenticatedAflTradeGovernedPickPavCandidateChain,
  type AflTradeGovernedPickPavCandidateChain,
} from '../modeling/postgresGovernedPickPavModelCandidateRegistry';
import { aflTradeFactualReleaseCandidateSchema } from '../outcomes/factualReleaseCandidateContracts';
import { aflDraftTradeOutcomeAnyReleaseManifestSchema } from '../outcomes/outcomeReleaseContracts';
import { aflTradePromotionBackedFactualCandidateSchema } from '../outcomes/promotionBackedFactualReleaseContracts';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  loadCurrentAflTradeGateAuthority,
  type AflTradeCurrentGateAuthority,
} from './postgresCurrentGateAuthority';
import { parseAflTradePrivateValuationEvaluationDecision } from './privateValuationEvaluationDecision';
import { privateGovernedPickEvidenceAdmissionAnySchema } from './privateGovernedPickEvidenceV3';
import { privateGovernedPlayerEvidenceAdmissionSchema } from './privateGovernedPlayerEvidence';
import {
  aflTradePrivateValuationAuthorityBundleV3Schema,
  type AflTradePrivateValuationAuthorityBundleV3,
} from './privateValuationAuthorityBundleV3';
import {
  aflTradePrivateValuationEvidenceBundleSchema,
  type AflTradePrivateValuationEvidenceBundle,
} from './privateValuationEvidenceBundle';
import { aflTradePrivateValuationTradeEvidenceCorrespondenceSchema } from './privateValuationTradeEvidenceCorrespondence';
import { aflTradeValuationSourceQualificationReportSchema } from './valuationSourceQualificationReport';

interface DocumentRow {
  document: unknown;
}

interface FactualRootRow {
  release_document: unknown;
  release_created_at: Date | string;
  candidate_document: unknown;
  qualification_document: unknown;
  private_decision_document: unknown;
  lineage_document: unknown | null;
}

interface AssetRow {
  asset_version_id: string;
  asset_key: string;
}

type FactualCandidate =
  | ReturnType<typeof aflTradeFactualReleaseCandidateSchema.parse>
  | ReturnType<typeof aflTradePromotionBackedFactualCandidateSchema.parse>;

interface AuthenticatedFactualRoot {
  release: ReturnType<typeof aflDraftTradeOutcomeAnyReleaseManifestSchema.parse>;
  candidate: FactualCandidate;
  qualification: ReturnType<typeof aflTradeValuationSourceQualificationReportSchema.parse>;
  privateDecision: ReturnType<typeof parseAflTradePrivateValuationEvaluationDecision>;
  lineage: ReturnType<typeof aflTradeCorpusFactualLineageSchema.parse> | null;
  assets: readonly AssetRow[];
}

export interface AflTradeAuthenticatedPrivateValuationAuthorityV3Chain {
  bundle: AflTradePrivateValuationAuthorityBundleV3;
  evidenceBundle: AflTradePrivateValuationEvidenceBundle;
  correspondence: ReturnType<
    typeof aflTradePrivateValuationTradeEvidenceCorrespondenceSchema.parse
  >;
  factualRoots: {
    evaluatedTrade: AuthenticatedFactualRoot;
    evaluationEvidence: AuthenticatedFactualRoot;
  };
  assetAdmissions: ReadonlyMap<
    string,
    | ReturnType<typeof privateGovernedPlayerEvidenceAdmissionSchema.parse>
    | ReturnType<typeof privateGovernedPickEvidenceAdmissionAnySchema.parse>
  >;
  modelAuthorities: {
    atTrade: {
      player: AflTradeAuthenticatedCompletedPlayerModelRunChain;
      pick: AflTradeGovernedPickPavCandidateChain;
    };
    currentRemaining: {
      player: AflTradeAuthenticatedCompletedPlayerModelRunChain;
      pick: AflTradeGovernedPickPavCandidateChain;
    };
  };
  gates: readonly AflTradeCurrentGateAuthority[];
  validThrough: string;
}

function parseCandidate(input: unknown): FactualCandidate {
  const legacy = aflTradeFactualReleaseCandidateSchema.safeParse(input);
  if (legacy.success) return legacy.data;
  return aflTradePromotionBackedFactualCandidateSchema.parse(input);
}

function exactReferences(
  left: readonly AflTradeArtifactRef[],
  right: readonly AflTradeArtifactRef[]
): boolean {
  const leftSorted = [...left].sort((one, two) => one.artifactId.localeCompare(two.artifactId));
  const rightSorted = [...right].sort((one, two) => one.artifactId.localeCompare(two.artifactId));
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((reference, index) =>
      doAflTradeArtifactRefsExactlyMatch(reference, rightSorted[index]!)
    )
  );
}

async function loadExactBytes(
  repository: AflTradeImmutableArtifactRepository,
  maximumArtifactBytes: number,
  reference: AflTradeArtifactRef
): Promise<Uint8Array> {
  const retained = await repository.loadExact(reference, maximumArtifactBytes);
  if (
    retained === null ||
    !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference)
  ) {
    throw new TypeError('Private valuation v3 artifact custody failed exact readback.');
  }
  return retained.bytes;
}

async function loadCanonicalArtifact<T>(input: {
  repository: AflTradeImmutableArtifactRepository;
  maximumArtifactBytes: number;
  reference: AflTradeArtifactRef;
  parse: (value: unknown) => T;
}): Promise<T> {
  const bytes = await loadExactBytes(
    input.repository,
    input.maximumArtifactBytes,
    input.reference
  );
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TypeError('Private valuation v3 canonical artifact is not JSON.');
  }
  const parsed = input.parse(raw);
  if (new TextDecoder().decode(bytes) !== canonicalizeAflTradeJson(parsed)) {
    throw new TypeError('Private valuation v3 canonical artifact bytes drifted.');
  }
  return parsed;
}

async function loadDocument<T>(
  transaction: AflOutcomeSqlTransaction,
  sql: string,
  id: string,
  parse: (value: unknown) => T
): Promise<T | null> {
  const result = await transaction.query<DocumentRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw new TypeError('Private valuation v3 retained document is ambiguous.');
  }
  return parse(result.rows[0]!.document);
}

async function loadFactualRoot(
  transaction: AflOutcomeSqlTransaction,
  input: {
    valuationScopeKey: string;
    releaseId: string;
    candidateId: string;
    qualificationReportId: string;
    privateDecisionId: string;
    lineageId: string | null;
    memberSetSha256: string;
    transactionEventVersionId: string;
    expectedAssetVersionIds: readonly string[];
    rootKind: 'evaluated_trade' | 'evaluation_evidence';
  }
): Promise<AuthenticatedFactualRoot> {
  const result = await transaction.query<FactualRootRow>(
    `SELECT release.manifest_json AS release_document,
            release.created_at AS release_created_at,
            candidate.candidate_json AS candidate_document,
            qualification.report_json AS qualification_document,
            private_decision.decision_json AS private_decision_document,
            lineage.lineage_json AS lineage_document
       FROM outcome_release_manifest release
       JOIN outcome_factual_release_candidate candidate
         ON candidate.candidate_id=$2 AND candidate.target_release_id=release.release_id
        AND candidate.status='approved' AND candidate.finalized_at IS NOT NULL
       JOIN outcome_valuation_source_qualification_report qualification
         ON qualification.qualification_report_id=$3
        AND qualification.factual_release_id=release.release_id
        AND qualification.valuation_scope_key=$6
        AND qualification.decision_state='eligible_for_dataset_admission'
       JOIN outcome_private_valuation_evaluation_decision private_decision
         ON private_decision.decision_id=$4
        AND private_decision.factual_release_id=release.release_id
        AND private_decision.valuation_scope_key=$6
        AND private_decision.status='authorized'
  LEFT JOIN outcome_corpus_factual_lineage lineage
         ON lineage.lineage_id=$5 AND lineage.release_id=release.release_id
        AND lineage.candidate_id=candidate.candidate_id
      WHERE release.release_id=$1 AND release.environment='non_production'
      FOR KEY SHARE OF release,candidate,qualification,private_decision,lineage`,
    [
      input.releaseId,
      input.candidateId,
      input.qualificationReportId,
      input.privateDecisionId,
      input.lineageId,
      input.valuationScopeKey,
    ]
  );
  if (result.rows.length !== 1) {
    throw new TypeError(`Private valuation v3 ${input.rootKind} factual ancestry is unavailable.`);
  }
  const row = result.rows[0]!;
  const release = aflDraftTradeOutcomeAnyReleaseManifestSchema.parse(row.release_document);
  const candidate = parseCandidate(row.candidate_document);
  const qualification = aflTradeValuationSourceQualificationReportSchema.parse(
    row.qualification_document
  );
  const privateDecision = parseAflTradePrivateValuationEvaluationDecision(
    row.private_decision_document
  );
  const lineage =
    row.lineage_document === null
      ? null
      : aflTradeCorpusFactualLineageSchema.parse(row.lineage_document);
  const releaseCreatedAt = new Date(row.release_created_at).toISOString();
  const canonicalMembers = (release.content as { canonicalMembers?: unknown }).canonicalMembers;
  if (!Array.isArray(canonicalMembers)) {
    throw new TypeError(`Private valuation v3 ${input.rootKind} release lacks membership.`);
  }
  const releaseArtifact = createAflTradeCanonicalJsonArtifactRef(release, releaseCreatedAt);
  const membershipArtifact = createAflTradeCanonicalJsonArtifactRef(
    canonicalMembers,
    releaseCreatedAt
  );
  if (
    release.releaseId !== input.releaseId ||
    release.content.scopeKey === undefined ||
    candidate.candidateId !== input.candidateId ||
    qualification.content.valuationScopeKey !== input.valuationScopeKey ||
    qualification.content.factualReleaseId !== input.releaseId ||
    qualification.content.decision.state !== 'eligible_for_dataset_admission' ||
    privateDecision.content.valuationScopeKey !== input.valuationScopeKey ||
    privateDecision.content.factualReleaseId !== input.releaseId ||
    privateDecision.content.status !== 'authorized' ||
    !doAflTradeArtifactRefsExactlyMatch(
      qualification.content.factualReleaseArtifact,
      releaseArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      qualification.content.releaseMembershipArtifact,
      membershipArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      privateDecision.content.factualReleaseArtifact,
      releaseArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      privateDecision.content.releaseMembershipArtifact,
      membershipArtifact
    ) ||
    !exactReferences(
      qualification.content.sourceRightsEvidenceRefs,
      privateDecision.content.sourceRightsEvidenceRefs
    ) ||
    (input.lineageId !== null &&
      (lineage === null ||
        lineage.lineageId !== input.lineageId ||
        lineage.content.factualReleaseId !== input.releaseId ||
        lineage.content.factualCandidateId !== input.candidateId ||
        lineage.content.sourceMemberSetSha256 !== input.memberSetSha256))
  ) {
    throw new TypeError(`Private valuation v3 ${input.rootKind} factual ancestry drifted.`);
  }
  const assetsResult = await transaction.query<AssetRow>(
    `SELECT asset.asset_version_id,asset.asset_key
       FROM outcome_release_event_version event_member
       JOIN outcome_event_version event
         ON event.event_version_id=event_member.event_version_id
        AND event.status='approved'
       JOIN outcome_event_asset asset ON asset.event_version_id=event.event_version_id
       JOIN outcome_release_event_asset asset_member
         ON asset_member.release_id=event_member.release_id
        AND asset_member.asset_version_id=asset.asset_version_id
      WHERE event_member.release_id=$1 AND event_member.event_version_id=$2
      ORDER BY asset.asset_version_id
      FOR KEY SHARE OF event_member,event,asset,asset_member`,
    [input.releaseId, input.transactionEventVersionId]
  );
  const actualAssetVersionIds = assetsResult.rows.map(({ asset_version_id }) => asset_version_id);
  if (
    actualAssetVersionIds.length !== input.expectedAssetVersionIds.length ||
    actualAssetVersionIds.some(
      (assetVersionId, index) => assetVersionId !== input.expectedAssetVersionIds[index]
    )
  ) {
    throw new TypeError(`Private valuation v3 ${input.rootKind} asset membership drifted.`);
  }
  return { release, candidate, qualification, privateDecision, lineage, assets: assetsResult.rows };
}

async function requirePlayerRun(
  transaction: AflOutcomeSqlTransaction,
  component: AflTradePrivateValuationAuthorityBundleV3['content']['modelAuthorities']['atTrade']['player']
): Promise<AflTradeAuthenticatedCompletedPlayerModelRunChain> {
  const chain = await loadAuthenticatedAflTradeCompletedPlayerModelRunChain(
    transaction,
    component.runId
  );
  if (
    chain === null ||
    chain.run.content.outcome.status !== 'succeeded' ||
    chain.run.content.environment !== 'non_production' ||
    chain.protocol.protocolId !== component.protocolId ||
    chain.dataset.datasetId !== component.datasetId ||
    chain.admission.admissionId !== component.datasetAdmissionId ||
    chain.observationSet.observationSetId !== component.observationSetId ||
    chain.dataset.content.knowledgeCutoffAt !== component.knowledgeCutoffAt
  ) {
    throw new TypeError('Private valuation v3 player model ancestry drifted.');
  }
  return chain;
}

async function requirePickCandidate(
  transaction: AflOutcomeSqlTransaction,
  component: AflTradePrivateValuationAuthorityBundleV3['content']['modelAuthorities']['atTrade']['pick'],
  hpnPavMethodId: string
): Promise<AflTradeGovernedPickPavCandidateChain> {
  const chain = await loadAuthenticatedAflTradeGovernedPickPavCandidateChain(
    transaction,
    component.candidateId
  );
  if (
    chain === null ||
    chain.candidate.content.observationSetId !== component.observationSetId ||
    chain.candidate.content.observationAdmissionId !== component.observationAdmissionId ||
    chain.candidate.content.policyId !== component.policyId ||
    chain.candidate.content.methodId !== hpnPavMethodId ||
    chain.candidate.content.observationSet.content.knowledgeCutoffAt !==
      component.knowledgeCutoffAt ||
    chain.consumption.content.consumptionState !== 'consumed'
  ) {
    throw new TypeError('Private valuation v3 pick model ancestry drifted.');
  }
  return chain;
}

export class PostgresAflTradePrivateValuationAuthorityV3Registry {
  constructor(
    private readonly artifactRepository: AflTradeImmutableArtifactRepository,
    private readonly maximumArtifactBytes: number
  ) {
    if (
      artifactRepository.artifactClass !== 'derived_private' ||
      !['fixture_memory', 'local_non_production_filesystem'].includes(
        artifactRepository.assurance
      ) ||
      !Number.isSafeInteger(maximumArtifactBytes) ||
      maximumArtifactBytes <= 0
    ) {
      throw new TypeError(
        'Private valuation v3 registry requires bounded private local artifact custody.'
      );
    }
  }

  async loadAuthenticated(
    transaction: AflOutcomeSqlTransaction,
    input: {
      valuationBundleId: string;
      bundleGate3DecisionId: string;
      trustedAt: string;
    }
  ): Promise<AflTradeAuthenticatedPrivateValuationAuthorityV3Chain | null> {
    const bundle = await loadDocument(
      transaction,
      `SELECT bundle_json AS document
         FROM outcome_private_valuation_authority_bundle_v3
        WHERE valuation_bundle_id=$1 FOR KEY SHARE`,
      input.valuationBundleId,
      (value) => aflTradePrivateValuationAuthorityBundleV3Schema.parse(value)
    );
    if (bundle === null) return null;
    const evidenceBundle = await loadDocument(
      transaction,
      `SELECT bundle_json AS document
         FROM outcome_private_valuation_evidence_bundle
        WHERE evidence_bundle_id=$1 FOR KEY SHARE`,
      bundle.content.evaluationEvidence.evidenceBundleId,
      (value) => aflTradePrivateValuationEvidenceBundleSchema.parse(value)
    );
    if (evidenceBundle === null) {
      throw new TypeError('Private valuation v3 evidence bundle is unavailable.');
    }
    const evidenceAuthority = bundle.content.evaluationEvidence;
    if (
      evidenceBundle.content.valuationScopeKey !== bundle.content.valuationScopeKey ||
      evidenceBundle.content.factualRoot.releaseId !== evidenceAuthority.factualReleaseId ||
      evidenceBundle.content.factualRoot.candidateId !== evidenceAuthority.factualCandidateId ||
      evidenceBundle.content.factualRoot.corpusToCandidateLineageId !==
        evidenceAuthority.corpusToCandidateLineageId ||
      evidenceBundle.content.factualRoot.sourceQualificationReportId !==
        evidenceAuthority.sourceQualificationReportId ||
      evidenceBundle.content.factualRoot.privateEvaluationDecisionId !==
        evidenceAuthority.privateEvaluationDecisionId ||
      evidenceBundle.content.factualRoot.memberSetSha256 !==
        evidenceAuthority.memberSetSha256 ||
      evidenceBundle.content.knowledgeCutoffAt !== evidenceAuthority.knowledgeCutoffAt ||
      !doAflTradeArtifactRefsExactlyMatch(
        evidenceBundle.content.evaluatedTradeCorrespondenceArtifact,
        evidenceAuthority.tradeCorrespondenceArtifact
      )
    ) {
      throw new TypeError('Private valuation v3 evidence bundle ancestry drifted.');
    }
    const correspondence = await loadCanonicalArtifact({
      repository: this.artifactRepository,
      maximumArtifactBytes: this.maximumArtifactBytes,
      reference: evidenceAuthority.tradeCorrespondenceArtifact,
      parse: (value) =>
        aflTradePrivateValuationTradeEvidenceCorrespondenceSchema.parse(value),
    });
    const evaluatedTrade = bundle.content.evaluatedTrade;
    if (
      correspondence.content.valuationScopeKey !== bundle.content.valuationScopeKey ||
      correspondence.content.tradeId !== evidenceBundle.content.tradeId ||
      correspondence.content.evaluatedTrade.factualReleaseId !==
        evaluatedTrade.factualReleaseId ||
      correspondence.content.evaluatedTrade.factualCandidateId !==
        evaluatedTrade.factualCandidateId ||
      correspondence.content.evaluatedTrade.transactionEventVersionId !==
        evaluatedTrade.transactionEventVersionId ||
      correspondence.content.evaluatedTrade.canonicalMemberSetSha256 !==
        evaluatedTrade.canonicalMemberSetSha256 ||
      correspondence.content.evaluationEvidence.factualReleaseId !==
        evidenceAuthority.factualReleaseId ||
      correspondence.content.evaluationEvidence.factualCandidateId !==
        evidenceAuthority.factualCandidateId ||
      correspondence.content.evaluationEvidence.corpusToCandidateLineageId !==
        evidenceAuthority.corpusToCandidateLineageId ||
      correspondence.content.evaluationEvidence.memberSetSha256 !==
        evidenceAuthority.memberSetSha256
    ) {
      throw new TypeError('Private valuation v3 trade correspondence drifted.');
    }
    const [evaluatedRoot, evidenceRoot] = await Promise.all([
      loadFactualRoot(transaction, {
        valuationScopeKey: bundle.content.valuationScopeKey,
        releaseId: evaluatedTrade.factualReleaseId,
        candidateId: evaluatedTrade.factualCandidateId,
        qualificationReportId: evaluatedTrade.sourceQualificationReportId,
        privateDecisionId: evaluatedTrade.privateEvaluationDecisionId,
        lineageId: null,
        memberSetSha256: evaluatedTrade.canonicalMemberSetSha256,
        transactionEventVersionId: evaluatedTrade.transactionEventVersionId,
        expectedAssetVersionIds: evaluatedTrade.assetVersionIds,
        rootKind: 'evaluated_trade',
      }),
      loadFactualRoot(transaction, {
        valuationScopeKey: bundle.content.valuationScopeKey,
        releaseId: evidenceAuthority.factualReleaseId,
        candidateId: evidenceAuthority.factualCandidateId,
        qualificationReportId: evidenceAuthority.sourceQualificationReportId,
        privateDecisionId: evidenceAuthority.privateEvaluationDecisionId,
        lineageId: evidenceAuthority.corpusToCandidateLineageId,
        memberSetSha256: evidenceAuthority.memberSetSha256,
        transactionEventVersionId:
          correspondence.content.evaluationEvidence.transactionEventVersionId,
        expectedAssetVersionIds:
          correspondence.content.evaluationEvidence.assetVersionIds,
        rootKind: 'evaluation_evidence',
      }),
    ]);
    const evaluatedKeys = evaluatedRoot.assets.map(({ asset_key }) => asset_key);
    const evidenceKeys = evidenceRoot.assets.map(({ asset_key }) => asset_key);
    const mappingKeys = correspondence.content.assetMappings.map(({ assetId }) => assetId);
    if (
      evaluatedKeys.length !== mappingKeys.length ||
      evidenceKeys.length !== mappingKeys.length ||
      evaluatedKeys.some((assetId, index) => assetId !== mappingKeys[index]) ||
      evidenceKeys.some((assetId, index) => assetId !== mappingKeys[index])
    ) {
      throw new TypeError('Private valuation v3 mapped asset identities drifted.');
    }
    const assetAdmissions = new Map<
      string,
      | ReturnType<typeof privateGovernedPlayerEvidenceAdmissionSchema.parse>
      | ReturnType<typeof privateGovernedPickEvidenceAdmissionAnySchema.parse>
    >();
    for (const asset of evidenceBundle.content.assets) {
      const admission = await loadCanonicalArtifact({
        repository: this.artifactRepository,
        maximumArtifactBytes: this.maximumArtifactBytes,
        reference: asset.evidenceArtifact,
        parse: (value) =>
          asset.assetKind === 'player'
            ? privateGovernedPlayerEvidenceAdmissionSchema.parse(value)
            : privateGovernedPickEvidenceAdmissionAnySchema.parse(value),
      });
      if (
        admission.content.assetId !== asset.assetId ||
        admission.content.receivingClubId !== asset.receivingClubId ||
        admission.content.knowledgeCutoffAt !== evidenceBundle.content.knowledgeCutoffAt ||
        !exactReferences(admission.content.evidenceRefs, asset.dependencyArtifacts)
      ) {
        throw new TypeError(`Private valuation v3 asset evidence drifted for ${asset.assetId}.`);
      }
      for (const dependency of asset.dependencyArtifacts) {
        await loadExactBytes(
          this.artifactRepository,
          this.maximumArtifactBytes,
          dependency
        );
      }
      assetAdmissions.set(asset.assetId, admission);
    }
    for (const reference of [
      bundle.content.componentCompatibilityArtifact,
      bundle.content.jointSimulationProtocolArtifact,
      bundle.content.gradePolicyArtifact,
    ]) {
      await loadExactBytes(this.artifactRepository, this.maximumArtifactBytes, reference);
    }
    const atTrade = bundle.content.modelAuthorities.atTrade;
    const currentRemaining = bundle.content.modelAuthorities.currentRemaining;
    const playerRuns = new Map<string, AflTradeAuthenticatedCompletedPlayerModelRunChain>();
    const pickCandidates = new Map<string, AflTradeGovernedPickPavCandidateChain>();
    const loadPlayer = async (component: typeof atTrade.player) => {
      const existing = playerRuns.get(component.runId);
      if (existing !== undefined) return existing;
      const loaded = await requirePlayerRun(transaction, component);
      playerRuns.set(component.runId, loaded);
      return loaded;
    };
    const loadPick = async (component: typeof atTrade.pick) => {
      const existing = pickCandidates.get(component.candidateId);
      if (existing !== undefined) return existing;
      const loaded = await requirePickCandidate(
        transaction,
        component,
        bundle.content.hpnPavMethodId
      );
      pickCandidates.set(component.candidateId, loaded);
      return loaded;
    };
    const gates: AflTradeCurrentGateAuthority[] = [];
    const gateInputs = [
      {
        decisionId: evidenceAuthority.gate3DecisionId,
        expectedArtifacts: [
          {
            kind: 'valuation_evidence_bundle' as const,
            artifactId: evidenceBundle.evidenceBundleId,
          },
        ],
      },
      {
        decisionId: atTrade.player.gate3DecisionId,
        expectedArtifacts: [
          { kind: 'model_run' as const, artifactId: atTrade.player.runId },
        ],
      },
      {
        decisionId: atTrade.pick.gate3DecisionId,
        expectedArtifacts: [
          {
            kind: 'pick_model_candidate' as const,
            artifactId: atTrade.pick.candidateId,
          },
        ],
      },
      {
        decisionId: currentRemaining.player.gate3DecisionId,
        expectedArtifacts: [
          { kind: 'model_run' as const, artifactId: currentRemaining.player.runId },
        ],
      },
      {
        decisionId: currentRemaining.pick.gate3DecisionId,
        expectedArtifacts: [
          {
            kind: 'pick_model_candidate' as const,
            artifactId: currentRemaining.pick.candidateId,
          },
        ],
      },
      {
        decisionId: input.bundleGate3DecisionId,
        expectedArtifacts: [
          { kind: 'valuation_bundle' as const, artifactId: bundle.valuationBundleId },
        ],
      },
    ];
    for (const gateInput of new Map(
      gateInputs.map((gateInput) => [gateInput.decisionId, gateInput])
    ).values()) {
      const gate = await loadCurrentAflTradeGateAuthority(transaction, {
        ...gateInput,
        valuationScopeKey: bundle.content.valuationScopeKey,
        trustedAt: input.trustedAt,
      });
      if (gate === null) {
        throw new TypeError('Private valuation v3 current Gate 3 authority is unavailable.');
      }
      gates.push(gate);
    }
    const validThrough = gates
      .map(({ validThrough: cutoff }) => cutoff)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    if (validThrough === undefined) {
      throw new TypeError('Private valuation v3 requires current Gate 3 authority.');
    }
    return {
      bundle,
      evidenceBundle,
      correspondence,
      factualRoots: { evaluatedTrade: evaluatedRoot, evaluationEvidence: evidenceRoot },
      assetAdmissions,
      modelAuthorities: {
        atTrade: {
          player: await loadPlayer(atTrade.player),
          pick: await loadPick(atTrade.pick),
        },
        currentRemaining: {
          player: await loadPlayer(currentRemaining.player),
          pick: await loadPick(currentRemaining.pick),
        },
      },
      gates,
      validThrough,
    };
  }
}
