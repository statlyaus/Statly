import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradePickPavObservation } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { admitPrivateGovernedPickEvidence } from '@/server/aflTradeIntelligence/valuation/privateGovernedPickEvidence';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const admittedAt = '2026-08-18T00:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, admittedAt);

function observation() {
  const calculationId = addressed('hpn-pav-season', 'selected-player-2022');
  return createAflTradePickPavObservation({
    ordinal: 1,
    partition: 'final_test',
    predictionCutoffAt: '2021-11-20T23:59:59.999Z',
    outcomeHorizonEndsAt: '2022-12-31T23:59:59.000Z',
    outcomeObservedAt: '2023-01-01T00:00:00.000Z',
    selection: {
      releaseId: addressed('outcome-release', 'canonical-release'),
      selectionId: addressed('draft-selection', '2021-selection-14'),
      eventId: 'draft:2021:national',
      eventVersionId: addressed('event-version', '2021-national-draft'),
      eventDate: '2021-11-20',
      recordedAt: '2021-11-21T00:00:00.000Z',
      draftYear: 2021,
      pathway: 'national',
      actualSelectionNumber: 14,
      nominalSelectionNumber: 14,
      draftRound: 1,
      pickId: 'pick:2021:national:14',
      playerId: 'local-afl-player:selected',
      clubId: 'local-afl-club:receiving',
      access: {
        state: 'open',
        decision: {
          id: addressed('review-decision', 'open-selection'),
          sha256: sha('open-selection'),
        },
        recordedAt: '2021-11-22T00:00:00.000Z',
      },
    },
    requiredCalculationSeasons: [2022],
    calculationIds: [calculationId],
    playerValues: [
      {
        calculationId,
        calculationSha256: calculationId.split(':')[1]!,
        seasonYear: 2022,
        spellVersionId: addressed('acquisition-spell-version', 'selected-player-spell'),
        playerId: 'local-afl-player:selected',
        playerSha256: sha('selected-player'),
        clubId: 'local-afl-club:receiving',
        sourceRowIds: ['decoded-row:selected:1', 'decoded-row:selected:2'],
        gamesPlayed: 2,
        totalPav: 66,
      },
    ],
    outcome: {
      state: 'mature_observed',
      contribution: 66,
      gamesPlayed: 2,
      category: 'high_quality',
    },
  });
}

function input() {
  const retainedObservation = observation();
  const lineage = {
    rootPickId: 'pick:2021:national:future-round-1',
    finalPickId: 'pick:2021:national:14',
    edges: [
      {
        edgeId: addressed('pick-lineage-edge', 'future-to-final'),
        parentPickId: 'pick:2021:national:future-round-1',
        childPickId: 'pick:2021:national:14',
        relationKind: 'renumbered_to',
        sequence: 1,
        evidenceRef: evidence('lineage-edge'),
      },
    ],
  };
  const realization = {
    realizationId: addressed('pick-realization', 'asset-to-selection'),
    transferAssetVersionId: 'event-asset-version:pick-trade',
    pickId: 'pick:2021:national:14',
    draftSelectionId: retainedObservation.selection.selectionId,
    evidenceRef: evidence('pick-realization'),
  };
  const custody = {
    spells: [
      {
        custodyId: addressed('pick-custody-spell', 'future-pick-received'),
        pickId: lineage.rootPickId,
        clubId: 'local-afl-club:receiving',
        effectiveFrom: '2021-10-15T00:00:00.000Z',
        effectiveThrough: null,
        evidenceRef: evidence('future-pick-received-custody'),
      },
      {
        custodyId: addressed('pick-custody-spell', 'final-pick-receiving'),
        pickId: lineage.finalPickId,
        clubId: 'local-afl-club:receiving',
        effectiveFrom: '2021-10-15T00:00:00.000Z',
        effectiveThrough: null,
        evidenceRef: evidence('final-pick-receiving-custody'),
      },
    ],
  };
  return {
    confirmedResultArtifact: evidence('confirmed-result'),
    asset: {
      assetId: 'asset-future-pick',
      rootPickId: lineage.rootPickId,
      transferAssetVersionId: realization.transferAssetVersionId,
      receivingClubId: 'local-afl-club:receiving',
      draftYear: 2021,
      factualReleaseId: retainedObservation.selection.releaseId,
      tradeKnowledgeCutoffAt: '2021-10-15T23:59:59.999Z',
      knowledgeCutoffAt: admittedAt,
    },
    lineage,
    lineageArtifact: createAflTradeCanonicalJsonArtifactRef(lineage, admittedAt),
    custody,
    custodyArtifact: createAflTradeCanonicalJsonArtifactRef(custody, admittedAt),
    realization,
    realizationArtifact: createAflTradeCanonicalJsonArtifactRef(realization, admittedAt),
    observation: retainedObservation,
    observationArtifact: createAflTradeCanonicalJsonArtifactRef(retainedObservation, admittedAt),
    admittedAt,
  };
}

