// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
  type AflTradeFinalizedHpnPavCalculation,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';

const migrationUrl = new URL(
  '../../prisma/afl-trade-outcomes/migrations/0033_hpn_pav_calculation_authority/migration.sql',
  import.meta.url
);
const sha = (value: string) => sha256AflTradeCanonicalJson(value);
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;

const stats = (inside50s: number) => ({
  totalPoints: 10,
  hitOuts: 1,
  goalAssists: 1,
  inside50s,
  marks: 5,
  marksInside50: 2,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 1,
  onePercenters: 1,
  clearances: 2,
  tackles: 3,
});

function calculation(calculatedAt: string) {
  const playerRows = [
    { playerId: 'player:a1', teamId: 'club:home', rowId: 'row:a1', stats: stats(10) },
    { playerId: 'player:a2', teamId: 'club:home', rowId: 'row:a2', stats: stats(11) },
    { playerId: 'player:b1', teamId: 'club:away', rowId: 'row:b1', stats: stats(12) },
    { playerId: 'player:b2', teamId: 'club:away', rowId: 'row:b2', stats: stats(13) },
  ].map((player) => ({
    ...player,
    spellVersionId: addressed('acquisition-spell-version', `${player.playerId}:${player.teamId}`),
  }));
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: 'club:home',
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 21,
      inside50sAgainst: 25,
      players: playerRows
        .filter(({ teamId }) => teamId === 'club:home')
        .map(({ spellVersionId, playerId, rowId, stats: values }) => ({
          spellVersionId,
          playerId,
          sourceRowIds: [rowId],
          ...values,
        })),
    },
    {
      teamId: 'club:away',
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 25,
      inside50sAgainst: 21,
      players: playerRows
        .filter(({ teamId }) => teamId === 'club:away')
        .map(({ spellVersionId, playerId, rowId, stats: values }) => ({
          spellVersionId,
          playerId,
          sourceRowIds: [rowId],
          ...values,
        })),
    },
  ]);
  const inputSetSha256 = sha('input-set');
  const methodBytes = new TextEncoder().encode('<html>HPN method</html>');
  const method = createAflTradeHpnPavMethod({
    sourceArtifact: createAflTradeByteArtifactRef(
      methodBytes,
      'text/html',
      '2026-08-08T00:00:00.000Z'
    ),
    sourceBytes: methodBytes,
    capturedAt: '2026-08-08T00:00:00.000Z',
  });
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    seasonYear: 2025,
    effectiveThrough: '2025-09-27T04:30:00.000Z',
    calculatedAt,
    methodId: method.methodId,
    inputSetId: `hpn-pav-input-set:${inputSetSha256}`,
    inputSetSha256,
    factualRunId: addressed('factual-reconciliation-run', 'factual-run'),
    factualInputSetSha256: sha('factual-input'),
    primaryProviders: ['afl_tables'],
    corroboratingProviders: ['footywire'],
    resultSourceRowIds: ['row:result'],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: { ...player.source, gamesPlayed: 1 },
    })),
  };
  return {
    method,
    playerRows,
    value: aflTradeFinalizedHpnPavCalculationSchema.parse({
      calculationId: createAflTradeContentAddress('hpn-pav-season', content),
      content,
    }),
  };
}

