import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { verifyAflTradeArtifactReadback } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import {
  createLocalDraftguruTradeCaptureTargets,
  runLocalDraftguruTradeCapture,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeCaptureRunner';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_local_draftguru_capture_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const sql = createPgAflOutcomeSqlClient(outcomesPool);
const userAgent = 'Statly private evaluation test (contact: owner@example.com)';
const cameronUrl = 'https://www.draftguru.com.au/trades/2020-jeremy-cameron';
let artifactRoot: string;

const instant = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();

function cameronTradeHtml(): string {
  const empty = '<td colspan="5"></td>';
  const side = (cell: string) => `${cell}<td colspan="4"></td>`;
  const player = side(
    '<td class="player-name actual-asset"><a href="/players/jeremy-cameron">Jeremy Cameron</a></td>'
  );
  const pick = side('<td class="pick-name actual-asset">Pick 13</td>');
  return `<!doctype html><h2 class="heading">2020 Jeremy Cameron Trade</h2><table class="individual-trade"><tr class="club-header"><td>Greater Western Sydney</td></tr><tr class="movement">${player}${empty}</tr><tr class="movement">${empty}${pick}</tr><tr class="club-header"><td>Geelong</td></tr><tr class="movement">${pick}${empty}</tr><tr class="movement">${empty}${player}</tr></table>`;
}

const indexHtml = `<!doctype html><a href="/trades/2020-jeremy-cameron">Cameron</a><a href="/trades/2020-jaeger-o'meara">O'Meara</a><a href="/trades/2019-out-of-range">Earlier</a>`;

/** Stubbed provider: no live network. It honours validators and records pacing and identity. */
function stubDraftguru() {
  const calls: { url: string; at: number; userAgent: string | null; ifNoneMatch: string | null }[] =
    [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      at: Date.now(),
      userAgent: headers.get('User-Agent'),
      ifNoneMatch: headers.get('If-None-Match'),
    });
    const body = url === 'https://www.draftguru.com.au/trades' ? indexHtml : cameronTradeHtml();
    const eTag = `"${url.length}"`;
    if (headers.get('If-None-Match') === eTag) {
      return new Response(null, { status: 304, headers: { etag: eTag } });
    }
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', etag: eTag },
    });
  };
  return { calls, fetchImpl };
}

async function retainEvidenceDocument(name: string, at: string): Promise<string> {
  const repository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRoot,
    repositoryId: 'owner-evidence',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 1024 * 1024,
  });
  const bytes = new TextEncoder().encode(`# ${name}\n\nSynthetic reviewed evidence.\n`);
  const reference = createAflTradeByteArtifactRef(bytes, 'text/markdown', at);
  await repository.putIfAbsent(reference, bytes);
  const readback = await verifyAflTradeArtifactReadback(repository, reference, at, 1024 * 1024);
  await sql.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,
       created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'capture_metadata','non_production',$6,$7,$8::jsonb)`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      at,
      readback.content.verifiedAt,
      canonicalizeAflTradeJson(readback),
    ]
  );
  return reference.artifactId;
}

/** Stands in for the owner's recorded decision, written through the real Gate ledger owner. */
async function recordOwnerDecision(
  capabilityId: DraftguruTradeCapability,
  evidenceIds: Parameters<typeof createDraftguruTradeAuthorityProposal>[0]['evidenceIds']
) {
  const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal({
    capabilityId,
    seasons: Array.from({ length: 15 }, (_, index) => 2011 + index),
    evidenceIds,
    timing: {
      termsEffectiveAt: instant(-120),
      termsExpireAt: instant(60 * 24 * 30),
      rightsProposedAt: instant(-100),
      proposalProposedAt: instant(-99),
    },
  });
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'statly-product-owner',
    decidedBy: 'statly-product-owner',
    reviewers: [] as never[],
    authorityEvidenceIds: [evidenceIds.productOwnerAuthorization],
    conditionResults: sourceRights.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      status: 'satisfied' as const,
      evidenceIds: condition.verificationEvidenceIds,
      explanation: 'Synthetic owner approval for the integration test.',
    })),
    rationale: 'Synthetic owner approval of the exact narrow proposal.',
    limitations: [...proposal.content.scope.exclusions],
    decidedAt: instant(-90),
    effectiveAt: instant(-90),
    revalidateAt: instant(60 * 24 * 20),
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [] as string[],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  await ledger.append({
    expectedRevision: (await ledger.load()).revision,
    sourceRights,
    proposal,
    decision,
  });
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await sql.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFLM',2020) ON CONFLICT DO NOTHING`
  );
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-local-draftguru-capture-'));
}, 120_000);

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
  await rm(artifactRoot, { recursive: true, force: true });
});

