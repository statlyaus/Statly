import { describe, expect, it } from 'vitest';

import {
  buildSeasonRosterCoverage,
  validateReviewedSeasonRoster,
  type ReviewedSeasonRosterEntry,
} from './playerDirectorySeasonRoster';
import type { IdentityGapDiagnosticRow } from './diagnostics/playerIdentityGapDiagnosis';

const rosterEntry = (
  overrides: Partial<ReviewedSeasonRosterEntry> = {}
): ReviewedSeasonRosterEntry => ({
  season: 2026,
  playerId: 'aaron_naughton',
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'listed',
  listStatus: 'active',
  active: true,
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official player profile identifies Naughton as a Western Bulldogs forward.',
  aliases: [],
  diagnosticEvidence: {
    sourceDocumentIds: ['2026-R0-BRI-BUL_ply_aaron_naughton'],
    sourcePlayerName: 'Aaron Naughton',
    sourceTeam: 'Western Bulldogs',
  },
  ...overrides,
});

const diagnosticRow = (
  overrides: Partial<IdentityGapDiagnosticRow> = {}
): IdentityGapDiagnosticRow => ({
  doc_id: '2026-R0-BRI-BUL_ply_aaron_naughton',
  season: 2026,
  round: 0,
  match_id: '2026-R0-BRI-BUL',
  storage_match_id: '2026-R0-BRI-BUL',
  player_name: 'Aaron Naughton',
  team: 'Western Bulldogs',
  opponent: null,
  stored_player_id: 'aaron_naughton',
  classification: 'player_id_not_in_prisma',
  secondary_flags: ['has_canonical_stats', 'has_raw_row'],
  resolved_player_id: null,
  resolved_player_name: null,
  candidate_player_ids: [],
  unresolved_queue_statuses: [],
  source: 'footywire',
  has_canonical_stats: true,
  has_raw_row: true,
  updated_at: '2026-04-20T12:53:56.156Z',
  ...overrides,
});

describe('validateReviewedSeasonRoster', () => {
  it('accepts a reviewed roster entry with official evidence', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [rosterEntry()],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.normalizedEntries).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        normalizedPlayerName: 'aaron naughton',
        normalizedClub: 'western bulldogs',
      }),
    ]);
  });

  it('rejects duplicate player ids with conflicting canonical facts', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [
        rosterEntry(),
        rosterEntry({
          playerName: 'Aaron Naughton Different',
          position: 'DEF',
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Player aaron_naughton appears more than once');
    expect(result.errors).toContain(
      'Player aaron_naughton appears more than once with conflicting canonical facts'
    );
  });

  it('rejects duplicate player ids even when canonical facts match', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [rosterEntry(), rosterEntry()],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Player aaron_naughton appears more than once');
  });

  it('rejects reviewedAt values that are not strict calendar dates', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [
        rosterEntry({
          reviewedAt: '2026-02-31',
        }),
        rosterEntry({
          playerId: 'bailey_dale',
          playerName: 'Bailey Dale',
          reviewedAt: '05/05/2026',
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Player aaron_naughton has invalid reviewedAt',
        'Player bailey_dale has invalid reviewedAt',
      ])
    );
  });

  it('rejects entries without reviewer and source URL', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [
        rosterEntry({
          reviewedBy: '',
          sourceUrl: '',
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Player aaron_naughton is missing reviewedBy');
    expect(result.errors).toContain('Player aaron_naughton is missing sourceUrl');
  });

  it('rejects season mismatches, invalid dates, invalid positions, and missing evidence', () => {
    const result = validateReviewedSeasonRoster({
      season: 2026,
      entries: [
        rosterEntry({
          season: 2025,
          playerId: ' ',
          playerName: '',
          club: '',
          position: 'UTIL' as never,
          sourceLabel: '',
          reviewedAt: 'not-a-date',
          notes: '',
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Player <missing id> has season 2025, expected 2026',
        'Player <missing id> is missing playerId',
        'Player <missing id> is missing playerName',
        'Player <missing id> is missing club',
        'Player <missing id> has invalid position UTIL',
        'Player <missing id> has invalid reviewedAt',
        'Player <missing id> is missing sourceLabel',
        'Player <missing id> is missing notes',
      ])
    );
  });
});

describe('buildSeasonRosterCoverage', () => {
  it('reports diagnostic stored player ids missing from reviewed roster evidence', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [rosterEntry()],
      diagnosticRows: [
        diagnosticRow(),
        diagnosticRow({
          doc_id: '2026-R0-BRI-BUL_ply_bailey_dale',
          stored_player_id: 'bailey_dale',
          player_name: 'Bailey Dale',
        }),
      ],
    });

    expect(coverage.coveredStoredPlayerIds).toEqual(['aaron_naughton']);
    expect(coverage.missingStoredPlayerIds).toEqual(['bailey_dale']);
    expect(coverage.ok).toBe(false);
  });

  it('rejects covered ids when diagnostic evidence does not match the row', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [
        rosterEntry({
          diagnosticEvidence: {
            sourceDocumentIds: ['other-doc'],
            sourcePlayerName: 'Other Player',
            sourceTeam: 'Brisbane',
          },
        }),
      ],
      diagnosticRows: [diagnosticRow()],
    });

    expect(coverage.ok).toBe(false);
    expect(coverage.missingStoredPlayerIds).toEqual([]);
    expect(coverage.evidenceMismatchErrors).toEqual(
      expect.arrayContaining([
        'Roster evidence for aaron_naughton does not include diagnostic document 2026-R0-BRI-BUL_ply_aaron_naughton',
        'Roster evidence for aaron_naughton source player name Other Player does not match diagnostic name Aaron Naughton',
        'Roster evidence for aaron_naughton source team Brisbane does not match diagnostic team Western Bulldogs',
      ])
    );
  });

  it('rejects covered ids without diagnostic evidence', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [rosterEntry({ diagnosticEvidence: undefined })],
      diagnosticRows: [diagnosticRow()],
    });

    expect(coverage.ok).toBe(false);
    expect(coverage.missingStoredPlayerIds).toEqual([]);
    expect(coverage.evidenceMismatchErrors).toEqual([
      'Roster evidence for aaron_naughton is missing diagnostic evidence',
    ]);
  });

  it('ignores diagnostic rows outside player_id_not_in_prisma coverage checks', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [],
      diagnosticRows: [
        diagnosticRow({
          classification: 'canonical_player_id_ok',
        }),
        diagnosticRow({
          season: 2025,
          stored_player_id: 'bailey_dale',
        }),
        diagnosticRow({
          stored_player_id: null,
        }),
      ],
    });

    expect(coverage.ok).toBe(true);
    expect(coverage.diagnosticStoredPlayerIds).toEqual([]);
    expect(coverage.missingStoredPlayerIds).toEqual([]);
  });

  it('ignores non-semantic diagnostic rows without canonical stats or raw rows', () => {
    const coverage = buildSeasonRosterCoverage({
      season: 2026,
      rosterEntries: [],
      diagnosticRows: [
        diagnosticRow({
          stored_player_id: 'nasiah_wanganeenmilera',
          player_name: 'Nasiah Wanganeen-Milera',
          secondary_flags: [],
          has_canonical_stats: false,
          has_raw_row: false,
        }),
      ],
    });

    expect(coverage.ok).toBe(true);
    expect(coverage.diagnosticStoredPlayerIds).toEqual([]);
    expect(coverage.ignoredNonSemanticStoredPlayerIds).toEqual(['nasiah_wanganeenmilera']);
  });
});
