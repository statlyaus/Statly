import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { config as dotenvConfig } from 'dotenv';

try {
  const root = process.cwd();
  const localPath = join(root, '.env.local');
  if (existsSync(localPath)) {
    dotenvConfig({ path: localPath });
  } else {
    dotenvConfig();
  }
} catch {
  // Best effort only for non-Next runtimes.
}