describe('local Draftguru trade capture through the governed ingestion boundary', () => {
  const detailTargets = () =>
    createLocalDraftguruTradeCaptureTargets({
      capabilityId: 'draftguru-trade-detail',
      urls: [cameronUrl],
    });

  it('fetches nothing without the recorded owner decision', async () => {
    const provider = stubDraftguru();
    await expect(
      runLocalDraftguruTradeCapture(
        { sql, artifactRootDirectory: artifactRoot, userAgent, fetchImpl: provider.fetchImpl },
        detailTargets()
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
    expect(provider.calls).toEqual([]);
  });

  it('captures the 2020 Cameron trade page, holds its repeat for the cache period, and paces the index', async () => {
    const evidenceIds = {
      productOwnerAuthorization: await retainEvidenceDocument('authorization', instant(-130)),
      boundedCapturePlan: await retainEvidenceDocument('capture plan', instant(-130)),
      publicAccessReview: await retainEvidenceDocument('access review', instant(-130)),
      fieldBoundaryReview: await retainEvidenceDocument('field review', instant(-130)),
    };
    await recordOwnerDecision('draftguru-trade-detail', evidenceIds);
    await recordOwnerDecision('draftguru-trade-index', evidenceIds);
    const provider = stubDraftguru();
    const options = {
      sql,
      artifactRootDirectory: artifactRoot,
      userAgent,
      fetchImpl: provider.fetchImpl,
    };

    const [staged] = await runLocalDraftguruTradeCapture(options, detailTargets());
    expect(staged).toMatchObject({
      sourceUrl: cameronUrl,
      season: 2020,
      status: 'staged',
      issueCount: 0,
      idempotentReplay: false,
    });
    if (staged?.status !== 'staged') throw new Error('Expected a staged capture.');
    expect(staged.evidenceCount).toBeGreaterThan(0);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ url: cameronUrl, userAgent, ifNoneMatch: null });

    // Exact bytes are retained in local non-production custody under the artifact root.
    const custody = await sql.query<{ environment: string; custody_json: unknown }>(
      `SELECT environment,custody_json FROM outcome_artifact_custody WHERE artifact_id=$1`,
      [staged.artifactId]
    );
    expect(custody.rows[0]).toMatchObject({
      environment: 'non_production',
      custody_json: {
        content: { repositoryAssurance: 'local_non_production_filesystem', custodyProfile: null },
      },
    });
    expect(await readdir(join(artifactRoot, 'draftguru-trade-raw'))).not.toHaveLength(0);
    const raw = createLocalAflTradeNonProductionArtifactRepository({
      rootDirectory: artifactRoot,
      repositoryId: 'draftguru-trade-raw',
      artifactClass: 'raw_source',
      maximumObjectBytes: 4 * 1024 * 1024,
    });
    const retainedRow = await sql.query<{ artifact_json: unknown }>(
      `SELECT jsonb_build_object('artifactId',artifact_id,'contentSha256',content_sha256,
         'storageUri',storage_uri,'mediaType',media_type,'byteLength',byte_length,
         'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         AS artifact_json
         FROM outcome_artifact_custody WHERE artifact_id=$1`,
      [staged.artifactId]
    );
    const retained = await raw.loadExact(
      retainedRow.rows[0]!.artifact_json as Parameters<typeof raw.loadExact>[0],
      4 * 1024 * 1024
    );
    expect(new TextDecoder().decode(retained!.bytes)).toBe(cameronTradeHtml());

    // The capture and its execution receipt were recorded through the ingestion boundary.
    const captures = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM outcome_source_capture_attempt WHERE environment='non_production'`
    );
    expect(captures.rows[0]!.count).toBe(1);

    // Repeating the same page inside the reviewed 86,400-second cache is refused without a fetch,
    // even though the new run stamps a new capture instant.
    await expect(runLocalDraftguruTradeCapture(options, detailTargets())).rejects.toMatchObject({
      code: 'REQUEST_COOLDOWN',
    });
    expect(provider.calls).toHaveLength(1);

    // A different target only waits out the five-second provider pacing.
    const [index] = await runLocalDraftguruTradeCapture(
      options,
      createLocalDraftguruTradeCaptureTargets({
        capabilityId: 'draftguru-trade-index',
        season: 2020,
      })
    );
    expect(index).toMatchObject({ status: 'staged', evidenceCount: 2, issueCount: 0 });
    expect(provider.calls).toHaveLength(2);
    const pacedMs = provider.calls[1]!.at - provider.calls[0]!.at;
    expect(pacedMs).toBeGreaterThanOrEqual(5_000);
    expect(pacedMs).toBeLessThan(30_000);
  }, 60_000);

  it('refuses seasons outside the recorded authority before any fetch', async () => {
    const provider = stubDraftguru();
    await expect(
      runLocalDraftguruTradeCapture(
        { sql, artifactRootDirectory: artifactRoot, userAgent, fetchImpl: provider.fetchImpl },
        createLocalDraftguruTradeCaptureTargets({
          capabilityId: 'draftguru-trade-detail',
          urls: ['https://www.draftguru.com.au/trades/2010-outside-scope'],
        })
      )
    ).rejects.toThrow(/2011 through 2025/);
    expect(provider.calls).toEqual([]);
  });
});
