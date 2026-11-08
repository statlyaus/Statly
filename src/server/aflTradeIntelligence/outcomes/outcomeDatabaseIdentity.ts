/**
 * The identity this application expects an AFL trade outcomes database to expose.
 *
 * This mirrors SQLite's file header, which carries an application id and schema format so a reader
 * can refuse a file written for a different contract instead of misreading it. The same declaration
 * lives in SQL as `outcome_database_identity`, the migration asserts the row it writes, and
 * `afl-outcomes-postgres.test.ts` binds this constant to the deployed row — so the code and the
 * database cannot disagree silently.
 *
 * Changing `schemaFormat` is a compatibility decision, not a refactor: bump it only when a reader
 * built for the previous format would misread a database at the new one.
 */
export const OUTCOME_DATABASE_IDENTITY = {
  applicationId: 'statly-afl-trade-outcomes',
  schemaFormat: 1,
} as const;

const EXPECTED_IDENTITY = `${OUTCOME_DATABASE_IDENTITY.applicationId} schema format ${OUTCOME_DATABASE_IDENTITY.schemaFormat}`;

export class OutcomeDatabaseIdentityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OutcomeDatabaseIdentityError';
  }
}

interface IdentityRow {
  application_id: unknown;
  schema_format: unknown;
}

/**
 * Refuses a database that does not declare itself as this application's outcomes database at the
 * schema format this code reads. A reader calls it before serving, so a misconfigured
 * `AFL_OUTCOMES_DATABASE_URL` (the fantasy database, an unmigrated database, or a later format)
 * fails closed with one clear error instead of surfacing later as confusing query failures.
 */
export async function assertOutcomeDatabaseIdentity(client: {
  query<Row>(sql: string): Promise<{ readonly rows: readonly Row[] }>;
}): Promise<void> {
  let rows: readonly IdentityRow[];
  try {
    ({ rows } = await client.query<IdentityRow>(
      'SELECT application_id, schema_format FROM outcome_database_identity'
    ));
  } catch (error) {
    throw new OutcomeDatabaseIdentityError(
      `The configured outcomes database has no readable outcome_database_identity; expected ${EXPECTED_IDENTITY}.`,
      { cause: error }
    );
  }
  const row = rows.length === 1 ? rows[0] : undefined;
  if (
    row?.application_id !== OUTCOME_DATABASE_IDENTITY.applicationId ||
    Number(row.schema_format) !== OUTCOME_DATABASE_IDENTITY.schemaFormat
  ) {
    throw new OutcomeDatabaseIdentityError(
      `The configured outcomes database does not declare ${EXPECTED_IDENTITY}.`
    );
  }
}
