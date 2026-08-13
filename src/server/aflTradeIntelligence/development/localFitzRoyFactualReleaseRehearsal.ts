import { Buffer } from 'node:buffer';

import { strToU8, zipSync } from 'fflate';

import type { AflDraftTradeOutcomeListItem } from '@/types/aflDraftTradeOutcomes';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
  type AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import { createAflTradeFactualReleaseCandidate } from '../outcomes/factualReleaseCandidateContracts';
import { createAflTradeFactualProjectionItemSet } from '../outcomes/factualProjectionItemSetContracts';
import {
  createAflDraftTradeOutcomeActivationAuthorization,
  createAflDraftTradeOutcomeFactualProjectionManifest,
  createAflDraftTradeOutcomeFactualReleaseManifest,
} from '../outcomes/outcomeReleaseContracts';
import { PostgresAflTradeFactualProjectionItemSetRepository } from '../outcomes/postgresFactualProjectionItemSetRepository';
import { PostgresAflTradeFactualReleaseCandidateWriter } from '../outcomes/postgresFactualReleaseCandidateRepository';
import {
  createPostgresAflDraftTradeOutcomeReleaseRepository,
  type AflOutcomeSqlClient,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '../outcomes/outcomeReadService';

import {
  prepareLocalAflTradeFitzRoyFactualReleaseCandidate,
  type PreparedLocalAflTradeFitzRoyFactualReleaseCandidate,
} from './localFitzRoyFactualRehearsal';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from './localFitzRoyFactualRehearsalFixture';

const ENVIRONMENT = 'non_production' as const;
const ACTOR = 'local-fitzroy-factual-release-rehearsal';
const PLAYER_ID = 'afl-player:local-rehearsal';
const CLUB_ID = 'afl-club:local-rehearsal';

const lifecycleTimes = {
  baseline: {
    projection: '2026-08-12T00:05:10.000Z',
    register: '2026-08-12T00:05:20.000Z',
    validate: '2026-08-12T00:05:30.000Z',
    approve: '2026-08-12T00:05:40.000Z',
    activate: '2026-08-12T00:05:50.000Z',
  },
  replacement: {
    projection: '2026-08-12T00:06:10.000Z',
    register: '2026-08-12T00:06:20.000Z',
    validate: '2026-08-12T00:06:30.000Z',
    approve: '2026-08-12T00:06:40.000Z',
    activate: '2026-08-12T00:06:50.000Z',
  },
} as const;

const recoveryTimes = {
  rollback: {
    validate: '2026-08-12T00:07:10.000Z',
    approve: '2026-08-12T00:07:20.000Z',
    activate: '2026-08-12T00:07:30.000Z',
  },
  withdraw: '2026-08-12T00:07:40.000Z',
  recovery: {
    validate: '2026-08-12T00:07:50.000Z',
    approve: '2026-08-12T00:08:00.000Z',
    activate: '2026-08-12T00:08:10.000Z',
  },
} as const;

type Generation = keyof typeof lifecycleTimes;

export interface LocalAflTradeFactualReleaseSelection {
  releaseId: string;
  projectionId: string;
}

export interface LocalAflTradeFactualReleaseRehearsalReceipt {
  environment: typeof ENVIRONMENT;
  baseline: LocalAflTradeFactualReleaseSelection;
  replacement: LocalAflTradeFactualReleaseSelection;
  rollbackSelection: LocalAflTradeFactualReleaseSelection;
  withdrawalSelection: null;
  recoverySelection: LocalAflTradeFactualReleaseSelection;
  activeSelection: LocalAflTradeFactualReleaseSelection;
}

function reference(prefix: string, content: unknown): string {
  return createAflTradeContentAddress(prefix, content);
}

function shaFromId(id: string): string {
  const match = /^[^:]+:([a-f0-9]{64})$/.exec(id);
  if (!match) throw new TypeError('The local release rehearsal requires content-addressed IDs.');
  return match[1]!;
}

function lifecycleEvidence(action: string, releaseId: string): string {
  return reference('artifact', { action, releaseId, rehearsal: 'local-fitzroy-factual-release' });
}

function releaseAssetVersionId(eventVersionId: string): string {
  return reference('event-asset-version', {
    eventVersionId,
    playerId: PLAYER_ID,
    clubId: CLUB_ID,
  });
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function xmlText(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function workbookBytes(rows: readonly (readonly (string | number)[])[]): Uint8Array {
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => {
            const cell = `${columnName(columnIndex)}${rowIndex + 1}`;
            return typeof value === 'number'
              ? `<c r="${cell}"><v>${value}</v></c>`
              : `<c r="${cell}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
          })
          .join('')}</row>`
    )
    .join('');
  const xml = (value: string) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${value}`);
  return zipSync(
    {
      '[Content_Types].xml': xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
      ),
      '_rels/.rels': xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
      'xl/workbook.xml': xml(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Factual release" sheetId="1" r:id="rId1"/></sheets></workbook>'
      ),
      'xl/_rels/workbook.xml.rels': xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      ),
      'xl/worksheets/sheet1.xml': xml(
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
      ),
    },
    { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') }
  );
}

export function createLocalAflTradeFactualReleaseExportBytes(input: {
  releaseId: string;
  publicItems: readonly AflDraftTradeOutcomeListItem[];
}): { json: Uint8Array; csv: Uint8Array; xlsx: Uint8Array } {
  const rows = input.publicItems.map((item) => {
    const value = (metric: 'games' | 'goals') =>
      item.checks.find((check) => check.metric === metric)?.observedValue ?? '';
    return [item.player.displayName, item.clubName, item.year, value('games'), value('goals')] as const;
  });
  const table = [
    ['releaseId', input.releaseId],
    ['player', 'club', 'season', 'games', 'goals'],
    ...rows,
  ] as const;
  return {
    json: Buffer.from(
      canonicalizeAflTradeJson({
        schemaVersion: 'afl-draft-trade-outcome-export/v1',
        releaseId: input.releaseId,
        items: input.publicItems,
      })
    ),
    csv: Buffer.from(table.map((row) => row.map(csvCell).join(',')).join('\n')),
    xlsx: workbookBytes(table),
  };
}

function createPublicationGateDecision(input: {
  gate: Extract<AflTradeGateCode, 'gate_4_publication_api_readiness' | 'gate_5_comprehension_accessibility'>;
  generation: Generation;
  decidedAt: string;
  affectedArtifacts: readonly AflTradeGovernedArtifactRef[];
}) {
  const decisionKey = `local-fitzroy-${input.generation}-${input.gate}`;
  const authorityEvidenceId = reference('artifact', {
    decisionKey,
    authority: 'local-non-production-reviewer',
  });
  const scope = {
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    description: 'Disposable local fitzRoy factual-release rehearsal only.',
    dimensions: [
      { name: 'environment', values: [ENVIRONMENT] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2026'] },
    ],
    exclusions: ['Production authority', 'Hosted deployment', 'Live source access'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey,
    version: 1,
    environment: ENVIRONMENT,
    scope,
    proposal: 'Admit this exact reconciled local factual release and projection pair.',
    alternativesConsidered: ['Keep the disposable local scope on its previous release.'],
    accountableOwner: ACTOR,
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [authorityEvidenceId],
    affectedArtifacts: [...input.affectedArtifacts],
    proposedAt: input.decidedAt,
    proposedBy: ACTOR,
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: reference('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: input.gate,
    decisionKey,
    version: 1,
    environment: ENVIRONMENT,
    scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: ACTOR,
    decidedBy: ACTOR,
    reviewers: [],
    authorityEvidenceIds: [authorityEvidenceId],
    conditionResults: [],
    rationale: 'Exact local parity and release evidence passed inside disposable PostgreSQL.',
    limitations: ['Non-production local rehearsal authority only.'],
    decidedAt: input.decidedAt,
    effectiveAt: input.decidedAt,
    revalidateAt: '2027-08-12T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: [...input.affectedArtifacts],
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: reference('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

interface PrivateCaptureRow {
  attempt_id: string;
  source_artifact_id: string;
  environment: string;
  provider: string;
  dataset: string;
  dataset_version: string;
  access_mechanism: string;
  capability_id: string | null;
  competition: string;
  anchor_season_year: number;
  effective_at: string | Date;
  captured_at: string | Date;
  manifest_json: unknown;
  attempt_evidence_artifact_id: string | null;
  attempt_started_at: string | Date;
  attempt_completed_at: string | Date | null;
  attempt_json: unknown;
}

async function promotePrivateCaptureForRelease(
  client: AflOutcomeSqlClient,
  prepared: PreparedLocalAflTradeFitzRoyFactualReleaseCandidate,
  generation: Generation
): Promise<PreparedLocalAflTradeFitzRoyFactualReleaseCandidate> {
  const privateCandidate = prepared.candidate;
  const privateMember = privateCandidate.content.members.sourceCaptures[0];
  if (!privateMember || privateCandidate.content.members.sourceCaptures.length !== 1) {
    throw new TypeError('The local release promotion requires exactly one private capture.');
  }
  const approvalDecisionId = reference('review-decision', {
    privateCaptureId: privateMember.captureId,
    factualRunId: prepared.receipt.factualRunId,
    purpose: 'local-factual-release-capture-approval',
  });
  const promotedSnapshotId = reference('source-snapshot', {
    privateSourceSnapshotId: privateMember.sourceSnapshotId,
    approvalDecisionId,
  });
  const promotedAttemptId = reference('source-capture-attempt', {
    privateCaptureId: privateMember.captureId,
    promotedSnapshotId,
    approvalDecisionId,
  });
  const promotedCaptureId = reference('source-capture', {
    promotedSnapshotId,
    promotedAttemptId,
    approvalDecisionId,
  });
  await client.transaction(async (transaction) => {
    const source = await transaction.query<PrivateCaptureRow>(
      `SELECT capture.attempt_id,capture.source_artifact_id,capture.environment::text,
              capture.provider,capture.dataset,capture.dataset_version,capture.access_mechanism,
              capture.capability_id,capture.competition,capture.anchor_season_year,
              capture.effective_at,capture.captured_at,capture.manifest_json,
              attempt.evidence_artifact_id AS attempt_evidence_artifact_id,
              attempt.started_at AS attempt_started_at,
              attempt.completed_at AS attempt_completed_at,attempt.attempt_json
         FROM outcome_source_capture capture
         JOIN outcome_source_capture_attempt attempt USING (attempt_id)
        WHERE capture.capture_id=$1
        FOR KEY SHARE`,
      [privateMember.captureId]
    );
    const row = source.rows[0];
    if (!row || source.rows.length !== 1 || row.environment !== ENVIRONMENT) {
      throw new TypeError('The private capture is unavailable in the non-production scope.');
    }
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'source_capture',$2,'approved',$3,$4::jsonb,$5,$6)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        approvalDecisionId,
        privateMember.captureId,
        'Approve an immutable release-specific view of the issue-free local capture.',
        canonicalizeAflTradeJson({
          environment: ENVIRONMENT,
          factBatchId: prepared.receipt.factBatchId,
          factualRunId: prepared.receipt.factualRunId,
        }),
        ACTOR,
        privateCandidate.content.createdAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture_attempt
        (attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
         started_at,completed_at,attempt_json)
       VALUES ($1,$2,$3,$4,$5,$6,'captured',$7,$8,$9::jsonb)
       ON CONFLICT (attempt_id) DO NOTHING`,
      [
        promotedAttemptId,
        row.environment,
        row.provider,
        row.dataset,
        row.capability_id,
        row.attempt_evidence_artifact_id,
        row.attempt_started_at,
        row.attempt_completed_at,
        canonicalizeAflTradeJson({
          privateAttemptId: row.attempt_id,
          privateCaptureId: privateMember.captureId,
          approvalDecisionId,
          evidence: row.attempt_json,
        }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture
        (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
         dataset_version,access_mechanism,capability_id,competition,anchor_season_year,
         effective_at,captured_at,status,manifest_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'approved',$15::jsonb)
       ON CONFLICT (capture_id) DO NOTHING`,
      [
        promotedCaptureId,
        promotedAttemptId,
        promotedSnapshotId,
        row.source_artifact_id,
        row.environment,
        row.provider,
        row.dataset,
        row.dataset_version,
        row.access_mechanism,
        row.capability_id,
        row.competition,
        row.anchor_season_year,
        row.effective_at,
        row.captured_at,
        canonicalizeAflTradeJson({
          privateCaptureId: privateMember.captureId,
          approvalDecisionId,
          evidence: row.manifest_json,
        }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture_season (capture_id,competition,season_year)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [promotedCaptureId, row.competition, row.anchor_season_year]
    );
  });

  const promotedSourceMember = {
    ...privateMember,
    recordSha256: sha256AflTradeCanonicalJson({
      privateCaptureId: privateMember.captureId,
      promotedCaptureId,
      approvalDecisionId,
    }),
    captureId: promotedCaptureId,
    sourceSnapshotId: promotedSnapshotId,
  };
  const promotedEventId = reference('outcome-event', { promotedCaptureId });
  const promotedEventVersionId = reference('outcome-event-version', {
    promotedEventId,
    promotedCaptureId,
  });
  const promotedSpellId = reference('acquisition-spell', {
    playerId: PLAYER_ID,
    clubId: CLUB_ID,
    acquisition: 'local-fitzroy-factual-release',
  });
  const promotedSpellVersionId = reference('acquisition-spell-version', {
    promotedSpellId,
    promotedEventVersionId,
    generation,
  });
  const approvalMember = {
    ordinal: 0,
    recordSha256: sha256AflTradeCanonicalJson({ approvalDecisionId }),
    recordedAt: privateCandidate.content.createdAt,
    decisionId: approvalDecisionId,
    subjectType: 'source_capture',
  };
  const reviewDecisions = [
    ...privateCandidate.content.members.reviewDecisions,
    approvalMember,
  ]
    .sort((left, right) => left.decisionId.localeCompare(right.decisionId))
    .map((member, index) => ({ ...member, ordinal: index + 1 }));
  const members = {
    ...privateCandidate.content.members,
    sourceCaptures: [{ ...promotedSourceMember, ordinal: 1 }],
    eventVersions: privateCandidate.content.members.eventVersions.map((member) => ({
      ...member,
      eventId: promotedEventId,
      eventVersionId: promotedEventVersionId,
      recordSha256: sha256AflTradeCanonicalJson({
        promotedEventId,
        promotedEventVersionId,
        promotedCaptureId,
      }),
    })),
    acquisitionSpells: privateCandidate.content.members.acquisitionSpells.map((member) => ({
      ...member,
      spellId: promotedSpellId,
      spellVersionId: promotedSpellVersionId,
      recordSha256: sha256AflTradeCanonicalJson({
        promotedSpellId,
        promotedSpellVersionId,
        promotedEventVersionId,
      }),
    })),
    reviewDecisions,
  };
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const sourceSnapshotSet = {
    id: reference('source-snapshot-set', { promotedSnapshotId }),
    sha256: '',
  };
  sourceSnapshotSet.sha256 = shaFromId(sourceSnapshotSet.id);
  const privateRelease = privateCandidate.content.targetReleaseManifest;
  const release = createAflDraftTradeOutcomeFactualReleaseManifest({
    ...privateRelease.content,
    sourceSnapshotSetId: sourceSnapshotSet.id,
    sourceRightsBindings: privateRelease.content.sourceRightsBindings.map((binding) => ({
      ...binding,
      sourceSnapshotId: promotedSnapshotId,
    })),
    sourceMemberSetSha256: memberSetSha256,
  });
  const counts = Object.fromEntries(
    Object.entries(members).map(([kind, values]) => [kind, values.length])
  ) as typeof privateCandidate.content.counts;
  const candidate = createAflTradeFactualReleaseCandidate({
    ...privateCandidate.content,
    targetRelease: { id: release.releaseId, sha256: shaFromId(release.releaseId) },
    targetReleaseManifest: release,
    sourceSnapshotSet,
    members,
    memberSetSha256,
    counts,
  });
  return {
    receipt: {
      ...prepared.receipt,
      captureId: promotedCaptureId,
      candidateId: candidate.candidateId,
      idempotentReplay: false,
    },
    candidate,
  };
}

async function ensureCandidateParents(
  client: AflOutcomeSqlClient,
  prepared: PreparedLocalAflTradeFitzRoyFactualReleaseCandidate,
  generation: Generation
): Promise<void> {
  const candidate = prepared.candidate;
  const captureId = candidate.content.members.sourceCaptures[0]?.captureId;
  const event = candidate.content.members.eventVersions[0];
  const spell = candidate.content.members.acquisitionSpells[0];
  if (!captureId || !event || !spell) {
    throw new TypeError(
      'The local release rehearsal requires one capture, event, and acquisition spell.'
    );
  }
  const assetVersionId = releaseAssetVersionId(event.eventVersionId);
  const games = await readReconciledValues(client, prepared.receipt.factualRunId);
  const importRunId = reference('import-run', { captureId, purpose: 'local-release-parent' });
  const importRowId = reference('import-row', {
    importRunId,
    eventVersionId: event.eventVersionId,
  });
  const importPartitionId = reference('import-partition', {
    importRunId,
    competition: 'AFLM',
    seasonYear: 2026,
  });
  const rowSha256 = sha256AflTradeCanonicalJson({
    importRunId,
    eventVersionId: event.eventVersionId,
  });
  await client.transaction(async (transaction) => {
    const playerResolution = await transaction.query<{ player_identity_id: string | null }>(
      `SELECT player_identity_id
         FROM outcome_provider_player_resolution
        WHERE player_id=$1
        ORDER BY revision DESC
        LIMIT 1`,
      [PLAYER_ID]
    );
    const playerIdentityId = playerResolution.rows[0]?.player_identity_id;
    if (!playerIdentityId) {
      throw new TypeError('The local event asset requires its reviewed canonical player identity.');
    }
    await transaction.query(
      `INSERT INTO outcome_import_run
        (import_run_id,capture_id,import_kind,parser_version,started_at,completed_at,status,manifest_json)
       VALUES ($1,$2,'local_factual_release_parent','local-rehearsal/v1',$3,$3,'approved',$4::jsonb)
       ON CONFLICT (import_run_id) DO NOTHING`,
      [importRunId, captureId, candidate.content.createdAt, canonicalizeAflTradeJson({ captureId })]
    );
    await transaction.query(
      `INSERT INTO outcome_import_row
        (import_row_id,import_run_id,source_locator,source_ordinal,record_kind,row_sha256,
         parse_status,raw_payload,recorded_at)
       VALUES ($1,$2,'local://fitzroy/rehearsal/event',1,'event',$3,'approved',$4::jsonb,$5)
       ON CONFLICT (import_row_id) DO NOTHING`,
      [
        importRowId,
        importRunId,
        rowSha256,
        canonicalizeAflTradeJson({ eventId: event.eventId }),
        candidate.content.createdAt,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_import_partition
        (import_partition_id,import_run_id,partition_key,partition_kind,competition,
         season_year,row_count,rows_sha256,partition_json)
       VALUES ($1,$2,'AFLM:2026','season','AFLM',2026,1,$3,$4::jsonb)
       ON CONFLICT (import_partition_id) DO NOTHING`,
      [
        importPartitionId,
        importRunId,
        sha256AflTradeCanonicalJson([{ importRowId, rowSha256 }]),
        canonicalizeAflTradeJson({ competition: 'AFLM', seasonYear: 2026 }),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_import_partition_row
        (import_partition_id,import_row_id,import_run_id,ordinal)
       VALUES ($1,$2,$3,1) ON CONFLICT DO NOTHING`,
      [importPartitionId, importRowId, importRunId]
    );
    await transaction.query(
      `INSERT INTO outcome_event (event_id,competition,season_year,stable_key)
       VALUES ($1,'AFLM',2026,$2)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, `local-fitzroy-factual-release-${captureId}`]
    );
    await transaction.query(
      `INSERT INTO outcome_event_version
        (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,
         official_name,status,source_import_row_id,recorded_at)
       VALUES ($1,$2,1,'other_acquisition','pre_draft','2026-01-01',
               'Local fitzRoy factual rehearsal','approved',$3,$4)
       ON CONFLICT (event_version_id) DO NOTHING`,
      [event.eventVersionId, event.eventId, importRowId, candidate.content.createdAt]
    );
    await transaction.query(
      `INSERT INTO outcome_event_party
        (event_version_id,club_id,source_import_row_id,role,ordinal)
       VALUES ($1,$2,$3,'receiving_club',1)
       ON CONFLICT (event_version_id,club_id) DO NOTHING`,
      [event.eventVersionId, CLUB_ID, importRowId]
    );
    await transaction.query(
      `INSERT INTO outcome_event_asset
        (asset_version_id,event_version_id,asset_key,kind,player_id,player_identity_id,
         from_club_id,to_club_id,source_import_row_id,raw_description,status)
       VALUES ($1,$2,'local-rehearsal-player','player',$3,$4,NULL,$5,$6,'Player One','approved')
       ON CONFLICT (asset_version_id) DO NOTHING`,
      [assetVersionId, event.eventVersionId, PLAYER_ID, playerIdentityId, CLUB_ID, importRowId]
    );
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_rule
        (rule_id,rule_version,definition_json,status,created_at)
       VALUES ($1,'local-fitzroy-factual-release/v1',$2::jsonb,'approved',$3)
       ON CONFLICT (rule_id) DO NOTHING`,
      [
        candidate.content.acquisitionSpellRule.id,
        canonicalizeAflTradeJson({ rule: 'local source-independent rehearsal spell' }),
        candidate.content.createdAt,
      ]
    );
    const storedSpell = await transaction.query<{ spell_version_id: string }>(
      `SELECT spell_version_id FROM outcome_acquisition_spell_version
        WHERE spell_version_id=$1`,
      [spell.spellVersionId]
    );
    if (!storedSpell.rows[0]) {
      const predecessor = await transaction.query<{
        spell_version_id: string;
        version: number;
      }>(
        `SELECT current_spell.spell_version_id,current_spell.version
           FROM outcome_acquisition_spell_version current_spell
          WHERE current_spell.spell_id=$1
            AND NOT EXISTS (
              SELECT 1 FROM outcome_acquisition_spell_version successor
               WHERE successor.supersedes_spell_version_id=current_spell.spell_version_id
            )
          FOR UPDATE`,
        [spell.spellId]
      );
      const prior = predecessor.rows[0];
      if ((generation === 'baseline') !== (prior === undefined)) {
        throw new TypeError('The local acquisition-spell generation does not match its version chain.');
      }
      await transaction.query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
           start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
           supersedes_spell_version_id,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,'approved',$11,$12)`,
        [
          spell.spellVersionId,
          spell.spellId,
          (prior?.version ?? 0) + 1,
          spell.playerId,
          spell.clubId,
          event.eventVersionId,
          assetVersionId,
          spell.startDate,
          spell.endDate,
          candidate.content.acquisitionSpellRule.id,
          prior?.spell_version_id ?? null,
          candidate.content.createdAt,
        ]
      );
    }
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_metric
        (spell_version_id,metric_code,metric_definition_version,numeric_value,numerator,
         denominator,coverage_state,observation_count,effective_through,evidence_json)
       VALUES ($1,'games','games/v1',$2,NULL,NULL,'complete',1,'2026-03-20',$3::jsonb)
       ON CONFLICT (spell_version_id,metric_code) DO NOTHING`,
      [
        spell.spellVersionId,
        games.games,
        canonicalizeAflTradeJson({
          factualRunId: prepared.receipt.factualRunId,
          source: 'reconciled_player_appearance',
        }),
      ]
    );
  });
}

async function readReconciledValues(
  client: AflOutcomeSqlClient,
  factualRunId: string
): Promise<{ games: number; goals: number }> {
  const result = await client.query<{ metric_code: string; numeric_value: string }>(
    `SELECT metric_code,numeric_value::text
       FROM outcome_reconciled_factual_metric
      WHERE factual_run_id=$1 AND state='measured' AND metric_code IN ('games','goals')`,
    [factualRunId]
  );
  const values = Object.fromEntries(
    result.rows.map(({ metric_code, numeric_value }) => [metric_code, Number(numeric_value)])
  );
  if (!Number.isSafeInteger(values.games) || !Number.isSafeInteger(values.goals)) {
    throw new TypeError('The release projection requires exact reconciled games and goals values.');
  }
  return { games: values.games, goals: values.goals };
}

async function assertCandidateEvidenceWithinCutoff(
  client: AflOutcomeSqlClient,
  prepared: PreparedLocalAflTradeFitzRoyFactualReleaseCandidate
): Promise<void> {
  const candidate = prepared.candidate;
  const cutoff = Date.parse(candidate.content.effectiveThrough);
  const evidence = await client.query<{
    evidence_kind: string;
    evidence_id: string;
    status: string;
    recorded_at: string | Date;
  }>(
    `SELECT 'source_capture' AS evidence_kind,capture_id AS evidence_id,status::text,
            captured_at AS recorded_at
       FROM outcome_source_capture
      WHERE capture_id = ANY($1::text[])
     UNION ALL
     SELECT 'review_decision',decision_id,'approved',decided_at
       FROM outcome_review_decision
      WHERE decision_id = ANY($2::text[])
     UNION ALL
     SELECT 'event_version',event_version_id,status::text,recorded_at
       FROM outcome_event_version
      WHERE event_version_id = ANY($3::text[])
     UNION ALL
     SELECT 'acquisition_spell',spell_version_id,status::text,recorded_at
       FROM outcome_acquisition_spell_version
      WHERE spell_version_id = ANY($4::text[])`,
    [
      candidate.content.members.sourceCaptures.map(({ captureId }) => captureId),
      candidate.content.members.reviewDecisions.map(({ decisionId }) => decisionId),
      candidate.content.members.eventVersions.map(({ eventVersionId }) => eventVersionId),
      candidate.content.members.acquisitionSpells.map(({ spellVersionId }) => spellVersionId),
    ]
  );
  const expectedCount =
    candidate.content.members.sourceCaptures.length +
    candidate.content.members.reviewDecisions.length +
    candidate.content.members.eventVersions.length +
    candidate.content.members.acquisitionSpells.length;
  const invalid = evidence.rows.filter(
    ({ status, recorded_at }) =>
      status !== 'approved' || Date.parse(new Date(recorded_at).toISOString()) > cutoff
  );
  if (evidence.rows.length !== expectedCount || invalid.length > 0) {
    throw new TypeError(
      `The sealed candidate evidence is not within its cutoff: ${canonicalizeAflTradeJson({
        expectedCount,
        actualCount: evidence.rows.length,
        invalid: invalid.map((row) => ({
          ...row,
          recorded_at: new Date(row.recorded_at).toISOString(),
        })),
      })}`
    );
  }
}

function metricDefinition(metric: 'games' | 'goals') {
  const definition = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.find(
    (candidate) => candidate.metric === metric
  );
  if (!definition) throw new TypeError(`The ${metric} metric definition is unavailable.`);
  return definition;
}

async function createProjection(
  client: AflOutcomeSqlClient,
  prepared: PreparedLocalAflTradeFitzRoyFactualReleaseCandidate,
  generation: Generation
) {
  const candidate = prepared.candidate;
  const release = candidate.content.targetReleaseManifest;
  const event = candidate.content.members.eventVersions[0];
  if (!event) throw new TypeError('The public projection requires its exact release event.');
  const assetVersionId = releaseAssetVersionId(event.eventVersionId);
  const times = lifecycleTimes[generation];
  const values = await readReconciledValues(client, prepared.receipt.factualRunId);
  const rightsDecisionId = release.content.sourceRightsBindings[0]?.gateDecisionId;
  if (!rightsDecisionId) throw new TypeError('The release is missing its source-rights decision.');
  const observedArtifact = release.content.reconciliationReportArtifact.artifactId;
  const itemSet = createAflTradeFactualProjectionItemSet([
    {
      ordinal: 1,
      itemKey: `${event.eventId}:${PLAYER_ID}`,
      item: {
        eventId: event.eventId,
        tradeId: null,
        assetId: assetVersionId,
        year: 2026,
        acquisitionType: 'Local fitzRoy factual rehearsal',
        aflClubId: CLUB_ID,
        clubName: 'Carlton',
        player: { aflPlayerId: PLAYER_ID, displayName: 'Player One', identityStatus: 'resolved' },
        checks: (['games', 'goals'] as const).map((metric) => {
          const definition = metricDefinition(metric);
          return {
            metric,
            status: 'source_only' as const,
            recordedValue: null,
            observedValue: values[metric],
            delta: null,
            coverageRatio: null,
            scopeLabel: 'AFLM 2026 through the rehearsed match',
            effectiveThrough: release.content.effectiveThrough,
            sources: [
              {
                role: 'observed' as const,
                artifactId: observedArtifact,
                locator: `local://fitzroy/reconciled/${prepared.receipt.factualRunId}/${metric}`,
                rightsDecisionId,
                metricDefinitionId: definition.metricDefinitionId,
              },
            ] as const,
            message: `Observed ${definition.label.toLowerCase()} from the reconciled local fitzRoy candidate.`,
          };
        }),
        achievements: [],
      },
    },
  ]);
  const publicItems = itemSet.members.map(({ item }) => item);
  const logicalDatasetSha256 = sha256AflTradeCanonicalJson(publicItems);
  const exportBytes = createLocalAflTradeFactualReleaseExportBytes({
    releaseId: release.releaseId,
    publicItems,
  });
  const artifact = (name: string) =>
    createAflTradeCanonicalJsonArtifactRef(
      { name, releaseId: release.releaseId, itemSetSha256: itemSet.itemSetSha256 },
      times.projection
    );
  const projectionContent = {
    schemaVersion: 'afl-draft-trade-outcome-projection/v2' as const,
    publicAssetBoundary: release.content.publicAssetBoundary,
    environment: ENVIRONMENT,
    scopeKey: release.content.scopeKey,
    createdAt: times.projection,
    releaseId: release.releaseId,
    archiveDatasetId: release.content.archiveDatasetId,
    metricRegistryVersion: release.content.metricRegistryVersion,
    effectiveThrough: release.content.effectiveThrough,
    metricDefinitionIds: release.content.metricDefinitions
      .map(({ metricDefinitionId }) => metricDefinitionId)
      .sort(),
    viewArtifacts: {
      list: artifact('list'),
      tradeDetail: artifact('trade-detail'),
      club: artifact('club'),
      player: artifact('player'),
      year: artifact('year'),
      dashboard: artifact('dashboard'),
    },
    exportArtifacts: {
      json: createAflTradeByteArtifactRef(exportBytes.json, 'application/json', times.projection),
      csv: createAflTradeByteArtifactRef(exportBytes.csv, 'text/csv', times.projection),
      xlsx: createAflTradeByteArtifactRef(
        exportBytes.xlsx,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        times.projection
      ),
    },
    parityReport: {
      artifact: artifact('parity-report'),
      status: 'passed' as const,
      checkCount: 5,
      failureCount: 0 as const,
      checkedOutcomeRecordCount: release.content.outcomeRecordCount,
      logicalDatasetSha256,
    },
    documentCount: itemSet.itemCount,
    factualCandidateId: candidate.candidateId,
    sourceMemberSetSha256: candidate.content.memberSetSha256,
    publicListItemSetSha256: itemSet.itemSetSha256,
    derivationSha256: sha256AflTradeCanonicalJson({
      factualCandidateId: candidate.candidateId,
      logicalDatasetSha256,
      publicListItemSetSha256: itemSet.itemSetSha256,
      sourceMemberSetSha256: candidate.content.memberSetSha256,
    }),
  };
  const projection = createAflDraftTradeOutcomeFactualProjectionManifest(projectionContent);
  return { release, projection, itemSet };
}

