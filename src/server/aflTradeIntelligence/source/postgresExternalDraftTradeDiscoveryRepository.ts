import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeExternalDiscoveryInventorySchema,
  aflTradeExternalHistoricalCapturePlanSchema,
  createAflTradeExternalDiscoveryInventory,
  type AflTradeExternalDiscoveryInventory,
  type AflTradeExternalHistoricalCapturePlan,
} from './externalDraftTradeDiscoveryContracts';
import { parseAflTradeExternalEvidenceBatch } from './externalDraftTradeEvidenceContracts';
import { persistAflTradeExternalCaptureSchedule } from './postgresExternalDraftTradeScheduleRepository';

export type AflTradeExternalDiscoveryPersistenceErrorCode =
  'INVALID_RECORD' | 'INVENTORY_CONFLICT' | 'PLAN_CONFLICT' | 'INVENTORY_NOT_FINALIZED';

export class AflTradeExternalDiscoveryPersistenceError extends Error {
  constructor(
    readonly code: AflTradeExternalDiscoveryPersistenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeExternalDiscoveryPersistenceError';
  }
}

export interface PersistedAflTradeExternalDiscoveryInventory {
  inventoryId: string;
  linkCount: number;
  idempotentReplay: boolean;
}

export interface PersistedAflTradeExternalHistoricalCapturePlan {
  planId: string;
  targetCount: number;
  idempotentReplay: boolean;
}

export interface AflTradeExternalHistoricalCapturePlanPage {
  planId: string;
  targetCount: number;
  afterOrdinal: number;
  targets: AflTradeExternalHistoricalCapturePlan['content']['targets'];
  nextAfterOrdinal: number | null;
}

interface InventoryRow {
  inventory_json: unknown;
  finalized_at: string | Date | null;
  link_count: number;
}

interface PlanRow {
  plan_json: unknown;
  finalized_at: string | Date | null;
  target_count: number;
}

interface DiscoveryBatchRow {
  batch_json: unknown;
  status: string;
  issue_count: number;
  environment: 'test_fixture' | 'non_production' | 'production';
  provider: string;
  competition: string;
  anchor_season_year: number;
  capability_id: string;
}

interface HistoricalTargetRow {
  ordinal: number;
  target_id: string;
  target_json: unknown;
}

function parseInventory(value: unknown): AflTradeExternalDiscoveryInventory {
  try {
    return aflTradeExternalDiscoveryInventorySchema.parse(value);
  } catch (error) {
    throw new AflTradeExternalDiscoveryPersistenceError(
      'INVALID_RECORD',
      'External trade discovery inventory failed its content-addressed contract.',
      { cause: error }
    );
  }
}

function parsePlan(value: unknown): AflTradeExternalHistoricalCapturePlan {
  try {
    return aflTradeExternalHistoricalCapturePlanSchema.parse(value);
  } catch (error) {
    throw new AflTradeExternalDiscoveryPersistenceError(
      'INVALID_RECORD',
      'External historical capture plan failed its content-addressed contract.',
      { cause: error }
    );
  }
}

function exactInstant(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function lock(transaction: AflOutcomeSqlTransaction, subject: string): Promise<void> {
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [subject]);
}

async function storedInventory(
  transaction: AflOutcomeSqlTransaction,
  inventoryId: string
): Promise<InventoryRow | undefined> {
  const result = await transaction.query<InventoryRow>(
    `SELECT inventory_json, finalized_at, link_count
       FROM outcome_external_trade_discovery_inventory
      WHERE inventory_id=$1
      FOR SHARE`,
    [inventoryId]
  );
  return result.rows[0];
}

async function storedPlan(
  transaction: AflOutcomeSqlTransaction,
  planId: string
): Promise<PlanRow | undefined> {
  const result = await transaction.query<PlanRow>(
    `SELECT plan_json, finalized_at, target_count
       FROM outcome_external_historical_capture_plan
      WHERE plan_id=$1
      FOR SHARE`,
    [planId]
  );
  return result.rows[0];
}

function inventoryReplay(
  row: InventoryRow,
  inventory: AflTradeExternalDiscoveryInventory
): boolean {
  return (
    canonicalizeAflTradeJson(row.inventory_json) === canonicalizeAflTradeJson(inventory) &&
    exactInstant(row.finalized_at) === inventory.content.discoveredAt &&
    row.link_count === inventory.content.links.length
  );
}

function planReplay(row: PlanRow, plan: AflTradeExternalHistoricalCapturePlan): boolean {
  return (
    canonicalizeAflTradeJson(row.plan_json) === canonicalizeAflTradeJson(plan) &&
    exactInstant(row.finalized_at) === plan.content.plannedAt &&
    row.target_count === plan.content.targetCount
  );
}

export class PostgresAflTradeExternalDiscoveryRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async findLatestFinalizedIndexBatch(input: {
    environment: 'test_fixture' | 'non_production' | 'production';
    fromYear: number;
    throughYear: number;
  }): Promise<string> {
    const result = await this.client.query<{ batch_id: string }>(
      `SELECT batch.batch_id
         FROM outcome_source_capture capture
         JOIN outcome_external_evidence_batch batch ON batch.capture_id=capture.capture_id
        WHERE capture.environment=$1::"OutcomeEnvironment"
          AND capture.provider='draftguru'
          AND capture.competition='AFLM'
          AND capture.capability_id='draftguru-trade-index'
          AND capture.anchor_season_year=$2
          AND capture.manifest_json->>'sourceUrl' IN (
            'https://www.draftguru.com.au/trades',
            'https://www.draftguru.com.au/trades/'
          )
          AND capture.manifest_json->'executionReceipt'->'content'->'request'
                ->>'discoveryFromSeasonYear'=$3
          AND batch.status='finalized' AND batch.issue_count=0
        ORDER BY capture.captured_at DESC, batch.batch_id DESC
        LIMIT 1`,
      [input.environment, input.throughYear, String(input.fromYear)]
    );
    const batchId = result.rows[0]?.batch_id;
    if (!batchId) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'INVALID_RECORD',
        'No finalized issue-free Draftguru index batch exists for the exact discovery range.'
      );
    }
    return batchId;
  }

  async loadInventoryFromBatch(input: {
    batchId: string;
    fromYear: number;
    throughYear: number;
  }): Promise<AflTradeExternalDiscoveryInventory> {
    const result = await this.client.query<DiscoveryBatchRow>(
      `SELECT batch.batch_json, batch.status, batch.issue_count,
              capture.environment::text AS environment, capture.provider,
              capture.competition, capture.anchor_season_year, capture.capability_id
         FROM outcome_external_evidence_batch batch
         JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
        WHERE batch.batch_id=$1`,
      [input.batchId]
    );
    const row = result.rows[0];
    let batch;
    try {
      batch = parseAflTradeExternalEvidenceBatch(row?.batch_json);
    } catch (error) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'INVALID_RECORD',
        'Discovery requires one authenticated external evidence batch.',
        { cause: error }
      );
    }
    if (
      !row ||
      row.status !== 'finalized' ||
      row.issue_count !== 0 ||
      (row.environment !== 'test_fixture' &&
        row.environment !== 'non_production' &&
        row.environment !== 'production') ||
      row.provider !== 'draftguru' ||
      row.competition !== 'AFLM' ||
      row.capability_id !== 'draftguru-trade-index' ||
      row.anchor_season_year !== input.throughYear ||
      batch.batchId !== input.batchId ||
      batch.content.provider !== 'draftguru'
    ) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'INVALID_RECORD',
        'Discovery batch is not finalized, issue-free Draftguru index evidence in the exact scope.'
      );
    }
    const links = batch.content.evidence.map((evidence, index) => {
      if (evidence.content.claim.kind !== 'trade_detail_link') {
        throw new AflTradeExternalDiscoveryPersistenceError(
          'INVALID_RECORD',
          'Discovery batch contains a non-link evidence claim.'
        );
      }
      return {
        ordinal: index + 1,
        evidenceId: evidence.evidenceId,
        anchorSeasonYear: evidence.content.claim.anchorSeasonYear,
        nativeEventId: evidence.content.claim.nativeEventId,
        sourceUrl: evidence.content.claim.sourceUrl,
      };
    });
    const sourceCapture = batch.content.evidence[0]!.content.capture;
    if (
      sourceCapture.sourceUrl !== 'https://www.draftguru.com.au/trades' &&
      sourceCapture.sourceUrl !== 'https://www.draftguru.com.au/trades/'
    ) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'INVALID_RECORD',
        'Discovery batch does not bind the exact Draftguru trade index URL.'
      );
    }
    return createAflTradeExternalDiscoveryInventory({
      schemaVersion: 'afl-trade-external-discovery-inventory/v1',
      environment: row.environment,
      provider: 'draftguru',
      competition: 'AFLM',
      sourceCaptureId: batch.content.captureId,
      sourceEvidenceBatchId: batch.batchId,
      sourceContentSha256: sourceCapture.contentSha256,
      sourceUrl: sourceCapture.sourceUrl,
      fromYear: input.fromYear,
      throughYear: input.throughYear,
      links,
      discoveredAt: batch.content.finalizedAt,
      completeForCapturedIndex: true,
      publicationEligible: false,
    });
  }

  async loadFinalizedPlanPage(input: {
    planId: string;
    afterOrdinal: number;
    maximumTargets: number;
  }): Promise<AflTradeExternalHistoricalCapturePlanPage> {
    if (
      !/^external-historical-capture-plan:[a-f0-9]{64}$/.test(input.planId) ||
      !Number.isInteger(input.afterOrdinal) ||
      input.afterOrdinal < 0 ||
      !Number.isInteger(input.maximumTargets) ||
      input.maximumTargets < 1 ||
      input.maximumTargets > 1_000
    ) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'INVALID_RECORD',
        'Historical plan paging requires a valid plan, cursor and bounded page size.'
      );
    }
    const stored = await this.client.query<PlanRow>(
      `SELECT plan_json, finalized_at, target_count
         FROM outcome_external_historical_capture_plan
        WHERE plan_id=$1`,
      [input.planId]
    );
    const row = stored.rows[0];
    if (!row || row.finalized_at === null) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'INVALID_RECORD',
        'Historical capture plan is absent or not finalized.'
      );
    }
    const plan = parsePlan(row.plan_json);
    if (
      plan.planId !== input.planId ||
      row.target_count !== plan.content.targetCount ||
      exactInstant(row.finalized_at) !== plan.content.plannedAt
    ) {
      throw new AflTradeExternalDiscoveryPersistenceError(
        'PLAN_CONFLICT',
        'Stored historical plan authority does not match its content-addressed envelope.'
      );
    }
    const result = await this.client.query<HistoricalTargetRow>(
      `SELECT ordinal,target_id,target_json
         FROM outcome_external_historical_capture_target
        WHERE plan_id=$1 AND ordinal>$2
        ORDER BY ordinal
        LIMIT $3`,
      [input.planId, input.afterOrdinal, input.maximumTargets]
    );
    const targets = result.rows.map((target) => {
      const expected = plan.content.targets[target.ordinal - 1];
      if (
        !expected ||
        expected.targetId !== target.target_id ||
        canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(target.target_json)
      ) {
        throw new AflTradeExternalDiscoveryPersistenceError(
          'PLAN_CONFLICT',
          'Historical target row does not match the finalized plan envelope.'
        );
      }
      return expected;
    });
    const lastOrdinal = targets.at(-1)?.content.ordinal ?? input.afterOrdinal;
    return {
      planId: plan.planId,
      targetCount: plan.content.targetCount,
      afterOrdinal: input.afterOrdinal,
      targets,
      nextAfterOrdinal: lastOrdinal < plan.content.targetCount ? lastOrdinal : null,
    };
  }

  async persistInventory(
    unparsedInventory: AflTradeExternalDiscoveryInventory
  ): Promise<PersistedAflTradeExternalDiscoveryInventory> {
    const inventory = parseInventory(unparsedInventory);
    return this.client.transaction(async (transaction) => {
      await lock(transaction, `external-trade-discovery:${inventory.inventoryId}`);
      const prior = await storedInventory(transaction, inventory.inventoryId);
      if (prior) {
        if (!inventoryReplay(prior, inventory)) {
          throw new AflTradeExternalDiscoveryPersistenceError(
            'INVENTORY_CONFLICT',
            'Stored discovery inventory conflicts with its content-addressed identity.'
          );
        }
        return {
          inventoryId: inventory.inventoryId,
          linkCount: inventory.content.links.length,
          idempotentReplay: true,
        };
      }

      await transaction.query(
        `INSERT INTO outcome_external_trade_discovery_inventory
          (inventory_id,environment,provider,competition,source_capture_id,
           source_evidence_batch_id,source_content_sha256,source_url,from_year,through_year,
           link_count,discovered_at,finalized_at,inventory_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13::jsonb)`,
        [
          inventory.inventoryId,
          inventory.content.environment,
          inventory.content.provider,
          inventory.content.competition,
          inventory.content.sourceCaptureId,
          inventory.content.sourceEvidenceBatchId,
          inventory.content.sourceContentSha256,
          inventory.content.sourceUrl,
          inventory.content.fromYear,
          inventory.content.throughYear,
          inventory.content.links.length,
          inventory.content.discoveredAt,
          canonicalizeAflTradeJson(inventory),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_external_trade_discovery_link
          (inventory_id,ordinal,evidence_id,anchor_season_year,native_event_id,source_url,link_json)
         SELECT $1,item.ordinal,item.evidence_id,item.anchor_season_year,
                item.native_event_id,item.source_url,item.link_json
           FROM jsonb_to_recordset($2::jsonb) AS item(
             ordinal INTEGER, evidence_id TEXT, anchor_season_year INTEGER,
             native_event_id TEXT, source_url TEXT, link_json JSONB
           )`,
        [
          inventory.inventoryId,
          canonicalizeAflTradeJson(
            inventory.content.links.map((link) => ({
              ordinal: link.ordinal,
              evidence_id: link.evidenceId,
              anchor_season_year: link.anchorSeasonYear,
              native_event_id: link.nativeEventId,
              source_url: link.sourceUrl,
              link_json: link,
            }))
          ),
        ]
      );
      const finalized = await transaction.query(
        `UPDATE outcome_external_trade_discovery_inventory
            SET finalized_at=$2
          WHERE inventory_id=$1 AND finalized_at IS NULL`,
        [inventory.inventoryId, inventory.content.discoveredAt]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeExternalDiscoveryPersistenceError(
          'INVENTORY_CONFLICT',
          'Discovery inventory did not finalize exactly once.'
        );
      }
      return {
        inventoryId: inventory.inventoryId,
        linkCount: inventory.content.links.length,
        idempotentReplay: false,
      };
    });
  }

  async persistPlan(
    unparsedPlan: AflTradeExternalHistoricalCapturePlan
  ): Promise<PersistedAflTradeExternalHistoricalCapturePlan> {
    const plan = parsePlan(unparsedPlan);
    return this.client.transaction(async (transaction) => {
      await lock(transaction, `external-historical-capture-plan:${plan.planId}`);
      const prior = await storedPlan(transaction, plan.planId);
      if (prior) {
        if (!planReplay(prior, plan)) {
          throw new AflTradeExternalDiscoveryPersistenceError(
            'PLAN_CONFLICT',
            'Stored historical capture plan conflicts with its content-addressed identity.'
          );
        }
        return {
          planId: plan.planId,
          targetCount: plan.content.targetCount,
          idempotentReplay: true,
        };
      }

      const inventory = await storedInventory(transaction, plan.content.inventoryId);
      if (
        !inventory ||
        inventory.finalized_at === null ||
        sha256AflTradeCanonicalJson(parseInventory(inventory.inventory_json).content) !==
          plan.content.inventorySha256
      ) {
        throw new AflTradeExternalDiscoveryPersistenceError(
          'INVENTORY_NOT_FINALIZED',
          'Historical capture plan requires its exact finalized discovery inventory.'
        );
      }

      await transaction.query(
        `INSERT INTO outcome_external_historical_capture_plan
          (plan_id,inventory_id,environment,competition,from_year,through_year,target_count,
           target_set_sha256,planned_at,finalized_at,plan_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10::jsonb)`,
        [
          plan.planId,
          plan.content.inventoryId,
          plan.content.environment,
          plan.content.competition,
          plan.content.fromYear,
          plan.content.throughYear,
          plan.content.targetCount,
          plan.content.targetSetSha256,
          plan.content.plannedAt,
          canonicalizeAflTradeJson(plan),
        ]
      );
      for (const target of plan.content.targets) {
        await persistAflTradeExternalCaptureSchedule(
          transaction,
          target.content.schedule,
          plan.content.plannedAt
        );
      }
      await transaction.query(
        `INSERT INTO outcome_external_historical_capture_target
          (plan_id,ordinal,target_id,schedule_id,discovery_evidence_id,capability_id,
           anchor_season_year,source_url,target_json)
         SELECT $1,item.ordinal,item.target_id,item.schedule_id,item.discovery_evidence_id,
                item.capability_id,item.anchor_season_year,item.source_url,item.target_json
           FROM jsonb_to_recordset($2::jsonb) AS item(
             ordinal INTEGER, target_id TEXT, schedule_id TEXT, discovery_evidence_id TEXT,
             capability_id TEXT, anchor_season_year INTEGER, source_url TEXT, target_json JSONB
           )`,
        [
          plan.planId,
          canonicalizeAflTradeJson(
            plan.content.targets.map((target) => {
              const request = target.content.schedule.definition.requestTemplate;
              return {
                ordinal: target.content.ordinal,
                target_id: target.targetId,
                schedule_id: target.content.schedule.scheduleId,
                discovery_evidence_id: target.content.discoveryEvidenceId,
                capability_id: request.capabilityId,
                anchor_season_year: request.anchorSeasonYear,
                source_url: request.sourceUrl,
                target_json: target,
              };
            })
          ),
        ]
      );
      const finalized = await transaction.query(
        `UPDATE outcome_external_historical_capture_plan
            SET finalized_at=$2
          WHERE plan_id=$1 AND finalized_at IS NULL`,
        [plan.planId, plan.content.plannedAt]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeExternalDiscoveryPersistenceError(
          'PLAN_CONFLICT',
          'Historical capture plan did not finalize exactly once.'
        );
      }
      return {
        planId: plan.planId,
        targetCount: plan.content.targetCount,
        idempotentReplay: false,
      };
    });
  }
}
