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
