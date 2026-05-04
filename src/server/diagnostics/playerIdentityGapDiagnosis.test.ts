import { describe, expect, it, vi } from 'vitest';

import {
  classifyIdentityGapRows,
  formatIdentityGapCsv,
  formatIdentityGapHumanReport,
  formatIdentityGapJsonl,
  runIdentityGapDiagnosis,
  type DiagnosticFirestoreRow,
  type DiagnosticPlayerDirectory,
  type DiagnosticUnresolvedRow,
} from './playerIdentityGapDiagnosis';

const baseRow = (overrides: Partial<DiagnosticFirestoreRow>): DiagnosticFirestoreRow => ({
  docId: 'doc-1',
  data: {
    season: 2026,
    round_number: 0,
    match_id: '2026-R0-GWS-BUL',
    player_name: 'Joseph Fonti',
    team: 'GWS',
    opponent: 'Western Bulldogs',
    source: 'footywire_match',
    updated_at: '2026-03-05T10:30:00.000Z',
    canonical_stats: { schema_version: 1 },
    raw_row: { player_name: 'Joseph Fonti' },
  },
  ...overrides,
});

const directory = (): DiagnosticPlayerDirectory => ({
  playersById: new Map([
    ['joseph_fonti', { id: 'joseph_fonti', name: 'Joseph Fonti', club: 'GWS', position: 'DEF' }],
    ['other_player', { id: 'other_player', name: 'Other Player', club: 'GWS', position: 'MID' }],
  ]),
  canonicalByKey: new Map(),
  aliasByKey: new Map(),
});

describe('classifyIdentityGapRows', () => {
  it('classifies rows with valid persisted canonical player ids as ok', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          data: {
            ...baseRow({}).data,
            player_id: 'joseph_fonti',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      doc_id: 'doc-1',
      classification: 'canonical_player_id_ok',
      stored_player_id: 'joseph_fonti',
      resolved_player_id: 'joseph_fonti',
    });
    expect(result.summary.classificationCounts.canonical_player_id_ok).toBe(1);
  });

  it('classifies missing player_id rows as resolvable when the resolver finds one player', () => {
    const resolveIdentity = vi.fn().mockReturnValue({
      outcome: 'resolved',
      playerId: 'joseph_fonti',
      playerName: 'Joseph Fonti',
      matchedBy: 'player',
      candidates: ['joseph_fonti'],
    });

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [baseRow({})],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity,
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'missing_player_id_resolvable',
      resolved_player_id: 'joseph_fonti',
      resolved_player_name: 'Joseph Fonti',
      candidate_player_ids: ['joseph_fonti'],
    });
    expect(result.rows[0].secondary_flags).toContain('resolver_matched_by_player');
    expect(resolveIdentity).toHaveBeenCalledTimes(1);
  });

  it('classifies missing player_id rows as ambiguous_or_quarantined when unresolved queue has evidence', () => {
    const unresolvedRows: DiagnosticUnresolvedRow[] = [
      {
        source: 'footywire_match',
        sourceDocumentId: 'doc-1',
        season: 2026,
        round: 0,
        playerName: 'Joseph Fonti',
        normalizedPlayerName: 'joseph fonti',
        team: 'GWS',
        normalizedTeam: 'gws',
        status: 'REVIEWED',
        candidatePlayerIdsJson: JSON.stringify(['joseph_fonti', 'other_player']),
      },
    ];

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [baseRow({})],
      directory: directory(),
      unresolvedRows,
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'ambiguous',
        candidates: ['joseph_fonti', 'other_player'],
        diagnostics: {
          playerName: 'Joseph Fonti',
          normalizedPlayerNames: ['joseph fonti'],
          normalizedTeam: 'gws',
        },
      }),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'ambiguous_or_quarantined',
      unresolved_queue_statuses: ['REVIEWED'],
      candidate_player_ids: ['joseph_fonti', 'other_player'],
    });
    expect(result.rows[0].secondary_flags).toContain('has_unresolved_queue_match');
  });

  it('keeps stale unresolved queue evidence but prefers a current resolved resolver outcome', () => {
    const unresolvedRows: DiagnosticUnresolvedRow[] = [
      {
        source: 'footywire_match',
        sourceDocumentId: 'doc-1',
        season: 2026,
        round: 0,
        playerName: 'Joseph Fonti',
        normalizedPlayerName: 'joseph fonti',
        team: 'GWS',
        normalizedTeam: 'gws',
        status: 'REVIEWED',
        candidatePlayerIdsJson: JSON.stringify(['joseph_fonti', 'other_player']),
      },
    ];

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [baseRow({})],
      directory: directory(),
      unresolvedRows,
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'resolved',
        playerId: 'joseph_fonti',
        playerName: 'Joseph Fonti',
        matchedBy: 'player',
        candidates: ['joseph_fonti'],
      }),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'missing_player_id_resolvable',
      resolved_player_id: 'joseph_fonti',
      resolved_player_name: 'Joseph Fonti',
      unresolved_queue_statuses: ['REVIEWED'],
    });
    expect(result.rows[0].secondary_flags).toContain('has_unresolved_queue_match');
  });

  it('ignores same sourceDocumentId unresolved queue rows from a different source', () => {
    const unresolvedRows: DiagnosticUnresolvedRow[] = [
      {
        source: 'other_source',
        sourceDocumentId: 'doc-1',
        season: 2026,
        round: 0,
        playerName: 'Joseph Fonti',
        normalizedPlayerName: 'joseph fonti',
        team: 'GWS',
        normalizedTeam: 'gws',
        status: 'REVIEWED',
        candidatePlayerIdsJson: JSON.stringify(['other_player']),
      },
    ];

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [baseRow({})],
      directory: directory(),
      unresolvedRows,
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'unresolved',
        candidates: [],
        diagnostics: {
          playerName: 'Joseph Fonti',
          normalizedPlayerNames: ['joseph fonti'],
          normalizedTeam: 'gws',
        },
      }),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'missing_player_id_unresolved',
      unresolved_queue_statuses: [],
      candidate_player_ids: [],
    });
    expect(result.rows[0].secondary_flags).not.toContain('has_unresolved_queue_match');
  });

  it('does not match unresolved queue rows when row source is unavailable', () => {
    const unresolvedRows: DiagnosticUnresolvedRow[] = [
      {
        source: 'other_source',
        sourceDocumentId: 'doc-1',
        season: 2026,
        round: 0,
        playerName: 'Joseph Fonti',
        normalizedPlayerName: 'joseph fonti',
        team: 'GWS',
        normalizedTeam: 'gws',
        status: 'REVIEWED',
        candidatePlayerIdsJson: JSON.stringify(['other_player']),
      },
    ];

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          data: {
            ...baseRow({}).data,
            source: undefined,
          },
        }),
      ],
      directory: directory(),
      unresolvedRows,
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'unresolved',
        candidates: [],
        diagnostics: {
          playerName: 'Joseph Fonti',
          normalizedPlayerNames: ['joseph fonti'],
          normalizedTeam: 'gws',
        },
      }),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'missing_player_id_unresolved',
      source: null,
      unresolved_queue_statuses: [],
      candidate_player_ids: [],
    });
    expect(result.rows[0].secondary_flags).not.toContain('has_unresolved_queue_match');
  });

  it('classifies rows with persisted player_id missing from Prisma separately', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          data: {
            ...baseRow({}).data,
            player_id: 'missing_prisma_player',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'player_id_not_in_prisma',
      stored_player_id: 'missing_prisma_player',
      resolved_player_id: null,
    });
  });

  it('classifies rows outside requested round or missing round as match_context_issue', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          docId: 'doc-no-round',
          data: {
            season: 2026,
            player_name: 'Joseph Fonti',
            team: 'GWS',
            player_id: 'joseph_fonti',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      doc_id: 'doc-no-round',
      classification: 'match_context_issue',
      round: null,
    });
    expect(result.rows[0].secondary_flags).toContain('missing_round');
  });

  it('keeps classification counts aligned with firestoreRowCount', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({ docId: 'doc-1' }),
        baseRow({
          docId: 'doc-2',
          data: { ...baseRow({}).data, player_id: 'joseph_fonti' },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'unresolved',
        candidates: [],
        diagnostics: {
          playerName: 'Joseph Fonti',
          normalizedPlayerNames: ['joseph fonti'],
          normalizedTeam: 'gws',
        },
      }),
      limit: 25,
    });

    const classifiedTotal = Object.values(result.summary.classificationCounts).reduce(
      (sum, value) => sum + value,
      0
    );
    expect(result.summary.firestoreRowCount).toBe(2);
    expect(classifiedTotal).toBe(2);
  });
});

