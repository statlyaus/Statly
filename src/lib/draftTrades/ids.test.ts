import { describe, expect, it } from 'vitest';

import { buildDraftAssetBaseId, buildDraftAssetIdWithHash, buildDraftPartyId } from './ids';

describe('draft trade id helpers', () => {
  it('builds deterministic party id', () => {
    expect(buildDraftPartyId(1, 'carlton')).toBe('1_carlton');
  });

  it('builds deterministic asset ids with and without hash', () => {
    expect(buildDraftAssetBaseId('essendon', 2)).toBe('essendon_2');
    expect(buildDraftAssetIdWithHash('essendon', 2, '#26 (Regan - 0 games)')).toMatch(
      /^essendon_2_[a-f0-9]{8}$/
    );
  });
});
