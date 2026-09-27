import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeContentAddress as address } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createRetainedFitzRoyPrivateUseRenewal } from '@/server/aflTradeIntelligence/source/retainedFitzRoyPrivateUseRenewal';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_successor_rights_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);
const options = { profile: 'completed_match_result' as const };
const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
const original = {
  sourceRights: fixture.command.capture.sourceRights,
  proposal: fixture.command.capture.ledger.proposals[0]!,
  decision: fixture.command.capture.ledger.decisions[0]!,
};
const consumed = JSON.stringify(['home_points', 'away_points']);
const DAY = 86_400_000;
let captureId: string;

type Record = typeof original;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [original],
  });
  captureId = (await stageLocalAflTradeFitzRoyFixture(client, options)).staging.capture.captureId;
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
});

/**
 * A later general Gate 0A for the same source, superseding `predecessor`: the original scope and
 * rights re-issued under new terms, with no retained-capture dimensions.
 */
function generalSuccessor(
  predecessor: Record,
  input: {
    effectiveAt: string;
    revalidateAt: string;
    dropSeason?: boolean;
    dropDerivedFeatures?: boolean;
    state?: 'approved' | 'blocked';
    /** Rights terms, when they should differ from the decision window. */
    rightsTerms?: { effectiveAt: string; expireAt: string };
  }
): Record {
  const rightsContent = {
    ...structuredClone(original.sourceRights.content),
    termsEffectiveAt: input.rightsTerms?.effectiveAt ?? input.effectiveAt,
    termsExpireAt: input.rightsTerms?.expireAt ?? input.revalidateAt,
    proposedAt: input.rightsTerms?.effectiveAt ?? input.effectiveAt,
  };
  const sourceRights = {
    content: rightsContent,
    rightsArtifactId: address('source-rights', rightsContent),
  };
  const proposalContent = structuredClone(original.proposal.content);
  proposalContent.version = predecessor.decision.content.version + 1;
  proposalContent.proposedAt = input.effectiveAt;
  proposalContent.scope.dimensions = proposalContent.scope.dimensions.map((d) => {
    if (d.name === 'source_rights_artifact')
      return { ...d, values: [sourceRights.rightsArtifactId] };
    if (d.name === 'season' && input.dropSeason)
      return { ...d, values: d.values.map((value) => (value === '2026' ? '1999' : value)) };
    if (d.name === 'operation' && input.dropDerivedFeatures)
      return { ...d, values: d.values.filter((value) => value !== 'derived_feature_creation') };
    return d;
  });
  proposalContent.affectedArtifacts = [
    { kind: 'source_rights', artifactId: sourceRights.rightsArtifactId },
  ];
  const proposal = {
    content: proposalContent,
    proposalId: address('gate-proposal', proposalContent),
  };
  const decisionContent = {
    ...structuredClone(original.decision.content),
    proposalId: proposal.proposalId,
    version: proposalContent.version,
    scope: proposalContent.scope,
    affectedArtifacts: proposalContent.affectedArtifacts,
    state: input.state ?? 'approved',
    decidedAt: input.effectiveAt,
    effectiveAt: input.effectiveAt,
    revalidateAt: input.revalidateAt,
    supersedesDecisionId: predecessor.decision.decisionId,
  };
  const decision = {
    content: decisionContent,
    decisionId: address('gate-decision', decisionContent),
  };
  return { sourceRights, proposal, decision } as Record;
}

