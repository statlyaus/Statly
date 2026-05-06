import { execFileSync } from 'node:child_process';

const patterns = [
  '.firebase/**',
  '.firebase-data/**',
  'firebase-export-*/**',
  'prisma/*.db',
  'serviceAccountKey.json',
  'service-account.json',
  'serviceAccount.local.json',
  'sa.b64',
  'sa.dec.json',
  'key.txt',
  'src/lib/serviceAccountKey.json',
  'secrets/serviceAccountKey.json',
  'statly-*.json',
  'apple.rtf',
  'tmp-*.png',
];

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
