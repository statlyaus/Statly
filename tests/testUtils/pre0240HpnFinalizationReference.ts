import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ReferenceClient = { query: (sql: string) => Promise<{ rows: Array<{ definition: string }> }> };

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prisma',
  'afl-trade-outcomes',
  'migrations',
  '0240_hpn_input_finalization_bounded_memory',
  'migration.sql'
);

const quoted = (block: string, tag: string) =>
  [...block.matchAll(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g'))].map(
    (match) => match[1]!
  );

/**
 * Returns the exact pre-0240 HPN input finalization trigger function (as a CREATE OR REPLACE
 * statement), derived from the deployed definition by reversing 0240's own asserted fragment
 * replacements, so a test can run the original finalization on the same data.
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
