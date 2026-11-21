import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import type { AflTradeArtifactRef } from '../src/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import { splitAflTradeStoreObjectKey } from '../src/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { createLocalAflTradeFileConditionalObjectStore } from '../src/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  planRetainedPlanSuccessor,
  RetainedPlanRefusal,
  retainedTargetFromCapture,
  type RetainedPlanCapture,
  type RetainedPlanTargetChange,
} from '../src/server/aflTradeIntelligence/development/localRetainedPlanSuccessor';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  aflTradeRetainedExternalCapturePlanSchema,
  type AflTradeRetainedExternalCapturePlan,
} from '../src/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Builds a successor retained capture plan from the plan behind a reconciliation candidate: each
 * new capture replaces the target with its capability, anchor season and source URL, or is added.
 * A dry run is the default and writes nothing; `--apply` persists and completes the plan. See the
 * runbook section "Building a successor retained plan".
 *
 * Usage:
 *   npm run outcomes:sources:build-retained-plan -- --from-candidate <external-reconciliation:...> \
 *     (--captures <source-capture:...,...> | --captures-file <path>) \
 *     [--scope-evidence <artifact:...,...>] [--apply]
 */

const VALUE_OPTIONS = new Set([
  '--from-candidate',
  '--captures',
  '--captures-file',
  '--scope-evidence',
]);
const LOCAL_STORE_ASSURANCE = 'local_non_production_filesystem';
// Requests allow at most 128 MiB (externalDraftTradeIngestion.ts); scope evidence is far smaller.
const MAXIMUM_ARTIFACT_BYTES = 128 * 1024 * 1024;

export interface BuildRetainedPlanRequest {
  candidateId: string;
  captureIds: string[];
  scopeEvidenceIds: string[];
  apply: boolean;
}

