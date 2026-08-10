import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import { createAflDraftTradeOutcomeActivationAuthorization } from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import {
  applyAflDraftTradeOutcomeReleaseCommand,
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import {
  createAflTradePromotionBackedArchiveSelector,
  type AflTradePromotionBackedGate2Authority,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import {
  createAflTradePromotionBackedGate2Admission,
  createAflTradePromotionBackedGate2AffectedArtifacts,
  createAflTradePromotionBackedGate2DecisionKey,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedGate2AdmissionContracts';
import { createAflTradePromotionBackedFactualLineage } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualLineageContracts';
import { createAflTradePromotionBackedFactualProjection } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualProjectionContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import { createAflTradePromotionBackedPublicArchive } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { createAflTradeGateDecisionFixture } from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

const sha = (value: string) => value.repeat(64);

function fixture() {
  const rightsArtifactId = `source-rights:${sha('e')}`;
  const rights = createAflTradeGateDecisionFixture({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey: 'promotion-archive-rights',
    decidedAt: '2026-08-06T00:10:00.000Z',
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rightsArtifactId }],
  });
  const promotionId = `external-canonical-promotion:${sha('a')}`;
  const canonicalRecordId = `event-version:${sha('b')}`;
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-04T02:00:00.000Z',
    knowledgeCutoffAt: '2026-08-04T01:00:00.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256: sha('a'),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-04T00:00:00.000Z',
        promotionRecordCount: 1,
      },
    ],
    members: [
      {
        promotionId,
        recordKind: 'transaction',
        sourceRecordId: 'trade:2025:1',
        canonicalRecordId,
        recordSha256: sha('c'),
      },
    ],
  });
  const factual = createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    createdAt: '2026-08-04T03:00:00.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:draftguru-trade-1',
        sourceSnapshotId: `source-snapshot:${sha('d')}`,
        rightsArtifactId,
        gateDecisionId: rights.decisionId,
        recordSha256: sha('0'),
        recordedAt: '2026-08-04T01:00:00.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: ['capture:draftguru-trade-1'] }],
    canonicalMembers: [
      { recordKind: 'transaction', canonicalRecordId, canonicalRecordSha256: sha('1') },
    ],
  });
  const lineage = createAflTradePromotionBackedFactualLineage({
    corpus: factual.corpus,
    release: factual.release,
    candidate: factual.candidate,
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  const gate2 = createAflTradeGateDecisionFixture({
    gate: 'gate_2_corpus_lineage',
    decisionKey: createAflTradePromotionBackedGate2DecisionKey(lineage),
    decidedAt: '2026-08-06T00:30:00.000Z',
    affectedArtifacts: createAflTradePromotionBackedGate2AffectedArtifacts(lineage),
    scopeDimensions: [
      { name: 'competition', values: ['AFLM'] },
      { name: 'valid_from_season', values: ['2025'] },
      { name: 'valid_through_season', values: ['2025'] },
    ],
  });
  const admission = createAflTradePromotionBackedGate2Admission({
    lineage,
    ledger: gate2.ledger,
    ledgerRevision: 1,
    evaluatedAt: '2026-08-06T01:00:00.000Z',
  });
  const archive = createAflTradePromotionBackedPublicArchive({
    candidate: factual.candidate,
    createdAt: '2026-08-06T01:30:00.000Z',
    records: [
      {
        recordKind: 'transaction',
        recordId: canonicalRecordId,
        eventId: 'trade:2025:1',
        eventVersionId: canonicalRecordId,
        seasonYear: 2025,
        occurredOn: '2025-10-15',
        officialName: 'Fixture trade',
        transactionType: 'trade',
        parties: [
          {
            club: { clubId: 'club:carlton', name: 'Carlton', abbreviation: 'CARL' },
            role: 'party',
            ordinal: 1,
          },
          {
            club: { clubId: 'club:fremantle', name: 'Fremantle', abbreviation: 'FRE' },
            role: 'party',
            ordinal: 2,
          },
        ],
      },
    ],
  });
  const projection = createAflTradePromotionBackedFactualProjection({
    candidate: factual.candidate,
    archive,
    createdAt: '2026-08-06T02:00:00.000Z',
    parityReport: {
      artifact: createAflTradeCanonicalJsonArtifactRef(
        { status: 'passed' },
        '2026-08-06T01:30:00.000Z'
      ),
      status: 'passed',
      checkCount: 5,
      failureCount: 0,
      checkedCanonicalRecordCount: 1,
      checkedPublicRecordCount: 1,
    },
  });
  let registry = registerAflDraftTradeOutcomeRelease(createAflDraftTradeOutcomeReleaseRegistry(), {
    expectedRevision: 0,
    manifest: factual.release,
    actor: 'fixture-importer',
    evidenceId: factual.candidate.candidateId,
    occurredAt: '2026-08-06T03:00:00.000Z',
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'validate',
    releaseId: factual.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: '2026-08-06T04:00:00.000Z',
    actor: 'fixture-reviewer',
    evidenceId: projection.projectionId,
    environment: 'test_fixture',
    projectionManifest: projection,
    gateDecisionLedger: rights.ledger,
  });
  const affectedArtifacts = [
    { kind: 'factual_release' as const, artifactId: factual.release.releaseId },
    { kind: 'factual_projection' as const, artifactId: projection.projectionId },
  ];
  const gate4 = createAflTradeGateDecisionFixture({
    gate: 'gate_4_publication_api_readiness',
    decisionKey: 'promotion-archive-gate4',
    decidedAt: '2026-08-06T04:30:00.000Z',
    affectedArtifacts,
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'approve',
    releaseId: factual.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: '2026-08-06T05:00:00.000Z',
    actor: 'fixture-reviewer',
    evidenceId: gate4.decisionId,
    environment: 'test_fixture',
    gateDecisionId: gate4.decisionId,
    gateDecisionLedger: gate4.ledger,
  });
  const gate5 = createAflTradeGateDecisionFixture({
    gate: 'gate_5_comprehension_accessibility',
    decisionKey: 'promotion-archive-gate5',
    decidedAt: '2026-08-06T05:15:00.000Z',
    affectedArtifacts,
  });
  const activationAuthorization = createAflDraftTradeOutcomeActivationAuthorization({
    schemaVersion: 'afl-draft-trade-outcome-activation-authorization/v1',
    environment: 'test_fixture',
    scopeKey: factual.release.content.scopeKey,
    releaseId: factual.release.releaseId,
    projectionId: projection.projectionId,
    expectedRegistryRevision: registry.revision,
    authorizedAt: '2026-08-06T05:30:00.000Z',
    expiresAt: '2026-08-07T00:00:00.000Z',
    rollbackWindowEndsAt: '2026-08-07T00:00:00.000Z',
    writeBarrier: 'engaged',
    parityReportArtifactId: projection.content.parityReport.artifact.artifactId,
    authorityKind: 'fixture',
    authorizedBy: 'ops:fixture-authorizer',
    authorityEvidenceIds: [gate5.decisionId],
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'activate',
    releaseId: factual.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: '2026-08-06T06:00:00.000Z',
    actor: 'fixture-operator',
    evidenceId: gate5.decisionId,
    environment: 'test_fixture',
    gateDecisionId: gate5.decisionId,
    gateDecisionLedger: gate5.ledger,
    sourceRightsDecisionLedger: rights.ledger,
    factualReviewDecisionLedger: gate4.ledger,
    activationAuthorization,
  });
  return { registry, rights, gate2, lineage, admission, factual, projection };
}

function selector(
  value: ReturnType<typeof fixture>,
  overrides: {
    gate2Authority?: AflTradePromotionBackedGate2Authority | null;
    environment?: 'test_fixture' | 'non_production';
  } = {}
) {
  return createAflTradePromotionBackedArchiveSelector({
    loadRegistry: async () => value.registry,
    loadGateDecisionLedger: async () => ({
      proposals: [...value.rights.ledger.proposals, ...value.gate2.ledger.proposals],
      decisions: [...value.rights.ledger.decisions, ...value.gate2.ledger.decisions],
    }),
    loadGate2Authority: async () =>
      overrides.gate2Authority === undefined
        ? { lineage: value.lineage, admission: value.admission }
        : overrides.gate2Authority,
    expectedEnvironment: overrides.environment ?? 'test_fixture',
    now: () => '2026-08-06T07:00:00.000Z',
  });
}

describe('promotion-backed public archive selection', () => {
  it('captures the exact active v3 release, projection, corpus, and Gate 2 authority', async () => {
    const value = fixture();
    const captured = await selector(value).capture(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE);

    expect(captured.unavailabilityReason).toBeNull();
    expect(captured.selection).toMatchObject({
      releaseId: value.factual.release.releaseId,
      projectionId: value.projection.projectionId,
      publicArchiveId: value.projection.content.publicArchiveId,
      factualCandidateId: value.factual.candidate.candidateId,
      corpusId: value.factual.corpus.corpusId,
      gate2AdmissionId: value.admission.admissionId,
      publicRecordSetSha256: value.projection.content.publicRecordSetSha256,
    });
  });

  it('fails closed when Gate 2 authority is absent or the environment is wrong', async () => {
    const value = fixture();
    await expect(
      selector(value, { gate2Authority: null }).capture(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE)
    ).resolves.toMatchObject({ selection: null, unavailabilityReason: 'gate2_blocked' });
    await expect(
      selector(value, { environment: 'non_production' }).capture(
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE
      )
    ).rejects.toThrow(/environment/i);
  });

  it('returns an explicit empty snapshot when no active release exists', async () => {
    const value = fixture();
    const empty = createAflTradePromotionBackedArchiveSelector({
      loadRegistry: async () => createAflDraftTradeOutcomeReleaseRegistry(),
      loadGateDecisionLedger: async () => value.rights.ledger,
      loadGate2Authority: async () => null,
      expectedEnvironment: 'test_fixture',
      now: () => '2026-08-06T07:00:00.000Z',
    });
    await expect(empty.capture(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE)).resolves.toEqual({
      registryRevision: 0,
      selection: null,
      unavailabilityReason: 'no_active_release',
    });
  });
});
