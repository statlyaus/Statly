import { describe, expect, it } from 'vitest';
import {
  parseMirrorArtifactStoreArguments,
  runGcloudStorage,
} from '../../Scripts/mirror-artifact-store';

const env = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://user:secret@127.0.0.1:55436/outcomes' };

describe('mirror-artifact-store arguments', () => {
  it('parses a mirror sync', () => {
    expect(
      parseMirrorArtifactStoreArguments(
        ['--store-id', 'statly-store', '--mirror', 'gs://statly-mirror/statly-store'],
        env
      )
    ).toEqual({
      mode: 'mirror',
      databaseUrl: env.AFL_OUTCOMES_DATABASE_URL,
      storeId: 'statly-store',
      mirrorLocator: 'gs://statly-mirror/statly-store',
    });
  });

  it('parses a restore test with an absolute receipt path', () => {
    expect(
      parseMirrorArtifactStoreArguments(
        ['--store-id', 'statly-store', '--restore-test', '--receipt', '/tmp/restore.json'],
        env
      )
    ).toMatchObject({ mode: 'restore-test', receiptPath: '/tmp/restore.json' });
  });

  it.each([
    [['--store-id', 'statly-store'], 'gs://'],
    [['--store-id', 'statly-store', '--mirror', 's3://bucket/x'], 'gs://'],
    [['--store-id', 'statly-store', '--restore-test'], 'receipt'],
    [['--store-id', 'statly-store', '--restore-test', '--receipt', 'relative.json'], 'receipt'],
    [
      [
        '--store-id',
        'statly-store',
        '--restore-test',
        '--receipt',
        '/tmp/r.json',
        '--mirror',
        'gs://b/x',
      ],
      'omit --mirror',
    ],
    [
      ['--store-id', 'statly-store', '--mirror', 'gs://b/x', '--receipt', '/tmp/r.json'],
      'only for',
    ],
    [['--store-id', 'Bad'], 'store-id'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseMirrorArtifactStoreArguments(argv, env)).toThrow(message);
  });
});

describe('runGcloudStorage', () => {
  it('streams very large output without failing and reports a failure with its stderr tail', async () => {
    // A stand-in for gcloud: `storage <args> --quiet` reach node as script arguments.
    const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'statly-fake-gcloud-'));
    const fake = join(directory, 'gcloud');
    await writeFile(
      fake,
      `#!/usr/bin/env node
const mode = process.argv[3];
const line = 'Copying file://store/object.json to gs://bucket/object.json\\n'.repeat(2000);
for (let i = 0; i < 1000; i += 1) { process.stdout.write(line); process.stderr.write(line); }
if (mode === 'fail') { process.stderr.write('ERROR: permission denied on gs://bucket\\n'); process.exitCode = 1; }
`
    );
    await chmod(fake, 0o755);
    try {
      await expect(runGcloudStorage(['rsync'], fake)).resolves.toBeUndefined();
      await expect(runGcloudStorage(['fail'], fake)).rejects.toThrow('permission denied');
      // A command that cannot be spawned rejects instead of crashing the process.
      await expect(runGcloudStorage(['rsync'], join(directory, 'missing'))).rejects.toThrow(
        'ENOENT'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
