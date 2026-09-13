import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2013_SESSION_URLS = {
  membership:
    'https://www.afl.com.au/news/117263/boom-or-bust-we-grade-your-clubs-2013-draft-and-trade-haul',
  event:
    'https://www.afl.com.au/news/452467/giants-make-tom-boyd-no1-cats-spring-a-shock-and-the-hawks-throw-a-lifeline-to-dayle-garlett',
  total: 'https://www.afl.com.au/news/149290/10-things-we-learned-from-the-2019-nab-afl-draft',
} as const;
const membershipDigests = [
  '00de64fdfa06110c4fdc8360f2f7b263998b9694ee488e3caaea05488204e4b3',
  'c6cf36ab2dd8a02a0ed6399fb35f0c185a4e09088e7e17e5ecc69291a883f04b',
  '913dc0d1aab67c4af6528d1344aa24f800e4f4c73c92c3a477f402e1dce51fbf',
  'bd5a16f095f08692df34ff00835357378c25f7f9930c6d51b9eee8cb4a57befa',
  'aa62b0dbd8a01ba0da759cf433d6467248e0ee0e91b5b623ccda6eb31ba4e935',
  '200907c355109c59ed8aab2fe45897192c35371931a4f94cfd273d7d058065f2',
  'd6a9bd64359cd98969aa31fa6301f91f964c1f62d96fee6b5996ae7727b74c94',
  'ad130bb5a0272395562c811b3afc5f20301aab20dd6a6bc0a1939ae29a434490',
  '8e9c2baba96ee948b37f3dd7d497c93c49f75c09ac1f29676b7300ec074726e1',
  'dba66d5989b254b20426a36da4859de4c45a8223adb2bc9f418248db5d81692c',
  'ed32ce1bf298e39d5f255b27f790834f489a8b4f36646951c4db4325b2d940e7',
  '152c12517674a36212cc24bb3bc3a2dc6e5cf7463d33eeaa7a306019e701a9e3',
  '89a7feb106ac6cda8f010b03c415c3ee80573a1c3882af742066188d7256b0cb',
  '4db965d88a6498ff50d94d35c2a49990653eb70d817abc0cce1059dee06f2362',
  'ba32bb342710d95e6659a4e302d2cc34f7d5ea210ee184e82ae15a208b0569f7',
  'ed952cdcc5844b2228eacb34ec042566ea66032bb49dffb8401509c6d9cbab79',
  '9d2f3410f2a747d479a9296903dbe9e62b937b9c941828107ed14ed0cdddcaca',
  'cec68df768866c35182bfb9881f69e1eaa7b7d507daa0224f752b624e71d531a',
  '54a32eee9f891cc329b01c1bed7d77fbea69231e4e2e8bb75b1febdbff6b88eb',
  'aa55d85cd6288d8102434c5e6bd6a6c818ad912b7fad152268037f60a096d8dd',
  '6c7541c12e2974276099645c0ad4f088c6373c724b6bbe072373c469942c0ab4',
  'c86566479b51f9b79f1ced2741a314cd0ae838fd782534a35b314cdc2827d190',
  '262b4631a4182c288f3d2378b876b52d08b1bf9de2d939b120bb566cfe625db0',
  'ca715fc12ad6f35deb1b4bd22f126637014681d3fbea69a655159e14b997f177',
  '87b21c62248feb4a818d343e3b13564a74235777e57726a30360822706aa681c',
  'ca715fc12ad6f35deb1b4bd22f126637014681d3fbea69a655159e14b997f177',
  '1bdd57b956a3f12d49970298a331feac24eead95658483bb678e0d3d7890fcde',
  '9eb8487b2a3d44c586d34904c6e281907124394a0d261696d51ebe4258627974',
  '0be6f116b6dbc9e3a6c403703c0324f030e4bcc2770edeeceb184792dee293f9',
  '4f862f97408fd0d2b65b0dd5cb4d7601466e36f0dadb56334a87a97357c4f53c',
  '7073cd0fa4243829bcfcd5ec7648238610efa660f4011cf3bd58d0ca2a4da0af',
  'a78e3cc9166d77de4ec661bc5ed0500b9cdb5c816f423e10408efbfea0018ac2',
  'b9689b311f707f1b6f3946898f82883ffaac92901b91cc62e301a005bb81cdb3',
  'c16cb529c05328670f97696a32d79c34244b8d98948b93d6b87198fabab3a575',
  '419a25329064ba95a664580bef14df192ad7b31cd1a0bba8bd4b71d9578f2741',
  '80de490c441bce275ef1da18d30dd14148093d65a05c57f934ce20935f4e120e',
];
const membershipNumbers = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 49, 50, 51, 52,
  55, 56, 57, 58, 60, 62, 65, 66, 68, 77, 97,
];
const eventDigest = '6b56e4f395fd397c8677aba86d4391764af3a4396ae111450d37f30de4f57ae3';
const totalDigest = '3999f05559f47fd9b1657422b652b0041cfc443ecd45c324c17e645ddbdffe0c';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function reviewedOfficialAflDraft2013EffectiveYear(url: string): number | null {
  if (url === OFFICIAL_AFL_2013_SESSION_URLS.membership) return 2018;
  if (url === OFFICIAL_AFL_2013_SESSION_URLS.event) return 2013;
  if (url === OFFICIAL_AFL_2013_SESSION_URLS.total) return 2019;
  return null;
}

