/**
 * A synthetic Draftguru post-draft order page in the reviewed shape: a points summary table, then the
 * one "Full Draft Order" table. Every name, link and number is made up for tests; no provider bytes.
 */
export interface SyntheticOrderRow {
  round: number;
  /** Absent on the unnumbered rows after the numbered ones. */
  pick?: number;
  /** The club cell: its Draftguru id and text. */
  club: readonly [nativeId: string, text: string];
  /** The origin cell's inner HTML; separate parts with `SEP`. */
  origin: string;
}

export const SEP = '<span> | </span>';

export const player = (id: string, name: string) =>
  `<a href="/players/${id}/1">${name.replace(' ', '&nbsp;')}</a>`;

export const trade = (id: string, label = 'live pick swap') =>
  `<a href="/trades/${id}">${label}</a>`;

export function postDraftOrderPage(rows: readonly SyntheticOrderRow[]): string {
  const body = rows
    .map(
      ({ round, pick, club, origin }) => `
      <tr>
        <td>${round}</td>
        <td class="pick"><a href="/picks/${pick ?? ''}">${pick ?? ''}</a></td>
        <td class="club"><a href="/clubs/${club[0]}">${club[1]}</a></td>
        <td class="origin">${origin}</td>
        <td><em>${pick === undefined ? '' : 9}</em></td>
        <td>${pick === undefined ? '' : `<a href="/picks/${pick}">1</a>`}</td>
      </tr>`
    )
    .join('');
  return `<!doctype html><html><body>
<table class="general sortable"><tr><td class="club">Summary</td></tr></table>
<h4>Full Draft Order</h4>
<div class="table-scroll-container">
  <table class="general provisional-draft-order">
    <thead><tr><th>Round</th><th>Pick</th><th>Club</th><th>Origin</th><th>Points</th><th>Avg Games</th></tr></thead>
    ${body}
  </table>
</div></body></html>`;
}

/** One row of every reviewed shape, as the 2026 page writes them (made-up players and trades). */
export const SYNTHETIC_ORDER_ROWS: readonly SyntheticOrderRow[] = [
  {
    round: 1,
    pick: 1,
    club: ['port-adelaide', 'Port Adelaide'],
    origin: `Ess bid for ${player('ann_alpha', 'Ann Alpha')} matched (Next Generation Academy) using picks 6, 22${SEP}Picked ${player('ann_alpha', 'Ann Alpha')}`,
  },
  {
    round: 1,
    pick: 2,
    club: ['essendon', 'Essendon'],
    origin: `<span>Ess R1 pick (18th)</span>${SEP}Picked ${player('bea_bravo', 'Bea Bravo')}`,
  },
  {
    round: 1,
    pick: 3,
    club: ['melbourne', 'Melbourne'],
    origin: `<span>Port R1 pick (15th)</span>${SEP}To Melb in ${trade('2026-cal-o&#39;charlie', 'Charlie trade')}${SEP}Picked ${player('dee_van%20delta', 'Dee Van Delta')}`,
  },
  {
    round: 1,
    pick: 4,
    club: ['sydney', 'Sydney'],
    origin: `Band 1 Free Agency Comp for ${player('eve_echo', 'Eve Echo')}${SEP}To GWS in ${trade('2026-picks-gold_coast-greater_western_sydney-28')}${SEP}To Syd in ${trade('2026-picks-greater_western_sydney-sydney-29')}${SEP}Bid not matched by Brisbane${SEP}Picked ${player('fay_fox', 'Fay Fox')}`,
  },
  {
    round: 1,
    pick: 5,
    club: ['greater-western-sydney', 'GWS'],
    origin: `Created for GWS from leftover points after matching bid for ${player('gus_golf', 'Gus Golf')}${SEP}Picked ${player('hal_hotel', 'Hal Hotel')}`,
  },
  {
    round: 2,
    pick: 6,
    club: ['essendon', 'Essendon'],
    origin: `Bidding compensation awarded after night one${SEP}Picked ${player('ida_india', 'Ida India')}`,
  },
  {
    round: 3,
    pick: 7,
    club: ['north-melbourne', 'North Melbourne'],
    origin: `Picked ${player('jo_juliet', 'Jo Juliet')}`,
  },
  {
    round: 1,
    club: ['port-adelaide', 'Port Adelaide'],
    origin: `<span>NM R1 pick (14th)</span>${SEP}To Syd in ${trade('2026-kim-kilo', 'Kilo trade')}${SEP}To Port in ${trade('2026-picks-port_adelaide-sydney-25')}${SEP}Used to match bid for ${player('ann_alpha', 'Ann Alpha')} as pick 6`,
  },
  {
    round: 5,
    club: ['carlton', 'Carlton'],
    origin: `<span>Carl R5 pick (8th)</span>${SEP}Removed - not enough list spots`,
  },
];
