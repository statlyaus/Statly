import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ReferenceClient = { query: (sql: string) => Promise<{ rows: Array<{ definition: string }> }> };

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prisma',
  'afl-trade-outcomes',
  'migrations'
);
const MIGRATION = join(MIGRATIONS, '0240_hpn_input_finalization_bounded_memory', 'migration.sql');
const MIGRATION_0242 = join(
  MIGRATIONS,
  '0242_assignment_continuity_once_per_case',
  'migration.sql'
);

const quoted = (block: string, tag: string) =>
  [...block.matchAll(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g'))].map(
    (match) => match[1]!
  );

const replaceExactlyOnce = (definition: string, from: string, to: string, count = 1) => {
  if (definition.split(from).length !== count + 1) {
    throw new Error('Expected each 0242 HPN finalization correction exactly as often as applied.');
  }
  return definition.split(from).join(to);
};

/**
 * Reverses 0242's asserted finalizer edits (continuity evaluated once per assignment case), so the
 * 0240 corrections can be reversed from the definition 0240 itself produced.
 */
function revert0242(definition: string): string {
  const source = readFileSync(MIGRATION_0242, 'utf8');
  const block = source.slice(source.lastIndexOf('DO $migration$'));
  const fragments = quoted(block, 'old');
  const corrections = quoted(block, 'new');
  // The row loop, then one pair per per-row argument: `match` is passed twice.
  if (fragments.length !== 7 || corrections.length !== 7) {
    throw new Error('Expected paired 0242 HPN finalization fragments.');
  }
  let reverted = definition;
  for (let index = corrections.length - 1; index >= 1; index -= 1)
    reverted = replaceExactlyOnce(
      reverted,
      corrections[index]!,
      fragments[index]!,
      fragments[index]!.includes(`->'match')`) ? 2 : 1
    );
  reverted = replaceExactlyOnce(
    reverted,
    '_resolution_current_with_assignment"(',
    '_resolution_current"(',
    7
  );
  reverted = replaceExactlyOnce(reverted, corrections[0]!, fragments[0]!);
  return replaceExactlyOnce(
    reverted,
    'registered_spells TEXT[]; current_assignments JSONB;',
    'registered_spells TEXT[];'
  );
}

/**
 * Returns the exact pre-0240 HPN input finalization trigger function (as a CREATE OR REPLACE
 * statement), derived from the deployed definition by reversing 0242's and then 0240's own asserted
 * fragment replacements, so a test can run the original finalization on the same data.
 */
export async function loadPre0240HpnFinalizationDefinition(
  client: ReferenceClient
): Promise<string> {
  const source = readFileSync(MIGRATION, 'utf8');
  const block = source.slice(0, source.indexOf('END $migration$;'));
  const fragments = quoted(block, 'old');
  const corrections = quoted(block, 'new');
  if (fragments.length === 0 || fragments.length !== corrections.length) {
    throw new Error('Expected paired 0240 HPN finalization fragments.');
  }
  let definition = (
    await client.query(
      `SELECT pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure) AS definition`
    )
  ).rows[0]!.definition;
  definition = revert0242(definition);
  for (let index = corrections.length - 1; index >= 0; index -= 1) {
    if (definition.split(corrections[index]!).length !== 2) {
      throw new Error('Expected each 0240 HPN finalization correction exactly once.');
    }
    definition = definition.replace(corrections[index]!, () => fragments[index]!);
  }
  if (definition.includes('0240:')) {
    throw new Error('The derived pre-0240 HPN finalization still contains 0240 bytes.');
  }
  return definition;
}
