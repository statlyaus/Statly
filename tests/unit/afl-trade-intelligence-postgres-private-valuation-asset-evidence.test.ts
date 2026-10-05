import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { inspectPostgresPrivateValuationAssetEvidence } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationAssetEvidence';

const addressed = (prefix: string, value: string) =>
  createAflTradeContentAddress(prefix, { value });

function selectedPlayerCalculation(input: {
  methodId: string;
  spellVersionId: string;
  calculatedAt: string;
}) {
  const source = {
    totalPoints: 10,
    hitOuts: 1,
    goalAssists: 2,
    inside50s: 3,
    marks: 4,
    marksInside50: 1,
    freeKicksFor: 2,
    freeKicksAgainst: 1,
    rebound50s: 2,
    onePercenters: 3,
    clearances: 4,
    tackles: 5,
  };
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: 'club:receiver',
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [
        {
          spellVersionId: input.spellVersionId,
          playerId: 'player:selected',
          sourceRowIds: ['row:selected:2026'],
          ...source,
        },
      ],
    },
    {
      teamId: 'club:comparison',
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', 'comparison'),
          playerId: 'player:comparison',
          sourceRowIds: ['row:comparison:2026'],
          ...source,
        },
      ],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    seasonYear: 2026,
    effectiveThrough: input.calculatedAt,
    calculatedAt: input.calculatedAt,
    methodId: input.methodId,
    inputSetId: addressed('hpn-pav-input-set', 'selected-2026'),
    inputSetSha256: addressed('fixture', 'selected-input').split(':')[1]!,
    factualRunId: addressed('factual-reconciliation-run', 'selected-2026'),
    factualInputSetSha256: addressed('fixture', 'selected-facts').split(':')[1]!,
    primaryProviders: ['retained_primary'],
    corroboratingProviders: ['retained_corroborating'],
    resultSourceRowIds: ['row:result:2026'],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: { ...player.source, gamesPlayed: 1 },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