export function parseOfficialAflDraft2013SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed 2013 source, date or scoped statements changed.',
      },
    ],
  });
  const $ = load(html),
    body = $('.article-body'),
    dates = $('.article__date > time');
  if (body.length !== 1 || dates.length !== 1) return fail();
  const url = input.capture.sourceUrl;
  const common = { draftYear: 2013, draftType: 'national' as const };
  let claims: AflTradeExternalEvidenceContent['claim'][];
  if (url === OFFICIAL_AFL_2013_SESSION_URLS.membership) {
    if (dates.attr('datetime') !== '2018-10-26T22:00:00Z') return fail();
    const paragraphs = body
      .find('p')
      .map((_, element) => normalize($(element).text()))
      .get();
    const digests = paragraphs
      .filter(
        (text) => text.startsWith('2013 NAB AFL Draft:') || text.startsWith('Rookie upgrades:')
      )
      .map(hash);
    if (
      digests.length !== membershipDigests.length ||
      digests.some((digest, index) => digest !== membershipDigests[index])
    )
      return fail();
    const giants = body
      .find('p')
      .filter((_, element) =>
        normalize($(element).text()).startsWith('2013 NAB AFL Draft: Tom Boyd')
      );
    if (giants.length !== 1 || giants.prev('p').find('img[alt="GWS Giants"]').length !== 1)
      return fail();
    // The complete published list explicitly identifies five listed rookie upgrades.
    // The retained numbers below exclude only those rows and keep both zone selections.
    claims = [
      { ...common, kind: 'draft_completed_inventory', selectionNumbers: [...membershipNumbers] },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 97,
        player: { nativeId: null, recordedName: 'Jake Barrett' },
        selectedByClub: { nativeId: null, recordedName: 'GWS' },
      },
    ];
  } else if (url === OFFICIAL_AFL_2013_SESSION_URLS.event) {
    if (dates.attr('datetime') !== '2013-11-21T09:53:31Z') return fail();
    const leaves = body
      .find('div')
      .filter((_, element) => $(element).children().length === 0)
      .map((_, element) => hash(normalize($(element).text())))
      .get();
    if (leaves.filter((digest) => digest === eventDigest).length !== 1) return fail();
    claims = [
      { ...common, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2013-11-21' },
      { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Tom Boyd' },
        selectedByClub: { nativeId: null, recordedName: 'Greater Western Sydney' },
      },
    ];
  } else if (url === OFFICIAL_AFL_2013_SESSION_URLS.total) {
    if (dates.attr('datetime') !== '2019-11-28T11:30:00Z') return fail();
    const digests = body
      .children('p')
      .map((_, element) => hash(normalize($(element).text())))
      .get();
    if (digests.filter((digest) => digest === totalDigest).length !== 1) return fail();
    claims = [{ ...common, kind: 'draft_completed_total', selectionCount: 62 }];
  } else return fail();
  return {
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `national-draft:2013:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
