import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { aflTradeFinalizedHpnPavCalculationSchema } from '../modeling/hpnPavCalculationService';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import type { PrivateEvaluationInspectionBlocker } from './governedPrivateTradeEvaluationContracts';
import type { PrivateEvaluationAuthorityEvidence } from './postgresPrivateEvaluationInspectionStore';
import {
  admitPrivateGovernedPlayerEvidence,
  derivePrivateGovernedPlayerRequiredHorizons,
  type PrivateGovernedPlayerEvidenceAdmission,
  type PrivateGovernedPlayerEvidenceAssetScope,
} from './privateGovernedPlayerEvidence';
import { derivePrivateGovernedPickEvidenceV3 } from './privateGovernedPickEvidenceV3';
import {
  loadPostgresPrivateValuationPickLineage,
  type PostgresPrivateValuationPickLineageResult,
} from './postgresPrivateValuationPickLineage';

interface CalculationRow {
  calculation_json: unknown;
  actual_team_count: number | string;
  actual_player_count: number | string;
}

interface TradeAsset {
  assetId: string;
  assetVersionId: string;
  assetKind: 'player' | 'pick' | 'future_pick';
  receivingClubId: string;
  canonicalPlayerId: string | null;
  acquisitionSpell: {
    spellVersionId: string;
    startDate: string;
    endDate: string | null;
  } | null;
}

type PickTradeAsset = TradeAsset & { assetKind: 'pick' | 'future_pick' };

interface PlayerEvidenceScope {
  scope: PrivateGovernedPlayerEvidenceAssetScope;
  directTradeAsset: boolean;
}

function registerPlayerScope(
  scopes: Map<string, PlayerEvidenceScope>,
  candidate: PlayerEvidenceScope
): void {
  const existing = scopes.get(candidate.scope.assetId);
  if (existing === undefined) {
    scopes.set(candidate.scope.assetId, candidate);
    return;
  }
  if (canonicalizeAflTradeJson(existing.scope) !== canonicalizeAflTradeJson(candidate.scope)) {
    throw new TypeError('Private player evidence scope has conflicting factual identities.');
  }
  if (candidate.directTradeAsset && !existing.directTradeAsset) {
    scopes.set(candidate.scope.assetId, { ...existing, directTradeAsset: true });
  }
}

function lineagePlayerScope(
  lineage: Extract<PostgresPrivateValuationPickLineageResult, { state: 'ready' }>,
  player: {
    assetId: string;
    identity: {
      playerId: string;
      acquisitionSpellVersionId: string | null;
    };
    acquisitionClubId: string;
  },
  knowledgeCutoffAt: string
): PrivateGovernedPlayerEvidenceAssetScope | null {
  if (player.identity.acquisitionSpellVersionId === null) return null;
  const spells = lineage.facts.acquisitionSpells.filter(
    ({ spellVersionId }) => spellVersionId === player.identity.acquisitionSpellVersionId
  );
  if (spells.length !== 1) return null;
  const spell = spells[0]!;
  if (
    spell.playerId !== player.identity.playerId ||
    spell.clubId !== player.acquisitionClubId
  ) {
    return null;
  }
  return {
    assetId: player.assetId,
    canonicalPlayerId: player.identity.playerId,
    receivingClubId: player.acquisitionClubId,
    acquisitionSpellVersionId: spell.spellVersionId,
    acquisitionSpellStartDate: spell.startDate.slice(0, 10),
    acquisitionSpellEndDate: spell.endDate?.slice(0, 10) ?? null,
    tradeYear: Number(spell.startDate.slice(0, 4)),
    knowledgeCutoffAt,
  };
}

function isPickTradeAsset(asset: TradeAsset): asset is PickTradeAsset {
  return asset.assetKind === 'pick' || asset.assetKind === 'future_pick';
}

export interface PrivateValuationAssetEvidenceInspection {
  evidence: readonly PrivateEvaluationAuthorityEvidence[];
  blockers: readonly PrivateEvaluationInspectionBlocker[];
}

function assetBlocker(input: {
  code: 'player_hpn_horizon_missing' | 'pick_lineage_missing' | 'pick_forecast_unavailable';
  authorityClass: 'player_horizon' | 'pick_lineage' | 'pick_forecast';
  classification: 'internal_evidence';
  assetId: string;
  message: string;
  evidenceRefs?: readonly AflTradeArtifactRef[];
}): PrivateEvaluationInspectionBlocker {
  return {
    ...input,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
  };
}

