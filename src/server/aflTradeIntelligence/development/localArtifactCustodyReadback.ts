import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { AflTradeConditionalObjectStore } from '../artifacts/conditionalObjectStore';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradeFileConditionalObjectStore } from './localFileConditionalObjectStore';

const LOCAL_STORE_ASSURANCE = 'local_non_production_filesystem';
const FULL_CLASS = 'raw_source';

export interface AflTradeArtifactReadbackRun {
  runId: string;
  environment: string;
  storeId: string;
  startedAt: string;
  finishedAt: string;
  rowsChecked: number;
  failures: number;
  failingArtifactIds: string[];
  checkedByClass: Record<string, number>;
  samplePolicy: { fullClasses: string[]; otherClassFraction: number };
}

/**
 * Reads located evidence back from a registered local non-production store and records one
 * append-only run: every located raw_source row in full and a random sample of the other located
 * classes. Each row is read through the store's own envelope reader, which decodes the bytes and
 * verifies their SHA-256 and length; the row fails when the object is missing or unreadable, or its
 * verified identity differs from the custody row. Unlocated custody is outside the run.
 */
export async function readBackLocalAflTradeArtifactCustody(input: {
  client: AflOutcomeSqlClient;
  storeId: string;
  otherClassFraction?: number;
  onProgress?: (checked: number, total: number) => void;
}): Promise<AflTradeArtifactReadbackRun> {
  const fraction = input.otherClassFraction ?? 0.05;
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new RangeError('The other-class sample fraction must be between 0 and 1.');
  }
  const store = (
    await input.client.query<{ environment: string; assurance: string; root_locator: string }>(
      `SELECT environment::text AS environment, assurance, root_locator
         FROM outcome_artifact_store WHERE store_id=$1`,
      [input.storeId]
    )
  ).rows[0];
  if (store === undefined) throw new Error(`Artifact store ${input.storeId} is not registered.`);
  if (store.assurance !== LOCAL_STORE_ASSURANCE || store.environment !== 'non_production') {
    throw new Error(`Artifact store ${input.storeId} is not a local non-production store.`);
  }
  const startedAt = new Date().toISOString();
  const rows = (
    await input.client.query<{
      artifact_id: string;
      artifact_class: string;
      content_sha256: string;
      byte_length: string;
      object_key: string;
    }>(
      `SELECT custody.artifact_id,custody.artifact_class::text AS artifact_class,
              custody.content_sha256,custody.byte_length::text AS byte_length,location.object_key
         FROM outcome_artifact_custody_location location
         JOIN outcome_artifact_custody custody USING (artifact_id)
        WHERE location.store_id=$1
          AND (custody.artifact_class::text=$2 OR random()<$3::float8)
        ORDER BY custody.artifact_id`,
      [input.storeId, FULL_CLASS, fraction]
    )
  ).rows;
  // A location key is <repository>/<repository key>; each repository's objects live under its own
  // directory in the store root.
  const root = resolve(store.root_locator);
  const repositories = new Map<string, AflTradeConditionalObjectStore>();
  const repository = (id: string) => {
    let found = repositories.get(id);
    if (found === undefined) {
      found = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: resolve(root, id) });
      repositories.set(id, found);
    }
    return found;
  };
  const failing: string[] = [];
  const checkedByClass: Record<string, number> = {};
  for (const [index, row] of rows.entries()) {
    checkedByClass[row.artifact_class] = (checkedByClass[row.artifact_class] ?? 0) + 1;
    const separator = row.object_key.indexOf('/');
    let exact = false;
    if (separator > 0) {
      try {
        const identity = await repository(row.object_key.slice(0, separator)).headExact({
          objectKey: row.object_key.slice(separator + 1),
        });
        exact =
          identity !== null &&
          identity.checksumSha256 === row.content_sha256 &&
          String(identity.byteLength) === row.byte_length;
      } catch {
        exact = false;
      }
    }
    if (!exact) failing.push(row.artifact_id);
    input.onProgress?.(index + 1, rows.length);
  }
  const run: AflTradeArtifactReadbackRun = {
    runId: `artifact-readback-run:${randomUUID()}`,
    environment: store.environment,
    storeId: input.storeId,
    startedAt,
    finishedAt: new Date().toISOString(),
    rowsChecked: rows.length,
    failures: failing.length,
    failingArtifactIds: failing,
    checkedByClass,
    samplePolicy: { fullClasses: [FULL_CLASS], otherClassFraction: fraction },
  };
  await input.client.query(
    `INSERT INTO outcome_artifact_readback_run
      (run_id,environment,store_id,started_at,finished_at,rows_checked,failures,
       failing_artifact_ids,checked_by_class,sample_policy)
     VALUES ($1,$2::"OutcomeEnvironment",$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
    [
      run.runId,
      run.environment,
      run.storeId,
      run.startedAt,
      run.finishedAt,
      run.rowsChecked,
      run.failures,
      JSON.stringify(run.failingArtifactIds),
      JSON.stringify(run.checkedByClass),
      JSON.stringify(run.samplePolicy),
    ]
  );
  return run;
}
