import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordReviewerGrant } from '../../Scripts/record-reviewer-grant';
import { recordSeasonSourceDecision } from '../../Scripts/record-season-source-decision';
import { reportIntakeAuthority } from '../../Scripts/report-intake-authority';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { createDraftguruTradeAuthorityProposal } from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import { loadRecordedLocalCaptureAuthority } from '@/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import { OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY } from '@/server/aflTradeIntelligence/development/localOfficialAflTradePeriodCapture';
import { predecessorSeasonTraces } from '@/server/aflTradeIntelligence/development/localSeasonSourceDecision';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { requireAflTradeExternalIdentityReviewerAuthority } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import type { AflTradeOperationalGrant } from '@/server/aflTradeIntelligence/source/postgresOperationalGrantRepository';
import {
  approveNarrowAuthority,
  draftguruNationalYearAuthority,
  officialAflTradePeriodAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_intake_authority_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const sql = createPgAflOutcomeSqlClient(outcomesPool);
const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
const STORE_ID = 'intake-authority-store';
const GOVERNANCE_ROLE = 'afl_trade_nonproduction_governance_registry_writer';
let artifactRoot: string;
let evidenceIds: {
  productOwnerAuthorization: string;
  boundedCapturePlan: string;
  publicAccessReview: string;
  fieldBoundaryReview: string;
};
let predecessorDecisionId: string;
let predecessorRightsId: string;

const instant = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();
const DAY = 60 * 24;

async function retainEvidenceDocument(name: string): Promise<string> {
  const stored = await storeLocalAflTradeEvidence(sql, {
    storeId: STORE_ID,
    repositoryId: 'owner-evidence',
    artifactClass: 'capture_metadata',
    bytes: new TextEncoder().encode(`# ${name}\n\nSynthetic reviewed evidence.\n`),
    mediaType: 'text/markdown',
    maximumObjectBytes: 1024 * 1024,
  });
  return stored.reference.artifactId;
}

const timing = () => ({
  termsEffectiveAt: instant(-120),
  termsExpireAt: instant(DAY * 30),
  rightsProposedAt: instant(-100),
  proposalProposedAt: instant(-99),
});

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await outcomesPool.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${GOVERNANCE_ROLE}') THEN
      CREATE ROLE ${GOVERNANCE_ROLE} NOLOGIN;
    END IF;
  END $$`);
  await outcomesPool.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO ${GOVERNANCE_ROLE}`);
  await outcomesPool.query(
    `GRANT SELECT ON outcome_artifact_custody,outcome_review_decision,outcome_governed_evidence_reference TO ${GOVERNANCE_ROLE}`
  );
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-intake-authority-'));
  await registerLocalAflTradeArtifactStore(sql, { storeId: STORE_ID, rootDirectory: artifactRoot });
  await readBackLocalAflTradeArtifactCustody({ client: sql, storeId: STORE_ID });
  evidenceIds = {
    productOwnerAuthorization: await retainEvidenceDocument('authorization'),
    boundedCapturePlan: await retainEvidenceDocument('capture plan'),
    publicAccessReview: await retainEvidenceDocument('access review'),
    fieldBoundaryReview: await retainEvidenceDocument('field review'),
  };
  // The 2011-2025 trade-detail decision a 2026 decision is derived from.
  const authority = createDraftguruTradeAuthorityProposal({
    capabilityId: 'draftguru-trade-detail',
    parserVersion: DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION,
    seasons: Array.from({ length: 15 }, (_, index) => 2011 + index),
    evidenceIds,
    timing: timing(),
  });
  const decision = approveNarrowAuthority(authority, {
    decidedAt: instant(-90),
    revalidateAt: instant(DAY * 20),
  });
  await ledger.append({
    expectedRevision: (await ledger.load()).revision,
    ...authority,
    decision,
  });
  predecessorDecisionId = decision.decisionId;
  predecessorRightsId = authority.sourceRights.rightsArtifactId;
}, 120_000);

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
  await rm(artifactRoot, { recursive: true, force: true });
});