async function persistSourceAuthority(client: AflOutcomeSqlClient): Promise<void> {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({ generation: 'baseline' });
  const sourceRights = fixture.command.capture.sourceRights;
  const proposal = fixture.command.capture.ledger.proposals[0];
  const decision = fixture.command.capture.ledger.decisions[0];
  if (!proposal || !decision) throw new TypeError('The fitzRoy Gate 0A authority is unavailable.');
  const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const current = await repository.load();
  if (current.ledger.decisions.some(({ decisionId }) => decisionId === decision.decisionId)) return;
  await repository.append({
    expectedRevision: current.revision,
    sourceRights,
    proposal,
    decision,
  });
}

async function sealProjectAndActivate(
  client: AflOutcomeSqlClient,
  prepared: PreparedLocalAflTradeFitzRoyFactualReleaseCandidate,
  generation: Generation
): Promise<LocalAflTradeFactualReleaseSelection> {
  await ensureCandidateParents(client, prepared, generation);
  await assertCandidateEvidenceWithinCutoff(client, prepared);
  await new PostgresAflTradeFactualReleaseCandidateWriter(client).persistCandidate(
    prepared.candidate
  );
  const publication = await createProjection(client, prepared, generation);
  await new PostgresAflTradeFactualProjectionItemSetRepository(client).persist({
    projection: publication.projection,
    itemSet: publication.itemSet,
    finalizedAt: lifecycleTimes[generation].projection,
  });
  const affectedArtifacts = [
    { kind: 'factual_release' as const, artifactId: publication.release.releaseId },
    { kind: 'factual_projection' as const, artifactId: publication.projection.projectionId },
  ];
  const review = createPublicationGateDecision({
    gate: 'gate_4_publication_api_readiness',
    generation,
    decidedAt: lifecycleTimes[generation].approve,
    affectedArtifacts,
  });
  const operation = createPublicationGateDecision({
    gate: 'gate_5_comprehension_accessibility',
    generation,
    decidedAt: lifecycleTimes[generation].activate,
    affectedArtifacts,
  });
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  let gateLedger = await gateRepository.load();
  for (const gate of [review, operation]) {
    if (!gateLedger.ledger.decisions.some(({ decisionId }) => decisionId === gate.decision.decisionId)) {
      gateLedger = await gateRepository.appendDecision({
        expectedRevision: gateLedger.revision,
        proposal: gate.proposal,
        decision: gate.decision,
      });
    }
  }
  const registryRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(client);
  let registry = await registryRepository.loadRegistry();
  registry = await registryRepository.register({
    expectedRevision: registry.revision,
    manifest: publication.release,
    actor: ACTOR,
    evidenceId: lifecycleEvidence('register', publication.release.releaseId),
    occurredAt: lifecycleTimes[generation].register,
  });
  registry = await registryRepository.apply({
    action: 'validate',
    releaseId: publication.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: lifecycleTimes[generation].validate,
    actor: ACTOR,
    evidenceId: lifecycleEvidence('validate', publication.release.releaseId),
    environment: ENVIRONMENT,
    projectionManifest: publication.projection,
    gateDecisionLedger: gateLedger.ledger,
  });
  registry = await registryRepository.apply({
    action: 'approve',
    releaseId: publication.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: lifecycleTimes[generation].approve,
    actor: ACTOR,
    evidenceId: lifecycleEvidence('approve', publication.release.releaseId),
    environment: ENVIRONMENT,
    gateDecisionId: review.decision.decisionId,
    gateDecisionLedger: gateLedger.ledger,
  });
  const activation = createAflDraftTradeOutcomeActivationAuthorization({
    schemaVersion: 'afl-draft-trade-outcome-activation-authorization/v1',
    environment: ENVIRONMENT,
    scopeKey: publication.release.content.scopeKey,
    releaseId: publication.release.releaseId,
    projectionId: publication.projection.projectionId,
    expectedRegistryRevision: registry.revision,
    authorizedAt: lifecycleTimes[generation].approve,
    expiresAt: '2027-08-12T00:00:00.000Z',
    rollbackWindowEndsAt: '2027-08-12T00:00:00.000Z',
    writeBarrier: 'engaged',
    parityReportArtifactId: publication.projection.content.parityReport.artifact.artifactId,
    authorityKind: 'external_human_record',
    authorizedBy: ACTOR,
    authorityEvidenceIds: [operation.decision.decisionId],
  });
  registry = await registryRepository.apply({
    action: 'activate',
    releaseId: publication.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: lifecycleTimes[generation].activate,
    actor: ACTOR,
    evidenceId: lifecycleEvidence('activate', publication.release.releaseId),
    environment: ENVIRONMENT,
    gateDecisionId: operation.decision.decisionId,
    gateDecisionLedger: gateLedger.ledger,
    sourceRightsDecisionLedger: gateLedger.ledger,
    factualReviewDecisionLedger: gateLedger.ledger,
    activationAuthorization: activation,
  });
  const active = registry.activeByScope[publication.release.content.scopeKey];
  if (active?.releaseId !== publication.release.releaseId) {
    throw new TypeError('The local factual release did not become the exact active selection.');
  }
  return {
    releaseId: publication.release.releaseId,
    projectionId: publication.projection.projectionId,
  };
}

