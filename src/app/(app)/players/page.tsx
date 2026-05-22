import 'server-only';
import PlayersPageServer from './PlayersPageServer';

export default async function PlayersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PlayersPageServer searchParams={await searchParams} />;
}
