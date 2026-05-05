import type { PlayerDirectoryRepairPlan } from '@/server/playerDirectoryRepair';
import { buildPlayerDirectoryRepairPlanFromRosterEvidence } from '@/server/playerDirectoryRosterEvidence';
import { playerRosterEvidence2026 } from './playerRosterEvidence2026';

const manualPlayerDirectoryRepairs2026: PlayerDirectoryRepairPlan = {
  players: [],
  aliases: [
    {
      playerId: 'connor_osullivan',
      aliasName: 'Connor OSullivan',
      club: 'Geelong',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        "Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row omits apostrophe for Connor O'Sullivan.",
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-GEE-FRE_ply_connor_osullivan'],
        sourcePlayerName: 'Connor OSullivan',
        sourceTeam: 'Geelong',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'mark_oconnor',
      aliasName: 'Mark OConnor',
      club: 'Geelong',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        "Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row omits apostrophe for Mark O'Connor.",
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-GEE-FRE_ply_mark_oconnor', '2026-R1-GEE-GCS_ply_mark_oconnor'],
        sourcePlayerName: 'Mark OConnor',
        sourceTeam: 'Geelong',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'massimo_dambrosio',
      aliasName: 'Massimo DAmbrosio',
      club: 'Hawthorn',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        "Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row omits apostrophe for Massimo D'Ambrosio.",
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-ESS-HAW_ply_massimo_dambrosio'],
        sourcePlayerName: 'Massimo DAmbrosio',
        sourceTeam: 'Hawthorn',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'joseph_fonti',
      aliasName: 'Joe Fonti',
      club: 'Greater Western Sydney',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        'Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row uses short form for Joseph Fonti.',
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-BUL-GWS_ply_joe_fonti', '2026-R1-GWS-HAW_ply_joe_fonti'],
        sourcePlayerName: 'Joe Fonti',
        sourceTeam: 'Greater Western Sydney',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'jackson_macrae',
      aliasName: 'Jack Macrae',
      club: 'St Kilda',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        'Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row uses common short form for Jackson Macrae.',
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-MEL-STK_ply_jack_macrae', '2026-R1-STK-COL_ply_jack_macrae'],
        sourcePlayerName: 'Jack Macrae',
        sourceTeam: 'St Kilda',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'mitchito_owens',
      aliasName: 'Mitch Owens',
      club: 'St Kilda',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        'Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row uses common short form for Mitchito Owens.',
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-MEL-STK_ply_mitch_owens', '2026-R1-STK-COL_ply_mitch_owens'],
        sourcePlayerName: 'Mitch Owens',
        sourceTeam: 'St Kilda',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'nasiah_wmilera',
      aliasName: 'Nasiah Wanganeen-Milera',
      club: 'St Kilda',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        'Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row uses expanded form for Nasiah W-Milera.',
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-MEL-STK_ply_nasiah_wanganeen_milera'],
        sourcePlayerName: 'Nasiah Wanganeen-Milera',
        sourceTeam: 'St Kilda',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'james_odonnell',
      aliasName: 'James ODonnell',
      club: 'Western Bulldogs',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        "Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row omits apostrophe for James O'Donnell.",
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: [
          '2026-R1-BUL-GWS_ply_james_odonnell',
          '2026-R1-WBD-BRL_ply_james_odonnell',
        ],
        sourcePlayerName: 'James ODonnell',
        sourceTeam: 'Western Bulldogs',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'cooper_duff_tytler',
      aliasName: 'Cooper D-Tytler',
      club: 'West Coast',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        'Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row abbreviates Cooper Duff-Tytler.',
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: [
          '2026-R1-GCS-WCE_ply_cooper_d_tytler',
          '2026-R1-WCE-GCS_ply_cooper_d_tytler',
        ],
        sourcePlayerName: 'Cooper D-Tytler',
        sourceTeam: 'West Coast',
        reviewedAt: '2026-04-26',
      },
    },
    {
      playerId: 'xavier_ohalloran',
      aliasName: 'Xavier OHalloran',
      club: 'Greater Western Sydney',
      seasonFrom: 2026,
      seasonTo: 2026,
      approvedBy: 'manual-review-2026-04-26',
      notes:
        "Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row omits apostrophe for Xavier O'Halloran.",
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: [
          '2026-R1-BUL-GWS_ply_xavier_ohalloran',
          '2026-R1-GWS-HAW_ply_xavier_ohalloran',
        ],
        sourcePlayerName: 'Xavier OHalloran',
        sourceTeam: 'Greater Western Sydney',
        reviewedAt: '2026-04-26',
      },
    },
  ],
  registrations: [],
  unresolvedDecisions: [
    {
      season: 2026,
      playerName: 'Mystery Player',
      team: 'Western Bulldogs',
      status: 'DISMISSED',
      approvedBy: 'manual-review-2026-04-26',
      notes:
        'Dismissed: synthetic placeholder row is not a real AFL-listed player and must not create a canonical player.',
      evidence: {
        source: 'footywire-unresolved-row',
        sourceDocumentIds: ['2026-R1-WBD-CAR_ply_mystery_player'],
        sourcePlayerName: 'Mystery Player',
        sourceTeam: 'Western Bulldogs',
        reviewedAt: '2026-04-26',
      },
    },
  ],
};

export const playerDirectoryRepairs2026: PlayerDirectoryRepairPlan =
  buildPlayerDirectoryRepairPlanFromRosterEvidence(
    playerRosterEvidence2026,
    manualPlayerDirectoryRepairs2026
  );
