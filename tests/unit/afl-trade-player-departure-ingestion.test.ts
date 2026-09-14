import { describe, expect, it } from 'vitest';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import {
  parseOfficialAflPlayerDeparture,
  reviewedOfficialAflPlayerDeparture,
  OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflPlayerDepartureFacts';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';
const sources = [
  ['https://www.westernbulldogs.com.au/news/752883/sherman-seeks-new-home', 2012],
  ['https://www.afl.com.au/news/38163/afl-club-list-lodgement-one-wednesday-october-31', 2012],
  ['https://www.afl.com.au/news/444640/young-demon-barry-walks-out-on-melbourne', 2014],
  ['https://www.richmondfc.com.au/news/47770/club-statement-chris-yarran', 2016],
] as const;
const request = (url: string, year: number) =>
  ({
    provider: 'official_afl',
    capabilityId: 'official-afl-player-departure',
    sourceUrl: url,
    anchorSeasonYear: year,
    draftPathway: null,
    discoveryFromSeasonYear: null,
    parserVersion: OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION,
    effectiveAt: '2026-09-15T00:00:00.000Z',
  }) as IngestAflTradeExternalPageRequest;
describe('departure source boundary', () => {
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
    const source = reviewedOfficialAflPlayerDeparture(url, year)!;
    const input = {
      anchorSeasonYear: year,
      capture: {
        sourceUrl: url,
        contentSha256: source.sha256,
        parserVersion: OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION,
        mediaType: 'text/html',
      },
    } as Parameters<typeof parseOfficialAflPlayerDeparture>[1];
    expect(() => parseOfficialAflPlayerDeparture('<article>changed</article>', input)).toThrow(
      'exact reviewed'
    );
  });
  it('excludes Patfull retirement as departure', () =>
    expect(
      reviewedOfficialAflPlayerDeparture(
        'https://www.gwsgiants.com.au/news/325692/patfull-calls-full-time',
        2016
      )
    ).toBeNull());
  it('requires both factual year scope and every emitted field permission', () => {
    type Input = Parameters<typeof requireAflTradeExternalEvidenceFieldAuthority>[0];
    const claim = {
      kind: 'player_departure_reference',
      departureYear: 2012,
      recordedPlayer: 'Fixture',
      recordedClub: 'Fixture',
      reason: 'delisting',
    };
    const fields = Object.keys(claim)
      .filter((k) => k !== 'kind')
      .map((k) => `player_departure_reference.${k}`);
    const fixture = () =>
      ({
        evidence: [{ content: { claim } }],
        sourceRights: {
          content: {
            scope: { seasonRanges: [{ from: 2012, to: 2012 }] },
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
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(fixture())).not.toThrow();
    const wrongYear = fixture();
    wrongYear.sourceRights.content.scope.seasonRanges = [{ from: 2013, to: 2013 }];
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(wrongYear)).toThrow('event years');
    const noField = fixture();
    noField.sourceRights.content.fields.pop();
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(noField)).toThrow(
      'outside the reviewed Gate'
    );
    const noGate = fixture();
    noGate.gate0aReceipt.content.request.fieldUses = [];
    expect(() => requireAflTradeExternalEvidenceFieldAuthority(noGate)).toThrow(
      'outside the reviewed Gate'
    );
  });
});