const seasonDecision = (
  overrides: Partial<Parameters<typeof recordSeasonSourceDecision>[1]> = {}
): Parameters<typeof recordSeasonSourceDecision>[1] => ({
  capabilityId: 'draftguru-trade-detail',
  season: 2026,
  fromSeason: 2025,
  approvalArtifactId: evidenceIds.productOwnerAuthorization,
  decidedAt: instant(-1),
  revalidateAt: instant(DAY * 10),
  apply: false,
  ...overrides,
});

describe('record-season-source-decision', () => {
  it('records a 2026 decision the runner accepts and leaves the 2011-2025 decision current', async () => {
    const approvalArtifactId = await retainEvidenceDocument('2026 approval');
    const before = await ledger.load();
    // One set of arguments: the ids are content addresses of the decided and revalidate instants.
    const args = seasonDecision({ approvalArtifactId });
    const dryRun = await recordSeasonSourceDecision(sql, args);
    expect(dryRun).toMatchObject({ status: 'dry_run', predecessorDecisionId });
    expect((await ledger.load()).revision).toBe(before.revision);

    const recorded = await recordSeasonSourceDecision(sql, { ...args, apply: true });
    if (recorded.status !== 'recorded' || dryRun.status !== 'dry_run') {
      throw new Error(`Expected a recorded decision: ${JSON.stringify(recorded)}`);
    }
    expect(recorded.decisionId).toBe(dryRun.decisionId);

    const now = new Date().toISOString();
    const accepted = await loadRecordedLocalCaptureAuthority(
      ledger,
      'draftguru-trade-detail',
      2026,
      now
    );
    expect(accepted.decisionId).toBe(recorded.decisionId);
    expect(accepted.authority.sourceRights.content.scope.seasonRanges).toEqual([
      { from: 2026, to: 2026 },
    ]);
    const proposal = accepted.authority.proposal;
    expect(predecessorSeasonTraces(proposal, { from: 2011, to: 2025 }, 2026)).toEqual([]);
    expect(JSON.stringify(proposal)).not.toContain(predecessorRightsId);
    const decision = (await ledger.load()).ledger.decisions.find(
      ({ decisionId }) => decisionId === recorded.decisionId
    );
    expect(decision?.content).toMatchObject({
      version: 1,
      supersedesDecisionId: null,
      authorityEvidenceIds: [approvalArtifactId],
    });
    // A new key, not a successor: the 2011-2025 decision is still what 2025 capture reads.
    expect(
      (await loadRecordedLocalCaptureAuthority(ledger, 'draftguru-trade-detail', 2025, now))
        .decisionId
    ).toBe(predecessorDecisionId);
  });

  it('refuses a second run, a past revalidation and unlocated evidence', async () => {
    const before = (await ledger.load()).revision;
    await expect(
      recordSeasonSourceDecision(sql, seasonDecision({ apply: true }))
    ).resolves.toMatchObject({ status: 'refused', reason: 'DECISION_KEY_EXISTS' });
    await expect(
      recordSeasonSourceDecision(
        sql,
        seasonDecision({ season: 2027, revalidateAt: instant(-5), apply: true })
      )
    ).resolves.toMatchObject({ status: 'refused', reason: 'REVALIDATE_NOT_FUTURE' });
    const missing = `artifact:${'e'.repeat(64)}`;
    await expect(
      recordSeasonSourceDecision(
        sql,
        seasonDecision({ season: 2027, approvalArtifactId: missing, apply: true })
      )
    ).resolves.toMatchObject({
      status: 'refused',
      reason: 'ARTIFACT_UNLOCATED',
      unlocatedArtifactIds: [missing],
    });
    expect((await ledger.load()).revision).toBe(before);
  });
});

