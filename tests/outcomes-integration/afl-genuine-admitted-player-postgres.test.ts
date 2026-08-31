import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  aflTradeConsumedFieldSetSchema,
  createAflTradeDatasetOperationAuthorization,
  listAflTradeValuationDatasetArtifactMemberships,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { aflTradeSourceSnapshotManifestSchema } from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createLocalAflTradeGenuineAdmittedPlayerExecutor } from '@/server/aflTradeIntelligence/development/localGenuineAdmittedPlayerContribution';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGovernedArtifactRef,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeValuationDatasetFactualLineageRepository } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetFactualLineageRepository';
import { PostgresAflTradeValuationDatasetRepository } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetRepository';
import {
  loadAflTradePrivateValuationModelPairExactInput,
  PostgresAflTradePrivateValuationModelPairRepository,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair';
import { PostgresAflTradePrivateFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationFactualPreparation';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';
import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';

import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';
import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
  stageAcceptedPrivateValuationCaptureFixture,
} from '../testUtils/privateValuationFactualPreparationFixture';
import { createAflTradeGateDecisionFixture } from '../fixtures/aflDraftTradeOutcomeReleaseFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${digest(value)}`;

function approvedGate2(input: {
  readonly decisionKey: string;
  readonly scopeKey: string;
  readonly competition: string;
  readonly validFromSeason: number;
  readonly validThroughSeason: number;
  readonly affectedArtifacts: readonly AflTradeGovernedArtifactRef[];
}) {
  const scope = {
    scopeKey: input.scopeKey,
    description: 'Exact non-production factual lineage for the admitted-player tracer.',
    dimensions: [
      { name: 'scope', values: [input.scopeKey] },
      { name: 'competition', values: [input.competition] },
      { name: 'valid_from_season', values: [String(input.validFromSeason)] },
      { name: 'valid_through_season', values: [String(input.validThroughSeason)] },
    ],
    exclusions: ['Production authority', 'Publication', 'Grading', 'Fantasy ownership'],
  };
  const evidenceId = addressed('artifact', 'genuine-admitted-player-gate2-review');
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_2_corpus_lineage' as const,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope,
    proposal: 'Admit only the exact retained factual lineage selected by this dispatch.',
    alternativesConsidered: ['Keep the retained lineage unavailable to model preparation.'],
    accountableOwner: 'operator:local-admitted-player-review',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [evidenceId],
    affectedArtifacts: [...input.affectedArtifacts],
    proposedAt: '2026-08-12T00:06:40.000Z',
    proposedBy: 'operator:local-admitted-player-review',
    proposalOrigin: 'human_authored' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposalContent.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: proposalContent.environment,
    scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: proposalContent.accountableOwner,
    decidedBy: proposalContent.accountableOwner,
    reviewers: [],
    authorityEvidenceIds: [evidenceId],
    conditionResults: [],
    rationale: 'The retained lineage, member root, corpus, candidate and release are exact.',
    limitations: ['Non-production evidence only; no publication or activation authority.'],
    decidedAt: '2026-08-12T00:06:50.000Z',
    effectiveAt: '2026-08-12T00:06:50.000Z',
    revalidateAt: '2027-08-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: [...input.affectedArtifacts],
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

let artifactRoot = '';
let restrictedPool: Pool | undefined;

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function calculation(factualRunId: string, methodId: string) {
  const stats = {
    totalPoints: 10,
    hitOuts: 1,
    goalAssists: 1,
    inside50s: 2,
    marks: 3,
    marksInside50: 1,
    freeKicksFor: 2,
    freeKicksAgainst: 1,
    rebound50s: 1,
    onePercenters: 1,
    clearances: 2,
    tackles: 3,
  };
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: 'club:admitted-player-home',
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', 'hpn-home'),
          playerId: 'player:admitted-player-home',
          sourceRowIds: ['row:admitted-player-home'],
          ...stats,
        },
      ],
    },
    {
      teamId: 'club:admitted-player-away',
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', 'hpn-away'),
          playerId: 'player:admitted-player-away',
          sourceRowIds: ['row:admitted-player-away'],
          ...stats,
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
    effectiveThrough: '2026-08-12T00:06:30.000Z',
    calculatedAt: '2026-08-12T00:07:00.000Z',
    methodId,
    inputSetId: addressed('hpn-pav-input-set', 'admitted-player-input'),
    inputSetSha256: digest('admitted-player-input'),
    factualRunId,
    factualInputSetSha256: digest('admitted-player-facts'),
    primaryProviders: ['afl_tables'],
    corroboratingProviders: ['footywire'],
    resultSourceRowIds: ['row:admitted-player-result'],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: { ...player.source, gamesPlayed: 1 },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: addressed('hpn-pav-season', canonicalizeAflTradeJson(content)),
    content,
  });
}

