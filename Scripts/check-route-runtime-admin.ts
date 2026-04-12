import { globby } from 'globby';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

async function read(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function extractSpecifiers(txt: string): string[] {
  const out: string[] = [];
  const re1 = /^\s*import[^'"\n]*from\s+['\"]([^'\"]+)['\"]/gm;
  const re2 = /^\s*export\s+\*\s+from\s+['\"]([^'\"]+)['\"]/gm;
  const re3 = /^\s*export\s+\{[^}]*\}\s+from\s+['\"]([^'\"]+)['\"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(txt))) out.push(m[1]);
  while ((m = re2.exec(txt))) out.push(m[1]);
  while ((m = re3.exec(txt))) out.push(m[1]);
  return out;
}

function pathCandidates(base: string): string[] {
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];
  const out: string[] = [];
  if (existsSync(base)) out.push(base);
  for (const ext of exts) if (existsSync(base + ext)) out.push(base + ext);
  if (existsSync(base) && !base.endsWith('/')) {
    for (const ext of exts) {
      const idx = join(base, 'index' + ext);
      if (existsSync(idx)) out.push(idx);
    }
  }
  return out;
}

function resolveFrom(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  const base = spec.startsWith('@/')
    ? join(process.cwd(), 'src', spec.replace(/^@\//, ''))
    : resolvePath(dirname(fromFile), spec);
  const cand = pathCandidates(base);
  return cand[0] ?? null;
}

async function dependsOnAdmin(entry: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue: string[] = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const txt = await read(file);
    if (!txt) continue;

    // Direct indicators
    if (
      txt.includes('@/lib/firebaseAdmin') ||
      txt.includes('firebase-admin') ||
      txt.includes("import 'server-only'")
    ) {
      return true;
    }

    // Imports and re-exports
    const specs = extractSpecifiers(txt);
    for (const s of specs) {
      if (s === '@/app/api/etl/_shared/adminDb' || s.endsWith('/_shared/adminDb')) return true;
      const resolved = resolveFrom(file, s);
      if (resolved) queue.push(resolved);
    }
  }
  return false;
}

async function main() {
  const routes = await globby(['src/app/api/**/route.ts']);
  let failed = false;
  for (const route of routes) {
    const txt = (await read(route)) || '';
    const needsNode = await dependsOnAdmin(route);
    if (!needsNode) continue;
    const hasNodeRuntime = /export\s+const\s+runtime\s*=\s*['"]nodejs['"];?/.test(txt);
    if (!hasNodeRuntime) {
      console.error(`API route requires Node runtime but is missing: ${route}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(`Checked ${routes.length} API route(s) for admin usage -> runtime guard OK`);
}

main().catch((e) => {
  console.error('check-route-runtime-admin failed', e);
  process.exit(1);
});
