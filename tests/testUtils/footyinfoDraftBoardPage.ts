/**
 * Synthetic Footyinfo national draft boards in the reviewed markup (read in a browser on 2026-10-12;
 * no provider bytes are retained in the repository). Players and notes are invented; the shape is
 * the page's: a rendered table of selections and the board data, every pick including passed and
 * removed ones, embedded as serialized router state with `$R[n]=` slot assignments, `!0`/`!1`
 * booleans and provider fields the parser must ignore.
 */

const CLUB_NAMES: Readonly<Record<string, string>> = {
  ADE: 'Adelaide',
  BRL: 'Brisbane',
  CAR: 'Carlton',
  COL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GCS: 'Gold Coast',
  GEE: 'Geelong',
  HAW: 'Hawthorn',
  MEL: 'Melbourne',
  NTH: 'North Melbourne',
  RCH: 'Richmond',
  STK: 'St Kilda',
  WBD: 'Western Bulldogs',
  GWS: 'GWS',
};

export interface SyntheticBoardPick {
  id: number;
  status: 'picked' | 'passed' | 'removed' | 'points_used';
  club: string;
  number?: number;
  round?: number;
  player?: { name: string; slug: string };
  origin?:
    | 'standard'
    | 'free_agency_compensation'
    | 'special_assistance'
    | 'points_remainder'
    | 'points_purchase';
  points?: number;
  note?: string;
  bid?: { club: string; reason: string };
  /** A bid record with no bidding team (an academy or father-son pick no rival club bid on). */
  unbidReason?: string;
  /** Hops as [kind, from, to]; `created_from_points` and `removed` hops take one club. */
  lineage?: Array<[string, string | null, string | null]>;
  /** Overrides the rendered table's route cell spans. */
  tableRoute?: string[];
  /** `points_used`: a matched bid's total, or the points a spent (`points_used`) pick covered. */
  pointsUsed?: number;
  /** A matched bid's `consumed_picks`, held by the bid's club. */
  spent?: SyntheticSpentPick[];
  /** A spent pick's `purchased_from`: the board id of the matched bid it was spent on. */
  purchasedFrom?: number;
  /**
   * The club the pick originally belonged to (`original.team`); defaults, as on every live board, to
   * the first club its route hands on, else the holder.
   */
  originalClub?: string;
  /** The pick's `original_number`. */
  originalNumber?: number;
  /** Omit `original`, which no live board does. */
  noOriginal?: boolean;
  /** A leftover-points pick's `created_from_points` hop names this matched bid (`related_pick`). */
  leftoverOf?: number;
}

export interface SyntheticSpentPick {
  id: number;
  label: string;
  originalNumber: number | null;
  pointsUsed: number;
  originalClub: string;
}

function team(abbrev: string): string {
  return `{id:${Object.keys(CLUB_NAMES).indexOf(abbrev) + 1},name:"${CLUB_NAMES[abbrev]}",abbrev:"${abbrev}",primaryColour:"#000000",slug:"${CLUB_NAMES[abbrev]!.toLowerCase().replace(/ /g, '-')}",icon_url:"https://cdn.footyinfo.com/teams/${abbrev}.svg"}`;
}

