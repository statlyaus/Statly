import { expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeHpnPlayerFieldMapCandidate } from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';

const createdAt = '2026-09-09T00:00:00.000Z';
function candidate(sourceField: string) {
  const original = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
  const map = {
    ...original,
    identity: {
      ...original.identity,
      nativeId: { sourceField, required: true },
    },
  };
  const before = JSON.stringify(map);
  const result = createLocalAflTradeHpnPlayerFieldMapCandidate({
    provider: 'afl_tables',
    seasonYear: 2025,
    providerDecodeMap: map,
    providerDecodeMapArtifact: createAflTradeCanonicalJsonArtifactRef(map, createdAt),
    createdAt,
  });
  expect(JSON.stringify(map)).toBe(before);
  return result;
}

it('binds the declared source profile URL without claiming namespace or mapping approval', () => {
  const result = candidate('url');
  expect(result.content.semanticBindings.find((field) => field.semanticField === 'player')).toEqual({
    semanticField: 'player',
    mapping: { kind: 'direct', sourceField: 'url' },
  });
  expect(result.content).toMatchObject({
    reviewState: 'requires_review',
    publicationEligible: false,
  });
  expect(result.content).not.toHaveProperty('nativeIdNamespace');
});

it('preserves the numeric-ID binding when that is the exact declared decode mapping', () => {
  expect(candidate('ID').content.semanticBindings.find((field) => field.semanticField === 'player'))
    .toEqual({ semanticField: 'player', mapping: { kind: 'direct', sourceField: 'ID' } });
});

it('rejects an unsupported player-identity field instead of silently substituting ID', () => {
  expect(() => candidate('Goals')).toThrow();
});
