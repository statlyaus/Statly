import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import { createLocalDraftguruNationalYearTargets } from '@/server/aflTradeIntelligence/development/localDraftguruNationalYearCapture';
import {
  createLocalDraftguruTradeCaptureTargets,
  runLocalExternalCapture,
} from '@/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import { createLocalOfficialAflDraftSessionTargets } from '@/server/aflTradeIntelligence/development/localOfficialAflDraftSessionCapture';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { OFFICIAL_AFL_COMPLETED_SESSION_PAGES } from '../testUtils/officialAflCompletedSessionPages';
import {
  approveNarrowAuthority,
  draftguruNationalYearAuthority,
  officialAflDraftSessionAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_local_external_capture_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const sql = createPgAflOutcomeSqlClient(outcomesPool);
const userAgent = 'Statly private evaluation test (contact: owner@example.com)';
const cameronUrl = 'https://www.draftguru.com.au/trades/2020-jeremy-cameron';
let artifactRoot: string;
const CAPTURE_STORE_ID = 'external-capture-store';

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

/** Stores an owner's evidence document the way the store-evidence command does: write first. */
async function retainEvidenceDocument(name: string): Promise<string> {
  const stored = await storeLocalAflTradeEvidence(sql, {
    storeId: CAPTURE_STORE_ID,
    repositoryId: 'owner-evidence',
    artifactClass: 'capture_metadata',
    bytes: new TextEncoder().encode(`# ${name}\n\nSynthetic reviewed evidence.\n`),
    mediaType: 'text/markdown',
    maximumObjectBytes: 1024 * 1024,
  });
  return stored.reference.artifactId;
}

/** Stands in for the owner's recorded decision, written through the real Gate ledger owner. */
async function recordOwnerDecision(
  capabilityId: DraftguruTradeCapability,
  evidenceIds: Parameters<typeof createDraftguruTradeAuthorityProposal>[0]['evidenceIds']
) {
  const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal({
    capabilityId,
    // The local runner captures trade detail with v2, which records each received pick's outcome.
    ...(capabilityId === 'draftguru-trade-detail'
      ? { parserVersion: DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION }
      : {}),
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
     VALUES ('AFLM',2019),('AFLM',2020),('AFLM',2021) ON CONFLICT DO NOTHING`
  );
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-local-external-capture-'));
  // One registered store holds the captured pages and the owner evidence their decisions cite, and a
  // clean readback lets that evidence be stored (#759).
  await registerLocalAflTradeArtifactStore(sql, {
    storeId: CAPTURE_STORE_ID,
    rootDirectory: artifactRoot,
  });
  await readBackLocalAflTradeArtifactCustody({ client: sql, storeId: CAPTURE_STORE_ID });
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
      runLocalExternalCapture(
        { sql, artifactRootDirectory: artifactRoot, userAgent, fetchImpl: provider.fetchImpl },
        detailTargets()
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
    expect(provider.calls).toEqual([]);
  });

  it('captures the 2020 Cameron trade page, holds its repeat for the cache period, and paces the index', async () => {
    const evidenceIds = {
      productOwnerAuthorization: await retainEvidenceDocument('authorization'),
      boundedCapturePlan: await retainEvidenceDocument('capture plan'),
      publicAccessReview: await retainEvidenceDocument('access review'),
      fieldBoundaryReview: await retainEvidenceDocument('field review'),
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

    const [staged] = await runLocalExternalCapture(options, detailTargets());
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
    await expect(runLocalExternalCapture(options, detailTargets())).rejects.toMatchObject({
      code: 'REQUEST_COOLDOWN',
    });
    expect(provider.calls).toHaveLength(1);

    // A different target only waits out the five-second provider pacing.
    const [index] = await runLocalExternalCapture(
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
      runLocalExternalCapture(
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

/** Stubbed afl.com.au: no live network. It serves each reviewed page's exact structure. */
function stubOfficialAfl() {
  const calls: { url: string; at: number; userAgent: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, at: Date.now(), userAgent: new Headers(init?.headers).get('User-Agent') });
    const page = OFFICIAL_AFL_COMPLETED_SESSION_PAGES[url];
    if (page === undefined) return new Response(null, { status: 404 });
    return new Response(page(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
  return { calls, fetchImpl };
}

async function recordOfficialDecision(
  season: number,
  evidenceIds: Parameters<typeof officialAflDraftSessionAuthority>[0]['evidenceIds'],
  buildAuthority:
    | typeof officialAflDraftSessionAuthority
    | typeof draftguruNationalYearAuthority = officialAflDraftSessionAuthority
) {
  const authority = buildAuthority({
    season,
    evidenceIds,
    timing: {
      termsEffectiveAt: instant(-120),
      termsExpireAt: instant(60 * 24 * 30),
      rightsProposedAt: instant(-100),
      proposalProposedAt: instant(-99),
    },
  });
  const decision = approveNarrowAuthority(authority, {
    decidedAt: instant(-90),
    revalidateAt: instant(60 * 24 * 20),
  });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  await ledger.append({
    expectedRevision: (await ledger.load()).revision,
    ...authority,
    decision,
  });
}

describe('local Official AFL completed-session capture through the governed ingestion boundary', () => {
  const sessionTargets = () => createLocalOfficialAflDraftSessionTargets([2019, 2020, 2021]);

  it('fetches nothing until every requested season has its recorded decision', async () => {
    const provider = stubOfficialAfl();
    // Pages are written into the registered local store rooted at the capture root (#759).
    await registerLocalAflTradeArtifactStore(sql, {
      storeId: CAPTURE_STORE_ID,
      rootDirectory: artifactRoot,
    });
    const options = {
      sql,
      artifactRootDirectory: artifactRoot,
      storeId: CAPTURE_STORE_ID,
      userAgent,
      fetchImpl: provider.fetchImpl,
    };
    await expect(runLocalExternalCapture(options, sessionTargets())).rejects.toMatchObject({
      code: 'AUTHORITY_MISMATCH',
    });
    const evidenceIds = {
      productOwnerAuthorization: await retainEvidenceDocument('session authorization'),
      boundedCapturePlan: await retainEvidenceDocument('session capture plan'),
      publicAccessReview: await retainEvidenceDocument('session access review'),
      fieldBoundaryReview: await retainEvidenceDocument('session field review'),
    };
    await recordOfficialDecision(2019, evidenceIds);
    await recordOfficialDecision(2020, evidenceIds);
    await expect(runLocalExternalCapture(options, sessionTargets())).rejects.toThrow(
      /official-afl-completed-draft-session-issue579-private-2021-session-v18/
    );
    expect(provider.calls).toEqual([]);

    await recordOfficialDecision(2021, evidenceIds);
    const results = await runLocalExternalCapture(options, sessionTargets());
    // The 2019 club review reports both nights; each other page reports one completed session.
    expect(
      results.map((result) => ({
        season: result.season,
        status: result.status,
        evidenceCount: result.status === 'staged' ? result.evidenceCount : null,
        issueCount: result.status === 'staged' ? result.issueCount : null,
      }))
    ).toEqual([
      { season: 2019, status: 'staged', evidenceCount: 2, issueCount: 0 },
      { season: 2020, status: 'staged', evidenceCount: 1, issueCount: 0 },
      { season: 2021, status: 'staged', evidenceCount: 1, issueCount: 0 },
      { season: 2021, status: 'staged', evidenceCount: 1, issueCount: 0 },
    ]);
    expect(provider.calls.map(({ url }) => url)).toEqual(
      sessionTargets().map(({ sourceUrl }) => sourceUrl)
    );
    expect(provider.calls.every((call) => call.userAgent === userAgent)).toBe(true);
    for (let index = 1; index < provider.calls.length; index += 1) {
      expect(provider.calls[index]!.at - provider.calls[index - 1]!.at).toBeGreaterThanOrEqual(
        5_000
      );
    }
    expect(await readdir(join(artifactRoot, 'official-afl-session-raw'))).not.toHaveLength(0);
    // Every captured page's custody row records where its bytes live in the store.
    const located = await sql.query<{
      artifact_id: string;
      store_id: string | null;
      object_key: string | null;
    }>(
      `SELECT capture.source_artifact_id AS artifact_id,location.store_id,location.object_key
         FROM outcome_source_capture capture
         LEFT JOIN outcome_artifact_custody_location location
           ON location.artifact_id=capture.source_artifact_id
        WHERE capture.provider='official_afl' AND capture.environment='non_production'`
    );
    expect(located.rows).toHaveLength(4);
    for (const row of located.rows) {
      expect(row.store_id).toBe(CAPTURE_STORE_ID);
      expect(row.object_key).toMatch(
        /^official-afl-session-raw\/local_non_production_filesystem\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}$/u
      );
    }

    // Each capture receipt names the v18 parser and the season's own recorded decision.
    const receipts = await sql.query<{ parser: string; decision_key: string }>(
      `SELECT manifest_json->>'parserVersion' AS parser,
              manifest_json#>>'{executionReceipt,content,gate0aReceipt,content,request,decisionKey}'
                AS decision_key
         FROM outcome_source_capture
        WHERE provider='official_afl' AND environment='non_production'
        ORDER BY anchor_season_year, captured_at`
    );
    expect(receipts.rows).toEqual([
      {
        parser: 'official-afl-completed-draft-session/v18',
        decision_key: 'official-afl-completed-draft-session-issue579-private-2019-session-v18',
      },
      {
        parser: 'official-afl-completed-draft-session/v18',
        decision_key: 'official-afl-completed-draft-session-issue579-private-2020-session-v18',
      },
      {
        parser: 'official-afl-completed-draft-session/v18',
        decision_key: 'official-afl-completed-draft-session-issue579-private-2021-session-v18',
      },
      {
        parser: 'official-afl-completed-draft-session/v18',
        decision_key: 'official-afl-completed-draft-session-issue579-private-2021-session-v18',
      },
    ]);
  }, 90_000);
});

describe('local Draftguru national-year capture through the governed ingestion boundary', () => {
  // Reduced retained 2020 year page: 59 national selections among other pathways.
  const yearPage = readFileSync('tests/fixtures/draftguru-year-2020.html', 'utf8');

  it('captures a recorded season under the national-only parser and its own decision', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(yearPage, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    };
    const options = { sql, artifactRootDirectory: artifactRoot, userAgent, fetchImpl };
    const targets = createLocalDraftguruNationalYearTargets([2020]);
    await expect(runLocalExternalCapture(options, targets)).rejects.toThrow(
      /draftguru-national-year-page-issue579-private-2020/
    );
    expect(calls).toEqual([]);

    const evidenceIds = {
      productOwnerAuthorization: await retainEvidenceDocument('national authorization'),
      boundedCapturePlan: await retainEvidenceDocument('national capture plan'),
      publicAccessReview: await retainEvidenceDocument('national access review'),
      fieldBoundaryReview: await retainEvidenceDocument('national field review'),
    };
    await recordOfficialDecision(2020, evidenceIds, draftguruNationalYearAuthority);
    const [result] = await runLocalExternalCapture(options, targets);
    expect(result).toMatchObject({
      season: 2020,
      status: 'staged',
      evidenceCount: 59,
      issueCount: 0,
    });
    expect(calls).toEqual(['https://www.draftguru.com.au/years/2020']);
    expect(await readdir(join(artifactRoot, 'draftguru-national-raw'))).not.toHaveLength(0);

    const receipts = await sql.query<{ parser: string; pathway: string; decision_key: string }>(
      `SELECT manifest_json->>'parserVersion' AS parser,
              manifest_json->>'draftPathway' AS pathway,
              manifest_json#>>'{executionReceipt,content,gate0aReceipt,content,request,decisionKey}'
                AS decision_key
         FROM outcome_source_capture
        WHERE provider='draftguru' AND manifest_json->>'capabilityId'='draftguru-national-year-page'`
    );
    expect(receipts.rows).toEqual([
      {
        parser: 'draftguru-national-year-page/v1',
        pathway: 'national',
        decision_key: 'draftguru-national-year-page-issue579-private-2020',
      },
    ]);
  }, 90_000);
});
