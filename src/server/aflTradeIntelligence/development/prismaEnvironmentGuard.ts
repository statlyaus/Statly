import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function assertNoSchemaAdjacentPrismaEnvironmentFile(
  schemaPath: string,
  environmentFileExists: (path: string) => boolean = existsSync
): void {
  const schemaEnvironmentPath = join(dirname(schemaPath), '.env');
  if (environmentFileExists(schemaEnvironmentPath)) {
    throw new Error(
      `Refusing to run Prisma because a protected schema-adjacent environment file exists at ${schemaEnvironmentPath}.`
    );
  }
}
