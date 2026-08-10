import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFactualProjectionItemSet } from '@/server/aflTradeIntelligence/outcomes/factualProjectionItemSetContracts';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  type AflDraftTradeOutcomeReleaseSelection,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import {
  createAflDraftTradeOutcomeFactualProjectionManifest,
  createAflDraftTradeOutcomeProjectionManifest,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import { PostgresAflDraftTradeOutcomeProjectionRepository } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeProjectionReadRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { aflDraftTradeOutcomeListItemSchema } from '@/types/aflDraftTradeOutcomes';

const hash = (value: string) => value.repeat(64);
const createdAt = '2025-09-02T00:00:00.000Z';
const itemSetFinalizedAt = '2025-09-02T00:01:00.000Z';
const publishedAt = '2025-09-02T00:02:00.000Z';
const effectiveThrough = '2025-09-01T00:00:00.000Z';
const releaseId = `outcome-release:${hash('a')}`;
const candidateId = `factual-release-candidate:${hash('b')}`;
const sourceMemberSetSha256 = hash('c');
const artifact = createAflTradeCanonicalJsonArtifactRef({ fixture: true }, createdAt);
const metricDefinition = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS[0];
const cursorSecret = new TextEncoder().encode('fixture-cursor-secret-contains-more-than-32-bytes');

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
      scopeLabel: 'Fixture club spell',
      effectiveThrough,
      message: 'Twelve reviewed AFL games were observed.',
      sources: [
        {
          role: 'observed',
          artifactId: artifact.artifactId,
          locator: 'fixture/player/season',
          rightsDecisionId: `gate-decision:${hash('f')}`,
          metricDefinitionId: metricDefinition.metricDefinitionId,
        },
      ],
    },
  ],
  achievements: [],
});

const secondItem = aflDraftTradeOutcomeListItemSchema.parse({
  ...item,
  eventId: 'event:fixture-2025-0002',
  assetId: 'asset:fixture-2',
  player: {
    aflPlayerId: 'player:fixture-2',
    displayName: 'Second Fixture Player',
    identityStatus: 'resolved',
  },
});

interface ItemRow {
  ordinal: string;
  item_key: string;
  item_json: unknown;
  item_canonical_json?: string | null;
  item_sha256?: string | null;
}

const oneRow: readonly ItemRow[] = [{ ordinal: '0', item_key: 'fixture-item', item_json: item }];
const twoRows: readonly ItemRow[] = [
  ...oneRow,
  { ordinal: '1', item_key: 'second-item', item_json: secondItem },
];

function publicRoot(rows: readonly ItemRow[]): string {
  return createAflTradeFactualProjectionItemSet(
    rows.map((row) => ({
      ordinal: row.ordinal,
      itemKey: row.item_key,
      item: row.item_json,
    }))
  ).itemSetSha256;
}

function projectionFor(
  rows: readonly ItemRow[],
  overrides: { documentCount?: number; rootRows?: readonly ItemRow[] } = {}
) {
  const logicalDatasetSha256 = hash('e');
  const publicListItemSetSha256 = publicRoot(overrides.rootRows ?? rows);
  return createAflDraftTradeOutcomeFactualProjectionManifest({
    schemaVersion: 'afl-draft-trade-outcome-projection/v2',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    environment: 'test_fixture',
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    createdAt,
    releaseId,
    archiveDatasetId: `archive-dataset:${hash('d')}`,
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
    documentCount: overrides.documentCount ?? rows.length,
    factualCandidateId: candidateId,
    sourceMemberSetSha256,
    publicListItemSetSha256,
    derivationSha256: sha256AflTradeCanonicalJson({
      factualCandidateId: candidateId,
      logicalDatasetSha256,
      publicListItemSetSha256,
      sourceMemberSetSha256,
    }),
  });
}

function selectionFor(
  projection: ReturnType<typeof createAflDraftTradeOutcomeFactualProjectionManifest>
): AflDraftTradeOutcomeReleaseSelection {
  return {
    registryRevision: 4,
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    environment: 'test_fixture',
    release: {
      releaseId,
      projectionId: projection.projectionId,
      archiveDatasetId: projection.content.archiveDatasetId,
      metricRegistryVersion: projection.content.metricRegistryVersion,
      effectiveThrough: projection.content.effectiveThrough,
      publishedAt,
    },
    metricDefinitions: [metricDefinition],
    supportedScope: ['Reviewed fixture outcomes'],
    excludedScope: [],
  };
}

