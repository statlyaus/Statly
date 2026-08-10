import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflDraftTradeOutcomeObservationSchema } from '@/server/aflTradeIntelligence/modeling/draftTradeOutcomeContracts';
import {
  AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
  evaluateAflDraftTradeAnnualWorkbookRows,
  validateAflDraftTradeAnnualWorkbookHeader,
} from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';

const H = 'b'.repeat(64);
const CREATED_AT = '2026-08-06T08:00:00.000Z';
const artifact = createAflTradeCanonicalJsonArtifactRef({ workbook: 'fixture' }, CREATED_AT);
const source = {
  sheet: '2020',
  sourceArtifact: artifact,
  evidenceItemId: `evidence-item:${H}`,
  rightsReceiptId: `gate0a-evaluation:${H}`,
  rightsDisposition: 'approved' as const,
  adapterVersion: 'workbook-evaluation-v1',
};
const scope = {
  competition: 'AFL' as const,
  basis: 'after_event' as const,
  clubScope: 'all_subsequent_afl_clubs' as const,
  season: null,
  effectiveFrom: '2020-11-01T00:00:00.000Z',
  effectiveThrough: CREATED_AT,
};
const resolvedIdentity = {
  player: {
    kind: 'player' as const,
    state: 'resolved' as const,
    canonicalId: 'afl-player:fixture',
    resolutionEvidenceId: `evidence-item:${H}`,
  },
  event: {
    kind: 'event' as const,
    state: 'resolved' as const,
    canonicalId: 'afl-event:fixture',
    resolutionEvidenceId: `evidence-item:${H}`,
  },
  asset: {
    kind: 'asset' as const,
    state: 'resolved' as const,
    canonicalId: 'afl-asset:fixture',
    resolutionEvidenceId: `evidence-item:${H}`,
  },
};

function annualRow(
  overrides: Partial<Record<(typeof AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER)[number], string>> = {}
) {
  const values: Record<(typeof AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER)[number], string> = {
    document_id: '2020_0001',
    year: '2020',
    pick: '',
    draft_type: 'Trade',
    draft_number: '',
    club: 'Example AFL Club',
    signing: '',
    player: 'Example Player',
    age: '24',
    height_cm: '188',
    weight_kg: '84',
    original_club: 'Example Original Club',
    grade: 'B',
    games: '10',
    goals: '2',
    coaches_votes: '5',
    brownlow_votes: '0',
    awards: '',
    ...overrides,
  };
  return AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER.map((field) => values[field]);
}

function independentlyObserved(
  metricCode: 'games' | 'goals' | 'coaches_votes' | 'brownlow_votes',
  value: number
) {
  return aflDraftTradeOutcomeObservationSchema.parse({
    metricCode,
    sourceRole: 'independently_observed',
    scope,
    availability: 'exact',
    value,
    rawValue: String(value),
    provenance: {
      evidenceItemId: `evidence-item:${H}`,
      sourceArtifact: artifact,
      rightsReceiptId: `gate0a-evaluation:${H}`,
      rightsDisposition: 'approved',
      locator: {
        sourceRecordId: 'provider-player-season:fixture',
        sheet: 'approved-source',
        row: 1,
        field: metricCode,
      },
      adapterVersion: 'approved-source-v1',
    },
  });
}

describe('AFL Draft and Trade annual workbook evaluation', () => {
  it('requires the exact ordered 18-column annual header', () => {
    expect(() =>
      validateAflDraftTradeAnnualWorkbookHeader(AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER)
    ).not.toThrow();
    const renamed: string[] = [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER];
    renamed[15] = 'coach_votes';
    expect(() => validateAflDraftTradeAnnualWorkbookHeader(renamed)).toThrow();
    expect(() => validateAflDraftTradeAnnualWorkbookHeader(renamed.slice(0, 17))).toThrow();
  });

  it('reconciles recorded and independent values without collapsing missing into zero', () => {
    const [record] = evaluateAflDraftTradeAnnualWorkbookRows({
      header: AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
      source,
      rows: [
        {
          rowNumber: 2,
          cells: annualRow({ coaches_votes: '' }),
          scope,
          identity: resolvedIdentity,
          independentlyObserved: {
            games: independentlyObserved('games', 10),
            goals: independentlyObserved('goals', 3),
            coaches_votes: independentlyObserved('coaches_votes', 5),
          },
        },
      ],
    });

    expect(record.metrics.games).toMatchObject({ state: 'matched', publicationEligible: true });
    expect(record.metrics.goals).toMatchObject({ state: 'different', publicationEligible: false });
    expect(record.metrics.coaches_votes).toMatchObject({
      state: 'source_only',
      publicationEligible: true,
      recorded: { availability: 'unavailable', value: null },
    });
    expect(record.metrics.brownlow_votes).toMatchObject({
      state: 'recorded_only',
      publicationEligible: false,
      recorded: { availability: 'exact', value: 0 },
    });
    expect(record.publicationEligible).toBe(false);
  });

  it('keeps composite games explicit, ambiguous, partial, and publication-ineligible', () => {
    const [record] = evaluateAflDraftTradeAnnualWorkbookRows({
      header: AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
      source,
      rows: [
        {
          rowNumber: 2,
          cells: annualRow({ games: '268 (231)' }),
          scope,
          identity: resolvedIdentity,
          independentlyObserved: { games: independentlyObserved('games', 268) },
        },
      ],
    });

    expect(record.metrics.games).toMatchObject({
      state: 'partial',
      publicationEligible: false,
      recorded: {
        availability: 'partial',
        value: null,
        rawValue: '268 (231)',
        reasonCode: 'ambiguous_composite_scope',
        components: [
          { ordinal: 1, value: 268 },
          { ordinal: 2, value: 231 },
        ],
      },
    });
    expect(record.publicationEligible).toBe(false);
  });

  it('parses award segments but leaves workbook-only achievements unresolved', () => {
    const [record] = evaluateAflDraftTradeAnnualWorkbookRows({
      header: AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
      source,
      rows: [
        {
          rowNumber: 2,
          cells: annualRow({ awards: 'AA: 2022; B&F: 2023, 2024; malformed' }),
          scope,
          identity: resolvedIdentity,
        },
      ],
    });

    expect(record.achievements).toHaveLength(3);
    expect(record.achievements[0]).toMatchObject({
      state: 'unresolved',
      playerId: 'afl-player:fixture',
      parsedAwardToken: 'AA',
      parsedSeasons: [2022],
      reasonCodes: ['award_identity_unresolved'],
      publicationEligible: false,
    });
    expect(record.achievements[1]).toMatchObject({
      parsedAwardToken: 'B&F',
      parsedSeasons: [2023, 2024],
      reasonCodes: ['award_identity_unresolved', 'club_at_season_unresolved'],
    });
    expect(record.achievements[2]).toMatchObject({
      parsedAwardToken: null,
      parsedSeasons: [],
      reasonCodes: ['award_syntax_ambiguous', 'award_identity_unresolved'],
    });
    expect(record.publicationEligible).toBe(false);
  });

  it('rejects rows whose document identity does not match the annual sheet', () => {
    expect(() =>
      evaluateAflDraftTradeAnnualWorkbookRows({
        header: AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
        source,
        rows: [
          {
            rowNumber: 2,
            cells: annualRow({ document_id: '2021_0001' }),
            scope,
          },
        ],
      })
    ).toThrow('does not match its year sheet');
  });
});
