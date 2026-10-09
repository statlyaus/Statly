import { redirect } from 'next/navigation';

/** Retired route: the nine-category rankings at /rankings replaced the old value table. */
export default function PlayerRankingsPage(): never {
  redirect('/rankings');
}
