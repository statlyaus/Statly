import { redirect } from 'next/navigation';

/** Retired route: Player Analysis became the players board. */
export default function PlayerAnalysisPage(): never {
  redirect('/players');
}
