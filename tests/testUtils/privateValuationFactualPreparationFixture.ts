import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
  AFL_TRADE_ACQUISITION_SPELL_METRIC_POLICY_SCHEMA_VERSION,
  createAflTradeAcquisitionSpellMetricPolicy,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellMetricContracts';
import { calculateAflTradeAcquisitionSpellMetrics } from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellMetricService';
import {
  createAflTradeFactualReleaseCandidate,
  type AflTradeFactualReleaseCandidate,
} from '@/server/aflTradeIntelligence/outcomes/factualReleaseCandidateContracts';
import {
  createAflDraftTradeOutcomeFactualReleaseManifest,
  type AflDraftTradeOutcomeFactualReleaseManifest,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import { PostgresAflTradeAcquisitionSpellMetricRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellMetricRepository';
import { PostgresAflTradeFactualReleaseCandidateWriter } from '@/server/aflTradeIntelligence/outcomes/postgresFactualReleaseCandidateRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';

import { stageLocalAflTradeFitzRoyFixture } from './localFitzRoyStagingFixture';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

const SCOPE_KEY = 'afl-men:2026-trades';
const SCHEDULED_FOR = '2026-08-12T00:00:05.000Z';

export async function stageAcceptedPrivateValuationCaptureFixture(
  client: AflOutcomeSqlClient,
  operationKey: string
) {
  const ingestion = await stageLocalAflTradeFitzRoyFixture(client);
  const requestId = await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    const enqueued = await transaction.query<{ request_id: string }>(
      `SELECT enqueue_outcome_private_valuation_dispatch($1,'ad_hoc',$2::timestamptz,$3)
              AS request_id`,
      [SCOPE_KEY, SCHEDULED_FOR, operationKey]
    );
    const retainedRequestId = enqueued.rows[0]?.request_id;
    if (!retainedRequestId || enqueued.rows.length !== 1) {
      throw new TypeError('The factual-preparation fixture did not enqueue exactly one request.');
    }
    return retainedRequestId;
  });
  const schedule = new PostgresAflTradePrivateValuationScheduleRepository(client);
  const claim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
  if (claim === null) {
    throw new TypeError('The factual-preparation fixture did not claim its due request.');
  }
  const binding = await new PostgresAflTradePrivateValuationCaptureBindingRepository(client).accept({
    request: claim.request,
    claim: { claimId: claim.claimId, leaseToken: claim.leaseToken },
    normalizationRunId: ingestion.staging.normalization.normalizationRunId,
  });
  return { ingestion, requestId, claim, binding };
}

