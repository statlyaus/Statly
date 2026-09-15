// Exact public club references reviewed for private acquisition continuity.
// This list permits bounded byte capture; it grants no source rights or factual admission.
export const OFFICIAL_AFL_PLAYER_CONTINUITY_SOURCES = [
  'https://www.afc.com.au/news/1221480/luke-brown-announces-retirement',
  'https://www.afc.com.au/news/23562/tambling-retires-from-afl',
  'https://www.geelongcats.com.au/news/1734906/trio-of-re-signings',
  'https://www.geelongcats.com.au/news/311699/caddy-becomes-a-tiger',
  'https://www.geelongcats.com.au/news/32253/quartet-sign-on',
  'https://www.gwsgiants.com.au/news/325692/patfull-calls-full-time',
  'https://www.gwsgiants.com.au/news/87629/a-numbers-game',
  'https://www.hawthornfc.com.au/news/412198/hale-calls-time-on-decorated-career',
  'https://www.lions.com.au/news/267468/lions-delist-five',
  'https://www.melbournefc.com.au/news/141584/melbourne-makes-further-delistings',
  'https://www.melbournefc.com.au/news/278812/preuss-joins-melbourne-in-trade-deal',
  'https://www.melbournefc.com.au/news/585125/remember-me-10-dees-who-played-under-10-games',
  'https://www.portadelaidefc.com.au/club/history/past-players',
  'https://www.portadelaidefc.com.au/news/1664506/dixon-hangs-up-the-boots',
  'https://www.richmondfc.com.au/news/47770/club-statement-chris-yarran',
  'https://www.westernbulldogs.com.au/news/752883/sherman-seeks-new-home',
] as const;

const reviewedSources: ReadonlySet<string> = new Set(OFFICIAL_AFL_PLAYER_CONTINUITY_SOURCES);

export function isReviewedOfficialAflPlayerContinuitySource(url: string): boolean {
  return reviewedSources.has(url);
}
