import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LocalExternalCaptureError,
  loadRecordedLocalCaptureAuthority,
} from '@/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import {
  createLocalOfficialAflTradePeriodTargets,
  createOfficialAflTradePeriodCaptureCommand,
  OFFICIAL_AFL_TRADE_PERIOD_FIELDS,
} from '@/server/aflTradeIntelligence/development/localOfficialAflTradePeriodCapture';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { evaluateAflTradeGate0AAgainstDecision } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';
import {
  OFFICIAL_AFL_TRADE_PERIOD_PARSER_VERSION,
  parseOfficialAflTradePeriodDates,
} from '@/server/aflTradeIntelligence/source/officialAflTradePeriodAdapter';
import {
  reviewedOfficialAflTradePeriodPage,
  reviewedOfficialAflTradePeriodPages,
} from '@/server/aflTradeIntelligence/source/officialAflTradePeriodSourceScope';
import { parseLocalExternalCaptureArguments } from '../../Scripts/capture-local-external-pages';
import {
  approveNarrowAuthority,
  officialAflTradePeriodAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';

const digest = (character: string) => character.repeat(64);
const evaluatedAt = '2026-10-11T00:00:00.000Z';
const evidenceIds = {
  productOwnerAuthorization: `artifact:${digest('1')}`,
  boundedCapturePlan: `artifact:${digest('2')}`,
  publicAccessReview: `artifact:${digest('3')}`,
  fieldBoundaryReview: `artifact:${digest('4')}`,
};
const page2023 = 'https://www.afl.com.au/news/1004881/afl-confirms-dates-for-2023-afl-trade-and-draft-period';

function recorded(season: number, clientVersion?: string) {
  const authority = officialAflTradePeriodAuthority({
    season,
    ...(clientVersion === undefined ? {} : { clientVersion }),
    evidenceIds,
    timing: {
      termsEffectiveAt: '2026-09-10T00:00:00.000Z',
      termsExpireAt: '2027-09-09T00:00:00.000Z',
      rightsProposedAt: '2026-10-10T00:00:00.000Z',
      proposalProposedAt: '2026-10-10T00:00:01.000Z',
    },
  });
  return {
    ...authority,
    decision: approveNarrowAuthority(authority, {
      decidedAt: '2026-10-10T01:00:00.000Z',
      revalidateAt: '2027-09-01T00:00:00.000Z',
    }),
  };
}
type Recorded = ReturnType<typeof recorded>;
function ledgerOf(record: Recorded) {
  const ledger = { proposals: [record.proposal], decisions: [record.decision] };
  return {
    load: async () => ({ revision: 1, ledger }),
    resolveAuthorization: async () => ({ revision: 1, ledger, sourceRights: record.sourceRights }),
  };
}
const capture = (sourceUrl: string, effectiveAt: string) => ({
  captureId: `source-capture:${digest('5')}`,
  artifactId: `artifact:${digest('6')}`,
  contentSha256: digest('6'),
  mediaType: 'text/html',
  sourceUrl,
  capturedAt: evaluatedAt,
  effectiveAt,
  parserVersion: OFFICIAL_AFL_TRADE_PERIOD_PARSER_VERSION,
  fieldManifestSha256: digest('7'),
});
const article = (...paragraphs: string[]) =>
  `<html><body><div class="article__body">${paragraphs.map((p) => `<p>${p}</p>`).join('')}</div></body></html>`;

describe('Official AFL trade-period dates parser v1 (issue 869)', () => {
  const parse = (html: string, seasonYear: number) =>
    parseOfficialAflTradePeriodDates(html, {
      capture: capture(page2023, `${seasonYear}-10-01T00:00:00.000Z`),
      seasonYear,
    });
  const window = (earliestDate: string, latestDate: string) => ({
    precision: 'window',
    eventDate: null,
    earliestDate,
    latestDate,
  });

  it.each([
    [
      'one sentence with both days (2022 and 2025 layouts)',
      article(
        "The AFL's Sign and Trade Period will begin on Friday, September 30 when the free agency window opens.",
        'The Trade Period will start on Monday, October 3 and run through to Wednesday, October 12 with deadline day again finishing in primetime at 7.30pm AEDT.',
        'After that, clubs have until Tuesday, November 15 to make pick swaps.'
      ),
      2022,
      window('2022-10-03', '2022-10-12'),
    ],
    [
      'the deadline in the next sentence (2023 layout)',
      article(
        'The AFL Free Agency period commences Friday, October 6 and runs until Friday, October 13.',
        'The Continental Tyres AFL Trade Period will commence on Monday, October 9 at 9am. Clubs will have until 7.30pm Wednesday, October 18 to trade players.',
        'Round One of the 2023 AFL National Draft will be held on Monday, November 20.'
      ),
      2023,
      window('2023-10-09', '2023-10-18'),
    ],
    [
      'a free-agency sentence that mentions the trade period (2024 layout)',
      article(
        'Players will be able to move via free agency for a week through to Friday, October 11, with that window overlapping with the start of the trade period.',
        'The opening day of the trade period will be Monday, October 7 and it will close on Wednesday, October 16, with the prime-time finish on the final day.'
      ),
      2024,
      window('2024-10-07', '2024-10-16'),
    ],
    [
      'a key-dates list with a range (2020 layout) and an AFLW period',
      article(
        '<strong>Key Player Movement Dates</strong>',
        'October 30-November 6: AFL Free Agency Period<br />November 4-12: AFL Trade Period<br />November 20: List Lodgment #1',
        'The AFLW Trade Period will run from Thursday, December 7 to Thursday, December 14.'
      ),
      2020,
      window('2020-11-04', '2020-11-12'),
    ],
  ])('reads %s as one window', (_label, html, seasonYear, expected) => {
    const result = parse(html, seasonYear);
    expect(result.issues).toEqual([]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.content.claim).toEqual({
      kind: 'trade_period_window',
      seasonYear,
      datePrecision: expected,
    });
    expect(result.evidence[0]!.content.sourceRow).toEqual({
      ordinal: 1,
      sourceKey: `trade-period:${seasonYear}`,
    });
  });

  it.each([
    ['no trade-period paragraph', article('The draft will be held on Wednesday, November 20.'), 'invalid_page'],
    [
      'only an opening day',
      article('The Trade Period will commence on Monday, October 9 at 9am.'),
      'invalid_page',
    ],
    [
      'two competing windows',
      article(
        'The Trade Period will run from Monday, October 3 to Wednesday, October 12.',
        'A second trade period will run from Monday, October 17 to Wednesday, October 26.'
      ),
      'ambiguous_trade_period',
    ],
    [
      'a window longer than a month',
      article('The Trade Period will run from Monday, October 3 to Wednesday, November 30.'),
      'invalid_page',
    ],
    ['an empty body', '<html><body></body></html>', 'invalid_page'],
  ])('refuses %s', (_label, html, code) => {
    const result = parse(html, 2023);
    expect(result.evidence).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([code]);
  });

  it('refuses a window outside the stated season', () => {
    const result = parse(
      article('The Trade Period will run from Monday, October 3 to Wednesday, October 12.'),
      2022
    );
    expect(result.evidence).toHaveLength(1);
    expect(
      parseOfficialAflTradePeriodDates(article('x'), {
        capture: capture(page2023, '2023-10-01T00:00:00.000Z'),
        seasonYear: 2023,
      }).issues[0]!.code
    ).toBe('invalid_page');
    expect(() => parse(article('x'), 1800)).toThrow('AFL-era');
  });
});

describe('reviewed Official AFL trade-period announcements', () => {
  it('enumerates one reviewed page per season for 2020 and 2022 to 2025, and none for 2019 or 2021', () => {
    const targets = createLocalOfficialAflTradePeriodTargets([2025, 2020, 2022, 2023, 2024]);
    expect(targets.map(({ season }) => season)).toEqual([2020, 2022, 2023, 2024, 2025]);
    expect(targets.every(({ sourceUrl }) => new URL(sourceUrl).hostname === 'www.afl.com.au')).toBe(
      true
    );
    expect(targets[2]).toEqual({
      capabilityId: 'official-afl-trade-period-dates',
      season: 2023,
      sourceUrl: page2023,
      effectiveAt: '2023-10-09T00:00:00.000Z',
    });
    for (const season of [2019, 2021])
      expect(reviewedOfficialAflTradePeriodPages(season)).toEqual([]);
    expect(reviewedOfficialAflTradePeriodPage(page2023)?.latestDate).toBe('2023-10-18');
  });

  it('keeps every reviewed window inside its season and under a month', () => {
    for (const season of [2020, 2022, 2023, 2024, 2025]) {
      for (const page of reviewedOfficialAflTradePeriodPages(season)) {
        expect(page.earliestDate.slice(0, 4)).toBe(String(season));
        expect(page.earliestDate < page.latestDate).toBe(true);
        expect(
          (Date.parse(page.latestDate) - Date.parse(page.earliestDate)) / 86_400_000
        ).toBeLessThanOrEqual(31);
      }
    }
  });

  it.each([[[]], [[2023, 2023]], [[2019]], [[2021]], [[2026]]])('rejects seasons %j', (seasons) => {
    expect(() => createLocalOfficialAflTradePeriodTargets(seasons)).toThrow(
      LocalExternalCaptureError
    );
  });

  it.each([
    [[]],
    [['https://www.afl.com.au/news/1/not-reviewed']],
    // A reviewed page of a season that was not requested.
    [['https://www.afl.com.au/news/1110249/afl-confirms-dates-for-2024-free-agency-trade-and-draft-period']],
  ])('refuses URLs %j for 2023', (urls) => {
    expect(() => createLocalOfficialAflTradePeriodTargets([2023], urls)).toThrow(
      LocalExternalCaptureError
    );
  });
});

describe('recorded Official AFL trade-period authority', () => {
  it('loads the per-season decision recorded under the issue869 period-v1 key', async () => {
    const record = recorded(2023);
    expect(record.decision.content.decisionKey).toBe(
      'official-afl-trade-period-dates-issue869-private-2023-period-v1'
    );
    const loaded = await loadRecordedLocalCaptureAuthority(
      ledgerOf(record),
      'official-afl-trade-period-dates',
      2023,
      evaluatedAt
    );
    expect(loaded.decisionId).toBe(record.decision.decisionId);
  });

  it('refuses a recorded decision for another parser version', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recorded(2023, 'official-afl-trade-period-parser/v0')),
        'official-afl-trade-period-dates',
        2023,
        evaluatedAt
      )
    ).rejects.toThrow(/official-afl-trade-period-parser\/v1/);
  });

  it('builds a command the scope rules and the recorded decision admit, and names every emitted leaf', () => {
    const record = recorded(2023);
    const [target] = createLocalOfficialAflTradePeriodTargets([2023]);
    const command = createOfficialAflTradePeriodCaptureCommand(record, {
      target: target!,
      capturedAt: evaluatedAt,
      maximumBytes: 1024,
    });
    expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
    expect(command.request).toMatchObject({
      provider: 'official_afl',
      draftPathway: null,
      capabilityId: 'official-afl-trade-period-dates',
      parserVersion: 'official-afl-trade-period-parser/v1',
      sourceUrl: page2023,
      effectiveAt: '2023-10-09T00:00:00.000Z',
    });
    expect(
      evaluateAflTradeGate0AAgainstDecision(record.decision, record.sourceRights, command.gateRequest)
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    const { evidence } = parseOfficialAflTradePeriodDates(
      article(
        'The Continental Tyres AFL Trade Period will commence on Monday, October 9 at 9am. Clubs will have until 7.30pm Wednesday, October 18 to trade players.'
      ),
      { capture: capture(page2023, target!.effectiveAt), seasonYear: 2023 }
    );
    expect(evidence).toHaveLength(1);
    const receipt = createAflTradeGate0AReceipt(
      { proposals: [record.proposal], decisions: [record.decision] },
      record.sourceRights,
      command.gateRequest,
      evaluatedAt
    );
    expect(() =>
      requireAflTradeExternalEvidenceFieldAuthority({
        evidence,
        sourceRights: record.sourceRights,
        gate0aReceipt: receipt,
      })
    ).not.toThrow();
    expect([...OFFICIAL_AFL_TRADE_PERIOD_FIELDS]).toEqual([
      'trade_period_window.datePrecision.earliestDate',
      'trade_period_window.datePrecision.latestDate',
      'trade_period_window.datePrecision.precision',
      'trade_period_window.seasonYear',
    ]);
  });

  it('refuses a mismatched authority and an altered decision', () => {
    const record = recorded(2023);
    const [target] = createLocalOfficialAflTradePeriodTargets([2023]);
    expect(() =>
      createOfficialAflTradePeriodCaptureCommand(
        {
          ...record,
          sourceRights: {
            ...record.sourceRights,
            content: { ...record.sourceRights.content, provider: 'draftguru' as const },
          },
        },
        { target: target!, capturedAt: evaluatedAt, maximumBytes: 1024 }
      )
    ).toThrow('not an Official AFL trade-period capability');
    const altered = aflTradeGateDecisionRecordSchema.safeParse({
      decisionId: createAflTradeContentAddress('gate-decision', record.decision.content),
      content: { ...record.decision.content, decisionKey: 'other' },
    });
    expect(altered.success).toBe(false);
  });
});