async function insertCalculation(
  db: PGlite,
  value: AflTradeFinalizedHpnPavCalculation
): Promise<void> {
  await db.query(
    `INSERT INTO outcome_hpn_pav_calculation
      (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,environment,
       competition,season_year,effective_through,calculated_at,value_unit,status,team_count,
       player_count,calculation_canonical_json,calculation_json,finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'building',$12,$13,$14,$15::jsonb,NULL)`,
    [
      value.calculationId,
      value.calculationId.replace('hpn-pav-season:', ''),
      value.content.schemaVersion,
      value.content.inputSetId,
      value.content.methodId,
      value.content.environment,
      value.content.competition,
      value.content.seasonYear,
      value.content.effectiveThrough,
      value.content.calculatedAt,
      value.content.valueUnit,
      value.content.teams.length,
      value.content.players.length,
      canonicalizeAflTradeJson(value.content),
      canonicalizeAflTradeJson(value),
    ]
  );
  for (const [ordinal, team] of value.content.teams.entries()) {
    await db.query(
      `INSERT INTO outcome_hpn_pav_calculation_team VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        value.calculationId,
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
  for (const [ordinal, player] of value.content.players.entries()) {
    await db.query(
      `INSERT INTO outcome_hpn_pav_calculation_player VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        value.calculationId,
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

describe('HPN PAV calculation PostgreSQL authority', () => {
  it('finalizes the exact derived formula and rejects value tampering and late children', async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TYPE "OutcomeEnvironment" AS ENUM ('test_fixture','non_production','production');
      CREATE TABLE outcome_artifact_custody (
        artifact_id text PRIMARY KEY,content_sha256 char(64) NOT NULL,media_type text NOT NULL,
        byte_length bigint NOT NULL,environment "OutcomeEnvironment" NOT NULL,
        created_at timestamptz(3) NOT NULL,verified_at timestamptz(3) NOT NULL);
      CREATE TABLE outcome_hpn_pav_input_set (
        input_set_id text PRIMARY KEY,status text NOT NULL,finalized_at timestamptz(3),method_id text,
        environment "OutcomeEnvironment",competition text,season_year integer,
        effective_through timestamptz(3),input_set_sha256 char(64),factual_run_id text,
        factual_input_set_sha256 char(64),input_set_json jsonb);
      CREATE TABLE outcome_hpn_pav_input_row (
        input_set_id text,row_kind text,role text,row_json jsonb,provider_decoded_row_id text);
      CREATE TABLE outcome_hpn_pav_input_match (
        input_set_id text,match_id text,result_provider_decoded_row_id text,
        home_club_id text,away_club_id text);
      CREATE TABLE outcome_club (club_id text PRIMARY KEY);
      CREATE TABLE outcome_player (player_id text PRIMARY KEY);
      CREATE TABLE outcome_acquisition_spell_version (spell_version_id text PRIMARY KEY);
      CREATE FUNCTION reject_outcome_hpn_pav_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'append only'; END; $$ LANGUAGE plpgsql;
    `);
    await db.exec(await readFile(migrationUrl, 'utf8'));
    await db.exec(`INSERT INTO outcome_club VALUES ('club:home'),('club:away');
      INSERT INTO outcome_player VALUES ('player:a1'),('player:a2'),('player:b1'),('player:b2');`);
    await db.exec('BEGIN');
    const time = await db.query<{ value: Date | string }>(
      `SELECT date_trunc('milliseconds',transaction_timestamp()) AS value`
    );
    const calculatedAt = new Date(time.rows[0]!.value).toISOString();
    const fixture = calculation(calculatedAt);
    for (const player of fixture.playerRows) {
      await db.query(`INSERT INTO outcome_acquisition_spell_version VALUES ($1)`, [
        player.spellVersionId,
      ]);
    }
    const artifact = fixture.method.content.sourceArtifact;
    await db.query(
      `INSERT INTO outcome_artifact_custody VALUES ($1,$2,$3,$4,'test_fixture',$5,$5)`,
      [
        artifact.artifactId,
        artifact.contentSha256,
        artifact.mediaType,
        artifact.byteLength,
        artifact.createdAt,
      ]
    );
    await db.query(
      `INSERT INTO outcome_hpn_pav_method VALUES ($1,$2,'test_fixture',$3,$4,$5,$6,$7::jsonb)`,
      [
        fixture.method.methodId,
        fixture.method.methodId.replace('hpn-pav-method:', ''),
        artifact.artifactId,
        fixture.method.content.capturedAt,
        calculatedAt,
        canonicalizeAflTradeJson(fixture.method.content),
        canonicalizeAflTradeJson(fixture.method),
      ]
    );
    const alteredMethodContent = {
      ...fixture.method.content,
      sourceUrl: 'https://example.invalid/not-the-reviewed-method',
    };
    const alteredMethodSha256 = sha256AflTradeCanonicalJson(alteredMethodContent);
    await db.exec('SAVEPOINT altered_method');
    await expect(
      db.query(
        `INSERT INTO outcome_hpn_pav_method VALUES ($1,$2,'test_fixture',$3,$4,$5,$6,$7::jsonb)`,
        [
          `hpn-pav-method:${alteredMethodSha256}`,
          alteredMethodSha256,
          artifact.artifactId,
          fixture.method.content.capturedAt,
          calculatedAt,
          canonicalizeAflTradeJson(alteredMethodContent),
          canonicalizeAflTradeJson({
            methodId: `hpn-pav-method:${alteredMethodSha256}`,
            content: alteredMethodContent,
          }),
        ]
      )
    ).rejects.toThrow(/method envelope mismatch/);
    await db.exec('ROLLBACK TO SAVEPOINT altered_method');
    await db.query(
      `INSERT INTO outcome_hpn_pav_input_set VALUES
       ($1,'finalized',$2,$3,'test_fixture','AFLM',2025,$4,$5,$6,$7,$8::jsonb)`,
      [
        fixture.value.content.inputSetId,
        calculatedAt,
        fixture.method.methodId,
        fixture.value.content.effectiveThrough,
        fixture.value.content.inputSetSha256,
        fixture.value.content.factualRunId,
        fixture.value.content.factualInputSetSha256,
        canonicalizeAflTradeJson({
          content: {
            sourceRuns: [
              {
                normalizationRunId: 'provider-normalization-run:primary',
                provider: 'afl_tables',
              },
              {
                normalizationRunId: 'provider-normalization-run:corroborating',
                provider: 'footywire',
              },
            ],
            rows: [
              {
                kind: 'completed_match_result',
                source: { providerDecodedRowId: 'row:result' },
              },
              ...fixture.playerRows.map((player) => ({
                kind: 'player_match_stats',
                role: 'primary',
                source: {
                  normalizationRunId: 'provider-normalization-run:primary',
                  providerDecodedRowId: player.rowId,
                },
              })),
              {
                kind: 'player_match_stats',
                role: 'corroborating',
                source: {
                  normalizationRunId: 'provider-normalization-run:corroborating',
                  providerDecodedRowId: 'row:corroborating',
                },
              },
            ],
          },
        }),
      ]
    );
    await db.query(
      `INSERT INTO outcome_hpn_pav_input_row VALUES
       ($1,'completed_match_result',NULL,$2::jsonb,'row:result')`,
      [
        fixture.value.content.inputSetId,
        JSON.stringify({
          homeClub: { canonicalId: 'club:home' },
          awayClub: { canonicalId: 'club:away' },
          homePoints: 100,
          awayPoints: 80,
        }),
      ]
    );
    for (const player of fixture.playerRows) {
      await db.query(
        `INSERT INTO outcome_hpn_pav_input_row VALUES
         ($1,'player_match_stats','primary',$2::jsonb,$3)`,
        [
          fixture.value.content.inputSetId,
          JSON.stringify({
            match: { canonicalId: 'match:final' },
            club: { canonicalId: player.teamId },
            player: { canonicalId: player.playerId },
            acquisitionSpell: { spellVersionId: player.spellVersionId },
            stats: player.stats,
          }),
          player.rowId,
        ]
      );
    }
    await db.query(
      `INSERT INTO outcome_hpn_pav_input_row VALUES
       ($1,'player_match_stats','corroborating',$2::jsonb,'row:corroborating')`,
      [
        fixture.value.content.inputSetId,
        JSON.stringify({
          match: { canonicalId: 'match:final' },
          club: { canonicalId: 'club:home' },
          player: { canonicalId: 'player:a1' },
          acquisitionSpell: {
            spellVersionId: fixture.playerRows[0]!.spellVersionId,
          },
          stats: stats(10),
        }),
      ]
    );
    await db.query(
      `INSERT INTO outcome_hpn_pav_input_match VALUES ($1,'match:final','row:result','club:home','club:away')`,
      [fixture.value.content.inputSetId]
    );
    const tamperedContent = structuredClone(fixture.value.content);
    tamperedContent.players[0]!.offensivePav += 1;
    tamperedContent.players[0]!.totalPav += 1;
    tamperedContent.players[1]!.offensivePav -= 1;
    tamperedContent.players[1]!.totalPav -= 1;
    const tampered = aflTradeFinalizedHpnPavCalculationSchema.parse({
      calculationId: createAflTradeContentAddress('hpn-pav-season', tamperedContent),
      content: tamperedContent,
    });
    await db.exec('SAVEPOINT tampered_calculation');
    await insertCalculation(db, tampered);
    await expect(
      db.query(
        `UPDATE outcome_hpn_pav_calculation SET status='finalized',finalized_at=calculated_at
         WHERE calculation_id=$1`,
        [tampered.calculationId]
      )
    ).rejects.toThrow(/independently derived method/);
    await db.exec('ROLLBACK TO SAVEPOINT tampered_calculation');
    const forgedProvenanceContent = structuredClone(fixture.value.content);
    forgedProvenanceContent.primaryProviders = ['invented_provider'];
    forgedProvenanceContent.resultSourceRowIds = ['row:invented'];
    forgedProvenanceContent.league.teamCount += 1;
    forgedProvenanceContent.league.leaguePointsPerInside50 += 1;
    const forgedProvenance = aflTradeFinalizedHpnPavCalculationSchema.parse({
      calculationId: createAflTradeContentAddress('hpn-pav-season', forgedProvenanceContent),
      content: forgedProvenanceContent,
    });
    await db.exec('SAVEPOINT forged_provenance');
    await insertCalculation(db, forgedProvenance);
    await expect(
      db.query(
        `UPDATE outcome_hpn_pav_calculation SET status='finalized',finalized_at=calculated_at
         WHERE calculation_id=$1`,
        [forgedProvenance.calculationId]
      )
    ).rejects.toThrow(/provenance or league summary/);
    await db.exec('ROLLBACK TO SAVEPOINT forged_provenance');
    const forgedGamesContent = structuredClone(fixture.value.content);
    forgedGamesContent.players[0]!.source.gamesPlayed = 2;
    const forgedGames = aflTradeFinalizedHpnPavCalculationSchema.parse({
      calculationId: createAflTradeContentAddress('hpn-pav-season', forgedGamesContent),
      content: forgedGamesContent,
    });
    await db.exec('SAVEPOINT forged_games');
    await insertCalculation(db, forgedGames);
    await expect(
      db.query(
        `UPDATE outcome_hpn_pav_calculation SET status='finalized',finalized_at=calculated_at
         WHERE calculation_id=$1`,
        [forgedGames.calculationId]
      )
    ).rejects.toThrow(/player source values/);
    await db.exec('ROLLBACK TO SAVEPOINT forged_games');
    await insertCalculation(db, fixture.value);
    await db.query(
      `UPDATE outcome_hpn_pav_calculation SET status='finalized',finalized_at=calculated_at
       WHERE calculation_id=$1`,
      [fixture.value.calculationId]
    );
    await expect(
      db.query(
        `INSERT INTO outcome_hpn_pav_calculation_team VALUES ($1,'club:late',2,$2,1,1,1,3,'{}')`,
        [fixture.value.calculationId, sha('late')]
      )
    ).rejects.toThrow(/does not accept children/);
    await db.exec('ROLLBACK');
    await db.close();
  });
});
