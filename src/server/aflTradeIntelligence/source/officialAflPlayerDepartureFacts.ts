import { createHash } from 'node:crypto';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

export const OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION = 'official-afl-player-departure/v1';
// Reviewed source facts only. Exact byte matching is required; this grants no canonical approval.
const references = [
  {
    url: 'https://www.westernbulldogs.com.au/news/752883/sherman-seeks-new-home',
    sha256: 'c0366f94fd3b73b7b6f454f97bb16a2aeda7c4ffdc4a0223305432e5ddbd23de',
    year: 2012,
    recordedPlayer: 'Justin Sherman',
    recordedClub: 'Western Bulldogs',
    reason: 'contract_release',
  },
  {
    url: 'https://www.afl.com.au/news/38163/afl-club-list-lodgement-one-wednesday-october-31',
    sha256: 'defd01792b7060bddf41eb9f1f4e367301efe04a79ed3d7af48601f2cac929a3',
    year: 2012,
    recordedPlayer: 'Simon Phillips',
    recordedClub: 'Port Adelaide',
    reason: 'delisting',
  },
  {
    url: 'https://www.afl.com.au/news/444640/young-demon-barry-walks-out-on-melbourne',
    sha256: 'c4c5388205d0283bc3c859978e073cbd3b31ec1395187ee0db19d1ab08a3f024',
    year: 2014,
    recordedPlayer: 'Dom Barry',
    recordedClub: 'Melbourne',
    reason: 'resignation',
  },
  {
    url: 'https://www.richmondfc.com.au/news/47770/club-statement-chris-yarran',
    sha256: '18fcbd313fa11ad00ccb5d8a26e921d3584b717b5843ce244e44613c3fea2a7d',
    year: 2016,
    recordedPlayer: 'Chris Yarran',
    recordedClub: 'Richmond',
    reason: 'contract_release',
  },
] as const;

export function reviewedOfficialAflPlayerDeparture(url: string, year: number) {
  return references.find((source) => source.url === url && source.year === year) ?? null;
}

export function parseOfficialAflPlayerDeparture(
  html: string,
  input: {
    anchorSeasonYear: number;
    capture: AflTradeExternalEvidenceContent['capture'];
  }
) {
  const { capture } = input;
  const source = reviewedOfficialAflPlayerDeparture(capture.sourceUrl, input.anchorSeasonYear);
  if (
    !source ||
    capture.parserVersion !== OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION ||
    capture.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'text/html' ||
    capture.contentSha256 !== source.sha256 ||
    createHash('sha256').update(html, 'utf8').digest('hex') !== source.sha256
  ) {
    throw new TypeError(
      'Player departure requires exact reviewed URL, bytes, year, media type and parser.'
    );
  }
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'official_afl',
        capture,
        sourceRow: { ordinal: 1, sourceKey: 'player-departure-reference:1' },
        claim: {
          kind: 'player_departure_reference',
          departureYear: source.year,
          recordedPlayer: source.recordedPlayer,
          recordedClub: source.recordedClub,
          reason: source.reason,
        },
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
