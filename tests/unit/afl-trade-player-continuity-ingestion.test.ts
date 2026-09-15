import { describe, expect, it } from 'vitest';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import {
  parseOfficialAflPlayerContinuity,
  reviewedOfficialAflPlayerContinuity,
  OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflPlayerContinuityFacts';
const sources = [
  ['https://www.hawthornfc.com.au/news/412198/hale-calls-time-on-decorated-career', 2013],
  ['https://www.afc.com.au/news/23562/tambling-retires-from-afl', 2013],
  ['https://www.lions.com.au/news/267468/lions-delist-five', 2013],
  ['https://www.afc.com.au/news/1221480/luke-brown-announces-retirement', 2014],
  ['https://www.melbournefc.com.au/news/141584/melbourne-makes-further-delistings', 2015],
  ['https://www.geelongcats.com.au/news/311699/caddy-becomes-a-tiger', 2015],
  ['https://www.melbournefc.com.au/news/278812/preuss-joins-melbourne-in-trade-deal', 2016],
  ['https://www.afl.com.au/news/520496/christensen', 2017],
  ['https://www.gwsgiants.com.au/news/87629/a-numbers-game', 2017],
  ['https://www.afl.com.au/news/72824/the-fire-still-burns-ex-sun-wants-another-shot', 2017],
  ['https://www.geelongcats.com.au/news/32253/quartet-sign-on', 2017],
  ['https://www.portadelaidefc.com.au/news/1664506/dixon-hangs-up-the-boots', 2018],
  ['https://www.geelongcats.com.au/news/1734906/trio-of-re-signings', 2023],
] as const;
const request = (url: string, year: number) =>
  ({
    provider: 'official_afl',
    capabilityId: 'official-afl-player-continuity',
    sourceUrl: url,
    anchorSeasonYear: year,
    draftPathway: null,
    discoveryFromSeasonYear: null,
    parserVersion: OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION,
    effectiveAt: '2026-09-15T00:00:00.000Z',
  }) as IngestAflTradeExternalPageRequest;
describe('continuity source boundary', () => {
  it.each(sources)('restricts %s to its reviewed year and URL', (url, year) => {
    expect(() => validateAflTradeExternalCaptureScope(request(url, year))).not.toThrow();
    for (const changed of [url + '?other=1', url + '#fragment', url.replace('https:', 'http:')])
      expect(() => validateAflTradeExternalCaptureScope(request(changed, year))).toThrow();
    expect(() => validateAflTradeExternalCaptureScope(request(url, year + 1))).toThrow();
  });
  it.each([
    { provider: 'draftguru' },
    { draftPathway: 'national' },
    { parserVersion: 'wrong' },
    { discoveryFromSeasonYear: 2010 },
    { effectiveAt: 'invalid' },
    { effectiveAt: '2000-01-01T00:00:00.000Z' },
  ])('rejects incompatible capture %j', (change) => {
    expect(() =>
      validateAflTradeExternalCaptureScope({
        ...request(...sources[0]),
        ...change,
      } as IngestAflTradeExternalPageRequest)
    ).toThrow();
  });
  it.each(sources)('rejects changed original bytes for %s', (url, year) => {
    const source = reviewedOfficialAflPlayerContinuity(url, year)!;
    const input = {
      anchorSeasonYear: year,
      capture: {
        sourceUrl: url,
        contentSha256: source.sha256,
        parserVersion: OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION,
        mediaType: 'text/html',
      },
    } as Parameters<typeof parseOfficialAflPlayerContinuity>[1];
    expect(() => parseOfficialAflPlayerContinuity('<article>changed</article>', input)).toThrow(
      'exact reviewed'
    );
  });
});

it('preserves Patfull retired listing without claiming year-end continuity', () => {
  const source = reviewedOfficialAflPlayerContinuity(
    'https://www.gwsgiants.com.au/news/87629/a-numbers-game',
    2017
  )!;
  expect(source.claim.membershipStatus).toBe('retired_rookie_listed');
  expect(source.claim.observedThrough).toBe('2016-11-30');
  expect(source.claim.coverage).toBe('partial_calendar_boundary');
});

it('requires both membership and observation years plus every emitted field', async () => {
  const { requireAflTradeExternalEvidenceFieldAuthority: check } =
    await import('@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest');
  const claim = reviewedOfficialAflPlayerContinuity(
    'https://www.gwsgiants.com.au/news/87629/a-numbers-game',
    2017
  )!.claim;
  const fields = Object.keys(claim)
    .filter((k) => k !== 'kind')
    .map((k) => 'player_continuity_reference.' + k);
  type Input = Parameters<typeof check>[0];
  const fixture = () =>
    ({
      evidence: [{ content: { claim } }],
      sourceRights: {
        content: {
          scope: { seasonRanges: [{ from: 2016, to: 2017 }] },
          fields: fields.map((f) => ({
            sourceField: f,
            normalizedField: f,
            uses: { archive_fact: 'allowed' },
          })),
        },
      },
      gate0aReceipt: {
        content: {
          request: { fieldUses: fields.map((f) => ({ sourceField: f, use: 'archive_fact' })) },
        },
      },
    }) as unknown as Input;
  expect(() => check(fixture())).not.toThrow();
  const year = fixture();
  year.sourceRights.content.scope.seasonRanges = [{ from: 2017, to: 2017 }];
  expect(() => check(year)).toThrow('continuity years');
  const field = fixture();
  field.sourceRights.content.fields.pop();
  expect(() => check(field)).toThrow('outside the reviewed Gate');
  const gate = fixture();
  gate.gate0aReceipt.content.request.fieldUses = [];
  expect(() => check(gate)).toThrow('outside the reviewed Gate');
});
