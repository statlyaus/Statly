import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { derivePrivateGovernedPickEvidenceV3 } from '@/server/aflTradeIntelligence/valuation/privateGovernedPickEvidenceV3';
import { privateGovernedPlayerEvidenceAdmissionSchema } from '@/server/aflTradeIntelligence/valuation/privateGovernedPlayerEvidence';
import { loadPostgresPrivateValuationPickLineage } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationPickLineage';

const addressed = (prefix: string, value: string) =>
  createAflTradeContentAddress(prefix, { value });
const releaseId = addressed('outcome-release', 'evaluation-evidence-release');
const admittedAt = '2026-08-18T00:00:00.000Z';

function selectedPlayerAdmission(input: {
  confirmedResultArtifact: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;
  assetId: string;
}) {
  const calculationArtifact = createAflTradeCanonicalJsonArtifactRef(
    { calculation: 'selected-player-2026' },
    admittedAt
  );
  const coverageEvidenceRef = createAflTradeCanonicalJsonArtifactRef(
    { coverage: 'selected-player-2026-right-censored' },
    admittedAt
  );
  const content = {
    schemaVersion: 'private-governed-player-evidence/v2' as const,
    environment: 'non_production' as const,
    authority: 'exact_finalized_hpn_season_calculations' as const,
    confirmedResultArtifact: input.confirmedResultArtifact,
    assetId: input.assetId,
    canonicalPlayerId: 'player:selected',
    receivingClubId: 'club:receiver',
    acquisitionSpellVersionId: addressed('acquisition-spell-version', 'selected'),
    acquisitionSpellStartDate: '2025-11-20',
    acquisitionSpellEndDate: null,
    tradeYear: 2025,
    knowledgeCutoffAt: admittedAt,
    methodId: addressed('hpn-pav-method', 'reviewed-method'),
    valueUnitId: 'season_pav' as const,
    horizons: [
      {
        kind: 'current_season' as const,
        coverage: 'right_censored' as const,
        season: 2026,
        gamesPlayed: 12,
        effectiveThrough: admittedAt,
        calculationId: addressed('hpn-pav-season', 'selected-player-2026'),
        calculationArtifact,
        coverageEvidenceRef,
        inputSetId: addressed('hpn-pav-input-set', 'selected-player-2026'),
        factualRunId: addressed('factual-reconciliation-run', 'selected-player-2026'),
        sourceRowIds: ['source-row:selected-player-2026'],
        source: {
          totalPoints: 12,
          hitOuts: 0,
          goalAssists: 3,
          inside50s: 12,
          marks: 24,
          marksInside50: 2,
          freeKicksFor: 4,
          freeKicksAgainst: 3,
          rebound50s: 8,
          onePercenters: 10,
          clearances: 20,
          tackles: 32,
        },
        components: {
          offensiveScore: 1,
          midfieldScore: 2,
          defensiveScore: 3,
          offensivePav: 10,
          midfieldPav: 20,
          defensivePav: 30,
          totalPav: 60,
        },
      },
    ],
    evidenceRefs: [
      input.confirmedResultArtifact,
      calculationArtifact,
      coverageEvidenceRef,
    ].sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    admittedAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Exact private local non-production player evidence only; missing seasons remain unavailable and no model, grade, publication, or production authority is granted.' as const,
  };
  return privateGovernedPlayerEvidenceAdmissionSchema.parse({
    admissionId: createAflTradeContentAddress('private-governed-player-evidence', content),
    content,
  });
}