async function reactivateExistingRelease(
  client: AflOutcomeSqlClient,
  selection: LocalAflTradeFactualReleaseSelection,
  generation: Generation,
  phase: 'rollback' | 'recovery',
  times: (typeof recoveryTimes)['rollback'] | (typeof recoveryTimes)['recovery']
): Promise<LocalAflTradeFactualReleaseSelection> {
  const registryRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(client);
  let registry = await registryRepository.loadRegistry();
  const record = registry.releases[selection.releaseId];
  const projection = record?.projectionManifest;
  if (!record || !projection || projection.projectionId !== selection.projectionId) {
    throw new TypeError(`The local ${phase} requires the exact retained release projection.`);
  }
  const affectedArtifacts = [
    { kind: 'factual_release' as const, artifactId: selection.releaseId },
    { kind: 'factual_projection' as const, artifactId: selection.projectionId },
  ];
  const review = createPublicationGateDecision({
    gate: 'gate_4_publication_api_readiness',
    generation,
    decidedAt: lifecycleTimes[generation].approve,
    affectedArtifacts,
  });
  const operation = createPublicationGateDecision({
    gate: 'gate_5_comprehension_accessibility',
    generation,
    decidedAt: lifecycleTimes[generation].activate,
    affectedArtifacts,
  });
  const gateLedger = (await createPostgresAflTradeGateDecisionLedgerRepository(client).load())
    .ledger;
  registry = await registryRepository.apply({
    action: 'validate',
    releaseId: selection.releaseId,
    expectedRevision: registry.revision,
    occurredAt: times.validate,
    actor: ACTOR,
    evidenceId: lifecycleEvidence(`${phase}-validate`, selection.releaseId),
    environment: ENVIRONMENT,
    projectionManifest: projection,
    gateDecisionLedger: gateLedger,
  });
  registry = await registryRepository.apply({
    action: 'approve',
    releaseId: selection.releaseId,
    expectedRevision: registry.revision,
    occurredAt: times.approve,
    actor: ACTOR,
    evidenceId: lifecycleEvidence(`${phase}-approve`, selection.releaseId),
    environment: ENVIRONMENT,
    gateDecisionId: review.decision.decisionId,
    gateDecisionLedger: gateLedger,
  });
  const activation = createAflDraftTradeOutcomeActivationAuthorization({
    schemaVersion: 'afl-draft-trade-outcome-activation-authorization/v1',
    environment: ENVIRONMENT,
    scopeKey: record.scopeKey,
    releaseId: selection.releaseId,
    projectionId: selection.projectionId,
    expectedRegistryRevision: registry.revision,
    authorizedAt: times.approve,
    expiresAt: '2027-08-12T00:00:00.000Z',
    rollbackWindowEndsAt: '2027-08-12T00:00:00.000Z',
    writeBarrier: 'engaged',
    parityReportArtifactId: projection.content.parityReport.artifact.artifactId,
    authorityKind: 'external_human_record',
    authorizedBy: ACTOR,
    authorityEvidenceIds: [operation.decision.decisionId],
  });
  registry = await registryRepository.apply({
    action: 'activate',
    releaseId: selection.releaseId,
    expectedRevision: registry.revision,
    occurredAt: times.activate,
    actor: ACTOR,
    evidenceId: lifecycleEvidence(`${phase}-activate`, selection.releaseId),
    environment: ENVIRONMENT,
    gateDecisionId: operation.decision.decisionId,
    gateDecisionLedger: gateLedger,
    sourceRightsDecisionLedger: gateLedger,
    factualReviewDecisionLedger: gateLedger,
    activationAuthorization: activation,
  });
  if (registry.activeByScope[record.scopeKey]?.releaseId !== selection.releaseId) {
    throw new TypeError(`The local ${phase} did not restore the exact release selection.`);
  }
  return selection;
}