function immutableReference(prefix: string, content: unknown) {
  const id = createAflTradeContentAddress(prefix, content);
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function calendarDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export async function seedPrivateValuationAcquisitionSpellFixture(
  client: AflOutcomeSqlClient,
  captureId: string,
  baseCandidate: AflTradeFactualReleaseCandidate,
  fixtureKey = 'default'
) {
  const player = await client.query<{ player_id: string; player_identity_id: string }>(
    `SELECT player_id,player_identity_id
       FROM outcome_provider_player_resolution
      WHERE outcome='approved' AND player_id IS NOT NULL AND player_identity_id IS NOT NULL
      ORDER BY revision DESC LIMIT 1`
  );
  const club = await client.query<{ club_id: string }>(
    `SELECT club_id
       FROM outcome_provider_club_resolution
      WHERE outcome='approved' AND club_id IS NOT NULL
      ORDER BY revision DESC LIMIT 1`
  );
  const playerRow = player.rows[0];
  const clubRow = club.rows[0];
  if (!playerRow || !clubRow) {
    throw new TypeError('The spell fixture requires existing reviewed player and club identities.');
  }
  const currentSpell = await client.query<{
    spell_id: string;
    spell_version_id: string;
    version: number;
  }>(
    `SELECT spell.spell_id,spell.spell_version_id,spell.version
       FROM outcome_acquisition_spell_version spell
      WHERE spell.player_id=$1 AND spell.club_id=$2
        AND NOT EXISTS (
          SELECT 1 FROM outcome_acquisition_spell_version successor
           WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
      ORDER BY spell.version DESC LIMIT 1`,
    [playerRow.player_id, clubRow.club_id]
  );
  const predecessor = currentSpell.rows[0] ?? null;

  const recordedAt = '2026-08-12T00:04:30.000Z';
  const policyVersion = `private-valuation-fixture/${fixtureKey}`;
  const importRunId = createAflTradeContentAddress('import-run', { captureId, fixtureKey });
  const importRowId = createAflTradeContentAddress('import-row', { importRunId });
  const importPartitionId = createAflTradeContentAddress('import-partition', { importRunId });
  const eventId = createAflTradeContentAddress('outcome-event', { captureId, fixtureKey });
  const eventVersionId = createAflTradeContentAddress('outcome-event-version', { eventId });
  const assetVersionId = createAflTradeContentAddress('outcome-asset-version', { eventVersionId });
  const rule = immutableReference('acquisition-spell-rule', { policyVersion });
  const spellId =
    predecessor?.spell_id ??
    createAflTradeContentAddress('acquisition-spell', {
      playerId: playerRow.player_id,
      clubId: clubRow.club_id,
      fixtureKey,
    });
  const spellVersion = (predecessor?.version ?? 0) + 1;
  const spellVersionId = createAflTradeContentAddress('acquisition-spell-version', {
    spellId,
    eventVersionId,
    spellVersion,
  });
  await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_import_run
        (import_run_id,capture_id,import_kind,parser_version,started_at,completed_at,status,manifest_json)
       VALUES ($1,$2,'private_valuation_fixture',$3,$4,$4,'approved',$5::jsonb)`,
      [importRunId, captureId, policyVersion, recordedAt, canonicalizeAflTradeJson({ captureId, fixtureKey })]
    );
    await transaction.query(
      `INSERT INTO outcome_import_row
        (import_row_id,import_run_id,source_locator,source_ordinal,record_kind,row_sha256,
         parse_status,raw_payload,recorded_at)
       VALUES ($1,$2,$3,1,'event',$4,'approved',$5::jsonb,$6)`,
      [
        importRowId,
        importRunId,
        `fixture://private-valuation/${fixtureKey}`,
        immutableReference('fixture-row', { importRowId }).sha256,
        canonicalizeAflTradeJson({ eventId }),
        recordedAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_import_partition
        (import_partition_id,import_run_id,partition_key,partition_kind,competition,
         season_year,row_count,rows_sha256,partition_json)
       VALUES ($1,$2,'AFLM:2026','season','AFLM',2026,1,$3,$4::jsonb)`,
      [
        importPartitionId,
        importRunId,
        immutableReference('fixture-partition', { importRowId }).sha256,
        canonicalizeAflTradeJson({ competition: 'AFLM', seasonYear: 2026 }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_import_partition_row
        (import_partition_id,import_row_id,import_run_id,ordinal) VALUES ($1,$2,$3,1)`,
      [importPartitionId, importRowId, importRunId]
    );
    await transaction.query(
      `INSERT INTO outcome_event (event_id,competition,season_year,stable_key)
       VALUES ($1,'AFLM',2026,$2)`,
      [eventId, `private-valuation-fixture:${captureId}:${fixtureKey}`]
    );
    await transaction.query(
      `INSERT INTO outcome_event_version
        (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,
         official_name,status,source_import_row_id,recorded_at)
       VALUES ($1,$2,1,'other_acquisition','pre_draft','2026-01-01',
               'Private valuation fixture','approved',$3,$4)`,
      [eventVersionId, eventId, importRowId, recordedAt]
    );
    await transaction.query(
      `INSERT INTO outcome_event_party
        (event_version_id,club_id,source_import_row_id,role,ordinal)
       VALUES ($1,$2,$3,'receiving_club',1)`,
      [eventVersionId, clubRow.club_id, importRowId]
    );
    await transaction.query(
      `INSERT INTO outcome_event_asset
        (asset_version_id,event_version_id,asset_key,kind,player_id,player_identity_id,
         from_club_id,to_club_id,source_import_row_id,raw_description,status)
       VALUES ($1,$2,'fixture-player','player',$3,$4,NULL,$5,$6,'Fixture player','approved')`,
      [
        assetVersionId,
        eventVersionId,
        playerRow.player_id,
        playerRow.player_identity_id,
        clubRow.club_id,
        importRowId,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_rule
        (rule_id,rule_version,definition_json,status,created_at)
       VALUES ($1,$2,$3::jsonb,'approved',$4)`,
      [rule.id, policyVersion, canonicalizeAflTradeJson({ fixtureKey }), recordedAt]
    );
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_version
        (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
         start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
         supersedes_spell_version_id,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-01-01',NULL,NULL,$8,'approved',$9,$10)`,
      [
        spellVersionId,
        spellId,
        spellVersion,
        playerRow.player_id,
        clubRow.club_id,
        eventVersionId,
        assetVersionId,
        rule.id,
        predecessor?.spell_version_id ?? null,
        recordedAt,
      ]
    );
  });

  const metricDefinitions = Object.fromEntries(
    AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.filter(({ metric }) =>
      ['games', 'goals'].includes(metric)
    ).map(({ metric, metricDefinitionId }) => [
      metric,
      { id: metricDefinitionId, sha256: metricDefinitionId.slice(metricDefinitionId.indexOf(':') + 1) },
    ])
  ) as Record<'games' | 'goals', { id: string; sha256: string }>;
  const approval = immutableReference('acquisition-spell-metric-policy-approval', {
    policyVersion,
  });
  const policy = createAflTradeAcquisitionSpellMetricPolicy({
    schemaVersion: AFL_TRADE_ACQUISITION_SPELL_METRIC_POLICY_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    validFromSeason: 2026,
    validThroughSeason: 2026,
    policyVersion,
    approval,
    rules: (['games', 'goals'] as const).map((metricCode) => ({
      metricCode,
      definitionVersion: `${metricCode}/v1`,
      definition: metricDefinitions[metricCode],
      unit: metricCode,
      sourceGrain: 'match' as const,
      aggregation: 'sum_non_negative_integer' as const,
      attribution: 'exact_player_real_club_and_effective_date_inside_spell' as const,
      noEvidenceSemantics: 'unavailable_never_zero' as const,
      conflictSemantics: 'preserve_conflict_and_withhold_numeric_total' as const,
    })),
    createdAt: recordedAt,
  });
  await client.transaction(async (transaction) => {
    await transaction.query(
      'SET LOCAL ROLE afl_trade_nonproduction_spell_metric_policy_reviewer'
    );
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'acquisition_spell_metric_policy',$2,'approved',$3,$4::jsonb,$5,$6)`,
      [
        approval.id,
        policy.policyId,
        'Approve the exact disposable spell-metric fixture policy.',
        canonicalizeAflTradeJson({ environment: 'non_production' }),
        'private-valuation-fixture-reviewer',
        recordedAt,
      ]
    );
  });
  const repository = new PostgresAflTradeAcquisitionSpellMetricRepository(client);
  await repository.persistPolicy(policy, { environment: 'non_production' });
  const factualRun = baseCandidate.content.members.factualRuns[0];
  if (!factualRun) throw new TypeError('The spell fixture requires one finalized factual run.');
  const storedSpell = await client.query<{
    spell_version_id: string;
    spell_id: string;
    version: number;
    player_id: string;
    club_id: string;
    start_event_version_id: string;
    start_asset_version_id: string;
    start_date: Date | string;
    end_date: Date | string | null;
    recorded_at: Date | string;
  }>(
    `SELECT spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
            start_asset_version_id,start_date,end_date,recorded_at
       FROM outcome_acquisition_spell_version WHERE spell_version_id=$1`,
    [spellVersionId]
  );
  const retainedSpell = storedSpell.rows[0];
  if (!retainedSpell) throw new TypeError('The spell fixture did not retain its exact spell.');
  const reconciled = await client.query<{
    fact_json: unknown;
    reconciled_fact_id: string;
    fact_sha256: string;
    subject_key: string;
    revision: number;
    finalized_at: Date | string;
  }>(
    `SELECT fact.fact_json,fact.reconciled_fact_id,fact.fact_sha256,
            head.subject_key,head.revision,run.finalized_at
       FROM outcome_reconciled_factual_metric fact
       JOIN outcome_reconciled_factual_metric_head head
         ON head.reconciled_fact_id=fact.reconciled_fact_id
       JOIN outcome_factual_reconciliation_run run
         ON run.factual_run_id=fact.factual_run_id
      WHERE fact.factual_run_id=$1 ORDER BY fact.reconciled_fact_id`,
    [factualRun.factualRunId]
  );
  const spell = {
    spellVersionId: retainedSpell.spell_version_id,
    spellId: retainedSpell.spell_id,
    version: retainedSpell.version,
    playerId: retainedSpell.player_id,
    clubId: retainedSpell.club_id,
    startEventVersionId: retainedSpell.start_event_version_id,
    startAssetVersionId: retainedSpell.start_asset_version_id,
    startDate:
      calendarDate(retainedSpell.start_date),
    endDate:
      retainedSpell.end_date === null
        ? null
        : calendarDate(retainedSpell.end_date),
    rule,
    status: 'approved' as const,
    recordedAt:
      retainedSpell.recorded_at instanceof Date
        ? retainedSpell.recorded_at.toISOString()
        : retainedSpell.recorded_at,
  };
  const batch = calculateAflTradeAcquisitionSpellMetrics({
    policy,
    spell,
    currentMembers: reconciled.rows.map((row) => ({
      factualRunId: factualRun.factualRunId,
      factualRunSha256: factualRun.factualRunId.slice(
        'factual-reconciliation-run:'.length
      ),
      environment: 'non_production' as const,
      finalization: factualRun.finalization,
      finalizedAt:
        row.finalized_at instanceof Date ? row.finalized_at.toISOString() : row.finalized_at,
      subjectKey: row.subject_key,
      headRevision: row.revision,
      result: {
        reconciledFactId: row.reconciled_fact_id,
        factSha256: row.fact_sha256,
        content: row.fact_json,
      },
    })),
    currentHeadRevisions: [],
    recordedAt: '2026-08-12T00:04:45.000Z',
  });
  await repository.persistBatch(batch, { environment: 'non_production' });
  return { policy, spell, batch, spellVersionId, spellId, eventId, eventVersionId, rule };
}

export async function persistPrivateValuationFactualCandidateFixture(
  client: AflOutcomeSqlClient,
  baseCandidate: AflTradeFactualReleaseCandidate,
  spellFixture: Awaited<ReturnType<typeof seedPrivateValuationAcquisitionSpellFixture>>,
  scopeKey: string,
  spellMemberOverrides: Readonly<{ playerId?: string; clubId?: string }> = {}
) {
  const recordedAt = '2026-08-12T00:06:00.000Z';
  const members = {
    ...baseCandidate.content.members,
    eventVersions: [
      {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({
          eventVersionId: spellFixture.eventVersionId,
        }),
        recordedAt,
        eventVersionId: spellFixture.eventVersionId,
        eventId: spellFixture.eventId,
      },
    ],
    acquisitionSpells: [
      {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({
          spellVersionId: spellFixture.spellVersionId,
        }),
        recordedAt,
        spellVersionId: spellFixture.spellVersionId,
        spellId: spellFixture.spellId,
        playerId: spellMemberOverrides.playerId ?? spellFixture.spell.playerId,
        clubId: spellMemberOverrides.clubId ?? spellFixture.spell.clubId,
        startDate: spellFixture.spell.startDate,
        endDate: spellFixture.spell.endDate,
      },
    ],
    spellMetrics: [...spellFixture.batch.content.metrics]
      .sort((left, right) => left.spellMetricVersionId.localeCompare(right.spellMetricVersionId))
      .map((metric, index) => {
        const head = spellFixture.batch.content.headAdvances.find(
          ({ spellMetricVersionId }) => spellMetricVersionId === metric.spellMetricVersionId
        );
        if (!head) throw new TypeError('The spell fixture metric is missing its head advance.');
        return {
          ordinal: index + 1,
          recordSha256: metric.factSha256,
          recordedAt,
          spellMetricVersionId: metric.spellMetricVersionId,
          subjectKey: head.subjectKey,
          headRevision: head.nextRevision,
          spellVersionId: spellFixture.spellVersionId,
          policyId: spellFixture.policy.policyId,
          playerId: spellMemberOverrides.playerId ?? spellFixture.spell.playerId,
          clubId: spellMemberOverrides.clubId ?? spellFixture.spell.clubId,
          metricCode: metric.content.rule.metricCode,
          definition: metric.content.rule.definition,
          state: metric.content.availability.state,
          effectiveThrough: metric.content.effectiveThrough,
        };
      }),
  };
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const release = createAflDraftTradeOutcomeFactualReleaseManifest({
    ...baseCandidate.content.targetReleaseManifest.content,
    scopeKey,
    createdAt: recordedAt,
    effectiveThrough: recordedAt,
    acquisitionSpellRuleId: spellFixture.rule.id,
    outcomeRecordCount:
      members.reconciledMetrics.length +
      members.reconciledAchievements.length +
      members.spellMetrics.length,
    sourceMemberSetSha256: memberSetSha256,
  }) as AflDraftTradeOutcomeFactualReleaseManifest;
  const counts = Object.fromEntries(
    Object.entries(members).map(([kind, values]) => [kind, values.length])
  ) as AflTradeFactualReleaseCandidate['content']['counts'];
  const candidate = createAflTradeFactualReleaseCandidate({
    ...baseCandidate.content,
    scopeKey,
    createdAt: recordedAt,
    effectiveThrough: recordedAt,
    targetRelease: {
      id: release.releaseId,
      sha256: release.releaseId.slice('outcome-release:'.length),
    },
    targetReleaseManifest: release,
    acquisitionSpellRule: spellFixture.rule,
    members,
    memberSetSha256,
    counts,
  });
  await new PostgresAflTradeFactualReleaseCandidateWriter(client).persistCandidate(candidate);
  return candidate;
}
