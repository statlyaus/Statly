import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ReferenceClient = { query: (sql: string) => Promise<unknown> };

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prisma',
  'afl-trade-outcomes',
  'migrations'
);

/** The pre-0236 appearance-membership currency, installed from its own 0233 migration source. */
export const PRE_0236_APPEARANCE_CURRENCY =
  'outcome_acquisition_appearance_spell_registration_current_pre0236';

/**
 * Installs the exact 0233 definition of the appearance-membership (v3) registration currency under
 * a reference name, so a test can compare the deployed (0236) function against the original
 * semantics on the same data.
 */
export async function installPre0236AppearanceCurrencyReference(
  client: ReferenceClient
): Promise<void> {
  const source = readFileSync(
    join(MIGRATIONS, '0233_appearance_membership_spells', 'migration.sql'),
    'utf8'
  );
  const header =
    'CREATE FUNCTION outcome_acquisition_appearance_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)';
  const start = source.indexOf(header);
  const end = source.indexOf('\n$$;', start);
  if (start < 0 || end < 0 || source.indexOf(header, start + 1) >= 0) {
    throw new Error('Expected exactly one 0233 appearance-membership currency definition.');
  }
  const definition = source.slice(start, end + '\n$$;'.length);
  await client.query(
    definition.replace(
      'outcome_acquisition_appearance_spell_registration_current(',
      `${PRE_0236_APPEARANCE_CURRENCY}(`
    )
  );
}