describe('private governed pick evidence', () => {
  it('admits exact root-to-selection lineage and selected-player realized contribution', () => {
    const result = admitPrivateGovernedPickEvidence(input());

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected governed pick evidence.');
    expect(result.admission.content).toMatchObject({
      assetId: 'asset-future-pick',
      rootPickId: 'pick:2021:national:future-round-1',
      finalSelection: {
        selectionId: observation().selection.selectionId,
        actualSelectionNumber: 14,
        selectedPlayerId: 'local-afl-player:selected',
      },
      realizedContribution: {
        state: 'mature_observed',
        contribution: 66,
        gamesPlayed: 2,
      },
      selectedPlayerHorizons: [
        {
          kind: 'completed_season',
          coverage: 'complete',
          season: 2022,
          gamesPlayed: 2,
          totalPav: 66,
          calculationId: addressed('hpn-pav-season', 'selected-player-2022'),
          effectiveThrough: '2023-01-01T00:00:00.000Z',
        },
      ],
      atTradeValueAuthority: 'governed_pick_model_required',
      remainingValueAuthority: 'governed_pick_model_required',
      publicationProhibited: true,
    });
  });

  it('keeps the pick unavailable when canonical lineage is not contiguous', () => {
    const broken = input();
    broken.lineage.edges[0] = {
      ...broken.lineage.edges[0]!,
      parentPickId: 'pick:2021:national:unrelated',
    };
    broken.lineageArtifact = createAflTradeCanonicalJsonArtifactRef(broken.lineage, admittedAt);

    expect(admitPrivateGovernedPickEvidence(broken)).toMatchObject({
      state: 'unavailable',
      assetId: 'asset-future-pick',
      reasons: ['pick_lineage_not_contiguous'],
    });
  });

  it('admits a received pick selected by a later custodian without inventing a lineage edge', () => {
    const onTraded = input();
    const { observationId: _observationId, ...observationContent } = onTraded.observation;
    onTraded.observation = createAflTradePickPavObservation({
      ...observationContent,
      selection: {
        ...observationContent.selection,
        clubId: 'local-afl-club:later-custodian',
      },
      playerValues: observationContent.playerValues.map((value) => ({
        ...value,
        clubId: 'local-afl-club:later-custodian',
      })),
    });
    onTraded.observationArtifact = createAflTradeCanonicalJsonArtifactRef(
      onTraded.observation,
      admittedAt
    );
    onTraded.custody.spells[1] = {
      ...onTraded.custody.spells[1]!,
      effectiveThrough: '2021-11-01T00:00:00.000Z',
    };
    onTraded.custody.spells.push({
      custodyId: addressed('pick-custody-spell', 'final-pick-later-custodian'),
      pickId: onTraded.lineage.finalPickId,
      clubId: 'local-afl-club:later-custodian',
      effectiveFrom: '2021-11-01T00:00:00.000Z',
      effectiveThrough: null,
      evidenceRef: evidence('final-pick-later-custodian-custody'),
    });
    onTraded.custodyArtifact = createAflTradeCanonicalJsonArtifactRef(
      onTraded.custody,
      admittedAt
    );

    const result = admitPrivateGovernedPickEvidence(onTraded);
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected on-traded pick evidence.');
    expect(result.admission.content.finalSelection.selectingClubId).toBe(
      'local-afl-club:later-custodian'
    );
    expect(result.admission.content.receivingClubId).toBe('local-afl-club:receiving');
    expect(result.admission.content.lineage.edges).toHaveLength(1);
  });
});
