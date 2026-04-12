import { execFileSync } from 'node:child_process';

const patterns = ['.firebase/**', 'firebase-export-*/**', 'prisma/*.db', 'tmp-*.png'];

const trackedFiles = execFileSync('git', ['ls-files', ...patterns], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
  .split('\n')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (trackedFiles.length > 0) {
  console.error('Tracked local artifacts are not allowed in the repository:');
  for (const file of trackedFiles) {
    console.error(` - ${file}`);
  }
  process.exit(1);
}

console.log('No tracked local artifacts found.');
