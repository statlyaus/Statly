import { describe, expect, it } from 'vitest';

import { parseStoreEvidenceArguments } from '../../Scripts/store-artifact-evidence';

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
const base = [
  '--store-id',
  'statly-grading-1-artifacts',
  '--file',
  '/evidence/approval.json',
  '--media-type',
  'application/json',
];

describe('store-artifact-evidence arguments', () => {
  it('defaults the repository and class', () => {
    expect(parseStoreEvidenceArguments(base, loopback)).toEqual({
      databaseUrl: loopback.AFL_OUTCOMES_DATABASE_URL,
      storeId: 'statly-grading-1-artifacts',
      file: '/evidence/approval.json',
      mediaType: 'application/json',
      repositoryId: 'governance-evidence',
      artifactClass: 'raw_source',
    });
  });

  it('accepts an explicit repository and class', () => {
    expect(
      parseStoreEvidenceArguments(
        [...base, '--repository-id', 'owner-approvals', '--artifact-class', 'capture_metadata'],
        loopback
      )
    ).toMatchObject({ repositoryId: 'owner-approvals', artifactClass: 'capture_metadata' });
  });

  it.each([
    [['--store-id', 'x', '--media-type', 'text/plain'], '--file is required.'],
    [
      [...base.slice(0, 2), '--file', 'approval.json', ...base.slice(4)],
      '--file must be an absolute path.',
    ],
    [
      [...base, '--artifact-class', 'derived_private'],
      '--artifact-class must be raw_source or capture_metadata.',
    ],
    [[...base, '--store-id', 'again'], '--store-id may be given once.'],
    [[...base, '--force', 'yes'], 'Unexpected argument --force.'],
    [[...base, '--repository-id'], '--repository-id needs a value.'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseStoreEvidenceArguments(argv, loopback)).toThrow(message);
  });

  it('requires a loopback database', () => {
    expect(() =>
      parseStoreEvidenceArguments(base, {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@db.example.com:5432/outcomes',
      })
    ).toThrow('AFL_OUTCOMES_DATABASE_URL must name a loopback PostgreSQL outcomes database.');
  });
});
