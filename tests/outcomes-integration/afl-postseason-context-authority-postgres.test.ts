import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import { materializeAflTradePostseasonValuation } from '@/server/aflTradeIntelligence/valuation/postgresPostseasonValuationMaterialization';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { PostgresAflTradeHpnPavCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavCalculationRepository';
import { createAflTradePlayerPavPolicy } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { PostgresAflTradePlayerPavObservationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPlayerPavObservationRepository';
import { materializeAflTradePostseasonObservation } from '@/server/aflTradeIntelligence/modeling/postgresPostseasonObservationMaterialization';
import { Pool } from 'pg';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { PostgresAflTradePromotionBackedCorpusRepository } from '@/server/aflTradeIntelligence/artifacts/postgresPromotionBackedCorpusRepository';
import { createAflTradePostseasonMaterializationReview } from '@/server/aflTradeIntelligence/modeling/postseasonMaterializationReview';
import { loadCurrentAflTradePostseasonContext } from '@/server/aflTradeIntelligence/modeling/postgresPostseasonContextAuthority';
import {
  createAflTradeWindowAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeWindowAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { PostgresAflTradePromotionBackedFactualReleaseRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedFactualReleaseRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');

it.each([false, true])(
  'authenticates reviewed release and spell with year-only date=%s',
  async (yearOnly) => {
    const schemaName = `postseason_context_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schemaName}`,
    });
    try {
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      const scoped = new URL(databaseUrl!);
      scoped.searchParams.set('schema', schemaName);
      runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
      const client = createPgAflOutcomeSqlClient(pool);
      const now = async () =>
        (
          await pool.query<{ at: Date }>(
            "SELECT date_trunc('milliseconds',clock_timestamp()) AS at"
          )
        ).rows[0]!.at.toISOString();
      const approve = async (id: string, type: string, subject: string, document: unknown) => {
        const at = await now();
        await pool.query(
          `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
        VALUES($1,$2,$3,'approved','Explicit synthetic postseason fixture',$4::jsonb,'synthetic-reviewer',$5)`,
          [id, type, subject, canonicalizeAflTradeJson(document), at]
        );
        return at;
      };
      const fixtureReceipt = createAflTradeExternalCaptureExecutionReceipt({
        schemaVersion: 'afl-trade-external-capture-execution/v1',
        rightsArtifactId: `source-rights:${'a'.repeat(64)}`,
        gateDecisionId: `gate-decision:${'b'.repeat(64)}`,
        gateDecisionKey: 'synthetic-postseason',
        ledgerRevision: 1,
        evaluatedAt: '2026-09-01T00:00:00.000Z',
        provider: 'draftguru',
        capabilityId: 'draftguru-trade-detail',
        parserVersion: 'draftguru/v1',
        fieldManifestSha256: 'c'.repeat(64),
        upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
        cacheSeconds: 86400,
        rawRetentionDays: 365,
        egressPolicyEvidenceId: `artifact:${'d'.repeat(64)}`,
      });
      const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
        fixtureCaptureExecutionReceipt: fixtureReceipt,
        ...(yearOnly ? { sessionProposalV5: true, partialTransactionDates: true } : {}),
      });
      const evidence = {
        read: async (reference: { artifactId: string }) => {
          const retained = promoted.retainedArtifacts.get(reference.artifactId);
          if (!retained) throw new Error('Unknown retained synthetic evidence.');
          return retained.bytes;
        },
      };
      const scope = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
      const spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, evidence);
      const rule = (
        yearOnly
          ? createAflTradeWindowAcquisitionSpellRegistrationRule
          : createAflTradeAcquisitionSpellRegistrationRule
      )({
        ...scope,
        ruleVersion: 'synthetic-postseason',
        evidence: [promoted.sourceArtifact],
        createdAt: await now(),
      });
      await approve('synthetic-postseason-rule', 'acquisition_spell_rule', rule.ruleId, rule);
      await spells.registerReviewedRule(rule, 'synthetic-postseason-rule', scope);
      const event = (
        await pool.query<{ event_id: string; season_year: number; event_date: string | null }>(
          `SELECT root.event_id,root.season_year,to_char(event.event_date,'YYYY-MM-DD') AS event_date
       FROM outcome_event_version event JOIN outcome_event root ON root.event_id=event.event_id
       WHERE event.event_version_id=$1`,
          [promoted.entry.eventVersionId]
        )
      ).rows[0]!;
      const entry = {
        promotionId: promoted.entry.promotionId,
        eventVersionId: promoted.entry.eventVersionId,
        assetVersionId: promoted.entry.assetVersionId,
        evidence: [promoted.sourceArtifact],
      };
      const commonSpell = {
        ...scope,
        playerId: promoted.playerId,
        clubId: promoted.clubId,
        departure: null,
        ruleId: rule.ruleId,
        version: 1,
        supersedesSpellVersionId: null,
        observedThrough: `${event.season_year}-12-31`,
        continuityEvidence: [promoted.sourceArtifact],
        createdAt: await now(),
      };
      const spell =
        event.event_date === null
          ? createAflTradeWindowAcquisitionSpellRegistration({
              ...commonSpell,
              entry: {
                ...entry,
                eventDate: null,
                datePrecision: {
                  precision: 'window',
                  eventDate: null,
                  earliestDate: `${event.season_year}-01-01`,
                  latestDate: `${event.season_year}-12-31`,
                },
              },
            })
          : createAflTradeAcquisitionSpellRegistration({
              ...commonSpell,
              entry: { ...entry, eventDate: event.event_date },
            });
      await approve(
        'synthetic-postseason-spell',
        'acquisition_spell_registration',
        spell.spellVersionId,
        spell
      );
      await spells.registerReviewedSpell(spell, 'synthetic-postseason-spell', scope);
      const corpus = await new PostgresAflTradePromotionBackedCorpusRepository(client).build({
        ...scope,
        knowledgeCutoffAt: await now(),
        createdAt: await now(),
      });
      const release = await new PostgresAflTradePromotionBackedFactualReleaseRepository(
        client
      ).build({
        corpusId: corpus.corpusId,
        scopeKey: 'synthetic-postseason-context',
        createdAt: await now(),
      });
      const review = createAflTradePostseasonMaterializationReview({
        schemaVersion: 'afl-trade-postseason-materialization-review/v1',
        authorityBoundary: 'private_factual_materialization_no_numerical_admission',
        ...scope,
        scopeKey: 'synthetic-postseason-context',
        releaseId: release.releaseId,
        spellVersionId: spell.spellVersionId,
        tradeId: event.event_id,
        ...{
          promotionId: entry.promotionId,
          eventVersionId: entry.eventVersionId,
        },
        tradeYear: event.season_year,
        tradeDate: event.event_date,
        period: 'established_postseason',
        reviewEvidence: promoted.sourceArtifact,
        createdAt: await now(),
      });
      const recordedAt = await approve(
        'synthetic-postseason-review',
        'postseason_materialization',
        review.reviewId,
        review
      );
      const request = {
        environment: scope.environment,
        reviewDecisionId: 'synthetic-postseason-review',
        knowledgeCutoffAt: await now(),
      };
      const load = (overrides = {}) =>
        client.transaction((transaction) =>
          loadCurrentAflTradePostseasonContext(transaction, { ...request, ...overrides }, evidence)
        );
      const result = await load();
      expect(result.context.content.tradeDate).toBe(yearOnly ? null : event.event_date);
      expect(result.context.content.tradeYear).toBe(event.season_year);
      expect(result.context.content.recordedAt).toBe(recordedAt);
      expect(result.acquisitionSpell).toEqual(spell);
      expect(result.release.releaseId).toBe(release.releaseId);
      expect(await load()).toEqual(result);
      const methodBytes = new TextEncoder().encode(
        '<html>Synthetic HPN method for missing-season materialization</html>'
      );
      const methodArtifact = createAflTradeByteArtifactRef(methodBytes, 'text/html', await now());
      await pool.query(
        `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,'test_fixture','raw_source','{}')`,
        [
          methodArtifact.artifactId,
          methodArtifact.contentSha256,
          methodArtifact.storageUri,
          methodArtifact.mediaType,
          methodArtifact.byteLength,
          methodArtifact.createdAt,
          await now(),
        ]
      );
      const method = createAflTradeHpnPavMethod({
        sourceArtifact: methodArtifact,
        sourceBytes: methodBytes,
        capturedAt: methodArtifact.createdAt,
      });
      const methodAuthority = { loadExact: async () => ({ method, sourceBytes: methodBytes }) };
      await new PostgresAflTradeHpnPavCalculationRepository(client, methodAuthority).registerMethod(
        method,
        scope
      );
      const policy = await client.transaction(async (transaction) => {
        const at = (
          await transaction.query<{ at: Date }>(
            "SELECT date_trunc('milliseconds',transaction_timestamp()) AS at"
          )
        ).rows[0]!.at.toISOString();
        const policy = createAflTradePlayerPavPolicy({
          schemaVersion: 'afl-trade-player-pav-policy/v2',
          knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
          authorityBoundary:
            'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
          publicationEligible: false,
          ...scope,
          policyVersion: 'synthetic-postseason-policy',
          featureHistorySeasons: 1,
          fixedHorizonSeasons: 3,
          methodId: method.methodId,
          sourceValueUnit: 'season_pav',
          outcomeValueUnit: 'fixed_horizon_pav',
          partitions: (['train', 'calibration', 'validation', 'final_test'] as const).map(
            (role, index) => ({
              role,
              fromPredictionSeason: event.season_year - 24 + index * 8,
              throughPredictionSeason: event.season_year - 24 + index * 8,
            })
          ),
          approvalDecision: { id: `review-decision:${'6'.repeat(64)}`, sha256: '6'.repeat(64) },
          createdAt: at,
        });
        const { approvalDecision: policyApproval, ...policyEvidence } = policy.content;
        await transaction.query(
          `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
        VALUES($1,'player_pav_policy',$2,'approved','Synthetic atomic policy approval',$3::jsonb,'synthetic-reviewer',date_trunc('milliseconds',transaction_timestamp()))`,
          [
            policyApproval.id,
            `AFLM:${policy.content.policyVersion}`,
            canonicalizeAflTradeJson(policyEvidence),
          ]
        );
        await new PostgresAflTradePlayerPavObservationRepository({
          query: transaction.query.bind(transaction),
          transaction: async (work) => work(transaction),
        }).registerPolicy(policy, scope);
        return policy;
      });
      const materializeRequest = {
        ...request,
        policyId: policy.policyId,
        knowledgeCutoffAt: await now(),
      };
      const materialize = (overrides = {}) =>
        client.transaction((transaction) =>
          materializeAflTradePostseasonObservation(
            transaction,
            { ...materializeRequest, ...overrides },
            methodAuthority,
            evidence
          )
        );
      const materialized = await materialize();
      expect(materialized.observation.content.context.content.tradeDate).toBe(event.event_date);
      expect(materialized.observation.content.context.content.recordedAt).toBe(recordedAt);
      expect(materialized.observation.content.features).toEqual([
        { seasonYear: event.season_year, state: 'unavailable', reason: 'season_incomplete' },
      ]);
      expect(materialized.observation.content.outcomes.map(({ seasonYear }) => seasonYear)).toEqual(
        [event.season_year + 1, event.season_year + 2, event.season_year + 3]
      );
      expect(
        materialized.observation.content.outcomes.every(
          (season) => season.state === 'unavailable' && !('values' in season)
        )
      ).toBe(true);
      expect(
        materialized.coverageBindings.every(({ calculationId }) => calculationId === null)
      ).toBe(true);
      expect(await materialize()).toEqual(materialized);
      await expect(materialize({ values: [{ totalPav: 99 }] })).rejects.toThrow();

      const caseFixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
      const retainParent = async (value: unknown) => {
        const ref = createAflTradeCanonicalJsonArtifactRef(value, await now());
        const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(value));
        await pool.query(
          `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at,verified_at,environment,artifact_class,custody_json)
          VALUES($1,$2,$3,$4,$5,$6,$7,'test_fixture','derived_private','{}')`,
          [
            ref.artifactId,
            ref.contentSha256,
            ref.storageUri,
            ref.mediaType,
            ref.byteLength,
            ref.createdAt,
            await now(),
          ]
        );
        promoted.retainedArtifacts.set(ref.artifactId, { reference: ref, bytes });
        return ref;
      };
      const valuationParents = {
        componentDrawSetArtifact: await retainParent(caseFixture.componentDrawSet),
        realizedContributionLedgerArtifact: await retainParent(
          caseFixture.realizedContributionLedger
        ),
        packagePolicyArtifact: await retainParent(caseFixture.packagePolicy),
        lineageGraphArtifact: await retainParent(caseFixture.lineageGraph),
        laterEffectiveAt: await now(),
      };
      const valuationReview = createAflTradePostseasonMaterializationReview({
        ...review.content,
        schemaVersion: 'afl-trade-postseason-materialization-review/v2',
        valuation: valuationParents,
        createdAt: await now(),
      });
      await approve(
        'synthetic-valuation-review',
        'postseason_materialization',
        valuationReview.reviewId,
        valuationReview
      );
      const valuationRequest = {
        ...materializeRequest,
        reviewDecisionId: 'synthetic-valuation-review',
        knowledgeCutoffAt: await now(),
      };
      const selectedValuation = await load({
        reviewDecisionId: valuationRequest.reviewDecisionId,
        knowledgeCutoffAt: valuationRequest.knowledgeCutoffAt,
      });
      expect(selectedValuation.review).toEqual(valuationReview);
      // Deliberately unrelated synthetic swap parents cannot stand in for this one-way source fixture.
      await expect(
        client.transaction((tx) =>
          materializeAflTradePostseasonValuation(tx, valuationRequest, methodAuthority, evidence)
        )
      ).rejects.toThrow('account for every factual transfer');
      const retainedParent = promoted.retainedArtifacts.get(
        valuationParents.packagePolicyArtifact.artifactId
      )!;
      promoted.retainedArtifacts.set(valuationParents.packagePolicyArtifact.artifactId, {
        ...retainedParent,
        bytes: new TextEncoder().encode('{}'),
      });
      await expect(
        load({
          reviewDecisionId: valuationRequest.reviewDecisionId,
          knowledgeCutoffAt: valuationRequest.knowledgeCutoffAt,
        })
      ).rejects.toThrow('bytes differ');
      promoted.retainedArtifacts.set(
        valuationParents.packagePolicyArtifact.artifactId,
        retainedParent
      );

      await expect(load({ environment: 'non_production' })).rejects.toThrow('scope differs');
      await expect(load({ reviewDecisionId: 'missing-review' })).rejects.toThrow('unavailable');
      await expect(load({ knowledgeCutoffAt: promoted.sourceArtifact.createdAt })).rejects.toThrow(
        'unavailable'
      );
      await expect(
        client.transaction((transaction) =>
          loadCurrentAflTradePostseasonContext(transaction, request, {
            read: async () => new TextEncoder().encode('changed evidence'),
          })
        )
      ).rejects.toThrow('bytes differ');
      for (const [label, changes] of [
        ['year', { tradeYear: event.season_year + 1, tradeDate: null }],
        ['release', { releaseId: `outcome-release:${'e'.repeat(64)}` }],
        ['promotion', { promotionId: `external-canonical-promotion:${'f'.repeat(64)}` }],
        ['precision', { tradeDate: yearOnly ? `${event.season_year}-10-15` : null }],
      ] as const) {
        const forged = createAflTradePostseasonMaterializationReview({
          ...review.content,
          ...changes,
        });
        await approve(
          `synthetic-wrong-${label}`,
          'postseason_materialization',
          forged.reviewId,
          forged
        );
        await expect(
          load({ reviewDecisionId: `synthetic-wrong-${label}`, knowledgeCutoffAt: await now() })
        ).rejects.toThrow();
      }
      await pool.query(
        `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
      VALUES('synthetic-postseason-withdrawal','postseason_materialization',$1,'rejected',$2,
        'Synthetic withdrawal',$3::jsonb,'synthetic-reviewer',$4)`,
        [review.reviewId, request.reviewDecisionId, canonicalizeAflTradeJson(review), await now()]
      );
      await expect(load()).rejects.toThrow('not current');
      await expect(materialize()).rejects.toThrow('not current');
      expect(
        (
          await pool.query(
            'SELECT registration_canonical_json FROM outcome_acquisition_spell_version WHERE spell_version_id=$1',
            [spell.spellVersionId]
          )
        ).rows[0]!.registration_canonical_json
      ).toBe(canonicalizeAflTradeJson(spell.content));
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  }
);
