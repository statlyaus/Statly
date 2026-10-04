import {
  assertSharedOutcomesTestDatabase,
  dropLeftoverOutcomesDatabases,
  prepareSharedOutcomesRoles,
} from './outcomesParallelDatabases';

/** Runs once before the outcomes integration files start, and once after they all finish. */
export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const sharedUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL?.trim();
  if (!sharedUrl) return undefined;
  assertSharedOutcomesTestDatabase(sharedUrl);

  await dropLeftoverOutcomesDatabases(sharedUrl);
  await prepareSharedOutcomesRoles(sharedUrl);

  return async () => {
    await dropLeftoverOutcomesDatabases(sharedUrl);
  };
}
