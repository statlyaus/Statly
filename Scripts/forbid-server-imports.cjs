const { readFileSync, readdirSync, statSync, existsSync } = require('fs');
const { join, extname, dirname, resolve } = require('path');

const ROOT = process.cwd();

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(extname(p))) acc.push(p);
  }
  return acc;
}

function isClientFile(txt, file) {
  if (/^\s*['\"]use client['\"];?/.test(txt)) return true;
  if (file.includes('/components/') || file.includes('/hooks/')) return true;
  return false;
}

function extractSpecifiers(txt) {
  const out = [];
  const re1 = /^\s*import[^'"\n]*from\s+['\"]([^'\"]+)['\"]/gm;
  const re2 = /^\s*export\s+\*\s+from\s+['\"]([^'\"]+)['\"]/gm;
  const re3 = /^\s*export\s+\{[^}]*\}\s+from\s+['\"]([^'\"]+)['\"]/gm;
  let m;
  while ((m = re1.exec(txt))) out.push(m[1]);
  while ((m = re2.exec(txt))) out.push(m[1]);
  while ((m = re3.exec(txt))) out.push(m[1]);
  return out;
}

function pathCandidates(base) {
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];
  const out = [];
  if (existsSync(base) && statSync(base).isFile()) out.push(base);
  for (const ext of exts) if (existsSync(base + ext)) out.push(base + ext);
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of exts) {
      const idx = join(base, 'index' + ext);
      if (existsSync(idx)) out.push(idx);
    }
  }
  return out;
}

function resolveFrom(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.replace(/^@\//, ''));
  else base = resolve(dirname(fromFile), spec);
  const candidates = pathCandidates(base);
  return candidates[0];
}

function safeRead(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function checkFile(file) {
  const txt = readFileSync(file, 'utf8');
  const client = isClientFile(txt, file);

  const adminBad = /from\s+['\"]@\/lib\/firebaseAdmin['\"]/;
  const adminPkg = /from\s+['\"]firebase-admin['\"]/;
  if (client && (adminBad.test(txt) || adminPkg.test(txt))) {
    throw new Error(`Client file must not import Admin SDK: ${file}`);
  }

  const serverTree = file.includes('/api/') || file.includes('/server/');
  const clientSdk = /from\s+['\"]@\/lib\/firebaseClient['\"]/;
  const clientPkgs = /(from|require)\s*\(?.*['\"]firebase\/(app|auth|firestore)['\"]/;
  if (serverTree && (clientSdk.test(txt) || clientPkgs.test(txt))) {
    throw new Error(`Server file must not import Client SDK: ${file}`);
  }

  if (client) {
    const visited = new Set();
    const queue = extractSpecifiers(txt)
      .filter((s) => s.startsWith('.') || s.startsWith('@/'))
      .map((s) => resolveFrom(file, s));
    while (queue.length) {
      const next = queue.pop();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      const t = safeRead(next);
      if (!t) continue;
      if (/import\s+['\"]server-only['\"];?/.test(t)) {
        throw new Error(`'use client' file must not transitively import server-only module via ${next} (source: ${file})`);
      }
      const specs = extractSpecifiers(t)
        .filter((s) => s.startsWith('.') || s.startsWith('@/'))
        .map((s) => resolveFrom(next, s));
      queue.push(...specs);
    }
  }
}

function main() {
  const globs = ['src/app', 'src/components', 'src/hooks', 'src/server', 'src/lib'];
  const files = globs.flatMap((g) => walk(join(ROOT, g)));
  for (const f of files) {
    checkFile(f);
  }
  console.log(`forbid-server-imports: scanned ${files.length} files`);
}

try {
  main();
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