export type BuildRetainedPlanOutcome =
  | { status: 'refused'; reason: string }
  | {
      status: 'planned' | 'completed';
      predecessorPlanId: string;
      planId: string;
      plannedAt: string;
      targetCount: number;
      kept: number;
      replaced: RetainedPlanTargetChange[];
      added: RetainedPlanTargetChange[];
      completionId: string | null;
    };

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook section "Building a successor retained plan".`);
}

function idList(value: string, pattern: RegExp, label: string): string[] {
  const ids = value.split(/[\s,]+/u).filter((id) => id.length > 0);
  if (ids.length === 0) usage(`${label} names no IDs.`);
  for (const id of ids) if (!pattern.test(id)) usage(`${label} has a malformed ID: ${id}.`);
  return ids;
}

export function parseBuildRetainedPlanArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8')
): { databaseUrl: string; request: BuildRetainedPlanRequest } {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    if (name === '--apply') {
      if (apply) usage('--apply may be given once.');
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!VALUE_OPTIONS.has(name) || value === undefined || value.startsWith('--')) {
      usage(`Unexpected argument ${name}.`);
    }
    if (values.has(name)) usage(`${name} may be given once.`);
    values.set(name, value);
    index += 1;
  }
  const candidateId = values.get('--from-candidate');
  if (candidateId === undefined || !/^external-reconciliation:[0-9a-f]{64}$/u.test(candidateId)) {
    usage('--from-candidate must be a reconciliation candidate ID.');
  }
  const inline = values.get('--captures');
  const file = values.get('--captures-file');
  if ((inline === undefined) === (file === undefined)) {
    usage('Give exactly one of --captures or --captures-file.');
  }
  const captureIds = idList(
    inline ?? readText(file!),
    /^source-capture:[0-9a-f]{64}$/u,
    inline === undefined ? '--captures-file' : '--captures'
  );
  const scope = values.get('--scope-evidence');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    request: {
      candidateId,
      captureIds,
      scopeEvidenceIds:
        scope === undefined ? [] : idList(scope, /^artifact:[0-9a-f]{64}$/u, '--scope-evidence'),
      apply,
    },
  };
}

function instant(value: Date | string): string {
  return new Date(value).toISOString();
}

async function loadPredecessor(client: AflOutcomeSqlClient, candidateId: string) {
  const result = await client.query<{ completion_id: string | null; plan_json: unknown }>(
    `SELECT candidate.historical_completion_id AS completion_id, plan.plan_json
       FROM outcome_external_reconciliation_candidate candidate
       LEFT JOIN outcome_external_historical_capture_completion completion
         ON completion.completion_id=candidate.historical_completion_id
       LEFT JOIN outcome_external_historical_capture_plan plan ON plan.plan_id=completion.plan_id
      WHERE candidate.candidate_id=$1`,
    [candidateId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new RetainedPlanRefusal(`Candidate ${candidateId} does not exist.`);
  if (row.completion_id === null) {
    throw new RetainedPlanRefusal(`Candidate ${candidateId} has no historical completion.`);
  }
  const plan = aflTradeRetainedExternalCapturePlanSchema.safeParse(row.plan_json);
  if (!plan.success) {
    throw new RetainedPlanRefusal(
      `Completion ${row.completion_id} is not of a retained plan: ${plan.error.issues[0]?.message}`
    );
  }
  return plan.data;
}

async function loadCaptures(
  client: AflOutcomeSqlClient,
  captureIds: readonly string[]
): Promise<RetainedPlanCapture[]> {
  const result = await client.query<{
    capture_id: string;
    environment: string;
    manifest_json: unknown;
    batch_id: string | null;
    status: string | null;
    issue_count: number | null;
    finalized_at: Date | string | null;
  }>(
    `SELECT capture.capture_id, capture.environment::text AS environment, capture.manifest_json,
            batch.batch_id, batch.status, batch.issue_count, batch.finalized_at
       FROM outcome_source_capture capture
       LEFT JOIN outcome_external_evidence_batch batch ON batch.capture_id=capture.capture_id
      WHERE capture.capture_id=ANY($1::text[])`,
    [captureIds]
  );
  const rows = new Map(result.rows.map((row) => [row.capture_id, row]));
  return captureIds.map((captureId) => {
    const row = rows.get(captureId);
    if (row === undefined) throw new RetainedPlanRefusal(`Capture ${captureId} does not exist.`);
    if (
      row.batch_id === null ||
      row.status !== 'finalized' ||
      row.finalized_at === null ||
      row.issue_count !== 0
    ) {
      throw new RetainedPlanRefusal(`Capture ${captureId} has no finalized issue-free batch.`);
    }
    return {
      target: retainedTargetFromCapture({
        captureId,
        evidenceBatchId: row.batch_id,
        manifest: row.manifest_json,
      }),
      environment: row.environment,
      batchFinalizedAt: instant(row.finalized_at),
    };
  });
}

async function loadScopeEvidence(
  client: AflOutcomeSqlClient,
  artifactIds: readonly string[]
): Promise<AflTradeArtifactRef[]> {
  if (artifactIds.length === 0) return [];
  const result = await client.query<{
    artifact_id: string;
    content_sha256: string;
    storage_uri: string;
    media_type: string;
    byte_length: string | number;
    created_at: Date | string;
    artifact_class: string;
  }>(
    `SELECT artifact_id, content_sha256, storage_uri, media_type, byte_length, created_at,
            artifact_class::text AS artifact_class
       FROM outcome_artifact_custody WHERE artifact_id=ANY($1::text[])`,
    [artifactIds]
  );
  const rows = new Map(result.rows.map((row) => [row.artifact_id, row]));
  return artifactIds.map((artifactId) => {
    const row = rows.get(artifactId);
    if (row === undefined || row.artifact_class !== 'capture_metadata') {
      throw new RetainedPlanRefusal(`Scope evidence ${artifactId} is not capture metadata.`);
    }
    return {
      artifactId,
      contentSha256: row.content_sha256,
      storageUri: row.storage_uri,
      mediaType: row.media_type,
      byteLength: Number(row.byte_length),
      createdAt: instant(row.created_at),
    };
  });
}

/**
 * Everything the successor is built from. The database clock is read last, so every batch loaded
 * here was finalized before `plannedAt`.
 */
export async function loadRetainedPlanInputs(
  client: AflOutcomeSqlClient,
  request: Omit<BuildRetainedPlanRequest, 'apply'>
): Promise<{
  predecessor: AflTradeRetainedExternalCapturePlan;
  captures: RetainedPlanCapture[];
  scopeEvidence: AflTradeArtifactRef[];
  plannedAt: string;
}> {
  const predecessor = await loadPredecessor(client, request.candidateId);
  const captures = await loadCaptures(client, request.captureIds);
  const scopeEvidence = await loadScopeEvidence(client, request.scopeEvidenceIds);
  const clock = await client.query<{ at: Date | string }>(
    `SELECT date_trunc('milliseconds', now()) AS at`
  );
  return { predecessor, captures, scopeEvidence, plannedAt: instant(clock.rows[0]!.at) };
}

/**
 * Reads each artifact from the registered local non-production store where its custody location
 * says the bytes live. A location key is <repository path>/<repository key>, and repository paths
 * may be nested, so the key is split at the repository's own layout.
 */
export function createLocatedArtifactReader(client: AflOutcomeSqlClient) {
  const stores = new Map<
    string,
    ReturnType<typeof createLocalAflTradeFileConditionalObjectStore>
  >();
  return {
    async read(reference: AflTradeArtifactRef): Promise<Uint8Array> {
      const located = await client.query<{
        object_key: string;
        artifact_class: string;
        root_locator: string;
        assurance: string;
        environment: string;
      }>(
        `SELECT location.object_key, custody.artifact_class::text AS artifact_class,
                store.root_locator, store.assurance, store.environment::text AS environment
           FROM outcome_artifact_custody_location location
           JOIN outcome_artifact_custody custody ON custody.artifact_id=location.artifact_id
           JOIN outcome_artifact_store store ON store.store_id=location.store_id
          WHERE location.artifact_id=$1`,
        [reference.artifactId]
      );
      const row = located.rows[0];
      if (row === undefined) throw new Error(`Artifact ${reference.artifactId} is not located.`);
      if (row.assurance !== LOCAL_STORE_ASSURANCE || row.environment !== 'non_production') {
        throw new Error(`Artifact ${reference.artifactId} is not in a local non-production store.`);
      }
      if (row.artifact_class !== 'raw_source' && row.artifact_class !== 'capture_metadata') {
        throw new Error(`Artifact ${reference.artifactId} is ${row.artifact_class}.`);
      }
      const sha = reference.contentSha256;
      const split = splitAflTradeStoreObjectKey(row.object_key);
      if (
        split === null ||
        split.repositoryKey !==
          `${LOCAL_STORE_ASSURANCE}/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`
      ) {
        throw new Error(`Artifact ${reference.artifactId} is located at an unexpected key.`);
      }
      // Read the stored object under its own recorded identity, as the 2025 plans were persisted;
      // verifyRetainedPlan and persistRetainedPlan then check the bytes against the plan's reference.
      // An older object's stored createdAt can differ from the reference that cites it, so an exact
      // identity match would refuse bytes that hash correctly.
      const root = resolve(row.root_locator, split.repositoryPath);
      let store = stores.get(root);
      if (store === undefined) {
        store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });
        stores.set(root, store);
      }
      const identity = await store.headExact({ objectKey: split.repositoryKey });
      if (identity === null) throw new Error(`Artifact ${reference.artifactId} bytes are missing.`);
      if (identity.byteLength > MAXIMUM_ARTIFACT_BYTES)
        throw new Error(`Artifact ${reference.artifactId} exceeds the read bound.`);
      const { bytes } = await store.readExactBounded({
        objectKey: split.repositoryKey,
        versionId: identity.versionId,
        eTag: identity.eTag,
        expectedByteLength: identity.byteLength,
        expectedMediaType: identity.mediaType,
        expectedChecksumSha256: identity.checksumSha256,
        expectedMetadata: identity.metadata,
        maximumBytes: MAXIMUM_ARTIFACT_BYTES,
      });
      return bytes;
    },
  };
}

/**
 * Proves, without writing, what `persistRetainedPlan` will check: every source and scope artifact
 * reads back exactly, and the database accepts the plan as current.
 */
async function verifyRetainedPlan(
  client: AflOutcomeSqlClient,
  plan: AflTradeRetainedExternalCapturePlan,
  artifacts: { read(reference: AflTradeArtifactRef): Promise<Uint8Array> }
): Promise<void> {
  for (const reference of [
    ...plan.content.scopeEvidence,
    ...plan.content.targets.map((target) => target.content.sourceArtifact),
  ]) {
    let bytes: Uint8Array;
    try {
      bytes = await artifacts.read(reference);
    } catch (error) {
      throw new RetainedPlanRefusal(error instanceof Error ? error.message : String(error));
    }
    if (
      bytes.byteLength !== reference.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== reference.contentSha256
    ) {
      throw new RetainedPlanRefusal(`Artifact ${reference.artifactId} bytes differ.`);
    }
  }
  const planJson = canonicalizeAflTradeJson(plan);
  const current = await client.query<{ valid: boolean }>(
    `SELECT outcome_external_retained_plan_is_current($1::jsonb, clock_timestamp()) AS valid`,
    [planJson]
  );
  if (current.rows[0]?.valid === true) return;
  // Name what failed where the per-target and per-artifact checks can.
  const failing = await client.query<{ failing: string }>(
    `SELECT 'target '||(target->'content'->>'ordinal')||' ('||(target->'content'->>'captureId')||')' AS failing
       FROM jsonb_array_elements($1::jsonb->'content'->'targets') AS targets(target)
      WHERE NOT outcome_external_retained_target_is_current(
        target, $1::jsonb->'content'->>'environment', $1::jsonb->'content'->>'competition',
        clock_timestamp())
     UNION ALL
     SELECT 'scope evidence '||(ref->>'artifactId')
       FROM jsonb_array_elements($1::jsonb->'content'->'scopeEvidence') AS refs(ref)
      WHERE NOT outcome_external_retained_artifact_current(
        ref, $1::jsonb->'content'->>'environment', 'capture_metadata', clock_timestamp())`,
    [planJson]
  );
  const names = failing.rows.map((row) => row.failing);
  throw new RetainedPlanRefusal(
    `The database does not accept the plan as current${names.length === 0 ? '.' : `: ${names.join(', ')}.`}`
  );
}

export async function buildRetainedPlan(
  client: AflOutcomeSqlClient,
  request: BuildRetainedPlanRequest,
  artifacts: { read(reference: AflTradeArtifactRef): Promise<Uint8Array> }
): Promise<BuildRetainedPlanOutcome> {
  let successor: ReturnType<typeof planRetainedPlanSuccessor>;
  let predecessorPlanId: string;
  try {
    const inputs = await loadRetainedPlanInputs(client, request);
    predecessorPlanId = inputs.predecessor.planId;
    successor = planRetainedPlanSuccessor(inputs);
    await verifyRetainedPlan(client, successor.plan, artifacts);
  } catch (error) {
    if (error instanceof RetainedPlanRefusal) return { status: 'refused', reason: error.message };
    throw error;
  }
  const { plan, kept, replaced, added } = successor;
  let completionId: string | null = null;
  if (request.apply) {
    await new PostgresAflTradeExternalDiscoveryRepository(client).persistRetainedPlan(
      plan,
      artifacts
    );
    try {
      const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
        client
      ).completeRetainedPlan(plan.planId);
      completionId = completion.completionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Plan ${plan.planId} was persisted but not completed: ${message}`, {
        cause: error,
      });
    }
  }
  return {
    status: request.apply ? 'completed' : 'planned',
    predecessorPlanId,
    planId: plan.planId,
    plannedAt: plan.content.plannedAt,
    targetCount: plan.content.targetCount,
    kept,
    replaced,
    added,
    completionId,
  };
}

export async function runBuildRetainedPlanCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<BuildRetainedPlanOutcome> {
  const parsed = parseBuildRetainedPlanArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const outcome = await buildRetainedPlan(
      client,
      parsed.request,
      createLocatedArtifactReader(client)
    );
    write(JSON.stringify({ candidateId: parsed.request.candidateId, ...outcome }));
    return outcome;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runBuildRetainedPlanCommand({ argv: process.argv.slice(2), env: process.env })
    .then((outcome) => {
      if (outcome.status === 'refused') process.exitCode = 2;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Retained plan build stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
