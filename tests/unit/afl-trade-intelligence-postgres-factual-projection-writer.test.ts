import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFactualProjectionItemSet } from '@/server/aflTradeIntelligence/outcomes/factualProjectionItemSetContracts';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { createAflDraftTradeOutcomeFactualProjectionManifest } from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import { PostgresAflTradeFactualProjectionItemSetRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualProjectionItemSetRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { aflDraftTradeOutcomeListItemSchema } from '@/types/aflDraftTradeOutcomes';

const digest = (character: string) => character.repeat(64);
const createdAt = '2025-09-02T00:00:00.000Z';
const finalizedAt = '2025-09-02T00:01:00.000Z';
const releaseId = `outcome-release:${digest('a')}`;
const candidateId = `factual-release-candidate:${digest('b')}`;
const sourceMemberSetSha256 = digest('c');
const artifact = createAflTradeCanonicalJsonArtifactRef({ projection: 'fixture' }, createdAt);
const metricDefinition = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS[0];

const item = aflDraftTradeOutcomeListItemSchema.parse({
  eventId: 'event:fixture-2025-0001',
  tradeId: null,
  assetId: 'asset:fixture-1',
  year: 2025,
  acquisitionType: 'National Draft',
  aflClubId: 'club:fixture-a',
  clubName: 'Fixture Club A',
  player: {
    aflPlayerId: 'player:fixture-1',
    displayName: 'Fixture Player',
    identityStatus: 'resolved',
  },
  checks: [
    {
      metric: 'games',
      status: 'source_only',
      recordedValue: null,
      observedValue: 12,
      delta: null,
      coverageRatio: null,
      scopeLabel: 'Fixture spell',
      effectiveThrough: '2025-09-01T00:00:00.000Z',
      message: 'Reviewed source-only fixture.',
      sources: [
        {
          role: 'observed',
          artifactId: artifact.artifactId,
          locator: 'fixture/player/season',
          rightsDecisionId: `gate-decision:${digest('d')}`,
          metricDefinitionId: metricDefinition.metricDefinitionId,
        },
      ],
    },
  ],
  achievements: [],
});

const itemSet = createAflTradeFactualProjectionItemSet([
  { ordinal: 0, itemKey: 'fixture-item', item },
]);
const logicalDatasetSha256 = digest('e');
const projection = createAflDraftTradeOutcomeFactualProjectionManifest({
  schemaVersion: 'afl-draft-trade-outcome-projection/v2',
  publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
  environment: 'test_fixture',
  scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  createdAt,
  releaseId,
  archiveDatasetId: `archive-dataset:${digest('f')}`,
  metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  effectiveThrough: '2025-09-01T00:00:00.000Z',
  metricDefinitionIds: [metricDefinition.metricDefinitionId],
  viewArtifacts: {
    list: artifact,
    tradeDetail: artifact,
    club: artifact,
    player: artifact,
    year: artifact,
    dashboard: artifact,
  },
  exportArtifacts: { json: artifact, csv: artifact, xlsx: artifact },
  parityReport: {
    artifact,
    status: 'passed',
    checkCount: 1,
    failureCount: 0,
    checkedOutcomeRecordCount: 1,
    logicalDatasetSha256,
  },
  documentCount: itemSet.itemCount,
  factualCandidateId: candidateId,
  sourceMemberSetSha256,
  publicListItemSetSha256: itemSet.itemSetSha256,
  derivationSha256: sha256AflTradeCanonicalJson({
    factualCandidateId: candidateId,
    logicalDatasetSha256,
    publicListItemSetSha256: itemSet.itemSetSha256,
    sourceMemberSetSha256,
  }),
});

function fakeClient(existing = false, candidateFinalizedAt = createdAt) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (sql.includes('FROM outcome_factual_release_candidate')) {
      return { rows: [{ finalized_at: candidateFinalizedAt }], rowCount: 1 };
    }
    if (sql.includes('SELECT projection_id')) {
      return { rows: [{ projection_id: projection.projectionId }], rowCount: 1 };
    }
    if (sql.includes('SELECT item_count')) {
      return existing
        ? {
            rows: [
              {
                item_count: itemSet.itemCount,
                item_set_sha256: itemSet.itemSetSha256,
                finalized_at: finalizedAt,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: sql.startsWith('INSERT') ? 1 : 0 };
  };
  const client: AflOutcomeSqlClient = {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
  return { client, statements };
}

describe('PostgreSQL factual projection item-set writer', () => {
  it('atomically stages canonical indexed rows and seals their exact shared digest', async () => {
    const fixture = fakeClient();
    const repository = new PostgresAflTradeFactualProjectionItemSetRepository(fixture.client);

    await expect(repository.persist({ projection, itemSet, finalizedAt })).resolves.toEqual({
      idempotentReplay: false,
    });

    const itemInsert = fixture.statements.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_projection_item')
    );
    expect(itemInsert?.sql).toContain('jsonb_to_recordset');
    expect(String(itemInsert?.parameters[2])).toContain(itemSet.members[0].itemSha256);
    expect(String(itemInsert?.parameters[2])).not.toContain('userId');
    expect(
      fixture.statements.some(
        ({ sql, parameters }) =>
          sql.includes('INSERT INTO outcome_factual_projection_item_set') &&
          parameters.includes(itemSet.itemSetSha256)
      )
    ).toBe(true);
  });

  it('returns exact replay before attempting any item insert', async () => {
    const fixture = fakeClient(true);
    const repository = new PostgresAflTradeFactualProjectionItemSetRepository(fixture.client);

    await expect(repository.persist({ projection, itemSet, finalizedAt })).resolves.toEqual({
      idempotentReplay: true,
    });
    expect(
      fixture.statements.some(({ sql }) => sql.includes('INSERT INTO outcome_projection_item'))
    ).toBe(false);
  });

  it('rejects a projection bound to another item set before opening a transaction', async () => {
    const fixture = fakeClient();
    const otherSet = createAflTradeFactualProjectionItemSet([
      { ordinal: 0, itemKey: 'different-item', item },
    ]);
    const repository = new PostgresAflTradeFactualProjectionItemSetRepository(fixture.client);

    await expect(
      repository.persist({ projection, itemSet: otherSet, finalizedAt })
    ).rejects.toThrow(/do not match/i);
    expect(fixture.statements).toHaveLength(0);
  });

  it('rejects duplicate ordinals before PostgreSQL primary-key admission', () => {
    expect(() =>
      createAflTradeFactualProjectionItemSet([
        { ordinal: 0, itemKey: 'first-item', item },
        { ordinal: 0, itemKey: 'second-item', item },
      ])
    ).toThrow(/ordinals and keys must each be unique/i);
  });

  it('rejects a candidate finalized after projection creation', async () => {
    const fixture = fakeClient(false, finalizedAt);
    const repository = new PostgresAflTradeFactualProjectionItemSetRepository(fixture.client);

    await expect(repository.persist({ projection, itemSet, finalizedAt })).rejects.toThrow(
      /exact finalized candidate/i
    );
    expect(
      fixture.statements.some(({ sql }) => sql.includes('INSERT INTO outcome_projection_manifest'))
    ).toBe(false);
  });
});
