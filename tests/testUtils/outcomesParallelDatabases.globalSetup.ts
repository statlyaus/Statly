import type { TestProject } from 'vitest/node';

import {
  OUTCOMES_TEMPLATE_DATABASE,
  assertSharedOutcomesTestDatabase,
  dropLeftoverOutcomesDatabases,
  prepareOutcomesTemplate,
} from './outcomesParallelDatabases';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The migrated template database per-file databases are cloned from, or null to replay. */
    outcomesTemplateDatabase: string | null;
  }
}

/** Runs once before the outcomes integration files start, and once after they all finish. */
export default async function setup(
  project: TestProject
): Promise<(() => Promise<void>) | undefined> {
  const sharedUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL?.trim();
  if (!sharedUrl) {
    project.provide('outcomesTemplateDatabase', null);
    return undefined;
  }
  assertSharedOutcomesTestDatabase(sharedUrl);

  await dropLeftoverOutcomesDatabases(sharedUrl, { includeTemplate: true });
  const adoptionVerified = await prepareOutcomesTemplate(sharedUrl);
  project.provide('outcomesTemplateDatabase', adoptionVerified ? OUTCOMES_TEMPLATE_DATABASE : null);

  return async () => {
    await dropLeftoverOutcomesDatabases(sharedUrl, { includeTemplate: true });
  };
}
