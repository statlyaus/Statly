// Centralized env loader for non-Next runtimes (workers, scripts)
// Loads .env.local if present (preferred for local dev), otherwise falls back to .env
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { config as dotenvConfig } from 'dotenv';

try {
  const root = process.cwd();
  const localPath = join(root, '.env.local');
  if (existsSync(localPath)) {
    dotenvConfig({ path: localPath });
  } else {
    dotenvConfig(); // defaults to .env
  }
} catch {
  // Best effort; do not crash if dotenv is unavailable
}
