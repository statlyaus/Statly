import { buildReviewedSpecialCorrection } from '@/server/aflTradeIntelligence/source/reviewedSpecialCorrection';
import { buildReviewedRookieCorrection } from '@/server/aflTradeIntelligence/source/reviewedRookieCorrection';
import {
  createAflTradeExternalEvidenceEnvelope,
  createAflTradeExternalEvidenceBatch,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { buildReviewedSpecialCustodyBindings } from '@/server/aflTradeIntelligence/source/reviewedSpecialCustodyBindings';
import { createSpecialEntitlementAward } from '@/server/aflTradeIntelligence/source/specialEntitlementAwardContracts';
import { buildReviewedOrdinaryCorrection } from '@/server/aflTradeIntelligence/source/reviewedOrdinaryCorrection';
import { buildReviewedLineageCorrectionGraph } from '@/server/aflTradeIntelligence/source/reviewedLineageCorrectionGraph';
import { buildReviewedAdmissionScope } from '@/server/aflTradeIntelligence/source/reviewedAdmissionScope';
import { bindRegisteredLineageForPromotion } from '@/server/aflTradeIntelligence/source/reviewedPickLineagePromotionBinding';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { previewReviewedPickLineage } from '@/server/aflTradeIntelligence/source/reviewedPickLineageReadiness';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { describe, expect, it } from 'vitest';
import {
  createReviewedPickLineageRegistration,
  reviewedPickLineageRegistrationSchema,
  reviewedPickLineageApprovalEvidence,
} from '@/server/aflTradeIntelligence/source/reviewedPickLineageRegistrationContracts';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  bindReviewedPickLineage,
  reviewedPickLineageSchema,
  reviewedPickEndpointSchema,
  type ReviewedPickLineage,
} from '@/server/aflTradeIntelligence/source/reviewedPickLineage';

