import type { SyntheticBoardPick, SyntheticSpentPick } from './footyinfoDraftBoardPage';

/**
 * Two matched bids from the reviewed 2021 Footyinfo national draft board, as facts in the synthetic
 * markup of `footyinfoDraftBoardPage.ts` (no provider bytes are retained). The values were read
 * from the retained 2021 board capture (content sha256 `95f8ad79…`, evidence mirror
 * `footyinfo-board-raw/7d99e431…`) on 2026-10-17: the board ids, numbers, rounds, clubs and points
 * of Sam Darcy's and Nick Daicos's father-son matches and of every pick spent on them.
 *
 * Darcy's spent picks cover 2,024 points against the 1,889 the board says the Western Bulldogs used;
 * the board turns the 135 left over into the Bulldogs' leftover-points pick 61 (Luke Cleary), whose
 * `created_from_points` hop names Darcy's pick. Daicos's four spent picks cover exactly the 1,651
 * Collingwood used, and the board records no leftover pick for that match.
 */
function spentOn(
  nominee: number,
  holder: string,
  round: number,
  spent: SyntheticSpentPick
): SyntheticBoardPick {
  return {
    id: spent.id,
    status: 'points_used',
    club: holder,
    round,
    points: spent.pointsUsed,
    pointsUsed: spent.pointsUsed,
    purchasedFrom: nominee,
    originalClub: spent.originalClub,
    ...(spent.originalNumber === null ? {} : { originalNumber: spent.originalNumber }),
  };
}

const spent = (
  id: number,
  round: number,
  originalClub: string,
  originalNumber: number,
  pointsUsed: number
) => ({
  round,
  pick: {
    id,
    label: `R${round} (${originalClub}) - Pick ${originalNumber}`,
    originalNumber,
    pointsUsed,
    originalClub,
  },
});

const DARCY_SPENT = [
  spent(7449, 2, 'GEE', 34, 542),
  spent(6042, 3, 'GCS', 42, 395),
  spent(6057, 3, 'ADE', 43, 378),
  spent(7451, 3, 'ADE', 44, 362),
  spent(5727, 3, 'HAW', 45, 347),
];
const DAICOS_SPENT = [
  spent(7450, 2, 'RCH', 38, 465),
  spent(5730, 3, 'NTH', 40, 429),
  spent(5719, 3, 'CAR', 46, 395),
  spent(5722, 3, 'FRE', 48, 362),
];

export const FOOTYINFO_2021_MATCHED_BIDS: readonly SyntheticBoardPick[] = [
  {
    id: 5733,
    status: 'picked',
    club: 'WBD',
    number: 2,
    round: 1,
    player: { name: 'Sam Darcy', slug: 'sam-darcy' },
    origin: 'points_purchase',
    points: 2517,
    pointsUsed: 1889,
    spent: DARCY_SPENT.map(({ pick }) => pick),
    bid: { club: 'GWS', reason: 'father_son' },
  },
  {
    id: 5735,
    status: 'picked',
    club: 'COL',
    number: 4,
    round: 1,
    player: { name: 'Nick Daicos', slug: 'nick-daicos' },
    origin: 'points_purchase',
    points: 2034,
    pointsUsed: 1651,
    spent: DAICOS_SPENT.map(({ pick }) => pick),
    bid: { club: 'GCS', reason: 'father_son' },
  },
  // The Bulldogs' leftover-points pick from the Darcy match, 135 points, used at 61.
  {
    id: 5792,
    status: 'picked',
    club: 'WBD',
    number: 61,
    round: 4,
    player: { name: 'Luke Cleary', slug: 'luke-cleary' },
    origin: 'points_remainder',
    points: 135,
    leftoverOf: 5733,
    lineage: [['created_from_points', null, 'WBD']],
  },
  ...DARCY_SPENT.map(({ round, pick }) => spentOn(5733, 'WBD', round, pick)),
  ...DAICOS_SPENT.map(({ round, pick }) => spentOn(5735, 'COL', round, pick)),
];
