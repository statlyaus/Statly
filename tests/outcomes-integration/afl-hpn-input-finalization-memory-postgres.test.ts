import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { buildAppearanceMembershipHpnInputFixture } from '../testUtils/appearanceMembershipHpnInputFixture';
import {
  inflateHpnInputSetToSeasonScale,
  measureHpnInputFinalization,
  stubHpnRowAuthorities,
} from '../testUtils/hpnInputSetScaleFixture';
import { loadPre0238HpnFinalizationDefinition } from '../testUtils/pre0238HpnFinalizationReference';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

// Migration 0238 bounds HPN PAV season input finalization to memory and time proportional to its
// content. This suite builds one genuine input set through every owner, inflates it to further
// input sets (see inflateHpnInputSetToSeasonScale), and runs the deployed finalization beside the
// exact pre-0238 definition, derived from the deployed one by reversing 0238's own fragments.
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const instant = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};
let sourceInputSetId: string;
let pre0238Finalization: string;

// A genuine AFLM season: 216 completed matches, 23 players a side from two providers.
const SEASON_MATCHES = 216;
// The finalizing backend's peak resident set, including the shared buffers it touches. The
// pre-0238 finalization is cancelled once it exceeds this bound.
const SEASON_PEAK_RESIDENT_KIB = 1024 * 1024;
const SEASON_FINALIZATION_MS = 5 * 60 * 1000;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const { built } = await buildAppearanceMembershipHpnInputFixture({ pool, client, instant });
  sourceInputSetId = built.inputSet.inputSetId;
  pre0238Finalization = await loadPre0238HpnFinalizationDefinition(pool);
}, 300_000);
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

const FINALIZE = `UPDATE outcome_hpn_pav_input_set SET status='finalized', finalized_at=created_at
  WHERE input_set_id=$1 AND status='building'`;

/**
 * Applies one tampering to the building input set, then finalizes it with the deployed and with
 * the pre-0238 definition, each inside its own savepoint of the caller's transaction.
 */
async function finalizationOutcomes(
  session: PoolClient,
  inputSetId: string,
  tamper: string | null,
  finalize = FINALIZE
): Promise<{ deployed: string | null; original: string | null }> {
  await session.query('SAVEPOINT tampered');
  try {
    if (tamper) {
      // The tampered records are append-only; their guards are bypassed only for the tampering.
      await session.query(`SET LOCAL session_replication_role='replica'`);
      await session.query(tamper, [inputSetId]);
      await session.query(`SET LOCAL session_replication_role='origin'`);
    }
    const outcome = async (definition: string | null) => {
      await session.query('SAVEPOINT variant');
      try {
        if (definition) await session.query(definition);
        await session.query(finalize, [inputSetId]);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        await session.query('ROLLBACK TO SAVEPOINT variant');
      }
    };
    return { deployed: await outcome(null), original: await outcome(pre0238Finalization) };
  } finally {
    await session.query('ROLLBACK TO SAVEPOINT tampered');
  }
}

const tamperContent = (path: string, value: string) =>
  `UPDATE outcome_hpn_pav_input_set SET input_set_json=jsonb_set(input_set_json,'${path}','${value}')
    WHERE input_set_id=$1`;
const lastPlayerSpell = `(SELECT row_json#>>'{acquisitionSpell,spellVersionId}'
  FROM outcome_hpn_pav_input_row WHERE input_set_id=$1 AND row_kind='player_match_stats'
  ORDER BY ordinal DESC LIMIT 1)`;

