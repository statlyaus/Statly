import { describe, expect, it } from 'vitest';

import {
  FOOTYWIRE_STATS_PROVIDER,
  planFootywireIdentityMappings,
  proposeFootywireIdentityManifest,
  validateReviewedFootywireIdentityManifest,
} from '@/server/players/footywireIdentity';

const players = [
  { id: 'p-bont', name: 'Marcus Bontempelli', club: 'Western Bulldogs' },
  { id: 'p-king-stk', name: 'Max King', club: 'St Kilda' },
  { id: 'p-king-syd', name: 'Max King', club: 'St Kilda' },
  { id: 'p-daicos', name: 'Nick Daicos', club: 'Collingwood' },
];

describe('proposeFootywireIdentityManifest', () => {
  it('proposes only exact name and club matches, unreviewed, and reports the rest', () => {
    const manifest = proposeFootywireIdentityManifest({
      etlPlayers: [
        // Footywire's club names differ from Statly's; the match is on the canonical club.
        { externalId: 'ply_marcus_bontempelli', name: 'Marcus Bontempelli', club: 'Footscray' },
        { externalId: 'ply_max_king', name: 'Max King', club: 'St Kilda' },
        { externalId: 'ply_new_rookie', name: 'New Rookie', club: 'Carlton' },
        { externalId: 'ply_nick_daicos', name: 'Nick Daicos', club: 'Collingwood' },
      ],
      players,
      existingIdentities: [{ externalId: 'ply_nick_daicos', playerId: 'p-daicos' }],
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      provider: FOOTYWIRE_STATS_PROVIDER,
      reviewed: false,
      reviewedBy: '',
      reviewedAt: '',
      alreadyMapped: 1,
      mappings: [
        {
          externalId: 'ply_marcus_bontempelli',
          playerId: 'p-bont',
          name: 'Marcus Bontempelli',
          club: 'Footscray',
        },
      ],
      unmatched: [
        {
          externalId: 'ply_max_king',
          reason: 'AMBIGUOUS',
          candidatePlayerIds: ['p-king-stk', 'p-king-syd'],
        },
        { externalId: 'ply_new_rookie', reason: 'NO_CANDIDATE', candidatePlayerIds: [] },
      ],
    });
  });

  it('never proposes a name-only match across clubs', () => {
    const manifest = proposeFootywireIdentityManifest({
      etlPlayers: [{ externalId: 'ply_nick_daicos', name: 'Nick Daicos', club: 'Carlton' }],
      players,
      existingIdentities: [],
    });

    expect(manifest.mappings).toEqual([]);
    expect(manifest.unmatched).toEqual([
      expect.objectContaining({ externalId: 'ply_nick_daicos', reason: 'NO_CANDIDATE' }),
    ]);
  });
});

describe('validateReviewedFootywireIdentityManifest', () => {
  const reviewed = {
    schemaVersion: 1,
    provider: 'footywire',
    reviewed: true,
    reviewedBy: 'owner',
    reviewedAt: '2026-11-08T00:00:00.000Z',
    mappings: [{ externalId: 'ply_marcus_bontempelli', playerId: 'p-bont' }],
  };

  it('accepts a reviewed manifest', () => {
    expect(validateReviewedFootywireIdentityManifest(reviewed).mappings).toEqual(reviewed.mappings);
  });

  it('refuses an unreviewed, unsigned or malformed manifest', () => {
    expect(() =>
      validateReviewedFootywireIdentityManifest({ ...reviewed, reviewed: false })
    ).toThrow(/reviewed/);
    expect(() =>
      validateReviewedFootywireIdentityManifest({ ...reviewed, reviewedBy: '' })
    ).toThrow(/reviewedBy/);
    expect(() =>
      validateReviewedFootywireIdentityManifest({ ...reviewed, reviewedAt: 'yesterday' })
    ).toThrow(/reviewedAt/);
    expect(() =>
      validateReviewedFootywireIdentityManifest({ ...reviewed, provider: 'statly-legacy' })
    ).toThrow(/provider/);
    expect(() =>
      validateReviewedFootywireIdentityManifest({
        ...reviewed,
        mappings: [{ externalId: 'ply_x', playerId: '' }],
      })
    ).toThrow(/mapping/);
  });
});

describe('planFootywireIdentityMappings', () => {
  it('creates new links, keeps identical ones, and blocks every conflict', () => {
    const plan = planFootywireIdentityMappings({
      mappings: [
        { externalId: 'ply_new', playerId: 'p-bont' },
        { externalId: 'ply_same', playerId: 'p-daicos' },
        { externalId: 'ply_taken', playerId: 'p-king-stk' },
        { externalId: 'ply_second_id', playerId: 'p-daicos' },
        { externalId: 'ply_missing_player', playerId: 'p-gone' },
        { externalId: 'ply_new', playerId: 'p-king-syd' },
      ],
      existingIdentities: [
        { externalId: 'ply_same', playerId: 'p-daicos' },
        { externalId: 'ply_taken', playerId: 'p-king-syd' },
      ],
      existingPlayerIds: new Set(players.map((player) => player.id)),
    });

    expect(plan.create).toEqual([{ externalId: 'ply_new', playerId: 'p-bont' }]);
    expect(plan.unchanged).toEqual([{ externalId: 'ply_same', playerId: 'p-daicos' }]);
    expect(plan.blockers).toEqual([
      'ply_taken is already linked to p-king-syd, not p-king-stk',
      'p-daicos already has Footywire id ply_same; it cannot also take ply_second_id',
      'ply_missing_player names player p-gone, which does not exist',
      'ply_new is mapped more than once in the manifest',
    ]);
  });
});
