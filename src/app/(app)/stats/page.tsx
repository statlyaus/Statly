import { redirect } from 'next/navigation';

/** Retired route: the season stats table became the players board. */
export default function StatsPage(): never {
  redirect('/players');
}
