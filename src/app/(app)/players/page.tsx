import PlayersPageServer from './PlayersPageServer';
import type { JSX } from 'react';

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string | string[] }>;
}): Promise<JSX.Element> {
  const { season } = await searchParams;
  return <PlayersPageServer season={Array.isArray(season) ? season[0] : season} />;
}