describe('trade-period capture scope (issue 869)', () => {
  const base = () => {
    const record = recorded(2023);
    const [target] = createLocalOfficialAflTradePeriodTargets([2023]);
    return createOfficialAflTradePeriodCaptureCommand(record, {
      target: target!,
      capturedAt: evaluatedAt,
      maximumBytes: 1024,
    }).request;
  };

  it.each([
    ['an unreviewed afl.com.au article', { sourceUrl: 'https://www.afl.com.au/news/1/not-reviewed' }],
    ['a reviewed page of another season', { anchorSeasonYear: 2024 }],
    ['another effective instant', { effectiveAt: '2023-10-10T00:00:00.000Z' }],
    ['another parser version', { parserVersion: 'official-afl-trade-period-parser/v2' }],
    ['a draft pathway', { draftPathway: 'national' as const }],
    ['another provider', { provider: 'draftguru' as const }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => validateAflTradeExternalCaptureScope({ ...base(), ...overrides })).toThrow(
      /do not exactly match/
    );
  });

  it('parses --season into the reviewed announcements and narrows with --url', () => {
    const env = {
      AFL_OUTCOMES_DATABASE_URL: 'postgresql://statly:secret@127.0.0.1:5432/outcomes',
      AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly private evaluation (contact: owner@example.test)',
    };
    const parsed = parseLocalExternalCaptureArguments(
      [
        '--artifact-root',
        process.cwd(),
        '--capability',
        'official-afl-trade-period-dates',
        '--season',
        '2023',
        '--season',
        '2024',
        '--url',
        page2023,
      ],
      env,
      []
    );
    expect(parsed.targets).toEqual([expect.objectContaining({ season: 2023, sourceUrl: page2023 })]);
  });
});
