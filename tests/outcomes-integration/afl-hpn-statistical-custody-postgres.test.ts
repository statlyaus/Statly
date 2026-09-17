import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeHpnStatisticalAdjudicationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalAdjudicationRepository';
import {
  createAflTradeHpnStatisticalCell,
  createAflTradeHpnStatisticalDecision,
} from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';
import { fixture } from '../testUtils/hpnStatisticalAdjudicationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { inspectAflTradeHpnStatisticalIdentity } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalIdentityInspection';
import { setup as sourceFixture } from '../testUtils/hpnStatisticalSourceFixture';
import {
  seedHpnStatisticalReviewer,
  finishAsNonproductionGovernance,
} from '../testUtils/hpnStatisticalReviewerFixture';

const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `hpn_statistical_custody_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const repository = new PostgresAflTradeHpnStatisticalAdjudicationRepository(
  createPgAflOutcomeSqlClient(pool)
);
const f = fixture();
const reader = {
  read: async (reference: { artifactId: string }) => {
    const bytes = f.evidenceBytes.get(reference.artifactId);
    if (!bytes) throw new Error('Synthetic evidence missing.');
    return bytes;
  },
};
async function prepareGovernanceRole(targetSchema: string) {
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN
      CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
    END IF;
  END $$`);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${targetSchema}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(`GRANT SELECT ON "${targetSchema}".outcome_review_decision,
    "${targetSchema}".outcome_governed_evidence_reference TO afl_trade_nonproduction_governance_registry_writer`);
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await prepareGovernanceRole(schema);
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('retains concurrent exact replays once and reads them without granting authority', async () => {
  const results = await Promise.all([
    repository.retainUnverified(f.result, reader),
    repository.retainUnverified(f.result, reader),
  ]);
  expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
  expect(results[0].registeredAt).toBe(results[1].registeredAt);
  expect(await repository.loadUnverified(f.result.decisionId, reader)).toEqual({
    decision: f.result,
    registeredAt: results[0].registeredAt,
    status: 'retained_unverified',
    calculationEligible: false,
    publicationEligible: false,
  });
  expect(await repository.loadUnverified('absent', reader)).toBeNull();
});

it('checks evidence again on replay/read and rejects modified decisions before insertion', async () => {
  await repository.retainUnverified(f.result, reader);
  const alteredReader = { read: async () => new Uint8Array([1]) };
  await expect(repository.retainUnverified(f.result, alteredReader)).rejects.toThrow('altered');
  await expect(repository.loadUnverified(f.result.decisionId, alteredReader)).rejects.toThrow(
    'altered'
  );
  await expect(
    repository.retainUnverified({ ...f.result, selectedValue: 99 }, reader)
  ).rejects.toThrow();
});

it('retains competing submissions without selecting or superseding a current decision', async () => {
  await repository.retainUnverified(f.result, reader);
  const alternative = createAflTradeHpnStatisticalDecision(
    {
      ...f.input,
      rationale: 'A separate unverified submission.',
      supersedesDecisionId: f.result.decisionId,
    },
    f.evidenceBytes
  );
  expect(await repository.retainUnverified(alternative, reader)).toMatchObject({
    status: 'retained_unverified',
    calculationEligible: false,
  });
  expect((await repository.loadUnverified(f.result.decisionId, reader))?.decision).toEqual(
    f.result
  );
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM outcome_hpn_statistical_decision_custody'
      )
    ).rows[0].count
  ).toBe(2);
});

it.each([
  'UPDATE outcome_hpn_statistical_decision_custody SET registered_at=registered_at',
  'DELETE FROM outcome_hpn_statistical_decision_custody',
  'TRUNCATE outcome_hpn_statistical_decision_custody CASCADE',
])('rejects mutation: %s', async (sql) => {
  await repository.retainUnverified(f.result, reader);
  await expect(pool.query(sql)).rejects.toThrow('immutable');
});

it('does not authenticate retained decisions whose source runs are absent', async () => {
  const { candidateId: _id, ...body } = f.candidate;
  const candidate = createAflTradeHpnStatisticalCell({
    ...body,
    scope: { ...body.scope, competitionId: 'AFLM' },
  });
  const decision = createAflTradeHpnStatisticalDecision({ ...f.input, candidate }, f.evidenceBytes);
  await repository.retainUnverified(decision, reader);
  await expect(repository.inspectRetainedSources(decision.decisionId, reader)).rejects.toThrow(
    'One or more reviewed source runs'
  );
  expect(await repository.loadUnverified(decision.decisionId, reader)).toMatchObject({
    status: 'retained_unverified',
    calculationEligible: false,
  });
});

it('executes shared current-resolution SQL and rejects absent identity context', async () => {
  const source = sourceFixture();
  await expect(
    createPgAflOutcomeSqlClient(pool).transaction((transaction) =>
      inspectAflTradeHpnStatisticalIdentity(
        transaction,
        source.cell,
        source.cell.primary.providerDecodedRowId,
        source.maps[0],
        source.state.rows[0].typed_payload
      )
    )
  ).rejects.toThrow('Exact statistical identity context is unavailable');
});

