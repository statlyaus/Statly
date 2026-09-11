import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAflTradeValuationDatasetRepository } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetRepository';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { PostgresAflTradeHpnPavCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavCalculationRepository';
import {
  createAflTradeFinalizedHpnPavCalculationService,
  type AflTradeFinalizedHpnPavCalculation,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  fullPlayerPavDatasetAdmissionFixture,
  playerPavDatasetAdmissionFixture,
} from '../testUtils/playerPavDatasetAdmissionFixture';
import { seedPlayerPavSourceAuthorityFixture } from '../testUtils/playerPavSourceAuthorityFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_pav_dataset_admission_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const client = createPgAflOutcomeSqlClient(pool);

/** Direct SQL is the adversarial writer; all owning triggers remain enabled. */
async function insertForgedCalculation(
  transaction: AflOutcomeSqlTransaction,
  calculation: AflTradeFinalizedHpnPavCalculation
) {
  const content = calculation.content;
  await transaction.query(
    `INSERT INTO outcome_hpn_pav_calculation
    (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,environment,
     competition,season_year,effective_through,calculated_at,value_unit,status,team_count,
     player_count,calculation_canonical_json,calculation_json,finalized_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'building',$12,$13,$14,$15::jsonb,NULL)`,
    [
      calculation.calculationId,
      sha256AflTradeCanonicalJson(content),
      content.schemaVersion,
      content.inputSetId,
      content.methodId,
      content.environment,
      content.competition,
      content.seasonYear,
      content.effectiveThrough,
      content.calculatedAt,
      content.valueUnit,
      content.teams.length,
      content.players.length,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(calculation),
    ]
  );
  for (const [ordinal, team] of content.teams.entries()) {
    await transaction.query(
      `INSERT INTO outcome_hpn_pav_calculation_team
      (calculation_id,team_id,ordinal,team_sha256,offensive_pav,midfield_pav,defensive_pav,total_pav,team_canonical_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        calculation.calculationId,
        team.teamId,
        ordinal,
        sha256AflTradeCanonicalJson(team),
        team.offensivePav,
        team.midfieldPav,
        team.defensivePav,
        team.totalPav,
        canonicalizeAflTradeJson(team),
      ]
    );
  }
  for (const [ordinal, player] of content.players.entries()) {
    await transaction.query(
      `INSERT INTO outcome_hpn_pav_calculation_player
      (calculation_id,spell_version_id,player_id,team_id,ordinal,player_sha256,offensive_pav,
       midfield_pav,defensive_pav,total_pav,player_canonical_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        calculation.calculationId,
        player.spellVersionId,
        player.playerId,
        player.teamId,
        ordinal,
        sha256AflTradeCanonicalJson(player),
        player.offensivePav,
        player.midfieldPav,
        player.defensivePav,
        player.totalPav,
        canonicalizeAflTradeJson(player),
      ]
    );
  }
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

describe.sequential('PAV dataset admission with PostgreSQL authority', () => {
  it('keeps event-linked players together through unobserved bridge spells in SQL selection', async () => {
    const partitions = ['train', 'calibration', 'validation', 'final_test'];
    const observations = ['a', 'c', 'd', 'e', 'f'].flatMap((playerId) =>
      partitions.map((partition) => ({
        observationId: createAflTradeContentAddress('player-pav-observation', {
          playerId,
          partition,
        }),
        playerId,
        partition,
        acquisitionSpell: { clubId: 'club', spellId: playerId, spellVersionId: playerId },
      }))
    );
    const mapping = (playerId: string, eventId: string, spell = playerId) => ({
      playerId,
      eventId,
      clubId: 'club',
      acquisitionSpellId: spell,
      acquisitionSpellVersionId: spell,
    });
    const mappings = [
      mapping('a', 'bridge-1'),
      mapping('b', 'bridge-1'),
      mapping('b', 'bridge-2', 'b-next'),
      mapping('c', 'bridge-2'),
      mapping('d', 'd'),
      mapping('e', 'e'),
      mapping('f', 'f'),
      mapping('00-unobserved', 'standalone'),
    ];
    const selected = await client.query<{
      selection: {
        includedObservationIds: string[];
        excludedObservations: {
          observationId: string;
          assignedPartition: string;
          reason: string;
        }[];
      };
    }>('SELECT outcome_player_pav_dataset_selection($1::jsonb,$2::jsonb) AS selection', [
      canonicalizeAflTradeJson(observations),
      canonicalizeAflTradeJson(mappings),
    ]);
    const selection = selected.rows[0]!.selection;
    expect(
      observations
        .filter(({ observationId }) => selection.includedObservationIds.includes(observationId))
        .map(({ playerId, partition }) => [playerId, partition])
    ).toEqual([
      ['a', 'train'],
      ['c', 'train'],
      ['d', 'calibration'],
      ['e', 'validation'],
      ['f', 'final_test'],
    ]);
    expect(selection.excludedObservations).toHaveLength(15);
    const expectedAssignments: Record<string, string> = {
      a: 'train',
      c: 'train',
      d: 'calibration',
      e: 'validation',
      f: 'final_test',
    };
    for (const excluded of selection.excludedObservations) {
      const original = observations.find(
        ({ observationId }) => observationId === excluded.observationId
      )!;
      expect(excluded).toMatchObject({
        assignedPartition: expectedAssignments[original.playerId],
        reason: 'assigned_to_different_partition',
      });
    }
    expect(
      [
        ...selection.includedObservationIds,
        ...selection.excludedObservations.map(({ observationId }) => observationId),
      ].sort()
    ).toEqual(observations.map(({ observationId }) => observationId).sort());
    const reversed = await client.query<{ selection: unknown }>(
      'SELECT outcome_player_pav_dataset_selection($1::jsonb,$2::jsonb) AS selection',
      [
        canonicalizeAflTradeJson([...observations].reverse()),
        canonicalizeAflTradeJson([...mappings].reverse()),
      ]
    );
    expect(reversed.rows[0]!.selection).toEqual(selection);
  });

  it('materializes all historical measurement seasons from retained source authority', async () => {
    const fixture = await playerPavDatasetAdmissionFixture({ environment: 'non_production' });
    const methodArtifact = fixture.method.content.sourceArtifact;
    await client.query(
      `INSERT INTO outcome_artifact_custody
       (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
        environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,'{}'::jsonb)`,
      [
        methodArtifact.artifactId,
        methodArtifact.contentSha256,
        methodArtifact.storageUri,
        methodArtifact.mediaType,
        methodArtifact.byteLength,
        methodArtifact.createdAt,
      ]
    );
    const calculations = new PostgresAflTradeHpnPavCalculationRepository(client, {
      async loadExact(methodId) {
        if (methodId !== fixture.method.methodId) throw new Error('Unknown fixture method.');
        return { method: fixture.method, sourceBytes: fixture.sourceBytes };
      },
    });
    await calculations.registerMethod(fixture.method, { environment: 'non_production' });
    const source = await seedPlayerPavSourceAuthorityFixture(client, {
      fixture,
      custodyAt: '2026-08-09T00:00:00.000Z',
    });
    const inputs = new PostgresAflTradeHpnPavInputRepository(client);
    expect(source.seasons.map(({ seasonYear }) => seasonYear)).toEqual([
      2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017,
      2018, 2019, 2020,
    ]);
    for (const season of source.seasons) {
      const { inputSet } = await inputs.buildAndPersistSeasonInputSet(
        {
          ...season,
          environment: 'non_production',
          competition: 'AFLM',
          methodId: fixture.method.methodId,
          knowledgePolicy: 'retrospective_as_recorded_by_input_creation',
          knowledgeCutoffAt: '2026-08-10T00:00:00.000Z',
        },
        { environment: 'non_production' }
      );
      const request = {
        inputSetId: inputSet.inputSetId,
        environment: 'non_production' as const,
        competition: 'AFLM' as const,
        seasonYear: season.seasonYear,
        methodId: fixture.method.methodId,
      };
      await expect(
        inputs.loadCurrentFinalizedSeasonInputSet(request, {
          environment: 'non_production',
        })
      ).resolves.toEqual(inputSet);
      if (season.seasonYear === 2003) {
        await expect(
          client.transaction(async (transaction) => {
            const timestamp = await transaction.query<{ now: string }>(
              `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`
            );
            const authentic = await createAflTradeFinalizedHpnPavCalculationService({
              inputRepository: inputs,
              methodAuthority: {
                loadExact: async () => ({
                  method: fixture.method,
                  sourceBytes: fixture.sourceBytes,
                }),
              },
              clock: { now: () => timestamp.rows[0]!.now },
            }).calculate(request, { environment: 'non_production' });
            const content = structuredClone(authentic.content);
            content.teams[0]!.source.pointsFor += 1;
            const forged = {
              calculationId: createAflTradeContentAddress('hpn-pav-season', content),
              content,
            };
            await insertForgedCalculation(transaction, forged);
            await expect(
              transaction.query(
                `UPDATE outcome_hpn_pav_calculation SET status='finalized',finalized_at=calculated_at WHERE calculation_id=$1`,
                [forged.calculationId]
              )
            ).rejects.toThrow('HPN PAV team source values do not match finalized inputs');
            throw new Error('Expected adversarial calculation transaction rollback');
          })
        ).rejects.toThrow('Expected adversarial calculation transaction rollback');
      }
      const { calculation } = await calculations
        .calculateAndPersist(request, {
          environment: 'non_production',
        })
        .catch((error: unknown) => {
          throw new Error(`Historical measurement season ${season.seasonYear} failed`, {
            cause: error,
          });
        });
      expect(calculation.content.players.map(({ playerId }) => playerId).sort()).toEqual([
        'player:a1',
        'player:a2',
        'player:b1',
        'player:b2',
      ]);
      if (season.seasonYear === 2003) {
        expect(
          calculation.content.players.find(({ playerId }) => playerId === 'player:b1')
        ).toMatchObject({
          offensivePav: 39.078395288922,
          midfieldPav: 56.946492341003,
          defensivePav: 40.000572097782,
          totalPav: 136.025459727707,
        });
      }
      await expect(
        calculations.calculateAndPersist(request, {
          environment: 'non_production',
        })
      ).resolves.toEqual({ calculation, idempotentReplay: true });
    }
  });

  it('rejects a PAV candidate whose exact finalized factual parents were not retained', async () => {
    const { dataset } = await fullPlayerPavDatasetAdmissionFixture();
    const repository = new PostgresAflTradeValuationDatasetRepository(client);
    await expect(repository.persistCandidate(dataset)).rejects.toThrow(
      'Valuation dataset requires exact finalized factual parents'
    );
  });
});
