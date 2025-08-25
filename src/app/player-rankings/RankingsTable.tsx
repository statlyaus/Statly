// Deprecated wrapper: prefer importing from '@/components/rankings/RankingsTable'
import RankingsTableComponent, { type PlayerRankingRow as BasePlayerRankingRow } from '@/components/rankings/RankingsTable';

/** @deprecated Use '@/components/rankings/RankingsTable' directly. */
export type DeprecatedPlayerRankingRow = BasePlayerRankingRow;

/** @deprecated Use '@/components/rankings/RankingsTable' directly. */
export const RankingsTable = RankingsTableComponent;

/** @deprecated Use '@/components/rankings/RankingsTable' directly. */
const DeprecatedRankingsTable = RankingsTableComponent;
export default DeprecatedRankingsTable;
