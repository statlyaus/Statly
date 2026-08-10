import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { aflDraftTradeOutcomeListItemSchema } from '@/types/aflDraftTradeOutcomes';
import type { AflDraftTradeOutcomeListItem } from '@/types/aflDraftTradeOutcomes';

import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import type {
  AflDraftTradeOutcomeProjectionPage,
  AflDraftTradeOutcomeReadErrorCode,
  AflDraftTradeOutcomeReleaseSelection,
  AflDraftTradeOutcomeRepository,
  AflDraftTradeOutcomeListReadRequest,
} from './outcomeReadService';
import {
  AflDraftTradeOutcomeReadError,
  createAflDraftTradeOutcomeReadService,
} from './outcomeReadService';
import {
  aflDraftTradeOutcomeAnyProjectionManifestSchema,
  aflDraftTradeOutcomeFactualProjectionManifestSchema,
  aflDraftTradeOutcomeProjectionManifestSchema,
  type AflDraftTradeOutcomeFactualProjectionManifest,
  type AflDraftTradeOutcomeProjectionManifest,
} from './outcomeReleaseContracts';
import { createAflDraftTradeOutcomeRegistryReleaseSelector } from './outcomeReleaseState';
import {
  PostgresAflDraftTradeOutcomeRegistrySnapshotStore,
  type AflOutcomeSqlClient,
} from './postgresOutcomeReleaseRepository';

interface ProjectionRow {
  manifest_json: unknown;
  candidate_id: string | null;
  member_set_sha256: string | null;
  candidate_status: string | null;
  finalized_at: string | Date | null;
  item_count: number | null;
  item_set_sha256: string | null;
  item_set_finalized_at: string | Date | null;
  stored_item_count: number;
}

interface ProjectionItemRow {
  ordinal: string | number | bigint;
  item_key: string;
  item_json: unknown;
  item_canonical_json: string | null;
  item_sha256: string | null;
}

interface ProjectionCountRow {
  total: number;
}

function fail(code: AflDraftTradeOutcomeReadErrorCode, message: string): never {
  throw new AflDraftTradeOutcomeReadError(code, message);
}

interface ProjectionCursorContent {
  version: 1;
  projectionId: string;
  querySha256: string;
  ordinal: string;
  itemKey: string;
}

function signCursor(content: ProjectionCursorContent, secret: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(JSON.stringify(content), 'utf8').digest();
}

function encodeCursor(content: ProjectionCursorContent, secret: Uint8Array): string {
  return Buffer.from(
    JSON.stringify({ content, signature: signCursor(content, secret).toString('base64url') }),
    'utf8'
  ).toString('base64url');
}

function decodeCursor(
  cursor: string,
  projectionId: string,
  querySha256: string,
  secret: Uint8Array
): ProjectionCursorContent {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) throw new Error();
    const envelope = JSON.parse(decoded) as {
      content?: Partial<ProjectionCursorContent>;
      signature?: unknown;
    };
    const content = envelope.content;
    const suppliedSignature =
      typeof envelope.signature === 'string'
        ? Buffer.from(envelope.signature, 'base64url')
        : Buffer.alloc(0);
    const expectedSignature = content
      ? signCursor(content as ProjectionCursorContent, secret)
      : Buffer.alloc(0);
    if (
      !content ||
      content.version !== 1 ||
      content.projectionId !== projectionId ||
      content.querySha256 !== querySha256 ||
      typeof content.ordinal !== 'string' ||
      !/^\d+$/.test(content.ordinal) ||
      typeof content.itemKey !== 'string' ||
      content.itemKey.length < 1 ||
      content.itemKey.length > 500 ||
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      throw new Error();
    }
    return content as ProjectionCursorContent;
  } catch {
    fail('INVALID_REQUEST', 'The factual projection cursor is invalid.');
  }
}

function querySha256(request: AflDraftTradeOutcomeListReadRequest): string {
  return sha256AflTradeCanonicalJson({
    club: normalizeSearch(request.club),
    limit: request.limit,
    metric: request.metric,
    q: normalizeSearch(request.q),
    status: request.status,
    year: request.year,
  });
}

function finalizedBeforeProjection(actual: string | Date, projectionCreatedAt: string): boolean {
  const finalizedAt = Date.parse(new Date(actual).toISOString());
  return Number.isFinite(finalizedAt) && finalizedAt <= Date.parse(projectionCreatedAt);
}

