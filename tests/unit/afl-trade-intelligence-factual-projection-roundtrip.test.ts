import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFactualProjectionItemSet } from '@/server/aflTradeIntelligence/outcomes/factualProjectionItemSetContracts';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  type AflDraftTradeOutcomeReleaseSelection,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { createAflDraftTradeOutcomeFactualProjectionManifest } from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import { PostgresAflTradeFactualProjectionItemSetRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualProjectionItemSetRepository';
import { PostgresAflDraftTradeOutcomeProjectionRepository } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeProjectionReadRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { aflDraftTradeOutcomeListItemSchema } from '@/types/aflDraftTradeOutcomes';

const digest = (character: string) => character.repeat(64);
const createdAt = '2025-09-02T00:00:00.000Z';
const finalizedAt = '2025-09-02T00:01:00.000Z';
const publishedAt = '2025-09-02T00:02:00.000Z';
const effectiveThrough = '2025-09-01T00:00:00.000Z';
const releaseId = `outcome-release:${digest('a')}`;
const candidateId = `factual-release-candidate:${digest('b')}`;
const sourceMemberSetSha256 = digest('c');
const metricDefinition = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS[0];
const artifact = createAflTradeCanonicalJsonArtifactRef({ roundtrip: true }, createdAt);

const item = aflDraftTradeOutcomeListItemSchema.parse({
  eventId: 'event:roundtrip-2025-0001',
  tradeId: null,
  assetId: 'asset:roundtrip-1',
  year: 2025,
  acquisitionType: 'National Draft',
  aflClubId: 'club:roundtrip-a',
  clubName: 'Roundtrip Club',
  player: {
    aflPlayerId: 'player:roundtrip-1',
    displayName: 'Roundtrip Player',
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
      scopeLabel: 'Reviewed club spell',
      effectiveThrough,
      message: 'Twelve reviewed AFL games were observed.',
      sources: [
        {
          role: 'observed',
          artifactId: artifact.artifactId,
          locator: 'roundtrip/player/season',
          rightsDecisionId: `gate-decision:${digest('d')}`,
          metricDefinitionId: metricDefinition.metricDefinitionId,
        },
      ],
    },
  ],
  achievements: [],
});

const itemSet = createAflTradeFactualProjectionItemSet([
  { ordinal: 0, itemKey: 'roundtrip-item', item },
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
  effectiveThrough,
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

function selection(): AflDraftTradeOutcomeReleaseSelection {
  return {
    registryRevision: 2,
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    environment: 'test_fixture',
    release: {
      releaseId,
      projectionId: projection.projectionId,
      archiveDatasetId: projection.content.archiveDatasetId,
      metricRegistryVersion: projection.content.metricRegistryVersion,
      effectiveThrough,
      publishedAt,
    },
    metricDefinitions: [metricDefinition],
    supportedScope: ['Reviewed fixture outcomes'],
    excludedScope: [],
  };
}

function statefulClient(): AflOutcomeSqlClient {
  let storedProjection: unknown = null;
  let storedItemSet: { item_count: number; item_set_sha256: string; finalized_at: string } | null =
    null;
  let storedItems: Array<Record<string, unknown>> = [];

  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes('FROM outcome_factual_release_candidate')) {
      return { rows: [{ finalized_at: createdAt }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO outcome_projection_manifest')) {
      storedProjection = JSON.parse(String(parameters[3]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT projection_id')) {
      return storedProjection
        ? { rows: [{ projection_id: projection.projectionId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT item_count, item_set_sha256, finalized_at')) {
      return storedItemSet ? { rows: [storedItemSet], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO outcome_projection_item')) {
      storedItems = JSON.parse(String(parameters[2])) as Array<Record<string, unknown>>;
      return { rows: [], rowCount: storedItems.length };
    }
    if (sql.includes('INSERT INTO outcome_factual_projection_item_set')) {
      storedItemSet = {
        item_count: Number(parameters[2]),
        item_set_sha256: String(parameters[3]),
        finalized_at: String(parameters[4]),
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_projection_manifest projection')) {
      return {
        rows: [
          {
            manifest_json: storedProjection,
            candidate_id: candidateId,
            member_set_sha256: sourceMemberSetSha256,
            candidate_status: 'approved',
            finalized_at: createdAt,
            item_count: storedItemSet?.item_count,
            item_set_sha256: storedItemSet?.item_set_sha256,
            item_set_finalized_at: storedItemSet?.finalized_at,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('count(*)::INTEGER AS total')) {
      return { rows: [{ total: storedItems.length }], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_projection_item item')) {
      return {
        rows: storedItems.map((row) => ({
          ordinal: String(row.ordinal),
          item_key: row.item_key,
          item_json: row.item_json,
          item_canonical_json: row.item_canonical_json,
          item_sha256: row.item_sha256,
        })),
        rowCount: storedItems.length,
      };
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
}

describe('factual projection producer-to-reader round trip', () => {
  it('serves only the canonical rows staged and sealed by the shared item-set contract', async () => {
    const client = statefulClient();
    await new PostgresAflTradeFactualProjectionItemSetRepository(client).persist({
      projection,
      itemSet,
      finalizedAt,
    });

    const page = await new PostgresAflDraftTradeOutcomeProjectionRepository(
      client,
      new TextEncoder().encode('roundtrip-cursor-secret-is-at-least-thirty-two-bytes')
    ).list(selection(), {
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      year: null,
      club: '',
      q: '',
      metric: null,
      status: null,
      limit: 50,
      cursor: null,
    });

    expect(page.items).toEqual([item]);
    expect(page.total).toBe(1);
    expect(page.metadata.release.projectionId).toBe(projection.projectionId);
  });
});
