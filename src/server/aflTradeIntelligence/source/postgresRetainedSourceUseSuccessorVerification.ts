import { createHash } from 'node:crypto';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeSourceRightsProposalSchema } from './sourceRights';
import type { AflTradeRetainedSourceUseSuccessor } from './retainedSourceUseSuccessor';

interface ReleaseRow {
  environment: string;
  manifest_json: unknown;
}

interface CaptureRow {
  capture_id: string;
  membership_json: unknown;
  record_sha256: string;
  record_canonical_json: string | null;
  source_snapshot_id: string;
  status: string;
  environment: string;
  capture_manifest_json: unknown;
  rights_content_json: unknown;
  gate_current: boolean;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Read-only custody check. It does not admit the successor or grant training/public authority. */
export async function verifyPostgresAflTradeRetainedSourceUseSuccessor(
  client: AflOutcomeSqlClient,
  successor: AflTradeRetainedSourceUseSuccessor
): Promise<{ successorId: string; releaseId: string; captureCount: number; rightsCount: number }> {
  const content = successor.content;
  if (
    content.schemaVersion !== 'afl-trade-retained-source-use-successor/v1' ||
    content.state !== 'candidate_requires_durable_authentication' ||
    successor.successorId !== createAflTradeContentAddress('retained-source-use-successor', content)
  ) {
    throw new TypeError('Retained source-use successor identity is invalid.');
  }
  const release = await client.query<ReleaseRow>(
    `SELECT environment,manifest_json FROM outcome_release_manifest WHERE release_id=$1`,
    [content.factualReleaseId]
  );
  const releaseRow = release.rows[0];
  const manifest = releaseRow?.manifest_json as
    { content?: { sourceCaptures?: unknown; sourceCaptureSetSha256?: unknown } } | undefined;
  if (
    release.rows.length !== 1 ||
    releaseRow?.environment !== 'non_production' ||
    manifest?.content?.sourceCaptureSetSha256 !== content.sourceCaptureSetSha256 ||
    !exact(manifest?.content?.sourceCaptures, content.captureBindings)
  ) {
    throw new TypeError('Retained source-use successor does not match the exact factual release.');
  }

  const rows = await client.query<CaptureRow>(
    `SELECT member.capture_id,member.membership_json,member.record_sha256,
            member.record_canonical_json,capture.source_snapshot_id,capture.status,
            capture.environment,capture.manifest_json AS capture_manifest_json,
            rights.content_json AS rights_content_json,
            (gate.gate='gate_0a_permission_to_evaluate'
             AND gate.environment='non_production' AND gate.state='approved'
             AND gate.effective_at<=clock_timestamp() AND gate.revalidate_at>clock_timestamp()
             AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision next
                              WHERE next.supersedes_decision_id=gate.decision_id)) AS gate_current
       FROM outcome_release_source_capture member
       JOIN outcome_source_capture capture ON capture.capture_id=member.capture_id
       JOIN outcome_source_rights_proposal rights
         ON rights.rights_artifact_id=member.membership_json->>'rightsArtifactId'
       JOIN outcome_gate_decision gate
         ON gate.decision_id=member.membership_json->>'gateDecisionId'
      WHERE member.release_id=$1 ORDER BY member.capture_id`,
    [content.factualReleaseId]
  );
  if (rows.rows.length !== content.captureBindings.length) {
    throw new TypeError('Retained source-use successor capture membership is incomplete.');
  }
  const originalRights = new Map(
    content.originalRights.map((rights) => [rights.rightsArtifactId, rights])
  );
  const seenRights = new Set<string>();
  for (const [index, row] of rows.rows.entries()) {
    const binding = content.captureBindings[index];
    if (
      binding === undefined ||
      row.capture_id !== binding.captureId ||
      !exact(row.membership_json, binding) ||
      row.record_sha256 !== binding.recordSha256 ||
      (row.record_canonical_json !== null &&
        (sha256(row.record_canonical_json) !== row.record_sha256 ||
          !exact(JSON.parse(row.record_canonical_json), row.capture_manifest_json))) ||
      row.source_snapshot_id !== binding.sourceSnapshotId ||
      row.status !== 'approved' ||
      row.environment !== 'non_production' ||
      !row.gate_current
    ) {
      throw new TypeError('Retained source-use successor capture custody is unavailable.');
    }
    const rights = aflTradeSourceRightsProposalSchema.parse(row.rights_content_json);
    const original = originalRights.get(binding.rightsArtifactId);
    if (
      rights.rightsArtifactId !== binding.rightsArtifactId ||
      original === undefined ||
      rights.content.provider !== original.provider ||
      rights.content.dataset !== original.dataset ||
      !exact(rights.content.fields, original.fields)
    ) {
      throw new TypeError('Retained source-use successor changes the original field scope.');
    }
    seenRights.add(rights.rightsArtifactId);
  }
  if (seenRights.size !== originalRights.size) {
    throw new TypeError('Retained source-use successor rights membership is incomplete.');
  }
  return {
    successorId: successor.successorId,
    releaseId: content.factualReleaseId,
    captureCount: rows.rows.length,
    rightsCount: seenRights.size,
  };
}
