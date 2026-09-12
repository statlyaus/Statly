import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  prepareLocalAflTradeFitzRoyAppearanceEvidence,
  prepareLocalAflTradeFitzRoyFactualReleaseCandidate,
  prepareLocalAflTradeFitzRoyMatchEvidence,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import { PostgresAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationSourceAdmission';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { PostgresAflTradePrivateFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationFactualPreparation';
import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
} from '../testUtils/privateValuationFactualPreparationFixture';
import { registerSourceFirstHpnResultsMapFixture } from '../testUtils/sourceFirstHpnResultsMapFixture';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  options: `-c search_path=${schemaName}`,
});
const client = createPgAflOutcomeSqlClient(pool);

beforeAll(async () => {
  await admin.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
      CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
    END IF;
  END $role$`);
  await admin.query('GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO statly_test');
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scoped.toString(),
  });
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await admin.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
});
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

// Synthetic source bytes and explicit test review records only. All source,
// factual, reconciliation, capture/admission and claim owners remain enabled.
it('admits retained primary, appearance and results sources under one request and binds the exact results HPN receipt', async () => {
  const supplemental = await prepareLocalAflTradeFitzRoyAppearanceEvidence(client, {
    missingCompletionStatus: true,
  });
  // Reconcile supplemental evidence before the final primary run, so the
  // primary candidate retains the current shared games head without rewinding it.
  const primary = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
    missingCompletionStatus: true,
  });
  const results = await prepareLocalAflTradeFitzRoyMatchEvidence(client);
  expect(results.factBatch.content.counts).toMatchObject({
    matchUniverse: 1,
    playerAppearances: 0,
    playerMatchMetrics: 0,
    playerSeasonMetrics: 0,
  });
  expect(results.factualRun.content.results).toEqual([]);
  expect(results.factualRun.content.headAdvances).toEqual([]);
  expect(supplemental.factBatch.content.counts).toMatchObject({
    matchUniverse: 1,
    playerAppearances: 1,
    playerMatchMetrics: 0,
    playerSeasonMetrics: 0,
  });
  expect(supplemental.factualRun.content.results[0]!.content.availability).toEqual({
    state: 'quarantined',
    numericValue: null,
    reasonCode: 'match_completion_quarantined',
  });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  for (const options of [
    { missingCompletionStatus: true },
    { provider: 'afl_tables', profile: 'appearance_only', missingCompletionStatus: true },
    { provider: 'afl_tables', profile: 'match_only' },
  ] as const) {
    const source = createLocalAflTradeFitzRoyFactualRehearsalFixture({
      ...options,
    }).command.capture;
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [
        {
          sourceRights: source.sourceRights,
          proposal: source.ledger.proposals[0]!,
          decision: source.ledger.decisions[0]!,
        },
      ],
    });
  }
  const requestId = await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    const result = await transaction.query<{ request_id: string }>(
      `SELECT enqueue_outcome_private_valuation_dispatch('afl-men:2026-trades','ad_hoc',
        date_trunc('milliseconds',clock_timestamp()),'synthetic-same-request-retained-sources') AS request_id`
    );
    return result.rows[0]!.request_id;
  });
  const schedule = new PostgresAflTradePrivateValuationScheduleRepository(client);
  const claimed = await schedule.claim('system:weekly-valuation-coordinator', requestId);
  if (!claimed) throw new Error('Expected one live fixture claim');
  const claim = { claimId: claimed.claimId, leaseToken: claimed.leaseToken };
  const captures = new PostgresAflTradePrivateValuationCaptureBindingRepository(client);
  const primaryInput = {
    request: claimed.request,
    claim,
    sourceRole: 'factual_input' as const,
    normalizationRunId: primary.receipt.normalizationRunId,
  };
  await expect(captures.accept(primaryInput)).rejects.toThrow('source custody is invalid');
  const primaryBinding = await captures.acceptSourceFirst(primaryInput);
  expect(primaryBinding.content.schemaVersion).toBe(
    'afl-trade-private-valuation-capture-binding/v3'
  );
  const sources = new PostgresAflTradePrivateValuationSourceAdmission(client);
  const primaryAdmission = await sources.admit({ requestId, claim });
  expect(primaryAdmission.state).toBe('admitted');
  expect(primaryAdmission.admission.content.schemaVersion).toBe(
    'afl-trade-private-valuation-source-admission/v1'
  );
  const supplementalBinding = await captures.acceptSourceFirst({
    request: claimed.request,
    claim,
    sourceRole: 'hpn_primary_player_stats',
    normalizationRunId: supplemental.ingestion.staging.normalization.normalizationRunId,
  });
  const supplementalInput = {
    requestId,
    claim,
    sourceRole: 'hpn_primary_player_stats' as const,
    primarySourceAdmissionId: primaryAdmission.admission.admissionId,
    captureBindingId: supplementalBinding.bindingId,
    sourceCaptureId: supplemental.ingestion.staging.capture.captureId,
    normalizationRunId: supplemental.ingestion.staging.normalization.normalizationRunId,
    factBatchId: supplemental.factBatch.batchId,
    factualRunId: supplemental.factualRun.factualRunId,
  };
  await expect(
    sources.admitSupplemental({
      ...supplementalInput,
      normalizationRunId: primary.receipt.normalizationRunId,
    })
  ).rejects.toThrow('distinct exact accepted source');
  const admitted = await sources.admitSupplemental(supplementalInput);
  expect(admitted.state).toBe('admitted');
  expect(admitted.admission.content.primarySourceAdmissionId).toBe(
    primaryAdmission.admission.admissionId
  );
  await expect(sources.admitSupplemental(supplementalInput)).resolves.toEqual({
    ...admitted,
    state: 'already_admitted',
  });
  await expect(captures.acceptSourceFirst(primaryInput)).resolves.toEqual(primaryBinding);
  const resultsBinding = await captures.acceptSourceFirst({
    request: claimed.request,
    claim,
    sourceRole: 'hpn_completed_results',
    normalizationRunId: results.ingestion.staging.normalization.normalizationRunId,
  });
  const resultsAdmissionInput = {
    requestId,
    claim,
    sourceRole: 'hpn_completed_results' as const,
    primarySourceAdmissionId: primaryAdmission.admission.admissionId,
    captureBindingId: resultsBinding.bindingId,
    sourceCaptureId: results.ingestion.staging.capture.captureId,
    normalizationRunId: results.ingestion.staging.normalization.normalizationRunId,
    factBatchId: results.factBatch.batchId,
    factualRunId: results.factualRun.factualRunId,
  };
  const resultsAdmission = await sources.admitSupplemental(resultsAdmissionInput);
  expect(resultsAdmission.state).toBe('admitted');
  const resultsMap = await registerSourceFirstHpnResultsMapFixture(client, results);
  const counts = await client.query<{ requests: number; admissions: number; metric_facts: number }>(
    `SELECT (SELECT count(*)::integer FROM outcome_private_valuation_dispatch_request) AS requests,
      (SELECT count(*)::integer FROM outcome_private_valuation_source_admission WHERE request_id=$1) AS admissions,
      (SELECT count(*)::integer FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=$2) AS metric_facts`,
    [requestId, supplemental.factBatch.batchId]
  );
  expect(counts.rows).toEqual([{ requests: 1, admissions: 3, metric_facts: 0 }]);
  // Admission is not a completed valuation. The one root request remains honest;
  // there is no second pending request to conceal incomplete auxiliary work.
  const status = await client.query<{ status: string }>(
    'SELECT status FROM outcome_private_valuation_dispatch_request WHERE request_id=$1',
    [requestId]
  );
  expect(status.rows[0]!.status).toBe('claimed');

  const supplementalFixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'appearance_only',
    missingCompletionStatus: true,
  });
  const declaredSources = [
    { ingestion: supplemental.ingestion, fixture: supplementalFixture },
    {
      ingestion: results.ingestion,
      fixture: createLocalAflTradeFitzRoyFactualRehearsalFixture({
        provider: 'afl_tables',
        profile: 'match_only',
      }),
    },
  ];
  const prepared = await new PostgresAflTradePrivateFactualPreparation(client, {
    prepareSourceEvidence: async () => {
      await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
        missingCompletionStatus: true,
      });
    },
    prepareCandidate: async () => {
      const spell = await seedPrivateValuationAcquisitionSpellFixture(
        client,
        primary.receipt.captureId,
        primary.candidate
      );
      const retainedAt = await client.query<{ now: Date }>(
        "SELECT date_trunc('milliseconds',clock_timestamp()) AS now"
      );
      const candidate = await persistPrivateValuationFactualCandidateFixture(
        client,
        primary.candidate,
        spell,
        claimed.request.scopeKey,
        {
          createdAt: retainedAt.rows[0]!.now.toISOString(),
          supplementalSources: declaredSources.map(({ ingestion, fixture }) => {
            const fields = ingestion.receipt.content.authorizationReceipt.content.request.fieldUses
              .map(({ sourceField }) => sourceField)
              .sort();
            return {
              member: {
                ordinal: 1,
                recordSha256: sha256AflTradeCanonicalJson({
                  captureId: ingestion.staging.capture.captureId,
                }),
                recordedAt: '2026-08-12T00:06:00.000Z',
                captureId: ingestion.staging.capture.captureId,
                sourceSnapshotId: ingestion.snapshotId,
                gate0aDecisionId: fixture.gateDecisionId,
                consumedFieldSetSha256: sha256AflTradeCanonicalJson(
                  fields.map((sourceField) => ({
                    sourceField,
                    uses: ['derived_feature', 'model_training'],
                  }))
                ),
              },
              rights: {
                sourceSnapshotId: ingestion.snapshotId,
                sourceRightsArtifactId: fixture.command.capture.sourceRights.rightsArtifactId,
                gateDecisionId: fixture.gateDecisionId,
                sourceRightsProposal: fixture.command.capture.sourceRights,
                gate0aReceipt: ingestion.receipt.content.authorizationReceipt,
                consumedSourceFields: fields,
              },
            };
          }),
        }
      );
      expect(candidate.content.members.sourceCaptures).toHaveLength(3);
      return { candidateId: candidate.candidateId };
    },
  }).prepare({ requestId, claim });
  expect(prepared.output.content.sourceAdmissionId).toBe(primaryAdmission.admission.admissionId);
  expect(prepared.output.content.reconciliation.factualRunId).toBe(primary.receipt.factualRunId);
  const hpnInput = {
    request: claimed.request,
    claim,
    factualOutputId: prepared.output.outputId,
    binding: resultsBinding,
    projectedFieldMapId: resultsMap.fieldMapId,
  };
  const hpnAdmission = await captures.admitHpnSource(hpnInput);
  expect(hpnAdmission.state).toBe('admitted');
  await expect(captures.admitHpnSource(hpnInput)).resolves.toEqual({
    ...hpnAdmission,
    state: 'already_admitted',
  });
  await expect(
    captures.admitHpnSource({ ...hpnInput, binding: supplementalBinding })
  ).rejects.toThrow();
  await expect(sources.admitSupplemental(supplementalInput)).resolves.toEqual({
    ...admitted,
    state: 'already_admitted',
  });

  await expect(
    client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await transaction.query(
        'UPDATE outcome_provider_identity_assignment_head SET identity_id=identity_id'
      );
    })
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
      await transaction.query(
        'UPDATE outcome_provider_identity_assignment_head SET identity_id=identity_id'
      );
    })
  ).rejects.toThrow();

  // Expiry is a new, explicitly synthetic decision through the real ledger,
  // never an edit to a retained approval or an override of its validator.
  const expireSource = async (
    source: ReturnType<
      typeof createLocalAflTradeFitzRoyFactualRehearsalFixture
    >['command']['capture']
  ) => {
    const previous = source.ledger.decisions[0]!;
    const clock = await client.query<{ now: Date }>(
      "SELECT date_trunc('milliseconds',clock_timestamp()) AS now"
    );
    const expiredProposalContent = {
      ...source.ledger.proposals[0]!.content,
      version: previous.content.version + 1,
      proposedAt: clock.rows[0]!.now.toISOString(),
      proposal: 'Explicit synthetic expiry regression; not a genuine source decision.',
    };
    const expiredProposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', expiredProposalContent),
      content: expiredProposalContent,
    });
    const expiredContent = {
      ...previous.content,
      proposalId: expiredProposal.proposalId,
      version: previous.content.version + 1,
      state: 'expired' as const,
      supersedesDecisionId: previous.decisionId,
      decidedAt: clock.rows[0]!.now.toISOString(),
      effectiveAt: clock.rows[0]!.now.toISOString(),
      revalidateAt: null,
      rationale: 'Explicit synthetic expiry regression; not a genuine source decision.',
    };
    const expired = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', expiredContent),
      content: expiredContent,
    });
    await ledger.append({
      expectedRevision: (await ledger.load()).revision,
      sourceRights: source.sourceRights,
      proposal: expiredProposal,
      decision: expired,
    });
  };
  // Isolate results permission expiry while primary and appearance permissions
  // remain valid. Exact replay cannot confer fresh HPN authority after expiry.
  await expireSource(
    createLocalAflTradeFitzRoyFactualRehearsalFixture({
      provider: 'afl_tables',
      profile: 'match_only',
    }).command.capture
  );
  const expiredHpn = await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    return transaction.query<{ current: boolean }>(
      'SELECT outcome_private_source_first_hpn_admission_is_current($1,$2,$3) AS current',
      [requestId, resultsBinding.bindingId, resultsMap.fieldMapId]
    );
  });
  expect(expiredHpn.rows).toEqual([{ current: false }]);
  await expect(captures.admitHpnSource(hpnInput)).rejects.toThrow(
    'Source-first HPN source authority is not current'
  );
  await expect(sources.admitSupplemental(supplementalInput)).resolves.toEqual({
    ...admitted,
    state: 'already_admitted',
  });
  await expireSource(
    createLocalAflTradeFitzRoyFactualRehearsalFixture({
      provider: 'afl_tables',
      profile: 'appearance_only',
      missingCompletionStatus: true,
    }).command.capture
  );
  const current = await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    return transaction.query<{ current: boolean }>(
      'SELECT outcome_private_supplemental_factual_batch_is_current($1,$2,$3,$4,2026) AS current',
      [
        supplementalInput.sourceCaptureId,
        supplementalInput.normalizationRunId,
        supplementalInput.factBatchId,
        supplementalInput.factualRunId,
      ]
    );
  });
  expect(current.rows).toEqual([{ current: false }]);
  await expect(sources.admitSupplemental(supplementalInput)).rejects.toThrow('not current');
  await expect(
    captures.acceptSourceFirst({
      request: claimed.request,
      claim,
      sourceRole: supplementalInput.sourceRole,
      normalizationRunId: supplementalInput.normalizationRunId,
    })
  ).rejects.toThrow('source rights are no longer current');
});