describe('record-reviewer-grant', () => {
  const grant = (overrides: Partial<AflTradeOperationalGrant> = {}): AflTradeOperationalGrant => ({
    role: 'afl_trade_external_identity_reviewer',
    principalRef: 'statly-product-owner',
    provider: 'draftguru',
    validFromSeason: 2026,
    validThroughSeason: 2026,
    validThrough: instant(DAY * 60),
    approvalArtifactId: evidenceIds.productOwnerAuthorization,
    decidedBy: 'statly-product-owner',
    decidedAt: instant(-2),
    ...overrides,
  });
  const claim = (authorityEvidenceId: string, provider = 'draftguru') => ({
    authorityEvidenceId,
    principalRef: 'statly-product-owner',
    provider,
    competition: 'AFLM',
    validFromSeason: 2026,
    validThroughSeason: 2026,
    decidedAt: new Date().toISOString(),
    environment: 'non_production',
  });

  it('records a reviewer grant the identity-review authority check accepts', async () => {
    const reviewer = grant();
    const dryRun = await recordReviewerGrant(sql, {
      grant: reviewer,
      storeId: STORE_ID,
      apply: false,
    });
    expect(dryRun.status).toBe('dry_run');
    const recorded = await recordReviewerGrant(sql, {
      grant: reviewer,
      storeId: STORE_ID,
      apply: true,
    });
    expect(recorded).toEqual({
      status: 'recorded',
      authorityEvidenceId: dryRun.authorityEvidenceId,
    });

    await expect(
      sql.transaction((transaction) =>
        requireAflTradeExternalIdentityReviewerAuthority(
          transaction,
          claim(recorded.authorityEvidenceId)
        )
      )
    ).resolves.toBeUndefined();
    await expect(
      sql.transaction((transaction) =>
        requireAflTradeExternalIdentityReviewerAuthority(
          transaction,
          claim(recorded.authorityEvidenceId, 'footyinfo')
        )
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' });
    await expect(
      recordReviewerGrant(sql, { grant: reviewer, storeId: STORE_ID, apply: true })
    ).resolves.toMatchObject({ status: 'already_recorded' });

    const promoter = await recordReviewerGrant(sql, {
      grant: grant({ role: 'afl_trade_canonical_promoter', provider: 'multi_source' }),
      storeId: STORE_ID,
      apply: true,
    });
    expect(promoter.status).toBe('recorded');
  });

  it('refuses a grant whose term has already ended', async () => {
    await expect(
      recordReviewerGrant(sql, {
        grant: grant({ provider: 'footyinfo', decidedAt: instant(-60), validThrough: instant(-5) }),
        storeId: STORE_ID,
        apply: true,
      })
    ).resolves.toMatchObject({ status: 'refused', reason: 'VALID_THROUGH_NOT_FUTURE' });
  });
});

describe('report-intake-authority', () => {
  it('reports accepted decisions and current grants', async () => {
    const report = await reportIntakeAuthority(sql, {
      capabilities: [
        { capabilityId: 'draftguru-trade-detail', season: 2026 },
        { capabilityId: 'draftguru-trade-detail', season: 2025 },
      ],
      completionId: null,
      at: null,
    });
    expect(report.current).toBe(true);
    expect(
      report.capabilities.map(({ accepted, successorPresent }) => [accepted, successorPresent])
    ).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(report.capabilities[0]?.termsExpireAt).not.toBeNull();
    expect(
      report.grants.map(({ role, provider, validFromSeason, currentAt }) => [
        role,
        provider,
        validFromSeason,
        currentAt,
      ])
    ).toEqual([
      ['afl_trade_canonical_promoter', 'multi_source', 2026, true],
      ['afl_trade_external_identity_reviewer', 'draftguru', 2026, true],
    ]);
  });

  it('flags an expired revalidation, a successor and a completion that is not current', async () => {
    // The ledger head only moves forward in time, and earlier tests decided a minute ago.
    const first = officialAflTradePeriodAuthority({ season: 2026, evidenceIds, timing: timing() });
    const firstDecision = approveNarrowAuthority(first, {
      decidedAt: instant(-0.5),
      revalidateAt: instant(DAY * 20),
    });
    await ledger.append({
      expectedRevision: (await ledger.load()).revision,
      ...first,
      decision: firstDecision,
    });
    const second = officialAflTradePeriodAuthority({
      season: 2026,
      version: 2,
      evidenceIds,
      timing: timing(),
    });
    await ledger.append({
      expectedRevision: (await ledger.load()).revision,
      ...second,
      decision: approveNarrowAuthority(second, {
        decidedAt: instant(-0.25),
        revalidateAt: instant(DAY * 20),
        supersedes: firstDecision.decisionId,
      }),
    });

    const missingCompletion = `external-historical-capture-completion:${'f'.repeat(64)}`;
    const report = await reportIntakeAuthority(sql, {
      capabilities: [
        { capabilityId: 'draftguru-trade-detail', season: 2026 },
        { capabilityId: OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY, season: 2026 },
      ],
      completionId: missingCompletion,
      // After the 2026 trade-detail revalidation, before the others'.
      at: instant(DAY * 11),
    });
    expect(report.current).toBe(false);
    expect(report.capabilities[0]).toMatchObject({ accepted: false, version: 1 });
    expect(report.capabilities[0]?.refusal).toMatch(/decision_expired/u);
    expect(report.capabilities[1]).toMatchObject({
      accepted: true,
      version: 2,
      successorPresent: true,
    });
    expect(report.completion).toEqual({
      completionId: missingCompletion,
      at: report.at,
      current: false,
      staleTargets: [],
    });
  });
});

describe('record-season-source-decision with a parser change', () => {
  const V8 = 'draftguru-national-year-page/v8';
  const yearPageDecision = (
    overrides: Partial<Parameters<typeof recordSeasonSourceDecision>[1]> = {}
  ) =>
    seasonDecision({
      capabilityId: 'draftguru-national-year-page',
      season: 2026,
      fromSeason: 2019,
      // After the predecessor below: the Gate ledger appends in time order.
      decidedAt: instant(-0.01),
      ...overrides,
    });

  beforeAll(async () => {
    // The 2019 year-page decision at parser v3 that the 2026 decision is derived from.
    const authority = draftguruNationalYearAuthority({
      season: 2019,
      evidenceIds,
      // After every record the earlier blocks append: the Gate ledger appends in time order.
      timing: { ...timing(), rightsProposedAt: instant(-0.05), proposalProposedAt: instant(-0.04) },
    });
    await ledger.append({
      expectedRevision: (await ledger.load()).revision,
      ...authority,
      decision: approveNarrowAuthority(authority, {
        decidedAt: instant(-0.03),
        revalidateAt: instant(DAY * 20),
      }),
    });
  });

  it('refuses a parser the runner does not read for the season', async () => {
    const before = (await ledger.load()).revision;
    await expect(recordSeasonSourceDecision(sql, yearPageDecision())).resolves.toMatchObject({
      status: 'refused',
      reason: 'PARSER_NOT_RUNNER',
      message: expect.stringContaining(`pass --parser-version ${V8}`),
    });
    await expect(
      recordSeasonSourceDecision(
        sql,
        yearPageDecision({ parserVersion: 'draftguru-national-year-page/v4', apply: true })
      )
    ).resolves.toMatchObject({ status: 'refused', reason: 'PARSER_NOT_RUNNER' });
    expect((await ledger.load()).revision).toBe(before);
  });

  it('records the 2026 parser-v8 decision the runner accepts', async () => {
    const args = yearPageDecision({ parserVersion: V8 });
    const dryRun = await recordSeasonSourceDecision(sql, args);
    expect(dryRun).toMatchObject({ status: 'dry_run' });
    const recorded = await recordSeasonSourceDecision(sql, { ...args, apply: true });
    if (recorded.status !== 'recorded' || dryRun.status !== 'dry_run') {
      throw new Error(`Expected a recorded decision: ${JSON.stringify(recorded)}`);
    }
    expect(recorded.decisionId).toBe(dryRun.decisionId);
    const accepted = await loadRecordedLocalCaptureAuthority(
      ledger,
      'draftguru-national-year-page',
      2026,
      new Date().toISOString()
    );
    expect(accepted.decisionId).toBe(recorded.decisionId);
    expect(accepted.authority.proposal.content.decisionKey).toBe(
      'draftguru-national-year-page-issue579-private-2026-parser-v8'
    );
    expect(accepted.authority.sourceRights.content.acquisition).toMatchObject({
      clientVersion: V8,
    });
  });
});
