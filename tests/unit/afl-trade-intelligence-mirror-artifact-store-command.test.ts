import { describe, expect, it } from 'vitest';
import { parseMirrorArtifactStoreArguments } from '../../Scripts/mirror-artifact-store';

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