const transferId = `external-transfer:${'a'.repeat(64)}`;
const transactionId = `external-transaction:${'b'.repeat(64)}`;
const evidenceIds = [`external-evidence:${'c'.repeat(64)}`];
function candidate() {
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFL',
    anchorSeasonYear: 2012,
    sourceBatchIds: [`external-evidence-batch:${'d'.repeat(64)}`],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: 'fixture-caddy',
        seasonYear: 2012,
        occurredOn: null,
        transactionType: 'trade',
        title: null,
        parties: ['geelong', 'gold-coast'],
        transferIds: [transferId],
        status: 'single_source',
        evidenceIds,
      },
    ],
    transfers: [
      {
        transferId,
        transactionId,
        fromClubId: 'geelong',
        toClubId: 'gold-coast',
        status: 'unresolved',
        evidenceIds,
        asset: {
          kind: 'pick_entitlement',
          pickId: `draft-pick:${'e'.repeat(64)}`,
          draftYear: 2012,
          draftType: 'national',
          nominalRound: null,
          nominalPick: 55,
          originalClubId: null,
          recordedLabel: 'Pick 55',
        },
      },
    ],
    draftSelections: [],
    pickCustody: [],
    pickLineage: [],
    issues: [],
    reconciledAt: '2026-09-13T00:00:00Z',
    publicationEligible: false,
  });
}
function record(): ReviewedPickLineage {
  return {
    schemaVersion: 'afl-trade-reviewed-pick-lineage/v1',
    candidateId: candidate().candidateId,
    transferId,
    retainedSourceLabel: 'Pick 55',
    acceptedTradeTimePick: 57,
    originalClubId: null,
    movements: [
      {
        transferId,
        fromClubId: 'geelong',
        toClubId: 'gold-coast',
        occurredAt: { precision: 'year', year: 2012 },
        predecessorOrdinal: null,
      },
    ],
    endpoint: {
      kind: 'rookie_elevation',
      playerId: null,
      recordedPlayerName: 'Kyal Horsley',
      exercisingClubId: 'gold-coast',
      draftYear: 2012,
      draftType: 'national',
      livePick: 55,
    },
    attribution: 'direct',
    evidence: [
      createAflTradeByteArtifactRef(
        new TextEncoder().encode('Fixture reviewed fact'),
        'text/plain',
        '2026-09-13T00:00:00Z'
      ),
    ],
  };
}
describe('reviewed pick lineage', () => {
  function registrationRecord() {
    const value = record();
    if (value.endpoint.kind === 'rookie_elevation') value.endpoint.playerId = 'fixture-player';
    value.movements[0].source = {
      nativeEventId: 'fixture-caddy',
      sourceUrl: 'https://example.test/caddy',
      retainedAssetLabel: 'Pick 55',
      artifact: value.evidence[0],
      rowOrdinals: [1],
    };
    return value;
  }
  function registration(records = [registrationRecord()]) {
    return createReviewedPickLineageRegistration({
      candidate: candidate(),
      records,
      proposedAt: '2026-09-13T12:00:00Z',
    });
  }
  it('keeps ordinary downstream transfers in one special award history', () => {
    const batch = (captureLetter: string, digestLetter: string) =>
      createAflTradeExternalEvidenceBatch({
        schemaVersion: 'afl-trade-external-evidence-batch/v1',
        provider: 'official_afl',
        captureId: `source-capture:${captureLetter.repeat(64)}`,
        finalizedAt: '2026-09-13T12:00:00.000Z',
        publicationEligible: false,
        evidence: [
          createAflTradeExternalEvidenceEnvelope({
            schemaVersion: 'afl-trade-external-evidence/v1',
            provider: 'official_afl',
            capture: {
              captureId: `source-capture:${captureLetter.repeat(64)}`,
              artifactId: `artifact:${digestLetter.repeat(64)}`,
              contentSha256: digestLetter.repeat(64),
              mediaType: 'text/html',
              sourceUrl: 'https://example.test/award',
              capturedAt: '2026-09-13T12:00:00.000Z',
              effectiveAt: '2010-01-01T00:00:00.000Z',
              parserVersion: 'fixture/v1',
              fieldManifestSha256: '3'.repeat(64),
            },
            sourceRow: { ordinal: 1, sourceKey: 'award' },
            claim: {
              kind: 'issuing_award_reference',
              grantYear: 2010,
              scheme: 'gold_coast_expansion_compensation',
              recordedOriginalHolder: 'Geelong',
              componentCount: 1,
              sourceDescription: 'Fixture award reference',
            },
            publicationEligible: false,
          }),
        ],
      });
    const parentBatch = batch('9', '9'),
      awardBatch = batch('1', '2');
    const base = createAflTradeExternalReconciliationCandidate({
      ...candidate().content,
      sourceBatchIds: [parentBatch.batchId],
      schemaVersion: 'afl-trade-external-reconciliation/v2',
      sourceAuthority: {
        schemaVersion: 'afl-trade-external-reconciliation-source-authority/v1',
        kind: 'reviewed_batch_set',
        reviewDecisionId: `review-decision:${'8'.repeat(64)}`,
        reviewDecisionSha256: '8'.repeat(64),
        candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([parentBatch.batchId]),
        decidedAt: '2026-09-13T12:00:00.000Z',
      },
    });
    const secondId = `external-transfer:${'f'.repeat(64)}`;
    const asset = {
      kind: 'special_pick' as const,
      entitlementType: 'expansion_compensation' as const,
      draftYear: null,
      selectionOrdinal: null,
      sourceLabel: 'CMP3 (Nathan Bock)',
    };
    const original = createAflTradeExternalReconciliationCandidate({
      ...base.content,
      transactions: [
        {
          ...base.content.transactions[0],
          parties: ['geelong', 'gold-coast', 'melbourne'],
          transferIds: [transferId, secondId].sort(),
        },
      ],
      transfers: [
        { ...base.content.transfers[0], asset },
        {
          ...base.content.transfers[0],
          transferId: secondId,
          fromClubId: 'gold-coast',
          toClubId: 'melbourne',
        },
      ],
    });
    const first = record();
    first.candidateId = original.candidateId;
    first.attribution = 'ultimate';
    first.retainedSourceLabel = asset.sourceLabel;
    first.acceptedTradeTimePick = null;
    first.endpoint = {
      kind: 'selected',
      playerId: 'fixture-player',
      recordedPlayerName: 'Fixture Player',
      draftYear: 2012,
      draftType: 'national',
      livePick: 27,
      exercisingClubId: 'melbourne',
    };
    first.movements.push({
      transferId: secondId,
      fromClubId: 'gold-coast',
      toClubId: 'melbourne',
      occurredAt: { precision: 'year', year: 2012 },
      predecessorOrdinal: 0,
    });
    const second = {
      ...first,
      transferId: secondId,
      retainedSourceLabel: 'Pick 55',
      movements: [{ ...first.movements[1], predecessorOrdinal: null }],
    };
    const registered = createReviewedPickLineageRegistration({
      candidate: original,
      records: [first, second],
      proposedAt: '2026-09-13T12:00:00.000Z',
    });
    const graph = buildReviewedLineageCorrectionGraph(registered.content.records);
    const successor = createAflTradeExternalReconciliationCandidate({
      ...original.content,
      reviewedScope: {
        sourceCandidateId: original.candidateId,
        registrationId: registered.registrationId,
        deferredEvidenceIds: [],
      },
      reviewedCorrection: {
        schemaVersion: 'afl-trade-reviewed-ordinary-correction/v1',
        scopeCandidateId: original.candidateId,
        registrationId: registered.registrationId,
        correctionGraphId: graph.correctionGraphId,
        bindings: [],
      },
    });
    const award = createSpecialEntitlementAward({
      schemaVersion: 'afl-trade-special-entitlement-award/v1',
      environment: 'test_fixture',
      competition: 'AFL',
      issuingAwardId: 'fixture-issuing-award',
      component: asset.sourceLabel,
      asset,
      holderClubId: 'geelong',
      awardYear: 2010,
      awardedOn: null,
      evidence: [
        {
          captureId: `source-capture:${'1'.repeat(64)}`,
          contentSha256: '2'.repeat(64),
          sourceUrl: 'https://example.test/award',
        },
      ],
    });
    const result = buildReviewedSpecialCustodyBindings({
      candidate: successor,
      registration: registered,
      awards: [{ award, approvalDecisionId: 'fixture-approval' }],
    });
    expect(result.historyCount).toBe(1);
    expect(result.bindings.map((b) => [b.transferId, b.predecessorTransferId])).toEqual([
      [transferId, null],
      [secondId, transferId],
    ]);
    expect(result.bindings.every((b) => b.award.entitlementId === award.entitlementId)).toBe(true);
    expect(result.canonicalAdmission).toBe(false);
    const ids = [parentBatch.batchId, awardBatch.batchId].sort();
    const correctionInput = {
      candidate: successor,
      registration: registered,
      awards: [{ award, approvalDecisionId: 'fixture-approval' }],
      sourceBatches: [parentBatch, awardBatch],
      sourceAuthority: {
        schemaVersion: 'afl-trade-external-reconciliation-source-authority/v1' as const,
        kind: 'historical_plan_completion' as const,
        completionId: `external-historical-capture-completion:${'4'.repeat(64)}`,
        completionSha256: '4'.repeat(64),
        planId: `external-historical-capture-plan:${'5'.repeat(64)}`,
        planSha256: '5'.repeat(64),
        targetSetSha256: '6'.repeat(64),
        resultSetSha256: '7'.repeat(64),
        completionSourceBatchSetSha256: sha256AflTradeCanonicalJson(ids),
        candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(ids),
        completedAt: '2026-09-13T13:00:00Z',
      },
    };
    const corrected = buildReviewedSpecialCorrection(correctionInput);
    expect(corrected.candidate.content.sourceBatchIds).toEqual(ids);
    expect(corrected.candidate.content.reviewedSpecialCorrection?.parentCandidateId).toBe(
      successor.candidateId
    );
    expect(corrected.candidate.content.reviewedScope?.deferredEvidenceIds).toEqual(
      awardBatch.content.evidence.map((e) => e.evidenceId)
    );
    expect(corrected.candidate.content.pickCustody).toEqual(successor.content.pickCustody);
    expect(corrected.candidate.content.pickLineage).toEqual(successor.content.pickLineage);
    expect(
      corrected.candidate.content.transfers.every((t) => t.asset.kind === 'special_entitlement')
    ).toBe(true);
    expect(buildReviewedSpecialCorrection(correctionInput)).toEqual(corrected);
    expect(corrected.persisted).toBe(false);
    expect(() =>
      buildReviewedSpecialCorrection({ ...correctionInput, candidate: corrected.candidate })
    ).toThrow(/ordinary-correction parent/);
    expect(() =>
      buildReviewedSpecialCorrection({ ...correctionInput, sourceBatches: [parentBatch] })
    ).toThrow(/exact completed/);
    expect(() =>
      buildReviewedSpecialCorrection({
        ...correctionInput,
        sourceBatches: [parentBatch, awardBatch, awardBatch],
      })
    ).toThrow(/exact completed/);
    const unrelated = batch('8', '8'),
      extraIds = [...ids, unrelated.batchId].sort();
    expect(() =>
      buildReviewedSpecialCorrection({
        ...correctionInput,
        sourceBatches: [parentBatch, awardBatch, unrelated],
        sourceAuthority: {
          ...correctionInput.sourceAuthority,
          completionSourceBatchSetSha256: sha256AflTradeCanonicalJson(extraIds),
          candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(extraIds),
        },
      })
    ).toThrow(/add only award evidence/);

    expect(() =>
      buildReviewedSpecialCustodyBindings({
        candidate: successor,
        registration: registered,
        awards: [],
      })
    ).toThrow(/registered award/);
    expect(() =>
      buildReviewedSpecialCustodyBindings({
        candidate: successor,
        registration: registered,
        awards: [{ award, approvalDecisionId: '' }],
      })
    ).toThrow(/registered award/);
  });

  it('builds a deterministic rookie successor without rewriting its ordinary parent', () => {
    const value = record();
    if (value.endpoint.kind === 'rookie_elevation') value.endpoint.playerId = 'fixture-player';
    const registered = registration([value]);
    const original = candidate();
    const scope = buildReviewedAdmissionScope({ sourceCandidate: original, originalCandidate: original, registration: registered });
    const parent = buildReviewedOrdinaryCorrection({ scopeCandidate: scope, registration: registered, movementEvidence: [] }).candidate;
    const snapshot = structuredClone(parent);
    const input = { candidate: parent, registration: registered, movementEvidence: [] };
    const successor = buildReviewedRookieCorrection(input);
    expect(buildReviewedRookieCorrection(input)).toEqual(successor);
    expect(parent).toEqual(snapshot);
    expect(successor).toMatchObject({ appliedTransferIds: [transferId], persisted: false, canonicalAdmission: false });
    expect(successor.candidate.content).toMatchObject({
      reviewedCorrection: parent.content.reviewedCorrection,
      reviewedRookieCorrection: { parentCandidateId: parent.candidateId, registrationId: registered.registrationId },
      draftSelections: [],
      pickCustody: [{ recordedPickNumber: 57, currentClubId: 'gold-coast' }],
      pickLineage: [{ selectionId: null, terminalOutcome: value.endpoint }],
    });
    expect(successor.candidate.content.transactions).toEqual(parent.content.transactions);
    expect(successor.candidate.content.sourceBatchIds).toEqual(parent.content.sourceBatchIds);
    expect(() => buildReviewedRookieCorrection({ ...input, candidate: successor.candidate })).toThrow(/unchanged private reviewed parent/);
    const wrongRegistration = structuredClone(registered);
    wrongRegistration.registrationId = `reviewed-pick-lineage-registration:${'f'.repeat(64)}`;
    expect(() => buildReviewedRookieCorrection({ ...input, registration: wrongRegistration })).toThrow();
  });

  it('requires the elevation club to match the unique usable terminal custody holder', () => {
    const value = record();
    value.endpoint = { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 55 };
    const registered = registration([value]);
    const original = candidate();
    const scope = buildReviewedAdmissionScope({ sourceCandidate: original, originalCandidate: original, registration: registered });
    const corrected = buildReviewedOrdinaryCorrection({ scopeCandidate: scope, registration: registered, movementEvidence: [] }).candidate;
    const content = structuredClone(corrected.content);
    content.pickLineage[0].terminalOutcome = {
      kind: 'rookie_elevation', playerId: 'fixture-player', recordedPlayerName: 'Kyal Horsley',
      exercisingClubId: 'gold-coast', draftYear: 2012, draftType: 'national', livePick: 55,
    };
    expect(createAflTradeExternalReconciliationCandidate(content).content.draftSelections).toEqual([]);
    content.pickLineage[0].terminalOutcome.exercisingClubId = 'geelong';
    expect(() => createAflTradeExternalReconciliationCandidate(content)).toThrow(/terminal custody holder/);
    content.pickLineage[0].terminalOutcome.exercisingClubId = 'gold-coast';
    content.pickCustody.push({ ...content.pickCustody[0], custodyId: `external-pick-custody:${'f'.repeat(64)}` });
    expect(() => createAflTradeExternalReconciliationCandidate(content)).toThrow(/terminal custody holder/);
  });

  it('corrects a reviewed non-player endpoint without inventing a selection or mutating its scope', () => {
    const value = record();
    value.endpoint = { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 67 };
    const registered = registration([value]);
    const original = candidate();
    const scope = buildReviewedAdmissionScope({
      sourceCandidate: original,
      originalCandidate: original,
      registration: registered,
    });
    const snapshot = structuredClone(scope);
    const result = buildReviewedOrdinaryCorrection({
      scopeCandidate: scope,
      registration: registered,
      movementEvidence: [],
    });
    expect(scope).toEqual(snapshot);
    expect(result.appliedTransferIds).toEqual([transferId]);
    expect(result.pendingTransferIds).toEqual([]);
    expect(result.candidate.content.draftSelections).toEqual([]);
    expect(result.candidate.content.pickLineage[0].terminalOutcome).toEqual(value.endpoint);
    expect(result.candidate.content.pickCustody[0]).toMatchObject({
      originalClubId: null,
      currentClubId: 'gold-coast',
      observedAt: { precision: 'year', year: 2012 },
      evidenceIds,
    });
    expect(result.persisted).toBe(false);
    expect(result.canonicalAdmission).toBe(false);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...result.candidate.content,
        reviewedScope: undefined,
      })
    ).toThrow(/matching registered admission scope/);
    expect(() =>
      buildReviewedOrdinaryCorrection({
        scopeCandidate: result.candidate,
        registration: registered,
        movementEvidence: [],
      })
    ).toThrow(/pre-correction scope/);
  });

  it('scopes unrelated selections while preserving all original trade legs and blocking issues', () => {
    const original = candidate();
    const unrelated = `external-evidence:${'1'.repeat(64)}`;
    const relevant = {
      code: 'lineage_unresolved' as const,
      severity: 'blocking' as const,
      subjectKey: `lineage:${transferId}`,
      detail: 'Still requires custody',
      evidenceIds,
    };
    const source = createAflTradeExternalReconciliationCandidate({
      ...original.content,
      draftSelections: [
        {
          selectionId: `external-draft-selection:${'2'.repeat(64)}`,
          draftYear: 2012,
          draftType: 'national',
          selectionNumber: 99,
          roundNumber: null,
          pickId: `draft-pick:${'3'.repeat(64)}`,
          playerId: null,
          clubId: null,
          status: 'unresolved',
          supportingProviders: ['statly_local_fixture'],
          evidenceIds: [unrelated],
        },
      ],
      issues: [
        relevant,
        {
          ...relevant,
          code: 'identity_unresolved',
          subjectKey: 'unrelated',
          evidenceIds: [unrelated],
        },
      ],
    });
    const scoped = buildReviewedAdmissionScope({
      sourceCandidate: source,
      originalCandidate: original,
      registration: registration(),
    });
    expect(scoped.content.transfers).toEqual(original.content.transfers);
    expect(scoped.content.transactions).toEqual(original.content.transactions);
    expect(scoped.content.draftSelections).toEqual([]);
    expect(scoped.content.issues).toEqual([relevant]);
    expect(scoped.content.reviewedScope?.deferredEvidenceIds).toEqual([unrelated]);
    expect(source.content.issues).toHaveLength(2);
  });
  it('keeps ambiguous issues and transitive shared-evidence issues blocking', () => {
    const original = candidate();
    const other = `external-evidence:${'4'.repeat(64)}`;
    const issue = {
      code: 'identity_unresolved' as const,
      severity: 'blocking' as const,
      subjectKey: 'unknown',
      detail: 'Unresolved',
    };
    const source = createAflTradeExternalReconciliationCandidate({
      ...original.content,
      issues: [
        { ...issue, evidenceIds: [other] },
        { ...issue, evidenceIds: [...evidenceIds, other] },
        { ...issue, evidenceIds: [] },
      ],
    });
    expect(
      buildReviewedAdmissionScope({
        sourceCandidate: source,
        originalCandidate: original,
        registration: registration(),
      }).content.issues
    ).toEqual(source.content.issues);
  });
  it('rejects changed trade facts, environment changes, and recursive scopes', () => {
    const original = candidate();
    const input = { originalCandidate: original, registration: registration() };
    const changed = createAflTradeExternalReconciliationCandidate({
      ...original.content,
      transfers: original.content.transfers.map((t) => ({ ...t, fromClubId: 'other' })),
    });
    expect(() => buildReviewedAdmissionScope({ ...input, sourceCandidate: changed })).toThrow(
      /transfer changed/
    );
    const wrong = createAflTradeExternalReconciliationCandidate({
      ...original.content,
      competition: 'other',
    });
    expect(() => buildReviewedAdmissionScope({ ...input, sourceCandidate: wrong })).toThrow(
      /competition/
    );
    const scoped = buildReviewedAdmissionScope({ ...input, sourceCandidate: original });
    expect(() => buildReviewedAdmissionScope({ ...input, sourceCandidate: scoped })).toThrow(
      /unscoped/
    );
  });
  it('does not scope away a missing reviewed selected endpoint', () => {
    const original = candidate();
    const value = registrationRecord();
    value.endpoint = { ...value.endpoint, kind: 'selected' } as typeof value.endpoint;
    expect(() =>
      buildReviewedAdmissionScope({
        sourceCandidate: original,
        originalCandidate: original,
        registration: registration([value]),
      })
    ).toThrow(/exact retained selection/);
  });
  it('merges shared custody movements and preserves unknown origins', () => {
    const first = registrationRecord();
    const secondId = `external-transfer:${'5'.repeat(64)}`;
    const onward = {
      ...first.movements[0],
      transferId: secondId,
      fromClubId: 'gold-coast',
      toClubId: 'adelaide',
      predecessorOrdinal: 0,
      source: {
        ...first.movements[0].source!,
        nativeEventId: 'onward',
        sourceUrl: 'https://example.test/onward',
        retainedAssetLabel: 'Pick 57',
      },
    };
    first.movements.push(onward);
    first.attribution = 'ultimate';
    first.endpoint = { ...first.endpoint, exercisingClubId: 'adelaide' } as typeof first.endpoint;
    const second = {
      ...structuredClone(first),
      transferId: secondId,
      retainedSourceLabel: 'Pick 57',
      movements: [{ ...onward, predecessorOrdinal: null }],
    };
    const graph = buildReviewedLineageCorrectionGraph([first, second]);
    expect(graph.content.chains).toHaveLength(1);
    expect(graph.content.movements).toHaveLength(2);
    expect(graph.content.chains[0].transferIds).toHaveLength(2);
    expect(graph.content.chains[0].originalClubId).toBeNull();
    expect(graph.content.movements.filter((m) => m.predecessorMovementId !== null)).toHaveLength(1);
    expect(buildReviewedLineageCorrectionGraph([second, first])).toEqual(graph);
    expect(first.movements[1].predecessorOrdinal).toBe(0);
  });
  it('rejects contradictory shared endpoints and duplicate reviewed records', () => {
    const first = registrationRecord();
    expect(() => buildReviewedLineageCorrectionGraph([first, first])).toThrow(/unique records/);
    const second = { ...structuredClone(first), transferId: `external-transfer:${'6'.repeat(64)}` };
    second.movements[0].transferId = second.transferId;
    second.endpoint = {
      ...second.endpoint,
      recordedPlayerName: 'Different player',
    } as typeof second.endpoint;
    expect(() => buildReviewedLineageCorrectionGraph([first, second])).toThrow(
      /contradictory endpoints/
    );
  });
  it('does not merge independent histories merely because the player endpoint matches', () => {
    const first = registrationRecord();
    const second = structuredClone(first);
    second.transferId = `external-transfer:${'7'.repeat(64)}`;
    second.movements[0].transferId = second.transferId;
    const artifact = createAflTradeByteArtifactRef(
      new TextEncoder().encode('Independent retained trade'),
      'text/plain',
      '2026-09-13T00:00:00Z'
    );
    second.evidence = [artifact];
    second.movements[0].source = { ...second.movements[0].source!, artifact };
    expect(buildReviewedLineageCorrectionGraph([first, second]).content.chains).toHaveLength(2);
  });
  it('rejects branching histories even when each reviewed record is internally connected', () => {
    const first = registrationRecord();
    first.attribution = 'ultimate';
    const onward = {
      ...structuredClone(first.movements[0]),
      transferId: `external-transfer:${'8'.repeat(64)}`,
      fromClubId: 'gold-coast',
      toClubId: 'adelaide',
      predecessorOrdinal: 0,
    };
    onward.source!.retainedAssetLabel = 'Pick 57';
    first.movements.push(onward);
    first.endpoint = { ...first.endpoint, exercisingClubId: 'adelaide' } as typeof first.endpoint;
    const branch = structuredClone(first);
    branch.transferId = `external-transfer:${'9'.repeat(64)}`;
    branch.retainedSourceLabel = 'Pick 58';
    branch.movements[1].transferId = branch.transferId;
    branch.movements[1].toClubId = 'melbourne';
    branch.movements[1].source!.retainedAssetLabel = 'Pick 58';
    branch.endpoint = {
      ...branch.endpoint,
      exercisingClubId: 'melbourne',
    } as typeof branch.endpoint;
    expect(() => buildReviewedLineageCorrectionGraph([first, branch])).toThrow(/branch/);
  });
  function promotionTransaction(
    options: { candidateCurrent?: boolean; captureCurrent?: boolean; withdrawn?: boolean } = {}
  ) {
    const value = registration();
    return {
      query: async (sql: string) => {
        if (sql.includes('read_outcome_reviewed_pick_lineage')) {
          if (options.withdrawn)
            throw new Error('Reviewed lineage requires exact current approval');
          return { rows: [{ registration: value }] };
        }
        if (sql.includes('outcome_external_reconciliation_candidate'))
          return {
            rows: [{ candidate_json: candidate(), current: options.candidateCurrent ?? true }],
          };
        if (sql.includes('outcome_source_capture'))
          return {
            rows: [
              {
                source_artifact_id: value.content.records[0].evidence[0].artifactId,
                source_url: 'https://example.test/caddy',
                batch_id: 'fixture-batch',
                current: options.captureCurrent ?? true,
              },
            ],
          };
        return { rows: [] };
      },
    } as unknown as AflOutcomeSqlTransaction;
  }
  it('binds stored reviewed facts for promotion with current source checks and original date precision', async () => {
    const value = registration();
    const bound = await bindRegisteredLineageForPromotion(promotionTransaction(), {
      registrationId: value.registrationId,
      candidateId: candidate().candidateId,
      environment: 'test_fixture',
    });
    expect(bound).toMatchObject({
      reviewAuthorityAuthenticated: true,
      sourceAuthorityAuthenticated: true,
      canonicalAdmission: false,
    });
    expect(bound.content.facts[0].custody[0].occurredAt).toEqual({ precision: 'year', year: 2012 });
    expect(bound.content.facts[0].endpoint).toEqual(value.content.records[0].endpoint);
    await expect(
      bindRegisteredLineageForPromotion(promotionTransaction(), {
        registrationId: value.registrationId,
        candidateId: candidate().candidateId,
        environment: 'non_production',
      })
    ).rejects.toThrow(/environment/);
  });
  it.each([{ candidateCurrent: false }, { captureCurrent: false }, { withdrawn: true }])(
    'rejects non-current review or sources: %j',
    async (options) => {
      await expect(
        bindRegisteredLineageForPromotion(promotionTransaction(options), {
          registrationId: registration().registrationId,
          candidateId: candidate().candidateId,
          environment: 'test_fixture',
        })
      ).rejects.toThrow(/current/);
    }
  );
  it('binds exact facts and partial dates without creating authority', () => {
    const result = registration();
    expect(result.content.records[0]).toEqual(registrationRecord());
    expect(reviewedPickLineageApprovalEvidence(result)).toEqual({
      schemaVersion: 'afl-trade-reviewed-pick-lineage-approval/v1',
      registrationId: result.registrationId,
      candidateId: candidate().candidateId,
      environment: 'test_fixture',
      publicationEligible: false,
    });
  });
  it.each(['environment', 'endpoint', 'date', 'evidence'])(
    'rejects stale approval subject after %s changes',
    (field) => {
      const result = registration();
      if (field === 'environment') result.content.environment = 'production';
      if (field === 'endpoint') result.content.records[0].acceptedTradeTimePick = 58;
      if (field === 'date')
        result.content.records[0].movements[0].occurredAt = {
          precision: 'day',
          date: '2012-10-01',
        };
      if (field === 'evidence') result.content.records[0].movements[0].source!.rowOrdinals = [2];
      expect(reviewedPickLineageRegistrationSchema.safeParse(result).success).toBe(false);
      expect(() => reviewedPickLineageApprovalEvidence(result)).toThrow();
    }
  );
  it('rejects incomplete endpoint and duplicate transfer before registration', () => {
    const missingPlayer = registrationRecord();
    if (missingPlayer.endpoint.kind === 'rookie_elevation') missingPlayer.endpoint.playerId = null;
    expect(() => registration([missingPlayer])).toThrow();
    expect(() => registration([registrationRecord(), registrationRecord()])).toThrow();
    expect(() => registration([])).toThrow();
  });
  it('preserves trade-time and live picks, rookie outcome and year precision without admitting facts', () => {
    const result = bindReviewedPickLineage(candidate(), [record()]);
    expect(result.canonicalAdmission).toBe(false);
    expect(result.records[0]).toEqual(record());
  });
  it.each([
    { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 67 },
    { kind: 'not_exercised', draftYear: 2013, draftType: 'national', recordedPick: 76 },
    {
      kind: 'incorporated_into_later_package',
      onwardTransactionIds: [],
      packageDescription: 'Part of a later exchange',
    },
  ])('represents $kind without a fabricated player', (endpoint) => {
    expect(reviewedPickEndpointSchema.safeParse(endpoint).success).toBe(true);
    expect(
      reviewedPickEndpointSchema.safeParse({ ...endpoint, playerId: 'invented' }).success
    ).toBe(false);
  });
  it('accepts explicitly ordered same-year movements and ultimate attribution', () => {
    const value = record();
    value.movements.push({
      transferId: null,
      source: {
        nativeEventId: 'fixture-onward',
        sourceUrl: 'https://example.test/onward',
        retainedAssetLabel: 'Pick 57',
        artifact: value.evidence[0],
        rowOrdinals: [1, 2],
      },
      fromClubId: 'gold-coast',
      toClubId: 'other-club',
      occurredAt: { precision: 'year', year: 2012 },
      predecessorOrdinal: 0,
    });
    value.attribution = 'ultimate';
    if (value.endpoint.kind === 'rookie_elevation') value.endpoint.exercisingClubId = 'other-club';
    expect(bindReviewedPickLineage(candidate(), [value]).records[0]).toEqual(value);
    value.attribution = 'direct';
    expect(() => reviewedPickLineageSchema.parse(value)).toThrow();
  });
  it('rejects disconnected holders and missing explicit predecessors', () => {
    for (const movement of [
      { fromClubId: 'wrong', predecessorOrdinal: 0 },
      { fromClubId: 'gold-coast', predecessorOrdinal: null },
    ]) {
      const value = record();
      value.attribution = 'ultimate';
      value.endpoint = { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 67 };
      value.movements.push({
        transferId: null,
        toClubId: 'other',
        occurredAt: { precision: 'year', year: 2012 },
        ...movement,
      });
      expect(() => reviewedPickLineageSchema.parse(value)).toThrow();
    }
  });
  it('rejects impossible chronology hidden by an intervening year-only date', () => {
    const value = record();
    value.attribution = 'ultimate';
    value.endpoint = { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 67 };
    value.movements[0].occurredAt = { precision: 'day', date: '2012-10-10' };
    value.movements.push(
      {
        transferId: null,
        fromClubId: 'gold-coast',
        toClubId: 'other',
        occurredAt: { precision: 'year', year: 2012 },
        predecessorOrdinal: 0,
      },
      {
        transferId: null,
        fromClubId: 'other',
        toClubId: 'last',
        occurredAt: { precision: 'day', date: '2012-01-01' },
        predecessorOrdinal: 1,
      }
    );
    expect(() => reviewedPickLineageSchema.parse(value)).toThrow(/chronological/);
  });
  it('rejects duplicate reviews, substituted candidates, clubs, dates and source labels', () => {
    expect(() => bindReviewedPickLineage(candidate(), [record(), record()])).toThrow();
    for (const mutate of [
      (r: ReviewedPickLineage) => {
        r.candidateId = `external-reconciliation:${'f'.repeat(64)}`;
      },
      (r: ReviewedPickLineage) => {
        r.movements[0].fromClubId = 'wrong';
      },
      (r: ReviewedPickLineage) => {
        r.movements[0].occurredAt = { precision: 'year', year: 2011 };
      },
      (r: ReviewedPickLineage) => {
        r.retainedSourceLabel = 'Pick 57';
      },
    ]) {
      const value = record();
      mutate(value);
      expect(() => bindReviewedPickLineage(candidate(), [value])).toThrow();
    }
  });
  it('requires retained source evidence for supplementary movements', () => {
    const value = record();
    value.attribution = 'ultimate';
    value.endpoint = { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 67 };
    value.movements.push({
      transferId: null,
      fromClubId: 'gold-coast',
      toClubId: 'other',
      occurredAt: { precision: 'year', year: 2012 },
      predecessorOrdinal: 0,
    });
    expect(() => reviewedPickLineageSchema.parse(value)).toThrow(/exact retained source/);
    value.movements[1].source = {
      nativeEventId: 'fixture-onward',
      sourceUrl: 'https://example.test/onward',
      retainedAssetLabel: 'Pick 55',
      artifact: value.evidence[0],
      rowOrdinals: [1, 2],
    };
    expect(reviewedPickLineageSchema.safeParse(value).success).toBe(true);
    value.movements[1].source.artifact = createAflTradeByteArtifactRef(
      new TextEncoder().encode('Other bytes'),
      'text/html',
      '2026-09-13T00:00:00Z'
    );
    expect(() => reviewedPickLineageSchema.parse(value)).toThrow(/evidence set/);
  });

  it.each(['nativeEventId', 'retainedAssetLabel'] as const)(
    'rejects a substituted source %s on an existing transfer',
    (field) => {
      const value = record();
      value.movements[0].source = {
        nativeEventId: 'fixture-caddy',
        sourceUrl: 'https://example.test/caddy',
        retainedAssetLabel: 'Pick 55',
        artifact: value.evidence[0],
        rowOrdinals: [1, 2],
      };
      expect(bindReviewedPickLineage(candidate(), [value]).records).toEqual([value]);
      value.movements[0].source[field] = 'wrong';
      expect(() => bindReviewedPickLineage(candidate(), [value])).toThrow();
    }
  );
  it('reports unresolved players without turning a valid preview into admission', async () => {
    const retained = candidate();
    const client: AflOutcomeSqlClient = {
      async query<Row>(sql: string) {
        const rows = sql.includes('outcome_external_reconciliation_candidate')
          ? [
              {
                candidate_json: retained,
                status: 'finalized',
                finalized_at: '2026-09-13T00:00:00Z',
              },
            ]
          : [];
        if (!sql.startsWith('SELECT') && sql !== 'SET TRANSACTION READ ONLY')
          throw new Error('Unexpected write');
        return { rows: rows as Row[], rowCount: rows.length };
      },
      transaction: (work) => work(client),
    };
    const result = await previewReviewedPickLineage(client, {
      candidateId: retained.candidateId,
      environment: 'test_fixture',
      records: [record()],
    });
    expect(result.unresolvedPlayerTransfers).toEqual([transferId]);
    expect(result.canonicalAdmission).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.currentAuthorityAuthenticated).toBe(false);
    await expect(
      previewReviewedPickLineage(client, {
        candidateId: retained.candidateId,
        environment: 'production',
        records: [record()],
      })
    ).rejects.toThrow(/environment/);
  });

  it('refuses absent and unfinished candidate snapshots', async () => {
    for (const state of [
      [],
      [{ candidate_json: candidate(), status: 'open', finalized_at: null }],
    ]) {
      const client: AflOutcomeSqlClient = {
        async query<Row>(sql: string) {
          return { rows: (sql.startsWith('SELECT') ? state : []) as Row[], rowCount: state.length };
        },
        transaction: (work) => work(client),
      };
      await expect(
        previewReviewedPickLineage(client, {
          candidateId: candidate().candidateId,
          environment: 'test_fixture',
          records: [record()],
        })
      ).rejects.toThrow(/finalized/);
    }
  });
});
