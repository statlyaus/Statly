import { describe, expect, it } from 'vitest';

import { createLocalAflTradeOutcomeReleaseAuthority } from '@/server/aflTradeIntelligence/development/localOutcomeReleaseAuthority';

describe('local AFL factual outcome publication', () => {
  it('publishes normalized acquisitions without inventing player outcomes', () => {
    const publication = createLocalAflTradeOutcomeReleaseAuthority();

    expect(publication.release.content.schemaVersion).toBe('afl-draft-trade-outcome-release/v2');
    expect(publication.release.content.outcomeRecordCount).toBe(0);
    expect(publication.candidate.content.members.acquisitionSpells).toHaveLength(2);
    expect(publication.candidate.content.members.reconciledMetrics).toEqual([]);
    expect(publication.itemSet.itemCount).toBe(2);
    expect(publication.itemSet.members.map(({ item }) => item.player.displayName).sort()).toEqual([
      'Harry Kyle',
      'Josh Lindsay',
    ]);
    expect(
      publication.itemSet.members.every(({ item }) =>
        item.checks.every(
          (check) =>
            check.status === 'unavailable' &&
            check.recordedValue === null &&
            check.observedValue === null
        )
      )
    ).toBe(true);
    expect(publication.projection.content.publicListItemSetSha256).toBe(
      publication.itemSet.itemSetSha256
    );
  });
});
