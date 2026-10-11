import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createLocalReviewedDraftNightTradeTargets,
  REVIEWED_DRAFT_NIGHT_TRADES_FIELDS,
  reviewedDraftNightTradesDecisionKey,
  reviewedDraftNightTradesEffectiveAt,
} from '@/server/aflTradeIntelligence/development/localReviewedDraftNightTradeCapture';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import {
  parseReviewedDraftNightTrades,
  readReviewedDraftNightTrades,
  REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION,
  REVIEWED_DRAFT_NIGHT_TRADES_SCHEMA_VERSION,
  reviewedDraftNightDealEventId,
} from '@/server/aflTradeIntelligence/source/reviewedDraftNightTradeStatement';
import {
  reviewedDraftNightTradeStatement,
  reviewedStatementSourceUrl,
} from '@/server/aflTradeIntelligence/source/reviewedDraftNightTradeSourceScope';

const digest = (character: string) => character.repeat(64);
const url = reviewedStatementSourceUrl(
  'src/server/aflTradeIntelligence/source/reviewedDraftNightTrades/2024-v1.json'
);
const capture: AflTradeExternalEvidenceContent['capture'] = {
  captureId: `source-capture:${digest('5')}`,
  artifactId: `artifact:${digest('6')}`,
  contentSha256: digest('6'),
  mediaType: 'application/json',
  sourceUrl: url,
  capturedAt: '2026-10-12T00:00:00.000Z',
  effectiveAt: '2024-11-21T00:00:00.000Z',
  parserVersion: REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION,
  fieldManifestSha256: digest('7'),
};
// Synthetic season facts for the refusal tests; the registered seasons carry their reviewed sources.
const registered = {
  season: 2024,
  draftNights: ['2024-11-20', '2024-11-21'],
  selectionCount: 70,
  sources: [],
};
const evidence = (character: string) => ({
  evidenceArtifactId: `artifact:${digest(character)}`,
  evidenceUrl: `https://www.afl.com.au/news/${character.charCodeAt(0)}/synthetic-draft-night-trade`,
});
type Deal = Parameters<typeof reviewedDraftNightDealEventId>[1];
type Asset = Deal['sides'][number]['gives'][number];
type Given = number | { draftYear: number; roundNumber: number; originalClub: string };
const asset = (given: Given): Asset =>
  typeof given === 'number' ? { kind: 'slot', slot: given } : { kind: 'future_pick', ...given };
const deal = (
  occurredOn: string,
  first: [string, Given[]],
  second: [string, Given[]],
  character = 'a'
): Deal => ({
  occurredOn,
  sides: [
    { club: first[0], gives: first[1].map(asset) },
    { club: second[0], gives: second[1].map(asset) },
  ],
  ...evidence(character),
});
const statement = (deals: unknown[], season = 2024) =>
  JSON.stringify({
    schemaVersion: REVIEWED_DRAFT_NIGHT_TRADES_SCHEMA_VERSION,
    season,
    draftType: 'national',
    deals,
  });
const read = (text: string) =>
  readReviewedDraftNightTrades(text, { capture, season: 2024, registered });
const codes = (text: string) => read(text).issues.map(({ code }) => code);