function itemSetFinalizedForRelease(
  actual: string | Date,
  projectionCreatedAt: string,
  releasePublishedAt: string
): boolean {
  const finalizedAt = Date.parse(new Date(actual).toISOString());
  return (
    Number.isFinite(finalizedAt) &&
    finalizedAt >= Date.parse(projectionCreatedAt) &&
    finalizedAt <= Date.parse(releasePublishedAt)
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('en-AU');
}

function normalizedSearchTerms(value: string): string[] {
  return normalizeSearch(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function prefixTsQuery(value: string): string | null {
  const terms = normalizedSearchTerms(value);
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(' & ') : null;
}

function itemMatchesRequest(
  item: AflDraftTradeOutcomeListItem,
  request: AflDraftTradeOutcomeListReadRequest
): boolean {
  if (request.year !== null && item.year !== request.year) return false;
  if (request.club) {
    const club = normalizeSearch(request.club);
    if (normalizeSearch(item.aflClubId) !== club && normalizeSearch(item.clubName) !== club) {
      return false;
    }
  }
  if (request.q) {
    const queryTerms = normalizedSearchTerms(request.q);
    if (queryTerms.length === 0) return false;
    const haystackTerms = normalizedSearchTerms(
      [
        item.eventId,
        item.tradeId ?? '',
        item.assetId ?? '',
        item.acquisitionType,
        item.aflClubId,
        item.clubName,
        item.player.aflPlayerId ?? '',
        item.player.displayName,
      ].join(' ')
    );
    if (!queryTerms.every((term) => haystackTerms.some((token) => token.startsWith(term)))) {
      return false;
    }
  }
  if (
    (request.metric || request.status) &&
    !item.checks.some(
      ({ metric, status }) =>
        (!request.metric || metric === request.metric) &&
        (!request.status || status === request.status)
    )
  ) {
    return false;
  }
  return true;
}

function buildFilter(
  request: AflDraftTradeOutcomeListReadRequest,
  parameters: unknown[]
): string[] {
  const filters: string[] = [];
  const add = (value: unknown) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  if (request.year !== null) filters.push(`item.year = ${add(request.year)}`);
  if (request.club) {
    const reference = add(request.club);
    filters.push(
      `(lower(item.afl_club_id) = lower(${reference}) OR lower(item.club_name) = lower(${reference}))`
    );
  }
  if (request.q) {
    const query = prefixTsQuery(request.q);
    if (query === null) filters.push('FALSE');
    else {
      const reference = add(query);
      filters.push(`to_tsvector('simple', item.search_text) @@ to_tsquery('simple', ${reference})`);
    }
  }
  if (request.metric || request.status) {
    const metricReference = request.metric ? add(request.metric) : null;
    const statusReference = request.status ? add(request.status) : null;
    if (metricReference) {
      filters.push(`item.metric_codes @> ARRAY[${metricReference}]::TEXT[]`);
    }
    if (statusReference) {
      filters.push(`item.status_codes @> ARRAY[${statusReference}]::TEXT[]`);
    }
    const metricPredicate = metricReference
      ? `check_value->>'metric' = ${metricReference}`
      : 'TRUE';
    const statusPredicate = statusReference
      ? `check_value->>'status' = ${statusReference}`
      : 'TRUE';
    filters.push(
      `EXISTS (SELECT 1 FROM jsonb_array_elements(item.item_json->'checks') AS checks(check_value) WHERE ${metricPredicate} AND ${statusPredicate})`
    );
  }
  return filters;
}

function parsePublicRow(row: ProjectionItemRow): AflDraftTradeOutcomeListItem {
  const parsed = aflDraftTradeOutcomeListItemSchema.safeParse(row.item_json);
  if (!parsed.success) {
    fail('INVALID_PROJECTION_PAYLOAD', 'A stored factual projection row is invalid.');
  }
  const canonical = canonicalizeAflTradeJson(parsed.data);
  if (
    row.item_canonical_json !== canonical ||
    row.item_sha256 !== sha256AflTradeCanonicalJson(parsed.data)
  ) {
    fail('PROJECTION_MISMATCH', 'A factual projection row does not match its sealed digest.');
  }
  return parsed.data;
}

async function requireExactFactualProjection(
  client: AflOutcomeSqlClient,
  selection: AflDraftTradeOutcomeReleaseSelection
): Promise<
  AflDraftTradeOutcomeProjectionManifest | AflDraftTradeOutcomeFactualProjectionManifest
> {
  const result = await client.query<ProjectionRow>(
    `SELECT projection.manifest_json,
            candidate.candidate_id,
            candidate.member_set_sha256,
            candidate.status AS candidate_status,
            candidate.finalized_at,
            item_set.item_count,
            item_set.item_set_sha256,
            item_set.finalized_at AS item_set_finalized_at,
            (SELECT count(*)::INTEGER
               FROM outcome_projection_item stored_item
              WHERE stored_item.release_id = projection.release_id
                AND stored_item.projection_id = projection.projection_id) AS stored_item_count
       FROM outcome_projection_manifest projection
       LEFT JOIN outcome_factual_release_candidate candidate
        ON candidate.target_release_id = projection.release_id
        AND candidate.candidate_id = projection.manifest_json->'content'->>'factualCandidateId'
       LEFT JOIN outcome_factual_projection_item_set item_set
         ON item_set.release_id = projection.release_id
        AND item_set.projection_id = projection.projection_id
      WHERE projection.projection_id = $1
        AND projection.release_id = $2`,
    [selection.release.projectionId, selection.release.releaseId]
  );
  if (result.rows.length !== 1) {
    fail('PROJECTION_MISMATCH', 'The exact factual projection is unavailable.');
  }
  const row = result.rows[0];
  const parsed = aflDraftTradeOutcomeAnyProjectionManifestSchema.safeParse(row.manifest_json);
  if (!parsed.success) {
    fail('INVALID_PROJECTION_PAYLOAD', 'The stored factual projection manifest is invalid.');
  }
  const manifest = parsed.data;
  if (manifest.content.schemaVersion === 'afl-draft-trade-factual-projection/v3') {
    fail(
      'PROJECTION_MISMATCH',
      'The public archive projection cannot be served through the outcome-metric reader.'
    );
  }
  const outcomeManifest =
    manifest.content.schemaVersion === 'afl-draft-trade-outcome-projection/v1'
      ? aflDraftTradeOutcomeProjectionManifestSchema.parse(manifest)
      : aflDraftTradeOutcomeFactualProjectionManifestSchema.parse(manifest);
  const content = outcomeManifest.content;
  const metricDefinitionIds = selection.metricDefinitions
    .map(({ metricDefinitionId }) => metricDefinitionId)
    .sort();
  if (
    manifest.projectionId !== selection.release.projectionId ||
    content.releaseId !== selection.release.releaseId ||
    content.scopeKey !== selection.scopeKey ||
    content.environment !== selection.environment ||
    content.archiveDatasetId !== selection.release.archiveDatasetId ||
    content.metricRegistryVersion !== selection.release.metricRegistryVersion ||
    content.effectiveThrough !== selection.release.effectiveThrough ||
    Date.parse(content.createdAt) > Date.parse(selection.release.publishedAt) ||
    content.metricDefinitionIds.length !== metricDefinitionIds.length ||
    content.metricDefinitionIds.some(
      (metricDefinitionId, index) => metricDefinitionId !== metricDefinitionIds[index]
    )
  ) {
    fail(
      'PROJECTION_MISMATCH',
      'The factual projection does not match its active release evidence.'
    );
  }
  if (content.schemaVersion === 'afl-draft-trade-outcome-projection/v1') {
    if (
      content.documentCount !== 0 ||
      content.parityReport.checkedOutcomeRecordCount !== 0 ||
      row.stored_item_count !== 0
    ) {
      fail('PROJECTION_MISMATCH', 'Legacy factual projections cannot serve unsealed outcome rows.');
    }
    return outcomeManifest;
  }
  if (
    content.factualCandidateId !== row.candidate_id ||
    content.sourceMemberSetSha256 !== row.member_set_sha256 ||
    content.publicListItemSetSha256 !== row.item_set_sha256 ||
    content.documentCount !== row.item_count ||
    row.candidate_status !== 'approved' ||
    row.finalized_at === null ||
    row.item_set_finalized_at === null ||
    !finalizedBeforeProjection(row.finalized_at, content.createdAt) ||
    !itemSetFinalizedForRelease(
      row.item_set_finalized_at,
      content.createdAt,
      selection.release.publishedAt
    )
  ) {
    fail(
      'PROJECTION_MISMATCH',
      'The factual projection does not match its active release evidence.'
    );
  }
  return outcomeManifest;
}

export class PostgresAflDraftTradeOutcomeProjectionRepository implements AflDraftTradeOutcomeRepository {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly cursorSecret: Uint8Array
  ) {
    if (cursorSecret.byteLength < 32) {
      throw new TypeError('The factual projection cursor secret must contain at least 32 bytes.');
    }
  }

  async list(
    selection: AflDraftTradeOutcomeReleaseSelection,
    request: AflDraftTradeOutcomeListReadRequest
  ): Promise<AflDraftTradeOutcomeProjectionPage> {
    const projection = await requireExactFactualProjection(this.client, selection);
    const requestSha256 = querySha256(request);
    const cursor = request.cursor
      ? decodeCursor(
          request.cursor,
          selection.release.projectionId,
          requestSha256,
          this.cursorSecret
        )
      : null;
    const countParameters: unknown[] = [
      selection.release.releaseId,
      selection.release.projectionId,
    ];
    const countFilters = buildFilter(request, countParameters);
    const countWhere = ['item.release_id = $1', 'item.projection_id = $2', ...countFilters].join(
      ' AND '
    );
    const itemParameters = [...countParameters];
    const itemFilters = [...countFilters];
    if (cursor) {
      itemParameters.push(cursor.ordinal, cursor.itemKey);
      itemFilters.push(
        `(item.ordinal, item.item_key) > ($${itemParameters.length - 1}::BIGINT, $${itemParameters.length})`
      );
    }
    itemParameters.push(request.limit + 1);
    const itemWhere = ['item.release_id = $1', 'item.projection_id = $2', ...itemFilters].join(
      ' AND '
    );
    const [countResult, itemResult] = await Promise.all([
      this.client.query<ProjectionCountRow>(
        `SELECT count(*)::INTEGER AS total
           FROM outcome_projection_item item
          WHERE ${countWhere}`,
        countParameters
      ),
      this.client.query<ProjectionItemRow>(
        `SELECT item.ordinal,
                item.item_key,
                item.item_json,
                item.item_canonical_json,
                item.item_sha256
           FROM outcome_projection_item item
          WHERE ${itemWhere}
          ORDER BY item.ordinal, item.item_key
          LIMIT $${itemParameters.length}`,
        itemParameters
      ),
    ]);
    if (countResult.rows.length !== 1) {
      fail('PROJECTION_MISMATCH', 'The factual projection total is unavailable.');
    }
    const total = countResult.rows[0].total;
    if (!Number.isInteger(total) || total < 0 || total > projection.content.documentCount) {
      fail('PROJECTION_MISMATCH', 'The factual projection total does not match its sealed set.');
    }
    const pageRows = itemResult.rows.slice(0, request.limit);
    const items = pageRows.map((row) => {
      const parsed = parsePublicRow(row);
      if (!itemMatchesRequest(parsed, request)) {
        fail('PROJECTION_MISMATCH', 'A factual projection row is outside the requested filters.');
      }
      return parsed;
    });
    const lastReturnedRow = pageRows.at(-1);
    const nextCursor =
      itemResult.rows.length > request.limit && lastReturnedRow
        ? encodeCursor(
            {
              version: 1,
              projectionId: selection.release.projectionId,
              querySha256: requestSha256,
              ordinal: String(lastReturnedRow.ordinal),
              itemKey: lastReturnedRow.item_key,
            },
            this.cursorSecret
          )
        : null;

    return {
      metadata: {
        scopeKey: selection.scopeKey,
        release: selection.release,
        freshness: 'current',
        warnings: [],
      },
      items,
      nextCursor,
      total,
    };
  }
}

/**
 * Creates the production-shaped factual read boundary without discovering a database URL, Gate
 * ledger, clock, or fantasy dependency. Mounting this factory remains an explicit runtime decision.
 */
export function createPostgresAflDraftTradeOutcomeReadService(dependencies: {
  client: AflOutcomeSqlClient;
  cursorSecret: Uint8Array;
  expectedEnvironment: AflTradeDecisionEnvironment;
  loadSourceRightsDecisionLedger: () => Promise<AflTradeGateDecisionLedger>;
  now: () => string;
}) {
  const registryStore = new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(dependencies.client);
  return createAflDraftTradeOutcomeReadService({
    releaseSelector: createAflDraftTradeOutcomeRegistryReleaseSelector(
      () => registryStore.load(),
      dependencies.loadSourceRightsDecisionLedger,
      dependencies.now,
      dependencies.expectedEnvironment
    ),
    repository: new PostgresAflDraftTradeOutcomeProjectionRepository(
      dependencies.client,
      dependencies.cursorSecret
    ),
    now: dependencies.now,
  });
}