function fixtureClient(
  rows: readonly ItemRow[],
  projection: ReturnType<typeof createAflDraftTradeOutcomeFactualProjectionManifest>
): AflOutcomeSqlClient {
  const persistedRows = rows.map((row) => ({
    ...row,
    item_canonical_json: row.item_canonical_json ?? canonicalizeAflTradeJson(row.item_json),
    item_sha256: row.item_sha256 ?? sha256AflTradeCanonicalJson(row.item_json),
  }));
  const parameter = (sql: string, pattern: RegExp, parameters: readonly unknown[]) => {
    const reference = sql.match(pattern)?.[1];
    return reference ? parameters[Number(reference) - 1] : undefined;
  };
  const filterRows = (sql: string, parameters: readonly unknown[]) => {
    if (sql.includes('FALSE')) return [];
    const year = parameter(sql, /item\.year = \$(\d+)/, parameters);
    const club = parameter(sql, /lower\(\$(\d+)\)/, parameters);
    const q = parameter(sql, /to_tsquery\('simple', \$(\d+)\)/, parameters);
    const metric = parameter(sql, /check_value->>'metric' = \$(\d+)/, parameters);
    const status = parameter(sql, /check_value->>'status' = \$(\d+)/, parameters);
    const cursorOrdinal = parameter(sql, /> \(\$(\d+)::BIGINT/, parameters);
    const cursorKey = parameter(sql, /::BIGINT, \$(\d+)\)/, parameters);
    return persistedRows.filter((row) => {
      const parsed = aflDraftTradeOutcomeListItemSchema.safeParse(row.item_json);
      if (!parsed.success) return true;
      const value = parsed.data;
      if (typeof year === 'number' && value.year !== year) return false;
      if (
        typeof club === 'string' &&
        value.aflClubId.toLowerCase() !== club.toLowerCase() &&
        value.clubName.toLowerCase() !== club.toLowerCase()
      ) {
        return false;
      }
      if (typeof q === 'string') {
        const haystackTerms =
          [
            value.eventId,
            value.tradeId,
            value.assetId,
            value.acquisitionType,
            value.aflClubId,
            value.clubName,
            value.player.aflPlayerId,
            value.player.displayName,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu) ?? [];
        const terms = q.split(' & ').map((term) => term.replace(/:\*$/, ''));
        if (!terms.every((term) => haystackTerms.some((token) => token.startsWith(term)))) {
          return false;
        }
      }
      if (
        (typeof metric === 'string' || typeof status === 'string') &&
        !value.checks.some(
          (check) =>
            (typeof metric !== 'string' || check.metric === metric) &&
            (typeof status !== 'string' || check.status === status)
        )
      ) {
        return false;
      }
      if (typeof cursorOrdinal === 'string' && typeof cursorKey === 'string') {
        const difference = BigInt(row.ordinal) - BigInt(cursorOrdinal);
        if (difference < 0n || (difference === 0n && row.item_key <= cursorKey)) return false;
      }
      return true;
    });
  };
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes('FROM outcome_projection_manifest projection')) {
      expect(parameters).toEqual([projection.projectionId, releaseId]);
      return {
        rows: [
          {
            manifest_json: projection,
            candidate_id: candidateId,
            member_set_sha256: sourceMemberSetSha256,
            candidate_status: 'approved',
            finalized_at: createdAt,
            item_count: persistedRows.length,
            item_set_sha256: projection.content.publicListItemSetSha256,
            item_set_finalized_at: itemSetFinalizedAt,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('count(*)::INTEGER AS total')) {
      return { rows: [{ total: filterRows(sql, parameters).length }], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_projection_item item')) {
      expect(sql).toContain('ORDER BY item.ordinal, item.item_key');
      if (parameters.includes('games')) expect(sql).toContain('item.metric_codes @>');
      if (parameters.includes('source_only')) expect(sql).toContain('item.status_codes @>');
      expect(parameters.slice(0, 2)).toEqual([releaseId, projection.projectionId]);
      const limit = Number(parameters.at(-1));
      const result = filterRows(sql, parameters)
        .sort((left, right) => Number(BigInt(left.ordinal) - BigInt(right.ordinal)))
        .slice(0, limit);
      return { rows: result, rowCount: result.length };
    }
    throw new Error(`Unexpected SQL in fixture boundary: ${sql}`);
  };
  return {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
}

function repository(rows = oneRow, projection = projectionFor(rows)) {
  return {
    projection,
    selection: selectionFor(projection),
    repository: new PostgresAflDraftTradeOutcomeProjectionRepository(
      fixtureClient(rows, projection),
      cursorSecret
    ),
  };
}

const unfilteredRequest = {
  scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  year: null,
  club: '',
  q: '',
  metric: null,
  status: null,
  limit: 25,
  cursor: null,
} as const;

describe('PostgreSQL AFL outcome projection reads', () => {
  it('returns an honest empty page for an exact zero-document legacy projection', async () => {
    const legacyProjection = createAflDraftTradeOutcomeProjectionManifest({
      schemaVersion: 'afl-draft-trade-outcome-projection/v1',
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
      environment: 'test_fixture',
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      createdAt,
      releaseId,
      archiveDatasetId: `archive-dataset:${hash('d')}`,
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
        checkedOutcomeRecordCount: 0,
        logicalDatasetSha256: hash('e'),
      },
      documentCount: 0,
    });
    const selection: AflDraftTradeOutcomeReleaseSelection = {
      registryRevision: 4,
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      environment: 'test_fixture',
      release: {
        releaseId,
        projectionId: legacyProjection.projectionId,
        archiveDatasetId: legacyProjection.content.archiveDatasetId,
        metricRegistryVersion: legacyProjection.content.metricRegistryVersion,
        effectiveThrough,
        publishedAt,
      },
      metricDefinitions: [metricDefinition],
      supportedScope: ['Source-native archive records'],
      excludedScope: ['Outcome calculations'],
    };
    const legacyClient = (storedItemCount: number): AflOutcomeSqlClient => {
      const query = async (sql: string, parameters: readonly unknown[] = []) => {
        if (sql.includes('FROM outcome_projection_manifest projection')) {
          expect(parameters).toEqual([legacyProjection.projectionId, releaseId]);
          return {
            rows: [{ manifest_json: legacyProjection, stored_item_count: storedItemCount }],
            rowCount: 1,
          };
        }
        if (sql.includes('count(*)::INTEGER AS total')) {
          return { rows: [{ total: 0 }], rowCount: 1 };
        }
        if (sql.includes('FROM outcome_projection_item item')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL in legacy fixture boundary: ${sql}`);
      };
      return {
        query: query as AflOutcomeSqlClient['query'],
        async transaction(work) {
          return work({ query: query as AflOutcomeSqlClient['query'] });
        },
      };
    };

    await expect(
      new PostgresAflDraftTradeOutcomeProjectionRepository(legacyClient(0), cursorSecret).list(
        selection,
        unfilteredRequest
      )
    ).resolves.toMatchObject({ items: [], total: 0, nextCursor: null });
    await expect(
      new PostgresAflDraftTradeOutcomeProjectionRepository(legacyClient(1), cursorSecret).list(
        selection,
        { ...unfilteredRequest, year: 2025 }
      )
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('returns only rows authenticated by the exact factual public-dataset root', async () => {
    const fixture = repository();

    await expect(fixture.repository.list(fixture.selection, unfilteredRequest)).resolves.toEqual({
      metadata: {
        scopeKey: fixture.selection.scopeKey,
        release: fixture.selection.release,
        freshness: 'current',
        warnings: [],
      },
      items: [item],
      nextCursor: null,
      total: 1,
    });
    await expect(
      fixture.repository.list(fixture.selection, { ...unfilteredRequest, q: 'Fixt Play' })
    ).resolves.toMatchObject({ items: [item], total: 1 });
    await expect(
      fixture.repository.list(fixture.selection, { ...unfilteredRequest, q: 'ixt lay' })
    ).resolves.toMatchObject({ items: [], total: 0 });
    await expect(
      fixture.repository.list(fixture.selection, { ...unfilteredRequest, q: '---' })
    ).resolves.toMatchObject({ items: [], total: 0 });

    const substituted = repository(
      [
        {
          ordinal: '0',
          item_key: 'fixture-item',
          item_json: secondItem,
          item_canonical_json: canonicalizeAflTradeJson(item),
          item_sha256: sha256AflTradeCanonicalJson(item),
        },
      ],
      projectionFor(oneRow)
    );
    await expect(
      substituted.repository.list(substituted.selection, unfilteredRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('signs cursors, binds them to filters, and rejects deliberate forgery', async () => {
    const projection = projectionFor(twoRows);
    const first = repository(twoRows, projection);
    const firstPage = await first.repository.list(first.selection, {
      ...unfilteredRequest,
      limit: 1,
    });

    expect(firstPage.items).toEqual([item]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    await expect(
      first.repository.list(first.selection, {
        ...unfilteredRequest,
        limit: 1,
        cursor: firstPage.nextCursor,
      })
    ).resolves.toMatchObject({ items: [secondItem], nextCursor: null, total: 2 });

    const envelope = JSON.parse(
      Buffer.from(firstPage.nextCursor!, 'base64url').toString('utf8')
    ) as { content: { ordinal: string }; signature: string };
    envelope.content.ordinal = '999';
    const forged = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
    await expect(
      first.repository.list(first.selection, {
        ...unfilteredRequest,
        limit: 1,
        cursor: forged,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await expect(
      first.repository.list(first.selection, {
        ...unfilteredRequest,
        q: 'second',
        limit: 1,
        cursor: firstPage.nextCursor,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('requires metric and status to match the same outcome check', async () => {
    const splitChecks = aflDraftTradeOutcomeListItemSchema.parse({
      ...item,
      checks: [
        item.checks[0],
        {
          ...item.checks[0],
          metric: 'goals',
          status: 'matched',
          recordedValue: 12,
          delta: 0,
          sources: [
            {
              ...item.checks[0].sources[0],
              role: 'recorded',
              locator: 'fixture/workbook/season',
            },
            item.checks[0].sources[0],
          ],
        },
      ],
    });
    const rows = [{ ordinal: '0', item_key: 'split-checks', item_json: splitChecks }];
    const fixture = repository(rows);

    await expect(
      fixture.repository.list(fixture.selection, {
        ...unfilteredRequest,
        metric: 'games',
        status: 'matched',
      })
    ).resolves.toMatchObject({ items: [], total: 0 });

    await expect(
      fixture.repository.list(fixture.selection, {
        ...unfilteredRequest,
        year: 2025,
        club: 'fixture club a',
        q: 'fixture player',
        metric: 'games',
        status: 'source_only',
      })
    ).resolves.toMatchObject({ items: [splitChecks], total: 1 });
  });

  it('rejects count drift, malformed rows, weak secrets, and row-digest drift', async () => {
    const countDriftProjection = projectionFor(oneRow, { documentCount: 2 });
    const countDrift = repository(oneRow, countDriftProjection);
    await expect(
      countDrift.repository.list(countDrift.selection, unfilteredRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });

    const invalidRows = [
      { ordinal: '0', item_key: 'invalid', item_json: { ...item, userId: 'x' } },
    ];
    const invalid = repository(invalidRows, projectionFor(oneRow));
    await expect(
      invalid.repository.list(invalid.selection, unfilteredRequest)
    ).rejects.toMatchObject({ code: 'INVALID_PROJECTION_PAYLOAD' });

    const digestDriftRows = [
      {
        ...oneRow[0],
        item_sha256: hash('9'),
      },
    ];
    const digestDrift = repository(digestDriftRows, projectionFor(oneRow));
    await expect(
      digestDrift.repository.list(digestDrift.selection, unfilteredRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });

    expect(
      () =>
        new PostgresAflDraftTradeOutcomeProjectionRepository(
          fixtureClient(oneRow, projectionFor(oneRow)),
          new Uint8Array(31)
        )
    ).toThrow(/at least 32 bytes/i);
  });
});