describe('reviewed draft-night pick trade statements (statlyaus/Statly#886)', () => {
  it('reads each deal into the claims a Draftguru trade page yields', () => {
    const result = read(
      statement([deal('2024-11-20', ['West Coast', [12]], ['Port Adelaide', [17, 41]])])
    );
    expect(result.issues).toEqual([]);
    const eventId = 'draft-night-2024-2024-11-20-port-adelaide-17-41--west-coast-12';
    expect(result.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'transaction',
        nativeEventId: eventId,
        seasonYear: 2024,
        occurredOn: '2024-11-20',
        transactionType: 'trade',
        title: null,
      },
      {
        kind: 'transaction_party',
        nativeEventId: eventId,
        nativePartyId: 'port-adelaide',
        club: { nativeId: null, recordedName: 'Port Adelaide' },
      },
      {
        kind: 'transaction_party',
        nativeEventId: eventId,
        nativePartyId: 'west-coast',
        club: { nativeId: null, recordedName: 'West Coast' },
      },
      ...[
        [12, 'West Coast', 'Port Adelaide'],
        [17, 'Port Adelaide', 'West Coast'],
        [41, 'Port Adelaide', 'West Coast'],
      ].map(([slot, from, to]) => ({
        kind: 'directed_transfer',
        nativeEventId: eventId,
        // Draftguru keys a numbered pick transfer exactly so.
        nativeTransferId: `pick:2024:national:${slot}`,
        fromClub: { nativeId: null, recordedName: from },
        toClub: { nativeId: null, recordedName: to },
        asset: {
          kind: 'current_pick',
          draftYear: 2024,
          draftType: 'national',
          recordedPickNumber: slot,
        },
      })),
    ]);
    expect(new Set(result.evidence.map(({ content }) => content.provider))).toEqual(
      new Set(['statly_reviewed'])
    );
    expect(result.evidence.every(({ content }) => !content.publicationEligible)).toBe(true);
  });

  it('keys a deal by its night, clubs and slots, never by its position or side order', () => {
    const forward = deal('2024-11-21', ['Brisbane Lions', [53, 54]], ['Collingwood', [60]]);
    const reversed = deal('2024-11-21', ['Collingwood', [60]], ['Brisbane Lions', [54, 53]]);
    expect(reviewedDraftNightDealEventId(2024, forward)).toBe(
      reviewedDraftNightDealEventId(2024, reversed)
    );
    // A Draftguru trade id starts with its year; this never does.
    expect(reviewedDraftNightDealEventId(2024, forward)).not.toMatch(/^\d{4}-/);
  });

  it('emits exactly the reviewed Gate 0A field leaves', () => {
    const result = read(
      statement([
        deal(
          '2024-11-20',
          ['Richmond', [23, { draftYear: 2025, roundNumber: 2, originalClub: 'Richmond' }]],
          [
            'North Melbourne',
            [{ draftYear: 2025, roundNumber: 1, originalClub: 'North Melbourne' }],
          ]
        ),
      ])
    );
    const leaves = new Set<string>();
    const walk = (value: unknown, prefix: string) => {
      if (value === null || value === undefined) return;
      if (typeof value !== 'object') {
        leaves.add(prefix);
        return;
      }
      for (const [key, nested] of Object.entries(value as Record<string, unknown>))
        if (!(key === 'kind' && !prefix.includes('.'))) walk(nested, `${prefix}.${key}`);
    };
    result.evidence.forEach(({ content }) => walk(content.claim, content.claim.kind));
    expect([...leaves].sort()).toEqual([...REVIEWED_DRAFT_NIGHT_TRADES_FIELDS]);
  });

  it('reads a later season pick as the future pick a Draftguru trade page states', () => {
    // Richmond's pick 23 (stated as 27 on the night) and its 2025 second for North's 2025 first.
    const result = read(
      statement([
        {
          ...deal(
            '2024-11-20',
            ['Richmond', [{ draftYear: 2025, roundNumber: 2, originalClub: 'Richmond' }]],
            [
              'North Melbourne',
              [{ draftYear: 2025, roundNumber: 1, originalClub: 'North Melbourne' }],
            ]
          ),
          sides: [
            {
              club: 'Richmond',
              gives: [
                { kind: 'slot', slot: 23, statedAs: 27 },
                { kind: 'future_pick', draftYear: 2025, roundNumber: 2, originalClub: 'Richmond' },
              ],
            },
            {
              club: 'North Melbourne',
              gives: [
                {
                  kind: 'future_pick',
                  draftYear: 2025,
                  roundNumber: 1,
                  originalClub: 'North Melbourne',
                },
              ],
            },
          ],
        },
      ])
    );
    expect(result.issues).toEqual([]);
    const transfers = result.evidence
      .map(({ content }) => content.claim)
      .filter((claim) => claim.kind === 'directed_transfer');
    expect(transfers.map((claim) => [claim.nativeTransferId, claim.fromClub.recordedName])).toEqual(
      [
        ['future-pick:2025:national:1:north-melbourne', 'North Melbourne'],
        ['future-pick:2025:national:2:richmond', 'Richmond'],
        ['pick:2024:national:23', 'Richmond'],
      ]
    );
    expect(transfers[0]!.asset).toEqual({
      kind: 'future_pick',
      draftYear: 2025,
      draftType: 'national',
      roundNumber: 1,
      originalClub: { nativeId: null, recordedName: 'North Melbourne' },
    });
    // The number stated on the night is for review only; the claim carries the pre-draft slot.
    expect(transfers[2]!.asset).toMatchObject({ recordedPickNumber: 23 });
    expect(transfers[0]!.nativeEventId).toBe(
      'draft-night-2024-2024-11-20-north-melbourne-2025r1-north-melbourne--richmond-2025r2-richmond-23'
    );
  });

  it('refuses a deal that moves no slot of the draft, or a future pick that is not later', () => {
    const future = (draftYear: number, club: string) => ({
      draftYear,
      roundNumber: 1,
      originalClub: club,
    });
    expect(
      codes(
        statement([
          deal(
            '2024-11-20',
            ['Richmond', [future(2025, 'Richmond')]],
            ['Carlton', [future(2025, 'Carlton')]]
          ),
        ])
      )
    ).toEqual(['no_slot']);
    expect(
      codes(
        statement([deal('2024-11-20', ['Richmond', [23]], ['Carlton', [future(2024, 'Carlton')]])])
      )
    ).toEqual(['future_pick_not_future']);
    expect(
      codes(
        statement([
          deal(
            '2024-11-20',
            ['Richmond', [23, future(2025, 'Carlton')]],
            ['Carlton', [future(2025, 'Carlton')]]
          ),
        ])
      )
    ).toEqual(['pick_on_both_sides']);
  });

  it('refuses a deal without its evidence artifact', () => {
    const { evidenceArtifactId: _omitted, ...withoutEvidence } = deal(
      '2024-11-20',
      ['West Coast', [12]],
      ['Richmond', [23]]
    );
    const result = read(statement([withoutEvidence]));
    expect(result.evidence).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'invalid_statement' })]);
    expect(result.issues[0]!.detail).toContain('evidenceArtifactId');
    expect(
      codes(
        statement([
          {
            ...deal('2024-11-20', ['West Coast', [12]], ['Richmond', [23]]),
            evidenceArtifactId: 'x',
          },
        ])
      )
    ).toEqual(['invalid_statement']);
  });

  it('refuses a pick given and received in one deal, and a pick listed twice on one side', () => {
    expect(
      codes(statement([deal('2024-11-20', ['West Coast', [12]], ['Richmond', [12, 23]])]))
    ).toEqual(['pick_on_both_sides']);
    expect(
      codes(statement([deal('2024-11-20', ['West Coast', [12, 12]], ['Richmond', [23]])]))
    ).toEqual(['duplicate_pick']);
  });

  it('refuses a slot outside 1 to N of that draft', () => {
    expect(
      codes(statement([deal('2024-11-20', ['West Coast', [71]], ['Richmond', [23]])]))
    ).toEqual(['slot_out_of_range']);
    // Zero is not a slot at all.
    expect(codes(statement([deal('2024-11-20', ['West Coast', [0]], ['Richmond', [23]])]))).toEqual(
      ['invalid_statement']
    );
    expect(
      read(statement([deal('2024-11-20', ['West Coast', [70]], ['Richmond', [1]])])).issues
    ).toEqual([]);
  });

  it('refuses a date that is not one of the draft nights', () => {
    // 2024-11-19 is the eve of the draft; 2024-10-16 is the trade-period deadline.
    for (const occurredOn of ['2024-11-19', '2024-10-16', '2024-11-22']) {
      expect(
        codes(statement([deal(occurredOn, ['West Coast', [12]], ['Richmond', [23]])]))
      ).toEqual(['date_not_draft_night']);
    }
  });

  it('refuses a duplicate deal however its sides are written, and a club trading with itself', () => {
    expect(
      codes(
        statement([
          deal('2024-11-20', ['West Coast', [12]], ['Richmond', [23]], 'a'),
          deal('2024-11-20', ['Richmond', [23]], ['West Coast', [12]], 'b'),
        ])
      )
    ).toEqual(['duplicate_deal']);
    expect(
      codes(statement([deal('2024-11-20', ['West Coast', [12]], ['west coast', [23]])]))
    ).toEqual(['same_club_both_sides']);
  });

  it('refuses a statement of another season, malformed JSON, and an empty or unknown schema', () => {
    expect(
      codes(statement([deal('2024-11-20', ['West Coast', [12]], ['Richmond', [23]])], 2023))
    ).toEqual(['season_mismatch']);
    expect(codes('{')).toEqual(['invalid_statement']);
    expect(codes(statement([]))).toEqual(['invalid_statement']);
    expect(
      codes(
        JSON.stringify({
          ...JSON.parse(statement([])),
          schemaVersion: 'statly-reviewed-draft-night-trades/v2',
        })
      )
    ).toEqual(['invalid_statement']);
  });

  it('emits nothing for an unregistered statement', () => {
    expect(reviewedDraftNightTradeStatement(url)).toBeNull();
    const result = parseReviewedDraftNightTrades(
      statement([deal('2024-11-20', ['West Coast', [12]], ['Richmond', [23]])]),
      { capture, season: 2024 }
    );
    expect(result).toEqual({
      evidence: [],
      issues: [expect.objectContaining({ code: 'unregistered_statement' })],
    });
  });

  it('binds the statly_reviewed provider to a statement in the Statly repository', () => {
    const content =
      (
        provider: AflTradeExternalEvidenceContent['provider'],
        sourceUrl: string,
        claim: AflTradeExternalEvidenceContent['claim']
      ) =>
      () =>
        createAflTradeExternalEvidenceEnvelope({
          schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
          provider,
          capture: { ...capture, sourceUrl },
          sourceRow: { ordinal: 1, sourceKey: 'row' },
          claim,
          publicationEligible: false,
        });
    const transaction = {
      kind: 'transaction',
      nativeEventId: 'draft-night-2024-x',
      seasonYear: 2024,
      occurredOn: '2024-11-20',
      transactionType: 'trade',
      title: null,
    } as const;
    expect(content('statly_reviewed', url, transaction)).not.toThrow();
    expect(content('statly_reviewed', 'https://www.afl.com.au/news/1/x', transaction)).toThrow(
      /statly_reviewed provider/
    );
    expect(content('official_afl', url, transaction)).toThrow(/statly_reviewed provider/);
    expect(
      content('statly_reviewed', url, {
        kind: 'pick_custody',
        observedAt: '2024-11-20T00:00:00.000Z',
        draftYear: 2024,
        draftType: 'national',
        roundNumber: null,
        recordedPickNumber: 12,
        originalClub: null,
        currentClub: { nativeId: null, recordedName: 'West Coast' },
      })
    ).toThrow(/not permitted for provider statly_reviewed/);
  });

  it('admits only a registered statement through the capture scope gate', () => {
    const request = {
      environment: 'non_production' as const,
      provider: 'statly_reviewed' as const,
      competition: 'AFLM',
      anchorSeasonYear: 2024,
      draftPathway: null,
      dataset: 'statly-reviewed-draft-night-trades',
      datasetVersion: 'v1',
      accessMechanism: 'automated_web',
      capabilityId: 'reviewed-draft-night-pick-trades',
      sourceUrl: url,
      capturedAt: '2026-10-12T00:00:00.000Z',
      effectiveAt: '2024-11-21T00:00:00.000Z',
      parserVersion: REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION,
      fieldManifestSha256: digest('7'),
      maximumBytes: 1_000_000,
    };
    expect(() => validateAflTradeExternalCaptureScope(request)).toThrow(/do not exactly match/);
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...request, provider: 'official_afl' })
    ).toThrow(/do not exactly match/);
  });

  it('reads the registered synthetic statement, admitted only in test_fixture', () => {
    const path = 'tests/fixtures/reviewed-draft-night-trades/2024-synthetic-v1.json';
    const bytes = readFileSync(path);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const sourceUrl = reviewedStatementSourceUrl(path);
    expect(reviewedDraftNightTradeStatement(sourceUrl)).toMatchObject({
      season: 2024,
      sha256: sha,
      environments: ['test_fixture'],
    });
    const parsed = parseReviewedDraftNightTrades(bytes.toString('utf8'), {
      capture: { ...capture, sourceUrl, contentSha256: sha, artifactId: `artifact:${sha}` },
      season: 2024,
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'transaction',
      'transaction_party',
      'transaction_party',
      'directed_transfer',
      'directed_transfer',
    ]);
    // Other bytes at the registered URL are refused.
    expect(
      parseReviewedDraftNightTrades(bytes.toString('utf8'), {
        capture: { ...capture, sourceUrl },
        season: 2024,
      }).issues
    ).toEqual([expect.objectContaining({ code: 'unregistered_statement' })]);
    const request = {
      environment: 'test_fixture' as const,
      provider: 'statly_reviewed' as const,
      competition: 'AFLM',
      anchorSeasonYear: 2024,
      draftPathway: null,
      dataset: 'statly-reviewed-draft-night-trades',
      datasetVersion: 'v1',
      accessMechanism: 'automated_web',
      capabilityId: 'reviewed-draft-night-pick-trades',
      sourceUrl,
      capturedAt: '2026-10-12T00:00:00.000Z',
      effectiveAt: '2024-11-21T00:00:00.000Z',
      parserVersion: REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION,
      fieldManifestSha256: digest('7'),
      maximumBytes: 1_000_000,
    };
    expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
    for (const changed of [
      { environment: 'non_production' as const },
      { anchorSeasonYear: 2023 },
      { effectiveAt: '2024-11-20T00:00:00.000Z' },
      { draftPathway: 'national' as const },
    ])
      expect(() => validateAflTradeExternalCaptureScope({ ...request, ...changed })).toThrow(
        /do not exactly match/
      );
    // The local runner captures non-production statements only; none is registered yet.
    expect(() => createLocalReviewedDraftNightTradeTargets([2024])).toThrow(
      /No reviewed draft-night trade statement is registered for 2024/
    );
  });

  it('pins one decision per season and parser, and refuses a season with no statement', () => {
    expect(reviewedDraftNightTradesDecisionKey(2024)).toBe(
      'reviewed-draft-night-pick-trades-issue886-private-2024-draft-night-v1'
    );
    expect(reviewedDraftNightTradesEffectiveAt(['2024-11-21', '2024-11-20'])).toBe(
      '2024-11-21T00:00:00.000Z'
    );
    expect(() => createLocalReviewedDraftNightTradeTargets([2018])).toThrow(
      /No reviewed draft-night trade statement is registered for 2018/
    );
    expect(() => createLocalReviewedDraftNightTradeTargets([])).toThrow(/distinct seasons/);
  });
});
