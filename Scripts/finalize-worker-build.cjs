const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const distDir = path.resolve(process.cwd(), 'dist');
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(
    path.join(distDir, 'package.json'),
    `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
    'utf8'
  );
}

main().catch((error) => {
  console.error(
    '[finalize-worker-build] Failed to mark dist output as CommonJS:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