describe('private governed pick evidence v3', () => {
  it('admits an unexercised pick as an explicit factual state with its conserved frontier', async () => {
    const transaction = {
      query: vi.fn(async () => ({
        rows: [
          {
            facts_json: {
              transfers: [
                {
                  assetVersionId: 'event-asset-version:root',
                  eventVersionId: 'event-version:trade',
                  eventDate: '2025-10-15T00:00:00.000Z',
                  recordedAt: '2025-10-15T00:00:00.000Z',
                  assetKind: 'future_pick',
                  playerId: null,
                  pickId: 'pick:2026:future-first',
                  draftYear: 2026,
                  fromClubId: 'club:giver',
                  toClubId: 'club:receiver',
                  evidenceId: 'release-member:root',
                },
              ],
              pickTransformations: [],
              custodyObservations: [],
              realizations: [
                {
                  realizationId: 'pick-realization:unrelated',
                  transferAssetVersionId: 'event-asset-version:unrelated',
                  pickId: 'pick:2026:unrelated',
                  draftSelectionId: 'draft-selection:unrelated',
                  recordedAt: '2026-01-01T00:00:00.000Z',
                  evidenceId: 'release-member:unrelated-realization',
                },
              ],
              selections: [],
              acquisitionSpells: [],
            },
            membership_json: {
              schemaVersion: 'private-pick-lineage-postgres-readback/v1',
              releaseId,
              rootAssetVersionId: 'event-asset-version:root',
              members: [
                {
                  kind: 'event_asset',
                  id: 'event-asset-version:root',
                  recordSha256: 'a'.repeat(64),
                },
              ],
            },
          },
        ],
        rowCount: 1,
      })),
    } satisfies AflOutcomeSqlTransaction;
    const lineage = await loadPostgresPrivateValuationPickLineage(transaction, {
      factualReleaseId: releaseId,
      assetId: 'asset:future-first',
      assetVersionId: 'event-asset-version:root',
      assetKind: 'future_pick',
      receivingClubId: 'club:receiver',
      tradeEffectiveAt: '2025-10-15T00:00:00.000Z',
      knowledgeCutoffAt: admittedAt,
      admittedAt,
    });
    if (lineage.state !== 'ready') {
      throw new Error(`Expected authenticated lineage: ${JSON.stringify(lineage)}`);
    }

    const admissionInput = {
      confirmedResultArtifact: createAflTradeCanonicalJsonArtifactRef(
        { confirmed: 'trade' },
        admittedAt
      ),
      asset: {
        assetId: 'asset:future-first',
        transferAssetVersionId: 'event-asset-version:root',
        receivingClubId: 'club:receiver',
        factualReleaseId: releaseId,
        tradeKnowledgeCutoffAt: '2025-10-15T00:00:00.000Z',
        knowledgeCutoffAt: admittedAt,
      },
      lineage,
      frontierPlayerEvidence: [],
      realizedSelectedPlayerEvidence: null,
      admittedAt,
    } as const;
    const result = derivePrivateGovernedPickEvidenceV3(admissionInput);

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected governed pick evidence.');
    expect(result.admission.content).toMatchObject({
      schemaVersion: 'private-governed-pick-evidence/v3',
      assetId: 'asset:future-first',
      realizationAtCutoff: {
        state: 'unrealized',
        reason: 'draft_selection_not_yet_recorded',
      },
      frontierAssets: [
        {
          assetId: 'asset:future-first',
          assetType: 'future_pick_entitlement',
          identity: { kind: 'pick', pickId: 'pick:2026:future-first' },
        },
      ],
      atTradeValueAuthority: 'governed_pick_model_required',
      remainingValueAuthority: 'governed_pick_model_required',
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'lineage_readback' }),
        expect.objectContaining({ role: 'lineage_graph' }),
      ])
    );

    const ambiguousResult = derivePrivateGovernedPickEvidenceV3({
      ...admissionInput,
      lineage: {
        ...lineage,
        facts: {
          ...lineage.facts,
          realizations: [
            ...lineage.facts.realizations,
            ...['first', 'second'].map((suffix) => ({
              realizationId: `pick-realization:${suffix}`,
              transferAssetVersionId: 'event-asset-version:root',
              pickId: 'pick:2026:future-first',
              draftSelectionId: `draft-selection:${suffix}`,
              recordedAt: admittedAt,
              evidenceId: `release-member:realization:${suffix}`,
            })),
          ],
        },
      },
    });
    expect(ambiguousResult).toEqual({
      state: 'unavailable',
      assetId: 'asset:future-first',
      reasons: ['pick_realization_ambiguous'],
    });
  });

  it('admits an exercised pick from exact evaluated selection and player-horizon evidence', async () => {
    const transaction = {
      query: vi.fn(async () => ({
        rows: [
          {
            facts_json: {
              transfers: [
                {
                  assetVersionId: 'event-asset-version:root',
                  eventVersionId: 'event-version:trade',
                  eventDate: '2024-10-15T00:00:00.000Z',
                  recordedAt: '2024-10-15T00:00:00.000Z',
                  assetKind: 'future_pick',
                  playerId: null,
                  pickId: 'pick:2025:first',
                  draftYear: 2025,
                  fromClubId: 'club:giver',
                  toClubId: 'club:receiver',
                  evidenceId: 'release-member:root',
                },
              ],
              pickTransformations: [
                {
                  edgeId: 'pick-lineage-edge:future-to-final',
                  parentPickId: 'pick:2025:first',
                  childPickId: 'pick:2025:final-first',
                  relationKind: 'future_right_resolved_to_pick',
                  effectiveAt: '2025-11-01T00:00:00.000Z',
                  knownFrom: '2025-11-01T00:00:00.000Z',
                  evidenceId: 'release-member:pick-lineage',
                },
              ],
              custodyObservations: [],
              realizations: [
                {
                  realizationId: 'pick-realization:root',
                  transferAssetVersionId: 'event-asset-version:root',
                  pickId: 'pick:2025:final-first',
                  draftSelectionId: 'draft-selection:first',
                  recordedAt: '2025-11-21T00:00:00.000Z',
                  evidenceId: 'release-member:realization',
                },
              ],
              selections: [
                {
                  selectionId: 'draft-selection:first',
                  pickId: 'pick:2025:final-first',
                  playerId: 'player:selected',
                  clubId: 'club:receiver',
                  eventDate: '2025-11-20T00:00:00.000Z',
                  recordedAt: '2025-11-21T00:00:00.000Z',
                  evidenceId: 'release-member:selection',
                },
              ],
              acquisitionSpells: [
                {
                  spellVersionId: addressed('acquisition-spell-version', 'selected'),
                  startAssetVersionId: 'event-asset-version:selected-player',
                  playerId: 'player:selected',
                  clubId: 'club:receiver',
                  startDate: '2025-11-20T00:00:00.000Z',
                  endDate: null,
                  recordedAt: '2025-11-21T00:00:00.000Z',
                  evidenceId: 'release-member:selected-spell',
                },
              ],
            },
            membership_json: {
              schemaVersion: 'private-pick-lineage-postgres-readback/v1',
              releaseId,
              rootAssetVersionId: 'event-asset-version:root',
              members: [
                { kind: 'acquisition_spell', id: 'spell:selected', recordSha256: 'a'.repeat(64) },
                { kind: 'draft_selection', id: 'draft-selection:first', recordSha256: 'b'.repeat(64) },
                { kind: 'event_asset', id: 'event-asset-version:root', recordSha256: 'c'.repeat(64) },
                { kind: 'event_version', id: 'event-version:trade', recordSha256: 'd'.repeat(64) },
                { kind: 'pick_lineage', id: 'pick-lineage-edge:future-to-final', recordSha256: 'e'.repeat(64) },
                { kind: 'pick_realization', id: 'pick-realization:root', recordSha256: 'f'.repeat(64) },
              ],
            },
          },
        ],
        rowCount: 1,
      })),
    } satisfies AflOutcomeSqlTransaction;
    const confirmedResultArtifact = createAflTradeCanonicalJsonArtifactRef(
      { confirmed: 'trade' },
      admittedAt
    );
    const lineage = await loadPostgresPrivateValuationPickLineage(transaction, {
      factualReleaseId: releaseId,
      assetId: 'asset:future-first',
      assetVersionId: 'event-asset-version:root',
      assetKind: 'future_pick',
      receivingClubId: 'club:receiver',
      tradeEffectiveAt: '2024-10-15T00:00:00.000Z',
      knowledgeCutoffAt: admittedAt,
      admittedAt,
    });
    if (lineage.state !== 'ready') {
      throw new Error(`Expected authenticated lineage: ${JSON.stringify(lineage)}`);
    }
    const selectedPlayer = lineage.materialization.realizationAtCutoff;
    if (selectedPlayer.state !== 'selected') throw new Error('Expected selected outcome.');
    const admission = selectedPlayerAdmission({
      confirmedResultArtifact,
      assetId: selectedPlayer.selectedPlayer.assetId,
    });

    const result = derivePrivateGovernedPickEvidenceV3({
      confirmedResultArtifact,
      asset: {
        assetId: 'asset:future-first',
        transferAssetVersionId: 'event-asset-version:root',
        receivingClubId: 'club:receiver',
        factualReleaseId: releaseId,
        tradeKnowledgeCutoffAt: '2024-10-15T00:00:00.000Z',
        knowledgeCutoffAt: admittedAt,
      },
      lineage,
      frontierPlayerEvidence: [
        { frontierAssetId: selectedPlayer.selectedPlayer.assetId, admission },
      ],
      realizedSelectedPlayerEvidence: admission,
      admittedAt,
    });

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected governed pick evidence.');
    expect(result.admission.content.realizationAtCutoff).toMatchObject({
      state: 'selected',
      attribution: 'credited_current_frontier',
      realizationId: 'pick-realization:root',
      selection: {
        selectionId: 'draft-selection:first',
        playerId: 'player:selected',
        clubId: 'club:receiver',
      },
      selectedPlayerEvidence: {
        admissionId: admission.admissionId,
        admissionArtifact: expect.objectContaining({
          artifactId: expect.stringMatching(/^artifact:/u),
        }),
      },
    });
    expect(result.admission.content.evidenceRefs).toEqual(
      expect.arrayContaining(
        admission.content.evidenceRefs.map((reference) =>
          expect.objectContaining({ artifactId: reference.artifactId })
        )
      )
    );
  });
});
