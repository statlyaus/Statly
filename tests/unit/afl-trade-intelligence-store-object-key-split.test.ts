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

  it('splits at the final repository-key layout when the path repeats an assurance segment', () => {
    const path = 'capture/local_non_production_filesystem/sha256/archive';
    expect(splitAflTradeStoreObjectKey(`${path}/${tail}`)).toEqual({
      repositoryPath: path,
      repositoryKey: tail,
    });
  });

  it.each([
    tail,
    `repo/sha256/aa/aa/${sha}`,
    `../escape/${tail}`,
    `repo/../escape/${tail}`,
    `repo//inner/${tail}`,
    `repo/local_non_production_filesystem/sha256/aa/aa/${'a'.repeat(63)}`,
    `repo/local_non_production_filesystem/sha256/aa/aa/${sha}/extra`,
  ])('refuses %s', (key) => {
    expect(splitAflTradeStoreObjectKey(key)).toBeNull();
  });
});