beforeAll(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-genuine-admitted-player-'));
  await adminPool.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
      CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
    END IF;
  END $role$`);
  await adminPool.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_analytical_authority_registry_writer') THEN
      CREATE ROLE afl_trade_analytical_authority_registry_writer NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_operational_authorization_registry_writer') THEN
      CREATE ROLE afl_trade_operational_authorization_registry_writer NOLOGIN;
    END IF;
  END $role$`);
  await adminPool.query(
    'GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO statly_test'
  );
  await adminPool.query(
    'GRANT afl_trade_analytical_authority_registry_writer, afl_trade_operational_authorization_registry_writer TO statly_test'
  );
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await adminPool.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await adminPool.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  for (const role of [
    'afl_trade_analytical_authority_registry_writer',
    'afl_trade_operational_authorization_registry_writer',
  ]) {
    await adminPool.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO ${role}`);
    await adminPool.query(
      `GRANT SELECT ON "${schemaName}".outcome_valuation_dataset_candidate TO ${role}`
    );
    await adminPool.query(
      `GRANT UPDATE (dataset_id) ON "${schemaName}".outcome_valuation_dataset_candidate TO ${role}`
    );
    await adminPool.query(
      `GRANT SELECT,INSERT ON "${schemaName}".outcome_valuation_dataset_operation_authority TO ${role}`
    );
  }
});

afterAll(async () => {
  await restrictedPool?.end();
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
  await rm(artifactRoot, { recursive: true, force: true });
});

describe.sequential('genuine admitted-player PostgreSQL tracer', () => {
  it('fits, retains, and replays one exact native component under durable dispatch authority', async () => {
    const staged = await stageAcceptedPrivateValuationCaptureFixture(
      client,
      'genuine-admitted-player-tracer'
    );
    let preparedCandidate: Awaited<
      ReturnType<typeof persistPrivateValuationFactualCandidateFixture>
    > | null = null;
    let source: Awaited<ReturnType<typeof prepareLocalAflTradeFitzRoyFactualReleaseCandidate>>;
    const factualPreparation = new PostgresAflTradePrivateFactualPreparation(client, {
      prepareSourceEvidence: async () => {
        source = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
      },
      prepareCandidate: async () => {
        const spell = await seedPrivateValuationAcquisitionSpellFixture(
          client,
          staged.binding.content.sourceCaptureId,
          source.candidate,
          'genuine-admitted-player'
        );
        preparedCandidate = await persistPrivateValuationFactualCandidateFixture(
          client,
          source.candidate,
          spell,
          staged.claim.request.scopeKey
        );
        return { candidateId: preparedCandidate.candidateId };
      },
    });
    const prepared = await factualPreparation.prepare({
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    });
    if (preparedCandidate === null) {
      throw new Error('The genuine tracer did not retain a factual release candidate.');
    }
    const factual = prepared.output;
    const requestId = staged.requestId;
    const { claimId, leaseToken } = staged.claim;
    const factualRunId = factual.content.reconciliation.factualRunId;
    const provisionalAdmitted = admittedRunFixture('non_production', {
      scopeKey: staged.claim.request.scopeKey,
      factualReleaseId: factual.content.factualRelease.releaseId,
      factualCandidateId: factual.content.candidate.candidateId,
      sourceMemberSetSha256: factual.content.candidate.memberSetSha256,
      metricRegistryVersion: preparedCandidate.content.metricRegistryVersion,
      acquisitionSpellRuleId: preparedCandidate.content.acquisitionSpellRule.id,
      factualEffectiveThrough: preparedCandidate.content.effectiveThrough,
    });
    const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const gate0aState = await gateRepository.load();
    const gate0a = await gateRepository.append({
      expectedRevision: gate0aState.revision,
      sourceRights: provisionalAdmitted.evidence.sourceRightsProposals[0]!,
      proposal: provisionalAdmitted.evidence.gateDecisionLedger.proposals[0]!,
      decision: provisionalAdmitted.evidence.gateDecisionLedger.decisions[0]!,
    });
    const gate2Repository = new PostgresAflTradeValuationDatasetFactualLineageRepository(client);
    const stagedLineage = await gate2Repository.stage({
      factualCandidateId: factual.content.candidate.candidateId,
      createdAt: '2026-08-12T00:06:30.000Z',
    });
    const lineage = stagedLineage.lineage;
    const factualSourceMember = preparedCandidate.content.members.sourceCaptures[0];
    if (factualSourceMember === undefined) {
      throw new Error('The admitted-player tracer requires one exact source member.');
    }
    const factualSourceRow = await pool.query<{
      readonly source_snapshot_id: string;
      readonly manifest_json: unknown;
    }>(
      `SELECT source_snapshot_id,manifest_json FROM outcome_source_capture WHERE capture_id=$1`,
      [factualSourceMember.captureId]
    );
    const factualSourceSnapshot = aflTradeSourceSnapshotManifestSchema.parse({
      snapshotId: factualSourceRow.rows[0]!.source_snapshot_id,
      content: factualSourceRow.rows[0]!.manifest_json,
    });
    const originalSourceRequest = factualSourceSnapshot.content.gate0aReceipt.content.request;
    const datasetSourceDecisionKey = `dataset-source:${lineage.lineageId}`;
    const datasetSourceRequest = {
      ...originalSourceRequest,
      decisionKey: datasetSourceDecisionKey,
      operations: ['derived_feature_creation', 'model_training'] as const,
      fieldUses: [
        ...new Set(originalSourceRequest.fieldUses.map(({ sourceField }) => sourceField)),
      ]
        .sort()
        .flatMap((sourceField) => [
          { sourceField, use: 'derived_feature' as const },
          { sourceField, use: 'model_training' as const },
        ]),
    };
    const datasetSourceGate = createAflTradeGateDecisionFixture({
      gate: 'gate_0a_permission_to_evaluate',
      environment: 'non_production',
      decisionKey: datasetSourceDecisionKey,
      decidedAt: '2026-08-12T00:06:35.000Z',
      revalidateAt: '2027-08-01T00:00:00.000Z',
      affectedArtifacts: [
        {
          kind: 'source_rights',
          artifactId: factualSourceSnapshot.content.sourceRightsProposal.rightsArtifactId,
        },
      ],
      scopeDimensions: [
        {
          name: 'source_rights_artifact',
          values: [factualSourceSnapshot.content.sourceRightsProposal.rightsArtifactId],
        },
        { name: 'competition', values: [datasetSourceRequest.competition] },
        { name: 'season', values: [String(datasetSourceRequest.season)] },
        { name: 'access_mechanism', values: [datasetSourceRequest.accessMechanism] },
        { name: 'geography', values: [datasetSourceRequest.geography] },
        { name: 'commercial_context', values: [datasetSourceRequest.commercialContext] },
        { name: 'audience', values: [datasetSourceRequest.audience] },
        { name: 'operation', values: [...datasetSourceRequest.operations] },
        ...(datasetSourceRequest.capabilityId === null
          ? []
          : [
              {
                name: 'fitzroy_capability',
                values: [datasetSourceRequest.capabilityId],
              },
            ]),
      ],
    });
    const datasetSourceGateState = await gateRepository.append({
      expectedRevision: gate0a.revision,
      sourceRights: factualSourceSnapshot.content.sourceRightsProposal,
      proposal: datasetSourceGate.ledger.proposals[0]!,
      decision: datasetSourceGate.ledger.decisions[0]!,
    });
    const gate2 = approvedGate2({
      decisionKey: stagedLineage.decisionKey,
      scopeKey: lineage.content.scopeKey,
      competition: lineage.content.competition,
      validFromSeason: preparedCandidate.content.validFromSeason,
      validThroughSeason: preparedCandidate.content.validThroughSeason,
      affectedArtifacts: stagedLineage.affectedArtifacts,
    });
    const gate2State = await gateRepository.appendDecision({
      expectedRevision: datasetSourceGateState.revision,
      proposal: gate2.proposal,
      decision: gate2.decision,
    });
    const fabricatedAdmissionContent = {
      schemaVersion: 'afl-trade-valuation-dataset-lineage-admission/v1',
      authorityBoundary:
        'gate_2_private_factual_lineage_only_no_model_grade_publication_or_activation_authority',
      publicationEligible: false,
      environment: lineage.content.environment,
      scopeKey: lineage.content.scopeKey,
      competition: lineage.content.competition,
      validFromSeason: preparedCandidate.content.validFromSeason,
      validThroughSeason: preparedCandidate.content.validThroughSeason,
      lineageId: lineage.lineageId,
      corpusId: lineage.content.corpusId,
      factualReleaseId: lineage.content.factualReleaseId,
      factualCandidateId: lineage.content.factualCandidateId,
      sourceMemberSetSha256: digest('fabricated-source-member-set'),
      gate2DecisionKey: stagedLineage.decisionKey,
      gateProposalId: gate2.proposal.proposalId,
      gateDecisionId: gate2.decision.decisionId,
      gateDecisionVersion: gate2.decision.content.version,
      gateLedgerRevision: gate2State.revision,
      admittedAt: '2026-08-12T00:07:00.000Z',
      effectiveAt: gate2.decision.content.effectiveAt!,
      revalidateAt: gate2.decision.content.revalidateAt!,
    };
    const fabricatedAdmission = {
      admissionId: createAflTradeContentAddress(
        'corpus-factual-lineage-admission',
        fabricatedAdmissionContent
      ),
      content: fabricatedAdmissionContent,
    };
    await expect(
      pool.query(
        `INSERT INTO outcome_valuation_dataset_factual_lineage_admission
          (admission_id,lineage_id,gate_proposal_id,gate_decision_id,gate_ledger_revision,
           admitted_at,revalidate_at,admission_canonical_json,admission_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          fabricatedAdmission.admissionId,
          lineage.lineageId,
          gate2.proposal.proposalId,
          gate2.decision.decisionId,
          gate2State.revision,
          fabricatedAdmissionContent.admittedAt,
          fabricatedAdmissionContent.revalidateAt,
          canonicalizeAflTradeJson(fabricatedAdmissionContent),
          canonicalizeAflTradeJson(fabricatedAdmission),
        ]
      )
    ).rejects.toThrow('Private factual dataset lineage admission is invalid');
    await gate2Repository.admit({
      lineageId: lineage.lineageId,
      evaluatedAt: '2026-08-12T00:07:00.000Z',
    });
    const factualParent = {
      scopeKey: staged.claim.request.scopeKey,
      corpusId: lineage.content.corpusId,
      corpusToCandidateLineageId: lineage.lineageId,
      factualReleaseId: factual.content.factualRelease.releaseId,
      factualCandidateId: factual.content.candidate.candidateId,
      sourceMemberSetSha256: factual.content.candidate.memberSetSha256,
      archiveDatasetId: preparedCandidate.content.archiveDataset.id,
      sourceSnapshotSetId: preparedCandidate.content.sourceSnapshotSet.id,
      metricRegistryVersion: preparedCandidate.content.metricRegistryVersion,
      acquisitionSpellRuleId: preparedCandidate.content.acquisitionSpellRule.id,
      factualEffectiveThrough: preparedCandidate.content.effectiveThrough,
    };
    let admitted = admittedRunFixture('non_production', factualParent);
    const operationAuthorities = (
      ['analytical_authority', 'operational_authorization'] as const
    ).map((authorityKind) =>
      createAflTradeDatasetOperationAuthorization({
        schemaVersion: 'afl-trade-architecture-operation-authorization/v1',
        operation: 'materialize_feature_dataset',
        authorityKind,
        environment: 'non_production',
        scopeKey: admitted.datasetCandidate.content.scopeKey,
        datasetId: admitted.datasetCandidate.datasetId,
        factualReleaseId: factualParent.factualReleaseId,
        factualCandidateId: factualParent.factualCandidateId,
        authorizedAt: '2026-08-12T00:07:30.000Z',
        validThrough: '2027-08-01T00:00:00.000Z',
        principalRef: `operator:genuine-admitted-player-${authorityKind}`,
      })
    );
    const sourceMember = factualSourceMember;
    const [sourceSnapshotRow, consumedFieldSetRow, currentGate] = await Promise.all([
      pool.query<{ readonly source_snapshot_id: string; readonly manifest_json: unknown }>(
        `SELECT source_snapshot_id,manifest_json FROM outcome_source_capture WHERE capture_id=$1`,
        [sourceMember.captureId]
      ),
      pool.query<{ readonly field_set_json: unknown }>(
        `SELECT field_set_json FROM outcome_valuation_dataset_consumed_field_set
          WHERE capture_id=$1`,
        [sourceMember.captureId]
      ),
      gateRepository.load(),
    ]);
    const sourceSnapshot = aflTradeSourceSnapshotManifestSchema.parse({
      snapshotId: sourceSnapshotRow.rows[0]!.source_snapshot_id,
      content: sourceSnapshotRow.rows[0]!.manifest_json,
    });
    const consumedFieldSet = aflTradeConsumedFieldSetSchema.parse(
      consumedFieldSetRow.rows[0]!.field_set_json
    );
    admitted = admittedRunFixture('non_production', {
      ...factualParent,
      analyticalAuthorityReceiptId: operationAuthorities[0].receiptId,
      operationalAuthorizationReceiptId: operationAuthorities[1].receiptId,
      gate2Decision: {
        decisionId: gate2.decision.decisionId,
        effectiveAt: gate2.decision.content.effectiveAt!,
        revalidateAt: gate2.decision.content.revalidateAt!,
      },
      sourceAuthority: {
        captureId: sourceMember.captureId,
        sourceSnapshotId: sourceMember.sourceSnapshotId,
        consumedFieldSetId: consumedFieldSet.fieldSetId,
        consumedFieldSetSha256: consumedFieldSet.content.fieldSetSha256,
        rights: sourceSnapshot.content.sourceRightsProposal,
        ledger: currentGate.ledger,
        request: datasetSourceRequest,
      },
    });
    const factualSpell = preparedCandidate.content.members.acquisitionSpells[0];
    if (factualSpell === undefined) {
      throw new Error('The admitted-player tracer requires one canonical factual spell.');
    }
    const factualSpellRow = await pool.query<{
      readonly player_id: string;
      readonly club_id: string;
      readonly start_event_version_id: string;
      readonly start_asset_version_id: string;
      readonly rule_id: string;
    }>(
      `SELECT player_id,club_id,start_event_version_id,start_asset_version_id,rule_id
         FROM outcome_acquisition_spell_version WHERE spell_version_id=$1`,
      [factualSpell.spellVersionId]
    );
    const factualSpellAuthority = factualSpellRow.rows[0];
    if (factualSpellAuthority === undefined) {
      throw new Error('The admitted-player tracer lost its canonical factual spell.');
    }
    for (const [index, row] of admitted.datasetCandidate.content.rows.entries()) {
      const startDate = new Date(
        Date.parse(`${row.content.seasonYear}-01-01T00:00:00.000Z`) + index * 172_800_000
      )
        .toISOString()
        .slice(0, 10);
      const endDate = new Date(Date.parse(`${startDate}T00:00:00.000Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      await pool.query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
           start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
           supersedes_spell_version_id,recorded_at)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'superseded',$9,'approved',NULL,$10)`,
        [
          row.content.lineage.acquisitionSpellVersionId,
          row.content.lineage.acquisitionSpellId,
          factualSpellAuthority.player_id,
          factualSpellAuthority.club_id,
          factualSpellAuthority.start_event_version_id,
          factualSpellAuthority.start_asset_version_id,
          startDate,
          endDate,
          factualSpellAuthority.rule_id,
          row.content.featureKnownThrough,
        ]
      );
    }
    for (const { reference } of listAflTradeValuationDatasetArtifactMemberships(
      admitted.datasetCandidate
    )) {
      await pool.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$6,$7::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          reference.artifactId,
          reference.contentSha256,
          reference.storageUri,
          reference.mediaType,
          reference.byteLength,
          reference.createdAt,
          canonicalizeAflTradeJson({
            schemaVersion: 'genuine-admitted-player-dataset-artifact-custody/v1',
            reference,
          }),
        ]
      );
    }
    await new PostgresAflTradeValuationDatasetRepository(client).persistCandidate(
      admitted.datasetCandidate
    );
    const methodBytes = new TextEncoder().encode(
      '<html>Retained non-production HPN method evidence.</html>'
    );
    const method = createAflTradeHpnPavMethod({
      sourceArtifact: createAflTradeByteArtifactRef(
        methodBytes,
        'text/html',
        '2026-08-12T00:06:00.000Z'
      ),
      sourceBytes: methodBytes,
      capturedAt: '2026-08-12T00:06:00.000Z',
    });
    const hpn = calculation(factualRunId, method.methodId);
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$6,'{}'::jsonb)`,
        [
          method.content.sourceArtifact.artifactId,
          method.content.sourceArtifact.contentSha256,
          method.content.sourceArtifact.storageUri,
          method.content.sourceArtifact.mediaType,
          method.content.sourceArtifact.byteLength,
          method.content.sourceArtifact.createdAt,
        ]
      );
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      await seed.query(
        `INSERT INTO outcome_hpn_pav_method
         (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
           method_canonical_json,method_json)
         VALUES ($1,$2,'non_production',$3,$4,$4,$5,$6::jsonb)`,
        [
          method.methodId,
          method.methodId.slice('hpn-pav-method:'.length),
          method.content.sourceArtifact.artifactId,
          method.content.capturedAt,
          canonicalizeAflTradeJson(method.content),
          canonicalizeAflTradeJson(method),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_hpn_pav_calculation
          (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,environment,
           competition,season_year,effective_through,calculated_at,value_unit,status,team_count,
           player_count,calculation_canonical_json,calculation_json,finalized_at)
         VALUES ($1,$2,$3,$4,$5,'non_production','AFLM',$6,$7,$8,'season_pav','finalized',
           $9,$10,$11,$12::jsonb,$8)`,
        [
          hpn.calculationId,
          hpn.calculationId.slice('hpn-pav-season:'.length),
          hpn.content.schemaVersion,
          hpn.content.inputSetId,
          hpn.content.methodId,
          hpn.content.seasonYear,
          hpn.content.effectiveThrough,
          hpn.content.calculatedAt,
          hpn.content.teams.length,
          hpn.content.players.length,
          canonicalizeAflTradeJson(hpn.content),
          canonicalizeAflTradeJson(hpn),
        ]
      );
      await seed.query(`SET LOCAL session_replication_role='origin'`);
      for (const [receipt, operationKind] of [
        [admitted.derivationReceipt, 'derived_feature_creation'],
        [admitted.evidence.admissionEvaluationReceipts[0]!, 'model_training'],
      ] as const) {
        const gate0Authority = await seed.query<{
          readonly state: string;
          readonly environment: string;
          readonly effective_at: Date | string;
          readonly revalidate_at: Date | string;
          readonly successor_count: number;
        }>(
          `SELECT decision.state,decision.environment::text,decision.effective_at,
                  decision.revalidate_at,
                  (SELECT count(*)::integer FROM outcome_gate_decision successor
                    WHERE successor.supersedes_decision_id=decision.decision_id) AS successor_count
             FROM outcome_gate_decision decision WHERE decision.decision_id=$1`,
          [receipt.content.result.decisionId]
        );
        const authority = gate0Authority.rows[0];
        if (
          authority === undefined ||
          receipt.content.result.status !== 'mechanically_eligible' ||
          authority.state !== 'approved' ||
          authority.environment !== receipt.content.request.environment ||
          Date.parse(new Date(authority.effective_at).toISOString()) >
            Date.parse(receipt.content.request.evaluatedAt) ||
          Date.parse(new Date(authority.revalidate_at).toISOString()) <=
            Date.parse(receipt.content.request.evaluatedAt) ||
          authority.successor_count !== 0
        ) {
          throw new Error(
            `Gate 0A diagnostic mismatch: ${JSON.stringify({ authority, receipt })}`
          );
        }
        await seed.query(
          `INSERT INTO outcome_valuation_dataset_gate0_evaluation
            (receipt_id,rights_artifact_id,decision_id,environment,evaluated_at,recorded_at,
             operation_kind,receipt_canonical_json,receipt_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            receipt.receiptId,
            receipt.content.request.rightsArtifactId,
            receipt.content.result.decisionId,
            receipt.content.request.environment,
            receipt.content.request.evaluatedAt,
            receipt.content.recordedAt,
            operationKind,
            canonicalizeAflTradeJson(receipt.content),
            canonicalizeAflTradeJson(receipt),
          ]
        );
      }
      const dataset = admitted.datasetCandidate.content;
      const admission = admitted.admission.content;
      for (const authority of operationAuthorities) {
        const authorityKind = authority.content.authorityKind;
        await seed.query(
          `SET LOCAL ROLE ${
            authorityKind === 'analytical_authority'
              ? 'afl_trade_analytical_authority_registry_writer'
              : 'afl_trade_operational_authorization_registry_writer'
          }`
        );
        await seed.query(
          `INSERT INTO outcome_valuation_dataset_operation_authority
            (receipt_id,authority_kind,environment,scope_key,dataset_id,factual_release_id,
             factual_candidate_id,authorized_at,valid_through,principal_ref,
             receipt_canonical_json,receipt_json)
           VALUES ($1,$2,'non_production',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            authority.receiptId,
            authorityKind,
            dataset.scopeKey,
            admitted.datasetCandidate.datasetId,
            dataset.factualParent.factualReleaseId,
            dataset.factualParent.factualCandidateId,
            authority.content.authorizedAt,
            authority.content.validThrough,
            authority.content.principalRef,
            canonicalizeAflTradeJson(authority.content),
            canonicalizeAflTradeJson(authority),
          ]
        );
      }
      await seed.query('RESET ROLE');
      await seed.query(
        `INSERT INTO outcome_valuation_dataset_admission
          (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,
           gate_ledger_revision,analytical_authority_receipt_id,
           operational_authorization_receipt_id,source_count,status,
           admission_canonical_json,admission_json,finalized_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staged',$10,$11::jsonb,NULL)`,
        [
          admitted.admission.admissionId,
          admitted.datasetCandidate.datasetId,
          admission.environment,
          admission.admittedAt,
          admission.gate2Decision.decisionId,
          gate2State.revision,
          admission.analyticalAuthorityReceiptId,
          admission.operationalAuthorizationReceiptId,
          admission.sourceRightsEvaluations.length,
          canonicalizeAflTradeJson(admission),
          canonicalizeAflTradeJson(admitted.admission),
        ]
      );
      for (const [index, evaluation] of admission.sourceRightsEvaluations.entries()) {
        await seed.query(
          `INSERT INTO outcome_valuation_dataset_admission_source
            (admission_id,ordinal,capture_id,source_snapshot_id,consumed_field_set_id,
             rights_artifact_id,derivation_decision_id,derivation_receipt_id,
             admission_decision_id,admission_receipt_id,source_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            admitted.admission.admissionId,
            index + 1,
            evaluation.captureId,
            evaluation.sourceSnapshotId,
            evaluation.consumedFieldSetId,
            evaluation.proposalId,
            evaluation.derivationDecisionId,
            evaluation.derivationEvaluationReceiptId,
            evaluation.admissionDecisionId,
            evaluation.admissionEvaluationReceiptId,
            canonicalizeAflTradeJson(evaluation),
          ]
        );
      }
      await seed.query(
        `UPDATE outcome_valuation_dataset_admission
            SET status='finalized',finalized_at=$2
          WHERE admission_id=$1 AND status='staged'`,
        [admitted.admission.admissionId, admission.admittedAt]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_model_protocol
          (protocol_id,environment,dataset_id,admission_id,analytical_authority_receipt_id,
           prepared_at,protocol_canonical_json,protocol_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          admitted.protocol.protocolId,
          admitted.protocol.content.environment,
          admitted.protocol.content.datasetId,
          admitted.protocol.content.datasetAdmission.admissionId,
          admission.analyticalAuthorityReceiptId,
          admitted.protocol.content.preparedAt,
          canonicalizeAflTradeJson(admitted.protocol.content),
          canonicalizeAflTradeJson(admitted.protocol),
        ]
      );
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      for (const metric of admitted.spellMetrics) {
        const content = metric.content;
        await seed.query(
          `INSERT INTO outcome_acquisition_spell_metric_version
            (spell_metric_version_id,batch_id,spell_version_id,metric_code,definition_version,state,
             numeric_value,reason_code,coverage_numerator,coverage_denominator,observation_count,
             effective_through,fact_sha256,fact_json,recorded_at,expected_head_revision,head_revision)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,0,1)`,
          [
            metric.spellMetricVersionId,
            addressed(
              'acquisition-spell-metric-batch',
              `admitted-player-seed:${metric.spellMetricVersionId}`
            ),
            content.spell.spellVersionId,
            content.rule.metricCode,
            content.rule.definitionVersion,
            content.availability.state,
            content.availability.numericValue,
            content.availability.reasonCode,
            content.coverageNumerator,
            content.coverageDenominator,
            content.observationCount,
            content.effectiveThrough,
            metric.factSha256,
            canonicalizeAflTradeJson(metric),
            content.recordedAt,
          ]
        );
      }
      await seed.query(`SET LOCAL session_replication_role='origin'`);
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const artifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory: artifactRoot,
      repositoryId: 'genuine-admitted-player-postgres-tracer',
      maximumObjectBytes: 4 * 1024 * 1024,
    });
    for (const executable of admitted.evidence.executableArtifacts) {
      const reference = [
        admitted.intent.content.sourceCodeArtifact,
        admitted.intent.content.dependencyLockArtifact,
        admitted.intent.content.runtimeArtifact,
        admitted.intent.content.containerArtifact,
        admitted.intent.content.configurationArtifact,
        admitted.intent.content.environmentArtifact,
        ...admitted.intent.content.featureDefinitionArtifacts,
        admitted.protocol.content.valueUnit.definitionArtifact,
        admitted.protocol.content.footballContext.roleTaxonomyArtifact,
        admitted.protocol.content.footballContext.eraDefinitionArtifact,
        admitted.protocol.content.replacementBaseline.definitionArtifact,
        admitted.protocol.content.featurePolicy.featureAvailabilityArtifact,
        admitted.protocol.content.contributionAndCensoringPolicy
          .unavailableObservationTreatmentArtifact,
        admitted.protocol.content.contributionAndCensoringPolicy.censoringDefinitionArtifact,
        admitted.protocol.content.scalarValueTransformArtifact,
        admitted.protocol.content.pointInTimeFeatureValuesArtifact!,
        ...admitted.protocol.content.validationPlan.baselineDefinitionArtifacts,
        ...admitted.protocol.content.validationPlan.metricDefinitionArtifacts,
        admitted.protocol.content.validationPlan.intervalCalibrationArtifact,
        ...admitted.protocol.content.validationPlan.sensitivityAnalysisArtifacts,
        admitted.protocol.content.validationPlan.acceptanceCriteriaArtifact,
      ].find(({ artifactId }) => artifactId === executable.artifactId)!;
      await artifactRepository.putIfAbsent(reference, executable.bytes);
    }

    const targets = {
      player: {
        modelId: admitted.intent.content.modelId,
        modelVersion: admitted.intent.content.modelVersion,
        protocolId: admitted.protocol.protocolId,
        datasetId: admitted.datasetCandidate.datasetId,
        datasetAdmissionId: admitted.admission.admissionId,
      },
      pick: {
        protocolId: addressed('model-protocol', 'unused-pick-protocol'),
        datasetId: addressed('dataset', 'unused-pick-dataset'),
        datasetAdmissionId: addressed('dataset-admission', 'unused-pick-admission'),
        policyId: addressed('pick-pav-policy', 'unused-pick-policy'),
      },
      qualificationPolicyId: addressed('model-qualification-policy', 'unused-qualification-policy'),
    };
    const exactInput = await loadAflTradePrivateValuationModelPairExactInput({
      client,
      prepared: {
        state: 'already_prepared',
        requestId,
        factualOutputId: factual.outputId,
        inputSetId: hpn.content.inputSetId,
        calculationId: hpn.calculationId,
        captureBindingIds: [],
        sourceAdmissionIds: [],
        publicationEligible: false,
      },
      targets,
    });
    const pairRepository = new PostgresAflTradePrivateValuationModelPairRepository(client);
    const claim = { claimId, leaseToken };
    const state = await pairRepository.bindInput({ exactInput, claim });

    restrictedPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schemaName} -c role=afl_trade_private_evaluation_coordinator`,
      max: 2,
    });
    const restrictedClient = createPgAflOutcomeSqlClient(restrictedPool);
    const componentRepository = new PostgresGovernedValuationComponentRunRepository({
      client: restrictedClient,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
    });
    const executor = createLocalAflTradeGenuineAdmittedPlayerExecutor({
      sql: restrictedClient,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
      gateDecisionLedgerRepository:
        createPostgresAflTradeGateDecisionLedgerRepository(restrictedClient),
      componentRepository,
      profile: {
        codeCommitSha: admitted.intent.content.codeCommitSha,
        seed: admitted.intent.content.seed,
        sourceCodeArtifact: admitted.intent.content.sourceCodeArtifact,
        dependencyLockArtifact: admitted.intent.content.dependencyLockArtifact,
        runtimeArtifact: admitted.intent.content.runtimeArtifact,
        containerArtifact: admitted.intent.content.containerArtifact,
        configurationArtifact: admitted.intent.content.configurationArtifact,
        environmentArtifact: admitted.intent.content.environmentArtifact,
      },
    });
    const execution = {
      exactInput,
      operation: state.operation,
      attemptNumber: state.attemptNumber,
      claim,
    };

    const completed = await executor.execute(execution);
    if (completed.state !== 'completed') throw new Error(completed.reason);
    await expect(
      pool.query(
        `SELECT component.run_id,component.native_execution_kind,native.status,
                operational.receipt_json->'content'->>'principalRef' AS principal_ref,
                operational.receipt_json->'content'->>'role' AS role,
                operational.receipt_json->'content'->>'environment' AS environment
           FROM outcome_governed_valuation_component_run component
           JOIN outcome_valuation_model_run native
             ON native.run_id=component.native_execution_id
           JOIN outcome_valuation_model_run_authorization run_authorization
             ON run_authorization.authorization_id=native.authorization_id
           JOIN outcome_valuation_model_run_operational_authorization operational
             ON operational.receipt_id=run_authorization.operational_authorization_receipt_id
          WHERE component.run_id=$1`,
        [completed.runId]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          run_id: completed.runId,
          native_execution_kind: 'admitted_player_model_run',
          status: 'succeeded',
          principal_ref: 'system:weekly-valuation-coordinator',
          role: 'afl_trade_private_evaluation_coordinator',
          environment: 'non_production',
        },
      ],
    });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_valuation_model_run) AS native_runs,
           (SELECT count(*)::integer FROM outcome_valuation_model_run_authorization) AS authorizations,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run) AS components`
      )
    ).resolves.toMatchObject({
      rows: [{ native_runs: 1, authorizations: 1, components: 1 }],
    });

    const replay = await executor.execute(execution);
    expect(replay).toEqual(completed);
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_valuation_model_run) AS native_runs,
           (SELECT count(*)::integer FROM outcome_valuation_model_run_authorization) AS authorizations,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run) AS components`
      )
    ).resolves.toMatchObject({
      rows: [{ native_runs: 1, authorizations: 1, components: 1 }],
    });

    const expiry = await pool.connect();
    try {
      await expiry.query('BEGIN');
      await expiry.query(`SET LOCAL session_replication_role='replica'`);
      await expiry.query(
        `UPDATE outcome_private_valuation_dispatch_request
            SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
          WHERE request_id=$1`,
        [requestId]
      );
      await expiry.query(
        `UPDATE outcome_private_valuation_dispatch_attempt
            SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
          WHERE claim_id=$1`,
        [claimId]
      );
      await expiry.query('COMMIT');
    } catch (error) {
      await expiry.query('ROLLBACK');
      throw error;
    } finally {
      expiry.release();
    }
    const replacementLeaseToken = digest('replacement-admitted-player-lease');
    const replacement = await pool.query<{ readonly claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,300,$3)`,
      ['system:replacement-admitted-player-tracer', digest(replacementLeaseToken), requestId]
    );
    const replacementClaim = {
      claimId: replacement.rows[0]!.claim_id,
      leaseToken: replacementLeaseToken,
    };
    const replacementState = await pairRepository.bindInput({
      exactInput,
      claim: replacementClaim,
    });
    const replacementReplay = await executor.execute({
      ...execution,
      attemptNumber: replacementState.attemptNumber,
      claim: replacementClaim,
    });
    expect(replacementReplay).toEqual(completed);
    await expect(executor.execute(execution)).resolves.toMatchObject({ state: 'stale_authority' });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_valuation_model_run) AS native_runs,
           (SELECT count(*)::integer FROM outcome_valuation_model_run_authorization) AS authorizations,
           (SELECT count(*)::integer FROM outcome_governed_valuation_component_run) AS components`
      )
    ).resolves.toMatchObject({
      rows: [{ native_runs: 1, authorizations: 1, components: 1 }],
    });
  });
});