async function withdrawActiveRelease(
  client: AflOutcomeSqlClient,
  selection: LocalAflTradeFactualReleaseSelection
): Promise<null> {
  const registryRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(client);
  let registry = await registryRepository.loadRegistry();
  registry = await registryRepository.apply({
    action: 'withdraw',
    releaseId: selection.releaseId,
    expectedRevision: registry.revision,
    occurredAt: recoveryTimes.withdraw,
    actor: ACTOR,
    evidenceId: lifecycleEvidence('withdraw', selection.releaseId),
    reason: 'Prove that local withdrawal clears the active pointer without implicit fallback.',
  });
  const gateLedger = (await createPostgresAflTradeGateDecisionLedgerRepository(client).load())
    .ledger;
  const snapshot = await registryRepository.captureSelection(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE, {
    evaluatedAt: recoveryTimes.withdraw,
    sourceRightsDecisionLedger: gateLedger,
  });
  if (
    registry.activeByScope[AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE] !== undefined ||
    snapshot.selection !== null ||
    snapshot.unavailabilityReason !== 'no_active_release'
  ) {
    throw new TypeError('The local withdrawal did not fail closed with no active release.');
  }
  return null;
}

export async function runLocalAflTradeFactualReleaseRehearsal(
  client: AflOutcomeSqlClient
): Promise<LocalAflTradeFactualReleaseRehearsalReceipt> {
  await persistSourceAuthority(client);
  const baselinePrivate = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
    generation: 'baseline',
    goals: '1',
  });
  const baselinePrepared = await promotePrivateCaptureForRelease(
    client,
    baselinePrivate,
    'baseline'
  );
  const baseline = await sealProjectAndActivate(client, baselinePrepared, 'baseline');
  const replacementPrivate = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
    generation: 'replacement',
    goals: '2',
  });
  const replacementPrepared = await promotePrivateCaptureForRelease(
    client,
    replacementPrivate,
    'replacement'
  );
  const replacement = await sealProjectAndActivate(client, replacementPrepared, 'replacement');
  const rollbackSelection = await reactivateExistingRelease(
    client,
    baseline,
    'baseline',
    'rollback',
    recoveryTimes.rollback
  );
  const withdrawalSelection = await withdrawActiveRelease(client, rollbackSelection);
  const recoverySelection = await reactivateExistingRelease(
    client,
    replacement,
    'replacement',
    'recovery',
    recoveryTimes.recovery
  );
  const registry = await createPostgresAflDraftTradeOutcomeReleaseRepository(client).loadRegistry();
  const active = registry.activeByScope[AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE];
  const activeRecord = active ? registry.releases[active.releaseId] : undefined;
  if (!active || !activeRecord?.projectionManifest) {
    throw new TypeError('The local factual-release rehearsal ended without one active selection.');
  }
  return {
    environment: ENVIRONMENT,
    baseline,
    replacement,
    rollbackSelection,
    withdrawalSelection,
    recoverySelection,
    activeSelection: {
      releaseId: active.releaseId,
      projectionId: activeRecord.projectionManifest.projectionId,
    },
  };
}