/** Adds a `$R[n]=` slot before every object and array, as the page's serializer does. */
function slotted(literal: string, first: number): string {
  let next = first;
  let inString = false;
  let out = '';
  for (let index = 0; index < literal.length; index += 1) {
    const char = literal[index]!;
    if (inString) {
      out += char;
      if (char === '\\') out += literal[++index];
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    if ((char === '{' || char === '[') && /[:[,]$|^$/.test(out.slice(-1))) out += `$R[${next++}]=`;
    out += char;
  }
  return out;
}

function spentRecord(spent: SyntheticSpentPick, holder: string): string {
  return `{id:${spent.id},label:"${spent.label}",number:null,original_number:${spent.originalNumber ?? 'null'},points_used:${spent.pointsUsed},team:${team(holder)},original_team:${team(spent.originalClub)}}`;
}

/** The first club a pick's route hands it on from, as the board's `original.team` states it. */
function routeOrigin(pick: SyntheticBoardPick): string | undefined {
  return (
    (pick.lineage ?? []).find(
      ([kind, from, to]) =>
        ['trade', 'pick_swap', 'live_pick_swap'].includes(kind) && from !== null && from !== to
    )?.[1] ?? undefined
  );
}

export function boardRecord(pick: SyntheticBoardPick, year = 2024): string {
  const fields = [
    `id:${pick.id}`,
    ...(pick.number === undefined ? [] : [`number:${pick.number}`]),
    `number_settled:!0`,
    ...(pick.round === undefined ? [] : [`round:${pick.round}`]),
    `period:{id:196,year:${year},type:"national_draft",league:"AFL",start_date:"${year}-11-20"}`,
    `team:${team(pick.club)}`,
    ...(pick.player === undefined
      ? []
      : [
          `player:{id:${pick.id + 10_000},known_as:"${pick.player.name}",slug:"${pick.player.slug}",dob:"2006-01-01",age_at_draft:18,height_cm:190,rating:{rating:50,tier:"Fringe",primaryRole:null,provisional:!1,current:!0}}`,
        ]),
    `status:{id:"${pick.status}",label:"${pick.status}"}`,
    `origin:{id:"${pick.origin ?? 'standard'}",label:"origin"}`,
    ...(pick.note === undefined ? [] : [`note:"${pick.note}"`]),
    ...(pick.points === undefined ? [] : [`points:${pick.points}`]),
    ...(pick.pointsUsed === undefined ? [] : [`points_used:${pick.pointsUsed}`]),
    ...(pick.spent === undefined
      ? []
      : [`consumed_picks:[${pick.spent.map((spent) => spentRecord(spent, pick.club)).join(',')}]`]),
    ...(pick.purchasedFrom === undefined
      ? []
      : [
          `purchased_from:{pick_id:${pick.purchasedFrom},number:1,team:${team(pick.club)},player:{id:1,known_as:"Nominee",slug:"nominee"}}`,
        ]),
    ...(pick.bid === undefined
      ? []
      : [
          `bid:{team:${team(pick.bid.club)},match_reason:"${pick.bid.reason}",match_player:{id:1,known_as:"Parent Player",slug:"parent-player"}}`,
        ]),
    ...(pick.unbidReason === undefined ? [] : [`bid:{match_reason:"${pick.unbidReason}"}`]),
    ...(pick.originalNumber === undefined ? [] : [`original_number:${pick.originalNumber}`]),
    ...(pick.noOriginal
      ? []
      : [
          `original:{team:${team(pick.originalClub ?? routeOrigin(pick) ?? pick.club)},round:${pick.round ?? 1},round_ordinal:1}`,
        ]),
    ...(pick.lineage === undefined
      ? []
      : [
          `lineage:[${pick.lineage
            .map(
              ([kind, from, to], index) =>
                `{ordinal:${index + 1},type:{id:"${kind}",label:"${kind}"},${from === null ? '' : `from:${team(from)},`}${to === null ? '' : `to:${team(to)},`}${kind === 'created_from_points' && pick.leftoverOf !== undefined ? `related_pick:{id:${pick.leftoverOf},number:1,team:${team(pick.club)}},` : ''}year:${year},summary:"Moved"}`
            )
            .join(',')}]`,
        ]),
  ];
  return `{${fields.join(',')}}`;
}

const ROUTE_LABELS: Readonly<Record<string, string>> = {
  free_agency_compensation: 'Compensation',
  special_assistance: 'Special assistance',
  points_remainder: 'Leftover points',
};

function tableRouteSpans(pick: SyntheticBoardPick): string[] {
  if (pick.tableRoute !== undefined) return pick.tableRoute;
  if (pick.bid !== undefined) return ['Matched bid', `${pick.bid.club} bid · Father-son`];
  const label = ROUTE_LABELS[pick.origin ?? 'standard'];
  // The board draws no step for a hop that leaves the pick with the same club.
  const hops = (pick.lineage ?? []).filter(
    ([kind, from, to]) => ['trade', 'pick_swap', 'live_pick_swap'].includes(kind) && from !== to
  );
  const chain = hops.length === 0 ? [] : [hops[0]![1]!, ...hops.map(([, , to]) => to!)];
  return [
    ...(label === undefined ? [] : [label]),
    ...(chain.length === 0 || pick.origin === 'points_remainder' ? [] : [chain.join(' → ')]),
  ];
}

function tableRow(pick: SyntheticBoardPick): string {
  const route = tableRouteSpans(pick)
    .map((text) => `<span class="whitespace-nowrap text-muted-foreground">${text}</span>`)
    .join('');
  return (
    `<tr class="border-b"><td><a aria-label="Pick ${pick.number}" href="/draft/pick/${pick.id}">${pick.number}</a></td>` +
    `<td><a title="${CLUB_NAMES[pick.club]}" href="/team/x"><img src="/x.svg" alt=""/><span>${pick.club}</span></a></td>` +
    `<td><a href="/player/${pick.player!.slug}">${pick.player!.name}</a></td>` +
    `<td><span role="img"><span>50</span></span></td><td>18</td><td>190</td><td title="Club/School/U18">U18</td>` +
    `<td><span class="flex items-center gap-x-2 text-fine">${route}</span></td>` +
    `<td>${pick.points ?? '–'}</td><td>${pick.note ?? ''}</td></tr>`
  );
}

const HEADER =
  '<tr><th scope="col">Pick</th><th scope="col">Club</th><th scope="col">Player</th>' +
  '<th scope="col"><button type="button">Rtg<span aria-hidden="true">▽</span></button></th>' +
  '<th scope="col">Age</th><th scope="col">Ht</th><th scope="col">From</th><th scope="col">Route</th>' +
  '<th scope="col">Pts</th><th scope="col">Note</th></tr>';

export function footyinfoBoardPage(
  picks: readonly SyntheticBoardPick[],
  options: {
    year?: number;
    loaderYear?: number;
    selectedKey?: string;
    tableRows?: string;
    /** Write `selected` as a back-reference to its entry in `periods`, as the live 2019 board does. */
    selectedByReference?: boolean;
  } = {}
): string {
  const year = options.year ?? 2024;
  const selectedPeriod = `$R[10]={id:196,name:"${year} National Draft",key:"${options.selectedKey ?? 'national_draft'}",year:${year},type:$R[11]={id:"${options.selectedKey ?? 'national_draft'}",isDraft:!0}}`;
  const records = slotted(picks.map((pick) => boardRecord(pick, year)).join(','), 40);
  const router =
    `$_TSR.router=($R=>$R[0]={manifest:$R[1]={routes:$R[2]={}},matches:$R[3]=[` +
    `$R[4]={i:"__root__",u:1,s:"success",l:$R[5]={session:null,theme:"dark"},ssr:!0},` +
    `$R[6]={i:"/draft/$year",u:1,s:"success",l:$R[7]={year:${options.loaderYear ?? year},` +
    (options.selectedByReference
      ? `periods:$R[8]=[${selectedPeriod}],availableYears:$R[9]=[${year}],selected:$R[10],`
      : `periods:$R[8]=[],availableYears:$R[9]=[${year}],selected:${selectedPeriod},`) +
    `defaultTypeId:"national_draft",content:$R[12]={kind:"picks",picks:$R[13]=[${records}]},team:null},ssr:!0}],` +
    `dehydratedData:$R[30]={}},$R[31]=($R[32]=() => {\n  const buffer = [];\n  return { flush() {} };\n})())($R["tsr"])`;
  const rounds = new Map<number, SyntheticBoardPick[]>();
  for (const pick of picks.filter(({ status }) => status === 'picked')) {
    rounds.set(pick.round ?? 0, [...(rounds.get(pick.round ?? 0) ?? []), pick]);
  }
  const rows =
    options.tableRows ??
    [...rounds.entries()]
      .map(
        ([round, roundPicks]) =>
          `<tr><th scope="rowgroup" colspan="10">Round ${round}</th></tr>${HEADER}${roundPicks.map(tableRow).join('')}`
      )
      .join('');
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>${year} National Draft | Footyinfo</title>` +
    `<script async="" src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>` +
    `<script>window.dataLayer = window.dataLayer || [];</script></head><body><main>` +
    `<label><input type="checkbox" checked=""/>Hide passed and removed picks</label>` +
    `<table><tbody>${rows}</tbody></table></main>` +
    `<script>(self.$R=self.$R||{})["tsr"]=[];</script><script>${router}</script>` +
    `<script>($R=>$R[31].return(void 0))($R["tsr"]);</script></body></html>`
  );
}

/** One board with each reviewed case: plain, matched bid, compensation, assistance with a route,
 * leftover points, passed, removed, a passed pick with no round, and a pick spent on the bid. */
export const SYNTHETIC_BOARD_PICKS: readonly SyntheticBoardPick[] = [
  {
    id: 1,
    status: 'picked',
    club: 'RCH',
    number: 1,
    round: 1,
    player: { name: 'Avery Example', slug: 'avery-example' },
    points: 3000,
  },
  {
    id: 2,
    status: 'picked',
    club: 'BRL',
    number: 5,
    round: 1,
    player: { name: "Blake O'Example", slug: 'blake-oexample' },
    origin: 'points_purchase',
    points: 1878,
    // 563 spent, 393 used: the 170 left over is the leftover-points pick 58 below.
    pointsUsed: 393,
    spent: [
      {
        id: 9,
        label: 'R2 (ESS) - Pick 23',
        originalNumber: 23,
        pointsUsed: 563,
        originalClub: 'ESS',
      },
    ],
    bid: { club: 'MEL', reason: 'father_son' },
  },
  {
    id: 3,
    status: 'picked',
    club: 'STK',
    number: 10,
    round: 1,
    player: { name: 'Casey Example', slug: 'casey-example' },
    origin: 'free_agency_compensation',
    points: 1395,
    note: 'Band 1 compensation for Departed Player',
  },
  {
    id: 4,
    status: 'picked',
    club: 'NTH',
    number: 27,
    round: 1,
    player: { name: 'Drew Example', slug: 'drew-example' },
    origin: 'special_assistance',
    points: 703,
    note: '2023 assistance package (end of R1)',
    lineage: [
      ['pick_swap', 'NTH', 'GCS'],
      ['trade', 'GCS', 'RCH'],
      ['live_pick_swap', 'RCH', 'NTH'],
    ],
  },
  {
    id: 5,
    status: 'picked',
    club: 'RCH',
    number: 58,
    round: 4,
    player: { name: 'Ellis Example', slug: 'ellis-example' },
    origin: 'points_remainder',
    points: 170,
    leftoverOf: 2,
    lineage: [
      ['created_from_points', null, 'BRL'],
      ['live_pick_swap', 'BRL', 'RCH'],
    ],
  },
  {
    id: 6,
    status: 'passed',
    club: 'CAR',
    round: 4,
    points: 49,
    originalNumber: 66,
    lineage: [
      ['trade', 'FRE', 'STK'],
      ['trade', 'STK', 'CAR'],
    ],
  },
  {
    id: 7,
    status: 'removed',
    club: 'GCS',
    round: 4,
    note: 'Removed - not enough list spots',
    lineage: [
      ['trade', 'COL', 'HAW'],
      ['trade', 'HAW', 'ESS'],
      ['pick_swap', 'ESS', 'RCH'],
      ['trade', 'RCH', 'GCS'],
      ['removed', 'GCS', null],
    ],
  },
  { id: 8, status: 'passed', club: 'GEE', note: 'Not used' },
  {
    id: 9,
    status: 'points_used',
    club: 'BRL',
    round: 2,
    points: 563,
    pointsUsed: 563,
    purchasedFrom: 2,
    originalClub: 'ESS',
    originalNumber: 23,
    lineage: [
      ['trade', 'ESS', 'BRL'],
      ['bid_match', 'BRL', 'BRL'],
    ],
  },
];
