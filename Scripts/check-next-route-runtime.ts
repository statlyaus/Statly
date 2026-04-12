import { globby } from 'globby';
import { readFile } from 'node:fs/promises';

async function main() {
  const files = await globby(['src/app/api/etl/**/route.ts']);
  let failed = false;
  for (const f of files) {
    const txt = await readFile(f, 'utf8');
    if (!/export\s+const\s+runtime\s*=\s*['"]nodejs['"];?/.test(txt)) {
      console.error(`Missing export const runtime = 'nodejs' in ${f}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(`Checked ${files.length} ETL route(s): OK`);
}

main().catch((e) => {
  console.error('check-next-route-runtime failed', e);
  process.exit(1);
});
