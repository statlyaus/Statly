import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Rosters and free agents live in each league, scoped and read from Prisma. The league page
// enforces membership, so an unexpected active_league cookie only lands on its access check.
export default async function RostersPage() {
  const activeLeague = (await cookies()).get('active_league')?.value;

  redirect(
    activeLeague ? `/leagues/${encodeURIComponent(activeLeague)}?tab=roster` : '/dashboard#leagues'
  );
}
