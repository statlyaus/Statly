import { expect, it } from 'vitest';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
const capture = {
  captureId: `source-capture:${'1'.repeat(64)}`,
  artifactId: `artifact:${'2'.repeat(64)}`,
  contentSha256: '2'.repeat(64),
  mediaType: 'text/html',
  sourceUrl: 'https://www.afl.com.au/news/114795/countdown-to-d-day',
  capturedAt: '2026-09-14T00:00:00.000Z',
  effectiveAt: '2010-11-13T05:41:00.000Z',
  parserVersion: 'fixture/v1',
  fieldManifestSha256: '3'.repeat(64),
};
const wrap = (claim: any, provider: any = 'official_afl') =>
  createAflTradeExternalEvidenceEnvelope({
    schemaVersion: 'afl-trade-external-evidence/v1',
    provider,
    capture,
    sourceRow: { ordinal: 1, sourceKey: 'population' },
    claim,
    publicationEligible: false,
  });
const scope = { draftYear: 2010, draftType: 'national' };
const claims = [
  {
    ...scope,
    kind: 'draft_completed_list_total',
    population: 'national_selections_and_rookie_promotions',
    playerCount: 107,
  },
  {
    ...scope,
    kind: 'draft_rookie_list_additions',
    clubs: [{ recordedClub: 'A', recordedNames: ['Player'] }],
  },
  {
    ...scope,
    kind: 'draft_rookie_promotion_slots',
    clubs: [{ recordedClub: 'A', selectionNumbers: [101] }],
  },
];
it.each(claims)('preserves separate population claim $kind', (claim) => {
  expect(wrap(claim).content.claim).toEqual(claim);
});
it.each(claims)('rejects relabelled year, provider or reported-total fields for $kind', (claim) => {
  expect(() => wrap({ ...claim, draftYear: 2011 })).toThrow();
  expect(() => wrap(claim, 'draftguru')).toThrow();
  expect(() => wrap({ ...claim, selectionCount: 79 })).toThrow();
});
it.each([
  { ...claims[0], population: 'all_offseason_additions' },
  { ...claims[0], playerCount: 0 },
  { ...claims[1], clubs: [] },
  { ...claims[1], clubs: [{ recordedClub: 'A', recordedNames: ['One', 'One'] }] },
  {
    ...claims[1],
    clubs: [
      { recordedClub: 'A', recordedNames: ['One'] },
      { recordedClub: 'B', recordedNames: ['One'] },
    ],
  },
  {
    ...claims[1],
    clubs: [
      { recordedClub: 'A', recordedNames: ['One'] },
      { recordedClub: 'A', recordedNames: ['Two'] },
    ],
  },
  { ...claims[2], clubs: [{ recordedClub: 'A', selectionNumbers: [101, 101] }] },
  {
    ...claims[2],
    clubs: [
      { recordedClub: 'A', selectionNumbers: [101] },
      { recordedClub: 'B', selectionNumbers: [101] },
    ],
  },
  { ...claims[2], clubs: [{ recordedClub: 'A', selectionNumbers: [0] }] },
])('rejects malformed population %j', (claim) => {
  expect(() => wrap(claim)).toThrow();
});
it('preserves member identity without accepting an asserted boundary or changed scope', () => {
  const claim = {
    kind: 'draft_session_member_identity',
    draftYear: 2010,
    draftType: 'national',
    sessionOrdinal: 1,
    selectionNumber: 104,
    player: { nativeId: null, recordedName: 'Tom Young' },
    selectedByClub: { nativeId: null, recordedName: 'Collingwood' },
  };
  expect(wrap(claim).content.claim).toEqual(claim);
  for (const patch of [
    { boundary: 'last' },
    { draftYear: 2011 },
    { draftType: 'rookie' },
    { sessionOrdinal: 2 },
  ])
    expect(() => wrap({ ...claim, ...patch })).toThrow();
  expect(() => wrap(claim, 'draftguru')).toThrow();
});