describe('runIdentityGapDiagnosis', () => {
  it('loads injected read dependencies, skips resolver for valid stored player ids, and returns summary counts', async () => {
    const loadFirestoreRows = vi.fn().mockResolvedValue([
      baseRow({
        data: {
          ...baseRow({}).data,
          player_id: 'joseph_fonti',
        },
      }),
    ]);
    const loadDirectory = vi.fn().mockResolvedValue(directory());
    const loadUnresolvedRows = vi.fn().mockResolvedValue([]);
    const resolveIdentity = vi.fn();

    const result = await runIdentityGapDiagnosis({
      season: 2026,
      rounds: [0],
      limit: 25,
      loadFirestoreRows,
      loadDirectory,
      loadUnresolvedRows,
      resolveIdentity,
      generatedAt: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(loadFirestoreRows).toHaveBeenCalledWith({ season: 2026, rounds: [0] });
    expect(loadDirectory).toHaveBeenCalledWith({ season: 2026 });
    expect(loadUnresolvedRows).toHaveBeenCalledWith({ season: 2026, rounds: [0] });
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(result.summary.firestoreRowCount).toBe(1);
    expect(result.summary.classificationCounts.canonical_player_id_ok).toBe(1);
    expect(result.rows).toHaveLength(1);
  });
});

describe('identity gap report formatters', () => {
  it('formats human, jsonl, and csv output from a diagnostic result', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          data: {
            ...baseRow({}).data,
            player_id: 'joseph_fonti',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
      generatedAt: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(formatIdentityGapHumanReport(result)).toContain(
      'Identity gap diagnosis: season 2026, rounds 0'
    );
    expect(formatIdentityGapHumanReport(result)).toContain(
      '- canonical_player_id_ok: 1'
    );
    expect(formatIdentityGapJsonl(result.rows)).toBe(`${JSON.stringify(result.rows[0])}\n`);
    expect(formatIdentityGapCsv(result.rows)).toContain(
      'doc_id,season,round,match_id,storage_match_id,player_name'
    );
    expect(formatIdentityGapCsv(result.rows)).toContain(
      '"doc-1","2026","0","2026-R0-GWS-BUL","2026-R0-GWS-BUL","Joseph Fonti"'
    );
  });
});
