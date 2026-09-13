export const DRAFTGURU_YEAR_PARSER_VERSION = 'draftguru-event-year/v2';

export function assertDraftguruYearParserVersion(version: string): void {
  if (version !== DRAFTGURU_YEAR_PARSER_VERSION) {
    throw new TypeError(
      `General Draftguru year parser version must be ${DRAFTGURU_YEAR_PARSER_VERSION}; create a new approved schedule and run.`
    );
  }
}

/**
 * The 2020 year page embeds the 2021 mid-season draft. These exact source slots were
 * compared with the completed AFL report, rather than inferring a universal year offset:
 * https://www.afl.com.au/news/624927/roos-take-jacob-edwards-with-pick-no1-in-mid-season-draft
 * This resolves event year only. It grants no identity, custody, session-date or publication approval.
 * In particular, retain the source's Will Collins spelling; do not introduce an identity alias.
 */
const reviewed2021MidseasonSlots: readonly (readonly [string, string])[] = [
  ['jacob_edwards/1', 'north-melbourne'],
  ['jai_newcombe/1', 'hawthorn'],
  ['ash_johnson/1', 'collingwood'],
  ['patrick_parnell/1', 'adelaide'],
  ['ned_moyle/1', 'gold-coast'],
  ['alex_mirkov/1', 'carlton'],
  ['max_heath/1', 'st-kilda'],
  ['james_peatling/1', 'greater-western-sydney'],
  ['sam_durham/1', 'essendon'],
  ['matthew_parker/1', 'richmond'],
  ['will_collins/1', 'west-coast'],
  ['lachlan_mcandrew/1', 'sydney'],
  ['jed_mcentee/1', 'port-adelaide'],
  ['kalin_lane/1', 'brisbane'],
  ['kye_declase/1', 'melbourne'],
  ['charlie_ham/1', 'north-melbourne'],
  ['jackson_callow/1', 'hawthorn'],
  ['aiden_begg/1', 'collingwood'],
  ['jordan_boyd/1', 'carlton'],
  ['cooper_sharman/1', 'st-kilda'],
  ['connor_west/1', 'west-coast'],
  ['daniel_turner/2', 'melbourne'],
];

export function resolveDraftguruEventYear(input: {
  pageYear: number;
  sourceUrl: string;
  draftType: string;
  selectionNumber: number;
  playerNativeId: string | null;
  clubNativeId: string | null;
}): number | null {
  if (input.draftType !== 'mid_season') return input.pageYear;
  if (input.sourceUrl !== `https://www.draftguru.com.au/years/${input.pageYear}`) return null;
  if (input.pageYear !== 2020) return input.pageYear;
  const slot = reviewed2021MidseasonSlots[input.selectionNumber - 1];
  return slot && slot[0] === input.playerNativeId && slot[1] === input.clubNativeId ? 2021 : null;
}