describe('PostgreSQL private valuation asset evidence', () => {
  it('keeps missing current player HPN and unresolved pick lineage asset-scoped and unavailable', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const transaction = { query } satisfies AflOutcomeSqlTransaction;
    const confirmedResultArtifact = createAflTradeCanonicalJsonArtifactRef(
      { confirmed: 'sam-flanders-trade' },
      '2026-05-28T12:00:00.000Z'
    );

    const result = await inspectPostgresPrivateValuationAssetEvidence(transaction, {
      confirmedResultArtifact,
      factualReleaseId: addressed('outcome-release', 'canonical-release'),
      tradeOccurredOn: '2025-10-15',
      knowledgeCutoffAt: '2026-05-28T12:00:00.000Z',
      hpnPavMethodId: addressed('hpn-pav-method', 'reviewed-hpn-method'),
      admittedAt: '2026-05-28T12:00:00.000Z',
      assets: [
        {
          assetId: 'asset-sam-flanders',
          assetVersionId: addressed('event-asset-version', 'sam-flanders-transfer'),
          assetKind: 'player',
          receivingClubId: 'local-afl-club:st-kilda',
          canonicalPlayerId: 'local-afl-player:sam-flanders',
          acquisitionSpell: {
            spellVersionId: addressed(
              'acquisition-spell-version',
              'sam-flanders-st-kilda'
            ),
            startDate: '2025-10-15',
            endDate: null,
          },
        },
        {
          assetId: 'asset-future-first-round-pick',
          assetVersionId: addressed('event-asset-version', 'future-first-transfer'),
          assetKind: 'future_pick',
          receivingClubId: 'local-afl-club:gold-coast',
          canonicalPlayerId: null,
          acquisitionSpell: null,
        },
      ],
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("calculation.environment='non_production'"),
      [
        addressed('hpn-pav-method', 'reviewed-hpn-method'),
        [2026],
        '2026-05-28T12:00:00.000Z',
      ]
    );
    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'player_hpn_horizon_missing',
        authorityClass: 'player_horizon',
        assetId: 'asset-sam-flanders',
        message: expect.stringContaining('hpn_season_calculation_missing'),
      }),
      expect.objectContaining({
        code: 'pick_lineage_missing',
        authorityClass: 'pick_lineage',
        assetId: 'asset-future-first-round-pick',
      }),
    ]);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        role: 'player_evidence',
        document: expect.objectContaining({
          season: 2026,
          kind: 'current_season',
          coverage: 'right_censored',
          calculationId: null,
        }),
      }),
    ]);
  });

  it('derives an explicit v3 unrealized admission from exact pick lineage', async () => {
    const releaseId = addressed('outcome-release', 'evaluation-evidence-release');
    const query = vi.fn(async (sql: string) => {
      if (!sql.includes('private-pick-lineage-exact-release-readback')) {
        throw new Error('Unexpected evidence query.');
      }
      return {
        rows: [
          {
            facts_json: {
              transfers: [
                {
                  assetVersionId: 'event-asset-version:pick-root',
                  eventVersionId: 'event-version:trade',
                  eventDate: '2025-10-15T00:00:00.000Z',
                  recordedAt: '2025-10-15T00:00:00.000Z',
                  assetKind: 'future_pick',
                  playerId: null,
                  pickId: 'pick:2026:future-first',
                  draftYear: 2026,
                  fromClubId: 'club:giver',
                  toClubId: 'club:receiver',
                  evidenceId: 'release-member:pick-root',
                },
              ],
              pickTransformations: [],
              custodyObservations: [],
              realizations: [],
              selections: [],
              acquisitionSpells: [],
            },
            membership_json: {
              schemaVersion: 'private-pick-lineage-postgres-readback/v1',
              releaseId,
              rootAssetVersionId: 'event-asset-version:pick-root',
              members: [
                {
                  kind: 'event_asset',
                  id: 'event-asset-version:pick-root',
                  recordSha256: 'b'.repeat(64),
                },
              ],
            },
          },
        ],
        rowCount: 1,
      };
    });
    const confirmedResultArtifact = createAflTradeCanonicalJsonArtifactRef(
      { confirmed: 'trade' },
      '2026-05-28T12:00:00.000Z'
    );

    const result = await inspectPostgresPrivateValuationAssetEvidence(
      { query } satisfies AflOutcomeSqlTransaction,
      {
        confirmedResultArtifact,
        factualReleaseId: releaseId,
        tradeOccurredOn: '2025-10-15',
        knowledgeCutoffAt: '2026-05-28T12:00:00.000Z',
        hpnPavMethodId: addressed('hpn-pav-method', 'reviewed-hpn-method'),
        admittedAt: '2026-05-28T12:00:00.000Z',
        assets: [
          {
            assetId: 'asset:future-first',
            assetVersionId: 'event-asset-version:pick-root',
            assetKind: 'future_pick',
            receivingClubId: 'club:receiver',
            canonicalPlayerId: null,
            acquisitionSpell: null,
          },
        ],
      }
    );

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'pick_evidence',
          document: expect.objectContaining({
            admissionId: expect.stringMatching(/^private-governed-pick-evidence:/u),
            content: expect.objectContaining({
              schemaVersion: 'private-governed-pick-evidence/v3',
              realizationAtCutoff: { 
                state: 'unrealized',
                reason: 'draft_selection_not_yet_recorded',
              },
            }),
          }),
        }),
      ])
    );
    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'pick_forecast_unavailable',
        assetId: 'asset:future-first',
      }),
    ]);
  });

  it('derives exercised-pick contribution evidence from the selected player spell', async () => {
    const releaseId = addressed('outcome-release', 'selected-evaluation-release');
    const cutoffAt = '2026-05-28T12:00:00.000Z';
    const methodId = addressed('hpn-pav-method', 'reviewed-hpn-method');
    const spellVersionId = addressed('acquisition-spell-version', 'selected-player');
    const calculation = selectedPlayerCalculation({
      methodId,
      spellVersionId,
      calculatedAt: cutoffAt,
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('private-pick-lineage-exact-release-readback')) {
        return {
          rows: [
            {
              facts_json: {
                transfers: [
                  {
                    assetVersionId: 'event-asset-version:pick-root',
                    eventVersionId: 'event-version:trade',
                    eventDate: '2024-10-15T00:00:00.000Z',
                    recordedAt: '2024-10-15T00:00:00.000Z',
                    assetKind: 'future_pick',
                    playerId: null,
                    pickId: 'pick:2025:future-first',
                    draftYear: 2025,
                    fromClubId: 'club:giver',
                    toClubId: 'club:receiver',
                    evidenceId: 'release-member:pick-root',
                  },
                ],
                pickTransformations: [
                  {
                    edgeId: 'pick-lineage-edge:future-to-final',
                    parentPickId: 'pick:2025:future-first',
                    childPickId: 'pick:2025:final-first',
                    relationKind: 'future_right_resolved_to_pick',
                    effectiveAt: '2025-11-01T00:00:00.000Z',
                    knownFrom: '2025-11-01T00:00:00.000Z',
                    evidenceId: 'release-member:lineage',
                  },
                ],
                custodyObservations: [],
                realizations: [
                  {
                    realizationId: 'pick-realization:root',
                    transferAssetVersionId: 'event-asset-version:pick-root',
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
                    spellVersionId,
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
                rootAssetVersionId: 'event-asset-version:pick-root',
                members: [
                  { kind: 'acquisition_spell', id: spellVersionId, recordSha256: 'a'.repeat(64) },
                  { kind: 'draft_selection', id: 'draft-selection:first', recordSha256: 'b'.repeat(64) },
                  { kind: 'event_asset', id: 'event-asset-version:pick-root', recordSha256: 'c'.repeat(64) },
                  { kind: 'event_version', id: 'event-version:trade', recordSha256: 'd'.repeat(64) },
                  { kind: 'pick_lineage', id: 'pick-lineage-edge:future-to-final', recordSha256: 'e'.repeat(64) },
                  { kind: 'pick_realization', id: 'pick-realization:root', recordSha256: 'f'.repeat(64) },
                ],
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("calculation.environment='non_production'")) {
        return {
          rows: [
            {
              calculation_json: calculation,
              actual_team_count: calculation.content.teams.length,
              actual_player_count: calculation.content.players.length,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error('Unexpected evidence query.');
    });
    const confirmedResultArtifact = createAflTradeCanonicalJsonArtifactRef(
      { confirmed: 'selected-pick-trade' },
      cutoffAt
    );

    const result = await inspectPostgresPrivateValuationAssetEvidence(
      { query } satisfies AflOutcomeSqlTransaction,
      {
        confirmedResultArtifact,
        factualReleaseId: releaseId,
        tradeOccurredOn: '2024-10-15',
        knowledgeCutoffAt: cutoffAt,
        hpnPavMethodId: methodId,
        admittedAt: cutoffAt,
        assets: [
          {
            assetId: 'asset:selected-pick',
            assetVersionId: 'event-asset-version:pick-root',
            assetKind: 'future_pick',
            receivingClubId: 'club:receiver',
            canonicalPlayerId: null,
            acquisitionSpell: null,
          },
        ],
      }
    );

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'pick_evidence',
          document: expect.objectContaining({
            content: expect.objectContaining({
              schemaVersion: 'private-governed-pick-evidence/v3',
              realizationAtCutoff: expect.objectContaining({
                state: 'selected',
                attribution: 'credited_current_frontier',
                selectedPlayerEvidence: expect.objectContaining({
                  admissionId: expect.stringMatching(/^private-governed-player-evidence:/u),
                }),
              }),
            }),
          }),
        }),
      ])
    );
    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'pick_forecast_unavailable',
        assetId: 'asset:selected-pick',
      }),
    ]);
  });
});
