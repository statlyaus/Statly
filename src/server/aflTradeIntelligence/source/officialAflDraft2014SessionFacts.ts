import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';
const reviewed = {
  urls: {
    membership:
      'https://www.afl.com.au/news/149034/best-to-worst-we-grade-your-clubs-2014-draft-and-trade-haul',
    event:
      'https://www.afl.com.au/news/68212/draft-wrap-saints-grab-mccartin-with-first-pick-as-cats-snare-surprise-at-no10',
    total: 'https://www.afl.com.au/news/162070/close-to-80-live-picks-expected-at-draft',
    steele: 'https://www.afl.com.au/news/156041/saints-join-race-for-promising-gws-mid',
    finlayson: 'https://www.afl.com.au/news/56745/breakthrough-start-earns-giant-a-new-deal',
  },
  membershipDigests: [
    '1e3d3fa055d79ad54676b7b493327e223b78c4e007978014e00a97d58ca986eb',
    'df547075a5c2c13f68f5f403dd1db87cab42542bcd2155658debc6bda93af75d',
    '70e0f74710109975bf00e63cb945cbbfaf54119d76efcae1bd2195aebb2c0ca1',
    '0f350937c47e9aacc31c4fcd055444ed7f266a467b30b1af259a8fa7352a3f99',
    'd4a584bccd74e25f13662642821190845d45f67f547c86a5b70e78840a9f2e82',
    '47072645dd89933288c5cd5abcbb4ea982cb97f50b7810f15dcdfef9688d8dfe',
    'a317dfe1be8692401574f61ba51f97381aa7b247130c39945ea29a1a3a292043',
    'a1832f09f67bf8124b02711971884ef0c450e71f401bbc2b948a52d3b46121ef',
    'd8fd771c14cc3ba13da3f7e393c935f992a265b682b3290c04c0117a85c947d1',
    '8dfbe1b85072bae130b6f97a596cf5884d94901adc2a6786352fdd593f75b457',
    '682149b95c56294b138011381e134a3cf8923aedf3357041e0fd0c90dcc4b0d7',
    '90f6ddc943bfb12dac5223c2d7f43f5cdaa0f0614e488ebbef77c5f713d4da8c',
    '7c40c2214bb348b41da14dcc8f1df894b2877da60a16300fe19eb7a23bcb074f',
    '4a32699f0e0e267b11736b7964ea1872f5248bf6bc8c280991a1d59bb4de95b6',
    '69a73b9bba316b2a67e10c75b19a92e83fe948b86b11db482a7ab555970461a6',
    'b0495dae3048dc8c38a7d8ac2155f02f9511241a20c12ff454f05a075df52ed5',
    'c6d2cdad5e2aee97f35f6a19c1d6ab641da2d3ef019842b32380cf14060ab829',
    '86762c05c4279df4a8d014fe7ac035510681de90a51c5e008ef20318b85ddf70',
  ],
  eventDigests: [
    '72a3df7ec4449854ee09b971c9f4fe7a150e924fc66bf21dceeb224c412c1bd7',
    '8b488c369c6d477551ba5bb986b3243303d81605942dfddca7dff8752a79ac21',
  ],
  totalDigests: ['5dbf328abdd4c2c63e058c98168d5f4a62ca6bba5538073e47a8ec49f137e5ea'],
  steeleDigests: [
    '0144addbeb2fbf3089c47af544e49325cd099980b6f0fbef684e7566308c31fd',
    'b4c00b27da1cb0955e5b0f7558111f720ff7cf51f006eac85b678b88f6e5e558',
  ],
  finlaysonDigests: [
    '2be3354d29a58904a468495c8fff6f78dc4062f4753fc438b440d4f39d0a5970',
    'bc39f99e423207925177de3faeb29ea54b57e61e93791ab8c965d021fe71db41',
  ],
} as const;
export const OFFICIAL_AFL_2014_SESSION_URLS = reviewed.urls;
const times = {
  membership: '2019-11-15T19:00:00Z',
  event: '2014-11-27T12:52:18Z',
  total: '2016-10-27T04:11:04Z',
  steele: '2016-07-28T09:35:10Z',
  finlayson: '2018-06-05T11:25:00Z',
} as const;
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function reviewedOfficialAflDraft2014EffectiveYear(url: string): number | null {
  const key = (Object.keys(reviewed.urls) as (keyof typeof times)[]).find(
    (k) => reviewed.urls[k] === url
  );
  return key ? Number(times[key].slice(0, 4)) : null;
}
export function parseOfficialAflDraft2014SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed 2014 source, date or scoped statements changed.',
      },
    ],
  });
  const key = (Object.keys(reviewed.urls) as (keyof typeof times)[]).find(
    (k) => reviewed.urls[k] === input.capture.sourceUrl
  );
  if (!key) return fail();
  const $ = load(html),
    body = $('.article-body'),
    date = $('.article__date > time');
  if (body.length !== 1 || date.length !== 1 || date.attr('datetime') !== times[key]) return fail();
  const common = { draftYear: 2014, draftType: 'national' as const };
  let claims: AflTradeExternalEvidenceContent['claim'][];
  if (key === 'membership') {
    const paragraphs = body
      .find('p')
      .map((_, e) => normalize($(e).text()))
      .get()
      .filter((text) => text.startsWith('2014 NAB AFL Draft:'));
    if (
      paragraphs.length !== reviewed.membershipDigests.length ||
      paragraphs.some((text, i) => hash(text) !== reviewed.membershipDigests[i])
    )
      return fail();
    const members: { recordedName: string; selectionNumber: number | null }[] = [];
    for (const paragraph of paragraphs) {
      for (const match of paragraph
        .slice('2014 NAB AFL Draft:'.length)
        .matchAll(/([^,]+?)\s*\(([^)]+)\)/g)) {
        const number = match[2]!.match(/^(?:pick No\.|No\.)?(\d+)(?:\s*[–-].*)?$/);
        if (!number && match[2] !== 'NSW Zone Selection') return fail();
        members.push({
          recordedName: match[1]!.trim(),
          selectionNumber: number ? Number(number[1]) : null,
        });
      }
    }
    if (members.length !== 76 || members.filter((m) => m.selectionNumber === null).length !== 2)
      return fail();
    const brisbane = body
      .find('p')
      .filter((_, e) => normalize($(e).text()).startsWith('2014 NAB AFL Draft: Liam Dawson'));
    if (brisbane.length !== 1 || normalize(brisbane.prev('h6').text()) !== 'BRISBANE')
      return fail();
    claims = [
      { ...common, kind: 'draft_completed_membership_roster', members },
      {
        ...common,
        kind: 'draft_session_boundary',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 86,
        player: { nativeId: null, recordedName: 'Josh Clayton' },
        selectedByClub: { nativeId: null, recordedName: 'Brisbane' },
      },
    ];
  } else {
    const digests = body
      .find('p,div')
      .filter((_, e) => !$(e).children('p,div').length)
      .map((_, e) => hash(normalize($(e).text())))
      .get();
    const required = reviewed[`${key}Digests`];
    if (required.some((digest) => digests.filter((value) => value === digest).length !== 1))
      return fail();
    if (key === 'event')
      claims = [
        { ...common, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2014-11-27' },
        { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
        {
          ...common,
          kind: 'draft_session_boundary',
          sessionOrdinal: 1,
          boundary: 'first',
          selectionNumber: 1,
          player: { nativeId: null, recordedName: 'Patrick McCartin' },
          selectedByClub: { nativeId: null, recordedName: 'St Kilda' },
        },
      ];
    else if (key === 'total')
      claims = [{ ...common, kind: 'draft_completed_total', selectionCount: 76 }];
    else
      claims = [
        {
          ...common,
          kind: 'draft_completed_member_number',
          recordedName: key === 'steele' ? 'Jack Steele' : 'Jeremy Finlayson',
          selectionNumber: key === 'steele' ? 24 : 85,
        },
      ];
  }
  return {
    evidence: claims.map((claim, i) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: { ordinal: i + 1, sourceKey: `national-draft:2014:${claim.kind}:${i + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