it('keeps every finalization outcome identical to the pre-0238 finalization', async () => {
  // Everything here is rolled back, so the season test's runs and universe stay exact.
  const session = await pool.connect();
  await session.query('BEGIN');
  try {
    await stubHpnRowAuthorities(session);
    const inputSetId = await inflateHpnInputSetToSeasonScale(session, sourceInputSetId, {
      label: 'finalization-identity',
      matches: 2,
    });
    const cases: Array<{
      name: string;
      tamper: string | null;
      finalize?: string;
      expected: RegExp | null;
    }> = [
      { name: 'valid input', tamper: null, expected: null },
      {
        name: 'finalization changes another column',
        tamper: null,
        finalize: FINALIZE.replace(
          'finalized_at=created_at',
          `finalized_at=created_at,input_set_canonical_json=input_set_canonical_json||' '`
        ),
        expected: /only one exact finalization transition/,
      },
      {
        name: 'appearance envelope names its fact as a number',
        tamper: tamperContent('{content,factualUniverse,playerAppearanceFacts,-1,factIds}', '[1]'),
        expected: /appearance facts do not equal/,
      },
      {
        name: 'appearance envelope names another club',
        tamper: tamperContent(
          '{content,factualUniverse,playerAppearanceFacts,-1,clubId}',
          '"afl-club:x"'
        ),
        expected: /appearance facts do not equal/,
      },
      {
        name: 'match envelope names another instant',
        tamper: tamperContent(
          '{content,factualUniverse,completedMatchFacts,-1,effectiveAt}',
          '"2026-01-01T00:00:00.000Z"'
        ),
        expected: /completed-match facts do not equal/,
      },
      {
        name: 'source run envelope differs',
        tamper: tamperContent('{content,sourceRuns,0,stagingSha256}', '"0"'),
        expected: /source run is incomplete/,
      },
      {
        name: 'source run envelope names another run',
        tamper: tamperContent(
          '{content,sourceRuns,0,normalizationRunId}',
          '"provider-normalization-run:x"'
        ),
        expected: /source run is incomplete/,
      },
      {
        name: 'field map envelope differs',
        tamper: tamperContent('{content,fieldMaps,0,content,limitation}', '"changed"'),
        expected: /source run is incomplete/,
      },
      {
        name: 'result row differs in content',
        tamper: tamperContent('{content,rows,-1,homePoints}', '999'),
        expected: /rows do not exactly conserve/,
      },
      {
        name: 'player row differs in content',
        tamper: tamperContent('{content,rows,-2,stats,marks}', '999'),
        expected: /rows do not exactly conserve/,
      },
      {
        name: 'content row carries an extra key and still contains its row',
        tamper: tamperContent('{content,rows,-2,extra}', 'true'),
        expected: null,
      },
      {
        name: 'completed match envelope names another club',
        tamper: tamperContent('{content,completedMatches,-1,homeClubId}', '"afl-club:x"'),
        expected: /completed-match membership mismatch/,
      },
      {
        name: 'player spell recorded after the knowledge cutoff',
        tamper: `UPDATE outcome_acquisition_spell_version
        SET recorded_at=recorded_at+INTERVAL '10 years' WHERE spell_version_id=${lastPlayerSpell}`,
        expected: /acquisition spell is not exact and current/,
      },
      {
        name: 'appearance membership loses a fact',
        tamper: `DELETE FROM outcome_hpn_pav_input_factual_appearance_member
        WHERE input_set_id=$1 AND ordinal=(SELECT max(ordinal)
          FROM outcome_hpn_pav_input_factual_appearance_member WHERE input_set_id=$1)`,
        expected: /counts do not match durable membership/,
      },
    ];
    for (const { name, tamper, finalize, expected } of cases) {
      const { deployed, original } = await finalizationOutcomes(
        session,
        inputSetId,
        tamper,
        finalize
      );
      expect({ name, deployed }).toEqual({ name, deployed: original });
      expect({ name, deployed }).toEqual({
        name,
        deployed: expected ? expect.stringMatching(expected) : null,
      });
    }
  } finally {
    await session.query('ROLLBACK');
    session.release();
  }
}, 600_000);

it('finalizes a genuine-scale season in bounded memory and time where the pre-0238 finalization did not', async () => {
  const session = await pool.connect();
  let inputSetId: string;
  try {
    await session.query('BEGIN');
    inputSetId = await inflateHpnInputSetToSeasonScale(session, sourceInputSetId, {
      label: 'finalization-season',
      matches: SEASON_MATCHES,
    });
    await session.query('COMMIT');
  } catch (error) {
    await session.query('ROLLBACK');
    throw error;
  } finally {
    session.release();
  }
  const size = await pool.query<{ rows: number; content_bytes: number }>(
    `SELECT (SELECT count(*)::INTEGER FROM outcome_hpn_pav_input_row WHERE input_set_id=$1) AS rows,
            octet_length(input_set_canonical_json) AS content_bytes
       FROM outcome_hpn_pav_input_set WHERE input_set_id=$1`,
    [inputSetId]
  );
  expect(size.rows[0]!.rows).toBeGreaterThan(20_000);
  const deployed = await measureHpnInputFinalization(databaseUrl, schemaName, inputSetId, {
    timeoutMs: SEASON_FINALIZATION_MS,
    cancelAboveKib: SEASON_PEAK_RESIDENT_KIB,
  });
  const original = await measureHpnInputFinalization(databaseUrl, schemaName, inputSetId, {
    finalizer: pre0238Finalization,
    timeoutMs: SEASON_FINALIZATION_MS,
    cancelAboveKib: SEASON_PEAK_RESIDENT_KIB,
  });
  console.info('HPN season finalization', { size: size.rows[0], deployed, original });
  expect(deployed.error).toBeNull();
  expect(deployed.peakResidentKib).toBeLessThan(SEASON_PEAK_RESIDENT_KIB);
  expect(deployed.milliseconds).toBeLessThan(SEASON_FINALIZATION_MS);
  // The original either exceeded the memory bound or ran out of the time the deployed one met.
  expect(original.error).not.toBeNull();
  expect(original.exceededMemoryBound || /statement timeout/.test(original.error ?? '')).toBe(true);
}, 1_800_000);
