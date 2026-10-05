import { describe, expect, it } from 'vitest';
import { parseReadBackArtifactCustodyArguments } from '../../Scripts/read-back-artifact-custody';

const env = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://user:secret@127.0.0.1:55436/outcomes' };

describe('read-back-artifact-custody arguments', () => {
  it('defaults to a 5% sample of the non-raw classes', () => {
    expect(parseReadBackArtifactCustodyArguments(['--store-id', 'statly-store'], env)).toEqual({
      databaseUrl: env.AFL_OUTCOMES_DATABASE_URL,
      storeId: 'statly-store',
      sampleFraction: 0.05,
      reportPath: null,
    });
  });

  it('accepts an explicit fraction and an absolute report path', () => {
    expect(
      parseReadBackArtifactCustodyArguments(
        ['--store-id', 'statly-store', '--sample-fraction', '1', '--report', '/tmp/run.json'],
        env
      )
    ).toMatchObject({ sampleFraction: 1, reportPath: '/tmp/run.json' });
  });

  it.each([
    [['--store-id', 'Bad_Store'], 'store-id'],
    [['--store-id', 'statly-store', '--sample-fraction', '1.5'], 'sample-fraction'],
    [['--store-id', 'statly-store', '--sample-fraction', '-0.1'], 'sample-fraction'],
    [['--store-id', 'statly-store', '--report', 'relative.json'], 'absolute'],
    [['--store-id', 'statly-store', '--store-id', 'other-store'], 'once'],
    [['--apply'], 'Unexpected'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseReadBackArtifactCustodyArguments(argv, env)).toThrow(message);
  });

  it('requires a loopback outcomes database', () => {
    expect(() =>
      parseReadBackArtifactCustodyArguments(['--store-id', 'statly-store'], {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://user:secret@db.example.com/outcomes',
      })
    ).toThrow('loopback');
  });
});
