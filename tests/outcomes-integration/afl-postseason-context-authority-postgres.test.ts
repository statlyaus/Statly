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
