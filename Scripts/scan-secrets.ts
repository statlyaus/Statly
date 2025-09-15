import { globby } from 'globby';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
  { name: 'BEGIN_PRIVATE_KEY', re: /-----BEGIN\s+PRIVATE\s+KEY-----/ },
  { name: 'SERVICE_ACCOUNT_TYPE', re: /"type"\s*:\s*"service_account"/ },
  { name: 'CLIENT_EMAIL', re: /"client_email"\s*:\s*"[^"]+"/ },
  { name: 'PROJECT_ID', re: /"project_id"\s*:\s*"[^"]+"/ },
];

async function fileText(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

async function scan() {
  const roots = SEARCH_DIRS.filter((d) => existsSync(d));
  if (!roots.length) {
    console.log('No build output directories found to scan.');
    return;
  }

  const files = await globby(roots.map((d) => `${d}/**/*`), {
    dot: true,
    gitignore: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const hits: Hit[] = [];
  for (const f of files) {
    const txt = await fileText(f);
    if (!txt) continue;

    // Flag direct private key
    if (SECRET_PATTERNS[0].re.test(txt)) {
      hits.push({ file: f, pattern: SECRET_PATTERNS[0].name });
      continue;
    }

    // Combined service account indicators
    const hasType = SECRET_PATTERNS[1].re.test(txt);
    const hasEmail = SECRET_PATTERNS[2].re.test(txt);
    const hasProj = SECRET_PATTERNS[3].re.test(txt);
    if (hasType && (hasEmail || hasProj)) {
      hits.push({ file: f, pattern: 'SERVICE_ACCOUNT_METADATA' });
      continue;
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
    console.error('Secret-like content detected in build outputs:');
    for (const h of hits) {
      console.error(` - ${h.pattern}: ${h.file}`);
    }
    process.exit(1);
  }

  console.log(`Scanned ${files.length} files; no secret-like content detected.`);
}

scan().catch((e) => {
  console.error('scan-secrets failed', e);
  process.exit(1);
});