it('rejects direct SQL content/address drift and attempted authority escalation', async () => {
  for (const overrides of [
    { authority: 'approved' },
    { authority: null },
    { publicationEligible: true },
    { selectedValue: 99 },
  ]) {
    const { decisionId: _id, ...body } = { ...f.result, ...overrides };
    const decision = {
      ...body,
      decisionId: createAflTradeContentAddress('hpn-statistical-decision', body),
    };
    await expect(
      pool.query(
        `INSERT INTO outcome_hpn_statistical_decision_custody
       (decision_id,scope_key,decision_canonical_json,decision_json) VALUES ($1,$2,$3::text,($3::text)::jsonb)`,
        [
          decision.decisionId,
          createAflTradeContentAddress('hpn-statistical-scope', f.candidate.scope),
          canonicalizeAflTradeJson(decision),
        ]
      )
    ).rejects.toThrow('outcome_hpn_statistical_custody_integrity');
  }
  await expect(
    pool.query(
      `INSERT INTO outcome_hpn_statistical_decision_custody
     (decision_id,scope_key,decision_canonical_json,decision_json) VALUES ($1,$2,$3::text,($3::text)::jsonb)`,
      ['wrong-id', 'wrong-scope', canonicalizeAflTradeJson(f.result)]
    )
  ).rejects.toThrow('outcome_hpn_statistical_custody_integrity');
});

it('keeps supersession chronology ordered after migration', async () => {
  const result = await pool.query(
    `SELECT pg_get_functiondef('validate_outcome_hpn_statistical_current_selection()'::regprocedure) AS definition`
  );
  const definition = result.rows[0].definition as string;
  expect(definition).toContain('OLD.applied_at');
  expect(definition).toContain('predecessor.decision_json');
});

