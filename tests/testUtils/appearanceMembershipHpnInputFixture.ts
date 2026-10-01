import type { Pool } from 'pg';
import { expect } from 'vitest';
import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  prepareLocalAflTradeFitzRoyFactualReleaseCandidate,
  prepareLocalAflTradeFitzRoyMatchEvidence,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { PostgresAflTradeHpnPavCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavCalculationRepository';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { createAflTradeAppearanceMembershipSpellRule } from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { deriveAflTradeAppearanceMembershipSpells } from '@/server/aflTradeIntelligence/outcomes/appearanceMembershipSpellDerivation';
import { aflTradeFactualReconciliationRunSchema } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import { reconcileAflTradeFactualFacts } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationService';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { PostgresAflTradeFactualReconciliationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualReconciliationRepository';
import { stageLocalAflTradeFitzRoyFixture } from './localFitzRoyStagingFixture';
import { registerSourceFirstHpnPlayerMapFixture } from './sourceFirstHpnPlayerMapFixture';
import { registerSourceFirstHpnResultsMapFixture } from './sourceFirstHpnResultsMapFixture';

/**
 * Builds and finalizes one genuine 2026 HPN PAV season input set through every source, identity,
 * factual, projection, appearance-membership and HPN owner, without replacing a database guard.
 * Two providers each stage one home and one away player row for one completed match; no player
 * has a promoted entry event, so season PAV is attributed through appearance-membership (v3)
 * spells only. The schema must follow the local fitzRoy rehearsal naming pattern.
 */
export async function buildAppearanceMembershipHpnInputFixture({
  pool,
  client,
  instant,
}: {
  pool: Pool;
  client: AflOutcomeSqlClient;
  instant: () => Promise<string>;
}) {
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const sources = [];
  const primaryRuns: string[] = [];
  for (const provider of ['footywire', 'afl_tables'] as const) {
    for (const hpnPlayerSide of ['home', 'away'] as const) {
      const options = { provider, profile: 'hpn_player_stats' as const, hpnPlayerSide };
      const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
      const source = fixture.command.capture;
      if (hpnPlayerSide === 'home')
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
      const staged = await stageLocalAflTradeFitzRoyFixture(client, options);
      const factual = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
        provider,
        hpnPlayerStats: true,
        hpnPlayerSide,
      });
      if (provider === 'footywire') primaryRuns.push(factual.receipt.factualRunId);
      const map = await registerSourceFirstHpnPlayerMapFixture(
        client,
        staged,
        provider,
        hpnPlayerSide
      );
      sources.push({
        normalizationRunId: staged.staging.normalization.normalizationRunId,
        fieldMapId: map.fieldMapId,
        inputKind: 'player_match_stats',
        role: provider === 'footywire' ? 'primary' : 'corroborating',
      });
    }
  }
  const resultSource = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'match_only',
  }).command.capture;
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: resultSource.sourceRights,
        proposal: resultSource.ledger.proposals[0]!,
        decision: resultSource.ledger.decisions[0]!,
      },
    ],
  });
  const results = await prepareLocalAflTradeFitzRoyMatchEvidence(client);
  const resultMap = await registerSourceFirstHpnResultsMapFixture(client, results);
  sources.push({
    normalizationRunId: results.ingestion.staging.normalization.normalizationRunId,
    fieldMapId: resultMap.fieldMapId,
    inputKind: 'completed_match_result',
    role: null,
  });
  const storedRuns = await pool.query(
    'SELECT COALESCE(receipt_canonical_json::jsonb,receipt_json) AS receipt_json FROM outcome_factual_reconciliation_run WHERE factual_run_id=ANY($1::text[])',
    [primaryRuns]
  );
  const runs = storedRuns.rows.map(({ receipt_json }) =>
    aflTradeFactualReconciliationRunSchema.parse(receipt_json)
  );
  expect(runs).toHaveLength(2);
  const heads = await pool.query<{ subject_key: string; revision: number }>(
    'SELECT subject_key,revision FROM outcome_reconciled_factual_metric_head'
  );
  const combined = reconcileAflTradeFactualFacts({
    policy: runs[0]!.content.policy,
    sourceMemberships: runs.flatMap((run) => run.content.sourceMemberships),
    currentHeadRevisions: heads.rows.map((row) => ({
      subjectKey: row.subject_key,
      revision: row.revision,
    })),
    startedAt: await instant(),
    completedAt: await instant(),
  });
  await new PostgresAflTradeFactualReconciliationRepository(client).persistRun(combined, {
    environment: 'non_production',
  });
  const factualRunId = combined.factualRunId;
  const approve = async (type: string, subject: string, content: unknown) => {
    const id = `synthetic-appearance-review:${subject}`;
    await pool.query(
      `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
      VALUES($1,$2,$3,'approved','Synthetic appearance-membership HPN regression',$4::jsonb,'synthetic-reviewer',$5)`,
      [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
    );
    return id;
  };
  const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
  const ruleEvidenceBytes = new TextEncoder().encode(
    canonicalizeAflTradeJson({ ownerApprovedAppearanceMembership: 'season PAV attribution only' })
  );
  const ruleEvidence = createAflTradeCanonicalJsonArtifactRef(
    { ownerApprovedAppearanceMembership: 'season PAV attribution only' },
    await instant()
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
     VALUES($1,$2,$3,$4,$5,$6,$6,'non_production','derived_private','{}'::jsonb)`,
    [
      ruleEvidence.artifactId,
      ruleEvidence.contentSha256,
      ruleEvidence.storageUri,
      ruleEvidence.mediaType,
      ruleEvidence.byteLength,
      ruleEvidence.createdAt,
    ]
  );
  const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async () => ruleEvidenceBytes,
  });
  const rule = createAflTradeAppearanceMembershipSpellRule({
    ...scope,
    ruleVersion: 'synthetic-appearance-membership-hpn-v1',
    evidence: [ruleEvidence],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    rule,
    await approve('acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  const facts = await pool.query<{
    appearance_fact_id: string;
    player_id: string;
    represented_club_id: string;
    match_id: string;
    season_year: number;
    effective_at: Date;
    availability: 'measured' | 'missing' | 'not_applicable' | 'quarantined';
    appeared: boolean | null;
  }>(
    `SELECT fact.appearance_fact_id,fact.player_id,fact.represented_club_id,fact.match_id,
            fact.season_year,fact.effective_at,fact.availability::text AS availability,fact.appeared
       FROM outcome_provider_player_appearance_fact fact
       JOIN outcome_provider_fact_batch batch ON batch.fact_batch_id=fact.fact_batch_id
      WHERE fact.competition='AFLM' AND fact.season_year=2026 AND batch.status='approved'
        AND batch.environment='non_production'`
  );
  const proposals = deriveAflTradeAppearanceMembershipSpells({
    ...scope,
    seasonYear: 2026,
    ruleId: rule.ruleId,
    createdAt: await instant(),
    facts: facts.rows.map((fact) => ({
      appearanceFactId: fact.appearance_fact_id,
      playerId: fact.player_id,
      clubId: fact.represented_club_id,
      matchId: fact.match_id,
      competition: 'AFLM' as const,
      seasonYear: fact.season_year,
      effectiveAt: fact.effective_at.toISOString(),
      availability: fact.availability,
      appeared: fact.appeared,
    })),
  });
  expect(proposals.map(({ content }) => [content.playerId, content.clubId])).toEqual([
    ['afl-player:local-rehearsal', 'afl-club:local-rehearsal'],
    ['afl-player:local-rehearsal-away', 'afl-club:local-rehearsal-away'],
  ]);
  for (const proposal of proposals) {
    await spells.registerReviewedSpell(
      proposal,
      await approve('acquisition_spell_registration', proposal.spellVersionId, proposal),
      scope
    );
  }
  const repository = new PostgresAflTradeHpnPavInputRepository(client);
  const methodBytes = new TextEncoder().encode(
    '<html>Explicit synthetic HPN method fixture</html>'
  );
  const methodArtifact = createAflTradeByteArtifactRef(methodBytes, 'text/html', await instant());
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
     VALUES($1,$2,$3,$4,$5,$6,$7,'non_production','raw_source','{}'::jsonb)`,
    [
      methodArtifact.artifactId,
      methodArtifact.contentSha256,
      methodArtifact.storageUri,
      methodArtifact.mediaType,
      methodArtifact.byteLength,
      methodArtifact.createdAt,
      await instant(),
    ]
  );
  const method = createAflTradeHpnPavMethod({
    sourceArtifact: methodArtifact,
    sourceBytes: methodBytes,
    capturedAt: methodArtifact.createdAt,
  });
  const methodAuthority = { loadExact: async () => ({ method, sourceBytes: methodBytes }) };
  const calculations = new PostgresAflTradeHpnPavCalculationRepository(client, methodAuthority);
  await calculations.registerMethod(method, scope);
  const request = {
    ...scope,
    seasonYear: 2026,
    methodId: method.methodId,
    factualRunId,
    effectiveThrough: '2026-03-20T23:59:59.999Z',
    sources,
    knowledgePolicy: 'retrospective_as_recorded_by_input_creation',
    knowledgeCutoffAt: await instant(),
  };
  const built = await repository.buildAndPersistSeasonInputSet(request, scope);
  return { approve, built, calculations, proposals, repository, request, scope, spells };
}
