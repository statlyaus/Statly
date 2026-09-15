import { createHash } from 'node:crypto';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION = 'official-afl-player-continuity/v1';
// Reviewed source facts only. Exact byte matching is required; this grants no canonical approval.
const references = [
  {
    url: 'https://www.gwsgiants.com.au/news/325692/patfull-calls-full-time',
    sha256: '2ba435e9668d60727b7828dff722cf62b708029ce60ef1e1e92152adce71b1e0',
    year: 2016,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Joel Patfull',
      recordedClub: 'Greater Western Sydney',
      membershipSeasons: [2015, 2016],
      // Published 12 October: delisted now, with future rookie re-listing planned.
      // Preserve membership before that report, without bridging the list change.
      observedThrough: '2016-10-11',
      membershipStatus: 'listed',
      coverage: 'partial_calendar_boundary',
    },
  },
  {
    url: 'https://www.hawthornfc.com.au/news/412198/hale-calls-time-on-decorated-career',
    sha256: '37bc743e43a6e935a93f32add7a128e7fcd36642f52e8d9edbe35a31a79ba9e8',
    year: 2013,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'David Hale',
      recordedClub: 'Hawthorn',
      membershipSeasons: [2011, 2012, 2013],
      observedThrough: '2013-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.afc.com.au/news/23562/tambling-retires-from-afl',
    sha256: 'c87750fddffd6dc024cc924e623f97615749d7575eb5d0245b518c5d8e7d237e',
    year: 2013,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Richard Tambling',
      recordedClub: 'Adelaide',
      membershipSeasons: [2011, 2012, 2013],
      observedThrough: '2012-12-31',
      membershipStatus: 'listed',
      coverage: 'partial_calendar_boundary',
    },
  },
  {
    url: 'https://www.lions.com.au/news/267468/lions-delist-five',
    sha256: '7a917864336d9c14cf012f0e8a0e40335af643b79ad18510fba1f0e8ff9ef40b',
    year: 2013,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Rohan Bewick',
      recordedClub: 'Brisbane',
      membershipSeasons: [2011, 2012, 2013],
      observedThrough: '2013-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.afc.com.au/news/1221480/luke-brown-announces-retirement',
    sha256: '18c6743c5051ff2d83ae39fd1fda941d5694f234bfb791a854a7cbaaf86ca98d',
    year: 2014,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Luke Brown',
      recordedClub: 'Adelaide',
      membershipSeasons: [2012, 2013, 2014],
      observedThrough: '2014-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.melbournefc.com.au/news/141584/melbourne-makes-further-delistings',
    sha256: '6d562b8978cc2de1786c153f689dc2ced337f975a26fb861762ba94e6a5af952',
    year: 2015,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Chris Dawes',
      recordedClub: 'Melbourne',
      membershipSeasons: [2013, 2014, 2015],
      observedThrough: '2015-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.geelongcats.com.au/news/311699/caddy-becomes-a-tiger',
    sha256: '0caba24920f8cbe155024cd11f5c36373afdabb8d1e173e4640bf7eb8e1aa29e',
    year: 2015,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Josh Caddy',
      recordedClub: 'Geelong',
      membershipSeasons: [2013, 2014, 2015],
      observedThrough: '2015-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.melbournefc.com.au/news/278812/preuss-joins-melbourne-in-trade-deal',
    sha256: '35747cfeb6995c7aa9a11a432efad67058e0bbd59a15f1fb5d11b748abaa7cac',
    year: 2016,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Dom Tyson',
      recordedClub: 'Melbourne',
      membershipSeasons: [2014, 2015, 2016],
      observedThrough: '2016-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.afl.com.au/news/520496/christensen',
    sha256: 'e79bdec3f4fa5bd150a5c19530bdfa3004d273725ac91ae5676282704a25eb29',
    year: 2017,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Allen Christensen',
      recordedClub: 'Brisbane',
      membershipSeasons: [2015, 2016, 2017],
      observedThrough: '2017-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.gwsgiants.com.au/news/87629/a-numbers-game',
    sha256: 'd621bdd34e54f7c9003f40ed6d49867bf9c3fda461750228751c8e101d710525',
    year: 2017,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Joel Patfull',
      recordedClub: 'Greater Western Sydney',
      membershipSeasons: [2017],
      observedThrough: '2016-11-30',
      membershipStatus: 'retired_rookie_listed',
      coverage: 'partial_calendar_boundary',
    },
  },
  {
    url: 'https://www.afl.com.au/news/72824/the-fire-still-burns-ex-sun-wants-another-shot',
    sha256: '563200ddc0e2b6fb454cfa3d25e6f806b90d20659d5f6d15ee88da1e116b6a1b',
    year: 2017,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Mitch Hallahan',
      recordedClub: 'Gold Coast',
      membershipSeasons: [2015, 2016, 2017],
      observedThrough: '2016-12-31',
      membershipStatus: 'listed',
      coverage: 'partial_calendar_boundary',
    },
  },
  {
    url: 'https://www.geelongcats.com.au/news/32253/quartet-sign-on',
    sha256: '7c9e500de8b5bdb629ed6ec4d305bbb16eacafa1c89e452f1a2ad416461d32af',
    year: 2017,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Rhys Stanley',
      recordedClub: 'Geelong',
      membershipSeasons: [2015, 2016, 2017],
      observedThrough: '2017-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.portadelaidefc.com.au/news/1664506/dixon-hangs-up-the-boots',
    sha256: '2c114df1ce64f7b034b074ca5444634f1bd5662606e4ef76c22ff58baa3e780c',
    year: 2018,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Charlie Dixon',
      recordedClub: 'Port Adelaide',
      membershipSeasons: [2016, 2017, 2018],
      observedThrough: '2018-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
  {
    url: 'https://www.geelongcats.com.au/news/1734906/trio-of-re-signings',
    sha256: '79f7f772bcda3b66e59e59a71794002a2cd67b070e2ad72b6638bbee7814d6cc',
    year: 2023,
    claim: {
      kind: 'player_continuity_reference',
      recordedPlayer: 'Jeremy Cameron',
      recordedClub: 'Geelong',
      membershipSeasons: [2021, 2022, 2023],
      observedThrough: '2023-12-31',
      membershipStatus: 'listed',
      coverage: 'full_target_window',
    },
  },
] as const;

export function reviewedOfficialAflPlayerContinuity(url: string, year: number) {
  return references.find((source) => source.url === url && source.year === year) ?? null;
}

export function parseOfficialAflPlayerContinuity(
  html: string,
  input: {
    anchorSeasonYear: number;
    capture: AflTradeExternalEvidenceContent['capture'];
  }
) {
  const { capture } = input;
  const source = reviewedOfficialAflPlayerContinuity(capture.sourceUrl, input.anchorSeasonYear);
  if (
    !source ||
    capture.parserVersion !== OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION ||
    capture.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'text/html' ||
    capture.contentSha256 !== source.sha256 ||
    createHash('sha256').update(html, 'utf8').digest('hex') !== source.sha256
  ) {
    throw new TypeError(
      'Player continuity requires exact reviewed URL, bytes, year, media type and parser.'
    );
  }
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'official_afl',
        capture,
        sourceRow: { ordinal: 1, sourceKey: 'player-continuity-reference:1' },
        claim: { ...source.claim, membershipSeasons: [...source.claim.membershipSeasons] },
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