/** Runs `work` in a transaction that is always rolled back, so each case starts from the origin. */
async function inRolledBackTransaction(
  work: (scoped: AflOutcomeSqlClient, now: number) => Promise<void>
) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const scoped: AflOutcomeSqlClient = {
      query: async <Row>(sql: string, parameters?: readonly unknown[]) => {
        const result = await connection.query(sql, parameters as unknown[]);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      },
      transaction: (callback) => callback(scoped),
    };
    const now = Date.parse(
      (
        await scoped.query<{ at: string }>(
          `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
        )
      ).rows[0]!.at
    );
    await work(scoped, now);
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
}

async function append(scoped: AflOutcomeSqlClient, ...records: Record[]) {
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(scoped);
  for (const record of records) {
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [record],
    });
  }
}

function renewalAt(renewedAt: string): Record {
  return createRetainedFitzRoyPrivateUseRenewal({
    ...original,
    captureId,
    renewedAt,
    accountableOwner: 'synthetic-renewal-owner',
    authorityEvidenceId: `artifact:${'a'.repeat(64)}`,
    reviewer: {
      id: 'synthetic-agent-reviewer',
      role: 'source-control-review',
      evidenceId: `artifact:${'b'.repeat(64)}`,
    },
  }) as unknown as Record;
}

async function requireFields(scoped: AflOutcomeSqlClient, fields = consumed) {
  // A failure aborts the transaction, so the role is reset only after success.
  await scoped.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
  const result = await scoped.query(
    'SELECT require_outcome_private_hpn_source_fields($1,$2::jsonb)',
    [captureId, fields]
  );
  await scoped.query('RESET ROLE');
  return result;
}

const iso = (ms: number) => new Date(ms).toISOString();

// Synthetic bytes and reviews only. The real ledger, source-capture and private-use guards stay enabled.
it('lets a current general successor of a renewal govern the retained capture', async () => {
  await inRolledBackTransaction(async (scoped, now) => {
    const renewal = renewalAt(iso(now - 2_000));
    const successor = generalSuccessor(renewal, {
      effectiveAt: iso(now - 1_000),
      revalidateAt: iso(now + 365 * DAY),
    });
    await append(scoped, renewal, successor);
    await expect(requireFields(scoped)).resolves.toBeDefined();
    // Still bounded by the successor's own rights: an unreviewed field stays blocked.
    await scoped.query('SAVEPOINT unreviewed');
    await expect(requireFields(scoped, JSON.stringify(['unreviewed_field']))).rejects.toThrow(
      'Source-first factual source rights are no longer current'
    );
    await scoped.query('ROLLBACK TO SAVEPOINT unreviewed');
  });
});

it('keeps the original-plus-renewal chain working unchanged', async () => {
  await inRolledBackTransaction(async (scoped, now) => {
    await append(scoped, renewalAt(iso(now - 1_000)));
    await expect(requireFields(scoped)).resolves.toBeDefined();
  });
});

it.each([
  // The rights terms stay current in both date faults, so only the decision window can refuse them.
  ['expired', { offset: -3 * DAY, length: 2 * DAY, currentRights: true }],
  ['not yet effective', { offset: DAY, length: 365 * DAY, currentRights: true }],
  ['missing the capture season', { offset: -1_000, length: 365 * DAY, dropSeason: true }],
  [
    'missing derived feature creation',
    { offset: -1_000, length: 365 * DAY, dropDerivedFeatures: true },
  ],
] as const)('refuses a %s general successor', async (_label, fault) => {
  await inRolledBackTransaction(async (scoped, now) => {
    const renewal = renewalAt(iso(now - 5 * DAY));
    const effectiveAt = now + fault.offset;
    const successor = generalSuccessor(renewal, {
      effectiveAt: iso(effectiveAt),
      revalidateAt: iso(effectiveAt + fault.length),
      dropSeason: 'dropSeason' in fault,
      dropDerivedFeatures: 'dropDerivedFeatures' in fault,
      ...('currentRights' in fault
        ? { rightsTerms: { effectiveAt: iso(now - 4 * DAY), expireAt: iso(now + 365 * DAY) } }
        : {}),
    });
    await append(scoped, renewal, successor);
    await expect(requireFields(scoped)).rejects.toThrow(
      'Source-first factual source rights are no longer current'
    );
  });
});

it('refuses when a blocked decision supersedes the current general successor', async () => {
  await inRolledBackTransaction(async (scoped, now) => {
    const renewal = renewalAt(iso(now - 3_000));
    const successor = generalSuccessor(renewal, {
      effectiveAt: iso(now - 2_000),
      revalidateAt: iso(now + 365 * DAY),
    });
    const blocked = generalSuccessor(successor, {
      effectiveAt: iso(now - 1_000),
      revalidateAt: iso(now + 365 * DAY),
      state: 'blocked',
    });
    await append(scoped, renewal, successor, blocked);
    await expect(requireFields(scoped)).rejects.toThrow(
      'Source-first factual source rights are no longer current'
    );
  });
});
