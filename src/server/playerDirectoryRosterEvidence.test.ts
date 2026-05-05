import { describe, expect, it } from 'vitest';

import {
  buildPlayerDirectoryRepairPlanFromRosterEvidence,
  type ReviewedPlayerRosterEvidence,
} from '@/server/playerDirectoryRosterEvidence';

const jordanCroftEvidence: ReviewedPlayerRosterEvidence = {
  season: 2026,
  playerName: 'Jordan Croft',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'new_player',
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs 2026 reviewed roster',
  reviewedBy: 'manual-review-2026-04-26',
  reviewedAt: '2026-04-26',
  notes: 'Reviewed roster evidence for unresolved Footywire rows.',
  unresolved: {
    sourceDocumentIds: ['2026-R0-BRI-BUL_ply_jordan_croft', '2026-R1-BUL-GWS_ply_jordan_croft'],
    sourcePlayerName: 'Jordan Croft',
    sourceTeam: 'Western Bulldogs',
  },
};

describe('playerDirectoryRosterEvidence', () => {
  it('generates player and registration repairs from reviewed roster evidence', () => {
    const plan = buildPlayerDirectoryRepairPlanFromRosterEvidence([jordanCroftEvidence]);

    expect(plan.players).toEqual([
      {
        id: 'jordan_croft',
        name: 'Jordan Croft',
        club: 'Western Bulldogs',
        position: 'FWD',
        active: true,
        approvedBy: 'manual-review-2026-04-26',
        notes:
          'Roster evidence: Western Bulldogs 2026 reviewed roster. Reviewed roster evidence for unresolved Footywire rows.',
        evidence: {
          source: 'footywire-unresolved-row',
          sourceDocumentIds: [
            '2026-R0-BRI-BUL_ply_jordan_croft',
            '2026-R1-BUL-GWS_ply_jordan_croft',
          ],
          sourcePlayerName: 'Jordan Croft',
          sourceTeam: 'Western Bulldogs',
          reviewedAt: '2026-04-26',
        },
      },
    ]);
    expect(plan.registrations).toEqual([
      {
        playerId: 'jordan_croft',
        season: 2026,
        club: 'Western Bulldogs',
        position: 'FWD',
        listStatus: 'active',
        active: true,
        approvedBy: 'manual-review-2026-04-26',
        notes:
          'Roster evidence: Western Bulldogs 2026 reviewed roster. Reviewed roster evidence for unresolved Footywire rows.',
        evidence: {
          source: 'footywire-unresolved-row',
          sourceDocumentIds: [
            '2026-R0-BRI-BUL_ply_jordan_croft',
            '2026-R1-BUL-GWS_ply_jordan_croft',
          ],
          sourcePlayerName: 'Jordan Croft',
          sourceTeam: 'Western Bulldogs',
          reviewedAt: '2026-04-26',
        },
      },
    ]);
  });

  it('merges generated roster repairs with manual repair exceptions', () => {
    const plan = buildPlayerDirectoryRepairPlanFromRosterEvidence([jordanCroftEvidence], {
      players: [],
      aliases: [
        {
          playerId: 'connor_osullivan',
          aliasName: 'Connor OSullivan',
          club: 'Geelong',
          seasonFrom: 2026,
          seasonTo: 2026,
          approvedBy: 'manual-review-2026-04-26',
          notes: 'Reviewed source spelling variant.',
          evidence: {
            source: 'footywire-unresolved-row',
            sourceDocumentIds: ['2026-R1-GEE-FRE_ply_connor_osullivan'],
            sourcePlayerName: 'Connor OSullivan',
            sourceTeam: 'Geelong',
            reviewedAt: '2026-04-26',
          },
        },
      ],
      registrations: [],
      unresolvedDecisions: [],
    });

    expect(plan.players).toHaveLength(1);
    expect(plan.aliases).toHaveLength(1);
    expect(plan.registrations).toHaveLength(1);
    expect(plan.unresolvedDecisions).toHaveLength(0);
  });

  it('normalizes punctuation out of generated player IDs', () => {
    const plan = buildPlayerDirectoryRepairPlanFromRosterEvidence([
      {
        season: 2026,
        playerName: 'Cooper Duff-Tytler',
        club: 'West Coast',
        position: 'RUC',
        playerStatus: 'new_player',
        source: 'club-roster',
        sourceLabel: 'West Coast Eagles AFL player profile',
        reviewedBy: 'manual-review-2026-04-26',
        reviewedAt: '2026-04-26',
        notes: 'Reviewed roster evidence.',
        unresolved: {
          sourceDocumentIds: ['2026-R1-WCE-GCS_ply_cooper_d_tytler'],
          sourcePlayerName: 'Cooper D-Tytler',
          sourceTeam: 'West Coast',
        },
      },
    ]);

    expect(plan.players[0].id).toBe('cooper_duff_tytler');
    expect(plan.registrations[0].playerId).toBe('cooper_duff_tytler');
  });
});
