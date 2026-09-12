import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeHpnPavSeasonInputSet } from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import { createAflTradeFinalizedHpnPavCalculationService } from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { createAflTradePlayerPavCalculationEvidence } from '@/server/aflTradeIntelligence/modeling/playerPavCalculationEvidence';
import { materializeAflTradePlayerPavObservationSet } from '@/server/aflTradeIntelligence/modeling/playerPavObservationService';
import { AflTradeValuationDatasetAdmissionService } from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  fullPlayerPavDatasetAdmissionFixture,
  playerPavDatasetAdmissionFixture,
} from './playerPavDatasetAdmissionFixture';
import { playerPavSourceAuthorityDocuments } from './playerPavSourceAuthorityFixture';

type Numerical = Awaited<ReturnType<typeof playerPavDatasetAdmissionFixture>>;
type SqlRow = Record<string, unknown>;

/** Coherent synthetic database responses, not SQL execution or genuine source/review authority. */
export async function currentAdmittedPavSourceFixture() {
  const numerical = await playerPavDatasetAdmissionFixture({ environment: 'non_production' });
  const source = await playerPavSourceAuthorityDocuments(numerical);
  const byRun = new Map(
    source.sourceAuthorities.map((item) => [item.document.run.normalizationRunId, item])
  );
  const inputSets = numerical.pavMeasurements.map(({ inputSet }) => {
    const original = inputSet.content;
    const facts = source.factualDocuments.filter(
      (fact) => fact.content.seasonYear === original.seasonYear
    );
    const universe = {
      ...original.factualUniverse,
      inputSetSha256: sha256AflTradeCanonicalJson(facts.map(({ factId }) => factId).sort()),
      completedMatchFacts: original.factualUniverse.completedMatchFacts.map((match) => ({
        ...match,
        factIds: facts
          .filter(
            (fact) =>
              fact.content.factKind === 'match_universe' &&
              fact.content.match.matchId === match.matchId
          )
          .map(({ factId }) => factId)
          .sort(),
      })),
      playerAppearanceFacts: original.factualUniverse.playerAppearanceFacts.map((appearance) => ({
        ...appearance,
        factIds: facts
          .filter(
            (fact) =>
              fact.content.factKind === 'player_appearance' &&
              fact.content.player.playerId === appearance.playerId &&
              fact.content.match.matchId === appearance.matchId
          )
          .map(({ factId }) => factId)
          .sort(),
      })),
    };
    return createAflTradeHpnPavSeasonInputSet({
      ...original,
      factualUniverse: universe,
      rows: original.rows.map((row) => {
        const decoded = byRun
          .get(row.source.normalizationRunId)!
          .decodedRows.find(
            ({ row: parent }) =>
              parent.source.providerDecodedRowId === row.source.providerDecodedRowId
          )!;
        return {
          ...row,
          source: {
            ...row.source,
            sourceRowSha256: decoded.sourceRowSha256,
            typedPayloadSha256: sha256AflTradeCanonicalJson(decoded.typedPayload),
          },
        };
      }),
      sourceRuns: original.sourceRuns.map((run) => {
        const current = byRun.get(run.normalizationRunId)!;
        return {
          ...run,
          captureId: current.captureId,
          sourceSnapshotId: current.snapshot.snapshotId,
          sourceArtifactId: current.artifact.artifactId,
        };
      }),
    });
  });
  let graph: Awaited<ReturnType<typeof fullPlayerPavDatasetAdmissionFixture>> | undefined;
  let measurements: Numerical['pavMeasurements'] = [];
  const resolution = (
    value: Extract<
      Numerical['pavMeasurements'][number]['inputSet']['content']['rows'][number],
      { kind: 'player_match_stats' }
    >['player']
  ) => ({
    canonicalId: value.canonicalId,
    revision: value.revision,
    decisionId: value.resolutionDecision.id,
    ...('resolutionScope' in value ? { resolutionScope: value.resolutionScope } : {}),
    assignmentDecisionId: value.assignmentDecision?.id ?? null,
    assignmentStatus: value.assignmentDecision === null ? null : 'active',
  });
  const inputRow = (set: (typeof inputSets)[number]) => ({
    input_set_json: set,
    input_set_canonical_json: canonicalizeAflTradeJson(set.content),
    input_set_sha256: sha256AflTradeCanonicalJson(set.content),
    status: 'finalized',
    finalized_at: set.content.createdAt,
    environment: set.content.environment,
    competition: set.content.competition,
    season_year: set.content.seasonYear,
    method_id: set.content.methodId,
    source_run_count: set.content.sourceRuns.length,
    source_row_count: set.content.rows.length,
    completed_match_count: set.content.completedMatches.length,
    actual_source_run_count: set.content.sourceRuns.length,
    actual_source_row_count: set.content.rows.length,
    actual_completed_match_count: set.content.completedMatches.length,
    factual_match_count: set.content.factualUniverse.completedMatchFacts.flatMap(
      ({ factIds }) => factIds
    ).length,
    factual_appearance_count: set.content.factualUniverse.playerAppearanceFacts.flatMap(
      ({ factIds }) => factIds
    ).length,
  });
  function rowsFor(sql: string, parameters: readonly unknown[]): SqlRow[] {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM outcome_hpn_pav_input_set input_set'))
      return inputSets.filter((set) => set.inputSetId === parameters[0]).map(inputRow);
    if (sql.includes('FROM outcome_hpn_projected_field_map map')) return [];
    if (sql.includes('FROM outcome_hpn_pav_field_map legacy'))
      return source.sourceAuthorities
        .filter((item) => item.fieldMap.fieldMapId === parameters[0])
        .slice(0, 1)
        .map((item) => ({ legacy_map_json: item.fieldMap, current_approval: true }));
    if (sql.includes('FROM outcome_factual_reconciliation_run run'))
      return inputSets
        .filter((set) => set.content.factualUniverse.factualRunId === parameters[0])
        .map(({ content }) => ({
          factual_run_id: content.factualUniverse.factualRunId,
          policy_id: content.factualUniverse.policyId,
          input_set_sha256: content.factualUniverse.inputSetSha256,
          status: 'approved',
          conflict_count: 0,
          finalized_at: content.factualUniverse.finalizedAt,
        }));
    if (sql.includes('FROM outcome_factual_reconciliation_match_input'))
      return inputSets
        .filter((set) => set.content.factualUniverse.factualRunId === parameters[0])
        .flatMap(({ content }) =>
          content.factualUniverse.completedMatchFacts.map((fact) => ({
            fact_ids: fact.factIds,
            match_id: fact.matchId,
            effective_at: fact.effectiveAt,
            home_club_id: fact.homeClubId,
            away_club_id: fact.awayClubId,
          }))
        );
    if (sql.includes('FROM outcome_factual_reconciliation_appearance_input'))
      return inputSets
        .filter((set) => set.content.factualUniverse.factualRunId === parameters[0])
        .flatMap(({ content }) =>
          content.factualUniverse.playerAppearanceFacts.map((fact) => ({
            fact_ids: fact.factIds,
            match_id: fact.matchId,
            player_id: fact.playerId,
            club_id: fact.clubId,
          }))
        );
    if (
      sql.includes('JOIN outcome_provider_normalization_run run') &&
      sql.includes('decode_map.source_schema_sha256')
    ) {
      const requests: { normalizationRunId: string }[] = JSON.parse(String(parameters[0]));
      return requests.map(({ normalizationRunId }) => {
        const item = byRun.get(normalizationRunId)!;
        const run = item.document.run;
        return {
          normalization_run_id: run.normalizationRunId,
          capture_id: item.captureId,
          source_snapshot_id: item.snapshot.snapshotId,
          source_artifact_id: item.artifact.artifactId,
          capture_environment: 'non_production',
          capture_provider: run.provider,
          capture_capability_id: run.capabilityId,
          capture_status: 'approved',
          captured_at: run.capturedAt,
          finalized_at: run.finalizedAt,
          staging_sha256: run.stagingSha256,
          source_row_count: run.sourceRowCount,
          accepted_row_count: run.acceptedRowCount,
          quarantined_row_count: 0,
          issue_count: 0,
          run_status: 'staged',
          capability_id: run.capabilityId,
          source_schema_sha256: item.fieldMap.content.sourceSchemaSha256,
        };
      });
    }
    if (sql.includes('FROM outcome_provider_decoded_row')) {
      const runIds = parameters[0] as readonly string[];
      return source.sourceAuthorities
        .filter((item) => runIds.includes(item.document.run.normalizationRunId))
        .flatMap((item) =>
          item.decodedRows.map(({ row, sourceRowSha256, typedPayload }) => {
            const result = inputSets
              .find((set) => set.content.seasonYear === item.document.run.seasonYear)!
              .content.rows.find((value) => value.kind === 'completed_match_result');
            if (!result || result.kind !== 'completed_match_result')
              throw new Error('Missing result');
            return {
              provider_decoded_row_id: row.source.providerDecodedRowId,
              normalization_run_id: row.source.normalizationRunId,
              source_row_sha256: sourceRowSha256,
              typed_payload: typedPayload,
              row_status: 'staged',
              match_resolution: resolution(row.match),
              player_resolution: row.kind === 'player_match_stats' ? resolution(row.player) : null,
              home_club_resolutions: [resolution(result.homeClub)],
              away_club_resolutions: [resolution(result.awayClub)],
              native_match_id: row.match.canonicalId,
              home_club_native_id: result.homeClub.canonicalId,
              home_club_name: result.homeClub.canonicalId,
              away_club_native_id: result.awayClub.canonicalId,
              away_club_name: result.awayClub.canonicalId,
              canonical_match_date: result.effectiveAt,
              canonical_home_club_id: result.homeClub.canonicalId,
              canonical_away_club_id: result.awayClub.canonicalId,
            };
          })
        );
    }
    if (sql.includes('requested."providerDecodedRowId" AS provider_decoded_row_id')) {
      const requests: { providerDecodedRowId: string }[] = JSON.parse(String(parameters[0]));
      return requests.map(({ providerDecodedRowId }) => {
        const row = inputSets
          .flatMap((set) => set.content.rows)
          .find((row) => row.source.providerDecodedRowId === providerDecodedRowId);
        if (!row || row.kind !== 'player_match_stats') throw new Error('Missing spell');
        const spell = row.acquisitionSpell;
        return {
          provider_decoded_row_id: providerDecodedRowId,
          spell_version_id: spell.spellVersionId,
          spell_id: spell.spellId,
          version: spell.version,
          player_id: spell.playerId,
          club_id: spell.clubId,
          start_event_version_id: spell.startEventVersionId,
          start_asset_version_id: spell.startAssetVersionId,
          start_date: spell.startDate,
          end_date: spell.endDate,
          end_reason: spell.endReason,
          rule_id: spell.ruleId,
          status: spell.status,
          supersedes_spell_version_id: spell.supersedesSpellVersionId,
          recorded_at: spell.recordedAt,
        };
      });
    }
    if (sql.includes('SELECT method_json FROM outcome_hpn_pav_method'))
      return parameters[0] === numerical.method.methodId ? [{ method_json: numerical.method }] : [];
    if (sql.includes('FROM outcome_hpn_pav_calculation calculation WHERE calculation_id'))
      return measurements
        .filter(({ calculation }) => calculation.calculationId === parameters[0])
        .map(({ calculation }) => ({
          calculation_json: calculation,
          finalized_at: calculation.content.calculatedAt,
          team_count: calculation.content.teams.length,
          player_count: calculation.content.players.length,
          actual_team_count: calculation.content.teams.length,
          actual_player_count: calculation.content.players.length,
        }));
    if (sql.includes('SELECT head.revision,head.calculation_id'))
      return measurements
        .filter(({ calculation }) => calculation.calculationId === parameters[4])
        .map(({ calculation, headRevision }) => ({
          revision: headRevision,
          calculation_id: calculation.calculationId,
        }));
    if (sql.includes('SELECT player_canonical_json,player_sha256'))
      return measurements
        .filter(({ calculation }) => calculation.calculationId === parameters[0])
        .flatMap(({ calculation }) =>
          calculation.content.players.map((player) => ({
            player_canonical_json: canonicalizeAflTradeJson(player),
            player_sha256: sha256AflTradeCanonicalJson(player),
          }))
        );
    if (sql.includes('SELECT fact.fact_id,fact.fact_json')) {
      const factIds = parameters[0] as readonly string[];
      return source.factualDocuments
        .filter(({ factId }) => factIds.includes(factId))
        .sort((a, b) => a.factId.localeCompare(b.factId))
        .map((fact) => ({
          fact_id: fact.factId,
          fact_json: fact,
          capture_id: fact.content.source.captureId,
          source_snapshot_id: byRun.get(fact.content.source.normalizationRunId)!.snapshot
            .snapshotId,
        }));
    }
    if (!graph) throw new Error(`Unexpected pre-graph SQL: ${sql}`);
    const original = graph.pav.pavObservationSet;
    if (sql.includes('FROM outcome_player_pav_observation_set parent'))
      return parameters[0] === original.observationSetId
        ? [
            {
              observation_set_json: original,
              finalized_at: original.content.createdAt,
              calculation_count: original.content.calculations.length,
              actual_calculation_count: original.content.calculations.length,
              observation_count: original.content.observations.length,
              actual_observation_count: original.content.observations.length,
            },
          ]
        : [];
    if (sql.includes('load_outcome_private_player_pav_authority'))
      return [
        {
          binding_json: {
            requestId: graph.pav.requestId,
            policyId: original.content.policy.policyId,
            methodId: original.content.policy.content.methodId,
            releaseId: original.content.releaseId,
            knowledgeCutoffAt: original.content.knowledgeCutoffAt,
            predictionSeasons: [2005, 2009, 2013, 2017],
            requiredMeasurementSeasons: inputSets.map((set) => set.content.seasonYear),
          },
        },
      ];
    if (sql.includes('FROM outcome_player_pav_policy'))
      return [{ policy_json: original.content.policy, decision: 'approved', has_successor: false }];
    if (sql.includes('FROM outcome_release_manifest release'))
      return graph.pav.predictions.map((prediction) => ({
        spell_version_id: prediction.acquisitionSpell.spellVersionId,
        spell_id: prediction.acquisitionSpell.spellId,
        player_id: prediction.playerId,
        club_id: prediction.acquisitionSpell.clubId,
        start_date: prediction.acquisitionSpell.effectiveFrom,
        end_date: prediction.acquisitionSpell.effectiveThrough,
        recorded_at: prediction.acquisitionSpell.recordedAt,
        prediction_season: prediction.predictionSeason,
      }));
    if (sql.includes('FROM outcome_player_pav_calculation_member member'))
      return original.content.calculations
        .map(({ calculationId }) => ({ calculation_id: calculationId }))
        .sort((a, b) => a.calculation_id.localeCompare(b.calculation_id));
    throw new Error(`Unmapped coherent fixture query: ${sql}`);
  }
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string, parameters: readonly unknown[] = []) {
      // Generic database result type, never a cast of domain documents past their schemas.
      const rows = rowsFor(sql, parameters) as Row[];
      return { rows, rowCount: rows.length };
    },
    async transaction(work) {
      return work(client);
    },
  };
  const inputRepository = new PostgresAflTradeHpnPavInputRepository(client);
  const service = createAflTradeFinalizedHpnPavCalculationService({
    inputRepository,
    methodAuthority: {
      async loadExact(methodId) {
        if (methodId !== numerical.method.methodId) throw new Error('Wrong method');
        return { method: numerical.method, sourceBytes: numerical.sourceBytes };
      },
    },
    clock: { now: () => '2026-08-11T00:00:00.000Z' },
  });
  measurements = await Promise.all(
    inputSets.map(async (inputSet) => ({
      inputSet,
      headRevision: 1,
      calculation: await service.calculate(
        {
          inputSetId: inputSet.inputSetId,
          environment: 'non_production',
          competition: 'AFLM',
          seasonYear: inputSet.content.seasonYear,
          methodId: numerical.method.methodId,
        },
        { environment: 'non_production' }
      ),
    }))
  );
  const bytesById = new Map(
    [...source.artifactBytes, ...numerical.artifactBytes].map(({ artifactId, bytes }) => [
      artifactId,
      bytes,
    ])
  );
  const buildPav: typeof playerPavDatasetAdmissionFixture = async (options = {}) => {
    const releaseId = options.releaseId ?? numerical.pavObservationSet.content.releaseId;
    const createdAt = options.createdAt ?? numerical.pavObservationSet.content.createdAt;
    const knowledgeCutoffAt =
      options.knowledgeCutoffAt ?? numerical.pavObservationSet.content.knowledgeCutoffAt;
    const predictions = numerical.predictions.map((prediction) => ({ ...prediction, releaseId }));
    const pavObservationSet = materializeAflTradePlayerPavObservationSet({
      environment: 'non_production',
      competition: 'AFLM',
      createdAt,
      knowledgeCutoffAt,
      releaseId,
      policy: numerical.policy,
      predictions,
      calculations: measurements.map(({ calculation }) =>
        createAflTradePlayerPavCalculationEvidence({
          calculation,
          environment: 'non_production',
          competition: 'AFLM',
          methodId: numerical.method.methodId,
          seasonYears: inputSets.map((set) => set.content.seasonYear),
          knowledgeCutoffAt,
        })
      ),
    });
    const reference = createAflTradeCanonicalJsonArtifactRef(pavObservationSet, createdAt);
    bytesById.set(
      reference.artifactId,
      new TextEncoder().encode(canonicalizeAflTradeJson(pavObservationSet))
    );
    const measurementReferences = pavObservationSet.content.observations.map((observation) => {
      const referenceFor = (value: (typeof observation.featureValues)[number]) => {
        const proof = measurements.find(
          ({ calculation }) => calculation.calculationId === value.calculationId
        )!;
        return {
          kind: 'hpn_pav_measurement' as const,
          state: 'finalized' as const,
          memberId: createAflTradeContentAddress('hpn-pav-measurement', {
            calculationId: value.calculationId,
            spellVersionId: value.spellVersionId,
            playerSha256: value.playerSha256,
          }),
          recordSha256: value.playerSha256,
          headRevision: proof.headRevision,
          calculationId: value.calculationId,
          inputSetId: proof.inputSet.inputSetId,
          methodId: numerical.method.methodId,
          seasonYear: value.seasonYear,
          playerId: value.playerId,
          clubId: value.clubId,
          spellVersionId: value.spellVersionId,
          effectiveFrom: proof.inputSet.content.completedMatches[0]!.effectiveAt,
          effectiveThrough: value.effectiveThrough,
          recordedAt: value.calculatedAt,
        };
      };
      return {
        pavObservationId: observation.observationId,
        featureInputs: observation.featureValues.map(referenceFor),
        targetInputs: observation.targetValues.map(referenceFor),
      };
    });
    const sourceDocuments = source.sourceAuthorities.map((item) => {
      const inputSet = inputSets.find(
        (set) => set.content.seasonYear === item.document.run.seasonYear
      )!;
      const run = inputSet.content.sourceRuns.find(
        (run) => run.normalizationRunId === item.document.run.normalizationRunId
      )!;
      return {
        ...item.document,
        run,
        rows: inputSet.content.rows.filter(
          (row) => row.source.normalizationRunId === run.normalizationRunId
        ),
        artifact: item.artifact,
      };
    });
    return {
      ...numerical,
      predictions,
      pavObservationSet,
      pavMeasurements: measurements,
      measurementReferences,
      sourceDocuments,
      artifactBytes: [...bytesById].map(([artifactId, bytes]) => ({ artifactId, bytes })),
      pavObservationSetBinding: {
        requestId: numerical.requestId,
        observationSetId: pavObservationSet.observationSetId,
        artifact: reference,
      },
    };
  };
  graph = await fullPlayerPavDatasetAdmissionFixture({
    environment: 'non_production',
    buildPav,
    sourceEvidenceFor(document) {
      const item = byRun.get(document.run.normalizationRunId)!;
      const receiptAt = (evaluatedAt: string) =>
        createAflTradeGate0AReceipt(
          item.ledger,
          item.rights,
          {
            ...item.receipt.content.request,
            evaluatedAt,
            operations: ['derived_feature_creation', 'model_training'],
            rawRetentionDays: null,
          },
          evaluatedAt
        );
      const captureReceipt = createAflTradeGate0AReceipt(
        item.ledger,
        item.rights,
        {
          ...item.receipt.content.request,
          operations: ['public_derived_output', 'public_fact_display', 'raw_evidence_retention'],
          fieldUses: item.consumedFieldSet.content.fields.map(({ sourceField }) => ({
            sourceField,
            use: 'public_display' as const,
          })),
        },
        item.receipt.content.request.evaluatedAt
      );
      return {
        consumedFieldSet: item.consumedFieldSet,
        captureReceipt,
        proof: {
          captureId: item.captureId,
          sourceSnapshotId: item.snapshot.snapshotId,
          consumedFieldSetId: item.consumedFieldSet.fieldSetId,
          sourceSnapshotManifest: item.snapshot,
          rightsProposal: item.rights,
          gateLedger: item.ledger,
          derivationReceipt: receiptAt('2026-09-02T00:09:00.000Z'),
          admissionReceipt: receiptAt('2026-09-02T00:20:00.000Z'),
        },
      };
    },
  });
  for (const item of graph.artifactBytes) bytesById.set(item.artifactId, item.bytes);
  const admission = await new AflTradeValuationDatasetAdmissionService({
    authenticate: async () => graph!.evidence,
  }).admit({ dataset: graph.dataset, admittedAt: graph.evidence.authenticatedAt });
  if (admission.status !== 'admitted') throw new Error(JSON.stringify(admission));
  return {
    graph,
    admission,
    client,
    source,
    inputSets,
    artifacts: {
      async loadExactWithObservation(reference: { artifactId: string }) {
        const bytes = bytesById.get(reference.artifactId);
        return bytes ? { bytes } : null;
      },
    },
  };
}
