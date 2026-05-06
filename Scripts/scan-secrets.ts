import { globby } from 'globby';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

type Hit = { file: string; pattern: string };

const SEARCH_DIRS = [
  '.next',
  '.next/static/chunks',
  '.next/server',
  '.next/cache',
  '.next/standalone',
  '.vercel/output/static',
  '.vercel/output/functions',
];

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'BEGIN_PRIVATE_KEY', re: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/ },
  { name: 'SERVICE_ACCOUNT_TYPE', re: /"type"\s*:\s*"service_account"/ },
  { name: 'CLIENT_EMAIL', re: /"client_email"\s*:\s*"[^"]+"/ },
  { name: 'PROJECT_ID', re: /"project_id"\s*:\s*"[^"]+"/ },
  {
    name: 'PRIVATE_KEY_FIELD',
    re: /"private_key"\s*:\s*"[^"]*-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
  },
];

const TRACKED_SCAN_ALLOWLIST = new Set([
  '.env.example',
  'secrets/serviceAccountKey.example.json',
  'src/lib/env.spec.ts',
  'src/lib/serviceAccount.test.ts',
]);

async function fileText(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function getTrackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
      .split('\0')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((file) => !TRACKED_SCAN_ALLOWLIST.has(file));
  } catch (error) {
    console.warn('Unable to enumerate git-tracked files for secret scanning.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function scanText(file: string, txt: string): Hit | null {
  // Flag direct private keys. Allowlisted docs/examples can still show placeholder syntax.
  if (SECRET_PATTERNS[0].re.test(txt)) {
    return { file, pattern: SECRET_PATTERNS[0].name };
  }

  const hasType = SECRET_PATTERNS[1].re.test(txt);
  const hasEmail = SECRET_PATTERNS[2].re.test(txt);
  const hasProj = SECRET_PATTERNS[3].re.test(txt);
  const hasPrivateKey = SECRET_PATTERNS[4].re.test(txt);
  if (hasPrivateKey || (hasType && (hasEmail || hasProj))) {
    return { file, pattern: 'SERVICE_ACCOUNT_METADATA' };
  }

  return null;
}

async function scan() {
  const roots = SEARCH_DIRS.filter((d) => existsSync(d));
  const buildOutputFiles = roots.length
    ? await globby(
        roots.map((d) => `${d}/**/*`),
        {
          dot: true,
          gitignore: false,
          onlyFiles: true,
          followSymbolicLinks: false,
        }
      )
    : [];
  const trackedFiles = getTrackedFiles();

  const hits: Hit[] = [];
  for (const f of [...buildOutputFiles, ...trackedFiles]) {
    const txt = await fileText(f);
    if (!txt) continue;

    const hit = scanText(f, txt);
    if (hit) {
      hits.push(hit);
    }
  }

  // Extra guard: firebase-admin must not appear in client bundles
  const clientFiles = await globby(['.next/static/**/*'], {
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  for (const f of clientFiles) {
    const txt = await fileText(f);
    if (!txt) continue;
    if (/firebase-admin/.test(txt)) {
      hits.push({ file: f, pattern: 'FIREBASE_ADMIN_IN_CLIENT_BUNDLE' });
    }
  }

  if (hits.length) {
    console.error('Secret-like content detected:');
    for (const h of hits) {
      console.error(` - ${h.pattern}: ${h.file}`);
    }
    process.exit(1);
  }

  console.log(
    `Scanned ${buildOutputFiles.length} build files and ${trackedFiles.length} tracked files; no secret-like content detected.`
  );
}

scan().catch((e) => {
  console.error('scan-secrets failed', e);
  process.exit(1);
});