it('round-trips an independent migrated schema with the original registration timestamps', async () => {
  await repository.retainUnverified(f.result, reader);
  const { candidateId: _id, ...body } = f.candidate;
  const candidate = createAflTradeHpnStatisticalCell({
    ...body,
    scope: { ...body.scope, competitionId: 'AFLM' },
  });
  const decision = createAflTradeHpnStatisticalDecision({ ...f.input, candidate }, f.evidenceBytes);
  await repository.retainUnverified(decision, reader);
  const grant = await seedHpnStatisticalReviewer(
    createPgAflOutcomeSqlClient(pool),
    'restore-current'
  );
  const restoreSchema = `${schema}_restore`;
  const restored = new Pool({ connectionString: url, options: `-c search_path=${restoreSchema}` });
  try {
    await admin.query(`CREATE SCHEMA "${restoreSchema}"`);
    const scoped = new URL(url!);
    scoped.searchParams.set('schema', restoreSchema);
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
    await prepareGovernanceRole(restoreSchema);
    const rows = (
      await pool.query(
        'SELECT * FROM outcome_hpn_statistical_decision_custody ORDER BY decision_id'
      )
    ).rows;
    for (const row of rows) {
      await restored.query(
        `INSERT INTO outcome_hpn_statistical_decision_custody
        (decision_id,scope_key,decision_canonical_json,decision_json,registered_at)
        VALUES ($1,$2,$3,$4,$5)`,
        [
          row.decision_id,
          row.scope_key,
          row.decision_canonical_json,
          row.decision_json,
          row.registered_at,
        ]
      );
    }
    expect(
      (
        await restored.query(
          'SELECT * FROM outcome_hpn_statistical_decision_custody ORDER BY decision_id'
        )
      ).rows
    ).toEqual(rows);
    const restoredRepository = new PostgresAflTradeHpnStatisticalAdjudicationRepository(
      createPgAflOutcomeSqlClient(restored)
    );
    expect(await restoredRepository.loadUnverified(f.result.decisionId, reader)).toEqual(
      await repository.loadUnverified(f.result.decisionId, reader)
    );
    await createPgAflOutcomeSqlClient(restored).transaction(async (transaction) => {
      for (const [table, key, id] of [
        [
          'outcome_artifact_custody',
          'artifact_id',
          `artifact:${grant.context.authorityEvidenceId.split(':')[1]}`,
        ],
        ['outcome_review_decision', 'decision_id', grant.approvalId],
        ['outcome_governed_evidence_reference', 'reference_id', grant.context.authorityEvidenceId],
        [
          'outcome_operational_principal_authority',
          'authority_evidence_id',
          grant.context.authorityEvidenceId,
        ],
      ]) {
        const record = (await pool.query(`SELECT * FROM ${table} WHERE ${key}=$1`, [id])).rows[0];
        await transaction.query(
          `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,
          [JSON.stringify(record)]
        );
      }
      await finishAsNonproductionGovernance(transaction);
    });
    const decisionId = decision.decisionId;
    expect(
      await restoredRepository.inspectReviewerAuthority(decisionId, grant.context, reader)
    ).toEqual(await repository.inspectReviewerAuthority(decisionId, grant.context, reader));
  } finally {
    await restored.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${restoreSchema}" CASCADE`);
  }
}, 120000);

it('requires a current independently governed statistical reviewer without approving the decision', async () => {
  const { candidateId: _id, ...body } = f.candidate;
  const candidate = createAflTradeHpnStatisticalCell({
    ...body,
    scope: { ...body.scope, competitionId: 'AFLM' },
  });
  const decision = createAflTradeHpnStatisticalDecision({ ...f.input, candidate }, f.evidenceBytes);
  await repository.retainUnverified(decision, reader);
  const client = createPgAflOutcomeSqlClient(pool);
  const grant = await seedHpnStatisticalReviewer(client, 'current');
  expect(
    await repository.inspectReviewerAuthority(decision.decisionId, grant.context, reader)
  ).toMatchObject({
    status: 'reviewer_authority_matches',
    decisionStatus: 'retained_unverified',
    calculationEligible: false,
  });
  await expect(
    repository.inspectReviewerAuthority(
      decision.decisionId,
      { ...grant.context, principalRef: 'different-operator' },
      reader
    )
  ).rejects.toThrow('governed authority');
  for (const [label, options] of [
    ['identity-role', { role: 'afl_trade_identity_reviewer' }],
    ['wrong-season', { season: 2019 }],
    ['late-grant', { validFrom: '2026-09-16T02:30:00.000Z' }],
    ['late-approval', { approvedAt: '2026-09-16T02:30:00.000Z' }],
    ['late-verification', { verifiedAt: '2026-09-16T02:30:00.000Z' }],
    ['expired', { validThrough: '2026-09-16T02:30:00.000Z' }],
    ['unbound-expiry', { storedValidThrough: '2099-01-01T00:00:00.000Z' }],
  ] as const) {
    const other = await seedHpnStatisticalReviewer(client, label, options);
    await expect(
      repository.inspectReviewerAuthority(decision.decisionId, other.context, reader)
    ).rejects.toThrow('governed authority');
  }
  await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
    VALUES ($1,'governed_evidence_reference',$2,'rejected',$3,'Synthetic withdrawal','{}','fixture-governance-reviewer',clock_timestamp())`,
      [
        createAflTradeContentAddress('review-decision', { withdraw: grant.approvalId }),
        grant.context.authorityEvidenceId,
        grant.approvalId,
      ]
    );
    await finishAsNonproductionGovernance(transaction);
  });
  await expect(
    repository.inspectReviewerAuthority(decision.decisionId, grant.context, reader)
  ).rejects.toThrow('governed authority');
});

it.each([
  ['integer', '0', 0, true],
  ['integer', '7', 7, true],
  ['finite_number', '7e0', 7, true],
  ['text', '7', 7, false],
  ['factor', '7', 7, false],
  ['integer', 7, 7, false],
  ['integer', '7.0', 7, false],
  ['finite_number', 'NaN', 7, false],
  ['finite_number', 'Infinity', 7, false],
  ['finite_number', '1.5', 1.5, false],
  ['integer', '-1', -1, false],
  ['integer', '9007199254740992', 9007199254740992, false],
  ['integer', '7', 8, false],
])(
  'authenticates numeric scalar kind %s and literal %s',
  async (kind, value, expected, accepted) => {
    const result = await pool.query(
      'SELECT outcome_hpn_statistical_numeric_scalar_matches($1::jsonb,$2,$3::jsonb) AS valid',
      [JSON.stringify({ values: { CLR: { kind, value } } }), 'CLR', JSON.stringify(expected)]
    );
    expect(result.rows[0].valid).toBe(accepted);
  }
);
it('rejects ambiguous scalar envelopes and string-valued expectations', async () => {
  for (const [payload, expected] of [
    [{ CLR: 7, values: { CLR: { kind: 'integer', value: '7' } } }, 7],
    [{ values: { CLR: { kind: 'integer', value: '7' } } }, '7'],
    [{ values: {} }, 7],
  ]) {
    const result = await pool.query(
      'SELECT outcome_hpn_statistical_numeric_scalar_matches($1::jsonb,$2,$3::jsonb) AS valid',
      [JSON.stringify(payload), 'CLR', JSON.stringify(expected)]
    );
    expect(result.rows[0].valid).toBe(false);
  }
});

it('canonicalizes nested custody JSON with pg_restore empty search_path', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL search_path TO ''");
    const value = { z: [{ b: 2, a: 1 }], a: { nested: true } };
    const result = await client.query(
      `SELECT "${schema}".outcome_afl_trade_canonical_json($1::jsonb) AS canonical`,
      [JSON.stringify(value)]
    );
    expect(result.rows[0].canonical).toBe(canonicalizeAflTradeJson(value));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
