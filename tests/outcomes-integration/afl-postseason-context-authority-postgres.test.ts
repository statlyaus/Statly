import { restorePostseasonFixtureSchema } from '../testUtils/restorePostseasonFixtureSchema';
import { createAflTradeComponentDrawSet } from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import { createAflTradeLineageGraphId } from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradePostseasonPlayerPavObservation } from '@/server/aflTradeIntelligence/modeling/postseasonPlayerPavObservation';
import { PostgresPostseasonMaterializationRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresPostseasonMaterializationRepository';
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

import {
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
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
        reciprocalPlayer: true,
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

      const retainedRepository = new PostgresPostseasonMaterializationRepository({
        client,
        artifacts: createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' }),
        evidence,
        methodAuthority,
        maximumArtifactBytes: 10_000_000,
      });
      const persistedRequest = { kind: 'observation', selection: materializeRequest };
      const copies = await Promise.all(
        [1, 2, 3].map(() => retainedRepository.materialize(persistedRequest))
      );
      expect(copies.filter((copy) => !copy.idempotentReplay)).toHaveLength(1);
      const saved = copies[0]!.manifest;
      expect(copies.every((copy) => copy.manifest.manifestId === saved.manifestId)).toBe(true);
      expect(saved.content.observation).toEqual(materialized.observation);
      expect(await retainedRepository.loadCurrentExact(saved.manifestId)).toEqual(saved);
      expect(
        (
          await pool.query(
            'SELECT count(*)::integer AS n FROM outcome_private_evaluation_materialization_manifest'
          )
        ).rows[0]!.n
      ).toBe(1);
      const wrongObservation = createAflTradePostseasonPlayerPavObservation({
        ...saved.content.observation.content,
        features: [
          { seasonYear: event.season_year, state: 'unavailable', reason: 'source_missing' },
        ],
      });
      expect(
        (
          await pool.query('SELECT outcome_postseason_observation_exact($1::jsonb) AS valid', [
            canonicalizeAflTradeJson({ ...saved.content, observation: wrongObservation }),
          ])
        ).rows[0]!.valid
      ).toBe(false);
      await expect(
        pool.query(
          'DELETE FROM outcome_private_evaluation_materialization_manifest WHERE materialization_manifest_id=$1',
          [saved.manifestId]
        )
      ).rejects.toThrow('append-only');

      const fabricated = createFabricatedAflTradeValuationFixture('two_party_player_swap');
      const canonicalTransfers = (
        await pool.query<{ asset_version_id: string; to_club_id: string }>(
          "SELECT asset_version_id,to_club_id FROM outcome_event_asset WHERE event_version_id=$1 AND status='approved' ORDER BY asset_version_id",
          [entry.eventVersionId]
        )
      ).rows;
      expect(canonicalTransfers).toHaveLength(2);
      const replacements = new Map<string, string>();
      fabricated.valuationCase.content.parties.forEach((party, index) => {
        replacements.set(party.aflClubId, canonicalTransfers[index]!.to_club_id);
        replacements.set(
          party.receivedRootAssetIds[0]!,
          canonicalTransfers[index]!.asset_version_id
        );
      });
      const remap = <T>(value: T): T =>
        JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
          typeof v === 'string' ? (replacements.get(v) ?? v) : v
        ) as T;
      const lineageGraph = remap(fabricated.lineageGraph);
      const caseFixture = {
        lineageGraph,
        componentDrawSet: createAflTradeComponentDrawSet(
          remap(fabricated.componentDrawSet.content)
        ),
        realizedContributionLedger: createAflTradeRealizedContributionLedger({
          ...remap(fabricated.realizedContributionLedger.content),
          lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
        }),
        packagePolicy: fabricated.packagePolicy,
      };
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
      const parentDocuments = {
        componentDrawSet: caseFixture.componentDrawSet,
        realizedContributionLedger: caseFixture.realizedContributionLedger,
        packagePolicy: caseFixture.packagePolicy,
        lineageGraph: caseFixture.lineageGraph,
      };
      const exactParentBytes = async (
        documents: unknown,
        env: string = scope.environment,
        cutoff = valuationRequest.knowledgeCutoffAt
      ) =>
        (
          await pool.query<{ exact: boolean }>(
            'SELECT outcome_postseason_valuation_parent_bytes_exact($1::jsonb,$2::jsonb,$3,$4::timestamptz) AS exact',
            [JSON.stringify(documents), JSON.stringify(valuationParents), env, cutoff]
          )
        ).rows[0]!.exact;
      expect(await exactParentBytes(parentDocuments)).toBe(true);
      expect(await exactParentBytes({ ...parentDocuments, packagePolicy: {} })).toBe(false);
      expect(await exactParentBytes({ ...parentDocuments, unreviewed: {} })).toBe(false);
      expect(await exactParentBytes(parentDocuments, 'non_production')).toBe(false);
      expect(
        await exactParentBytes(parentDocuments, scope.environment, '2000-01-01T00:00:00.000Z')
      ).toBe(false);
      const assembled = await client.transaction((tx) =>
        materializeAflTradePostseasonValuation(tx, valuationRequest, methodAuthority, evidence)
      );
      const caseDocument = {
        environment: scope.environment,
        request: { kind: 'complete_trade', selection: valuationRequest },
        observation: assembled.observation,
        valuationParents: assembled.valuationParents,
        valuationCase: assembled.valuationCase,
      };
      const caseExact = async (document: unknown) =>
        (
          await pool.query<{ exact: boolean }>(
            'SELECT outcome_postseason_valuation_case_exact($1::jsonb) AS exact',
            [JSON.stringify(document)]
          )
        ).rows[0]!.exact;
      expect(await caseExact(caseDocument)).toBe(true);
      expect(
        await caseExact({
          ...caseDocument,
          valuationCase: {
            ...assembled.valuationCase,
            content: { ...assembled.valuationCase.content, outcomeSeasons: [2026, 2027, 2028] },
          },
        })
      ).toBe(false);
      const forgedContent = { ...assembled.valuationCase.content, valueUnitId: 'forged-unit' };
      expect(
        await caseExact({
          ...caseDocument,
          valuationCase: {
            valuationCaseId: createAflTradeContentAddress('valuation-case', forgedContent),
            content: forgedContent,
          },
        })
      ).toBe(false);
      const completeRequest = { kind: 'complete_trade', selection: valuationRequest };
      const completeSaved = await retainedRepository.materialize(completeRequest);
      expect(completeSaved.manifest.content.valuationCase).toEqual(assembled.valuationCase);
      expect(completeSaved.manifest.content.valuationParents).toEqual(assembled.valuationParents);
      expect((await retainedRepository.materialize(completeRequest)).manifest).toEqual(
        completeSaved.manifest
      );
      expect(await retainedRepository.loadCurrentExact(completeSaved.manifest.manifestId)).toEqual(
        completeSaved.manifest
      );
      // Restore the actual database schema, then authenticate through a new connection and artifact repository.
      await restorePostseasonFixtureSchema(admin, databaseUrl!, schemaName);
      const restoredPool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schemaName}`,
      });
      try {
        const restoredArtifacts = createAflTradeFixtureArtifactRepository({
          artifactClass: 'derived_private',
        });
        for (const manifest of [saved, completeSaved.manifest]) {
          const ref = createAflTradeCanonicalJsonArtifactRef(manifest, manifest.content.createdAt);
          await restoredArtifacts.putIfAbsent(
            ref,
            new TextEncoder().encode(canonicalizeAflTradeJson(manifest))
          );
        }
        const restoredEvidence = new Map(
          [...promoted.retainedArtifacts].map(([id, value]) => [id, new Uint8Array(value.bytes)])
        );
        const restoredRepository = new PostgresPostseasonMaterializationRepository({
          client: createPgAflOutcomeSqlClient(restoredPool),
          artifacts: restoredArtifacts,
          evidence: {
            read: async (ref) => {
              const bytes = restoredEvidence.get(ref.artifactId);
              if (!bytes) throw new Error('Restored evidence absent.');
              return bytes;
            },
          },
          methodAuthority: {
            loadExact: async () => ({
              method: structuredClone(method),
              sourceBytes: new Uint8Array(methodBytes),
            }),
          },
          maximumArtifactBytes: 10_000_000,
        });
        expect(await restoredRepository.loadCurrentExact(saved.manifestId)).toEqual(saved);
        expect(
          await restoredRepository.loadCurrentExact(completeSaved.manifest.manifestId)
        ).toEqual(completeSaved.manifest);
        expect((await restoredRepository.materialize(completeRequest)).manifest).toEqual(
          completeSaved.manifest
        );
      } finally {
        await restoredPool.end();
      }
      // A direct writer can reseal hashes; SQL must still reject invented case values.
      await expect(
        client.transaction(async (tx) => {
          const createdAt = (
            await tx.query<{ at: Date }>(
              "SELECT date_trunc('milliseconds',transaction_timestamp()) AS at"
            )
          ).rows[0]!.at.toISOString();
          const content = {
            ...completeSaved.manifest.content,
            createdAt,
            valuationCase: {
              valuationCaseId: createAflTradeContentAddress('valuation-case', forgedContent),
              content: forgedContent,
            },
          };
          const forged = {
            manifestId: createAflTradeContentAddress(
              'private-evaluation-materialization-manifest',
              content
            ),
            content,
          };
          const ref = createAflTradeCanonicalJsonArtifactRef(forged, createdAt);
          await tx.query(
            `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
          VALUES($1,$2,$3,$4,$5,'derived_private',$6,$7,clock_timestamp(),'{}')`,
            [
              ref.artifactId,
              ref.contentSha256,
              ref.storageUri,
              ref.mediaType,
              ref.byteLength,
              scope.environment,
              createdAt,
            ]
          );
          await tx.query(
            `INSERT INTO outcome_private_evaluation_materialization_manifest
          (materialization_manifest_id,content_sha256,valuation_scope_key,trade_id,artifact_id,created_at,content_canonical_json,manifest_canonical_json,manifest_json)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::text,$8::text::jsonb)`,
            [
              forged.manifestId,
              forged.manifestId.split(':')[1],
              content.selector.valuationScopeKey,
              content.selector.tradeId,
              ref.artifactId,
              createdAt,
              canonicalizeAflTradeJson(content),
              canonicalizeAflTradeJson(forged),
            ]
          );
        })
      ).rejects.toThrow('Postseason materialization content or current authority differs');
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
      await expect(retainedRepository.loadCurrentExact(saved.manifestId)).rejects.toThrow(
        'not current'
      );
      await expect(retainedRepository.materialize(persistedRequest)).rejects.toThrow('not current');
      expect(await retainedRepository.loadCurrentExact(completeSaved.manifest.manifestId)).toEqual(
        completeSaved.manifest
      );
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN');
        const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await writer.query(
          `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
        VALUES('synthetic-valuation-withdrawal','postseason_materialization',$1,'rejected',$2,'Synthetic withdrawal',$3::jsonb,'synthetic-reviewer',$4)`,
          [
            valuationReview.reviewId,
            valuationRequest.reviewDecisionId,
            canonicalizeAflTradeJson(valuationReview),
            await now(),
          ]
        );
        const racingReplay = retainedRepository.materialize(completeRequest).then(
          () => ({ rejected: false, message: '' }),
          (error: unknown) => ({
            rejected: true,
            message: error instanceof Error ? error.message : String(error),
          })
        );
        let blocked = false;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          blocked = (
            await admin.query<{ blocked: boolean }>(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS blocked',
              [writerPid]
            )
          ).rows[0]!.blocked;
          if (blocked) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await writer.query('COMMIT');
        const raced = await racingReplay;
        expect(blocked).toBe(true);
        expect(raced.rejected).toBe(true);
        expect(raced.message).toContain('not current');
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
      }
      await expect(retainedRepository.materialize(completeRequest)).rejects.toThrow('not current');
      expect(await retainedRepository.loadRetainedExact(completeSaved.manifest.manifestId)).toEqual(
        completeSaved.manifest
      );

      expect(await retainedRepository.loadRetainedExact(saved.manifestId)).toEqual(saved);
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
  },
  60_000
);