function iso(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private asset evidence requires valid retained chronology.');
  }
  return parsed.toISOString();
}

function uniqueEvidence(
  evidence: readonly PrivateEvaluationAuthorityEvidence[]
): PrivateEvaluationAuthorityEvidence[] {
  const result = new Map<string, PrivateEvaluationAuthorityEvidence>();
  for (const item of evidence) {
    const artifact =
      item.source === 'retained_artifact'
        ? item.artifact
        : createAflTradeCanonicalJsonArtifactRef(item.document, item.createdAt);
    result.set(`${item.role}|${artifact.artifactId}`, item);
  }
  return [...result.values()];
}

export async function inspectPostgresPrivateValuationAssetEvidence(
  transaction: AflOutcomeSqlTransaction,
  input: {
    confirmedResultArtifact: AflTradeArtifactRef;
    factualReleaseId: string;
    tradeOccurredOn: string;
    knowledgeCutoffAt: string;
    hpnPavMethodId: string;
    admittedAt: string;
    assets: readonly TradeAsset[];
  }
): Promise<PrivateValuationAssetEvidenceInspection> {
  const admittedAt = iso(input.admittedAt);
  const knowledgeCutoffAt = iso(input.knowledgeCutoffAt);
  if (Date.parse(knowledgeCutoffAt) > Date.parse(admittedAt)) {
    throw new TypeError('Private asset evidence cutoff cannot follow inspection time.');
  }
  const tradeYear = Number(input.tradeOccurredOn.slice(0, 4));
  if (!Number.isSafeInteger(tradeYear)) {
    throw new TypeError('Private asset evidence requires an exact trade year.');
  }
  const pickAssets = input.assets.filter(isPickTradeAsset);
  const pickLineages = new Map<string, PostgresPrivateValuationPickLineageResult>();
  for (const asset of pickAssets) {
    pickLineages.set(
      asset.assetId,
      await loadPostgresPrivateValuationPickLineage(transaction, {
        factualReleaseId: input.factualReleaseId,
        assetId: asset.assetId,
        assetVersionId: asset.assetVersionId,
        assetKind: asset.assetKind,
        receivingClubId: asset.receivingClubId,
        tradeEffectiveAt: `${input.tradeOccurredOn}T00:00:00.000Z`,
        knowledgeCutoffAt,
        admittedAt,
      })
    );
  }

  const playerScopes = new Map<string, PlayerEvidenceScope>();
  for (const asset of input.assets) {
    if (
      asset.assetKind !== 'player' ||
      asset.canonicalPlayerId === null ||
      asset.acquisitionSpell === null
    ) {
      continue;
    }
    registerPlayerScope(playerScopes, {
      directTradeAsset: true,
      scope: {
        assetId: asset.assetId,
        canonicalPlayerId: asset.canonicalPlayerId,
        receivingClubId: asset.receivingClubId,
        acquisitionSpellVersionId: asset.acquisitionSpell.spellVersionId,
        acquisitionSpellStartDate: asset.acquisitionSpell.startDate,
        acquisitionSpellEndDate: asset.acquisitionSpell.endDate,
        tradeYear,
        knowledgeCutoffAt,
      },
    });
  }
  for (const lineage of pickLineages.values()) {
    if (lineage.state !== 'ready') continue;
    const players = lineage.materialization.frontierAssets.filter(
      (asset) => asset.assetType === 'player'
    );
    const realization = lineage.materialization.realizationAtCutoff;
    if (realization.state === 'selected') players.push(realization.selectedPlayer);
    for (const player of players) {
      const scope = lineagePlayerScope(lineage, player, knowledgeCutoffAt);
      if (scope !== null) {
        registerPlayerScope(playerScopes, { scope, directTradeAsset: false });
      }
    }
  }
  const seasons = [
    ...new Set(
      [...playerScopes.values()].flatMap(({ scope }) =>
        derivePrivateGovernedPlayerRequiredHorizons(scope).map(({ season }) => season)
      )
    ),
  ].sort((left, right) => left - right);
  const calculations =
    seasons.length === 0
      ? { rows: [] as CalculationRow[] }
      : await transaction.query<CalculationRow>(
          `SELECT calculation.calculation_json,
                  (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_team team
                    WHERE team.calculation_id=calculation.calculation_id) AS actual_team_count,
                  (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_player player
                    WHERE player.calculation_id=calculation.calculation_id) AS actual_player_count
             FROM outcome_hpn_pav_calculation_head head
             JOIN outcome_hpn_pav_calculation calculation
               ON calculation.calculation_id=head.calculation_id
            WHERE calculation.environment='non_production'
              AND calculation.competition='AFLM'
              AND calculation.method_id=$1
              AND calculation.season_year=ANY($2::integer[])
              AND calculation.status='finalized'
              AND calculation.finalized_at IS NOT NULL
              AND calculation.calculated_at<=$3::timestamptz
              AND calculation.effective_through<=$3::timestamptz
            ORDER BY calculation.season_year
            FOR KEY SHARE OF head,calculation`,
          [input.hpnPavMethodId, seasons, knowledgeCutoffAt]
        );
  const calculationBySeason = new Map(
    calculations.rows.map((row) => {
      const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(
        row.calculation_json
      );
      if (
        calculation.content.methodId !== input.hpnPavMethodId ||
        calculation.content.teams.length !== Number(row.actual_team_count) ||
        calculation.content.players.length !== Number(row.actual_player_count)
      ) {
        throw new TypeError('Private player horizon calculation failed exact readback.');
      }
      return [calculation.content.seasonYear, calculation] as const;
    })
  );
  if (calculationBySeason.size !== calculations.rows.length) {
    throw new TypeError('Private player horizon calculation authority is ambiguous.');
  }

  const blockers: PrivateEvaluationInspectionBlocker[] = [];
  const evidence: PrivateEvaluationAuthorityEvidence[] = [];
  const playerAdmissions = new Map<string, PrivateGovernedPlayerEvidenceAdmission>();
  const unavailablePlayerEvidence = new Map<
    string,
    { message: string; evidenceRefs: readonly AflTradeArtifactRef[] }
  >();
  for (const { scope } of playerScopes.values()) {
    const required = derivePrivateGovernedPlayerRequiredHorizons(scope);
    if (required.length === 0) {
      unavailablePlayerEvidence.set(scope.assetId, {
        message: 'No post-trade player horizon can yet be derived for this acquisition spell.',
        evidenceRefs: [input.confirmedResultArtifact],
      });
      continue;
    }
    const expectedHorizons = required.map(({ kind, season }) => {
      const calculation = calculationBySeason.get(season) ?? null;
      const coverage = kind === 'completed_season' ? 'complete' : 'right_censored';
      const coverageDocument = {
        schemaVersion: 'private-player-horizon-coverage/v1',
        assetId: scope.assetId,
        acquisitionSpellVersionId: scope.acquisitionSpellVersionId,
        canonicalPlayerId: scope.canonicalPlayerId,
        receivingClubId: scope.receivingClubId,
        season,
        kind,
        coverage,
        knowledgeCutoffAt,
        calculationId: calculation?.calculationId ?? null,
        publicationEligible: false,
        publicationProhibited: true,
      };
      evidence.push({
        role: 'player_evidence',
        source: 'postgres_json',
        document: coverageDocument,
        createdAt: admittedAt,
      });
      if (calculation !== null) {
        evidence.push({
          role: 'player_evidence',
          source: 'postgres_json',
          document: calculation,
          createdAt: calculation.content.calculatedAt,
        });
      }
      return {
        kind,
        season,
        coverage,
        coverageEvidenceRef: createAflTradeCanonicalJsonArtifactRef(
          coverageDocument,
          admittedAt
        ),
        calculation,
        calculationArtifact:
          calculation === null
            ? null
            : createAflTradeCanonicalJsonArtifactRef(
                calculation,
                calculation.content.calculatedAt
              ),
      };
    });
    const admission = admitPrivateGovernedPlayerEvidence({
      confirmedResultArtifact: input.confirmedResultArtifact,
      asset: scope,
      expectedHorizons,
      admittedAt,
    });
    if (admission.state === 'unavailable') {
      unavailablePlayerEvidence.set(scope.assetId, {
        message: `Required HPN/PAV horizons are unavailable: ${admission.reasons.join(', ')}.`,
        evidenceRefs: admission.evidenceRefs,
      });
    } else {
      playerAdmissions.set(scope.assetId, admission.admission);
    }
  }
  for (const { scope, directTradeAsset } of playerScopes.values()) {
    if (!directTradeAsset) continue;
    const unavailable = unavailablePlayerEvidence.get(scope.assetId);
    if (unavailable !== undefined) {
      blockers.push(
        assetBlocker({
          code: 'player_hpn_horizon_missing',
          authorityClass: 'player_horizon',
          classification: 'internal_evidence',
          assetId: scope.assetId,
          ...unavailable,
        })
      );
      continue;
    }
    const admission = playerAdmissions.get(scope.assetId);
    if (admission === undefined) {
      throw new TypeError('Private direct-player evidence admission disappeared.');
    }
    evidence.push({
      role: 'player_evidence',
      source: 'postgres_json',
      document: admission,
      createdAt: admission.content.admittedAt,
    });
  }
  for (const asset of pickAssets) {
    const lineage = pickLineages.get(asset.assetId);
    if (lineage === undefined) {
      throw new TypeError('Private pick lineage inspection disappeared.');
    }
    if (lineage.state === 'unavailable') {
      evidence.push(...lineage.evidence);
      blockers.push(
        assetBlocker({
          code: 'pick_lineage_missing',
          authorityClass: 'pick_lineage',
          classification: 'internal_evidence',
          assetId: asset.assetId,
          message: `Exact custody-aware conserved-frontier pick lineage is unavailable: ${lineage.reasons.join(', ')}.`,
          evidenceRefs: [input.confirmedResultArtifact],
        })
      );
      continue;
    }
    const frontierPlayerEvidence = lineage.materialization.frontierAssets.flatMap(
      (frontier) => {
        if (frontier.assetType !== 'player') return [];
        const admission = playerAdmissions.get(frontier.assetId);
        return admission === undefined
          ? []
          : [{ frontierAssetId: frontier.assetId, admission }];
      }
    );
    const realization = lineage.materialization.realizationAtCutoff;
    const realizedSelectedPlayerEvidence =
      realization.state === 'selected'
        ? (playerAdmissions.get(realization.selectedPlayer.assetId) ?? null)
        : null;
    const pickEvidence = derivePrivateGovernedPickEvidenceV3({
      confirmedResultArtifact: input.confirmedResultArtifact,
      asset: {
        assetId: asset.assetId,
        transferAssetVersionId: asset.assetVersionId,
        receivingClubId: asset.receivingClubId,
        factualReleaseId: input.factualReleaseId,
        tradeKnowledgeCutoffAt: `${input.tradeOccurredOn}T00:00:00.000Z`,
        knowledgeCutoffAt,
      },
      lineage,
      frontierPlayerEvidence,
      realizedSelectedPlayerEvidence,
      admittedAt,
    });
    if (pickEvidence.state === 'unavailable') {
      evidence.push(lineage.evidence);
      const playerHorizonUnavailable = pickEvidence.reasons.some((reason) =>
        [
          'selected_player_evidence_missing',
          'frontier_player_evidence_missing',
        ].includes(reason)
      );
      const dependentPlayerIds = [
        ...lineage.materialization.frontierAssets
          .filter((frontier) => frontier.assetType === 'player')
          .map(({ assetId }) => assetId),
        ...(realization.state === 'selected'
          ? [realization.selectedPlayer.assetId]
          : []),
      ];
      const evidenceRefs = [
        input.confirmedResultArtifact,
        ...dependentPlayerIds.flatMap(
          (assetId) => unavailablePlayerEvidence.get(assetId)?.evidenceRefs ?? []
        ),
      ];
      blockers.push(
        assetBlocker({
          code: playerHorizonUnavailable
            ? 'player_hpn_horizon_missing'
            : 'pick_lineage_missing',
          authorityClass: playerHorizonUnavailable
            ? 'player_horizon'
            : 'pick_lineage',
          classification: 'internal_evidence',
          assetId: asset.assetId,
          message: `Complete factual pick contribution evidence is unavailable: ${pickEvidence.reasons.join(', ')}.`,
          evidenceRefs,
        })
      );
      continue;
    }
    evidence.push(
      lineage.evidence,
      ...pickEvidence.artifacts.map(({ document, reference }) => ({
        role: 'pick_evidence' as const,
        source: 'postgres_json' as const,
        document,
        createdAt: reference.createdAt,
      })),
      {
        role: 'pick_evidence',
        source: 'postgres_json',
        document: pickEvidence.admission,
        createdAt: pickEvidence.admission.content.admittedAt,
      }
    );
    blockers.push(
      assetBlocker({
        code: 'pick_forecast_unavailable',
        authorityClass: 'pick_forecast',
        classification: 'internal_evidence',
        assetId: asset.assetId,
        message:
          'Exact pick lineage is admitted, but role-specific governed at-trade and current-remaining distributions have not yet been materialized for every conserved-frontier asset.',
        evidenceRefs: [input.confirmedResultArtifact],
      })
    );
  }
  return { evidence: uniqueEvidence(evidence), blockers };
}
