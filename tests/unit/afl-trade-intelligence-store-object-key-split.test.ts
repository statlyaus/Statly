import { describe, expect, it } from 'vitest';
import { splitAflTradeStoreObjectKey } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';

const sha = 'a'.repeat(64);
const tail = `local_non_production_filesystem/sha256/aa/aa/${sha}`;

describe('splitAflTradeStoreObjectKey', () => {
  it('splits a top-level repository at its assurance layout', () => {
    expect(splitAflTradeStoreObjectKey(`reviewed-registration-evidence/${tail}`)).toEqual({
      repositoryPath: 'reviewed-registration-evidence',
      repositoryKey: tail,
    });
  });

  it('keeps a nested repository path whole', () => {
    expect(
      splitAflTradeStoreObjectKey(`fitzroy-historical/fitzroy-historical-raw/${tail}`)
    ).toEqual({
      repositoryPath: 'fitzroy-historical/fitzroy-historical-raw',
      repositoryKey: tail,
    });
  });

  it.each([
    tail,
    `repo/sha256/aa/aa/${sha}`,
    `../escape/${tail}`,
    `repo/../escape/${tail}`,
    `repo//inner/${tail}`,
  ])('refuses %s', (key) => {
    expect(splitAflTradeStoreObjectKey(key)).toBeNull();
  });
});
